/**
 * The three attack spells. Owned by W-CONTENT.
 *
 * `baseMax`, `divisor` and `baseXp` are verbatim from PRD 2.4 and drive
 *   maxHit = floor(spell.baseMax + (magicLevel + gearMagicPower) / spell.divisor)
 * with `castMs` 3000 and `styleFactor` 1.15 applied by the combat system, not stored here.
 *
 * WHAT REPRODUCES, with the kits in `equipment.ts`:
 *
 *   Emberlash, Magic 1, tier 1 magic kit (magicPower  6): floor(3 + ( 1 +  6)/8) =  3  (PRD: 3)
 *   Stonebrand, Magic 5, tier 5 magic kit (magicPower 14): floor(5 + ( 5 + 14)/7) =  7  (PRD: 6)
 *   Voltrend,  Magic 10, tier 10 magic kit (magicPower 32): floor(8 + (10 + 32)/6) = 15  (PRD: 14)
 *
 * WHAT DOES NOT, and why. PRD 2.4's "maxHit at unlock / 10 levels later with tier gear" column is
 * internally inconsistent for Voltrend: 14 at Magic 10 needs gearMagicPower in [26, 32), while 18
 * at Magic 20 needs it in [40, 46), and it is the same gear in both cells. No single tier 10 kit
 * satisfies both. The kit is therefore solved from the claim the PRD actually leans on for the
 * melee/magic balance gate - "at Magic 10 with a Kaldite staff, Voltrend kills a Cairnwight in
 * 24 s where a Kaldite sword at Melee 12 takes 33 s" - which lands magicPower at 32 and
 * magicAccuracy at 47. That reproduces 24.0 s exactly; see `equipment.ts` and `enemies.ts` for the
 * full arithmetic. Stonebrand comes out one point above the quoted 6 as a consequence of the same
 * ladder being monotonic. Both deltas are reported to the root rather than fudged.
 *
 * COST. PRD section 0, decision 3: "Attack spells consume one Essence Shard per cast." One item,
 * one quantity, every tier. Shards come from Crafting (gem plus log) and from every general store,
 * which is how Magic ends up wired into Mining and Crafting.
 */
import type { SpellDef } from "./index.js";

export const SPELLS: readonly SpellDef[] = [
  {
    id: "emberlash",
    name: "Emberlash",
    reqLevel: 1,
    tier: 1,
    baseMax: 3,
    divisor: 8,
    baseXp: 5,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "A whip of fire off the shard, thrown flat. Short, cheap, and the first thing anyone in "
      + "Coldbrace learns. Reaches nine metres; the shard goes whether it lands or not.",
  },
  {
    id: "stonebrand",
    name: "Stonebrand",
    reqLevel: 5,
    tier: 5,
    baseMax: 5,
    divisor: 7,
    baseXp: 12,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Drives a wedge of hot stone into the target and leaves it there. Slower to read than "
      + "Emberlash, and it does not care much what the target is wearing.",
  },
  {
    id: "voltrend",
    name: "Voltrend",
    reqLevel: 10,
    tier: 10,
    baseMax: 8,
    divisor: 6,
    baseXp: 22,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Splits a cairn garnet and lets the charge out sideways. Armour is no help against it, which "
      + "is the entire argument for carrying a staff onto Karrowmoor.",
  },
];

/**
 * PRD 2.4 magic accuracy: attackLevel is Magic, and styleFactor is 1.15 rather than melee's 1.00.
 * Exported so `systems/combat.ts` reads the constant instead of retyping 1.15.
 */
export const MAGIC_STYLE_FACTOR = 1.15;
export const MELEE_STYLE_FACTOR = 1.00;

/** PRD 2.4: spells reach 9.0 m; melee reaches 1.6 m. */
export const SPELL_RANGE_M = 9.0;
export const MELEE_RANGE_M = 1.6;
