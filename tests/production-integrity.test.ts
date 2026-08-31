import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ItemDef, RecipeId, SemanticEntity, SkillId } from "../game/src/contracts.js";
import { SKILL_IDS } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import type { RecipeDef } from "../game/src/content/index.js";
import { content } from "../game/src/content/index.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { ProductionSystem } from "../game/src/systems/production.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const BENCH: SemanticEntity = {
  id: "test_fletching_bench",
  archetype: "station",
  name: "Test Fletching Bench",
  tier: 1,
  regionId: "fallowmarch",
  position: [0, 0, 0],
  state: "ready",
  interactions: ["produce"],
  station: { kind: "fletching_bench", skill: "fletching", recipeIds: [] },
};

const RANGE: SemanticEntity = {
  id: "test_range",
  archetype: "station",
  name: "Test Range",
  tier: 1,
  regionId: "fallowmarch",
  position: [0, 0, 0],
  state: "ready",
  interactions: ["produce"],
  station: { kind: "range", skill: "cooking", recipeIds: [] },
};

const CUSTOM_ITEMS: readonly ItemDef[] = [
  {
    id: "test_raw_stack", name: "Test Raw Stack", tier: 1,
    description: "A stackable test ingredient.", stackable: true, value: 1, category: "resource",
  },
  {
    id: "test_cooked_stack", name: "Test Cooked Stack", tier: 1,
    description: "A stackable successful result.", stackable: true, value: 1, category: "food",
  },
  {
    id: "test_burnt_piece", name: "Test Burnt Piece", tier: 1,
    description: "A non-stackable burnt result.", stackable: false, value: 1, category: "food",
  },
];

const CUSTOM_RECIPE: RecipeDef = {
  id: "cook_test_stack",
  name: "Cook Test Stack",
  kind: "cook",
  skill: "cooking",
  reqLevel: 1,
  tier: 1,
  stations: ["range"],
  inputs: [{ itemId: "test_raw_stack", quantity: 1 }],
  output: { itemId: "test_cooked_stack", quantity: 1 },
  durationMs: 1_800,
  xp: 10,
  burntItemId: "test_burnt_piece",
};

interface Harness {
  store: Store;
  events: EventBus;
  activity: ActivitySystem;
  inventory: InventorySystem;
  production: ProductionSystem;
  entities: SemanticEntity[];
  dispatcher: InteractionDispatcher;
  rng: RngStreams;
}

function skillLevels(store: Store): Record<SkillId, number> {
  const levels = {} as Record<SkillId, number>;
  for (const skill of SKILL_IDS) levels[skill] = store.get().skills[skill].level;
  return levels;
}

function harness(extraEntities: readonly SemanticEntity[] = []): Harness {
  const store = new Store(1337, 0);
  store.get().inventory.slots.fill(null);
  store.get().player.position = [0, 0, 0];
  store.get().player.regionId = "fallowmarch";

  const events = new EventBus();
  const activity = new ActivitySystem(store, events);
  const inventory = new InventorySystem({ store, events, now: () => 0 });
  const entities = [BENCH, RANGE, ...extraEntities].map((entity) => ({ ...entity }));
  const dispatcher = new InteractionDispatcher({
    get: (id) => entities.find((entity) => entity.id === id),
    playerPosition: () => store.get().player.position,
    skillLevels: () => skillLevels(store),
  });
  const rng = new RngStreams(1337);
  const production = new ProductionSystem({
    store,
    events,
    rng,
    entities: {
      get: (id) => entities.find((entity) => entity.id === id),
      all: () => entities,
    },
    inventory,
    activity,
    dispatcher,
  });

  return { store, events, activity, inventory, production, entities, dispatcher, rng };
}

function requireRecipe(id: RecipeId): RecipeDef {
  const recipe = content.recipe(id);
  if (!recipe) throw new Error(`Missing test recipe ${id}`);
  return recipe;
}

function requireStarted(result: ReturnType<ProductionSystem["produce"]>): void {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
}

beforeEach(() => {
  content.register({ items: [...ALL_ITEMS, ...CUSTOM_ITEMS], recipes: [...RECIPES, CUSTOM_RECIPE] });
});

afterAll(() => {
  content.register({ items: ALL_ITEMS, recipes: RECIPES });
});

describe("ProductionSystem inventory transactions", () => {
  it("does not consume stackable inputs when a full bag gains no output slot", () => {
    const h = harness();
    h.inventory.addItem("palewood_shaft", 4);
    h.inventory.addItem("pale_quartz", 2);
    h.inventory.addItem("grithe_ore", 26);
    h.events.reset();

    const result = h.production.produceAt(BENCH.id, "fletch_palewood_staff", 1);

    expect(result).toMatchObject({ ok: false, error: { code: "INVENTORY_FULL" } });
    expect(h.inventory.countItem("palewood_shaft")).toBe(4);
    expect(h.inventory.countItem("pale_quartz")).toBe(2);
    expect(h.inventory.countItem("palewood_staff")).toBe(0);
    expect(h.store.get().skills.fletching.xp).toBe(0);
    expect(h.store.get().activity).toBeNull();
  });

  it("stops without mutation when the last slot fills after a batch starts", () => {
    const h = harness();
    const recipe = requireRecipe("fletch_palewood_staff");
    h.inventory.addItem("palewood_shaft", 4);
    h.inventory.addItem("pale_quartz", 2);
    h.inventory.addItem("grithe_ore", 25);
    requireStarted(h.production.produceAt(BENCH.id, recipe.id, 1));
    h.inventory.addItem("grithe_ore", 1);
    h.events.reset();

    h.activity.tick(recipe.durationMs, recipe.durationMs);
    h.events.flush();

    expect(h.inventory.countItem("palewood_shaft")).toBe(4);
    expect(h.inventory.countItem("pale_quartz")).toBe(2);
    expect(h.inventory.countItem("palewood_staff")).toBe(0);
    expect(h.store.get().skills.fletching.xp).toBe(0);
    expect(h.store.get().activity).toBeNull();
    expect(h.events.since(0, ["production.completed"]).events).toHaveLength(0);
    expect(h.events.since(0, ["activity.stopped"]).events).toHaveLength(1);
    expect(h.events.since(0, ["activity.stopped"]).events[0]?.data.reason).toBe("inventory-full");
  });

  it("reserves room for a possible burnt result before cooking starts", () => {
    const h = harness();
    h.inventory.addItem("test_raw_stack", 2);
    h.inventory.addItem("test_cooked_stack", 1);
    h.inventory.addItem("grithe_ore", 26);
    h.events.reset();

    const result = h.production.produceAt(RANGE.id, CUSTOM_RECIPE.id, 1);

    expect(result).toMatchObject({ ok: false, error: { code: "INVENTORY_FULL" } });
    expect(h.inventory.countItem("test_raw_stack")).toBe(2);
    expect(h.inventory.countItem("test_cooked_stack")).toBe(1);
    expect(h.inventory.countItem("test_burnt_piece")).toBe(0);
    expect(h.store.get().skills.cooking.xp).toBe(0);
  });

  it("emits one receipt and one canonical stop when a requested batch exhausts ingredients", () => {
    const h = harness();
    const recipe = requireRecipe("fletch_palewood_shaft");
    h.inventory.addItem("palewood_log", 1);
    requireStarted(h.production.produceAt(BENCH.id, recipe.id, 2));
    h.events.reset();

    h.activity.tick(recipe.durationMs * 2, recipe.durationMs * 2);
    h.events.flush();

    const receipts = h.events.since(0, ["item.received"]).events;
    const stops = h.events.since(0, ["activity.stopped"]).events;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      entityId: BENCH.id,
      data: { itemId: "palewood_shaft", quantity: 4 },
    });
    expect(stops).toHaveLength(1);
    expect(stops[0]?.data.reason).toBe("failed");
    expect(h.events.since(0, ["production.completed"]).events).toHaveLength(1);
    expect(h.inventory.countItem("palewood_log")).toBe(0);
    expect(h.inventory.countItem("palewood_shaft")).toBe(4);
    expect(h.store.get().skills.fletching.xp).toBe(recipe.xp);
  });

  it("uses the reseeded cooking stream and reset simulation clock", () => {
    const h = harness();
    const recipe = requireRecipe("cook_seared_minnow");
    h.inventory.addItem("silt_minnow", 1);
    requireStarted(h.production.produceAt(RANGE.id, recipe.id, 1));
    h.events.reset();
    h.activity.tick(recipe.durationMs, recipe.durationMs);
    h.events.flush();
    const firstItem = h.events.since(0, ["item.received"]).events[0]?.data.itemId;

    h.store.get().inventory.slots.fill(null);
    h.rng.reseed(1337);
    h.production.tick(0, 10_000);
    h.production.reset(0);
    h.inventory.addItem("silt_minnow", 1);
    h.events.reset();
    requireStarted(h.production.produceAt(RANGE.id, recipe.id, 1));
    expect(h.store.get().activity).toMatchObject({ nextCompleteAtMs: recipe.durationMs });
    h.activity.tick(recipe.durationMs, recipe.durationMs);
    h.events.flush();
    const replayedItem = h.events.since(0, ["item.received"]).events[0]?.data.itemId;

    expect(firstItem).toBe("seared_minnow");
    expect(replayedItem).toBe(firstItem);
  });
});

describe("ProductionSystem exact station selection", () => {
  it("uses the selected station and rejects a different region or vertical out-of-range position", () => {
    const otherRegion: SemanticEntity = {
      ...BENCH,
      id: "other_region_bench",
      name: "Other Region Bench",
      regionId: "vellenwood",
    };
    const overhead: SemanticEntity = {
      ...BENCH,
      id: "overhead_bench",
      name: "Overhead Bench",
      position: [0, 3, 0],
    };
    const h = harness([otherRegion, overhead]);
    h.inventory.addItem("palewood_log", 1);

    expect(h.production.produceAt(otherRegion.id, "fletch_palewood_shaft", 1)).toMatchObject({
      ok: false, error: { code: "OUT_OF_RANGE", entityId: otherRegion.id },
    });
    expect(h.production.produceAt(overhead.id, "fletch_palewood_shaft", 1)).toMatchObject({
      ok: false, error: { code: "OUT_OF_RANGE", entityId: overhead.id },
    });

    requireStarted(h.production.produceAt(BENCH.id, "fletch_palewood_shaft", 1));
    expect(h.store.get().activity).toMatchObject({ kind: "production", stationId: BENCH.id });
  });

  it("keeps the interaction bound to the station that was clicked", () => {
    const secondBench: SemanticEntity = {
      ...BENCH,
      id: "second_bench",
      name: "Second Bench",
      position: [0.5, 0, 0],
    };
    const h = harness([secondBench]);
    h.inventory.addItem("palewood_log", 1);

    const result = h.dispatcher.run(secondBench.id, "produce");

    expect(result.ok).toBe(true);
    expect(h.store.get().activity).toMatchObject({ kind: "production", stationId: secondBench.id });
  });

  it("ends an active batch when the player changes region or leaves the full 3D leash", () => {
    const recipe = requireRecipe("fletch_palewood_shaft");
    const region = harness();
    region.inventory.addItem("palewood_log", 1);
    requireStarted(region.production.produceAt(BENCH.id, recipe.id, 1));
    region.store.get().player.regionId = "vellenwood";
    region.activity.tick(recipe.durationMs, recipe.durationMs);
    expect(region.store.get().activity).toBeNull();

    const vertical = harness();
    vertical.inventory.addItem("palewood_log", 1);
    requireStarted(vertical.production.produceAt(BENCH.id, recipe.id, 1));
    vertical.store.get().player.position = [0, 3.1, 0];
    vertical.activity.tick(recipe.durationMs, recipe.durationMs);
    expect(vertical.store.get().activity).toBeNull();
    expect(vertical.inventory.countItem("palewood_log")).toBe(1);
  });
});
