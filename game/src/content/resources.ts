/**
 * Gatherable resource catalog.
 *
 * Mining, woodcutting, and fishing rows are generated directly from the canonical tier catalog.
 * Farming remains separate because its wall-clock crop lifecycle is outside this foundation.
 */
import type { ResourceDef } from "./index.js";
import { gatherXp } from "./index.js";
import { GATHERING_PRODUCTION_TIERS } from "./gatheringProductionTiers.js";

const ESSENCE_RESOURCES: readonly ResourceDef[] = GATHERING_PRODUCTION_TIERS.map((definition) => {
  const label = definition.magic.element === "wind"
    ? "Air"
    : `${definition.magic.element[0]?.toUpperCase() ?? ""}${definition.magic.element.slice(1)}`;
  return {
    id: `essence_${definition.magic.element === "wind" ? "air" : definition.magic.element}`,
    name: `${label} Essence Cache`,
    archetype: "ore",
    skill: "mining",
    tier: definition.tier,
    reqLevel: definition.reqLevel,
    itemId: definition.magic.essence,
    yieldRange: [40, 90],
    respawnSeconds: 30,
    presentation: {
      availableAssetIds: ["rocks_free_essence_node"],
      targetWorldSize: 1.58,
      variantScale: [0.96, 1.04],
      materialTier: definition.tier,
    },
  };
});

const FARMING_RESOURCES: readonly ResourceDef[] = [
  {
    id: "plot_bittergrain", name: "Marchfield Plot", archetype: "farm_plot", skill: "farming",
    tier: 1, reqLevel: 1, itemId: "bittergrain",
    bonus: [{ itemId: "bittergrain_seed", chance: 0.30 }],
    presentation: { availableAssetIds: ["crop_carrot"], targetWorldSize: 1, materialTier: 1 },
  },
  {
    id: "plot_cairnleaf", name: "Highcairn Plot", archetype: "farm_plot", skill: "farming",
    tier: 10, reqLevel: 10, itemId: "cairnleaf",
    bonus: [{ itemId: "cairnleaf_seed", chance: 0.25 }],
    presentation: { availableAssetIds: ["crop_carrot"], targetWorldSize: 1, materialTier: 10 },
  },
];

/** Canonical archetypes only. Cluster aliases are deliberately unsupported. */
export const RESOURCES: readonly ResourceDef[] = [
  ...GATHERING_PRODUCTION_TIERS.flatMap((definition) => definition.resourceDefs),
  ...ESSENCE_RESOURCES,
  ...FARMING_RESOURCES,
];

const RESOURCE_BY_ID = new Map(RESOURCES.map((resource) => [resource.id, resource] as const));

/** Strict authoring lookup. A cluster with a missing resource reference is a boot-time error. */
export function resourceDef(resourceId: string): ResourceDef {
  const resource = RESOURCE_BY_ID.get(resourceId);
  if (!resource) throw new Error(`Unknown resource id "${resourceId}".`);
  return resource;
}

/** Canonical resource rows without cluster aliases. Useful for docs and guides. */
export const RESOURCE_ARCHETYPES: readonly ResourceDef[] = RESOURCES;

/**
 * PRD 2.9 farming, which the shared gather model does not cover on its own. Growth is wall-clock
 * driven and persists across reloads; `systems/farming.ts` owns the timers, this is the data.
 */
export interface CropDef {
  seedItemId: string;
  cropItemId: string;
  tier: number;
  reqLevel: number;
  stages: number;
  secondsPerStage: number;
  yieldRange: readonly [number, number];
  /** XP for each unit harvested. Equals gatherXp(tier): 10 / 24 / 35. */
  harvestXp: number;
  plantXp: number;
}

/** Raking a plot costs 1.8 s and pays 3 Farming XP at every tier (PRD 2.9). */
export const RAKE_XP = 3;
export const RAKE_DURATION_MS = 1800;

export const CROPS: readonly CropDef[] = [
  {
    seedItemId: "bittergrain_seed", cropItemId: "bittergrain", tier: 1, reqLevel: 1,
    stages: 4, secondsPerStage: 60, yieldRange: [3, 6], harvestXp: gatherXp(1), plantXp: 2,
  },
  {
    // PRD 2.9 authors Duskberry, but regions place farm plots only in Fallowmarch and Karrowmoor.
    seedItemId: "duskberry_seed", cropItemId: "duskberry", tier: 5, reqLevel: 5,
    stages: 5, secondsPerStage: 120, yieldRange: [3, 6], harvestXp: gatherXp(5), plantXp: 5,
  },
  {
    seedItemId: "cairnleaf_seed", cropItemId: "cairnleaf", tier: 10, reqLevel: 10,
    stages: 5, secondsPerStage: 180, yieldRange: [2, 5], harvestXp: gatherXp(10), plantXp: 7,
  },
];
