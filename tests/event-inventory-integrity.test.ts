import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SemanticEntity, SkillId } from "../game/src/contracts.js";
import { SKILL_IDS } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { GATHER_TICK_MS, SimClock } from "../game/src/core/time.js";
import { setSkillLevel, Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import { GatheringSystem } from "../game/src/systems/gathering.js";
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

describe("event publication cursors", () => {
  it("does not advance a reader past an event waiting for the tick flush", () => {
    const events = new EventBus();
    events.emit("essence.recharged", { orbItemId: "air_orb" }, undefined, 900);

    const beforeFlush = events.since(0);
    expect(beforeFlush).toEqual({ events: [], nextSeq: 0 });
    expect(events.currentSeq()).toBe(0);

    events.flush();
    const afterFlush = events.since(beforeFlush.nextSeq);
    expect(afterFlush.events).toHaveLength(1);
    expect(afterFlush.events[0]).toMatchObject({
      seq: 1,
      type: "essence.recharged",
      atMs: 900,
      data: { orbItemId: "air_orb" },
    });
    expect(afterFlush.nextSeq).toBe(1);
    expect(events.currentSeq()).toBe(1);
  });
});

describe("inventory receipt ownership", () => {
  it("keeps ordinary inventory additions observable", () => {
    const store = new Store(82, 0);
    const events = new EventBus();
    const inventory = new InventorySystem({ store, events, now: () => 77 });

    expect(inventory.addItem("air_essence", 3)).toEqual({ ok: true, value: 3 });
    events.flush();

    expect(events.since(0, ["item.received"]).events).toEqual([
      expect.objectContaining({
        type: "item.received",
        atMs: 77,
        data: { itemId: "air_essence", name: "Air Essence", quantity: 3 },
      }),
    ]);
  });

  it("emits one contextual receipt for one successful gather yield", () => {
    const store = new Store(83, 0);
    setSkillLevel(store.get(), "mining", 99);
    const events = new EventBus();
    const clock = new SimClock();
    const inventory = new InventorySystem({ store, events, now: () => clock.elapsedMs });
    const activity = new ActivitySystem(store, events);
    const entity: SemanticEntity = {
      id: "test_air_essence_node",
      archetype: "ore",
      name: "Air Essence Node",
      tier: 1,
      regionId: "fallowmarch",
      position: [0, 0, 0],
      state: "available",
      requirements: { mining: 1 },
      interactions: ["mine"],
      resource: {
        itemId: "air_essence",
        remaining: 2,
        maxYields: 2,
        respawnSeconds: 30,
      },
      meta: { skill: "mining" },
    };
    const entities = new Map([[entity.id, entity]]);
    const levels = {} as Record<SkillId, number>;
    for (const skill of SKILL_IDS) levels[skill] = store.get().skills[skill].level;
    const dispatcher = new InteractionDispatcher({
      get: (id) => entities.get(id),
      playerPosition: () => store.get().player.position,
      skillLevels: () => ({ ...levels }),
    });
    const rng = new RngStreams(83);
    rng.get("gather").chance = () => true;
    const gathering = new GatheringSystem({
      store,
      events,
      clock,
      rng,
      entities: { get: (id) => entities.get(id) },
      inventory,
      activity,
      dispatcher,
    });

    const before = inventory.countOf("air_essence");
    expect(gathering.begin(entity, "mine").ok).toBe(true);
    activity.tick(GATHER_TICK_MS, GATHER_TICK_MS);
    events.flush();

    const receipts = events.since(0, ["item.received"]).events;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      entityId: entity.id,
      atMs: GATHER_TICK_MS,
      data: {
        itemId: "air_essence",
        name: "Air Essence",
        quantity: 1,
        source: "gather",
        skill: "mining",
      },
    });
    expect(inventory.countOf("air_essence")).toBe(before + 1);
  });
});
