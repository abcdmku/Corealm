/**
 * The nine equipment slots, laid out around a silhouette, with the summed bonuses underneath.
 *
 * The panel is the second half of the PRD's readability contract for gear. The first half lives in
 * the tooltip: hovering an inventory item shows the green/red delta against whatever is worn in
 * that slot. This panel is where the player checks the total that delta moves.
 */
import type { EquipSlot, EquipmentBonuses, FeatureLabApi, ItemId, ItemStack } from "../contracts.js";
import { EQUIP_SLOTS } from "../contracts.js";
import { notify } from "./contextMenu.js";
import type { ContextMenuItem } from "./contextMenu.js";
import { EquipmentSlotGrid, EQUIPMENT_SLOT_LABELS } from "./equipmentSlotGrid.js";
import { createItemIcon } from "./itemIcons.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame, itemDef, itemName, report, stackSignature } from "./panels.js";

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
  private readonly slotGrid: EquipmentSlotGrid;
  private readonly totals = new Map<keyof EquipmentBonuses, HTMLElement>();
  private worn: Record<EquipSlot, ItemStack | null> | null = null;
  private signature = "";
  private picker: HTMLElement | null = null;
  private pickerItems: HTMLElement | null = null;
  private pickerTitle: HTMLElement | null = null;
  private selectedSlot: EquipSlot | null = null;

  constructor(private readonly ctx: UiContext, private readonly featureLab?: FeatureLabApi) {
    this.frame = new PanelFrame({
      id: "equipment",
      title: "Equipment",
      key: "e",
      keyLabel: "Equipment",
      registry: ctx.registry,
      placement: { right: "10px", bottom: "48px", width: "190px", maxHeight: "calc(100vh - 110px)" },
      group: "side",
      onOpen: () => this.refresh(true),
    });

    this.slotGrid = new EquipmentSlotGrid({
      resolveItem: itemDef,
      onActivate: (slot) => featureLab ? this.openPicker(slot) : this.unequip(slot),
      onContextMenu: (slot, _cell, event) => {
        event.preventDefault();
        this.openMenu(slot, event.clientX, event.clientY);
      },
    });
    if (featureLab) this.slotGrid.root.classList.add("equip-figure--lab");
    for (const slot of EQUIP_SLOTS) {
      const cell = this.slotGrid.cell(slot);
      this.ctx.tooltip.attach(cell, () => {
        const stack = this.worn?.[slot] ?? null;
        if (!stack) {
          return {
            kind: "text",
            title: EQUIPMENT_SLOT_LABELS[slot],
            lines: ["Nothing worn in this slot."],
          };
        }
        return { kind: "item", itemId: stack.itemId, quantity: stack.quantity };
      });
    }
    this.frame.body.appendChild(this.slotGrid.root);

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

    if (featureLab) {
      const picker = document.createElement("section");
      picker.className = "equip-chooser";
      picker.hidden = true;
      const title = document.createElement("strong");
      title.className = "equip-chooser__title";
      const items = document.createElement("div");
      items.className = "equip-chooser__items";
      picker.append(title, items);
      this.frame.body.appendChild(picker);
      this.picker = picker;
      this.pickerTitle = title;
      this.pickerItems = items;
    }
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

    const filled = EQUIP_SLOTS.filter((slot) => equipment.slots[slot] !== null).length;
    this.slotGrid.render(equipment.slots);

    for (const [key] of BONUS_ROWS) {
      const node = this.totals.get(key);
      if (!node) continue;
      const value = equipment.totals[key];
      node.textContent = value > 0 ? `+${value}` : String(value);
      node.classList.toggle("is-zero", value === 0);
    }

    this.frame.setSubtitle(`${filled}/${EQUIP_SLOTS.length} worn`);
    if (this.selectedSlot) this.openPicker(this.selectedSlot);
  }

  dispose(): void {
    this.frame.dispose();
  }

  private unequip(slot: EquipSlot): void {
    if (!this.worn?.[slot]) return;
    const result = this.ctx.api.unequipItem(slot);
    if (result.ok) notify(`Removed ${itemName(result.value.itemId)}.`, "info");
    else report(result);
    this.ctx.refresh();
  }

  /** Lab-only setup picker inside the actual production Equipment panel. */
  private openPicker(slot: EquipSlot): void {
    if (!this.featureLab || !this.picker || !this.pickerTitle || !this.pickerItems) return;
    this.selectedSlot = slot;
    const group = this.featureLab.getCatalog().equipment.find((candidate) => candidate.slot === slot);
    const current = this.ctx.api.getEquipment().slots[slot]?.itemId ?? null;
    this.pickerTitle.textContent = `${EQUIPMENT_SLOT_LABELS[slot]}: choose equipment`;
    this.pickerItems.replaceChildren(
      this.choice(slot, null, "None (empty slot)", current),
      ...(group?.items ?? []).map((item) => this.choice(slot, item.id, item.label, current)),
    );
    this.picker.hidden = false;
    for (const [candidate, cell] of this.slotGrid.cells) {
      cell.classList.toggle("is-selected", candidate === slot);
    }
  }

  private choice(slot: EquipSlot, itemId: ItemId | null, label: string, current: ItemId | null): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "equip-chooser__choice";
    button.dataset["equipmentItem"] = itemId ?? "";
    button.classList.toggle("is-selected", itemId === current);
    button.setAttribute("aria-pressed", String(itemId === current));
    if (itemId) button.appendChild(createItemIcon(itemDef(itemId)));
    const text = document.createElement("span");
    text.textContent = label;
    button.appendChild(text);
    button.addEventListener("click", () => {
      void this.featureLab!.equipPlayer(slot, itemId)
        .then(() => this.ctx.refresh())
        .catch((cause: unknown) => notify(cause instanceof Error ? cause.message : String(cause), "error"));
    });
    return button;
  }

  private openMenu(slot: EquipSlot, clientX: number, clientY: number): void {
    const stack = this.worn?.[slot] ?? null;
    const label = EQUIPMENT_SLOT_LABELS[slot];
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
