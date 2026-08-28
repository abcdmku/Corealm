/**
 * The nine equipment slots, laid out around a silhouette, with the summed bonuses underneath.
 *
 * The panel is the second half of the PRD's readability contract for gear. The first half lives in
 * the tooltip: hovering an inventory item shows the green/red delta against whatever is worn in
 * that slot. This panel is where the player checks the total that delta moves.
 */
import type { EquipSlot, EquipmentBonuses, ItemStack } from "../contracts.js";
import { EQUIP_SLOTS } from "../contracts.js";
import { notify } from "./contextMenu.js";
import type { ContextMenuItem } from "./contextMenu.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame, itemDef, itemName, paintSlot, report, stackSignature } from "./panels.js";

const SLOT_LABELS: Record<EquipSlot, string> = {
  head: "Head",
  body: "Body",
  legs: "Legs",
  feet: "Feet",
  hands: "Hands",
  mainHand: "Main",
  offHand: "Off",
  accessory1: "Acc 1",
  accessory2: "Acc 2",
};

/** Row, column. A three-wide grid with the body down the middle, arms either side. */
const SLOT_CELLS: Record<EquipSlot, [number, number]> = {
  head: [1, 2],
  accessory1: [1, 3],
  mainHand: [2, 1],
  body: [2, 2],
  offHand: [2, 3],
  hands: [3, 1],
  legs: [3, 2],
  accessory2: [3, 3],
  feet: [4, 2],
};

const BONUS_ROWS: readonly [keyof EquipmentBonuses, string][] = [
  ["accuracy", "Accuracy"],
  ["power", "Power"],
  ["armour", "Armour"],
  ["magicAccuracy", "Magic accuracy"],
  ["magicPower", "Magic power"],
  ["magicArmour", "Magic armour"],
  ["vitality", "Vitality"],
];

export class EquipmentPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly cells = new Map<EquipSlot, HTMLButtonElement>();
  private readonly totals = new Map<keyof EquipmentBonuses, HTMLElement>();
  private worn: Record<EquipSlot, ItemStack | null> | null = null;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "equipment",
      title: "Equipment",
      key: "e",
      keyLabel: "Equipment",
      registry: ctx.registry,
      placement: { top: "96px", right: "264px", width: "300px" },
      onOpen: () => this.refresh(true),
    });

    const figure = document.createElement("div");
    figure.className = "equip-figure";

    const silhouette = document.createElement("div");
    silhouette.className = "equip-silhouette";
    silhouette.setAttribute("aria-hidden", "true");
    figure.appendChild(silhouette);

    const grid = document.createElement("div");
    grid.className = "equip-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Worn equipment");

    for (const slot of EQUIP_SLOTS) {
      const cell = this.buildCell(slot);
      const position = SLOT_CELLS[slot];
      cell.style.gridRow = String(position[0]);
      cell.style.gridColumn = String(position[1]);
      grid.appendChild(cell);
    }
    figure.appendChild(grid);
    this.frame.body.appendChild(figure);

    const totals = document.createElement("dl");
    totals.className = "equip-totals";
    for (const [key, label] of BONUS_ROWS) {
      const term = document.createElement("dt");
      term.textContent = label;
      const value = document.createElement("dd");
      value.className = "u-numeric";
      value.textContent = "0";
      totals.append(term, value);
      this.totals.set(key, value);
    }
    this.frame.body.appendChild(totals);
  }

  refresh(force = false): void {
    const equipment = this.ctx.api.getEquipment();
    const signature = [
      ...EQUIP_SLOTS.map((slot) => `${slot}=${stackSignature(equipment.slots[slot])}`),
      ...BONUS_ROWS.map(([key]) => `${key}=${equipment.totals[key]}`),
    ].join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.worn = equipment.slots;

    let filled = 0;
    for (const slot of EQUIP_SLOTS) {
      const stack = equipment.slots[slot];
      if (stack) filled += 1;
      const cell = this.cells.get(slot);
      if (cell) paintSlot(cell, stack, SLOT_LABELS[slot]);
    }

    for (const [key] of BONUS_ROWS) {
      const node = this.totals.get(key);
      if (!node) continue;
      const value = equipment.totals[key];
      node.textContent = value > 0 ? `+${value}` : String(value);
      node.classList.toggle("is-zero", value === 0);
    }

    this.frame.setSubtitle(`${filled} of ${EQUIP_SLOTS.length} slots worn`);
  }

  dispose(): void {
    this.frame.dispose();
  }

  private buildCell(slot: EquipSlot): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "slot slot--equip is-empty";
    cell.dataset["equipSlot"] = slot;
    cell.setAttribute("aria-label", `${SLOT_LABELS[slot]}: empty`);

    cell.addEventListener("click", () => this.unequip(slot));
    cell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openMenu(slot, event.clientX, event.clientY);
    });

    this.ctx.tooltip.attach(cell, () => {
      const stack = this.worn?.[slot] ?? null;
      if (!stack) return { kind: "text", title: SLOT_LABELS[slot], lines: ["Nothing worn in this slot."] };
      return { kind: "item", itemId: stack.itemId, quantity: stack.quantity };
    });

    this.cells.set(slot, cell);
    return cell;
  }

  private unequip(slot: EquipSlot): void {
    if (!this.worn?.[slot]) return;
    const result = this.ctx.api.unequipItem(slot);
    if (result.ok) notify(`Removed ${itemName(result.value.itemId)}.`, "info");
    else report(result);
    this.ctx.refresh();
  }

  private openMenu(slot: EquipSlot, clientX: number, clientY: number): void {
    const stack = this.worn?.[slot] ?? null;
    const label = SLOT_LABELS[slot];
    const items: ContextMenuItem[] = [];

    if (stack) {
      const def = itemDef(stack.itemId);
      items.push({
        id: "unequip",
        label: `Remove ${itemName(stack.itemId)}`,
        enabled: true,
        onSelect: () => this.unequip(slot),
      });
      items.push({
        id: "examine",
        label: "Examine",
        enabled: true,
        onSelect: () => notify(def?.description ?? itemName(stack.itemId), "info"),
      });
    } else {
      items.push({ id: "empty", label: "Nothing worn here", enabled: false, reason: label });
    }

    this.ctx.menu.open(clientX, clientY, items, { title: label });
  }
}
