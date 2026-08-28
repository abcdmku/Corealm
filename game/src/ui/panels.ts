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
  EntityId, GameApi, ItemCategory, ItemDef, ItemId, ItemStack, Result, SkillId,
} from "../contracts.js";
import { content } from "../content/index.js";
import { SKILLS } from "../content/skills.js";
import { keybindings } from "../input/keyboard.js";
import type { KeyBindingRegistry, Unregister } from "../input/keyboard.js";
import { ContextMenu, notify, reportResult, setNoticeSink } from "./contextMenu.js";
import type { NoticeTone } from "./contextMenu.js";
import { Tooltip } from "./tooltips.js";
import { itemIconSvg } from "./itemIcons.js";
import { Hud } from "./hud.js";
import { InventoryPanel } from "./inventoryPanel.js";
import { SkillsPanel } from "./skillsPanel.js";
import { EquipmentPanel } from "./equipmentPanel.js";
import { BankPanel } from "./bankPanel.js";
import { ShopPanel } from "./shopPanel.js";
import { QuestPanel } from "./questPanel.js";
import { DialoguePanel } from "./dialoguePanel.js";
import { ControlsPanel } from "./controlsPanel.js";
import { MapPanel } from "./mapPanel.js";
import { DeathScreen, type DeathDetail } from "./deathScreen.js";
import { TitleScreen } from "./titleScreen.js";
import { SettingsPanel } from "./settingsPanel.js";
import { SettingsStore } from "./settings.js";
import { PanelDock } from "./dock.js";

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

/**
 * A slot's tile: a tier-shaded plate in the category's hue with a drawn icon on it.
 *
 * The colour rules are unchanged from round 2 — category hue, tier-derived shade — but the two
 * letters that used to sit on the plate are gone. `ui/itemIcons.ts` picks a vector shape from what
 * the item does: the sword, shield, helm and boot for the slot a piece of gear goes in, and an ore
 * chunk, ingot, fish, seed, scroll or coin for everything else. At 40 px a bank of 28 tiles of
 * two-letter text told a player nothing; a bank of 28 silhouettes tells them where the food is.
 *
 * `itemGlyphText` is kept for the tooltip and for anywhere text is genuinely wanted.
 */
const CATEGORY_HUE: Record<ItemCategory, number> = {
  resource: 28, bar: 20, equipment: 210, food: 96, tool: 42,
  seed: 120, quest: 280, currency: 48, component: 320,
};

function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function itemGlyphColour(itemId: ItemId): string {
  const def = content.item(itemId);
  const hue = (def ? CATEGORY_HUE[def.category] : 35) + (hashString(itemId) % 24) - 12;
  const tier = def?.tier ?? 1;
  const light = Math.max(28, Math.min(52, 30 + tier * 1.4));
  return `hsl(${((hue % 360) + 360) % 360} 34% ${light}%)`;
}

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
  glyph.style.setProperty("--glyph-colour", itemGlyphColour(stack.itemId));
  glyph.innerHTML = itemIconSvg(itemDef(stack.itemId));
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
  onOpen?(): void;
  onClose?(): void;
}

let panelZCounter = 0;

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
    root.style.maxHeight = place.maxHeight ?? "calc(100vh - 96px)";

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

  /** Brings this panel above the others without reordering the DOM. */
  raise(): void {
    panelZCounter += 1;
    this.root.style.zIndex = String(20 + panelZCounter);
  }

  focusFirst(): void {
    const target = this.body.querySelector<HTMLElement>("[data-autofocus]")
      ?? this.body.querySelector<HTMLElement>("button:not([disabled]), input, select, [tabindex='0']");
    (target ?? this.root).focus({ preventScroll: true });
  }

  dispose(): void {
    this.close();
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

/** What each panel is handed. Everything shared, nothing global. */
export interface UiContext {
  readonly api: GameApi;
  readonly tooltip: Tooltip;
  readonly menu: ContextMenu;
  readonly registry: KeyBindingRegistry;
  /** True while a bank window is open, so the inventory can offer Deposit. */
  isBankOpen(): boolean;
  /** True while a shop window is open, so the inventory can offer Sell. */
  isShopOpen(): boolean;
  deposit(itemId: ItemId, quantity: number): void;
  sell(itemId: ItemId, quantity: number): void;
  /** Repaint every open panel now. Called after any mutation so the player sees the result. */
  refresh(): void;
}

/** Every panel this module manages looks like this. */
export interface ManagedPanel {
  readonly frame: PanelFrame;
  refresh(force?: boolean): void;
  dispose(): void;
}

// ------------------------------------------------------------------- the UI

export interface UiOptions {
  registry?: KeyBindingRegistry;
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
  const settings = new SettingsStore();
  const tooltip = new Tooltip(api);
  const menu = new ContextMenu({ api, skillLabel: skillName });

  let bank: BankPanel | null = null;
  let shop: ShopPanel | null = null;

  const context: UiContext = {
    api,
    tooltip,
    menu,
    registry,
    isBankOpen: () => bank?.frame.isOpen() ?? false,
    isShopOpen: () => shop?.frame.isOpen() ?? false,
    deposit: (itemId, quantity) => { bank?.deposit(itemId, quantity); },
    sell: (itemId, quantity) => { shop?.sell(itemId, quantity); },
    refresh: () => refreshAll(true),
  };

  const hud = new Hud(context, options);
  const inventory = new InventoryPanel(context);
  const skills = new SkillsPanel(context);
  const equipment = new EquipmentPanel(context);
  const quests = new QuestPanel(context);
  const dialogue = new DialoguePanel(context);
  const controls = new ControlsPanel(context);
  const map = new MapPanel(context);
  const settingsPanel = new SettingsPanel(context, settings);
  bank = new BankPanel(context);
  shop = new ShopPanel(context);
  const panels: ManagedPanel[] = [
    inventory, skills, equipment, quests, map, controls, dialogue, settingsPanel, bank, shop,
  ];

  const death = new DeathScreen(context);
  const title = new TitleScreen({
    hasSave: () => options.hasSave?.() ?? false,
    onNewGame: () => {
      options.onNewGame?.();
      title.close();
    },
    onSettings: () => settingsPanel.frame.open(),
    onClose: () => title.close(),
  });

  // Every panel gets a permanent on-screen button that prints its own key. The bank and the shop
  // are deliberately not on it: both are opened by standing at one, and a button that answers
  // "you are not at a bank" is worse than no button.
  const dock = new PanelDock([
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
    { id: "quests", label: "Journal", key: "j", glyph: "❋",
      toggle: () => quests.frame.toggle(), isOpen: () => quests.frame.isOpen(),
      badge: () => {
        const active = api.getQuests().filter((quest) => quest.status === "active").length;
        return active > 0 ? String(active) : "";
      } },
    { id: "map", label: "Map", key: "m", glyph: "◎",
      toggle: () => map.frame.toggle(), isOpen: () => map.frame.isOpen() },
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
      dock.mount(root);
      for (const panel of panels) panel.frame.mount(root);
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
        // The world may open a bank or a shop through an interaction rather than through us.
        const wants = hud.takeAutoOpen();
        if (wants === "bank") bank?.openFor(undefined);
        else if (wants === "shop") shop?.openFor(undefined);
      }
      if (now - lastPanelMs >= PANEL_INTERVAL_MS) {
        lastPanelMs = now;
        refreshAll(false);
      }
    },

    dispose(): void {
      setNoticeSink(null);
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
      bank?.openFor(entityId);
    },

    openShop(shopId?: EntityId): void {
      shop?.openFor(shopId);
    },

    openDialogue(): void {
      dialogue.openFor();
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
