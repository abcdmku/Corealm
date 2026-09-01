/**
 * The sixteen attack spells, ordered by Magic requirement.
 *
 * Every cast spends one unit of matching fuel: a charge from a matching elemental weapon first,
 * then one carried Essence when no matching charge is available. The weapon supplies cadence:
 * wands use 2200 ms and staffs use 3000 ms. `castMs` remains the 3000 ms table fallback for callers
 * that have not resolved a weapon yet.
 *
 * The entry rung follows region progression: wind at Magic 1, earth at 5, water at 10, and fire at
 * 15. Fire fuel and weapons released with the tier-20 Kilnhalt region, so every rung is castable
 * once its element's Essence is in hand.
 */
import type { SpellRung } from "../contracts.js";
import type { SpellDef } from "./index.js";

export const SPELLS: readonly SpellDef[] = [
  // -------------------------------------------------------------------- lash, Magic 1-15
  {
    id: "voltrend",
    name: "Voltrend",
    element: "wind",
    rung: "lash",
    reqLevel: 1,
    tier: 1,
    baseMax: 3,
    divisor: 8,
    baseXp: 5,
    castMs: 3000,
    cost: { element: "wind", charges: 1 },
    description: "A tight crosswind snapped from the weapon tip and driven straight at the target.",
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
    cost: { element: "earth", charges: 1 },
    description:
      "Drives a wedge of hot stone into the target and leaves it there. Heavier than Voltrend, "
      + "and it does not care much what the target is wearing.",
  },
  {
    id: "rimewash",
    name: "Rimewash",
    element: "water",
    rung: "lash",
    reqLevel: 10,
    tier: 10,
    baseMax: 8,
    divisor: 6,
    baseXp: 22,
    castMs: 3000,
    cost: { element: "water", charges: 1 },
    description:
      "Throws a palmful of water and freezes it on the way out, so it lands as grit rather than "
      + "ice. Blackwater fishers had it worked out long before a Coldbrace tutor taught it.",
  },
  {
    id: "emberlash",
    name: "Emberlash",
    element: "fire",
    rung: "lash",
    reqLevel: 15,
    tier: 10,
    baseMax: 9,
    divisor: 6,
    baseXp: 30,
    castMs: 3000,
    cost: { element: "fire", charges: 1 },
    description: "A thin whip of fire, the first thing the Kilnhalt altar teaches a hand to hold.",
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
    cost: { element: "wind", charges: 1 },
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
    cost: { element: "water", charges: 1 },
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
    cost: { element: "earth", charges: 1 },
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
    cost: { element: "fire", charges: 1 },
    description:
      "Packs the weapon's heat into one coal and throws it hard enough to bury. It goes out inside "
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
    cost: { element: "wind", charges: 1 },
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
    cost: { element: "water", charges: 1 },
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
    cost: { element: "earth", charges: 1 },
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
    cost: { element: "fire", charges: 1 },
    description:
      "A standing column of fire, lit from the ground up and held until the cast breaks. The "
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
    cost: { element: "wind", charges: 1 },
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
    cost: { element: "water", charges: 1 },
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
    cost: { element: "earth", charges: 1 },
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
    cost: { element: "fire", charges: 1 },
    description:
      "Turns eight metres of ground into a kiln floor and holds it there while the fire burns "
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
