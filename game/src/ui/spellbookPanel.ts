/**
 * The spellbook: sixteen spells as four element columns crossed with four rungs.
 *
 * Before this panel the only way to cast was the context menu's "Cast at" (`ui/contextMenu.ts:107`),
 * which throws `SpellbookView.activeSpellId` — and with no standing choice that is "the strongest
 * spell you can currently afford". Sixteen spells picked by an invisible rule is one spell with a
 * changing name, which is the exact failure `state/store.ts:88` calls out. So this panel has two
 * jobs, and the second is the important one: let the player choose, and TELL them what is being
 * chosen for them when they have not.
 *
 * WHY ROWS ARE RUNGS AND COLUMNS ARE ELEMENTS. The ladder is a 4x4: every element owns exactly one
 * spell per rung, so sorting an element's four spells by required level and sorting them by rung
 * give the same order (wind reads 10/17/41/62, fire 1/35/59/70). That makes a real grid rather than
 * four independent lists, and it means the DOM can be row-major — which is what lets
 * `installRovingGrid(grid, 4)` work unmodified: ArrowRight crosses elements, ArrowDown climbs the
 * ladder. Sixteen separate tab stops would have made the keyboard route unusable, and a
 * column-major DOM would have inverted both arrows.
 *
 * WHY THE CELLS ARE BUILT ONCE. `createUi`'s panel tick is 220 ms (`PANEL_INTERVAL_MS`), so an open
 * panel refreshes about four and a half times a second. Rebuilding sixteen buttons, four column
 * heads and a banner at that rate is a relayout of the whole centre window for data that changes
 * on a level-up or a shard spend. The skeleton is therefore built in the constructor from
 * `getSpellbook()` — the spell SET never changes at runtime, only its numbers — and `refresh`
 * diffs a signature string and writes text into the existing nodes, the same way `skillsPanel.ts`
 * does. `getSpellbook()` itself still runs (it is the only legal read), but the DOM work, which is
 * the expensive half, does not.
 *
 * NO ARITHMETIC HERE. `maxHit` arrives already resolved against worn gear, and `activeSpellId`
 * already applies the "preferred if castable, else strongest castable" rule. Recomputing either in
 * the UI is how a panel starts disagreeing with the combat system it is describing; the whole point
 * of `SpellbookView` is that a human and an agent read one answer.
 */
import type { SpellElement, SpellId, SpellRow, SpellRung, SpellbookView } from "../contracts.js";
import { SPELL_ELEMENTS, SPELL_RUNGS } from "../contracts.js";
import { ELEMENT_COLOURS } from "../render/spellVfx.js";
import { createItemIcon } from "./itemIcons.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame, formatQuantity, installRovingGrid, itemDef, itemName, report } from "./panels.js";

const ELEMENT_LABELS: Readonly<Record<SpellElement, string>> = {
  wind: "Wind",
  water: "Water",
  earth: "Earth",
  fire: "Fire",
};

/**
 * Three words under each column head, taken from what the element actually is in this world rather
 * than from a generic elements table: `contracts.ts` fixes wind as "gale and charge" (which is why
 * Voltrend, a cracked garnet, is wind and not a fifth element), and `content/spells.ts` writes
 * earth as driven stone and water as rime and flood.
 */
const ELEMENT_BLURBS: Readonly<Record<SpellElement, string>> = {
  wind: "Gale and charge",
  water: "Rime and flood",
  earth: "Driven stone",
  fire: "Ember and roar",
};

const RUNG_LABELS: Readonly<Record<SpellRung, string>> = {
  lash: "Lash",
  bolt: "Bolt",
  burst: "Burst",
  surge: "Surge",
};

/**
 * The sixteen cells are ICONS, not name plates.
 *
 * A 4x4 grid of names and stat lines is a spreadsheet: every cell reads the same shape, so picking
 * one means reading sixteen strings, and the grid's own axes — element across, rung down — carry no
 * meaning the eye can use. Drawn instead, the axes do the work. Colour is the element (and it is the
 * SAME colour the effect throws, straight out of `ELEMENT_COLOURS`), and the glyph is the rung, so
 * "the big fire one" is findable without reading a word. Every number a player needs to compare two
 * spells is still one hover away in the tooltip, which was already written and is unchanged.
 *
 * The glyphs escalate the way the spells do — spec section 6, "low level attacks are smaller and
 * simpler". A lash is one dart. A bolt is a longer dart with a tail. A burst is a four-point star.
 * A surge is a filled wave under an arc. That is the same ladder `render/spellVfx.ts` draws in the
 * world, so the icon a player picks and the thing that leaves their staff agree.
 *
 * Inline SVG rather than an icon font or a sprite sheet, matching `ui/minimap.ts`'s map button:
 * no asset fetch, no manifest entry, and `currentColor` plus the two CSS custom properties let one
 * markup string serve all four elements.
 */
const RUNG_GLYPHS: Readonly<Record<SpellRung, string>> = {
  // One dart. Deliberately the smallest mark in the set — a lash is the cheap thing.
  lash:
    '<path d="M16 10 L19 16 L16 22 L13 16 Z" fill="var(--spell-core)" stroke="var(--spell-edge)"'
    + ' stroke-width="1.4" stroke-linejoin="round"/>',
  // A longer head, and a tail behind it: the first rung that visibly travels.
  bolt:
    '<path d="M3 16 L13 14.4 L13 17.6 Z" fill="var(--spell-edge)" opacity="0.9"/>'
    + '<path d="M22 7 L28 16 L22 25 L13 16 Z" fill="var(--spell-core)" stroke="var(--spell-edge)"'
    + ' stroke-width="1.4" stroke-linejoin="round"/>',
  // Four points and a core: it arrives and opens.
  burst:
    '<path d="M16 3 L19 13 L29 16 L19 19 L16 29 L13 19 L3 16 L13 13 Z" fill="var(--spell-core)"'
    + ' stroke="var(--spell-edge)" stroke-width="1.3" stroke-linejoin="round"/>'
    + '<circle cx="16" cy="16" r="3" fill="var(--spell-edge)" opacity="0.55"/>',
  // A front, not a projectile: a filled wave with an arc thrown over it.
  surge:
    '<path d="M3 12 Q9 6 16 11 Q23 16 29 10" fill="none" stroke="var(--spell-edge)"'
    + ' stroke-width="2" stroke-linecap="round" opacity="0.75"/>'
    + '<path d="M3 22 Q9 15 16 20 Q23 25 29 18 L29 27 Q23 29 16 27 Q9 25 3 27 Z"'
    + ' fill="var(--spell-core)" stroke="var(--spell-edge)" stroke-width="1.3"'
    + ' stroke-linejoin="round"/>',
};

/** A padlock, drawn once and reused. Marks a cell the player has not levelled into yet. */
const LOCK_GLYPH =
  '<svg class="spellbook__lock" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"'
  + ' fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">'
  + '<rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor" stroke="none"/>'
  + '<path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>';

/** `0xe0621f` as `#e0621f`. The swatches must be the tint the VFX layer actually draws. */
function cssHex(colour: number): string {
  return `#${(colour >>> 0).toString(16).padStart(6, "0")}`;
}

/**
 * "Essence Shards", built from the item's own name.
 *
 * All sixteen rows cost the same item (spec section 2), so one naive plural is enough. The
 * alternative is a `plural` field on `ItemDef` that nothing else in the game would ever read.
 */
function costPlural(row: SpellRow): string {
  return `${itemName(row.costItemId)}s`;
}

/** Why a spell the player has pointed at will not fire. Only called when `castable` is false. */
function blockedReason(row: SpellRow): string {
  return row.unlocked
    ? `you are carrying no ${costPlural(row)}`
    : `it needs Magic ${row.reqLevel}`;
}

interface SpellCell {
  root: HTMLButtonElement;
  /** The required Magic level, the one number that decides whether the icon is even usable. */
  req: HTMLElement;
  /** Padlock, shown only while the level is out of reach. */
  lock: HTMLElement;
}

export class SpellbookPanel implements ManagedPanel {
  readonly frame: PanelFrame;

  private readonly cells = new Map<SpellId, SpellCell>();
  /** The most recent row per spell, so the tooltip provider describes what is true now. */
  private readonly rows = new Map<SpellId, SpellRow>();
  private readonly swatch: HTMLElement;
  private readonly casting: HTMLElement;
  private readonly note: HTMLElement;
  private readonly autoButton: HTMLButtonElement;
  private readonly cost: HTMLElement;
  private readonly costText: HTMLElement;
  /** The cell currently carrying `data-autofocus`, so opening the panel lands on the live spell. */
  private autofocus: HTMLElement | null = null;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "spellbook",
      title: "Spellbook",
      // "b" for book. Checked against every other claim on a letter first: i, k, e, j, m and h are
      // taken by the six docked panels, WASD and the arrows are polled as held movement keys by
      // `KeyboardController`, and Escape, Space, Enter and the digits are the input layer's and the
      // dialogue panel's. Nothing else registers a chord.
      key: "b",
      keyLabel: "Spellbook",
      registry: ctx.registry,
      // 700 px when the cells were name plates; 460 now that they are square icon tiles, which is
      // the width that lands the four fluid columns at about 84 px each — big enough for a 30 px
      // glyph with air around it, small enough that the whole ladder is one glance. Still the
      // centre slot: four columns plus the rung gutter do not fit the 190 px side slot, and
      // `group: "center"` is what makes opening this close the bank or the map rather than stack.
      placement: { top: "56px", left: "50%", width: "460px", maxHeight: "calc(100vh - 112px)" },
      group: "center",
      onOpen: () => this.refresh(true),
    });

    // Read once, up front. The spell SET is content and cannot change while the game runs, so the
    // skeleton below is built from this snapshot and `refresh` only ever rewrites text into it.
    const view = ctx.api.getSpellbook();
    for (const row of view.spells) this.rows.set(row.id, row);

    const body = document.createElement("div");
    body.className = "spellbook";

    // ---- the banner: what is being thrown right now, and whose decision that was

    const status = document.createElement("div");
    status.className = "spellbook__status";

    this.swatch = document.createElement("span");
    this.swatch.className = "spellbook__swatch";
    this.swatch.setAttribute("aria-hidden", "true");

    const statusText = document.createElement("div");
    statusText.className = "spellbook__status-text";

    this.casting = document.createElement("div");
    this.casting.className = "spellbook__casting";

    this.note = document.createElement("p");
    this.note.className = "spellbook__note";

    statusText.append(this.casting, this.note);

    // A second route to the same state a click on the selected cell reaches. The click is the
    // discoverable one; this is the one a player finds when they are looking for it by name,
    // and it is the only place the word "automatic" appears as an action rather than a report.
    this.autoButton = document.createElement("button");
    this.autoButton.type = "button";
    this.autoButton.className = "btn btn--ghost spellbook__auto";
    this.autoButton.textContent = "Automatic";
    this.autoButton.addEventListener("click", () => this.choose(null));

    status.append(this.swatch, statusText, this.autoButton);
    body.appendChild(status);

    // ---- the cost strip, which becomes the shard warning at zero

    this.cost = document.createElement("div");
    this.cost.className = "spellbook__cost";

    // The cost item comes off a row rather than from a literal id: every one of the sixteen rows
    // charges the same thing (spec section 2), so the first row is as authoritative as a constant
    // and it cannot fall out of step with content the way a copied "essence_shard" would.
    const costIcon = createItemIcon(itemDef(view.spells[0]?.costItemId ?? ""));
    costIcon.classList.add("spellbook__cost-icon");

    this.costText = document.createElement("span");
    this.costText.className = "spellbook__cost-text";

    this.cost.append(costIcon, this.costText);
    body.appendChild(this.cost);

    // ---- the grid

    const grid = document.createElement("div");
    grid.className = "spellbook__grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Attack spells by element and rung");

    const corner = document.createElement("span");
    corner.className = "spellbook__corner";
    corner.setAttribute("aria-hidden", "true");
    grid.appendChild(corner);
    for (const element of SPELL_ELEMENTS) grid.appendChild(this.buildHead(element));

    // Row-major, one row per rung. The index handed to each cell is its reading-order position,
    // which is what `installRovingGrid` counts in.
    let index = 0;
    const byCell = new Map<string, SpellRow>();
    for (const row of view.spells) byCell.set(`${row.element}/${row.rung}`, row);

    for (const rung of SPELL_RUNGS) {
      grid.appendChild(this.buildRungLabel(rung));
      for (const element of SPELL_ELEMENTS) {
        grid.appendChild(this.buildCell(element, byCell.get(`${element}/${rung}`), index));
        index += 1;
      }
    }

    installRovingGrid(grid, SPELL_ELEMENTS.length);
    body.appendChild(grid);

    this.frame.body.appendChild(body);
  }

  refresh(force = false): void {
    const view = this.ctx.api.getSpellbook();

    // Everything the panel draws, and nothing it does not: name, element, rung, level requirement,
    // XP and cast time are fixed by content and cannot change while the game is running.
    const signature = [
      view.magicLevel,
      view.shards,
      view.preferredSpellId ?? "-",
      view.activeSpellId ?? "-",
      ...view.spells.map((row) => `${row.id}:${row.maxHit}:${row.unlocked ? 1 : 0}:${row.castable ? 1 : 0}`),
    ].join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;

    for (const row of view.spells) {
      this.rows.set(row.id, row);
      const cell = this.cells.get(row.id);
      if (cell) this.paintCell(cell, row, view);
    }

    this.paintCost(view);
    this.paintStatus(view);

    // The player's own choice takes the focus if they have one, so re-opening the book lands on
    // the row they came to look at rather than on whatever the game picked instead.
    const focusId = view.preferredSpellId ?? view.activeSpellId;
    this.setAutofocus(focusId === null ? null : this.cells.get(focusId)?.root ?? null);

    this.frame.setSubtitle(`Magic ${view.magicLevel} · ${formatQuantity(view.shards)} shards`);
  }

  dispose(): void {
    this.frame.dispose();
  }

  // ------------------------------------------------------------------ building

  private buildHead(element: SpellElement): HTMLElement {
    const head = document.createElement("div");
    head.className = "spellbook__head";

    const line = document.createElement("div");
    line.className = "spellbook__head-line";

    const dot = document.createElement("span");
    dot.className = "spellbook__swatch spellbook__swatch--small";
    dot.setAttribute("aria-hidden", "true");
    applyElementColours(dot, element);

    const name = document.createElement("span");
    name.className = "spellbook__head-name";
    name.textContent = ELEMENT_LABELS[element];

    line.append(dot, name);

    const blurb = document.createElement("span");
    blurb.className = "spellbook__head-blurb";
    blurb.textContent = ELEMENT_BLURBS[element];

    head.append(line, blurb);
    return head;
  }

  private buildRungLabel(rung: SpellRung): HTMLElement {
    const label = document.createElement("span");
    label.className = "spellbook__rung";
    label.textContent = RUNG_LABELS[rung];
    return label;
  }

  /**
   * One spell.
   *
   * `row` is optional and the cell falls back to a dead placeholder because the grid is drawn from
   * the element x rung matrix, not from the list: a content ladder that ever stopped being a full
   * 4x4 would otherwise silently drop a spell out of the reading order and put every later cell in
   * the wrong grid square, which is a worse bug than a visible gap. The placeholder keeps its
   * `data-slot-index` so arrow navigation still counts four to a row.
   */
  private buildCell(element: SpellElement, row: SpellRow | undefined, index: number): HTMLElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "spellbook__cell";
    cell.dataset["slotIndex"] = String(index);
    cell.tabIndex = index === 0 ? 0 : -1;
    applyElementColours(cell, element);

    const glyph = document.createElement("span");
    glyph.className = "spellbook__cell-glyph";
    glyph.setAttribute("aria-hidden", "true");

    const req = document.createElement("span");
    req.className = "spellbook__cell-req u-numeric";

    const lock = document.createElement("span");
    lock.className = "spellbook__cell-lock";
    lock.setAttribute("aria-hidden", "true");
    lock.innerHTML = LOCK_GLYPH;

    cell.append(glyph, req, lock);

    if (!row) {
      // Cannot happen with the shipped table — every element owns exactly one spell per rung, and
      // `tests/spells.test.ts` pins that. Kept because the grid is built from a 4x4 walk rather
      // than from the row list, so a future sixteen-that-is-not-sixteen leaves a legible hole
      // instead of a crash.
      cell.disabled = true;
      cell.classList.add("is-absent");
      cell.setAttribute("aria-label", `No ${element} spell at this rung`);
      return cell;
    }

    const id = row.id;
    // The rung is the glyph and the element is the tint, so this markup is written once and never
    // rewritten: neither axis can change for a given cell.
    glyph.innerHTML =
      `<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">${RUNG_GLYPHS[row.rung]}</svg>`;

    // Read the standing choice back through the API rather than off a captured row, so the toggle
    // is correct even when the choice was changed from an agent tool or another panel since paint.
    cell.addEventListener("click", () => {
      const current = this.ctx.api.getSpellbook().preferredSpellId;
      this.choose(current === id ? null : id);
    });

    this.ctx.tooltip.attach(cell, () => {
      const current = this.rows.get(id);
      if (!current) return null;
      return { kind: "text", title: current.name, lines: this.tooltipLines(current) };
    });

    this.cells.set(id, { root: cell, req, lock });
    return cell;
  }

  private tooltipLines(row: SpellRow): string[] {
    const lines = [row.description];
    lines.push(`${ELEMENT_LABELS[row.element]} · ${RUNG_LABELS[row.rung]} · Magic ${row.reqLevel}`);
    lines.push(
      `Max hit ${formatQuantity(row.maxHit)} · ${formatQuantity(row.baseXp)} base xp`
      + ` · ${(row.castMs / 1000).toFixed(1)}s to cast`,
    );
    lines.push(`Costs ${formatQuantity(row.costQuantity)} ${itemName(row.costItemId)} a cast`);
    if (!row.unlocked) lines.push(`Locked. Train Magic to ${row.reqLevel}.`);
    else if (!row.castable) lines.push(`You have no ${costPlural(row)} left.`);
    return lines;
  }

  // ------------------------------------------------------------------ painting

  private paintCell(cell: SpellCell, row: SpellRow, view: SpellbookView): void {
    const active = view.activeSpellId === row.id;
    const preferred = view.preferredSpellId === row.id;

    cell.root.classList.toggle("is-locked", !row.unlocked);
    cell.root.classList.toggle("is-preferred", preferred);
    cell.root.classList.toggle("is-active", active);
    cell.root.setAttribute("aria-pressed", preferred ? "true" : "false");

    // "Casting" and "Chosen" used to be printed in the cell; they are now the ring (`is-active`)
    // and the corner pip (`is-preferred`) that the stylesheet draws, because two words of state in
    // a 74 px tile was most of what made the grid read as a table. When the two land on different
    // cells — a caster who chose a spell above their level — the banner still explains the gap in
    // words, which is the place a sentence belongs.
    //
    // The level number stays. It is the one fact that decides whether an icon is usable at all, and
    // a padlock alone cannot say how far off it is.
    cell.req.textContent = String(row.reqLevel);
    cell.lock.hidden = row.unlocked;

    const state = active
      ? " Casting this now."
      : preferred
        ? ` Your choice, but ${blockedReason(row)}.`
        : "";
    cell.root.setAttribute(
      "aria-label",
      `${row.name}, ${row.element} ${row.rung}. `
      + `${row.unlocked ? `Magic ${row.reqLevel}` : `Locked, needs Magic ${row.reqLevel}`}. `
      + `Max hit ${formatQuantity(row.maxHit)}.${state}`,
    );
  }

  private paintCost(view: SpellbookView): void {
    const empty = view.shards <= 0;
    this.cost.classList.toggle("is-empty", empty);

    // Warn, never block: an out-of-shards caster still gets to browse and to set a choice for when
    // they have restocked. A spellbook that greys itself out is a spellbook that stops explaining.
    const sample = view.spells[0];
    const unit = sample ? itemName(sample.costItemId) : "Essence Shard";
    this.costText.textContent = empty
      ? `You have no ${unit}s. Every spell costs one, so nothing will fire until you buy or craft more.`
      : `Every cast spends ${formatQuantity(sample?.costQuantity ?? 1)} ${unit}. You carry ${formatQuantity(view.shards)}.`;
  }

  private paintStatus(view: SpellbookView): void {
    const active = view.activeSpellId === null ? undefined : this.rows.get(view.activeSpellId);
    const preferred = view.preferredSpellId === null ? undefined : this.rows.get(view.preferredSpellId);

    // Kept ENABLED while it holds focus. Disabling an element the DOM has focused blurs it and
    // drops focus to <body>, and this repaint is triggered by the button's own click — so pressing
    // "Automatic" with the keyboard silently ended the keyboard route through the open panel.
    // `aria-disabled` states the same thing to a screen reader without moving focus, and the click
    // handler is already idempotent: clearing a choice that is already clear is a no-op.
    const idle = preferred === undefined;
    const focused = document.activeElement === this.autoButton;
    this.autoButton.disabled = idle && !focused;
    this.autoButton.setAttribute("aria-disabled", idle ? "true" : "false");
    this.autoButton.title = preferred === undefined
      ? "The game is already choosing for you"
      : "Hand the choice back to the game";

    if (active) applyElementColours(this.swatch, active.element);
    this.swatch.classList.toggle("is-dead", !active);

    this.casting.textContent = active ? `Casting ${active.name}` : "Nothing will cast";

    if (!active) {
      // Nothing castable at all can only mean an empty pouch — Emberlash unlocks at Magic 1, so
      // level is never the reason every row is out. The strip above already names the item, so
      // this line says what it means for the choice instead of repeating the count.
      this.note.textContent = preferred
        ? `${preferred.name} is your choice. It cannot fire yet: ${blockedReason(preferred)}.`
        : "Nothing you carry can be cast. Pick a spell anyway — it fires as soon as you can pay for it.";
      return;
    }

    if (!preferred) {
      this.note.textContent = "The game is choosing for you: the strongest spell you can cast. "
        + "Click one to fix your choice and stop it changing under you.";
      return;
    }

    this.note.textContent = preferred.id === active.id
      ? "Your choice. Click it again to hand the pick back to the game."
      : `Your choice is ${preferred.name}, but ${blockedReason(preferred)} — this fires instead until then.`;
  }

  // ------------------------------------------------------------------ actions

  private choose(spellId: SpellId | null): void {
    if (!report(this.ctx.api.setPreferredSpell(spellId))) return;
    // Everything else that reads the choice repaints too: the dock badge prints the chosen
    // element, and this panel's own signature only moves because the store did.
    this.ctx.refresh();
  }

  /**
   * `PanelFrame.focusFirst` looks for `[data-autofocus]` and takes the first match, so exactly one
   * cell may carry it at a time.
   */
  private setAutofocus(target: HTMLElement | null): void {
    if (this.autofocus === target) return;
    if (this.autofocus) delete this.autofocus.dataset["autofocus"];
    this.autofocus = target;
    if (target) target.dataset["autofocus"] = "";
  }
}

/**
 * Hands an element's tint to the stylesheet as two custom properties.
 *
 * `ELEMENT_COLOURS` lives in `render/spellVfx.ts` and is imported rather than copied so the dot next
 * to "Fire" is the same orange the impact actually draws. A second table here would drift the first
 * time the VFX worker retunes a tint, and the player would be reading a legend for a spell effect
 * that no longer looks like it. The shape read here is spec section 5's two columns —
 * `Record<SpellElement, { core: number; edge: number }>`, hot centre and outer particles, as 24-bit
 * ints — and the stylesheet builds the orb out of exactly those two stops.
 */
function applyElementColours(target: HTMLElement, element: SpellElement): void {
  const palette = ELEMENT_COLOURS[element];
  target.style.setProperty("--spell-core", cssHex(palette.core));
  target.style.setProperty("--spell-edge", cssHex(palette.edge));
}
