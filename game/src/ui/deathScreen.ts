/**
 * What happened when you died, and where your things are.
 *
 * Death already works and the gate proves it: the pack empties into a recovery cache, the player
 * respawns at their bound point, and the cache can be walked back to and looted. The only thing a
 * player was ever told about any of that was the word "dead" on the health bar and a toast that
 * scrolled away. Respawn is instant and automatic, so this is not a gate the player has to click
 * through — it is a report, dismissed with Escape or the button, and it is the only place the
 * cache's location and expiry are ever stated.
 *
 * Not a `PanelFrame`: it covers the screen, it has no key, and it is raised by an event rather than
 * by the player.
 *
 * Three things this file is careful about:
 *
 *  1. **It never blocks the world.** The backdrop is `pointer-events: none` and only the card opts
 *     back in, so the game underneath stays clickable even while the report is up, and `hidden`
 *     takes the whole thing out of the layout. A full-screen layer that keeps eating clicks after
 *     it is dismissed is the one way this component can break every other system.
 *  2. **The countdown is on the sim clock, not the wall clock.** See `simNowMs` below.
 *  3. **`api.inspect` is the ground truth for whether the cache still exists.** The countdown is an
 *     estimate; the entity either resolves or it does not. When the two disagree, the entity wins,
 *     so the screen never says "gone" about a cache that is still standing, or the reverse.
 */
import type { RegionId } from "../contracts.js";
import { REGIONS, findLocation, getRegion } from "../content/regions.js";
import type { UiContext } from "./panels.js";
import { prettifyId, report } from "./panels.js";

/** Read straight off the `player.died` event payload. Every field is already in it. */
export interface DeathDetail {
  /** Where the player fell. */
  position: readonly [number, number, number];
  regionId: string;
  /** Where they got back up. */
  respawnPosition: readonly [number, number, number];
  respawnPointId: string;
  /** The recovery cache holding what they were carrying, or null if they carried nothing. */
  cacheId: string | null;
  itemsLost: number;
  /** Sim-clock milliseconds at which the cache is destroyed, or null. */
  expiresAtMs: number | null;
}

/** How often the screen re-samples the sim clock. `update()` runs four times as often as this. */
const CLOCK_POLL_MS = 400;
/**
 * A sample this far behind the running estimate is a discontinuity in the sim clock — a pause, a
 * time scale, a debug jump — not jitter, so the countdown is allowed to correct upward.
 */
const CLOCK_RESYNC_MS = 3_000;

// -------------------------------------------------------------------- naming

/** Region and dungeon display names. `getRegion` does not know about dungeon ids. */
function regionName(regionId: string): string {
  const region = getRegion(regionId as RegionId);
  if (region) return region.name;
  for (const candidate of REGIONS) {
    if (candidate.dungeon?.id === regionId) return candidate.dungeon.name;
  }
  return prettifyId(regionId);
}

/** Respawn points are route-graph locations, so the settlement has a real name to print. */
function respawnName(respawnPointId: string): string {
  return findLocation(respawnPointId)?.location.name ?? prettifyId(respawnPointId);
}

// ------------------------------------------------------------------ numbers

/** Ground distance. Height is noise here — nobody walks up. */
function distanceXZ(a: readonly number[], b: readonly number[]): number {
  const dx = (a[0] ?? 0) - (b[0] ?? 0);
  const dz = (a[2] ?? 0) - (b[2] ?? 0);
  return Math.hypot(dx, dz);
}

function formatMetres(metres: number): string {
  return `${Math.round(metres).toLocaleString("en-US")} m`;
}

/** m:ss, because a 15 minute timer read as "900s" is not read at all. */
function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export class DeathScreen {
  private readonly root: HTMLElement;
  private detail: DeathDetail | null = null;

  /** Live cells, rebuilt by `show` and repainted by `update`. */
  private distanceValue: HTMLElement | null = null;
  private expiryRow: HTMLElement | null = null;
  private expiryValue: HTMLElement | null = null;
  private walkButton: HTMLButtonElement | null = null;
  private dismissButton: HTMLButtonElement | null = null;
  private noteEl: HTMLElement | null = null;
  private liveSig = "";

  private popEscape: (() => void) | null = null;
  private restoreFocus: HTMLElement | null = null;

  // ---- sim-clock estimate. See `simNowMs`.
  private anchorSimMs = 0;
  private anchorWallMs = 0;
  private lastSimMs = 0;
  private clockAnchored = false;
  private eventCursor = 0;
  private pollInFlight = false;
  private lastPollWallMs = 0;

  constructor(private readonly ctx: UiContext) {
    const root = document.createElement("section");
    root.className = "death";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "You died");
    this.root = root;
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Raised by the root from `player.died`. */
  show(detail: DeathDetail): void {
    // A second death while the first report is still up replaces it rather than stacking.
    this.popEscape?.();
    this.popEscape = null;

    this.detail = detail;
    this.clockAnchored = false;
    this.lastSimMs = 0;
    this.lastPollWallMs = 0;
    this.liveSig = "";

    const wasOpen = this.isOpen();
    this.root.hidden = false;
    if (!wasOpen) {
      this.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    this.build();
    // Reads the whole event ring once to anchor the sim clock. Resolves on a microtask, so the
    // countdown is populated before the first paint.
    this.sampleClock(0);
    this.refresh(true);

    this.popEscape = this.ctx.registry.pushEscapeHandler(() => {
      if (!this.isOpen()) return false;
      this.hide();
      return true;
    });

    const focus = this.walkButton ?? this.root.querySelector<HTMLElement>("[data-autofocus]");
    focus?.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.isOpen()) return;
    this.root.hidden = true;
    this.detail = null;
    this.popEscape?.();
    this.popEscape = null;
    this.distanceValue = null;
    this.expiryRow = null;
    this.expiryValue = null;
    this.walkButton = null;
    this.dismissButton = null;
    this.noteEl = null;

    // Focus goes back where it came from, or the next keystroke lands on a hidden button.
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore && restore.isConnected && !this.root.contains(restore)) {
      restore.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  /** Called on the HUD cadence while open, for the cache expiry countdown. */
  update(): void {
    if (!this.isOpen()) return;
    const wall = performance.now();
    if (wall - this.lastPollWallMs >= CLOCK_POLL_MS) {
      this.lastPollWallMs = wall;
      this.sampleClock(this.eventCursor);
    }
    this.refresh(false);
  }

  dispose(): void {
    this.popEscape?.();
    this.popEscape = null;
    this.root.remove();
  }

  // ------------------------------------------------------------- the sim clock

  /**
   * The current sim-clock time, or NaN before the first sample lands.
   *
   * `expiresAtMs` is sim-clock milliseconds, and the sim clock is not wall time: it can be paused
   * and time-scaled, and `advanceGameTime` jumps it outright. `GameApi` has no synchronous read of
   * `SimClock.elapsedMs` — there is no `getTime()` on the interface — and the UI must not reach
   * past the API into `app/*` or `debug/*` to find one. What the API does expose is
   * `GameEvent.atMs`, which IS the sim clock, through `events()`. Called without a timeout that is
   * a pure cursor read over the event ring: no long poll, no side effects, resolves on a microtask.
   *
   * So the countdown is anchored to a real sim-clock reading and re-anchored to a fresh one every
   * time an event lands, which while anything at all is happening is several times a second and at
   * worst is the 400 ms poll below. Between anchors it advances at wall rate, because that is the
   * only assumption available and at 1x it is exactly right. A pause, a time scale or a debug jump
   * therefore shows up as a correction at the next anchor rather than as a number that quietly
   * drifts away from the truth for fifteen minutes.
   *
   * The blind spot is a world that emits nothing at all while the clock is stopped or rescaled:
   * no events, no anchors, and the estimate coasts. That is what `api.inspect` on the cache entity
   * is for — see `readCache`. The estimate can be a little wrong; the claim "it is gone" never is.
   */
  private simNowMs(): number {
    if (!this.clockAnchored) return Number.NaN;
    const estimate = this.anchorSimMs + (performance.now() - this.anchorWallMs);
    // Monotone, so a 200 ms sampling wobble never makes the countdown tick backwards.
    this.lastSimMs = Math.max(this.lastSimMs, estimate);
    return this.lastSimMs;
  }

  private sampleClock(sinceSeq: number): void {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    void Promise.resolve(this.ctx.api.events(sinceSeq))
      .then((batch) => {
        this.pollInFlight = false;
        this.eventCursor = batch.nextSeq;
        const last = batch.events[batch.events.length - 1];
        if (!last) return;
        this.acceptSample(last.atMs);
        if (this.isOpen()) this.refresh(false);
      })
      .catch(() => {
        this.pollInFlight = false;
      });
  }

  private acceptSample(simMs: number): void {
    // An event's `atMs` is the tick it was emitted in, so a sample is at most one 100 ms tick old.
    // Against a fifteen minute budget that is not worth correcting for.
    this.anchorSimMs = simMs;
    this.anchorWallMs = performance.now();
    if (!this.clockAnchored || simMs < this.lastSimMs - CLOCK_RESYNC_MS) {
      this.clockAnchored = true;
      this.lastSimMs = simMs;
    }
  }

  // ------------------------------------------------------------------- the cache

  /** The cache entity is authoritative. It is removed the tick it expires, and when it is emptied. */
  private readCache(): { alive: boolean; expiresAtMs: number | null } {
    const detail = this.detail;
    if (!detail?.cacheId) return { alive: false, expiresAtMs: null };
    const found = this.ctx.api.inspect(detail.cacheId);
    if (!found.ok) return { alive: false, expiresAtMs: detail.expiresAtMs };
    const raw = found.value.meta?.["expiresAtMs"];
    return { alive: true, expiresAtMs: typeof raw === "number" ? raw : detail.expiresAtMs };
  }

  private walkBack(): void {
    const detail = this.detail;
    if (!detail?.cacheId) return;
    // A failed Result speaks for itself through the notice channel: NOT_FOUND when the cache has
    // already gone, NOT_REACHABLE when there is no path back to it.
    if (report(this.ctx.api.moveTo({ entityId: detail.cacheId }))) this.hide();
  }

  // ----------------------------------------------------------------- building

  private build(): void {
    const detail = this.detail;
    if (!detail) return;
    this.root.replaceChildren();

    const card = document.createElement("div");
    card.className = "panel death__card";

    const head = document.createElement("header");
    head.className = "death__head";
    const title = document.createElement("h2");
    title.className = "death__title";
    title.textContent = "You died";
    const where = document.createElement("p");
    where.className = "death__where u-caps u-dim";
    // Both halves of the fact in one line: which region you fell in, which settlement you woke in.
    where.textContent = `Fell in ${regionName(detail.regionId)} · back up at ${respawnName(detail.respawnPointId)}`;
    head.append(title, where);

    const body = document.createElement("div");
    body.className = "death__body";

    const lead = document.createElement("p");
    lead.className = "death__lead";
    // Past tense on purpose: the cache can expire while this is on screen and the sentence has to
    // stay true when it does. What is still standing is the countdown's job to say.
    lead.textContent = detail.cacheId
      ? `Your pack emptied where you fell. ${detail.itemsLost} ${plural(detail.itemsLost, "stack", "stacks")} `
        + "went into a recovery cache."
      : "You were carrying nothing, so nothing dropped.";

    const kept = document.createElement("p");
    kept.className = "death__kept u-dim";
    kept.textContent = "Skills, worn equipment and marks came through untouched.";

    body.append(lead, kept);

    const facts = document.createElement("dl");
    facts.className = "death__facts";
    facts.append(this.buildFact(detail.cacheId ? "Cache" : "Where you fell", "distance"));
    if (detail.cacheId) {
      this.expiryRow = this.buildFact("Expires in", "expiry");
      facts.appendChild(this.expiryRow);
    } else {
      this.expiryRow = null;
      this.expiryValue = null;
    }
    body.appendChild(facts);

    if (detail.cacheId) {
      const note = document.createElement("p");
      note.className = "death__note";
      this.noteEl = note;
      body.appendChild(note);
    } else {
      this.noteEl = null;
    }

    const actions = document.createElement("footer");
    actions.className = "death__actions";

    if (detail.cacheId) {
      const walk = document.createElement("button");
      walk.type = "button";
      walk.className = "btn btn--primary death__walk";
      walk.textContent = "Walk back to it";
      walk.dataset["autofocus"] = "true";
      walk.addEventListener("click", () => this.walkBack());
      this.walkButton = walk;

      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "btn btn--ghost";
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", () => this.hide());
      this.dismissButton = dismiss;

      actions.append(walk, dismiss);
    } else {
      this.walkButton = null;
      this.dismissButton = null;
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "btn btn--primary";
      dismiss.textContent = "Carry on";
      dismiss.dataset["autofocus"] = "true";
      dismiss.addEventListener("click", () => this.hide());
      actions.appendChild(dismiss);
    }

    card.append(head, body, actions);
    this.root.appendChild(card);
  }

  private buildFact(label: string, kind: "distance" | "expiry"): HTMLElement {
    const row = document.createElement("div");
    row.className = "death__fact";
    const dt = document.createElement("dt");
    dt.className = "u-caps u-faint";
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.className = "death__fact-value u-numeric";
    row.append(dt, dd);
    if (kind === "distance") this.distanceValue = dd;
    else this.expiryValue = dd;
    return row;
  }

  // ---------------------------------------------------------------- repainting

  /** Only the distance, the countdown and the cache's fate move. Nothing else is touched. */
  private refresh(force: boolean): void {
    const detail = this.detail;
    if (!detail) return;

    const player = this.ctx.api.getPlayer();
    const away = `${formatMetres(distanceXZ(player.position, detail.position))} away`;

    const cache = detail.cacheId ? this.readCache() : { alive: false, expiresAtMs: null };
    const simNow = this.simNowMs();

    let countdown = "—";
    if (detail.cacheId && !cache.alive) countdown = "gone";
    else if (detail.cacheId && cache.expiresAtMs !== null && Number.isFinite(simNow)) {
      const remaining = cache.expiresAtMs - simNow;
      // The entity outranks the estimate: still standing means still standing, whatever the maths
      // says, and 0:00 next to a cache that is really there would be the worse lie.
      countdown = remaining > 0 ? formatCountdown(remaining) : "any moment";
    }

    const signature = `${away}|${countdown}|${cache.alive}`;
    if (!force && signature === this.liveSig) return;
    this.liveSig = signature;

    if (this.distanceValue) this.distanceValue.textContent = away;
    if (this.expiryValue) this.expiryValue.textContent = countdown;
    this.expiryRow?.classList.toggle("is-lost", detail.cacheId !== null && !cache.alive);

    if (this.walkButton) {
      this.walkButton.disabled = !cache.alive;
      this.walkButton.textContent = cache.alive ? "Walk back to it" : "Nothing to go back for";
      // A dead action must not keep the brass. Dismiss becomes the only thing left to do.
      this.walkButton.classList.toggle("btn--primary", cache.alive);
      this.dismissButton?.classList.toggle("btn--primary", !cache.alive);
      this.dismissButton?.classList.toggle("btn--ghost", cache.alive);
    }
    if (this.noteEl) {
      this.noteEl.textContent = cache.alive
        ? "Dying again destroys it before the timer does."
        : "The cache is gone, and what was in it went with it.";
      this.noteEl.classList.toggle("is-lost", !cache.alive);
    }
  }
}
