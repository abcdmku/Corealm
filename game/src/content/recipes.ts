/**
 * Every production recipe: smelting, smithing, cooking, crafting and fletching at tiers 1, 5 and 10.
 *
 * Owned by W-CONTENT.
 *
 * XP is NEVER a literal in this file. Every row calls `recipeXp(tier, craftWeight)` from
 * `content/index.ts`, with the weight taken straight out of the PRD 2.7 table below. That table is
 * the only place a number is typed by hand, and the PRD's worked examples check it:
 *
 *   gatherXp(1) = 10, gatherXp(5) = 24, gatherXp(10) = 35
 *   Grithe bar   = recipeXp(1,  0.8) = round(10 * 0.8) =   8   (PRD 2.7)
 *   Grithe sword = recipeXp(1,  3.5) = round(10 * 3.5) =  35   (PRD 2.7)
 *   Kaldite bar  = recipeXp(10, 0.8) = round(35 * 0.8) =  28   (PRD 2.7)
 *   Kaldite body = recipeXp(10, 5.0) = round(35 * 5.0) = 175   (PRD 2.7)
 *
 * Three weights in the PRD's table do not name every piece we author, so they are reused with the
 * mapping written down here rather than invented per row:
 *   - magic hood / boots / wraps  -> 2.5, the "Helm, boots, gloves" weight
 *   - magic leggings              -> 4.0, the "Leather body" weight (same hide count class)
 *   - off-hand focus              -> 2.8, the "Wooden shield" weight (same station, same shape)
 *
 * `reqLevel` equals the tier at every step. The PRD authors content at tiers 1, 5 and 10 and never
 * asks for an intra-tier stagger, so a flat mapping is the one that cannot surprise a test.
 *
 * Stations come from `content/regions.ts`, which places all five kinds in Coldbrace, a range and an
 * anvil in Rootfall, and a furnace / anvil / range in Highcairn. Crafting and fletching are
 * therefore Coldbrace-only in Phase 1; that is a world-layout fact, not a recipe fact.
 */
import type { ItemId } from "../contracts.js";
import type { RecipeDef } from "./index.js";
import { recipeXp } from "./index.js";

// ------------------------------------------------------------------- PRD 2.7 craft weights

/** craftWeight and duration, verbatim from the PRD 2.7 table. */
const W = {
  smeltBar: { weight: 0.8, ms: 2400 },
  dagger: { weight: 2.0, ms: 3000 },
  sword: { weight: 3.5, ms: 3000 },
  bodyOrLegs: { weight: 5.0, ms: 3000 },
  helmBootsGloves: { weight: 2.5, ms: 3000 },
  toolHead: { weight: 2.2, ms: 3000 },
  cookedFood: { weight: 1.5, ms: 2400 },
  essenceShard: { weight: 1.2, ms: 2400 },
  amuletOrRing: { weight: 3.0, ms: 2400 },
  leatherBody: { weight: 4.0, ms: 2400 },
  staff: { weight: 3.2, ms: 1800 },
  toolHandle: { weight: 1.0, ms: 1800 },
  fishingRod: { weight: 1.8, ms: 1800 },
  woodenShield: { weight: 2.8, ms: 1800 },
} as const;

/** Reused weights, spelled out so the mapping is auditable. */
const W_HIDE_SMALL = W.helmBootsGloves;   // hood, magic boots, wraps: 2.5 at 2.4 s (crafting)
const W_HIDE_LEGS = W.leatherBody;        // magic leggings: 4.0
const W_FOCUS = W.woodenShield;           // off-hand focus: 2.8

// ------------------------------------------------------------------------ per-tier materials

interface TierMaterials {
  tier: number;
  ore: ItemId;
  /** March Stone at every tier. It is the flux that keeps tier 1 mining relevant forever. */
  flux: ItemId;
  orePerBar: number;
  fluxPerBar: number;
  bar: ItemId;
  log: ItemId;
  shaft: ItemId;
  gem: ItemId;
  hide: ItemId;
  rawFish: ItemId;
  cookedFish: ItemId;
  burntFish: ItemId;
  // melee line
  dagger: ItemId;
  sword: ItemId;
  helm: ItemId;
  body: ItemId;
  legs: ItemId;
  boots: ItemId;
  gloves: ItemId;
  shield: ItemId;
  meleeRing: ItemId;
  meleePendant: ItemId;
  // magic line
  staff: ItemId;
  focus: ItemId;
  hood: ItemId;
  robe: ItemId;
  magicLegs: ItemId;
  magicBoots: ItemId;
  wraps: ItemId;
  magicRing: ItemId;
  magicCharm: ItemId;
  // tools
  pickaxe: ItemId;
  hatchet: ItemId;
  rod: ItemId;
  /** Human-readable material name for recipe titles: Grithe / Corven / Kaldite. */
  metalName: string;
  woodName: string;
}

const TIERS: readonly TierMaterials[] = [
  {
    tier: 1,
    ore: "grithe_ore", flux: "march_stone", orePerBar: 1, fluxPerBar: 1, bar: "grithe_bar",
    log: "palewood_log", shaft: "palewood_shaft", gem: "pale_quartz", hide: "coarse_hide",
    rawFish: "silt_minnow", cookedFish: "seared_minnow", burntFish: "burnt_minnow",
    dagger: "grithe_dagger", sword: "grithe_sword", helm: "grithe_helm", body: "grithe_cuirass",
    legs: "grithe_greaves", boots: "grithe_boots", gloves: "grithe_gloves", shield: "palewood_shield",
    meleeRing: "grithe_ring", meleePendant: "grithe_pendant",
    staff: "palewood_staff", focus: "quartz_focus", hood: "marchhide_hood", robe: "marchhide_robe",
    magicLegs: "marchhide_leggings", magicBoots: "marchhide_boots", wraps: "marchhide_wraps",
    magicRing: "ember_ring", magicCharm: "ember_charm",
    pickaxe: "grithe_pickaxe", hatchet: "grithe_hatchet", rod: "palewood_rod",
    metalName: "Grithe", woodName: "Palewood",
  },
  {
    tier: 5,
    ore: "corven_ore", flux: "march_stone", orePerBar: 2, fluxPerBar: 1, bar: "corven_bar",
    log: "duskoak_log", shaft: "duskoak_shaft", gem: "vell_amber", hide: "bramble_hide",
    rawFish: "bramble_trout", cookedFish: "seared_trout", burntFish: "burnt_trout",
    dagger: "corven_dagger", sword: "corven_sword", helm: "corven_helm", body: "corven_plate",
    legs: "corven_greaves", boots: "corven_boots", gloves: "corven_gauntlets", shield: "duskoak_shield",
    meleeRing: "corven_ring", meleePendant: "corven_pendant",
    staff: "duskoak_staff", focus: "amber_focus", hood: "bramblehide_hood", robe: "bramblehide_robe",
    magicLegs: "bramblehide_leggings", magicBoots: "bramblehide_boots", wraps: "bramblehide_wraps",
    magicRing: "stone_ring", magicCharm: "stone_charm",
    pickaxe: "corven_pickaxe", hatchet: "corven_hatchet", rod: "duskoak_rod",
    metalName: "Corven", woodName: "Duskoak",
  },
  {
    tier: 10,
    ore: "kaldite_ore", flux: "march_stone", orePerBar: 2, fluxPerBar: 2, bar: "kaldite_bar",
    log: "cairnpine_log", shaft: "cairnpine_shaft", gem: "cairn_garnet", hide: "wight_shroud",
    rawFish: "cragfin", cookedFish: "seared_cragfin", burntFish: "burnt_cragfin",
    dagger: "kaldite_dagger", sword: "kaldite_sword", helm: "kaldite_helm", body: "kaldite_plate",
    legs: "kaldite_greaves", boots: "kaldite_boots", gloves: "kaldite_gauntlets", shield: "cairnpine_shield",
    meleeRing: "kaldite_ring", meleePendant: "kaldite_pendant",
    staff: "cairnpine_staff", focus: "garnet_focus", hood: "wightshroud_hood", robe: "wightshroud_robe",
    magicLegs: "wightshroud_leggings", magicBoots: "wightshroud_boots", wraps: "wightshroud_wraps",
    magicRing: "storm_ring", magicCharm: "storm_charm",
    pickaxe: "kaldite_pickaxe", hatchet: "kaldite_hatchet", rod: "cairnpine_rod",
    metalName: "Kaldite", woodName: "Cairnpine",
  },
];

// ------------------------------------------------------------------------------- row builder

interface Weight { readonly weight: number; readonly ms: number }

interface RowSpec {
  id: string;
  name: string;
  kind: RecipeDef["kind"];
  station: RecipeDef["station"];
  weight: Weight;
  inputs: { itemId: ItemId; quantity: number }[];
  output: { itemId: ItemId; quantity: number };
  burntItemId?: ItemId;
}

const SKILL_FOR_KIND: Readonly<Record<RecipeDef["kind"], RecipeDef["skill"]>> = {
  smelt: "smithing",
  smith: "smithing",
  cook: "cooking",
  craft: "crafting",
  fletch: "fletching",
};

function row(tier: number, spec: RowSpec): RecipeDef {
  const base: RecipeDef = {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    skill: SKILL_FOR_KIND[spec.kind],
    reqLevel: tier,
    tier,
    station: spec.station,
    inputs: spec.inputs,
    output: spec.output,
    durationMs: spec.weight.ms,
    xp: recipeXp(tier, spec.weight.weight),
  };
  return spec.burntItemId === undefined ? base : { ...base, burntItemId: spec.burntItemId };
}

function recipesForTier(m: TierMaterials): RecipeDef[] {
  const t = m.tier;
  const q = (itemId: ItemId, quantity: number): { itemId: ItemId; quantity: number } =>
    ({ itemId, quantity });

  return [
    // ------------------------------------------------------------------ smelting (furnace)
    row(t, {
      id: `smelt_${m.bar}`, name: `${m.metalName} Bar`, kind: "smelt", station: "furnace",
      weight: W.smeltBar,
      inputs: [q(m.ore, m.orePerBar), q(m.flux, m.fluxPerBar)],
      output: q(m.bar, 1),
    }),

    // ------------------------------------------------------------------ smithing (anvil)
    row(t, {
      id: `smith_${m.dagger}`, name: `${m.metalName} Dagger`, kind: "smith", station: "anvil",
      weight: W.dagger, inputs: [q(m.bar, 1), q(m.shaft, 1)], output: q(m.dagger, 1),
    }),
    row(t, {
      id: `smith_${m.sword}`, name: `${m.metalName} Sword`, kind: "smith", station: "anvil",
      weight: W.sword, inputs: [q(m.bar, 2), q(m.shaft, 1)], output: q(m.sword, 1),
    }),
    row(t, {
      id: `smith_${m.helm}`, name: `${m.metalName} Helm`, kind: "smith", station: "anvil",
      weight: W.helmBootsGloves, inputs: [q(m.bar, 2)], output: q(m.helm, 1),
    }),
    row(t, {
      id: `smith_${m.body}`, name: `${m.metalName} Body`, kind: "smith", station: "anvil",
      weight: W.bodyOrLegs, inputs: [q(m.bar, 3)], output: q(m.body, 1),
    }),
    row(t, {
      id: `smith_${m.legs}`, name: `${m.metalName} Legs`, kind: "smith", station: "anvil",
      weight: W.bodyOrLegs, inputs: [q(m.bar, 3)], output: q(m.legs, 1),
    }),
    row(t, {
      id: `smith_${m.boots}`, name: `${m.metalName} Boots`, kind: "smith", station: "anvil",
      weight: W.helmBootsGloves, inputs: [q(m.bar, 1)], output: q(m.boots, 1),
    }),
    row(t, {
      id: `smith_${m.gloves}`, name: `${m.metalName} Gloves`, kind: "smith", station: "anvil",
      weight: W.helmBootsGloves, inputs: [q(m.bar, 1)], output: q(m.gloves, 1),
    }),
    row(t, {
      id: `smith_${m.pickaxe}`, name: `${m.metalName} Pickaxe`, kind: "smith", station: "anvil",
      weight: W.toolHead, inputs: [q(m.bar, 2), q(m.shaft, 2)], output: q(m.pickaxe, 1),
    }),
    row(t, {
      id: `smith_${m.hatchet}`, name: `${m.metalName} Hatchet`, kind: "smith", station: "anvil",
      weight: W.toolHead, inputs: [q(m.bar, 2), q(m.shaft, 2)], output: q(m.hatchet, 1),
    }),

    // ------------------------------------------------------------------ cooking (range)
    row(t, {
      id: `cook_${m.cookedFish}`, name: nameOf(m.cookedFish), kind: "cook", station: "range",
      weight: W.cookedFood, inputs: [q(m.rawFish, 1)], output: q(m.cookedFish, 1),
      burntItemId: m.burntFish,
    }),

    // ------------------------------------------------------------------ crafting (table)
    row(t, {
      // PRD 2.7: "Essence shard (yields 5)". One shard, one cast, at every tier.
      id: `craft_essence_shard_t${t}`, name: `Essence Shards (${m.metalName})`,
      kind: "craft", station: "crafting_table",
      weight: W.essenceShard, inputs: [q(m.gem, 1), q(m.log, 1)], output: q("essence_shard", 5),
    }),
    row(t, {
      id: `craft_${m.meleeRing}`, name: nameOf(m.meleeRing), kind: "craft", station: "crafting_table",
      weight: W.amuletOrRing, inputs: [q(m.bar, 1), q(m.gem, 1)], output: q(m.meleeRing, 1),
    }),
    row(t, {
      id: `craft_${m.meleePendant}`, name: nameOf(m.meleePendant), kind: "craft", station: "crafting_table",
      weight: W.amuletOrRing, inputs: [q(m.bar, 1), q(m.gem, 1)], output: q(m.meleePendant, 1),
    }),
    row(t, {
      id: `craft_${m.magicRing}`, name: nameOf(m.magicRing), kind: "craft", station: "crafting_table",
      weight: W.amuletOrRing, inputs: [q(m.bar, 1), q(m.gem, 2)], output: q(m.magicRing, 1),
    }),
    row(t, {
      id: `craft_${m.magicCharm}`, name: nameOf(m.magicCharm), kind: "craft", station: "crafting_table",
      weight: W.amuletOrRing, inputs: [q(m.gem, 2)], output: q(m.magicCharm, 1),
    }),
    row(t, {
      id: `craft_${m.robe}`, name: nameOf(m.robe), kind: "craft", station: "crafting_table",
      weight: W.leatherBody, inputs: [q(m.hide, 3)], output: q(m.robe, 1),
    }),
    row(t, {
      id: `craft_${m.magicLegs}`, name: nameOf(m.magicLegs), kind: "craft", station: "crafting_table",
      weight: W_HIDE_LEGS, inputs: [q(m.hide, 2)], output: q(m.magicLegs, 1),
    }),
    row(t, {
      id: `craft_${m.hood}`, name: nameOf(m.hood), kind: "craft", station: "crafting_table",
      weight: W_HIDE_SMALL, inputs: [q(m.hide, 1)], output: q(m.hood, 1),
    }),
    row(t, {
      id: `craft_${m.magicBoots}`, name: nameOf(m.magicBoots), kind: "craft", station: "crafting_table",
      weight: W_HIDE_SMALL, inputs: [q(m.hide, 1)], output: q(m.magicBoots, 1),
    }),
    row(t, {
      id: `craft_${m.wraps}`, name: nameOf(m.wraps), kind: "craft", station: "crafting_table",
      weight: W_HIDE_SMALL, inputs: [q(m.hide, 1)], output: q(m.wraps, 1),
    }),

    // ------------------------------------------------------------------ fletching (bench)
    row(t, {
      id: `fletch_${m.shaft}`, name: `${m.woodName} Shafts`, kind: "fletch", station: "fletching_bench",
      weight: W.toolHandle, inputs: [q(m.log, 1)], output: q(m.shaft, 4),
    }),
    row(t, {
      id: `fletch_${m.staff}`, name: nameOf(m.staff), kind: "fletch", station: "fletching_bench",
      weight: W.staff, inputs: [q(m.shaft, 3), q(m.gem, 1)], output: q(m.staff, 1),
    }),
    row(t, {
      id: `fletch_${m.shield}`, name: nameOf(m.shield), kind: "fletch", station: "fletching_bench",
      weight: W.woodenShield, inputs: [q(m.log, 2), q(m.bar, 1)], output: q(m.shield, 1),
    }),
    row(t, {
      id: `fletch_${m.focus}`, name: nameOf(m.focus), kind: "fletch", station: "fletching_bench",
      weight: W_FOCUS, inputs: [q(m.log, 1), q(m.gem, 1)], output: q(m.focus, 1),
    }),
    row(t, {
      id: `fletch_${m.rod}`, name: nameOf(m.rod), kind: "fletch", station: "fletching_bench",
      weight: W.fishingRod, inputs: [q(m.shaft, 2), q(m.hide, 1)], output: q(m.rod, 1),
    }),
  ];
}

/**
 * Recipe display names for equipment mirror the item name. Item names live in `items.ts` and
 * `equipment.ts`, and importing them here would make this file depend on 100+ rows just to read a
 * string, so the id is title-cased instead. `Kaldite Sword` out of `kaldite_sword`.
 */
function nameOf(itemId: ItemId): string {
  return itemId
    .split("_")
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

/** 26 recipes per tier across three tiers: 78 rows. */
export const RECIPES: readonly RecipeDef[] = TIERS.flatMap((m) => recipesForTier(m));
