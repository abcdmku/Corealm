/**
 * Gatherable node archetypes for Mining, Woodcutting, Fishing and the harvest step of Farming.
 *
 * Owned by W-CONTENT.
 *
 * The lookup key matters here. `world/regionBuilder.ts` stamps every node entity with
 * `meta.clusterId`, taken from the cluster in `content/regions.ts` that spawned it, and there is no
 * other resource id on the entity. So this table publishes each archetype once under a readable id
 * AND once per cluster id, so `content.resource(entity.meta.clusterId)` resolves without the
 * gathering system needing a second lookup table. Two Kaldite seams and two cragfin tarns share an
 * archetype, which is exactly why the aliasing is data rather than a 1:1 rename.
 *
 * `itemId`, `skill`, `tier` and `reqLevel` are copied from the cluster definitions in regions.ts
 * and must stay in step with them. The gathering formulas themselves live in `content/index.ts`
 * (`gatherSuccessChance`, `gatherXp`, `yieldRange`, `respawnSeconds`) and are tier-driven, so
 * nothing tier-specific belongs in this file beyond the tier number.
 */
import type { ResourceDef } from "./index.js";
import { gatherXp } from "./index.js";

/**
 * One row per node archetype: twelve of them across the three regions.
 * Bonus drops are rolled independently per successful gather. Gems are the only secondary, and
 * they exist to feed Crafting (essence shards, rings, foci) off the back of Mining, which is the
 * wiring PRD section 0 asks for when it says magic must cost something.
 */
const ARCHETYPES: readonly ResourceDef[] = [
  // ------------------------------------------------------------------ Fallowmarch, tier 1
  {
    id: "ore_grithe", name: "Grithe Seam", skill: "mining", tier: 1, reqLevel: 1,
    itemId: "grithe_ore",
    bonus: [{ itemId: "pale_quartz", chance: 0.06 }],
  },
  {
    id: "ore_marchstone", name: "Marchstone Face", skill: "mining", tier: 1, reqLevel: 1,
    itemId: "march_stone",
    bonus: [{ itemId: "pale_quartz", chance: 0.03 }],
  },
  {
    id: "tree_palewood", name: "Palewood", skill: "woodcutting", tier: 1, reqLevel: 1,
    itemId: "palewood_log",
  },
  {
    id: "fish_silt_minnow", name: "Redsill Shallow", skill: "fishing", tier: 1, reqLevel: 1,
    itemId: "silt_minnow",
  },
  {
    id: "plot_bittergrain", name: "Marchfield Plot", skill: "farming", tier: 1, reqLevel: 1,
    itemId: "bittergrain",
    bonus: [{ itemId: "bittergrain_seed", chance: 0.30 }],
  },

  // ------------------------------------------------------------------ Vellenwood, tier 5
  {
    id: "ore_corven", name: "Corven Seam", skill: "mining", tier: 5, reqLevel: 5,
    itemId: "corven_ore",
    bonus: [{ itemId: "vell_amber", chance: 0.06 }],
  },
  {
    id: "tree_duskoak", name: "Duskoak", skill: "woodcutting", tier: 5, reqLevel: 5,
    itemId: "duskoak_log",
  },
  {
    id: "fish_bramble_trout", name: "Blackwater Pool", skill: "fishing", tier: 5, reqLevel: 5,
    itemId: "bramble_trout",
  },

  // ------------------------------------------------------------------ Karrowmoor, tier 10
  {
    id: "ore_kaldite", name: "Kaldite Face", skill: "mining", tier: 10, reqLevel: 10,
    itemId: "kaldite_ore",
    bonus: [{ itemId: "cairn_garnet", chance: 0.07 }],
  },
  {
    id: "tree_cairnpine", name: "Cairnpine", skill: "woodcutting", tier: 10, reqLevel: 10,
    itemId: "cairnpine_log",
  },
  {
    id: "fish_cragfin", name: "Cairn Tarn", skill: "fishing", tier: 10, reqLevel: 10,
    itemId: "cragfin",
  },
  {
    id: "plot_cairnleaf", name: "Highcairn Plot", skill: "farming", tier: 10, reqLevel: 10,
    itemId: "cairnleaf",
    bonus: [{ itemId: "cairnleaf_seed", chance: 0.25 }],
  },
];

/**
 * Cluster id -> archetype id. Every cluster in `content/regions.ts` appears here exactly once; if a
 * cluster is added there without a line here, `content.resource(meta.clusterId)` returns undefined
 * and the gather degrades to NOT_FOUND rather than crashing.
 */
const CLUSTER_ARCHETYPE: readonly (readonly [string, string])[] = [
  ["bracken_pit_grithe", "ore_grithe"],
  ["bracken_pit_stone", "ore_marchstone"],
  ["palewood_copse_trees", "tree_palewood"],
  ["redsill_spots", "fish_silt_minnow"],
  ["marchfield_plots", "plot_bittergrain"],
  ["hollowcut_corven", "ore_corven"],
  ["duskoak_stand_trees", "tree_duskoak"],
  ["blackwater_spots", "fish_bramble_trout"],
  ["lower_quarry_kaldite", "ore_kaldite"],
  ["upper_karrow_kaldite", "ore_kaldite"],
  ["ridge_pines_trees", "tree_cairnpine"],
  ["cairn_tarn_spots", "fish_cragfin"],
  ["far_tarn_spots", "fish_cragfin"],
  ["highcairn_plot_beds", "plot_cairnleaf"],
];

const BY_ARCHETYPE_ID = new Map(ARCHETYPES.map((row) => [row.id, row] as const));

const CLUSTER_ALIASES: readonly ResourceDef[] = CLUSTER_ARCHETYPE.flatMap(([clusterId, archetypeId]) => {
  const base = BY_ARCHETYPE_ID.get(archetypeId);
  return base === undefined ? [] : [{ ...base, id: clusterId }];
});

/** Archetype rows first, then one alias per world cluster. 12 + 14 = 26 rows. */
export const RESOURCES: readonly ResourceDef[] = [...ARCHETYPES, ...CLUSTER_ALIASES];

/** The twelve canonical archetypes, without the cluster aliases. Useful for docs and guides. */
export const RESOURCE_ARCHETYPES: readonly ResourceDef[] = ARCHETYPES;

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
    // PRD 2.9 authors Duskberry, but regions.ts places farm plots only in Fallowmarch and
    // Karrowmoor, so nothing grows it in Phase 1. Kept so the seed the shops sell has a crop.
    seedItemId: "duskberry_seed", cropItemId: "duskberry", tier: 5, reqLevel: 5,
    stages: 5, secondsPerStage: 120, yieldRange: [3, 6], harvestXp: gatherXp(5), plantXp: 5,
  },
  {
    seedItemId: "cairnleaf_seed", cropItemId: "cairnleaf", tier: 10, reqLevel: 10,
    stages: 5, secondsPerStage: 180, yieldRange: [2, 5], harvestXp: gatherXp(10), plantXp: 7,
  },
];
