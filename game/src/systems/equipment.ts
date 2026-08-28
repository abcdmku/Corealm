/**
 * The nine worn slots, and the one place max health is derived.
 *
 * Two rules carry the weight here. First, gear is never destroyed: a swap only completes if the
 * displaced piece has somewhere to land, and a failed swap rolls back to exactly the state it
 * started in. Second, max health is derived from `computeMaxHealth(state, totals.vitality)` on every
 * change, and current health clamps down when the ceiling drops — so taking off a vitality amulet
 * at 3 hp does not leave you standing at more health than you can hold.
 *
 * Owner: W-INV. State lives in `state.equipment` and `state.player.maxHealth`; this file adds none.
 */
import type { EquipSlot, EquipmentBonuses, ItemId, ItemStack, Result, SkillId } from "../contracts.js";
import { EQUIP_SLOTS, err, ok } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import { computeMaxHealth } from "../state/store.js";
import { content } from "../content/index.js";
import type { EventBus } from "../core/events.js";
import type { InventorySystem } from "./inventory.js";

export interface EquipmentDeps {
  store: Store;
  events: EventBus;
  inventory: InventorySystem;
  now: () => number;
  /** Optional override. Defaults to reading `state.skills[skill].level`. */
  skillLevel?: (skill: SkillId) => number;
}

export function emptyEquipmentBonuses(): EquipmentBonuses {
  return { accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0 };
}

export class EquipmentSystem {
  constructor(private readonly deps: EquipmentDeps) {}

  private get state(): GameState {
    return this.deps.store.get();
  }

  private levelOf(skill: SkillId): number {
    if (this.deps.skillLevel) return this.deps.skillLevel(skill);
    return this.state.skills[skill].level;
  }

  // ------------------------------------------------------------ SystemHooks

  slots(): Record<EquipSlot, ItemStack | null> {
    const out = {} as Record<EquipSlot, ItemStack | null>;
    for (const slot of EQUIP_SLOTS) {
      const worn = this.state.equipment[slot];
      out[slot] = worn ? { ...worn } : null;
    }
    return out;
  }

  totals(): EquipmentBonuses {
    const totals = emptyEquipmentBonuses();
    for (const slot of EQUIP_SLOTS) {
      const worn = this.state.equipment[slot];
      if (!worn) continue;
      const bonuses = content.item(worn.itemId)?.equip?.bonuses;
      if (!bonuses) continue;
      totals.accuracy += bonuses.accuracy;
      totals.power += bonuses.power;
      totals.armour += bonuses.armour;
      totals.magicAccuracy += bonuses.magicAccuracy;
      totals.magicPower += bonuses.magicPower;
      totals.magicArmour += bonuses.magicArmour;
      totals.vitality += bonuses.vitality;
    }
    return totals;
  }

  equip(itemId: ItemId): Result<{ slot: EquipSlot; replaced: ItemId | null }> {
    const def = content.item(itemId);
    if (!def) return err("NOT_FOUND", `No item with id ${itemId}`);
    const equip = def.equip;
    if (!equip) return err("INVALID_ARGUMENT", `${def.name} is not equipment`);
    if (this.deps.inventory.countOf(itemId) < 1) {
      return err("NOT_ENOUGH_ITEMS", `You are not carrying a ${def.name}`);
    }

    const unmet = this.unmetRequirements(equip.requires);
    if (unmet.length > 0) {
      return err("REQUIREMENTS_NOT_MET", `${def.name} needs ${unmet.join(", ")}`);
    }

    const slot = equip.slot;
    const previous = this.state.equipment[slot] ?? null;

    // Take the new piece out first: for a one-slot-per-item wearable that frees the slot the
    // displaced piece needs, so the common swap always has room.
    //
    // Both moves are silent. An equip is one event — `item.equipped` below — not a loss and a
    // gain that an agent has to recognise as a pair.
    const removed = this.deps.inventory.removeItem(itemId, 1, { silent: true });
    if (!removed.ok) return { ok: false, error: removed.error };

    if (previous) {
      const returned = this.deps.inventory.addItem(previous.itemId, previous.quantity, { silent: true });
      if (!returned.ok) {
        // Roll back rather than destroy the worn piece. The re-add cannot fail: we just freed it.
        this.deps.inventory.addItem(itemId, 1, { silent: true });
        const previousName = content.item(previous.itemId)?.name ?? previous.itemId;
        return err("INVENTORY_FULL", `No room to take off your ${previousName} first`);
      }
    }

    this.state.equipment[slot] = { itemId, quantity: 1 };
    this.refreshMaxHealth();
    this.deps.store.markDirty();
    this.deps.events.emit(
      "item.equipped",
      {
        itemId,
        name: def.name,
        slot,
        replaced: previous ? previous.itemId : null,
        replacedName: previous ? content.item(previous.itemId)?.name ?? previous.itemId : null,
      },
      undefined,
      this.deps.now(),
    );
    return ok({ slot, replaced: previous ? previous.itemId : null });
  }

  unequip(slot: EquipSlot): Result<{ itemId: ItemId }> {
    if (!EQUIP_SLOTS.includes(slot)) return err("INVALID_ARGUMENT", `Unknown equipment slot "${String(slot)}"`);
    const worn = this.state.equipment[slot];
    if (!worn) return err("NOT_FOUND", `Nothing is equipped in ${slot}`);

    const name = content.item(worn.itemId)?.name ?? worn.itemId;
    if (!this.deps.inventory.hasSpaceFor(worn.itemId, worn.quantity)) {
      return err("INVENTORY_FULL", `No free inventory slot for your ${name}`);
    }
    const returned = this.deps.inventory.addItem(worn.itemId, worn.quantity, { silent: true });
    if (!returned.ok) return { ok: false, error: returned.error };

    this.state.equipment[slot] = null;
    this.refreshMaxHealth();
    this.deps.store.markDirty();
    this.deps.events.emit(
      "item.unequipped",
      { itemId: worn.itemId, name, slot, quantity: worn.quantity },
      undefined,
      this.deps.now(),
    );
    return ok({ itemId: worn.itemId });
  }

  // ---------------------------------------------------------------- derived

  /**
   * Recomputes max health from skills plus worn vitality and clamps current health into it. Public
   * because a melee or magic level-up moves the same number; the levelling system can call this
   * instead of duplicating the formula.
   */
  refreshMaxHealth(): number {
    const state = this.state;
    const max = computeMaxHealth(state, this.totals().vitality);
    state.player.maxHealth = max;
    if (state.player.health > max) state.player.health = max;
    this.deps.store.markDirty();
    return max;
  }

  /** Human-readable reasons, e.g. "melee level 40 (you have 12)". Empty when everything passes. */
  private unmetRequirements(requires: Partial<Record<SkillId, number>>): string[] {
    const unmet: string[] = [];
    for (const [key, required] of Object.entries(requires)) {
      if (typeof required !== "number" || required <= 1) continue;
      const skill = key as SkillId;
      const have = this.levelOf(skill);
      if (have < required) unmet.push(`${skill} level ${required} (you have ${have})`);
    }
    return unmet;
  }
}
