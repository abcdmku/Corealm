/**
 * The always-on HUD: vitals, the current activity, the XP feed, toasts, marks, and the compass.
 *
 * Everything here is arranged around one constraint from the brief — the middle of the screen is
 * where the game is, so the HUD lives on the edges. Vitals top-left, compass top-centre as a thin
 * strip, marks and the XP feed top-right, toasts bottom-left where the context menu already put
 * them.
 *
 * The HUD takes over the notice channel from `ui/contextMenu.ts` via `setNoticeSink` (wired in
 * `panels.ts`), so every failed action, every greyed menu entry, and every game event lands in one
 * strip instead of three competing ones.
 *
 * There is no per-frame work here. `update()` is called on a 100 ms cadence and each channel keeps
 * a signature of what it last wrote; the compass, which costs an `observe()` call, runs slower
 * still. Nothing touches the DOM unless the underlying number changed.
 */
import type { GameEvent, ObservedEntity, SkillId, Vec3 } from "../contracts.js";
import { SKILL_IDS } from "../contracts.js";
import { SKILLS } from "../content/skills.js";
import { RECOVERY_CACHE_ID } from "../systems/death.js";
import { reportResult } from "./contextMenu.js";
import type { NoticeTone } from "./contextMenu.js";
import type { UiContext, UiOptions } from "./panels.js";
import { formatQuantity } from "./panels.js";

const TOAST_LIMIT = 4;
const TOAST_DECAY_MS = 6_000;
const XP_DROP_LIMIT = 6;
const XP_DROP_MS = 2_200;
const COMPASS_INTERVAL_MS = 480;
const EVENT_INTERVAL_MS = 250;
/** The compass tape shows this many degrees either side of where you are looking. */
const COMPASS_HALF_SPAN_DEG = 70;

/** What counts as a "known location" for the compass needle. */
const LANDMARK_ARCHETYPES = new Set(["landmark", "bank", "shop", "station", "portal", "npc"]);

const CARDINALS: readonly { label: string; bearing: number }[] = [
  { label: "N", bearing: 0 },
  { label: "NE", bearing: 45 },
  { label: "E", bearing: 90 },
  { label: "SE", bearing: 135 },
  { label: "S", bearing: 180 },
  { label: "SW", bearing: 225 },
  { label: "W", bearing: 270 },
  { label: "NW", bearing: 315 },
];

export type AutoOpen = "bank" | "shop" | null;

export class Hud {
  readonly element: HTMLElement;
  private readonly toastStrip: HTMLElement;

  private readonly healthBar: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthText: HTMLElement;
  private readonly activityRow: HTMLElement;
  private readonly activityLabel: HTMLElement;
  private readonly activityFill: HTMLElement;
  private readonly activityCount: HTMLElement;
  private readonly currencyValue: HTMLElement;
  private readonly xpFeed: HTMLElement;
  private readonly compass: HTMLElement;
  private readonly compassTape: HTMLElement;
  private readonly compassTarget: HTMLElement;
  private readonly cacheBanner: HTMLElement;
  private readonly cacheDetail: HTMLElement;

  private healthSig = "";
  private activitySig = "";
  private currencySig = "";
  private compassSig = "";

  private xpBaseline: Partial<Record<SkillId, number>> = {};
  private xpSeeded = false;
  private lastCompassMs = 0;
  private lastEventMs = 0;
  private eventCursor = 0;
  private eventPollInFlight = false;
  private pendingOpen: AutoOpen = null;
  private lastActivityKind: string | null = null;
  private readonly timers = new Set<number>();

  constructor(private readonly ctx: UiContext, private readonly options: UiOptions) {
    const root = document.createElement("div");
    // is-passive keeps the HUD out of the way of world clicks: #ui-root's rule opts it back out of
    // pointer events. Nothing in the HUD is clickable, so this is free.
    // The cache banner is the one clickable thing in here, so it opts back into pointer events
    // itself; everything else stays passive so world clicks pass straight through.
    root.className = "hud is-passive";

    // ---- vitals, top left
    const vitals = document.createElement("div");
    vitals.className = "hud__vitals";

    const health = document.createElement("div");
    health.className = "bar bar--tall bar--health hud__health";
    health.setAttribute("role", "meter");
    health.setAttribute("aria-label", "Health");
    const healthFill = document.createElement("div");
    healthFill.className = "bar__fill";
    const healthText = document.createElement("div");
    healthText.className = "bar__text";
    health.append(healthFill, healthText);

    const activity = document.createElement("div");
    activity.className = "hud__activity";
    activity.hidden = true;
    const activityHead = document.createElement("div");
    activityHead.className = "hud__activity-head";
    const activityLabel = document.createElement("span");
    activityLabel.className = "hud__activity-label";
    const activityCount = document.createElement("span");
    activityCount.className = "hud__activity-count u-numeric u-dim";
    activityHead.append(activityLabel, activityCount);
    const activityBar = document.createElement("div");
    activityBar.className = "bar bar--activity";
    const activityFill = document.createElement("div");
    activityFill.className = "bar__fill";
    activityBar.appendChild(activityFill);
    activity.append(activityHead, activityBar);

    // ---- recovery cache, under the vitals
    //
    // `systems/death.ts` has said since round 3 that "the HUD is supposed to show a countdown
    // banner while one is out", and nothing showed one. The death report explains the loss once and
    // is dismissed for good — it has no key and no frame — so without this a player who clicks
    // Dismiss has no way left to find out where their pack is or how long they have. Dying with a
    // live cache destroys the old one, which is what makes the second death the expensive one and
    // this banner worth its space.
    const cache = document.createElement("button");
    cache.type = "button";
    cache.className = "hud__cache";
    cache.hidden = true;
    cache.title = "Walk back to your recovery cache";
    const cacheLabel = document.createElement("span");
    cacheLabel.className = "hud__cache-label u-caps";
    cacheLabel.textContent = "Cache";
    const cacheDetail = document.createElement("span");
    cacheDetail.className = "hud__cache-detail u-numeric";
    cache.append(cacheLabel, cacheDetail);
    cache.addEventListener("pointerdown", (event) => event.stopPropagation());
    cache.addEventListener("click", () => {
      // `interact` walks into range and then loots on arrival, so one click recovers the pack.
      reportResult(this.ctx.api.interact(RECOVERY_CACHE_ID, "loot"));
    });

    vitals.append(health, activity, cache);
    this.cacheBanner = cache;
    this.cacheDetail = cacheDetail;

    // ---- compass, top centre
    const compass = document.createElement("div");
    compass.className = "hud__compass";
    compass.setAttribute("role", "img");
    compass.setAttribute("aria-label", "Compass");
    const tape = document.createElement("div");
    tape.className = "compass__tape";
    const target = document.createElement("div");
    target.className = "compass__target u-truncate";
    compass.append(tape, target);

    // ---- marks and the XP feed, top right
    const right = document.createElement("div");
    right.className = "hud__right";
    const currency = document.createElement("div");
    currency.className = "hud__currency";
    const currencyMark = document.createElement("span");
    currencyMark.className = "hud__currency-mark";
    currencyMark.textContent = "◈";
    const currencyValue = document.createElement("span");
    currencyValue.className = "hud__currency-value u-numeric";
    currencyValue.textContent = "0";
    const currencyWord = document.createElement("span");
    currencyWord.className = "u-caps u-dim";
    currencyWord.textContent = "marks";
    currency.append(currencyMark, currencyValue, currencyWord);

    const xpFeed = document.createElement("div");
    xpFeed.className = "hud__xp-feed";
    right.append(currency, xpFeed);

    root.append(vitals, compass, right);

    // The toast strip is a sibling, not a child: #ui-root already styles and positions
    // `.toast-strip`, and the context menu's fallback looks for exactly that selector.
    const toastStrip = document.createElement("div");
    toastStrip.className = "toast-strip";
    toastStrip.setAttribute("role", "status");
    toastStrip.setAttribute("aria-live", "polite");

    this.element = root;
    this.toastStrip = toastStrip;
    this.healthBar = health;
    this.healthFill = healthFill;
    this.healthText = healthText;
    this.activityRow = activity;
    this.activityLabel = activityLabel;
    this.activityFill = activityFill;
    this.activityCount = activityCount;
    this.currencyValue = currencyValue;
    this.xpFeed = xpFeed;
    this.compass = compass;
    this.compassTape = tape;
    this.compassTarget = target;

    this.buildCompassTicks();
  }

  mount(parent: HTMLElement): void {
    parent.append(this.element, this.toastStrip);
  }

  /** The notice sink. Everything the player is told arrives here. */
  pushNotice(message: string, tone: NoticeTone = "info"): void {
    const line = document.createElement("div");
    line.className = `toast toast--${tone}`;
    line.textContent = message;
    this.toastStrip.appendChild(line);
    while (this.toastStrip.childElementCount > TOAST_LIMIT) this.toastStrip.firstElementChild?.remove();

    this.after(TOAST_DECAY_MS, () => {
      line.classList.add("toast--leaving");
      this.after(400, () => line.remove());
    });
  }

  /** Consumed by `createUi`: a bank or shop interaction landed and the window should come up. */
  takeAutoOpen(): AutoOpen {
    const pending = this.pendingOpen;
    this.pendingOpen = null;
    return pending;
  }

  update(nowMs: number): void {
    const api = this.ctx.api;
    const player = api.getPlayer();

    // The bar stays hot for the whole no-regen window, not just while a target is alive.
    this.updateHealth(player.health, player.maxHealth, player.inCombat || player.regenBlocked, player.dead);
    this.updateActivity();
    this.updateCurrency(api.getCurrency());
    this.updateXpFeed();
    this.updateCache();

    if (nowMs - this.lastCompassMs >= COMPASS_INTERVAL_MS) {
      this.lastCompassMs = nowMs;
      this.updateCompass(player.position);
    }
    if (nowMs - this.lastEventMs >= EVENT_INTERVAL_MS) {
      this.lastEventMs = nowMs;
      this.pollEvents();
    }
  }

  /**
   * The recovery-cache banner: how far, and how long.
   *
   * Both numbers come off the same two calls an agent would make — `inspect` for the cache's own
   * `expiresAtMs` and `observe` for path distance — and the deadline is compared against
   * `getTime().simMs`, never against wall time. Sim time is what every `*AtMs` field in the game is
   * stamped in, and it stops when the clock stops.
   */
  private updateCache(): void {
    const banner = this.cacheBanner;
    const detail = this.cacheDetail;
    if (!banner || !detail) return;

    const found = this.ctx.api.inspect(RECOVERY_CACHE_ID);
    if (!found.ok || found.value.state !== "available") {
      if (!banner.hidden) banner.hidden = true;
      return;
    }

    const expiresAtMs = Number(found.value.meta?.["expiresAtMs"] ?? 0);
    const remainingMs = Math.max(0, expiresAtMs - this.ctx.api.getTime().simMs);

    // Straight line from the cache's own position, not `observe` path distance: `observe` caps at
    // 140 m and a cache is routinely 340 m behind you, so the honest number is the one that is
    // always available. `scope: "known"` is no help either — it answers with route-graph places,
    // and a cache is not one.
    const player = this.ctx.api.getPlayer().position;
    const at = found.value.position;
    const metres = Math.hypot(at[0] - player[0], at[2] - player[2]);

    const minutes = Math.floor(remainingMs / 60_000);
    const seconds = Math.floor((remainingMs % 60_000) / 1000);
    const clock = `${minutes}:${String(seconds).padStart(2, "0")}`;
    const text = `${Math.round(metres)} m · ${clock}`;

    if (detail.textContent !== text) detail.textContent = text;
    banner.classList.toggle("is-urgent", remainingMs < 120_000);
    if (banner.hidden) banner.hidden = false;
  }

  dispose(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    this.element.remove();
    this.toastStrip.remove();
  }

  // ---------------------------------------------------------------- vitals

  private updateHealth(health: number, maxHealth: number, inCombat: boolean, dead: boolean): void {
    const signature = `${health}/${maxHealth}/${inCombat}/${dead}`;
    if (signature === this.healthSig) return;
    this.healthSig = signature;

    const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
    this.healthFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.healthText.textContent = dead ? "dead" : `${Math.max(0, Math.round(health))} / ${Math.round(maxHealth)}`;
    // Green while it is fine, brass while it is going, red while it matters. One glance, one colour.
    const colour = ratio > 0.6 ? "#6b9c52" : ratio > 0.3 ? "#c9a227" : "#c9553d";
    this.healthBar.style.setProperty("--bar-colour", colour);
    this.healthBar.classList.toggle("is-low", ratio <= 0.3 && !dead);
    this.healthBar.classList.toggle("is-combat", inCombat);
    this.healthBar.setAttribute("aria-valuenow", String(Math.max(0, Math.round(health))));
    this.healthBar.setAttribute("aria-valuemax", String(Math.round(maxHealth)));
  }

  private updateActivity(): void {
    const activity = this.ctx.api.getActivity();
    const signature = activity
      ? `${activity.kind}:${activity.skill ?? "-"}:${activity.progress.toFixed(2)}:${activity.completed}:${activity.remaining}`
      : "-";
    if (signature === this.activitySig) return;
    this.activitySig = signature;

    if (!activity) {
      this.activityRow.hidden = true;
      this.detectAutoOpen(null);
      return;
    }

    this.activityRow.hidden = false;
    const label = activity.skill ? SKILLS[activity.skill].name : titleCase(activity.kind);
    this.activityLabel.textContent = label;
    if (activity.skill) this.activityRow.dataset["skill"] = activity.skill;
    else delete this.activityRow.dataset["skill"];
    this.activityRow.classList.toggle("has-skill", Boolean(activity.skill));
    this.activityFill.style.width = `${(Math.max(0, Math.min(1, activity.progress)) * 100).toFixed(1)}%`;
    this.activityCount.textContent = activity.remaining > 0
      ? `${activity.completed} done · ${activity.remaining} left`
      : `${activity.completed} done`;
    this.detectAutoOpen(activity.kind);
  }

  private updateCurrency(currency: number): void {
    const signature = String(currency);
    if (signature === this.currencySig) return;
    this.currencySig = signature;
    this.currencyValue.textContent = formatQuantity(currency);
    this.currencyValue.title = `${Math.floor(currency).toLocaleString("en-US")} marks`;
  }

  // ---------------------------------------------------------------- xp feed

  /**
   * There is no xp.gained event in the contract, so the feed is a diff of `getSkills()` between
   * polls. That is also more robust: it catches XP from any source, including one a later system
   * forgets to emit an event for.
   */
  private updateXpFeed(): void {
    const skills = this.ctx.api.getSkills();
    if (!this.xpSeeded) {
      for (const id of SKILL_IDS) this.xpBaseline[id] = skills[id].xp;
      this.xpSeeded = true;
      return;
    }

    for (const id of SKILL_IDS) {
      const previous = this.xpBaseline[id] ?? 0;
      const current = skills[id].xp;
      if (current <= previous) {
        this.xpBaseline[id] = current;
        continue;
      }
      this.xpBaseline[id] = current;
      this.spawnXpDrop(id, current - previous);
    }
  }

  private spawnXpDrop(skill: SkillId, amount: number): void {
    const drop = document.createElement("div");
    drop.className = "xp-drop";
    drop.dataset["skill"] = skill;
    drop.style.setProperty("--skill-colour", SKILLS[skill].colour);
    drop.textContent = `+${Math.round(amount).toLocaleString("en-US")} ${SKILLS[skill].name}`;
    this.xpFeed.appendChild(drop);
    while (this.xpFeed.childElementCount > XP_DROP_LIMIT) this.xpFeed.firstElementChild?.remove();
    this.after(XP_DROP_MS, () => drop.remove());
  }

  // ---------------------------------------------------------------- compass

  private buildCompassTicks(): void {
    for (const cardinal of CARDINALS) {
      const tick = document.createElement("span");
      tick.className = cardinal.label.length === 1 ? "compass__tick compass__tick--major" : "compass__tick";
      tick.dataset["bearing"] = String(cardinal.bearing);
      tick.textContent = cardinal.label;
      this.compassTape.appendChild(tick);
    }
    const needle = document.createElement("span");
    needle.className = "compass__needle";
    this.compass.appendChild(needle);
  }

  /**
   * A tape, not a dial: cardinal letters slide across a strip, north included, and the nearest
   * known location gets its own pip plus a readout of name, distance, and bearing.
   */
  private updateCompass(position: Vec3): void {
    const headingDeg = radToDeg(this.options.getHeadingRad?.() ?? 0);
    const nearest = this.nearestLandmark();

    const bearingToTarget = nearest ? bearingDeg(position, nearest.position) : null;
    const signature = [
      Math.round(headingDeg / 2),
      nearest?.id ?? "-",
      nearest ? Math.round(nearest.distance) : "-",
      bearingToTarget === null ? "-" : Math.round(bearingToTarget / 2),
    ].join(":");
    if (signature === this.compassSig) return;
    this.compassSig = signature;

    for (const tick of this.compassTape.querySelectorAll<HTMLElement>(".compass__tick")) {
      const bearing = Number(tick.dataset["bearing"] ?? "0");
      this.placeOnTape(tick, relativeDeg(bearing, headingDeg));
    }

    let pip = this.compassTape.querySelector<HTMLElement>(".compass__pip");
    if (nearest && bearingToTarget !== null) {
      if (!pip) {
        pip = document.createElement("span");
        pip.className = "compass__pip";
        this.compassTape.appendChild(pip);
      }
      this.placeOnTape(pip, relativeDeg(bearingToTarget, headingDeg));
      this.compassTarget.textContent =
        `${nearest.name} · ${Math.round(nearest.distance)} m ${cardinalFor(bearingToTarget)}`;
      this.compass.setAttribute(
        "aria-label",
        `Compass. Facing ${cardinalFor(headingDeg)}. ${nearest.name} is ${Math.round(nearest.distance)} metres ${cardinalFor(bearingToTarget)}.`,
      );
    } else {
      pip?.remove();
      this.compassTarget.textContent = "No known location nearby";
      this.compass.setAttribute("aria-label", `Compass. Facing ${cardinalFor(headingDeg)}.`);
    }
  }

  private placeOnTape(node: HTMLElement, relative: number): void {
    if (Math.abs(relative) > COMPASS_HALF_SPAN_DEG) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    const percent = 50 + (relative / COMPASS_HALF_SPAN_DEG) * 50;
    node.style.left = `${percent.toFixed(1)}%`;
  }

  private nearestLandmark(): ObservedEntity | null {
    // `observe` returns UNAVAILABLE-equivalent (an empty list) until the entity system is up.
    const seen = this.ctx.api.observe({ scope: "known", radius: 140, limit: 60 });
    let best: ObservedEntity | null = null;
    for (const entity of seen) {
      if (!LANDMARK_ARCHETYPES.has(entity.archetype)) continue;
      if (!best || entity.distance < best.distance) best = entity;
    }
    return best;
  }

  // ----------------------------------------------------------------- events

  /**
   * A cursor read, not a long poll: the HUD is already on a 250 ms cadence and a pending promise
   * across a reset would be another lifecycle to manage for no gain.
   */
  private pollEvents(): void {
    if (this.eventPollInFlight) return;
    this.eventPollInFlight = true;
    void this.ctx.api.events(this.eventCursor).then((batch) => {
      this.eventPollInFlight = false;
      this.eventCursor = batch.nextSeq;
      for (const event of batch.events) this.handleEvent(event);
    }, () => {
      this.eventPollInFlight = false;
    });
  }

  private handleEvent(event: GameEvent): void {
    const described = this.describeEvent(event);
    if (described) this.pushNotice(described.text, described.tone);

    if (event.type === "activity.started") {
      const kind = typeof event.data["kind"] === "string" ? event.data["kind"] : null;
      const interaction = typeof event.data["interaction"] === "string" ? event.data["interaction"] : null;
      this.detectAutoOpen(kind ?? interaction);
    }
  }

  /** Bank and shop windows are opened by the world, which has no reference to the UI. */
  private detectAutoOpen(kind: string | null): void {
    if (kind === this.lastActivityKind) return;
    this.lastActivityKind = kind;
    if (!kind) return;
    const lowered = kind.toLowerCase();
    if (lowered.includes("bank")) this.pendingOpen = "bank";
    else if (lowered.includes("shop") || lowered.includes("trade")) this.pendingOpen = "shop";
  }

  private describeEvent(event: GameEvent): { text: string; tone: NoticeTone } | null {
    const data = event.data;
    switch (event.type) {
      case "level.gained": {
        const skill = typeof data["skill"] === "string" ? data["skill"] : null;
        const level = typeof data["level"] === "number" ? data["level"] : null;
        const name = skill && isSkillId(skill) ? SKILLS[skill].name : skill ?? "A skill";
        return { text: level ? `${name} level ${level}.` : `${name} levelled up.`, tone: "success" };
      }
      case "inventory.full":
        return { text: "Your inventory is full.", tone: "error" };
      case "resource.depleted":
        return { text: `${this.entityName(event) ?? "That node"} is depleted.`, tone: "info" };
      case "health.low":
        return { text: "Your health is low.", tone: "error" };
      case "player.died":
        return { text: "You have died.", tone: "error" };
      case "production.completed": {
        const item = typeof data["itemId"] === "string" ? data["itemId"] : null;
        const quantity = typeof data["quantity"] === "number" ? data["quantity"] : 1;
        return item
          ? { text: `Made ${quantity} × ${item.replace(/_/g, " ")}.`, tone: "success" }
          : { text: "Production finished.", tone: "success" };
      }
      case "quest.updated": {
        const objective = typeof data["objective"] === "string" ? data["objective"] : null;
        const name = typeof data["name"] === "string" ? data["name"] : "Quest";
        return { text: objective ? `${name}: ${objective}` : `${name} updated.`, tone: "info" };
      }
      case "entity.discovered": {
        const name = this.entityName(event);
        return name ? { text: `Discovered ${name}.`, tone: "info" } : null;
      }
      case "navigation.failed":
        return { text: "There is no route to that place.", tone: "error" };
      default:
        return null;
    }
  }

  private entityName(event: GameEvent): string | null {
    if (typeof event.data["name"] === "string") return event.data["name"];
    if (!event.entityId) return null;
    const inspected = this.ctx.api.inspect(event.entityId);
    return inspected.ok ? inspected.value.name : null;
  }

  private after(delayMs: number, action: () => void): void {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      action();
    }, delayMs);
    this.timers.add(timer);
  }
}

function isSkillId(value: string): value is SkillId {
  return (SKILL_IDS as readonly string[]).includes(value);
}

function titleCase(text: string): string {
  return text.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** 0 is +Z (north), 90 is +X (east). Matches the world's Y-up, +Z-forward convention. */
function bearingDeg(from: Vec3, to: Vec3): number {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  return normaliseDeg(radToDeg(Math.atan2(dx, dz)));
}

function normaliseDeg(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Signed difference in [-180, 180], for placing a marker on the tape. */
function relativeDeg(bearing: number, heading: number): number {
  const delta = normaliseDeg(bearing - heading);
  return delta > 180 ? delta - 360 : delta;
}

function cardinalFor(bearing: number): string {
  const index = Math.round(normaliseDeg(bearing) / 45) % 8;
  return CARDINALS[index]?.label ?? "N";
}
