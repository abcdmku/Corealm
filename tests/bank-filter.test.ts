import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SemanticEntity, SkillId } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import { EventBus } from "../game/src/core/events.js";
import { Store } from "../game/src/state/store.js";
import { BankSystem } from "../game/src/systems/bank.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

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

function runtime(inRange = true) {
  const store = new Store(91, 0);
  store.get().inventory.slots.fill(null);
  const events = new EventBus();
  const inventory = new InventorySystem({ store, events, now: () => 100 });
  const entity: SemanticEntity = {
    id: "test_bank",
    archetype: "bank",
    name: "Test Bank",
    tier: 1,
    regionId: "fallowmarch",
    position: [0, 0, 0],
    state: "closed",
    interactions: ["inspect", "bank"],
  };
  const skillLevels = (): Record<SkillId, number> => Object.fromEntries(
    Object.entries(store.get().skills).map(([id, skill]) => [id, skill.level]),
  ) as Record<SkillId, number>;
  const dispatcher = new InteractionDispatcher({
    get: (id) => id === entity.id ? entity : undefined,
    playerPosition: () => store.get().player.position,
    skillLevels,
  });
  let persistCalls = 0;
  const bank = new BankSystem({
    store,
    events,
    inventory,
    dispatcher,
    now: () => 100,
    inRangeOfBank: () => inRange,
    persist: () => { persistCalls += 1; },
  });
  return { store, events, inventory, bank, dispatcher, persistCalls: () => persistCalls };
}

describe("bank filters", () => {
  it("opens through the real interaction dispatcher and publishes the UI signal", () => {
    const fixture = runtime();
    const result = fixture.dispatcher.run("test_bank", "bank");
    expect(result).toEqual({ ok: true, value: { started: "banking at Test Bank" } });

    fixture.events.flush();
    expect(fixture.events.since(0, ["activity.started"]).events).toEqual([
      expect.objectContaining({
        type: "activity.started",
        entityId: "test_bank",
        atMs: 100,
        data: { kind: "bank", interaction: "bank" },
      }),
    ]);
    expect(fixture.store.get().activity).toBeNull();
  });

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

  it("moves exact quantities and persists each successful write before returning", () => {
    const fixture = runtime();
    expect(fixture.inventory.addItem("grithe_ore", 8).ok).toBe(true);

    const deposited = fixture.bank.op("deposit", { itemId: "grithe_ore", quantity: 5 });
    expect(deposited.ok).toBe(true);
    expect(fixture.inventory.countOf("grithe_ore")).toBe(3);
    expect(fixture.store.get().bank.slots).toContainEqual({ itemId: "grithe_ore", quantity: 5 });
    expect(fixture.persistCalls()).toBe(1);

    const withdrawn = fixture.bank.op("withdraw", { itemId: "grithe_ore", quantity: 5 });
    expect(withdrawn.ok).toBe(true);
    expect(fixture.inventory.countOf("grithe_ore")).toBe(8);
    expect(fixture.store.get().bank.slots).not.toContainEqual(expect.objectContaining({ itemId: "grithe_ore" }));
    expect(fixture.persistCalls()).toBe(2);
  });

  it("accepts the agent API's -1 quantity as all", () => {
    const fixture = runtime();
    expect(fixture.inventory.addItem("grithe_ore", 8).ok).toBe(true);

    expect(fixture.bank.op("deposit", { itemId: "grithe_ore", quantity: -1 }).ok).toBe(true);
    expect(fixture.inventory.countOf("grithe_ore")).toBe(0);
    expect(fixture.store.get().bank.slots).toContainEqual({ itemId: "grithe_ore", quantity: 8 });

    expect(fixture.bank.op("withdraw", { itemId: "grithe_ore", quantity: -1 }).ok).toBe(true);
    expect(fixture.inventory.countOf("grithe_ore")).toBe(8);
    expect(fixture.store.get().bank.slots).not.toContainEqual(expect.objectContaining({ itemId: "grithe_ore" }));
  });

  it("withdraws only what fits and leaves the rest in the bank", () => {
    const fixture = runtime();
    expect(fixture.inventory.addItem("worn_sword", 27).ok).toBe(true);
    fixture.store.get().bank.slots = [{ itemId: "palewood_log", quantity: 3 }];

    const result = fixture.bank.op("withdraw", { itemId: "palewood_log", quantity: 3 });
    expect(result.ok).toBe(true);
    expect(fixture.inventory.countOf("palewood_log")).toBe(1);
    expect(fixture.store.get().bank.slots).toEqual([{ itemId: "palewood_log", quantity: 2 }]);
  });

  it("refuses remote access and full-bank writes without moving or persisting anything", () => {
    const remote = runtime(false);
    expect(remote.bank.op("list")).toEqual({
      ok: false,
      error: { code: "OUT_OF_RANGE", message: "You need to be standing at a bank to use it" },
    });

    const full = runtime();
    full.store.get().bank.slots = Array.from({ length: 400 }, (_, index) => ({
      itemId: `test_item_${index}`,
      quantity: 1,
    }));
    expect(full.inventory.addItem("grithe_ore", 1).ok).toBe(true);
    const result = full.bank.op("deposit", { itemId: "grithe_ore", quantity: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVENTORY_FULL");
    expect(full.inventory.countOf("grithe_ore")).toBe(1);
    expect(full.store.get().bank.slots).toHaveLength(400);
    expect(full.persistCalls()).toBe(0);
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
