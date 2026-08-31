/**
 * Every non-equipment item in Corealm, plus `ALL_ITEMS`, the single table the root registers.
 *
 * Owned by W-CONTENT. Equipment lives in `equipment.ts` because the gear ladder carries its own
 * balance arithmetic and is long enough to drown this file; `ALL_ITEMS` concatenates the two so the
 * registry still sees one flat list, exactly as `ContentTables.items` expects.
 *
 * Conventions this file holds to, all from PRD 2.10:
 *  - `value` is the shop BUY price. Selling pays `sellPrice(value)` = round(value * 0.6).
 *  - Stackable kinds are currency, elemental essence, seeds, shafts, handles and gems. Everything else takes a
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
import type { EquipSlot, ItemDef, ItemStack } from "../contracts.js";
import { healAmount, toolBonus } from "./index.js";
import { EQUIPMENT, MAGIC_ORBS } from "./equipment.js";

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
// Gems, shafts, and handles stack. Hides do not, along with everything else.

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
    description: "Deep red, cut square by the rock itself. Highcairn jewellers cage it in Kaldite.",
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
  // handles, the shared fletching input for metal weapons and gathering tools
  {
    id: "palewood_handle", name: "Palewood Handle", tier: 1,
    description: "A short palewood grip, shaped for a Grithe tang or tool head.",
    stackable: true, value: 6, category: "component",
  },
  {
    id: "duskoak_handle", name: "Duskoak Handle", tier: 5,
    description: "Oiled duskoak with enough weight to balance a Corven head.",
    stackable: true, value: 23, category: "component",
  },
  {
    id: "cairnpine_handle", name: "Cairnpine Handle", tier: 10,
    description: "Cairnpine shaped around the grain so a Kaldite tang will not split it.",
    stackable: true, value: 53, category: "component",
  },
  // Hides, the crafting input for the whole magic line and every fishing rod.
  //
  // One hide per tier, and every animal in that tier's ground drops it. That is deliberate: the
  // ladder must not depend on finding one particular species, so a Marchfield goat, a Redsill cow
  // and a coney all pay Coarse Hide. The tier-10 hide was `wight_shroud` while the tier was held by
  // undead; the id changed with the animals that now drop it, and `recipes.ts`, `shops.ts` and the
  // icon table moved with it.
  {
    id: "coarse_hide", name: "Coarse Hide", tier: 1,
    description: "Goat and coney skins, scraped and salted together. Stiff until you work it.",
    stackable: false, value: 16, category: "component",
  },
  {
    id: "bramble_hide", name: "Bramble Hide", tier: 5,
    description: "Deepwood deer and hog, thorns still in the seam. Nothing in Vellenwood tans clean.",
    stackable: false, value: 55, category: "component",
  },
  {
    id: "cairn_pelt", name: "Cairn Pelt", tier: 10,
    description: "Winter coat off something that lived above the treeline. Takes no dye and does not tear.",
    stackable: false, value: 130, category: "component",
  },
];

// ------------------------------------------------------------------------------ elemental essence

const ESSENCES: readonly ItemDef[] = [
  {
    id: "air_essence", name: "Air Essence", tier: 1,
    description: "A stackable charge drawn from the distant Fallowmarch cache.",
    stackable: true, value: 9, category: "resource",
  },
  {
    id: "earth_essence", name: "Earth Essence", tier: 5,
    description: "Dense green-brown essence mined beneath the Vellenwood roots.",
    stackable: true, value: 24, category: "resource",
  },
  {
    id: "water_essence", name: "Water Essence", tier: 10,
    description: "Cold blue essence gathered from the far Karrowmoor cache.",
    stackable: true, value: 55, category: "resource",
  },
];

// ------------------------------------------------------------------------------ animal trophies

/**
 * The one drop that says which animal you killed.
 *
 * Every animal family also pays its tier's hide and its tier's raw meat, because the crafting and
 * cooking ladders cannot depend on finding one species. This table is the other half: a single
 * distinctive part per family, so a full inventory reads as a hunting record rather than as three
 * stacks of generic hide. Values sit between the tier's gem and its hide, which puts a trophy at
 * roughly two to four kills' worth of marks.
 *
 * Shared entries are shared because the real object is the same: a hog and a boar grow the same
 * tusk, a cow and an aurochs the same horn, a viper and a scorpion the same venom.
 */
const TROPHIES: readonly ItemDef[] = [
  // tier 1, Fallowmarch
  {
    id: "hen_feather", name: "Hen Feather", tier: 1,
    description: "Barred brown, still stiff at the quill. Fletchers buy them by the double handful.",
    stackable: true, value: 3, category: "component",
  },
  {
    id: "hen_egg", name: "Hen Egg", tier: 1,
    description: "Warm when you find it, which is how you know you were quick enough.",
    stackable: true, value: 6, category: "component",
  },
  {
    id: "curl_horn", name: "Curled Horn", tier: 1,
    description: "One horn off an Open March billy. Hollow, and loud if you know how to blow it.",
    stackable: false, value: 22, category: "component",
  },
  {
    id: "ox_horn", name: "Ox Horn", tier: 1,
    description: "Short, thick and scarred at the base. Coldbrace turns them into cups and lamp horn.",
    stackable: false, value: 26, category: "component",
  },
  {
    id: "coney_foot", name: "Coney Foot", tier: 1,
    description: "Carried for luck by everyone who has ever admitted the moor frightens them.",
    stackable: true, value: 18, category: "component",
  },
  {
    id: "marsh_gland", name: "Marsh Gland", tier: 1,
    description: "Pale sac from behind a frog's jaw. Keeps essence wet, which is most of the trick.",
    stackable: true, value: 15, category: "component",
  },
  {
    id: "viper_skin", name: "Viper Skin", tier: 1,
    description: "Shed whole and inside out. Grithe fletchers back their nocks with it.",
    stackable: false, value: 24, category: "component",
  },

  // tier 5, Vellenwood
  {
    id: "venom_gland", name: "Venom Gland", tier: 5,
    description: "Still full. Handled with the same care you would give a lit lamp in a barn.",
    stackable: true, value: 64, category: "component",
  },
  {
    id: "stag_antler", name: "Stag Antler", tier: 5,
    description: "Six points of Duskoak hart. Cut down, it makes every knife handle in Rootfall.",
    stackable: false, value: 78, category: "component",
  },
  {
    id: "curved_tusk", name: "Curved Tusk", tier: 5,
    description: "Ivory, yellowed, and ground to an edge by the animal's own jaw.",
    stackable: false, value: 72, category: "component",
  },
  {
    id: "coyote_fang", name: "Coyote Fang", tier: 5,
    description: "Long in the root, which is the part nobody expects until they pull one.",
    stackable: true, value: 58, category: "component",
  },

  // tier 10, Karrowmoor and Gravelmaw
  {
    id: "bear_claw", name: "Bear Claw", tier: 10,
    description: "Longer than a finger and blunt from stone. Highcairn hangs them over doorways.",
    stackable: true, value: 150, category: "component",
  },
  {
    id: "boar_bristle", name: "Boar Bristle", tier: 10,
    description: "A fistful of black wire off a scree boar's shoulder. It will not lie flat.",
    stackable: true, value: 96, category: "component",
  },
  {
    id: "ibex_horn", name: "Ibex Horn", tier: 10,
    description: "Ridged the whole length, one ring a winter. This one counted eleven.",
    stackable: false, value: 165, category: "component",
  },
  {
    id: "aurochs_horn", name: "Aurochs Horn", tier: 10,
    description: "As long as your arm and heavier. The terrace herds are the last ones anywhere.",
    stackable: false, value: 178, category: "component",
  },
  {
    id: "rat_tail", name: "Rat Tail", tier: 10,
    description: "Gravelmaw pays a bounty per tail. Nobody in Highcairn asks what the count is for.",
    stackable: true, value: 84, category: "component",
  },
  {
    id: "scorpion_stinger", name: "Scorpion Stinger", tier: 10,
    description: "Barb and bulb both intact. Dry, it is a needle; wet, it is still a problem.",
    stackable: true, value: 140, category: "component",
  },
  {
    id: "crab_claw", name: "Crab Claw", tier: 10,
    description: "Off a sump crab, and big enough to have taken a pick handle in half.",
    stackable: false, value: 158, category: "component",
  },
];

// ------------------------------------------------------------------------------ game meat

/**
 * Raw, cooked and burnt meat, one set per tier.
 *
 * The same shape as the fish line in `RESOURCE_ITEMS` and `FOOD`, and for the same reason: raw is a
 * resource, cooked is food that heals `healAmount(tier)`, burnt is worth 1 and heals nothing. This
 * is what makes an animal kill feed the Cooking skill instead of only the Crafting one, which the
 * fish line was previously carrying alone.
 *
 * One set per tier rather than one per species. Nine rows across sixteen animals is already a lot
 * of near-identical inventory, and "venison" reading off both a stag and a coyote is a smaller lie
 * than sixteen cuts of meat that all heal the same amount.
 */
const GAME_MEAT: readonly ItemDef[] = [
  {
    id: "raw_game_meat", name: "Raw Game Meat", tier: 1,
    description: "Whatever the Fallowmarch was carrying. Fowl, goat or coney, jointed the same way.",
    stackable: false, value: 12, category: "resource",
  },
  {
    id: "roast_game", name: "Roast Game", tier: 1,
    description: "Turned over a range until the fat stops running. Frontier cooking, and it works.",
    stackable: false, value: 24, category: "food", food: { healAmount: healAmount(1) },
  },
  {
    id: "burnt_game", name: "Burnt Game", tier: 1,
    description: "Left on the range. Black through and nothing left worth eating.",
    stackable: false, value: 1, category: "food",
  },
  {
    id: "raw_venison", name: "Raw Venison", tier: 5,
    description: "Dark, close-grained deepwood meat. Hangs two days before it is worth cooking.",
    stackable: false, value: 46, category: "resource",
  },
  {
    id: "roast_venison", name: "Roast Venison", tier: 5,
    description: "Seared hard and rested. The one meal in Rootfall nobody complains about.",
    stackable: false, value: 66, category: "food", food: { healAmount: healAmount(5) },
  },
  {
    id: "burnt_venison", name: "Burnt Venison", tier: 5,
    description: "A stag walked all summer for this and you left it on the coals.",
    stackable: false, value: 1, category: "food",
  },
  {
    id: "raw_haunch", name: "Raw Haunch", tier: 10,
    description: "A whole hind quarter off something that lived above the treeline. Heavy.",
    stackable: false, value: 88, category: "resource",
  },
  {
    id: "roast_haunch", name: "Roast Haunch", tier: 10,
    description: "Four hours over Highcairn coals. It is a meal and most of a day's carrying.",
    stackable: false, value: 118, category: "food", food: { healAmount: healAmount(10) },
  },
  {
    id: "burnt_haunch", name: "Burnt Haunch", tier: 10,
    description: "Ruined, and it was the biggest thing you killed all week.",
    stackable: false, value: 1, category: "food",
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
  // Tier 0. The kit the player starts with, and the bottom rung of the tool ladder.
  //
  // The bonus is written as a literal 1 rather than as `toolBonus(0)`, and that is the whole point
  // of these three rows: `toolBonus(0)` is `round(1.6) = 2`, which is exactly `toolBonus(1)`. A
  // starter tool derived from the formula would be numerically identical to the Grithe one the
  // player is supposed to save up 60 marks for, so the first purchase in the game would buy
  // nothing. At 1 the ladder actually reads 1 -> 2 -> 5 -> 9.
  {
    id: "worn_pickaxe", name: "Worn Pickaxe", tier: 0,
    description: "The head is loose and the haft is somebody's fence post. One effective Mining level.",
    stackable: false, value: 8, category: "tool", tool: { skill: "mining", gatherBonus: 1 },
  },
  {
    id: "worn_hatchet", name: "Worn Hatchet", tier: 0,
    description: "More wedge than edge. It will get through palewood if you are patient.",
    stackable: false, value: 8, category: "tool", tool: { skill: "woodcutting", gatherBonus: 1 },
  },
  {
    id: "worn_rod", name: "Worn Rod", tier: 0,
    description: "A green stick and a length of gut. One effective Fishing level, on a good day.",
    stackable: false, value: 6, category: "tool", tool: { skill: "fishing", gatherBonus: 1 },
  },
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

/** Everything except equipment. 78 rows: 51 base, plus 18 animal trophies and 9 game meats. */
export const ITEMS: readonly ItemDef[] = [
  ...CURRENCY,
  ...RESOURCE_ITEMS,
  ...BARS,
  ...COMPONENTS,
  ...ESSENCES,
  ...TROPHIES,
  ...GAME_MEAT,
  ...SEEDS,
  ...FOOD,
  ...TOOLS,
];

/** The table the root registers as `items`. */
export const ALL_ITEMS: readonly ItemDef[] = [...ITEMS, ...MAGIC_ORBS, ...EQUIPMENT];

/** The currency item id, so nothing else has to spell it. PRD 2.10: currency is marks. */
export const CURRENCY_ITEM_ID = "marks";

/**
 * What a new character carries and wears.
 *
 * Applied by `state/store.ts` in `createInitialState`, so a fresh game and `__gameDebug.reset()`
 * agree — putting it in `app/boot.ts` instead would give the harness a different world after every
 * reset than the one it booted into, and the driver diffs exactly that.
 *
 * The Basic Wooden Wand starts in `mainHand`; the Worn Shortsword stays in the pack so both combat
 * styles remain available. The 50 Air Essence powers the starter Air spell directly. The wand
 * stays plain brown until the player later awakens an altar and crafts an elemental weapon there.
 */
export const STARTING_INVENTORY: readonly ItemStack[] = [
  { itemId: "worn_sword", quantity: 1 },
  { itemId: "worn_hatchet", quantity: 1 },
  { itemId: "worn_pickaxe", quantity: 1 },
  { itemId: "worn_rod", quantity: 1 },
  { itemId: "air_essence", quantity: 50 },
];

/** The starter wand is equipped, visibly plain, and immediately usable with the starting Essence. */
export const STARTING_EQUIPMENT: Readonly<Partial<Record<EquipSlot, ItemStack>>> = {
  mainHand: { itemId: "basic_wooden_wand", quantity: 1 },
};
