/**
 * Shared panel plumbing, the item-display helpers every panel needs, and the single UI entry point.
 *
 * `createUi(api)` is the ONE thing the root wires at boot. It owns the HUD, the panels, the shared
 * tooltip, and the notice sink; the root only has to mount it, call `update()` once a frame, and
 * dispose it on teardown.
 *
 * Two rules run through this file:
 *
 *  - Everything a panel does goes through `GameApi`, and a failing `Result` is surfaced with its
 *    own `error.message`. Nothing throws at the player, nothing fails silently.
 *  - Nothing repaints on a frame boundary. Panels build a cheap signature of the data they render
 *    and only touch the DOM when it changes, because a 100 ms sim tick leaves no budget for a UI
 *    that relayouts 60 times a second.
 *
 * Composition, not inheritance: panels hold a `PanelFrame` rather than extending one. This module
 * imports the panels and the panels import this module, and a cycle of `class X extends Y` across
 * that boundary would explode at module-evaluation time. Every cross-module reference here is
 * resolved inside a function body instead.
 */
import type {
  EntityId, FeatureLabApi, GameApi, ItemDef, ItemId, ItemStack, QuestId, RegionId, Result,
  SemanticEntity, SkillId, StationKind, Vec3,
} from "../contracts.js";
import { burnChance, content } from "../content/index.js";
import type { RecipeDef } from "../content/index.js";
import { SKILLS } from "../content/skills.js";
import { keybindings } from "../input/keyboard.js";
import type { KeyBindingRegistry, Unregister } from "../input/keyboard.js";
import { ContextMenu, notify, reportResult, setNoticeSink } from "./contextMenu.js";
import type { NoticeTone } from "./contextMenu.js";
import { Tooltip } from "./tooltips.js";
import { createItemIcon } from "./itemIcons.js";
import { Hud } from "./hud.js";
import { DeathScreen, type DeathDetail } from "./deathScreen.js";
import { TitleScreen } from "./titleScreen.js";
import { SettingsPanel } from "./settingsPanel.js";
import { SettingsStore } from "./settings.js";
import { PanelDock } from "./dock.js";
import { QuestTracker } from "./questTracker.js";
import { Minimap } from "./minimap.js";
import {
  LazyPanel,
  loadBankPanel,
  loadControlsPanel,
  loadDialoguePanel,
  loadEquipmentPanel,
  loadFeatureLabPanel,
  loadInventoryPanel,
  loadMapPanel,
  loadQuestPanel,
  loadShopPanel,
  loadSkillGuidePanel,
  loadSkillsPanel,
  loadSpellbookPanel,
  type BankPanelHandle,
  type DialoguePanelHandle,
  type ShopPanelHandle,
  type SkillGuidePanelHandle,
} from "./lazyPanelRegistry.js";

/** The inventory is 28 slots, per PRD section 5. Panels that mirror it use this, never a literal. */
export const INVENTORY_SLOTS = 28;
export const INVENTORY_COLUMNS = 4;

// ------------------------------------------------------------------ formatting

/** Thousands separators up to five digits, then k/m. Tooltips always show the exact number. */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const n = Math.floor(value);
  if (n < 100_000) return n.toLocaleString("en-US");
  if (n < 10_000_000) return `${Math.floor(n / 1000).toLocaleString("en-US")}k`;
  return `${Math.floor(n / 1_000_000).toLocaleString("en-US")}m`;
}

export function formatExact(value: number): string {
  return Math.floor(value).toLocaleString("en-US");
}

/** "iron_ore" becomes "Iron Ore". Only used when content has no def for the id yet. */
export function prettifyId(id: string): string {
  const words = id.split(/[_\-.\s]+/).filter(Boolean);
  if (words.length === 0) return id;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function itemDef(itemId: ItemId): ItemDef | undefined {
  return content.item(itemId);
}

export function itemName(itemId: ItemId): string {
  return content.item(itemId)?.name ?? prettifyId(itemId);
}

export function skillName(skill: SkillId): string {
  return SKILLS[skill].name;
}

export function skillColour(skill: SkillId): string {
  return SKILLS[skill].colour;
}

/** Sell price rule from the frozen ItemDef contract: 60% of value. */
export function itemSellPrice(def: ItemDef | undefined): number {
  return def ? Math.round(def.value * 0.6) : 0;
}

// ------------------------------------------------------------- item glyphs

export function itemGlyphText(itemId: ItemId): string {
  const name = itemName(itemId);
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0] ?? name;
  const second = words[1];
  if (second) return (first.charAt(0) + second.charAt(0)).toUpperCase();
  return first.slice(0, 2).toUpperCase();
}

/** A signature for one slot, used to decide whether a repaint is needed at all. */
export function stackSignature(stack: ItemStack | null | undefined): string {
  return stack ? `${stack.itemId}:${stack.quantity}` : "-";
}

/**
 * Paints one slot button, but only when the stack actually changed, which is why the signature
 * lives on the element itself.
 */
export function paintSlot(cell: HTMLElement, stack: ItemStack | null, emptyLabel?: string): void {
  const signature = `${stackSignature(stack)}|${emptyLabel ?? ""}`;
  if (cell.dataset["sig"] === signature) return;
  cell.dataset["sig"] = signature;
  cell.replaceChildren();

  if (!stack) {
    cell.classList.add("is-empty");
    delete cell.dataset["item"];
    cell.setAttribute("aria-label", emptyLabel ? `${emptyLabel}: empty` : "Empty slot");
    if (emptyLabel) {
      const label = document.createElement("span");
      label.className = "slot__label";
      label.textContent = emptyLabel;
      cell.appendChild(label);
    }
    return;
  }

  cell.classList.remove("is-empty");
  cell.dataset["item"] = stack.itemId;

  const glyph = document.createElement("span");
  glyph.className = "slot__glyph";
  glyph.appendChild(createItemIcon(itemDef(stack.itemId)));
  cell.appendChild(glyph);

  if (stack.quantity > 1) {
    const count = document.createElement("span");
    count.className = "slot__count";
    count.textContent = formatQuantity(stack.quantity);
    cell.appendChild(count);
  }

  cell.setAttribute(
    "aria-label",
    stack.quantity > 1
      ? `${itemName(stack.itemId)}, ${formatExact(stack.quantity)}`
      : itemName(stack.itemId),
  );
}

// ---------------------------------------------------------------- the frame

export interface PanelPlacement {
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  width?: string;
  maxHeight?: string;
}

export interface PanelFrameOptions {
  id: string;
  title: string;
  placement: PanelPlacement;
  registry?: KeyBindingRegistry;
  /** Chord that toggles the panel, e.g. "i". Omit for panels opened by world interaction. */
  key?: string;
  /** Shown in a controls list. Defaults to "Toggle <title>". */
  keyLabel?: string;
  /**
   * Panels in the same group share one screen slot: opening one closes the others. This is the
   * no-overlap rule — "side" is the tab slot above the dock, "center" is the one large window.
   * The group name is also added as a `panel--<group>` class so the stylesheet can shape the slot.
   */
  group?: string;
  /** Draggable by its header. The first drag converts the placement to explicit left/top. */
  movable?: boolean;
  onOpen?(): void;
  onClose?(): void;
}

/** Matches `--z-panel` in styles.css. A raised panel stays inside the band above it. */
const PANEL_Z_BASE = 20;

/** How far a raise may climb before it wraps. Keeps panels below `--z-menu` at 30. */
const PANEL_STACK_DEPTH = 9;

let panelZCounter = 0;

/** Frames by group, so open() can vacate a shared slot. Module-level: frames register on
 * construction and leave on dispose, and the map never outlives the page. */
const panelGroups = new Map<string, Set<PanelFrame>>();

/**
 * One panel chrome: header, close button, body, key binding, Escape handling, focus restore.
 *
 * Escape goes through `pushEscapeHandler` so the input layer's cancel binding sees it last — the
 * PRD rule is "close the top panel, otherwise cancel the activity", and the escape stack is what
 * makes "top" mean the most recently opened panel.
 */
export class PanelFrame {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly registry: KeyBindingRegistry;
  private readonly disposers: Unregister[] = [];
  private popEscape: Unregister | null = null;
  private restoreFocus: HTMLElement | null = null;
  private opened = false;

  constructor(private readonly options: PanelFrameOptions) {
    this.registry = options.registry ?? keybindings;

    const root = document.createElement("section");
    root.className = "panel panel--float";
    if (options.group) {
      root.classList.add(`panel--${options.group}`);
      let peers = panelGroups.get(options.group);
      if (!peers) {
        peers = new Set();
        panelGroups.set(options.group, peers);
      }
      peers.add(this);
    }
    root.id = `panel-${options.id}`;
    root.hidden = true;
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", options.title);
    const place = options.placement;
    if (place.top !== undefined) root.style.top = place.top;
    if (place.left !== undefined) root.style.left = place.left;
    if (place.right !== undefined) root.style.right = place.right;
    if (place.bottom !== undefined) root.style.bottom = place.bottom;
    if (place.width !== undefined) root.style.width = place.width;
    // Only when a panel asks for one. Writing the default inline made it beat every stylesheet
    // rule, including the `@media (max-height: 800px)` block in styles.css that exists to shrink
    // panels on a short screen — which had therefore never done anything since it was written.
    // The default now lives on `.panel--float`, where a media query can reach it.
    if (place.maxHeight !== undefined) root.style.maxHeight = place.maxHeight;

    const header = document.createElement("header");
    header.className = "panel__header";

    const titles = document.createElement("div");
    titles.className = "panel__titles";
    const title = document.createElement("h2");
    title.className = "panel__title";
    title.textContent = options.title;
    const subtitle = document.createElement("div");
    subtitle.className = "panel__subtitle";
    titles.append(title, subtitle);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "panel__close";
    close.setAttribute("aria-label", `Close ${options.title}`);
    close.textContent = "×";
    close.addEventListener("click", () => this.close());

    header.append(titles, close);

    /*
     * Drag-to-move, on the header only. The placement may be anchored any way (right/bottom, or
     * left:50% + a stylesheet transform); the first drag converts it to explicit left/top and
     * kills the transform, because mixing a centring transform with a dragged position doubles
     * every movement. Listeners on window exist only for the duration of a drag.
     */
    if (options.movable) {
      root.classList.add("panel--movable");
      header.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest("button")) return;
        const rect = root.getBoundingClientRect();
        const grabX = event.clientX - rect.left;
        const grabY = event.clientY - rect.top;
        const onMove = (move: PointerEvent) => {
          const left = Math.min(Math.max(move.clientX - grabX, 0), Math.max(0, window.innerWidth - rect.width));
          const top = Math.min(Math.max(move.clientY - grabY, 0), Math.max(0, window.innerHeight - 32));
          root.classList.add("is-moved");
          root.style.left = `${Math.round(left)}px`;
          root.style.top = `${Math.round(top)}px`;
          root.style.right = "auto";
          root.style.bottom = "auto";
          root.style.transform = "none";
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        event.preventDefault();
      });
    }

    const body = document.createElement("div");
    body.className = "panel__body";

    root.append(header, body);

    this.root = root;
    this.body = body;
    this.subtitleEl = subtitle;

    if (options.key) {
      this.disposers.push(this.registry.register({
        id: `panel.${options.id}`,
        keys: [options.key],
        label: options.keyLabel ?? `Toggle ${options.title}`,
        group: "Panels",
        onDown: () => {
          this.toggle();
          return true;
        },
      }));
    }
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  isOpen(): boolean {
    return this.opened;
  }

  setSubtitle(text: string): void {
    if (this.subtitleEl.textContent !== text) this.subtitleEl.textContent = text;
  }

  open(): void {
    if (this.opened) {
      this.raise();
      return;
    }
    // One slot per group. The sibling closes BEFORE this opens so focus restore and the escape
    // stack see a plain close-then-open, never two panels fighting over the same pixels.
    if (this.options.group) {
      for (const peer of panelGroups.get(this.options.group) ?? []) {
        if (peer !== this) peer.close();
      }
    }
    this.opened = true;
    this.root.hidden = false;
    this.raise();
    this.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.popEscape = this.registry.pushEscapeHandler(() => {
      if (!this.opened) return false;
      this.close();
      return true;
    });
    this.options.onOpen?.();
    this.focusFirst();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.hidden = true;
    this.popEscape?.();
    this.popEscape = null;
    this.options.onClose?.();

    // Focus goes back where it came from, or the next keystroke lands on a hidden element.
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore && restore.isConnected && !this.root.contains(restore)) {
      restore.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /**
   * Brings this panel above the others without reordering the DOM.
   *
   * The counter is clamped. Unbounded, it climbed past every layer in the stylesheet — the context
   * menu at 30, the tooltip at 40, the boot screen and the pause menu at 50 — so after enough panel
   * opens an ordinary panel would cover the menu that opened it. That is not hypothetical: the
   * settings panel is opened FROM the pause screen and drew underneath it, and the only fix
   * available from a stylesheet was `!important`, because an inline style outranks a rule.
   *
   * Nine steps of ordering is more than any real stack of panels needs, and it keeps every raise
   * inside the band the tokens reserve for panels.
   */
  raise(): void {
    panelZCounter = (panelZCounter + 1) % PANEL_STACK_DEPTH;
    this.root.style.zIndex = String(PANEL_Z_BASE + panelZCounter);
  }

  focusFirst(): void {
    const target = this.body.querySelector<HTMLElement>("[data-autofocus]")
      ?? this.body.querySelector<HTMLElement>("button:not([disabled]), input, select, [tabindex='0']");
    (target ?? this.root).focus({ preventScroll: true });
  }

  dispose(): void {
    this.close();
    if (this.options.group) panelGroups.get(this.options.group)?.delete(this);
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.root.remove();
  }
}

/**
 * Roving-tabindex arrow navigation over a slot grid. 28 tab stops in the inventory would make the
 * keyboard route unusable, so the grid is one tab stop and the arrows move inside it.
 */
export function installRovingGrid(container: HTMLElement, columns: number): void {
  const cells = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>("[data-slot-index]")];

  container.addEventListener("keydown", (event) => {
    const list = cells();
    const active = document.activeElement;
    const index = list.findIndex((cell) => cell === active);
    if (index < 0) return;

    let next = index;
    switch (event.key) {
      case "ArrowRight": next = index + 1; break;
      case "ArrowLeft": next = index - 1; break;
      case "ArrowDown": next = index + columns; break;
      case "ArrowUp": next = index - columns; break;
      case "Home": next = 0; break;
      case "End": next = list.length - 1; break;
      default: return;
    }

    // The grid owns this key from here, whether or not the move lands.
    //
    // `KeyboardController` listens on `window` and treats the arrows as movement, and a slot is a
    // <button>, which `isTextEntry` deliberately does not count as text entry — so arrow-navigating
    // your pack also walked you across the map, about four metres a second. Stopping propagation is
    // what keeps the two apart, and it has to happen BEFORE the bounds check below: an arrow at the
    // edge of the grid moves nothing, and used to leak to the world for exactly that reason.
    event.preventDefault();
    event.stopPropagation();

    if (next < 0 || next >= list.length) return;
    const target = list[next];
    if (!target) return;
    for (const cell of list) cell.tabIndex = cell === target ? 0 : -1;
    target.focus({ preventScroll: true });
  });

  container.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset["slotIndex"] === undefined) return;
    for (const cell of cells()) cell.tabIndex = cell === target ? 0 : -1;
  });
}

export type QuantityMode = "1" | "10" | "all" | "custom";

/** A labelled row of quantity choices: 1 / 10 / All / custom. Shared by the bank and the shop. */
export class QuantitySelector {
  readonly root: HTMLElement;
  private mode: QuantityMode = "1";
  private readonly input: HTMLInputElement;
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(label: string, private readonly onChange?: () => void) {
    const root = document.createElement("div");
    root.className = "qty";

    const caption = document.createElement("span");
    caption.className = "u-caps u-dim";
    caption.textContent = label;
    root.appendChild(caption);

    const group = document.createElement("div");
    group.className = "qty__group";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", label);

    const modes: QuantityMode[] = ["1", "10", "all", "custom"];
    for (const mode of modes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost qty__btn";
      button.textContent = mode === "all" ? "All" : mode === "custom" ? "X" : mode;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", mode === this.mode ? "true" : "false");
      button.addEventListener("click", () => this.setMode(mode));
      this.buttons.push(button);
      group.appendChild(button);
    }
    root.appendChild(group);

    const input = document.createElement("input");
    input.type = "number";
    input.className = "field field--qty";
    input.min = "1";
    input.value = "100";
    input.hidden = true;
    input.setAttribute("aria-label", `${label}: custom amount`);
    input.addEventListener("change", () => this.onChange?.());
    root.appendChild(input);

    this.root = root;
    this.input = input;
    this.syncButtons();
  }

  setMode(mode: QuantityMode): void {
    this.mode = mode;
    this.syncButtons();
    if (mode === "custom") this.input.focus();
    this.onChange?.();
  }

  /** `available` is the stack size the player could act on, used for "All". */
  resolve(available: number): number {
    switch (this.mode) {
      case "1": return 1;
      case "10": return Math.max(1, Math.min(10, available));
      case "all": return Math.max(1, available);
      case "custom": {
        const parsed = Number.parseInt(this.input.value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
      }
      default: return 1;
    }
  }

  private syncButtons(): void {
    const modes: QuantityMode[] = ["1", "10", "all", "custom"];
    this.buttons.forEach((button, index) => {
      const on = modes[index] === this.mode;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
    });
    this.input.hidden = this.mode !== "custom";
  }
}

/** A short "this system is not online yet" body. Used wherever the API answers UNAVAILABLE. */
export function emptyState(message: string): HTMLElement {
  const node = document.createElement("p");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

/** The one place a panel unwraps a Result for a human. Shows `error.message`, never throws. */
export function report<T>(result: Result<T>): boolean {
  return reportResult(result);
}

// -------------------------------------------------------------- the context

/** Read-only access to the same terrain and road geometry used by the playable world. */
export interface MapTerrainSource {
  readonly bounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  sample(x: number, z: number): Readonly<{ height: number; normal: Vec3; regionId: RegionId }>;
  roadPolylines(): Vec3[][];
}

/** What each panel is handed. Everything shared, nothing global. */
export interface UiContext {
  readonly api: GameApi;
  readonly tooltip: Tooltip;
  readonly menu: ContextMenu;
  readonly registry: KeyBindingRegistry;
  /** Lightweight source for the real terrain-backed map; absent only in isolated UI tests. */
  readonly mapTerrain?: MapTerrainSource;
  /** True while a bank window is open, so the inventory can offer Deposit. */
  isBankOpen(): boolean;
  /** True while a shop window is open, so the inventory can offer Sell. */
  isShopOpen(): boolean;
  deposit(itemId: ItemId, quantity: number): void;
  sell(itemId: ItemId, quantity: number): void;
  /** Pin a quest to the floating tracker card, or null to unpin. */
  pinQuest(questId: QuestId | null): void;
  /** The quest currently pinned to the tracker, or null. */
  pinnedQuestId(): QuestId | null;
  /** Repaint every open panel now. Called after any mutation so the player sees the result. */
  refresh(): void;
}

/** The lifecycle used by both a concrete `PanelFrame` and a deferred panel proxy. */
export interface PanelHandle {
  mount(parent: HTMLElement): void;
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  dispose(): void;
}

/** Every panel this module manages looks like this. */
export interface ManagedPanel {
  readonly frame: PanelHandle;
  refresh(force?: boolean): void;
  dispose(): void;
}

// -------------------------------------------------------------- production

/**
 * Recipe selection for one inspected station.
 *
 * Content owns the rows and `GameApi.produce` owns every rule. This panel only mirrors level,
 * ingredient, station, and cooking-burn information so choosing a batch does not require a blind
 * API call. A portable fire is an ordinary `station.kind === "campfire"` here.
 */
class ProductionPanel implements ManagedPanel {
  readonly frame: PanelFrame;

  private readonly quantity: QuantitySelector;
  private readonly stationLine: HTMLElement;
  private readonly fireLine: HTMLElement;
  private readonly list: HTMLElement;
  private stationId: EntityId | null = null;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "production",
      title: "Production",
      registry: ctx.registry,
      placement: { top: "64px", left: "calc(50% - 240px)", width: "480px" },
      group: "center",
      onOpen: () => this.refresh(true),
    });

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar production-toolbar";
    this.quantity = new QuantitySelector("Batch", () => this.refresh(true));
    toolbar.appendChild(this.quantity.root);

    const station = document.createElement("div");
    station.className = "production-station";
    this.stationLine = document.createElement("div");
    this.stationLine.className = "production-station__name";
    this.fireLine = document.createElement("div");
    this.fireLine.className = "production-station__fire u-dim";
    this.fireLine.hidden = true;
    station.append(this.stationLine, this.fireLine);

    this.list = document.createElement("div");
    this.list.className = "production-list";
    this.list.setAttribute("role", "list");

    this.frame.body.append(toolbar, station, this.list);
  }

  openFor(entityId: EntityId): void {
    const inspected = this.ctx.api.inspect(entityId);
    if (!inspected.ok) {
      report(inspected);
      return;
    }
    if (!inspected.value.station) {
      notify(`${inspected.value.name} is not a production station.`, "error");
      return;
    }

    this.stationId = entityId;
    this.signature = "";
    this.frame.setSubtitle(inspected.value.name);
    this.frame.open();
    this.refresh(true);
  }

  refresh(force = false): void {
    if (!this.stationId) return;
    const inspected = this.ctx.api.inspect(this.stationId);
    if (!inspected.ok) {
      const message = inspected.error.message;
      if (force || this.signature !== `missing:${message}`) {
        this.signature = `missing:${message}`;
        this.stationLine.textContent = message;
        this.fireLine.hidden = true;
        this.list.replaceChildren(emptyState(message));
      }
      return;
    }

    const entity = inspected.value;
    const station = entity.station;
    if (!station) {
      const message = "This station is no longer available.";
      if (force || this.signature !== `missing:${message}`) {
        this.signature = `missing:${message}`;
        this.stationLine.textContent = message;
        this.fireLine.hidden = true;
        this.list.replaceChildren(emptyState(message));
      }
      return;
    }
    const recipes = this.recipesFor(station.kind, station.skill, station.recipeIds);
    const inventory = this.ctx.api.getInventory();
    const skills = this.ctx.api.getSkills();
    const activity = this.ctx.api.getActivity();
    const selectedRemainingMs = campfireRemainingMs(entity, this.ctx.api);
    const nearbyFire = station.kind === "campfire" ? null : this.nearbyCampfire();
    const nearbyRemainingMs = nearbyFire ? campfireRemainingMs(nearbyFire, this.ctx.api) : null;
    const remainingToken = selectedRemainingMs === null ? "-" : Math.ceil(selectedRemainingMs / 1_000);
    const nearbyToken = nearbyRemainingMs === null ? "-" : Math.ceil(nearbyRemainingMs / 1_000);
    const signature = [
      entity.id, entity.state, station.kind, station.skill,
      ...inventory.slots.map(stackSignature),
      ...recipes.map((recipe) => `${recipe.id}:${skills[recipe.skill]?.level ?? 1}`),
      activity ? `${activity.kind}:${activity.recipeId ?? "-"}:${activity.completed}:${activity.remaining}` : "idle",
      remainingToken, nearbyFire?.id ?? "-", nearbyToken,
    ].join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.frame.setSubtitle(entity.name);
    this.stationLine.textContent = `${stationLabel(station.kind)} · ${skillName(station.skill)}`;
    this.paintFireLine(entity, selectedRemainingMs, nearbyFire, nearbyRemainingMs);

    if (recipes.length === 0) {
      this.list.replaceChildren(emptyState("This station has no compatible recipes."));
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const recipe of recipes) {
      fragment.appendChild(this.recipeRow(recipe, inventory.slots, skills[recipe.skill]?.level ?? 1, activity));
    }
    this.list.replaceChildren(fragment);
  }

  dispose(): void {
    this.frame.dispose();
  }

  private recipesFor(kind: StationKind, skill: SkillId, listedIds: readonly string[]): RecipeDef[] {
    const candidates = listedIds.length > 0
      ? listedIds.map((id) => content.recipe(id)).filter(isRecipeDef)
      : content.recipesForSkill(skill);
    return candidates
      .filter((recipe) => recipe.stations === null || recipe.stations.includes(kind))
      .sort((a, b) => a.reqLevel - b.reqLevel || a.name.localeCompare(b.name));
  }

  private recipeRow(
    recipe: RecipeDef,
    slots: readonly (ItemStack | null)[],
    level: number,
    activity: ReturnType<GameApi["getActivity"]>,
  ): HTMLElement {
    const max = maxRecipeBatches(recipe, slots);
    const requested = this.quantity.resolve(max);
    const levelMet = level >= recipe.reqLevel;
    const ingredientsMet = requested <= max;
    const busy = activity !== null;
    const enabled = levelMet && ingredientsMet && !busy;
    const blockedReason = !levelMet
      ? `Requires ${skillName(recipe.skill)} ${recipe.reqLevel}`
      : !ingredientsMet
        ? `Need ingredients for ${requested}`
        : busy
          ? "Finish or stop the current activity first"
          : null;

    const root = document.createElement("article");
    root.className = "production-row";
    root.setAttribute("role", "listitem");
    if (!enabled) root.classList.add("is-blocked");

    const glyph = document.createElement("span");
    glyph.className = "slot__glyph production-row__glyph";
    glyph.appendChild(createItemIcon(itemDef(recipe.output.itemId)));

    const text = document.createElement("div");
    text.className = "production-row__text";
    const name = document.createElement("div");
    name.className = "production-row__name";
    name.textContent = recipe.name;
    const ingredients = document.createElement("div");
    ingredients.className = "production-row__ingredients";
    ingredients.textContent = recipe.inputs
      .map((input) => `${input.quantity} ${itemName(input.itemId)}`)
      .join(" + ");
    const details = document.createElement("div");
    details.className = "production-row__details u-dim";
    const detailParts = [
      `${skillName(recipe.skill)} ${recipe.reqLevel}`,
      recipe.stations === null ? "No station required" : `At ${formatStations(recipe.stations)}`,
      `${formatDuration(recipe.durationMs)} each`,
      `${formatQuantity(recipe.xp)} xp`,
    ];
    if (recipe.kind === "cook") {
      detailParts.push(`${Math.round(burnChance(level, recipe.reqLevel) * 100)}% burn`);
    }
    details.textContent = detailParts.join(" · ");
    const batch = document.createElement("div");
    batch.className = "production-row__batch u-dim";
    batch.textContent = `Batch ${requested} · ${max} possible${blockedReason ? ` · ${blockedReason}` : ""}`;
    text.append(name, ingredients, details, batch);

    const make = document.createElement("button");
    make.type = "button";
    make.className = "btn btn--primary production-row__action";
    make.textContent = recipe.kind === "cook" ? "Cook" : "Make";
    make.disabled = !enabled;
    if (blockedReason) make.title = blockedReason;
    make.addEventListener("click", () => {
      if (!this.stationId) return;
      const result = this.ctx.api.produceAt(
        this.stationId,
        recipe.id,
        this.quantity.resolve(maxRecipeBatches(recipe, this.ctx.api.getInventory().slots)),
      );
      if (result.ok) {
        notify(`Started ${recipe.name} · batch ${result.value.queued}.`, "success");
        this.refresh(true);
        this.ctx.refresh();
      } else {
        report(result);
      }
    });

    root.append(glyph, text, make);
    return root;
  }

  private nearbyCampfire(): SemanticEntity | null {
    const nearby = this.ctx.api.observe({
      scope: "visible",
      radius: 8,
      archetypes: ["station"],
      interaction: "produce",
      limit: 12,
    });
    for (const row of nearby) {
      const inspected = this.ctx.api.inspect(row.id);
      if (inspected.ok && inspected.value.station?.kind === "campfire") return inspected.value;
    }
    return null;
  }

  private paintFireLine(
    selected: SemanticEntity,
    selectedRemainingMs: number | null,
    nearby: SemanticEntity | null,
    nearbyRemainingMs: number | null,
  ): void {
    if (selected.station?.kind === "campfire") {
      this.fireLine.hidden = false;
      this.fireLine.textContent = selectedRemainingMs === null
        ? "Portable fire"
        : `Fire remaining ${formatRemaining(selectedRemainingMs)}`;
      return;
    }
    if (nearby) {
      this.fireLine.hidden = false;
      this.fireLine.textContent = nearbyRemainingMs === null
        ? "Portable campfire nearby"
        : `Nearby campfire ${formatRemaining(nearbyRemainingMs)} remaining`;
      return;
    }
    this.fireLine.hidden = true;
    this.fireLine.textContent = "";
  }
}

function isRecipeDef(recipe: RecipeDef | undefined): recipe is RecipeDef {
  return recipe !== undefined;
}

function stationLabel(kind: StationKind): string {
  return kind.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatStations(stations: readonly StationKind[] | null): string {
  return stations === null ? "Anywhere" : stations.map(stationLabel).join(" or ");
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1_000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

function formatRemaining(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  const tail = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(tail).padStart(2, "0")}` : `${tail}s`;
}

function campfireRemainingMs(entity: { meta?: Record<string, string | number | boolean> }, api: GameApi): number | null {
  const meta = entity.meta;
  if (!meta) return null;
  const directMs = meta["remainingMs"] ?? meta["campfireRemainingMs"];
  if (typeof directMs === "number" && Number.isFinite(directMs)) return Math.max(0, directMs);
  const directSeconds = meta["remainingSeconds"] ?? meta["campfireRemainingSeconds"];
  if (typeof directSeconds === "number" && Number.isFinite(directSeconds)) return Math.max(0, directSeconds * 1_000);
  const expiresAtMs = meta["expiresAtMs"];
  if (typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)) {
    return Math.max(0, expiresAtMs - api.getTime().simMs);
  }
  return null;
}

function maxRecipeBatches(recipe: RecipeDef, slots: readonly (ItemStack | null)[]): number {
  const totals = new Map<ItemId, number>();
  const needs = new Map<ItemId, number>();
  for (const slot of slots) {
    if (!slot) continue;
    totals.set(slot.itemId, (totals.get(slot.itemId) ?? 0) + slot.quantity);
  }
  for (const input of recipe.inputs) {
    needs.set(input.itemId, (needs.get(input.itemId) ?? 0) + input.quantity);
  }
  let max = Number.POSITIVE_INFINITY;
  for (const [itemId, quantity] of needs) {
    max = Math.min(max, Math.floor((totals.get(itemId) ?? 0) / quantity));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

// ------------------------------------------------------------------- the UI

export interface UiOptions {
  registry?: KeyBindingRegistry;
  /** Existing client-preference store, when boot must apply audio before the UI is constructed. */
  settings?: SettingsStore;
  mapTerrain?: MapTerrainSource;
  /** True when boot found a save. The title screen offers "Continue" rather than "Begin". */
  hasSave?(): boolean;
  /**
   * Clears the save and rebuilds the world. The root wires `resetWorld`; the UI must not reach
   * into persistence or the world layer itself.
   */
  onNewGame?(): void;
  /**
   * World heading the view is looking along, radians, 0 = +Z (north), increasing toward +X.
   * Only the compass uses it. Omitted, the compass shows absolute bearings with north fixed up,
   * which is still correct, just not view-relative.
   */
  getHeadingRad?(): number;
  /**
   * Where the player is currently walking to, or null when idle. Read by the minimap for its
   * destination marker. Comes from the store because `GameApi` does not expose the live path.
   */
  getDestination?(): Vec3 | null;
  /** Present only in the transient real-engine lab; enables setup controls in production panels. */
  featureLab?: FeatureLabApi;
}

export interface Ui {
  mount(root: HTMLElement): void;
  /** Call once a frame. Internally throttled; it does not repaint per frame. */
  update(): void;
  dispose(): void;
  /** Opens the bank window. The world layer calls this when a bank interaction succeeds. */
  openBank(entityId?: EntityId): void;
  /** Opens the shop window for a shop entity. */
  openShop(shopId?: EntityId): void;
  /** Opens recipe selection for a production station. */
  openProduction(entityId: EntityId): void;
  /** Raises the conversation window. The root calls this on `dialogue.opened`. */
  openDialogue(): void;
  /** Dismisses it. The root calls this on `dialogue.closed`. */
  closeDialogue(): void;
  /** Shows the death report. The root calls this on `player.died` with the event payload. */
  showDeath(detail: DeathDetail): void;
  /** Raises the title and pause screen. */
  openTitle(): void;
  /** Live client preferences. The root subscribes to apply them. */
  readonly settings: SettingsStore;
  /** The notice channel, for anything outside the UI that needs to tell the player something. */
  notify(message: string, tone?: NoticeTone): void;
}

const HUD_INTERVAL_MS = 100;
const PANEL_INTERVAL_MS = 220;

/**
 * The single entry point. One call at boot, one `update()` a frame, one `dispose()` on teardown.
 */
export function createUi(api: GameApi, options: UiOptions = {}): Ui {
  const registry = options.registry ?? keybindings;
  const settings = options.settings ?? new SettingsStore();
  const tooltip = new Tooltip(api);
  let production: ProductionPanel | null = null;
  const menu = new ContextMenu({
    api,
    skillLabel: skillName,
    onProduction: (entityId) => production?.openFor(entityId),
  });

  let bank: LazyPanel<BankPanelHandle> | null = null;
  let shop: LazyPanel<ShopPanelHandle> | null = null;

  const tracker = new QuestTracker(api);

  const context: UiContext = {
    api,
    tooltip,
    menu,
    registry,
    mapTerrain: options.mapTerrain,
    isBankOpen: () => bank?.frame.isOpen() ?? false,
    isShopOpen: () => shop?.frame.isOpen() ?? false,
    deposit: (itemId, quantity) => { bank?.withPanel((panel) => panel.deposit(itemId, quantity)); },
    sell: (itemId, quantity) => { shop?.withPanel((panel) => panel.sell(itemId, quantity)); },
    pinQuest: (questId) => { tracker.pin(questId); },
    pinnedQuestId: () => tracker.pinnedId(),
    refresh: () => refreshAll(true),
  };

  const loadError = (title: string) => (error: unknown): void => {
    console.error(`[ui] Could not load ${title}`, error);
    notify(`Could not open ${title}. Try again.`, "error");
  };
  const hud = new Hud(context, options);
  const inventory = new LazyPanel({
    id: "inventory", title: "Inventory", key: "i", keyLabel: "Inventory", registry,
    load: () => loadInventoryPanel(context), onError: loadError("Inventory"),
  });
  const skillGuide = new LazyPanel<SkillGuidePanelHandle>({
    id: "skill-guide", title: "Skill guide", registry,
    load: () => loadSkillGuidePanel(context), onError: loadError("Skill guide"),
  });
  const skills = new LazyPanel({
    id: "skills", title: "Skills", key: "k", keyLabel: "Skills", registry,
    load: () => loadSkillsPanel(context, (skill) => {
      skillGuide.withPanel((panel) => panel.openFor(skill));
    }),
    onError: loadError("Skills"),
  });
  const equipment = new LazyPanel({
    id: "equipment", title: "Equipment", key: "e", keyLabel: "Equipment", registry,
    load: () => loadEquipmentPanel(context, options.featureLab), onError: loadError("Equipment"),
  });
  production = new ProductionPanel(context);
  const quests = new LazyPanel({
    id: "quests", title: "Quests", key: "j", keyLabel: "Quests", registry,
    load: () => loadQuestPanel(context), onError: loadError("Quests"),
  });
  const dialogue = new LazyPanel<DialoguePanelHandle>({
    id: "dialogue", title: "Conversation", registry,
    load: () => loadDialoguePanel(context), onError: loadError("Conversation"),
  });
  const controls = new LazyPanel({
    id: "controls", title: "Controls", key: "h", keyLabel: "Controls", registry,
    load: () => loadControlsPanel(context), onError: loadError("Controls"),
  });
  const map = new LazyPanel({
    id: "map", title: "Map", key: "m", keyLabel: "Map", registry,
    load: () => loadMapPanel(context), onError: loadError("Map"),
  });
  const spellbook = new LazyPanel({
    id: "spellbook", title: "Spellbook", key: "b", keyLabel: "Spellbook", registry,
    load: () => loadSpellbookPanel(context), onError: loadError("Spellbook"),
  });
  const featureLab = options.featureLab ? new LazyPanel({
    id: "feature-lab", title: "Feature lab", key: "l", keyLabel: "Feature lab", registry,
    load: () => loadFeatureLabPanel(context, options.featureLab!), onError: loadError("Feature lab"),
  }) : null;
  let titleCoveredBySettings = false;
  const settingsPanel = new SettingsPanel(context, settings, () => {
    if (!titleCoveredBySettings) return;
    titleCoveredBySettings = false;
    title.setCovered(false);
  });
  bank = new LazyPanel<BankPanelHandle>({
    id: "bank", title: "Bank", registry,
    load: () => loadBankPanel(context), onError: loadError("Bank"),
  });
  shop = new LazyPanel<ShopPanelHandle>({
    id: "shop", title: "Shop", registry,
    load: () => loadShopPanel(context), onError: loadError("Shop"),
  });
  const panels: ManagedPanel[] = [
    inventory, skills, skillGuide, equipment, production, quests, map, controls, dialogue, settingsPanel,
    bank, shop, spellbook,
    ...(featureLab ? [featureLab] : []),
  ];

  const death = new DeathScreen(context);
  const title = new TitleScreen({
    hasSave: () => options.hasSave?.() ?? false,
    onNewGame: () => {
      options.onNewGame?.();
      title.close();
    },
    onSettings: () => {
      titleCoveredBySettings = true;
      title.setCovered(true);
      settingsPanel.frame.open();
    },
    onClose: () => title.close(),
  });

  // Built after the map and the title screen exist: its corner buttons drive both.
  const minimap = options.mapTerrain
    ? new Minimap(api, options.mapTerrain, options.getDestination, options.getHeadingRad, {
        onOpenMap: () => map.frame.toggle(),
        onMenu: () => title.open(),
      })
    : null;

  // Every panel gets a permanent on-screen button that prints its own key. The bank and the shop
  // are deliberately not on it: both are opened by standing at one, and a button that answers
  // "you are not at a bank" is worse than no button.
  const dock = new PanelDock([
    ...(featureLab ? [{ id: "feature-lab", label: "Lab", key: "l", glyph: "LAB",
      toggle: () => featureLab.frame.toggle(), isOpen: () => featureLab.frame.isOpen() }] : []),
    { id: "inventory", label: "Pack", key: "i", glyph: "▦",
      toggle: () => inventory.frame.toggle(), isOpen: () => inventory.frame.isOpen(),
      badge: () => {
        const used = api.getInventory().slots.filter((slot) => slot !== null).length;
        return used >= INVENTORY_SLOTS ? "FULL" : "";
      } },
    { id: "skills", label: "Skills", key: "k", glyph: "◈",
      toggle: () => skills.frame.toggle(), isOpen: () => skills.frame.isOpen() },
    { id: "equipment", label: "Worn", key: "e", glyph: "⛨",
      toggle: () => equipment.frame.toggle(), isOpen: () => equipment.frame.isOpen() },
    { id: "quests", label: "Quests", key: "j", glyph: "❋",
      toggle: () => quests.frame.toggle(), isOpen: () => quests.frame.isOpen(),
      badge: () => {
        const active = api.getQuests().filter((quest) => quest.status === "active").length;
        return active > 0 ? String(active) : "";
      } },
    // The spellbook stands where the map button used to. The map is one click away on the minimap's
    // own corner button (`ui/minimap.ts`, "Full map (M)") and keeps its "m" binding, so a second
    // dock entry for it was the least useful button on the bar; the spellbook, with sixteen spells
    // behind it, is the most. The map panel itself is unchanged and still registered below.
    { id: "spellbook", label: "Spells", key: "b", glyph: "✦",
      toggle: () => spellbook.frame.toggle(), isOpen: () => spellbook.frame.isOpen(),
      // The badge is the element the player has chosen, or nothing while the game is choosing for
      // them. A caster who set fire and then out-levelled it needs to see that from the dock,
      // without opening the book to find out why their damage stopped climbing.
      badge: () => {
        const book = api.getSpellbook();
        if (!book.preferredSpellId) return "";
        return book.spells.find((row) => row.id === book.preferredSpellId)?.element.slice(0, 1).toUpperCase() ?? "";
      } },
    { id: "controls", label: "Keys", key: "h", glyph: "⌨",
      toggle: () => controls.frame.toggle(), isOpen: () => controls.frame.isOpen() },
  ]);

  let mounted = false;
  let lastHudMs = 0;
  let lastPanelMs = 0;

  function refreshAll(force: boolean): void {
    for (const panel of panels) {
      if (panel.frame.isOpen()) panel.refresh(force);
    }
  }

  return {
    mount(root: HTMLElement): void {
      if (mounted) return;
      mounted = true;
      hud.mount(root);
      // The minimap owns the top-right corner; the HUD's purse cluster steps down below it.
      if (minimap) {
        minimap.mount(root);
        root.querySelector(".hud")?.classList.add("has-minimap");
      }
      tracker.mount(root);
      dock.mount(root);
      for (const panel of panels) panel.frame.mount(root);
      featureLab?.frame.open();
      // Both of these cover the screen, so they mount last and sit above the panels.
      death.mount(root);
      title.mount(root);
      tooltip.mount(root);
      // The HUD owns the toast channel from here; the context menu's fallback strip stands down.
      setNoticeSink((message, tone) => hud.pushNotice(message, tone));
    },

    update(): void {
      if (!mounted) return;
      const now = performance.now();
      if (now - lastHudMs >= HUD_INTERVAL_MS) {
        lastHudMs = now;
        hud.update(now);
        dock.update();
        death.update();
        minimap?.update(now);
        // The world may open a bank or a shop through an interaction rather than through us.
        const wants = hud.takeAutoOpen();
        if (wants === "bank") bank?.withPanel((panel) => panel.openFor(undefined));
        else if (wants === "shop") shop?.withPanel((panel) => panel.openFor(undefined));
      }
      if (now - lastPanelMs >= PANEL_INTERVAL_MS) {
        lastPanelMs = now;
        refreshAll(false);
        tracker.update();
      }
    },

    dispose(): void {
      setNoticeSink(null);
      minimap?.dispose();
      tracker.dispose();
      dock.dispose();
      death.dispose();
      title.dispose();
      for (const panel of panels) panel.dispose();
      hud.dispose();
      tooltip.dispose();
      menu.dispose();
      mounted = false;
    },

    openBank(entityId?: EntityId): void {
      bank?.withPanel((panel) => panel.openFor(entityId));
    },

    openShop(shopId?: EntityId): void {
      shop?.withPanel((panel) => panel.openFor(shopId));
    },

    openProduction(entityId: EntityId): void {
      production?.openFor(entityId);
    },

    openDialogue(): void {
      dialogue.withPanel((panel) => panel.openFor());
    },

    closeDialogue(): void {
      dialogue.frame.close();
    },

    showDeath(detail: DeathDetail): void {
      death.show(detail);
    },

    openTitle(): void {
      title.open();
    },

    settings,

    notify(message: string, tone: NoticeTone = "info"): void {
      notify(message, tone);
    },
  };
}
