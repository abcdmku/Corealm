/**
 * The journal lists what a player could know: quests from regions they have set foot in, whose
 * chain prerequisites are done. Everything started or finished stays listed. This is the
 * information-parity guard for `corealm_quests` and `corealm_context`.
 */
import { describe, expect, it } from "vitest";
import type { SkillId } from "../game/src/contracts.js";
import { ok, SKILL_IDS } from "../game/src/contracts.js";
import { QUESTS } from "../game/src/content/quests.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { Store } from "../game/src/state/store.js";
import { QuestSystem, type QuestEntityPort, type QuestInventoryPort } from "../game/src/systems/quests.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

function runtime() {
  const store = new Store(1337, 0);
  const inventory: QuestInventoryPort = {
    addItem: (_itemId, quantity) => ok(quantity),
    removeItem: (_itemId, quantity) => ok(quantity),
    countItem: () => 0,
    hasRoomFor: () => true,
    addCurrency: (amount) => ok(amount),
  };
  const entities: QuestEntityPort = { get: () => undefined, setState: () => false };
  const skillLevels = (): Record<SkillId, number> => {
    const levels = {} as Record<SkillId, number>;
    for (const id of SKILL_IDS) levels[id] = store.get().skills[id].level;
    return levels;
  };
  const dispatcher = new InteractionDispatcher({ get: entities.get, playerPosition: () => store.get().player.position, skillLevels });
  const quests = new QuestSystem({
    store, events: new EventBus(), clock: new SimClock(), entities, inventory, xp: { award: () => undefined }, dispatcher,
  });
  return { store, quests };
}

describe("quest journal visibility", () => {
  it("lists only the starting region's root quests for a fresh character", () => {
    const { quests } = runtime();
    const listed = quests.summaries();
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThan(QUESTS.length);
    for (const quest of listed) {
      expect(quest.regionId).toBe("fallowmarch");
      expect(quest.status).toBe("unstarted");
      expect(quest.currentObjective).toBeNull();
      expect(quest.currentObjectiveRefs).toEqual([]);
    }
    const hiddenRegions = new Set(QUESTS.filter((def) => !listed.some((row) => row.id === def.id)).map((def) => def.regionId));
    expect(hiddenRegions.size).toBeGreaterThan(0);
  });

  it("reveals a region's quests once the region is discovered, prerequisites permitting", () => {
    const { store, quests } = runtime();
    const chained = QUESTS.find((def) => def.prerequisiteQuestIds.length > 0);
    const foreign = QUESTS.find((def) => def.regionId !== "fallowmarch" && def.prerequisiteQuestIds.length === 0);
    expect(foreign).toBeDefined();
    store.get().discovery.regions.push(foreign!.regionId);
    const after = quests.summaries();
    expect(after.some((row) => row.id === foreign!.id)).toBe(true);
    if (chained) {
      store.get().discovery.regions.push(chained.regionId);
      const withChain = quests.summaries();
      expect(withChain.some((row) => row.id === chained.id)).toBe(false);
      for (const prerequisite of chained.prerequisiteQuestIds) {
        store.get().quests[prerequisite] = { status: "complete", stage: 0, counters: {}, flags: {} };
      }
      expect(quests.summaries().some((row) => row.id === chained.id)).toBe(true);
    }
  });

  it("always lists a quest the player has started, wherever it is", () => {
    const { store, quests } = runtime();
    const foreign = QUESTS.find((def) => def.regionId !== "fallowmarch")!;
    store.get().quests[foreign.id] = { status: "active", stage: 0, counters: {}, flags: {} };
    const row = quests.summaries().find((entry) => entry.id === foreign.id);
    expect(row?.status).toBe("active");
    expect(row?.currentObjective).toBe(foreign.stages[0]!.objective);
  });
});
