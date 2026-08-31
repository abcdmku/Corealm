/**
 * Canonical gathering and production unlocks for the current regions.
 *
 * A later region adds one row here. The row owns its items, complete gatherable definitions,
 * resource presentation, asset references, smelting ratios, and portable-fire fuel. Systems and
 * generated docs consume the same shape, so extending the ladder does not add tier branches.
 */
import type { ItemId } from "../contracts.js";
import type {
  CampfireFuelDef, GatheringProductionTierDef, ResourceDef,
} from "./index.js";
import { gatherXp } from "./index.js";

const CAMPFIRE_BUILD_TIME_MS = 3_000;

type TierResourceInput = Omit<ResourceDef, "tier" | "reqLevel">;
type TierInput = Omit<GatheringProductionTierDef, "resources" | "resourceDefs"> & {
  resourceDefs: readonly TierResourceInput[];
};

function campfireFuel(
  logItemId: ItemId,
  tier: number,
  visualLogAssetId: string,
): CampfireFuelDef {
  const buildXp = Math.round(gatherXp(tier) * 0.2);
  return {
    logItemId,
    tier,
    buildTimeMs: CAMPFIRE_BUILD_TIME_MS,
    lifetimeMs: (60 + 12 * tier) * 1_000,
    buildXp: { fletching: buildXp, crafting: buildXp },
    visualLogAssetId,
  };
}

function defineTier(input: TierInput): GatheringProductionTierDef {
  const resourceDefs: ResourceDef[] = input.resourceDefs.map((resource) => ({
    ...resource,
    tier: input.tier,
    reqLevel: input.reqLevel,
    presentation: { ...resource.presentation, materialTier: input.tier },
  }));
  const mining = resourceDefs.filter((resource) => resource.skill === "mining").map(({ id }) => id);
  const fishing = resourceDefs.find((resource) => resource.skill === "fishing")?.id;
  const woodcutting = resourceDefs.find((resource) => resource.skill === "woodcutting")?.id;
  if (mining.length === 0 || !fishing || !woodcutting) {
    throw new Error(`Gathering tier ${input.tier} must define mining, fishing, and woodcutting resources.`);
  }
  return {
    ...input,
    resourceDefs,
    resources: { mining, fishing, woodcutting },
  };
}

export const GATHERING_PRODUCTION_TIERS: readonly GatheringProductionTierDef[] = [
  defineTier({
    tier: 1,
    reqLevel: 1,
    metalName: "Grithe",
    woodName: "Palewood",
    items: {
      ore: "grithe_ore", flux: "march_stone", gem: "pale_quartz", bar: "grithe_bar",
      log: "palewood_log", shaft: "palewood_shaft", handle: "palewood_handle", hide: "coarse_hide",
      rawFish: "silt_minnow", cookedFish: "seared_minnow", burntFish: "burnt_minnow",
      dagger: "grithe_dagger", sword: "grithe_sword", helm: "grithe_helm", body: "grithe_cuirass",
      legs: "grithe_greaves", boots: "grithe_boots", gloves: "grithe_gloves",
      pickaxe: "grithe_pickaxe", hatchet: "grithe_hatchet",
      staff: "palewood_staff", wand: "palewood_wand",
      rod: "palewood_rod", shield: "palewood_shield",
      meleeRing: "grithe_ring", meleePendant: "grithe_pendant",
      magicRing: "ember_ring", magicCharm: "ember_charm",
      hood: "marchhide_hood", robe: "marchhide_robe", magicLegs: "marchhide_leggings",
      magicBoots: "marchhide_boots", wraps: "marchhide_wraps",
    },
    magic: {
      element: "wind", essence: "air_essence", orb: "air_orb",
      staff: "air_staff", wand: "air_wand",
      basicStaff: "basic_wooden_staff", basicWand: "basic_wooden_wand",
    },
    resourceDefs: [
      {
        id: "ore_grithe", name: "Grithe Seam", archetype: "ore", skill: "mining",
        itemId: "grithe_ore", bonus: [{ itemId: "pale_quartz", chance: 0.06 }],
        presentation: {
          availableAssetIds: ["rock_medium_1", "rock_medium_2"], targetWorldSize: 1.55,
          variantScale: [0.92, 1.08], materialTier: 1,
        },
      },
      {
        id: "ore_marchstone", name: "Marchstone Face", archetype: "ore", skill: "mining",
        itemId: "march_stone", bonus: [{ itemId: "pale_quartz", chance: 0.03 }],
        presentation: {
          availableAssetIds: ["rock_medium_3"], targetWorldSize: 1.45,
          variantScale: [0.94, 1.06], materialTier: 1,
        },
      },
      {
        id: "tree_palewood", name: "Palewood", archetype: "tree", skill: "woodcutting",
        itemId: "palewood_log",
        presentation: {
          availableAssetIds: ["tree_common_1", "tree_common_2"],
          depletedAssetId: "nature_tree_stump", targetWorldSize: 8,
          variantScale: [0.92, 1.08], materialTier: 1,
        },
      },
      {
        id: "fish_silt_minnow", name: "Redsill Shallow", archetype: "fishing_spot", skill: "fishing",
        itemId: "silt_minnow",
        presentation: {
          availableAssetIds: ["fish_minnow"], targetWorldSize: 0.42,
          waterOffset: -0.32, materialTier: 1,
        },
      },
    ],
    smelting: { orePerBar: 1, fluxPerBar: 1 },
    campfire: campfireFuel("palewood_log", 1, "nature_wood_log"),
  }),
  defineTier({
    tier: 5,
    reqLevel: 5,
    metalName: "Corven",
    woodName: "Duskoak",
    items: {
      ore: "corven_ore", flux: "march_stone", gem: "vell_amber", bar: "corven_bar",
      log: "duskoak_log", shaft: "duskoak_shaft", handle: "duskoak_handle", hide: "bramble_hide",
      rawFish: "bramble_trout", cookedFish: "seared_trout", burntFish: "burnt_trout",
      dagger: "corven_dagger", sword: "corven_sword", helm: "corven_helm", body: "corven_plate",
      legs: "corven_greaves", boots: "corven_boots", gloves: "corven_gauntlets",
      pickaxe: "corven_pickaxe", hatchet: "corven_hatchet",
      staff: "duskoak_staff", wand: "duskoak_wand",
      rod: "duskoak_rod", shield: "duskoak_shield",
      meleeRing: "corven_ring", meleePendant: "corven_pendant",
      magicRing: "stone_ring", magicCharm: "stone_charm",
      hood: "bramblehide_hood", robe: "bramblehide_robe", magicLegs: "bramblehide_leggings",
      magicBoots: "bramblehide_boots", wraps: "bramblehide_wraps",
    },
    magic: {
      element: "earth", essence: "earth_essence", orb: "earth_orb",
      staff: "earth_staff", wand: "earth_wand",
    },
    resourceDefs: [
      {
        id: "ore_corven", name: "Corven Seam", archetype: "ore", skill: "mining",
        itemId: "corven_ore", bonus: [{ itemId: "vell_amber", chance: 0.06 }],
        presentation: {
          availableAssetIds: ["rock_medium_2", "rock_medium_1"], targetWorldSize: 1.65,
          variantScale: [0.92, 1.08], materialTier: 5,
        },
      },
      {
        id: "tree_duskoak", name: "Duskoak", archetype: "tree", skill: "woodcutting",
        itemId: "duskoak_log",
        presentation: {
          availableAssetIds: ["tree_common_2", "tree_common_1"],
          depletedAssetId: "nature_tree_stump_moss", targetWorldSize: 10,
          variantScale: [0.94, 1.1], materialTier: 5,
        },
      },
      {
        id: "fish_bramble_trout", name: "Blackwater Pool", archetype: "fishing_spot", skill: "fishing",
        itemId: "bramble_trout",
        presentation: {
          availableAssetIds: ["fish_trout"], targetWorldSize: 0.72,
          // At the deterministic low bob this leaves 18.9 mm over the 0.495 m basin floor.
          waterOffset: -0.23, materialTier: 5,
        },
      },
    ],
    smelting: { orePerBar: 2, fluxPerBar: 1 },
    campfire: campfireFuel("duskoak_log", 5, "nature_wood_log_moss"),
  }),
  defineTier({
    tier: 10,
    reqLevel: 10,
    metalName: "Kaldite",
    woodName: "Cairnpine",
    items: {
      ore: "kaldite_ore", flux: "march_stone", gem: "cairn_garnet", bar: "kaldite_bar",
      log: "cairnpine_log", shaft: "cairnpine_shaft", handle: "cairnpine_handle", hide: "wight_shroud",
      rawFish: "cragfin", cookedFish: "seared_cragfin", burntFish: "burnt_cragfin",
      dagger: "kaldite_dagger", sword: "kaldite_sword", helm: "kaldite_helm", body: "kaldite_plate",
      legs: "kaldite_greaves", boots: "kaldite_boots", gloves: "kaldite_gauntlets",
      pickaxe: "kaldite_pickaxe", hatchet: "kaldite_hatchet",
      staff: "cairnpine_staff", wand: "cairnpine_wand",
      rod: "cairnpine_rod", shield: "cairnpine_shield",
      meleeRing: "kaldite_ring", meleePendant: "kaldite_pendant",
      magicRing: "storm_ring", magicCharm: "storm_charm",
      hood: "wightshroud_hood", robe: "wightshroud_robe", magicLegs: "wightshroud_leggings",
      magicBoots: "wightshroud_boots", wraps: "wightshroud_wraps",
    },
    magic: {
      element: "water", essence: "water_essence", orb: "water_orb",
      staff: "water_staff", wand: "water_wand",
    },
    resourceDefs: [
      {
        id: "ore_kaldite", name: "Kaldite Face", archetype: "ore", skill: "mining",
        itemId: "kaldite_ore", bonus: [{ itemId: "cairn_garnet", chance: 0.07 }],
        presentation: {
          availableAssetIds: ["rock_medium_3", "rock_medium_1"], targetWorldSize: 1.75,
          variantScale: [0.92, 1.08], materialTier: 10,
        },
      },
      {
        id: "tree_cairnpine", name: "Cairnpine", archetype: "tree", skill: "woodcutting",
        itemId: "cairnpine_log",
        presentation: {
          availableAssetIds: ["tree_pine_2", "tree_pine_1"],
          depletedAssetId: "nature_tree_stump_snow", targetWorldSize: 9,
          variantScale: [0.92, 1.08], materialTier: 10,
        },
      },
      {
        id: "fish_cragfin", name: "Cairn Tarn", archetype: "fishing_spot", skill: "fishing",
        itemId: "cragfin",
        presentation: {
          availableAssetIds: ["fish_cragfin"], targetWorldSize: 0.92,
          // The tallest fish stays 23.9 mm submerged and clears the basin floor by 18.9 mm.
          waterOffset: -0.22, materialTier: 10,
        },
      },
    ],
    smelting: { orePerBar: 2, fluxPerBar: 2 },
    campfire: campfireFuel("cairnpine_log", 10, "nature_wood_log_snow"),
  }),
];

export const CAMPFIRE_FUELS: readonly CampfireFuelDef[] =
  GATHERING_PRODUCTION_TIERS.map((definition) => definition.campfire);

export function gatheringProductionTier(tier: number): GatheringProductionTierDef | undefined {
  return GATHERING_PRODUCTION_TIERS.find((definition) => definition.tier === tier);
}
