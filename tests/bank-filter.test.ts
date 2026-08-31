import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import { EventBus } from "../game/src/core/events.js";
import { Store } from "../game/src/state/store.js";
import { BankSystem } from "../game/src/systems/bank.js";
import { InventorySystem } from "../game/src/systems/inventory.js";

const originalContent: ContentTables = {
  items: [...content.allItems()],
  resources: [...content.allResources()],
  recipes: [...content.allRecipes()],
  spells: [...content.allSpells()],
  enemies: [...content.allEnemies()],
  shops: [...content.allShops()],
};

beforeAll(() => {
  content.register({ items: ALL_ITEMS });
});

afterAll(() => {
  content.register(originalContent);
});

function runtime() {
  const store = new Store(91, 0);
  store.get().inventory.slots.fill(null);
  const events = new EventBus();
  const inventory = new InventorySystem({ store, events, now: () => 100 });
  const bank = new BankSystem({
    store,
    events,
    inventory,
    now: () => 100,
    inRangeOfBank: () => true,
  });
  return { store, inventory, bank };
}

describe("bank filters", () => {
  it("keeps list filters request-scoped and deposits every carried item afterward", () => {
    const fixture = runtime();
    fixture.store.get().bank.slots = [
      { itemId: "air_orb", quantity: 1 },
      { itemId: "earth_essence", quantity: 25 },
    ];
    expect(fixture.inventory.addItem("air_essence", 120).ok).toBe(true);
    expect(fixture.inventory.addItem("palewood_log", 2).ok).toBe(true);

    const filtered = fixture.bank.op("list", { filter: "orb" });
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) return;
    expect(filtered.value.slots).toEqual([{ itemId: "air_orb", quantity: 1 }]);
    expect(filtered.value.usedSlots).toBe(2);
    expect(fixture.store.get().bank.filter).toBe("");

    const unfiltered = fixture.bank.op("list");
    expect(unfiltered.ok).toBe(true);
    if (!unfiltered.ok) return;
    expect(unfiltered.value.slots.map((stack) => stack.itemId)).toEqual([
      "air_orb",
      "earth_essence",
    ]);

    const withdrawn = fixture.bank.op("withdraw", { itemId: "earth_essence", quantity: 5 });
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    expect(withdrawn.value.slots).toEqual([
      { itemId: "air_orb", quantity: 1 },
      { itemId: "earth_essence", quantity: 20 },
    ]);

    expect(fixture.bank.op("depositAll").ok).toBe(true);
    expect(fixture.inventory.countOf("air_essence")).toBe(0);
    expect(fixture.inventory.countOf("palewood_log")).toBe(0);
    expect(fixture.store.get().bank.slots).toEqual(expect.arrayContaining([
      { itemId: "air_orb", quantity: 1 },
      { itemId: "earth_essence", quantity: 25 },
      { itemId: "air_essence", quantity: 120 },
      { itemId: "palewood_log", quantity: 2 },
    ]));
  });

  it("ignores a legacy persisted filter during deposit-all", () => {
    const fixture = runtime();
    fixture.store.get().bank.filter = "orb";
    fixture.store.get().bank.slots = [
      { itemId: "air_orb", quantity: 1 },
      { itemId: "earth_essence", quantity: 25 },
    ];
    expect(fixture.inventory.addItem("water_essence", 100).ok).toBe(true);

    const listed = fixture.bank.op("list");
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.slots.map((stack) => stack.itemId)).toEqual([
      "air_orb",
      "earth_essence",
    ]);

    expect(fixture.bank.op("depositAll").ok).toBe(true);
    expect(fixture.inventory.countOf("water_essence")).toBe(0);
    expect(fixture.store.get().bank.slots).toContainEqual({ itemId: "water_essence", quantity: 100 });
  });
});
