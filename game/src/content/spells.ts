/**
 * The sixteen attack spells, Magic 1 to 70. Owned by W-CONTENT.
 *
 * `baseMax`, `divisor` and `baseXp` drive
 *   maxHit = floor(spell.baseMax + (magicLevel + gearMagicPower) / spell.divisor)
 * with `castMs` 3000 and `styleFactor` 1.15 applied by the combat system, not stored here.
 *
 * --------------------------------------------------------------------------------------- PRD 2.4
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
 * ------------------------------------------------------------------------------------- the ladder
 * FOUR RUNGS OF FOUR. `lash` covers Magic 1-13, `bolt` 17-35, `burst` 41-59, `surge` 62-70. Rung is
 * the axis the renderer and the audio layer read - one sprite atlas and one voice family per rung,
 * tinted four ways - and the only thing that separates two rungs mechanically is required level,
 * damage and XP.
 *
 * Rungs 2-4 run wind -> water -> earth -> fire, weakest to strongest inside the rung. The lash rung
 * does not: it runs fire -> earth -> wind -> water, because PRD 2.4 fixes Emberlash at Magic 1,
 * Stonebrand at 5 and Voltrend at 10, and those three levels are load-bearing outside this file.
 * `content/quests.ts` sends the player to grind Emberlash to Magic 5, and `tools/gate-check.ts`
 * casts `emberlash` at Magic 10 as its magic acceptance check. Renumbering the three to make the
 * rung tidy would break both for a cosmetic gain. Rimewash was authored at 13 to complete the set.
 *
 * WHAT THE ROTATION BUYS. Because the element order inside a rung is fixed, the strongest spell a
 * caster owns changes element as they climb: wind leads at 10-12, 41-46 and 62-64; water at 13-16,
 * 47-52 and 65-67; earth at 5-9, 29-34, 53-58 and 68-69; fire at 1-4, 35-40, 59-61 and 70+. So
 * "I only cast fire" costs a few points of max hit over part of the climb and nothing over the
 * rest. That is a real preference with a price, rather than four re-tinted copies of one spell.
 *
 * ONE SHARD AND 3000 ms ON ALL SIXTEEN ROWS. Neither scales with rung, on purpose. Shards are
 * crafted from a gem plus a log and gems are the secondary drop off every ore node, so charging
 * two shards for a surge would re-price the gem economy through Mining and Crafting, which this
 * wave does not touch. Cast time is the melee/magic gate itself: PRD 2.4's 24 s-against-33 s claim
 * is solved at 3.0 s per cast, so a faster top-rung spell would move magic dps against a number the
 * whole balance rests on. Rung buys damage and XP. Nothing else.
 *
 * CHECKPOINTS, tier 10 magic kit (magicPower 32), each spell at its own unlock level:
 *
 *   rimewash   @13 -> 16   skirlbolt @17 -> 19   sleetbolt  @23 -> 23   shalebolt  @29 -> 27
 *   cinderbolt @35 -> 30   galeburst @41 -> 34   spateburst @47 -> 38   cragburst  @53 -> 43
 *   pyreburst  @59 -> 47   squallsurge@62 -> 51  tidesurge  @65 -> 55   scarpsurge @68 -> 59
 *   kilnsurge  @70 -> 63
 *
 * The three PRD rows above are quoted against their OWN tier kit rather than this one, because
 * those are the cells the PRD actually wrote; at magicPower 32 Emberlash reads 7, not 3.
 *
 * TIER IS FLOORED: every row's `tier` is exactly `tierForLevel(reqLevel)` from `content/xp.ts`.
 *
 * The first draft of the spec paired them instead - 20/20/30/30 through the bolts, and so on - which
 * put `skirlbolt` (Magic 17) at tier 20, `shalebolt` (29) at 30 and `scarpsurge` (68) at 70, each one
 * step above the tier its own unlock level reaches. That was reported rather than shipped, and the
 * root floored all three. Tier in this codebase means "the content tier the player has reached", and
 * it drives shop tiering, icon tint and the generated docs; a spell claiming a tier its required
 * level does not reach would advertise itself into a band the player cannot yet be in.
 * `tests/spells.test.ts` pins the invariant, so the next row added cannot reintroduce the drift.
 *
 * COST. PRD section 0, decision 3: "Attack spells consume one Essence Shard per cast." One item,
 * one quantity, every tier. Shards come from Crafting (gem plus log) and from every general store,
 * which is how Magic ends up wired into Mining and Crafting.
 */
import type { SpellRung } from "../contracts.js";
import type { SpellDef } from "./index.js";

export const SPELLS: readonly SpellDef[] = [
  // -------------------------------------------------------------------- lash, Magic 1-13
  {
    id: "emberlash",
    name: "Emberlash",
    element: "fire",
    rung: "lash",
    reqLevel: 1,
    tier: 1,
    baseMax: 3,
    divisor: 8,
    baseXp: 5,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "A whip of fire off the shard, thrown flat. Short, cheap, and the first thing anyone in "
      + "Coldbrace learns. Reaches fifteen metres; the shard goes whether it lands or not.",
  },
  {
    id: "stonebrand",
    name: "Stonebrand",
    element: "earth",
    rung: "lash",
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
    element: "wind",
    rung: "lash",
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
  {
    id: "rimewash",
    name: "Rimewash",
    element: "water",
    rung: "lash",
    reqLevel: 13,
    tier: 10,
    baseMax: 9,
    divisor: 6,
    baseXp: 28,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Throws a palmful of water and freezes it on the way out, so it lands as grit rather than "
      + "ice. Blackwater fishers had it worked out long before a Coldbrace tutor taught it.",
  },

  // -------------------------------------------------------------------- bolt, Magic 17-35
  {
    id: "skirlbolt",
    name: "Skirlbolt",
    element: "wind",
    rung: "bolt",
    reqLevel: 17,
    tier: 10,
    baseMax: 11,
    divisor: 5.5,
    baseXp: 36,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "A thin screaming line of air, loosed flat and heard before it arrives. Karrow Reavers duck "
      + "it on the sound alone, which is the one flaw in an otherwise excellent spell.",
  },
  {
    id: "sleetbolt",
    name: "Sleetbolt",
    element: "water",
    rung: "bolt",
    reqLevel: 23,
    tier: 20,
    baseMax: 13,
    divisor: 5.2,
    baseXp: 47,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "A column of half-frozen rain driven flat through the target. It leaves the ground wet for a "
      + "minute afterwards, which is how the Highcairn watch tracks a careless caster.",
  },
  {
    id: "shalebolt",
    name: "Shalebolt",
    element: "earth",
    rung: "bolt",
    reqLevel: 29,
    tier: 20,
    baseMax: 15,
    divisor: 5.0,
    baseXp: 59,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Shears a plate of terrace slate out of the ground and throws it edge-first. Cheap on the "
      + "moor, awkward in Vellenwood mud, and the reason Highcairn casters carry so little.",
  },
  {
    id: "cinderbolt",
    name: "Cinderbolt",
    element: "fire",
    rung: "bolt",
    reqLevel: 35,
    tier: 30,
    baseMax: 17,
    divisor: 4.8,
    baseXp: 71,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Packs the shard down into one coal and throws it hard enough to bury. It goes out inside "
      + "the target, which the Thornline crews consider a clear improvement on Emberlash.",
  },

  // -------------------------------------------------------------------- burst, Magic 41-59
  {
    id: "galeburst",
    name: "Galeburst",
    element: "wind",
    rung: "burst",
    reqLevel: 41,
    tier: 40,
    baseMax: 19,
    divisor: 4.6,
    baseXp: 84,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Opens a hand's worth of storm at ten paces and drops it on whatever is standing there. "
      + "Loose scree goes with it, so nobody sensible casts it uphill of their own party.",
  },
  {
    id: "spateburst",
    name: "Spateburst",
    element: "water",
    rung: "burst",
    reqLevel: 47,
    tier: 40,
    baseMax: 21,
    divisor: 4.4,
    baseXp: 97,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Half a second of flood, arriving all at once and going nowhere afterwards. The Cairn Tarns "
      + "are where it gets practised, on the grounds that the water is already there.",
  },
  {
    id: "cragburst",
    name: "Cragburst",
    element: "earth",
    rung: "burst",
    reqLevel: 53,
    tier: 50,
    baseMax: 23,
    divisor: 4.2,
    baseXp: 111,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Lifts a ring of slate out of the ground around the target and closes it again. There is a "
      + "scar behind the Great Cairn where somebody proved the range, and nobody has tidied it.",
  },
  {
    id: "pyreburst",
    name: "Pyreburst",
    element: "fire",
    rung: "burst",
    reqLevel: 59,
    tier: 50,
    baseMax: 25,
    divisor: 4.0,
    baseXp: 125,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "A standing column of fire, lit from the ground up and held until the shard is spent. The "
      + "scorch it leaves on terrace slate is still findable a week later.",
  },

  // -------------------------------------------------------------------- surge, Magic 62-70
  {
    id: "squallsurge",
    name: "Squallsurge",
    element: "wind",
    rung: "surge",
    reqLevel: 62,
    tier: 60,
    baseMax: 27,
    divisor: 3.8,
    baseXp: 133,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Cuts once through the air and lets the pressure follow the cut. Anything light inside nine "
      + "metres comes off the ground, and Gravelmaw dust does not settle for a full cast after.",
  },
  {
    id: "tidesurge",
    name: "Tidesurge",
    element: "water",
    rung: "surge",
    reqLevel: 65,
    tier: 60,
    baseMax: 29,
    divisor: 3.6,
    baseXp: 141,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "A wall of black tarn water thrown from the wrist and then let go of. It does not drown "
      + "things so much as fold them against the nearest stone, and the moor is mostly stone.",
  },
  {
    id: "scarpsurge",
    name: "Scarpsurge",
    element: "earth",
    rung: "surge",
    reqLevel: 68,
    tier: 60,
    baseMax: 31,
    divisor: 3.5,
    baseXp: 149,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Drives a scarp of Karrow slate up under the target and keeps driving. The Quarrykeeper's "
      + "floor is about the only ground with room for it that nobody else is standing on.",
  },
  {
    id: "kilnsurge",
    name: "Kilnsurge",
    element: "fire",
    rung: "surge",
    reqLevel: 70,
    tier: 70,
    baseMax: 33,
    divisor: 3.4,
    baseXp: 155,
    castMs: 3000,
    cost: { itemId: "essence_shard", quantity: 1 },
    description:
      "Turns eight metres of ground into a kiln floor and holds it there while the shard burns "
      + "out. Highcairn has a written rule about casting it inside the wall, which is unusual.",
  },
];

/** One rung's spells, weakest first. `sort` runs on the copy `filter` returns, never on `SPELLS`. */
function spellsOfRung(rung: SpellRung): readonly SpellDef[] {
  return SPELLS.filter((spell) => spell.rung === rung).sort((a, b) => a.reqLevel - b.reqLevel);
}

/**
 * The ladder grouped by rung, sorted by required level inside each group.
 *
 * The spellbook draws one section per rung and needs this every time it opens; deriving it there
 * meant a filter-and-sort over sixteen rows per repaint, against a table that cannot change after
 * boot. Built once here instead. `content.spellsOfElement()` is the same idea on the other axis,
 * and lives on the registry because its key is a value the caller picks at runtime.
 */
export const SPELLS_BY_RUNG: Readonly<Record<SpellRung, readonly SpellDef[]>> = {
  lash: spellsOfRung("lash"),
  bolt: spellsOfRung("bolt"),
  burst: spellsOfRung("burst"),
  surge: spellsOfRung("surge"),
};

/**
 * PRD 2.4 magic accuracy: attackLevel is Magic, and styleFactor is 1.15 rather than melee's 1.00.
 * Exported so `systems/combat.ts` reads the constant instead of retyping 1.15.
 */
export const MAGIC_STYLE_FACTOR = 1.15;
export const MELEE_STYLE_FACTOR = 1.00;

/**
 * Spell reach in metres, mirroring `app/config.ts` SPELL_RANGE for the generated docs.
 *
 * 15, not the PRD's 9. Raised because at nine metres a caster was in melee by the second cast, so
 * the 3.0 s cast time bought nothing. `app/config.ts` is the authority; this constant exists so
 * `content/` can state the number without importing from `app/`.
 */
export const SPELL_RANGE_M = 15.0;
export const MELEE_RANGE_M = 1.6;
