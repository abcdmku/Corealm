/**
 * Every non-equipment item in Corealm, plus `ALL_ITEMS`, the single table the root registers.
 *
 * Owned by W-CONTENT. Equipment lives in `equipment.ts` because the gear ladder carries its own
 * balance arithmetic and is long enough to drown this file; `ALL_ITEMS` concatenates the two so the
 * registry still sees one flat list, exactly as `ContentTables.items` expects.
 *
 * Conventions this file holds to, all from PRD 2.10:
 *  - `value` is the shop BUY price. Selling pays `sellPrice(value)` = round(value * 0.6).
 *  - Stackable kinds are currency, essence shards, seeds, shafts and gems. Everything else takes a
 *    slot per unit, including every ore, log, fish, bar and equipment piece.
 *  - Reference prices from the PRD's table are reproduced exactly in `value`. Two of the PRD's
 *    quoted SELL prices used a floor where `sellPrice()` rounds, so Duskoak log sells for 23 (PRD
 *    says 22) and Cairnpine log for 53 (PRD says 52). The frozen formula wins; see the report.
 *
 * Food healing uses `healAmount(tier)` from `content/index.ts` rather than literals, because a
 * literal is the thing most likely to drift. NOTE: the frozen formula gives 3 / 7 / 12 at tiers
 * 1 / 5 / 10, not the 3 / 7 / 11 quoted in PRD 2.7 - `2 + 1.35 * 10^0.85 = 11.557`, and
 * `Math.round` takes that to 12. Seared Cragfin therefore heals 12, and the Ordrun food budget in
 * PRD 2.4 gets slightly cheaper (8 fish instead of 9). Flagged to the root rather than papered over.
 */
import type { ItemDef } from "../contracts.js";
import { healAmount, toolBonus } from "./index.js";
import { EQUIPMENT } from "./equipment.js";

// ------------------------------------------------------------------------------ currency

const CURRENCY: readonly ItemDef[] = [
  {
    id: "marks", name: "Marks", tier: 1,
    description: "Stamped March Company scrip. Every settlement between here and the moor takes it.",
    stackable: true, value: 1, category: "currency",
  },
];

// ------------------------------------------------------------------------------ raw resources
// Ids are fixed by `content/regions.ts` and must not be renamed.

const RESOURCE_ITEMS: readonly ItemDef[] = [
  // mining
  {
    id: "grithe_ore", name: "Grithe Ore", tier: 1,
    description: "Grey ore, streaked rust-red. Smelts easily, which is the only nice thing about it.",
    stackable: false, value: 12, category: "resource",
  },
  {
    id: "march_stone", name: "March Stone", tier: 1,
    description: "Crumbly limestone from the Bracken Pit. Every furnace on the frontier runs on it as flux.",
    stackable: false, value: 5, category: "resource",
  },
  {
    id: "corven_ore", name: "Corven Ore", tier: 5,
    description: "Dark deepwood ore. Heavier than it looks and slightly oily on the break.",
    stackable: false, value: 42, category: "resource",
  },
  {
    id: "kaldite_ore", name: "Kaldite Ore", tier: 10,
    description: "Black Karrowmoor ore with a blue fracture. It takes a furnace twice to give anything up.",
    stackable: false, value: 95, category: "resource",
  },
  // woodcutting
  {
    id: "palewood_log", name: "Palewood Log", tier: 1,
    description: "Pale, straight-grained, and dries in a day. The march is short of everything except this.",
    stackable: false, value: 10, category: "resource",
  },
  {
    id: "duskoak_log", name: "Duskoak Log", tier: 5,
    description: "Close-grained oak from under the Vellenwood canopy. Dense enough to sink.",
    stackable: false, value: 38, category: "resource",
  },
  {
    id: "cairnpine_log", name: "Cairnpine Log", tier: 10,
    description: "Ridge pine, resin-heavy and stubborn. It holds a Kaldite ferrule without splitting.",
    stackable: false, value: 88, category: "resource",
  },
  // fishing (raw, inedible until cooked)
  {
    id: "silt_minnow", name: "Silt Minnow", tier: 1,
    description: "A palm-sized fish out of the Redsill shallows. Raw, it is mostly bone.",
    stackable: false, value: 14, category: "resource",
  },
  {
    id: "bramble_trout", name: "Bramble Trout", tier: 5,
    description: "Black-backed trout from the Blackwater pools. Fights the line the whole way in.",
    stackable: false, value: 44, category: "resource",
  },
  {
    id: "cragfin", name: "Cragfin", tier: 10,
    description: "A slab-sided tarn fish with a spined dorsal. Highcairn eats little else.",
    stackable: false, value: 96, category: "resource",
  },
  // farming crops
  {
    id: "bittergrain", name: "Bittergrain", tier: 1,
    description: "Hardy march grain. Bitter is not a review, it is the name.",
    stackable: false, value: 9, category: "resource",
  },
  {
    id: "duskberry", name: "Duskberry", tier: 5,
    description: "A deep-purple berry that only sets under closed canopy. No Phase 1 plot grows it yet.",
    stackable: false, value: 30, category: "resource",
  },
  {
    id: "cairnleaf", name: "Cairnleaf", tier: 10,
    description: "Broad grey leaves off the Highcairn beds. Chewed by quarry crews against the cold.",
    stackable: false, value: 74, category: "resource",
  },
];

// ------------------------------------------------------------------------------ bars

const BARS: readonly ItemDef[] = [
  {
    id: "grithe_bar", name: "Grithe Bar", tier: 1,
    description: "One ore, one stone, one bar. The first thing anybody makes.",
    stackable: false, value: 30, category: "bar",
  },
  {
    id: "corven_bar", name: "Corven Bar", tier: 5,
    description: "Dark and dense. Rings a full tone lower than Grithe on the anvil.",
    stackable: false, value: 110, category: "bar",
  },
  {
    id: "kaldite_bar", name: "Kaldite Bar", tier: 10,
    description: "Black with a blue sheen. Holds an edge through cairn stone, which is why Highcairn exists.",
    stackable: false, value: 250, category: "bar",
  },
];

// ------------------------------------------------------------------------------ components
// Gems and shafts stack (PRD 2.10). Hides do not, along with everything else.

const COMPONENTS: readonly ItemDef[] = [
  // gems, the secondary drop off every ore node
  {
    id: "pale_quartz", name: "Pale Quartz", tier: 1,
    description: "A milky chip out of a Grithe seam. Holds a charge just long enough to be useful.",
    stackable: true, value: 20, category: "component",
  },
  {
    id: "vell_amber", name: "Vell Amber", tier: 5,
    description: "Fossil resin from under the deepwood. Warm in the hand and nobody knows why.",
    stackable: true, value: 70, category: "component",
  },
  {
    id: "cairn_garnet", name: "Cairn Garnet", tier: 10,
    description: "Deep red, cut square by the rock itself. Voltrend will not cast without one.",
    stackable: true, value: 160, category: "component",
  },
  // shafts, the fletching intermediate
  {
    id: "palewood_shaft", name: "Palewood Shaft", tier: 1,
    description: "A shaved length of palewood. Handle, haft, or half a staff.",
    stackable: true, value: 4, category: "component",
  },
  {
    id: "duskoak_shaft", name: "Duskoak Shaft", tier: 5,
    description: "Duskoak, turned down and oiled. Will not warp in Vellenwood damp.",
    stackable: true, value: 14, category: "component",
  },
  {
    id: "cairnpine_shaft", name: "Cairnpine Shaft", tier: 10,
    description: "Resinous, springy, and heavy. Takes a Kaldite ferrule without splitting.",
    stackable: true, value: 32, category: "component",
  },
  // hides, the crafting input for the magic line
  {
    id: "coarse_hide", name: "Coarse Hide", tier: 1,
    description: "Marchwolf pelt, scraped and salted. Stiff until you work it.",
    stackable: false, value: 16, category: "component",
  },
  {
    id: "bramble_hide", name: "Bramble Hide", tier: 5,
    description: "Deepwood pelt, thorns still in the seam. Sheds Thornbound spores.",
    stackable: false, value: 55, category: "component",
  },
  {
    id: "wight_shroud", name: "Wight Shroud", tier: 10,
    description: "Whatever a cairnwight wears. It takes no dye and it does not tear.",
    stackable: false, value: 130, category: "component",
  },
  // magic consumable
  {
    id: "essence_shard", name: "Essence Shard", tier: 1,
    description: "A gem chip wound with green wood. One shard, one cast, every spell, every tier.",
    stackable: true, value: 9, category: "component",
  },
];

// ------------------------------------------------------------------------------ seeds

const SEEDS: readonly ItemDef[] = [
  {
    id: "bittergrain_seed", name: "Bittergrain Seed", tier: 1,
    description: "Four minutes from raked dirt to a harvest, and it keeps growing while you are logged out.",
    stackable: true, value: 6, category: "seed", seed: { cropId: "bittergrain" },
  },
  {
    id: "duskberry_seed", name: "Duskberry Seed", tier: 5,
    description: "Needs closed canopy. Rootfall sells them anyway, out of habit.",
    stackable: true, value: 22, category: "seed", seed: { cropId: "duskberry" },
  },
  {
    id: "cairnleaf_seed", name: "Cairnleaf Seed", tier: 10,
    description: "Fifteen minutes to a Highcairn harvest. Plant it and go do something else.",
    stackable: true, value: 52, category: "seed", seed: { cropId: "cairnleaf" },
  },
];

// ------------------------------------------------------------------------------ food
// healAmount() from content/index.ts, never a literal: 3 / 7 / 12 at tiers 1 / 5 / 10.
// Burnt variants deliberately carry NO `food` block, so an eat handler that checks `def.food`
// refuses them. PRD 2.7: "Burnt food gives 0 XP and a worthless item."

const FOOD: readonly ItemDef[] = [
  {
    id: "seared_minnow", name: "Seared Minnow", tier: 1,
    description: "Two minutes over a range and it stops being mostly bone.",
    stackable: false, value: 22, category: "food", food: { healAmount: healAmount(1) },
  },
  {
    id: "burnt_minnow", name: "Burnt Minnow", tier: 1,
    description: "Charred through. Nothing left worth eating.",
    stackable: false, value: 1, category: "food",
  },
  {
    id: "seared_trout", name: "Seared Trout", tier: 5,
    description: "Split, salted, and laid on the stone. Rootfall's entire cuisine.",
    stackable: false, value: 62, category: "food", food: { healAmount: healAmount(5) },
  },
  {
    id: "burnt_trout", name: "Burnt Trout", tier: 5,
    description: "You left it on. It happens until Cooking 20.",
    stackable: false, value: 1, category: "food",
  },
  {
    id: "seared_cragfin", name: "Seared Cragfin", tier: 10,
    description: "The reason anyone survives Ordrun's floor. Highcairn will not sell you fewer than five.",
    stackable: false, value: 70, category: "food", food: { healAmount: healAmount(10) },
  },
  {
    id: "burnt_cragfin", name: "Burnt Cragfin", tier: 10,
    description: "Ninety-six marks of fish, ruined. Highcairn has opinions about this.",
    stackable: false, value: 1, category: "food",
  },
];

// ------------------------------------------------------------------------------ tools
// tool.gatherBonus is toolBonus(tier) from content/index.ts: +2 / +5 / +9 at tiers 1 / 5 / 10.
// Tools are NOT equipment: they add flat effective levels while carried and occupy no slot.
// PRD 2.5: "Tools never bypass requirements."

const TOOLS: readonly ItemDef[] = [
  {
    id: "grithe_pickaxe", name: "Grithe Pickaxe", tier: 1,
    description: "A bar of Grithe on a palewood haft. Adds two effective Mining levels.",
    stackable: false, value: 60, category: "tool", tool: { skill: "mining", gatherBonus: toolBonus(1) },
  },
  {
    id: "corven_pickaxe", name: "Corven Pickaxe", tier: 5,
    description: "Corven head, duskoak haft. Five effective Mining levels.",
    stackable: false, value: 240, category: "tool", tool: { skill: "mining", gatherBonus: toolBonus(5) },
  },
  {
    id: "kaldite_pickaxe", name: "Kaldite Pickaxe", tier: 10,
    description: "Kaldite on cairnpine. Nine effective Mining levels, and it will outlive you.",
    stackable: false, value: 620, category: "tool", tool: { skill: "mining", gatherBonus: toolBonus(10) },
  },
  {
    id: "grithe_hatchet", name: "Grithe Hatchet", tier: 1,
    description: "Light, blunt-ish, and enough for palewood. Two effective Woodcutting levels.",
    stackable: false, value: 55, category: "tool", tool: { skill: "woodcutting", gatherBonus: toolBonus(1) },
  },
  {
    id: "corven_hatchet", name: "Corven Hatchet", tier: 5,
    description: "Corven bit, deep bevel. Five effective Woodcutting levels.",
    stackable: false, value: 225, category: "tool", tool: { skill: "woodcutting", gatherBonus: toolBonus(5) },
  },
  {
    id: "kaldite_hatchet", name: "Kaldite Hatchet", tier: 10,
    description: "Goes through cairnpine resin without gumming. Nine effective Woodcutting levels.",
    stackable: false, value: 600, category: "tool", tool: { skill: "woodcutting", gatherBonus: toolBonus(10) },
  },
  {
    id: "palewood_rod", name: "Palewood Rod", tier: 1,
    description: "A shaft, a hide line, and a bent pin. Two effective Fishing levels.",
    stackable: false, value: 45, category: "tool", tool: { skill: "fishing", gatherBonus: toolBonus(1) },
  },
  {
    id: "duskoak_rod", name: "Duskoak Rod", tier: 5,
    description: "Springy enough for a bramble trout. Five effective Fishing levels.",
    stackable: false, value: 190, category: "tool", tool: { skill: "fishing", gatherBonus: toolBonus(5) },
  },
  {
    id: "cairnpine_rod", name: "Cairnpine Rod", tier: 10,
    description: "Built for cragfin, which fight like something with a grudge. Nine effective Fishing levels.",
    stackable: false, value: 480, category: "tool", tool: { skill: "fishing", gatherBonus: toolBonus(10) },
  },
];

/** Everything except equipment. 45 rows. */
export const ITEMS: readonly ItemDef[] = [
  ...CURRENCY,
  ...RESOURCE_ITEMS,
  ...BARS,
  ...COMPONENTS,
  ...SEEDS,
  ...FOOD,
  ...TOOLS,
];

/** The table the root registers as `items`. 45 + 57 = 102 rows. */
export const ALL_ITEMS: readonly ItemDef[] = [...ITEMS, ...EQUIPMENT];

/** The currency item id, so nothing else has to spell it. PRD 2.10: currency is marks. */
export const CURRENCY_ITEM_ID = "marks";
