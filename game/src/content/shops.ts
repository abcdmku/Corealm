/**
 * Shop stock for the five shops `content/regions.ts` places.
 *
 * Owned by W-CONTENT.
 *
 * PRD section 0 cuts restocking, price drift and stock decay: fixed stock, fixed prices. The
 * multipliers implement the PRD 2.10 spread directly - the player buys at `value * 1.0` and sells
 * at `value * 0.6`, which is the 40% spread and matches `sellPrice()` in `content/index.ts`.
 * Every price in the PRD's reference table therefore falls straight out of `ItemDef.value`:
 *
 *   Grithe ore   12 / 7     Corven ore    42 / 25    Kaldite ore    95 / 57
 *   Palewood log 10 / 6     Duskoak log   38 / 23*   Cairnpine log  88 / 53*
 *   Grithe sword 180 / 108  Corven sword 620 / 372   Kaldite sword 1450 / 870
 *   Essence shard  9 / 5    Seared Cragfin 70 / 42
 *
 *   * The PRD quotes 22 and 52 for the two logs. `sellPrice()` rounds where the PRD floored:
 *     round(38 * 0.6) = 23 and round(88 * 0.6) = 53. The frozen formula wins.
 *
 * Division of labour, per the brief: general stores carry tools, food, seeds and shards; smiths
 * carry bars and low-tier gear. Nothing sells a full tier kit - armour is what Smithing and
 * Crafting are for, and a shop that sold it would flatten the material loop in PRD 1.
 */
import type { ShopDef } from "./index.js";

/** Buy at face value, sell at 60%. The 40% spread from PRD 2.10, applied identically everywhere. */
const BUY_MULTIPLIER = 1.0;
const SELL_MULTIPLIER = 0.6;

export const SHOPS: readonly ShopDef[] = [
  {
    id: "coldbrace_general",
    name: "Coldbrace General Supplies",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      // The tier 1 starter kit. A player can walk off the south gate with a pickaxe and be mining
      // inside a minute, which is the first-session shape in PRD 1.
      { itemId: "grithe_pickaxe", quantity: 5 },
      { itemId: "grithe_hatchet", quantity: 5 },
      { itemId: "palewood_rod", quantity: 5 },
      { itemId: "seared_minnow", quantity: 30 },
      { itemId: "bittergrain_seed", quantity: 50 },
      { itemId: "essence_shard", quantity: 200 },
      { itemId: "palewood_shaft", quantity: 100 },
      { itemId: "coarse_hide", quantity: 15 },
    ],
  },
  {
    id: "coldbrace_smith",
    name: "Harrow's Metal",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "grithe_bar", quantity: 40 },
      { itemId: "grithe_dagger", quantity: 5 },
      { itemId: "grithe_sword", quantity: 3 },
      { itemId: "grithe_helm", quantity: 3 },
      { itemId: "grithe_boots", quantity: 3 },
      { itemId: "grithe_gloves", quantity: 3 },
      { itemId: "palewood_shield", quantity: 4 },
      { itemId: "march_stone", quantity: 60 },
    ],
  },
  {
    id: "rootfall_general",
    name: "Rootfall Trade Post",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "corven_pickaxe", quantity: 4 },
      { itemId: "corven_hatchet", quantity: 4 },
      { itemId: "duskoak_rod", quantity: 4 },
      { itemId: "seared_trout", quantity: 25 },
      { itemId: "seared_minnow", quantity: 20 },
      { itemId: "duskberry_seed", quantity: 30 },
      { itemId: "essence_shard", quantity: 200 },
      { itemId: "duskoak_shaft", quantity: 80 },
      { itemId: "bramble_hide", quantity: 12 },
      // Rootfall has an anvil but no furnace, so it sells the bar the anvil needs.
      { itemId: "corven_bar", quantity: 30 },
    ],
  },
  {
    id: "highcairn_general",
    name: "Highcairn Camp Store",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "kaldite_pickaxe", quantity: 3 },
      { itemId: "kaldite_hatchet", quantity: 3 },
      { itemId: "cairnpine_rod", quantity: 3 },
      // The Ordrun food budget: PRD 2.4 costs the fight at roughly 168 damage against a 75 health
      // pool, which is 8 Seared Cragfin at healAmount(10) = 12 plus eat time.
      { itemId: "seared_cragfin", quantity: 40 },
      { itemId: "seared_trout", quantity: 20 },
      { itemId: "cairnleaf_seed", quantity: 30 },
      { itemId: "essence_shard", quantity: 300 },
      { itemId: "cairnpine_shaft", quantity: 60 },
      { itemId: "wight_shroud", quantity: 8 },
    ],
  },
  {
    id: "highcairn_smith",
    name: "Quarry Smith",
    buyMultiplier: BUY_MULTIPLIER,
    sellMultiplier: SELL_MULTIPLIER,
    stock: [
      { itemId: "corven_bar", quantity: 30 },
      { itemId: "kaldite_bar", quantity: 25 },
      { itemId: "march_stone", quantity: 80 },
      { itemId: "corven_sword", quantity: 2 },
      { itemId: "corven_helm", quantity: 2 },
      { itemId: "kaldite_dagger", quantity: 2 },
      { itemId: "kaldite_boots", quantity: 2 },
      { itemId: "kaldite_gauntlets", quantity: 2 },
      { itemId: "cairnpine_shield", quantity: 2 },
    ],
  },
];
