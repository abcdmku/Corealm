import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ItemId, SkillId, SpellId } from "../game/src/contracts.js";
import { SKILL_IDS } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content, type ContentTables, type SpellDef } from "../game/src/content/index.js";
import { SPELLS } from "../game/src/content/spells.js";
import { EventBus } from "../game/src/core/events.js";
import { migrate } from "../game/src/persistence/migrate.js";
import { createInitialState, setSkillLevel, Store } from "../game/src/state/store.js";
import { EquipmentSystem } from "../game/src/systems/equipment.js";
import {
  EssenceSystem, spellBlockReason, spendSpellFuel, weaponCharge,
} from "../game/src/systems/essence.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const originalContent: ContentTables = {
  items: [...content.allItems()], resources: [...content.allResources()],
  recipes: [...content.allRecipes()], spells: [...content.allSpells()],
  enemies: [...content.allEnemies()], shops: [...content.allShops()],
};

beforeAll(() => content.register({ items: ALL_ITEMS, spells: SPELLS }));
afterAll(() => content.register(originalContent));

function spell(id: SpellId): SpellDef {
  const found = content.spell(id);
  if (!found) throw new Error(`Missing test spell ${id}`);
  return found;
}

function currentSkillLevels(store: Store): Record<SkillId, number> {
  const result = {} as Record<SkillId, number>;
  for (const id of SKILL_IDS) result[id] = store.get().skills[id].level;
  return result;
}

function runtime() {
  const store = new Store(908, 0);
  const events = new EventBus();
  const now = () => 12_345;
  const inventory = new InventorySystem({ store, events, now });
  const equipment = new EquipmentSystem({ store, events, inventory, now });
  const dispatcher = new InteractionDispatcher({
    get: () => undefined,
    playerPosition: () => [0, 0, 0],
    skillLevels: () => currentSkillLevels(store),
  });
  const essence = new EssenceSystem({ store, events, inventory, dispatcher, now });
  return { store, events, inventory, equipment, essence };
}

function equip(fixture: ReturnType<typeof runtime>, itemId: ItemId): void {
  const added = fixture.inventory.addItem(itemId, 1);
  if (!added.ok) throw new Error(added.error.message);
  const equipped = fixture.equipment.equip(itemId);
  if (!equipped.ok) throw new Error(equipped.error.message);
}

describe("starter casting", () => {
  it("starts with a plain wand and 50 Air Essence", () => {
    const state = createInitialState(908, 0);
    expect(state.equipment.mainHand).toEqual({ itemId: "basic_wooden_wand", quantity: 1 });
    expect(state.inventory.slots.find((slot) => slot?.itemId === "air_essence"))
      .toMatchObject({ itemId: "air_essence", quantity: 50 });
    expect(state.magic).toEqual({ weaponCharges: {}, consumedOrbs: {} });
    expect(spellBlockReason(state, spell("voltrend"))).toBeNull();
  });

  it("spends one matching Essence when the weapon has no matching charge", () => {
    const fixture = runtime();
    expect(spendSpellFuel(fixture.store.get(), spell("voltrend"), fixture.inventory)).toEqual({
      ok: true,
      value: { source: "essence", essenceItemId: "air_essence", remainingEssence: 49 },
    });
    expect(fixture.inventory.countOf("air_essence")).toBe(49);
  });

  it("blocks only when both matching weapon charge and matching Essence are unavailable", () => {
    const fixture = runtime();
    setSkillLevel(fixture.store.get(), "magic", 99);
    expect(fixture.inventory.removeItem("air_essence", 50).ok).toBe(true);
    expect(spellBlockReason(fixture.store.get(), spell("voltrend"))).toMatch(/Carry 1 Air Essence/i);
    expect(spellBlockReason(fixture.store.get(), spell("emberlash"))).toMatch(/not released yet/i);
  });
});

describe("Orb-crafted weapons", () => {
  it("starts a newly acquired elemental weapon at 1000 and marks its Orb consumed", () => {
    const fixture = runtime();
    expect(fixture.inventory.addItem("air_wand", 1).ok).toBe(true);
    expect(weaponCharge(fixture.store.get(), "air_wand")).toBe(1000);
    expect(fixture.store.get().magic.consumedOrbs.air_orb).toBe(true);
  });

  it("spends matching weapon charge before carried Essence", () => {
    const fixture = runtime();
    equip(fixture, "air_wand");
    const essenceBefore = fixture.inventory.countOf("air_essence");
    expect(spendSpellFuel(fixture.store.get(), spell("voltrend"), fixture.inventory)).toEqual({
      ok: true,
      value: { source: "weapon", weaponItemId: "air_wand", remainingCharges: 999 },
    });
    expect(fixture.inventory.countOf("air_essence")).toBe(essenceBefore);
  });

  it("falls back to Essence when a charged weapon is empty", () => {
    const fixture = runtime();
    equip(fixture, "air_wand");
    fixture.store.get().magic.weaponCharges.air_wand = 0;
    expect(spendSpellFuel(fixture.store.get(), spell("voltrend"), fixture.inventory)).toMatchObject({
      ok: true,
      value: { source: "essence", remainingEssence: 49 },
    });
  });
});

describe("Essence Altar recharge", () => {
  it("spends exactly 100 matching Essence and restores the equipped weapon to 1000", () => {
    const fixture = runtime();
    equip(fixture, "air_staff");
    fixture.store.get().magic.weaponCharges.air_staff = 243;
    expect(fixture.inventory.addItem("air_essence", 100).ok).toBe(true);
    const before = fixture.inventory.countOf("air_essence");

    expect(fixture.essence.recharge("coldbrace_essence_altar")).toEqual({
      ok: true,
      value: { started: "recharged Air Staff to 1000" },
    });
    expect(fixture.inventory.countOf("air_essence")).toBe(before - 100);
    expect(weaponCharge(fixture.store.get(), "air_staff")).toBe(1000);
  });

  it("requires a charged elemental weapon and never takes Essence on failure", () => {
    const fixture = runtime();
    const before = fixture.inventory.countOf("air_essence");
    const result = fixture.essence.recharge("coldbrace_essence_altar");
    expect(result.ok).toBe(false);
    expect(fixture.inventory.countOf("air_essence")).toBe(before);
  });
});

describe("v3 focus migration", () => {
  it("converts an equipped focus and wand into a charged weapon without leaving a focus slot", () => {
    const legacy = createInitialState(908, 0);
    legacy.meta.saveVersion = 3;
    legacy.equipment.mainHand = { itemId: "palewood_wand", quantity: 1 };
    const old = legacy as unknown as {
      equipment: Record<string, { itemId: string; quantity: number } | null>;
      magic: { orbCharges: Record<string, number> };
    };
    old.equipment.focus = { itemId: "air_orb", quantity: 1 };
    old.magic = { orbCharges: { air_orb: 417 } };

    const migrated = migrate(legacy).state;
    expect(migrated?.meta.saveVersion).toBe(5);
    expect(migrated?.equipment.mainHand).toEqual({ itemId: "air_wand", quantity: 1 });
    expect((migrated?.equipment as unknown as Record<string, unknown>).focus).toBeUndefined();
    expect(migrated?.magic.weaponCharges.air_wand).toBe(417);
    expect(migrated?.magic.consumedOrbs.air_orb).toBe(true);
  });
});
