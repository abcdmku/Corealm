import { describe, expect, it } from "vitest";
import type { LootContainerView, SemanticEntity } from "../game/src/contracts.js";
import { ok, SKILL_IDS } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { Store } from "../game/src/state/store.js";
import type { CombatEntityPort, CombatInventoryPort } from "../game/src/systems/combat.js";
import { DeathSystem } from "../game/src/systems/death.js";
import { interactionLabel } from "../game/src/ui/contextMenu.js";
import { lootGridColumns } from "../game/src/ui/lootReveal.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const BOX: SemanticEntity = {
  id: "loot_fenmite_1",
  archetype: "loot",
  name: "Fenmite's drop",
  tier: 1,
  regionId: "fallowmarch",
  position: [0, 0, 0],
  state: "available",
  interactions: ["inspect", "loot"],
};

function fixture() {
  const store = new Store(17, 0);
  const events = new EventBus();
  const removed: string[] = [];
  const received: { itemId: string; quantity: number }[] = [];
  const opened: LootContainerView[] = [];
  const entities: CombatEntityPort = {
    get: (id) => id === BOX.id ? BOX : undefined,
    all: () => [BOX],
    remove: (id) => { removed.push(id); return true; },
  };
  const inventory: CombatInventoryPort = {
    addItem: (itemId, quantity) => {
      received.push({ itemId, quantity });
      return ok(quantity);
    },
    removeItem: (_itemId, quantity) => ok(quantity),
    countItem: () => 0,
    freeSlots: () => 28,
    hasRoomFor: () => true,
  };
  const levels = Object.fromEntries(SKILL_IDS.map((skill) => [skill, 1])) as Record<(typeof SKILL_IDS)[number], number>;
  const dispatcher = new InteractionDispatcher({
    get: (id) => entities.get(id),
    playerPosition: () => store.get().player.position,
    skillLevels: () => levels,
  });
  const death = new DeathSystem({
    store,
    events,
    entities,
    inventory,
    dispatcher,
    respawn: { resolve: () => ({ position: [0, 0, 0], regionId: "fallowmarch" }) },
    onLootOpened: (container) => opened.push(container),
  });
  store.get().world.lootPiles[BOX.id] = {
    position: [...BOX.position],
    items: [
      { itemId: "grithe_ore", quantity: 2 },
      { itemId: "cairnleaf", quantity: 1 },
    ],
    expiresAtMs: 5_000,
    ownerOnly: true,
  };
  death.tick(0, 500);
  return { store, removed, received, opened, death };
}

describe("loot reveal", () => {
  it("calls world containers Open while preserving the loot gameplay verb", () => {
    expect(interactionLabel(BOX, "loot")).toBe("Open");
    expect(interactionLabel({ ...BOX, archetype: "enemy" }, "loot")).toBe("Loot");
  });

  it("sizes the grid to its real contents with no filler cells", () => {
    expect(lootGridColumns(1)).toBe(1);
    expect(lootGridColumns(3)).toBe(3);
    expect(lootGridColumns(7)).toBe(4);
  });

  it("opens a read-only snapshot without transferring or removing anything", () => {
    const h = fixture();

    expect(h.death.loot(BOX)).toEqual({ ok: true, value: { started: `opened ${BOX.name}` } });
    expect(h.opened).toEqual([{
      entityId: BOX.id,
      name: BOX.name,
      position: BOX.position,
      items: [
        { itemId: "grithe_ore", quantity: 2 },
        { itemId: "cairnleaf", quantity: 1 },
      ],
    }]);
    expect(h.received).toEqual([]);
    expect(h.removed).toEqual([]);
    expect(h.store.get().world.lootPiles[BOX.id]?.items).toHaveLength(2);
  });

  it("takes only the clicked stack and removes the box after the final explicit take", () => {
    const h = fixture();

    expect(h.death.take(BOX.id, 0)).toEqual({
      ok: true,
      value: {
        taken: [{ itemId: "grithe_ore", quantity: 2 }],
        remaining: [{ itemId: "cairnleaf", quantity: 1 }],
        containerEmpty: false,
      },
    });
    expect(h.received).toEqual([{ itemId: "grithe_ore", quantity: 2 }]);
    expect(h.removed).toEqual([]);

    expect(h.death.take(BOX.id, 0)).toEqual({
      ok: true,
      value: {
        taken: [{ itemId: "cairnleaf", quantity: 1 }],
        remaining: [],
        containerEmpty: true,
      },
    });
    expect(h.removed).toEqual([BOX.id]);
    expect(h.store.get().world.lootPiles[BOX.id]).toBeUndefined();
  });
});
