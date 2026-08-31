import { describe, expect, it } from "vitest";
import type { ItemId, RegionId, Result, SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { err, ok } from "../game/src/contracts.js";
import type { CampfireFuelDef } from "../game/src/content/index.js";
import { EventBus } from "../game/src/core/events.js";
import { Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import {
  CAMPFIRE_BUILD_TIME_MS,
  CAMPFIRE_ENTITY_ID,
  CampfireSystem,
  type CampfireEntityPort,
  type CampfireInventoryPort,
  type CampfirePlacementProbes,
} from "../game/src/systems/campfire.js";

const FUELS: readonly CampfireFuelDef[] = [
  {
    logItemId: "palewood_log", tier: 1, buildTimeMs: 3_000, lifetimeMs: 72_000,
    buildXp: { fletching: 2, crafting: 2 }, visualLogAssetId: "woodlog",
  },
  {
    logItemId: "duskoak_log", tier: 5, buildTimeMs: 3_000, lifetimeMs: 120_000,
    buildXp: { fletching: 5, crafting: 5 }, visualLogAssetId: "woodlog_moss",
  },
  {
    logItemId: "cairnpine_log", tier: 10, buildTimeMs: 3_000, lifetimeMs: 180_000,
    buildXp: { fletching: 7, crafting: 7 }, visualLogAssetId: "woodlog_snow",
  },
] as const;

class TestInventory implements CampfireInventoryPort {
  readonly counts = new Map<ItemId, number>();

  countItem(itemId: ItemId): number {
    return this.counts.get(itemId) ?? 0;
  }

  removeItem(itemId: ItemId, quantity: number): Result<number> {
    const held = this.countItem(itemId);
    if (held < quantity) return err("NOT_ENOUGH_ITEMS", "missing test item");
    this.counts.set(itemId, held - quantity);
    return ok(quantity);
  }
}

class TestEntities implements CampfireEntityPort {
  readonly rows = new Map<string, SemanticEntity>();

  get(id: string): SemanticEntity | undefined {
    return this.rows.get(id);
  }

  add(entity: SemanticEntity): void {
    this.rows.set(entity.id, entity);
  }

  remove(id: string): boolean {
    return this.rows.delete(id);
  }
}

interface Harness {
  store: Store;
  events: EventBus;
  activity: ActivitySystem;
  inventory: TestInventory;
  entities: TestEntities;
  system: CampfireSystem;
  setNow(atMs: number): void;
  finishBuild(atMs?: number): void;
  eventTypes(): string[];
}

function harness(placementOverrides: Partial<CampfirePlacementProbes> = {}): Harness {
  const store = new Store(1337, 0);
  store.get().player.position = [0, 0, 0];
  store.get().player.facingRad = 0;
  store.get().player.regionId = "fallowmarch";

  const events = new EventBus();
  const activity = new ActivitySystem(store, events);
  const inventory = new TestInventory();
  const entities = new TestEntities();
  let nowMs = 0;

  const placement: CampfirePlacementProbes = {
    groundAt: (_regionId: RegionId, _x: number, _z: number) => ({ y: 4, normal: [0, 1, 0] }),
    withinPlayableBounds: (_regionId: RegionId, _position: Vec3) => true,
    distanceToWater: (_regionId: RegionId, _position: Vec3) => Number.POSITIVE_INFINITY,
    clearAt: (_regionId: RegionId, _position: Vec3, _radius: number) => true,
    ...placementOverrides,
  };

  const system = new CampfireSystem({
    store,
    events,
    activity,
    inventory,
    entities,
    placement,
    fuelFor: (logItemId) => FUELS.find((fuel) => fuel.logItemId === logItemId),
    now: () => nowMs,
  });

  return {
    store,
    events,
    activity,
    inventory,
    entities,
    system,
    setNow(atMs: number): void { nowMs = atMs; },
    finishBuild(atMs = nowMs + CAMPFIRE_BUILD_TIME_MS): void {
      nowMs = atMs;
      activity.tick(CAMPFIRE_BUILD_TIME_MS, atMs);
      events.flush();
    },
    eventTypes(): string[] {
      events.flush();
      return events.since(0).events.map((event) => event.type);
    },
  };
}

function requireStarted(
  result: ReturnType<CampfireSystem["build"]>,
): Extract<typeof result, { ok: true }>["value"] {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("CampfireSystem", () => {
  it.each([
    ["missing ground", { groundAt: (): null => null }],
    ["outside playable bounds", { withinPlayableBounds: () => false }],
    ["within one metre of water", { distanceToWater: () => 0.99 }],
    ["blocked by world geometry", { clearAt: () => false }],
    [
      "over a 15 degree slope",
      {
        groundAt: (): { y: number; normal: Vec3 } => ({
          y: 4,
          normal: [Math.sin(16 * Math.PI / 180), Math.cos(16 * Math.PI / 180), 0] as Vec3,
        }),
      },
    ],
  ] as const)("rejects placement with %s", (_label, placement) => {
    const h = harness(placement);
    h.inventory.counts.set("palewood_log", 1);

    const result = h.system.build("palewood_log");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_REACHABLE");
    expect(h.store.get().activity).toBeNull();
    expect(h.inventory.countItem("palewood_log")).toBe(1);
  });

  it("tries the deterministic fan in order and stays within interaction reach", () => {
    let probes = 0;
    const h = harness({
      clearAt: () => {
        probes += 1;
        return probes > 1;
      },
    });
    h.inventory.counts.set("palewood_log", 1);

    const started = requireStarted(h.system.build("palewood_log"));

    expect(started.position[0]).toBeLessThan(0);
    expect(started.position[1]).toBe(4);
    expect(Math.hypot(started.position[0], started.position[2])).toBeCloseTo(1.5, 8);
    expect(probes).toBe(2);
  });

  it("rejects dead, combat, busy, unowned, and non-fuel builds", () => {
    const dead = harness();
    dead.store.get().player.health = 0;
    expect(dead.system.build("palewood_log")).toMatchObject({ ok: false, error: { code: "DEAD" } });

    const combat = harness();
    combat.inventory.counts.set("palewood_log", 1);
    combat.store.get().combat.engagedBy.push("marchwolf_1");
    expect(combat.system.build("palewood_log")).toMatchObject({ ok: false, error: { code: "BUSY" } });

    const busy = harness();
    busy.inventory.counts.set("palewood_log", 1);
    busy.activity.start({ kind: "eating", itemId: "seared_minnow", endsAtMs: 1_800 }, 0);
    expect(busy.system.build("palewood_log")).toMatchObject({ ok: false, error: { code: "BUSY" } });

    const unowned = harness();
    expect(unowned.system.build("palewood_log")).toMatchObject({
      ok: false, error: { code: "NOT_ENOUGH_ITEMS" },
    });
    expect(unowned.system.build("not_a_log")).toMatchObject({
      ok: false, error: { code: "INVALID_ARGUMENT" },
    });
  });

  it("consumes nothing and awards no XP when a build is interrupted", () => {
    const h = harness();
    h.inventory.counts.set("palewood_log", 1);
    requireStarted(h.system.build("palewood_log"));

    h.activity.tick(1_000, 1_000);
    expect(h.activity.cancel(1_000)).toBe(true);

    expect(h.inventory.countItem("palewood_log")).toBe(1);
    expect(h.store.get().skills.fletching.xp).toBe(0);
    expect(h.store.get().skills.crafting.xp).toBe(0);
    expect(h.store.get().world.campfire).toBeNull();
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)).toBeUndefined();
  });

  it("leaves an existing fire intact until its replacement succeeds", () => {
    const h = harness();
    h.inventory.counts.set("palewood_log", 1);
    requireStarted(h.system.build("palewood_log"));
    h.finishBuild(3_000);

    h.events.reset();
    h.inventory.counts.set("duskoak_log", 1);
    h.setNow(4_000);
    requireStarted(h.system.build("duskoak_log"));

    expect(h.store.get().world.campfire?.logItemId).toBe("palewood_log");
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)?.meta?.logItemId).toBe("palewood_log");

    h.finishBuild(7_000);

    expect(h.store.get().world.campfire?.logItemId).toBe("duskoak_log");
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)?.meta?.logItemId).toBe("duskoak_log");
    const types = h.eventTypes();
    expect(types.indexOf("campfire.replaced")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("campfire.built")).toBeGreaterThan(types.indexOf("campfire.replaced"));
  });

  it("keeps the old fire when the replacement ingredient disappears before completion", () => {
    const h = harness();
    h.inventory.counts.set("palewood_log", 1);
    requireStarted(h.system.build("palewood_log"));
    h.finishBuild(3_000);

    h.inventory.counts.set("duskoak_log", 1);
    h.setNow(4_000);
    requireStarted(h.system.build("duskoak_log"));
    h.inventory.counts.set("duskoak_log", 0);
    h.finishBuild(7_000);

    expect(h.store.get().world.campfire?.logItemId).toBe("palewood_log");
    expect(h.store.get().skills.fletching.xp).toBe(2);
    expect(h.store.get().skills.crafting.xp).toBe(2);
  });

  it.each([
    ["palewood_log", 72_000, 2],
    ["duskoak_log", 120_000, 5],
    ["cairnpine_log", 180_000, 7],
  ] as const)("builds %s in exactly three seconds with its canonical lifetime and XP", (log, lifetimeMs, xp) => {
    const h = harness();
    h.inventory.counts.set(log, 1);

    const started = requireStarted(h.system.build(log));
    expect(started.lifetimeMs).toBe(lifetimeMs);
    expect(h.store.get().activity).toMatchObject({
      kind: "building_campfire", endsAtMs: CAMPFIRE_BUILD_TIME_MS,
    });

    h.activity.tick(CAMPFIRE_BUILD_TIME_MS - 1, CAMPFIRE_BUILD_TIME_MS - 1);
    expect(h.inventory.countItem(log)).toBe(1);
    expect(h.store.get().world.campfire).toBeNull();

    h.finishBuild(CAMPFIRE_BUILD_TIME_MS);

    expect(h.inventory.countItem(log)).toBe(0);
    expect(h.store.get().skills.fletching.xp).toBe(xp);
    expect(h.store.get().skills.crafting.xp).toBe(xp);
    expect(h.store.get().world.campfire?.expiresAtPlaySeconds).toBe(lifetimeMs / 1_000);

    const entity = h.entities.get(CAMPFIRE_ENTITY_ID);
    expect(entity).toMatchObject({
      archetype: "station",
      state: "lit",
      interactions: ["produce"],
      station: { kind: "campfire", skill: "cooking", recipeIds: [] },
      meta: { campfire: true, logItemId: log, remainingSeconds: lifetimeMs / 1_000 },
    });
  });

  it("reconstructs a saved fire and expires it only against played time", () => {
    const h = harness();
    h.store.get().meta.playSeconds = 10;
    h.store.get().world.campfire = {
      id: CAMPFIRE_ENTITY_ID,
      position: [8, 4, 9],
      regionId: "fallowmarch",
      logItemId: "palewood_log",
      tier: 1,
      expiresAtPlaySeconds: 82,
    };

    expect(h.system.reconstruct()).toBe(true);
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)?.meta?.remainingSeconds).toBe(72);

    // A large simulation/event timestamp does not represent time played and cannot age the fire.
    h.system.tick(0, 9_999_999);
    expect(h.store.get().world.campfire).not.toBeNull();
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)?.meta?.remainingSeconds).toBe(72);

    h.store.get().meta.playSeconds = 81.2;
    h.system.tick(0, 10_000_000);
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)?.meta?.remainingSeconds).toBe(1);

    h.store.get().meta.playSeconds = 82;
    h.system.tick(0, 10_000_100);
    h.events.flush();

    expect(h.store.get().world.campfire).toBeNull();
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)).toBeUndefined();
    expect(h.events.since(0, ["campfire.expired"]).events).toHaveLength(1);
  });

  it("normalizes fractional played-time drift for countdown, reconstruction, and expiry", () => {
    const h = harness();
    let playedSeconds = 0;
    for (let index = 0; index < 188; index += 1) playedSeconds += 0.1;
    h.store.get().meta.playSeconds = playedSeconds;
    h.inventory.counts.set("duskoak_log", 1);

    requireStarted(h.system.build("duskoak_log"));
    h.finishBuild(3_000);

    expect(playedSeconds).toBe(18.799999999999997);
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)?.meta?.remainingSeconds).toBe(120);

    h.entities.remove(CAMPFIRE_ENTITY_ID);
    expect(h.system.reconstruct()).toBe(true);
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)?.meta?.remainingSeconds).toBe(120);

    for (let index = 0; index < 1_200; index += 1) playedSeconds += 0.1;
    h.store.get().meta.playSeconds = playedSeconds;
    h.system.tick(100, 123_000);
    h.events.flush();

    expect(h.store.get().world.campfire).toBeNull();
    expect(h.entities.get(CAMPFIRE_ENTITY_ID)).toBeUndefined();
    expect(h.events.since(0, ["campfire.expired"]).events).toHaveLength(1);
  });
});
