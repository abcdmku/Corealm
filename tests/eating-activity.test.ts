import { beforeAll, describe, expect, it } from "vitest";
import type { ItemId } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { EventBus } from "../game/src/core/events.js";
import { Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import { EatingSystem } from "../game/src/systems/eating.js";
import { EAT_DURATION_MS, InventorySystem } from "../game/src/systems/inventory.js";

beforeAll(() => {
  content.register({ items: ALL_ITEMS });
});

interface Harness {
  store: Store;
  events: EventBus;
  activity: ActivitySystem;
  inventory: InventorySystem;
  setNow(atMs: number): void;
  tick(atMs: number): void;
  addFood(itemId?: ItemId): void;
}

function harness(wireEating = true): Harness {
  const store = new Store(1337, 0);
  const events = new EventBus();
  const activity = new ActivitySystem(store, events);
  let nowMs = 0;
  let eating: EatingSystem | undefined;
  const inventory = new InventorySystem({
    store,
    events,
    now: () => nowMs,
    ...(wireEating
      ? {
          beginEating: (itemId: ItemId, durationMs: number, atMs: number) =>
            eating?.beginEating(itemId, durationMs, atMs) ?? false,
        }
      : {}),
  });
  if (wireEating) eating = new EatingSystem({ store, activity, inventory });

  return {
    store,
    events,
    activity,
    inventory,
    setNow(atMs: number): void { nowMs = atMs; },
    tick(atMs: number): void {
      nowMs = atMs;
      activity.tick(100, atMs);
      events.flush();
    },
    addFood(itemId = "seared_minnow"): void {
      const added = inventory.addItem(itemId, 1);
      if (!added.ok) throw new Error(added.error.message);
      events.flush();
    },
  };
}

describe("deferred eating activity", () => {
  it("consumes and heals only when the 1.8-second activity completes", () => {
    const h = harness();
    h.addFood();
    h.store.get().player.health = 10;
    const beforeCount = h.inventory.countOf("seared_minnow");

    const started = h.inventory.use("seared_minnow");

    expect(started).toEqual({ ok: true, value: { effect: "started eating Seared Minnow" } });
    expect(h.store.get().activity).toEqual({
      kind: "eating", itemId: "seared_minnow", endsAtMs: EAT_DURATION_MS,
    });
    expect(h.inventory.countOf("seared_minnow")).toBe(beforeCount);
    expect(h.store.get().player.health).toBe(10);

    h.tick(EAT_DURATION_MS - 1);
    expect(h.inventory.countOf("seared_minnow")).toBe(beforeCount);
    expect(h.store.get().player.health).toBe(10);

    h.tick(EAT_DURATION_MS);
    expect(h.store.get().activity).toBeNull();
    expect(h.inventory.countOf("seared_minnow")).toBe(beforeCount - 1);
    expect(h.store.get().player.health).toBe(13);

    const stopped = h.events.since(0, ["activity.stopped"]).events.at(-1);
    expect(stopped?.data).toMatchObject({
      kind: "eating", reason: "completed", completed: 1, remaining: 0,
      itemId: "seared_minnow", restored: 3,
    });
    const lost = h.events.since(0, ["item.lost"]).events.at(-1);
    expect(lost?.atMs).toBe(EAT_DURATION_MS);
    expect(lost?.data).toMatchObject({ itemId: "seared_minnow", quantity: 1 });
  });

  it("leaves food and health untouched when cancelled before completion", () => {
    const h = harness();
    h.addFood();
    h.store.get().player.health = 9;
    const beforeCount = h.inventory.countOf("seared_minnow");
    expect(h.inventory.use("seared_minnow").ok).toBe(true);

    h.setNow(900);
    expect(h.activity.cancel(900)).toBe(true);
    h.events.flush();

    expect(h.store.get().activity).toBeNull();
    expect(h.inventory.countOf("seared_minnow")).toBe(beforeCount);
    expect(h.store.get().player.health).toBe(9);
    expect(h.events.since(0, ["item.lost"]).events).toHaveLength(0);
  });

  it("leaves food untouched when death or a replacement interrupts the timer", () => {
    const dead = harness();
    dead.addFood();
    const deadCount = dead.inventory.countOf("seared_minnow");
    expect(dead.inventory.use("seared_minnow").ok).toBe(true);
    dead.store.get().player.health = 0;
    dead.tick(500);
    expect(dead.store.get().activity).toBeNull();
    expect(dead.inventory.countOf("seared_minnow")).toBe(deadCount);
    expect(dead.events.since(0, ["activity.stopped"]).events.at(-1)?.data.reason).toBe("dead");

    const replaced = harness();
    replaced.addFood();
    const replacedCount = replaced.inventory.countOf("seared_minnow");
    expect(replaced.inventory.use("seared_minnow").ok).toBe(true);
    replaced.activity.start({ kind: "traversing", obstacleId: "ledge", endsAtMs: 2_000 }, 400);
    replaced.events.flush();
    expect(replaced.store.get().activity?.kind).toBe("traversing");
    expect(replaced.inventory.countOf("seared_minnow")).toBe(replacedCount);
    const stops = replaced.events.since(0, ["activity.stopped"]).events;
    expect(stops.at(-1)?.data).toMatchObject({ kind: "eating", reason: "replaced", completed: 0 });
  });

  it("blocks dead, attacking, busy, and repeated use without replacing the activity", () => {
    const dead = harness();
    dead.addFood();
    dead.store.get().player.health = 0;
    const deadResult = dead.inventory.use("seared_minnow");
    expect(deadResult.ok).toBe(false);
    if (!deadResult.ok) expect(deadResult.error.code).toBe("DEAD");

    const attacking = harness();
    attacking.addFood();
    attacking.store.get().combat.targetId = "enemy_test";
    const attackResult = attacking.inventory.use("seared_minnow");
    expect(attackResult.ok).toBe(false);
    if (!attackResult.ok) expect(attackResult.error.code).toBe("BUSY");
    expect(attacking.store.get().activity).toBeNull();

    const busy = harness();
    busy.addFood();
    busy.store.get().activity = { kind: "traversing", obstacleId: "ledge", endsAtMs: 5_000 };
    const busyResult = busy.inventory.use("seared_minnow");
    expect(busyResult.ok).toBe(false);
    if (!busyResult.ok) expect(busyResult.error.code).toBe("BUSY");
    expect(busy.store.get().activity?.kind).toBe("traversing");

    const repeated = harness();
    repeated.addFood();
    repeated.addFood();
    const beforeCount = repeated.inventory.countOf("seared_minnow");
    expect(repeated.inventory.use("seared_minnow").ok).toBe(true);
    const firstActivity = repeated.store.get().activity;
    const repeatedResult = repeated.inventory.use("seared_minnow");
    expect(repeatedResult.ok).toBe(false);
    if (!repeatedResult.ok) expect(repeatedResult.error.code).toBe("BUSY");
    expect(repeated.store.get().activity).toBe(firstActivity);
    expect(repeated.inventory.countOf("seared_minnow")).toBe(beforeCount);
  });

  it("fails losslessly if an attack is targeted during the timer", () => {
    const h = harness();
    h.addFood();
    h.store.get().player.health = 8;
    const beforeCount = h.inventory.countOf("seared_minnow");
    expect(h.inventory.use("seared_minnow").ok).toBe(true);

    h.store.get().combat.targetId = "enemy_test";
    h.tick(400);

    expect(h.store.get().activity).toBeNull();
    expect(h.inventory.countOf("seared_minnow")).toBe(beforeCount);
    expect(h.store.get().player.health).toBe(8);
    const stopped = h.events.since(0, ["activity.stopped"]).events.at(-1);
    expect(stopped?.data).toMatchObject({ kind: "eating", reason: "failed", completed: 0 });
  });

  it("clamps healing at max health but consumes a completed food", () => {
    const h = harness();
    h.addFood("seared_cragfin");
    h.store.get().player.health = h.store.get().player.maxHealth - 2;
    const beforeCount = h.inventory.countOf("seared_cragfin");

    expect(h.inventory.use("seared_cragfin").ok).toBe(true);
    h.tick(EAT_DURATION_MS);

    expect(h.store.get().player.health).toBe(h.store.get().player.maxHealth);
    expect(h.inventory.countOf("seared_cragfin")).toBe(beforeCount - 1);
    const stopped = h.events.since(0, ["activity.stopped"]).events.at(-1);
    expect(stopped?.data).toMatchObject({ reason: "completed", restored: 2 });
  });

  it("does not consume food when the eating driver is not wired", () => {
    const h = harness(false);
    h.addFood();
    const beforeCount = h.inventory.countOf("seared_minnow");

    const result = h.inventory.use("seared_minnow");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAVAILABLE");
    expect(h.inventory.countOf("seared_minnow")).toBe(beforeCount);
    expect(h.store.get().activity).toBeNull();
  });
});
