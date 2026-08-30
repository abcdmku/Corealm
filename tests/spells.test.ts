import { describe, expect, it } from "vitest";
import type { SpellDef } from "../game/src/content/index.js";
import { SPELLS, SPELLS_BY_RUNG, SPELL_RANGE_M } from "../game/src/content/spells.js";
import { SPELL_ELEMENTS, SPELL_RUNGS } from "../game/src/contracts.js";
import { spellFlightMs } from "../game/src/app/config.js";
import type { SpellElement, SpellId, SpellRung } from "../game/src/contracts.js";
import { magicMaxHit } from "../game/src/systems/combat.js";
import { TIERS, tierForLevel } from "../game/src/content/xp.js";
import { ALL_ITEMS } from "../game/src/content/items.js";

/**
 * The Magic 1-70 ladder, frozen as tests.
 *
 * `runs/corealm/magic-ladder-spec.md` section 2 is the authored table and this file is its
 * enforcement. The reason it needs enforcement rather than trust: sixteen rows of six numbers each
 * is 96 hand-typed values, the damage formula reads four of them, and a single transposed digit
 * produces a ladder that still loads, still casts and is quietly wrong for the rest of the game's
 * life. `tests/equipment.test.ts` exists for the same reason and its header says so.
 *
 * The three PRD spells are checked separately and harder, because they are the ones with external
 * dependents: `content/quests.ts` references `emberlash`, `tools/gate-check.ts` casts it, and PRD
 * 2.4's whole melee-versus-magic balance argument is solved from Voltrend's numbers.
 */

/** The full kit's `magicPower` at tier 10, from `content/equipment.ts`'s solved header. */
const TIER_10_MAGIC_POWER = 32;

const BY_ID = new Map<SpellId, SpellDef>(SPELLS.map((spell) => [spell.id, spell]));

/**
 * The authored table, restated independently of the content file.
 *
 * Deliberately a second copy. A test that imported the numbers it is checking would assert only
 * that the file equals itself; these are transcribed from the spec, so a typo in `content/spells.ts`
 * fails here rather than being ratified by it.
 */
const AUTHORED: readonly [SpellId, SpellElement, SpellRung, number, number, number, number][] = [
  // id, element, rung, reqLevel, baseMax, divisor, baseXp
  ["emberlash", "fire", "lash", 1, 3, 8, 5],
  ["stonebrand", "earth", "lash", 5, 5, 7, 12],
  ["voltrend", "wind", "lash", 10, 8, 6, 22],
  ["rimewash", "water", "lash", 13, 9, 6, 28],
  ["skirlbolt", "wind", "bolt", 17, 11, 5.5, 36],
  ["sleetbolt", "water", "bolt", 23, 13, 5.2, 47],
  ["shalebolt", "earth", "bolt", 29, 15, 5.0, 59],
  ["cinderbolt", "fire", "bolt", 35, 17, 4.8, 71],
  ["galeburst", "wind", "burst", 41, 19, 4.6, 84],
  ["spateburst", "water", "burst", 47, 21, 4.4, 97],
  ["cragburst", "earth", "burst", 53, 23, 4.2, 111],
  ["pyreburst", "fire", "burst", 59, 25, 4.0, 125],
  ["squallsurge", "wind", "surge", 62, 27, 3.8, 133],
  ["tidesurge", "water", "surge", 65, 29, 3.6, 141],
  ["scarpsurge", "earth", "surge", 68, 31, 3.5, 149],
  ["kilnsurge", "fire", "surge", 70, 33, 3.4, 155],
];

describe("the spell ladder", () => {
  it("is the sixteen authored rows, in unlock order, with no duplicates", () => {
    expect(SPELLS).toHaveLength(AUTHORED.length);
    expect(BY_ID.size).toBe(AUTHORED.length);
    expect(SPELLS.map((spell) => spell.id)).toEqual(AUTHORED.map(([id]) => id));
  });

  it("matches the authored numbers row for row", () => {
    for (const [id, element, rung, reqLevel, baseMax, divisor, baseXp] of AUTHORED) {
      const spell = BY_ID.get(id);
      expect(spell, `${id} is missing from SPELLS`).toBeDefined();
      if (!spell) continue;
      expect(spell.element, `${id} element`).toBe(element);
      expect(spell.rung, `${id} rung`).toBe(rung);
      expect(spell.reqLevel, `${id} reqLevel`).toBe(reqLevel);
      expect(spell.baseMax, `${id} baseMax`).toBe(baseMax);
      expect(spell.divisor, `${id} divisor`).toBeCloseTo(divisor, 10);
      expect(spell.baseXp, `${id} baseXp`).toBe(baseXp);
    }
  });

  it("keeps every row at one essence shard and a 3.0 s cast", () => {
    // PRD section 0 decision 3 and PRD 2.4. Both held across all sixteen rows on purpose: scaling
    // shard cost with rung would need the gem-drop economy re-solved, which this wave did not do.
    for (const spell of SPELLS) {
      expect(spell.castMs, `${spell.id} castMs`).toBe(3000);
      expect(spell.cost.itemId, `${spell.id} cost item`).toBe("essence_shard");
      expect(spell.cost.quantity, `${spell.id} cost quantity`).toBe(1);
    }
  });

  it("pays for itself with an item that exists", () => {
    // A cost naming an item that no table defines would fail as NOT_ENOUGH_ITEMS forever, and
    // nothing else in the game would report it.
    const itemIds = new Set(ALL_ITEMS.map((item) => item.id));
    for (const spell of SPELLS) expect(itemIds.has(spell.cost.itemId), spell.cost.itemId).toBe(true);
  });

  it("covers Magic 1 to 70 with four elements of four", () => {
    expect(SPELLS[0]?.reqLevel).toBe(1);
    expect(SPELLS[SPELLS.length - 1]?.reqLevel).toBe(70);
    for (const element of SPELL_ELEMENTS) {
      const rows = SPELLS.filter((spell) => spell.element === element);
      expect(rows, `${element} spell count`).toHaveLength(4);
      // One per rung, so no element is missing a step of the ladder.
      expect(new Set(rows.map((row) => row.rung)).size, `${element} rung spread`).toBe(4);
    }
    for (const rung of SPELL_RUNGS) {
      const rows = SPELLS.filter((spell) => spell.rung === rung);
      expect(rows, `${rung} spell count`).toHaveLength(4);
      expect(new Set(rows.map((row) => row.element)).size, `${rung} element spread`).toBe(4);
    }
  });

  it("climbs monotonically in both required level and damage", () => {
    // The property that makes "cast the strongest thing I can" a sane default: if damage ever dipped
    // as the level requirement rose, the automatic pick in `systems/combat.ts` would hand the player
    // a worse spell than one they already had.
    for (let index = 1; index < SPELLS.length; index += 1) {
      const previous = SPELLS[index - 1]!;
      const current = SPELLS[index]!;
      expect(current.reqLevel, `${current.id} vs ${previous.id} reqLevel`).toBeGreaterThan(previous.reqLevel);
      expect(current.baseMax, `${current.id} vs ${previous.id} baseMax`).toBeGreaterThan(previous.baseMax);
      expect(current.divisor, `${current.id} vs ${previous.id} divisor`).toBeLessThanOrEqual(previous.divisor);
      expect(current.baseXp, `${current.id} vs ${previous.id} baseXp`).toBeGreaterThan(previous.baseXp);
    }
  });

  it("carries exactly the content tier its required level reaches", () => {
    // Tier drives shop tiering, icon tint and the generated docs. The first draft of the spec paired
    // tiers two rows at a time, which put skirlbolt (Magic 17) at tier 20 and two others one step
    // above their own unlock level; the root floored all three. This is the invariant that keeps
    // them floored.
    for (const spell of SPELLS) {
      expect(TIERS, `${spell.id} tier ${spell.tier}`).toContain(spell.tier);
      expect(spell.tier, `${spell.id} tier`).toBe(tierForLevel(spell.reqLevel));
    }
  });

  it("groups by rung, weakest first, losing nothing", () => {
    const total = SPELL_RUNGS.reduce((sum, rung) => sum + (SPELLS_BY_RUNG[rung]?.length ?? 0), 0);
    expect(total).toBe(SPELLS.length);
    for (const rung of SPELL_RUNGS) {
      const rows = SPELLS_BY_RUNG[rung] ?? [];
      expect(rows).toHaveLength(4);
      for (const row of rows) expect(row.rung).toBe(rung);
      for (let index = 1; index < rows.length; index += 1) {
        expect(rows[index]!.reqLevel).toBeGreaterThan(rows[index - 1]!.reqLevel);
      }
    }
  });

  it("writes a real description on every row", () => {
    for (const spell of SPELLS) {
      expect(spell.description.length, `${spell.id} description`).toBeGreaterThan(40);
      expect(spell.name.length, `${spell.id} name`).toBeGreaterThan(2);
    }
  });
});

describe("magic damage at unlock, with the tier 10 kit", () => {
  /**
   * Max hit at each spell's own unlock level, wearing the tier 10 magic kit throughout.
   *
   * The first two differ from the PRD's famous 3 and 7 for Emberlash and Stonebrand, and that is
   * correct rather than a drift: those two numbers are quoted against the tier 1 and tier 5 kits a
   * caster would actually own at Magic 1 and 5. Holding gear fixed at magicPower 32 across all
   * sixteen rows is what makes this a ladder rather than sixteen unrelated readings — the test
   * below pins the PRD's three at their own kit tiers.
   */
  const CHECKPOINTS: readonly [SpellId, number][] = [
    ["emberlash", 7], ["stonebrand", 10], ["voltrend", 15], ["rimewash", 16],
    ["skirlbolt", 19], ["sleetbolt", 23], ["shalebolt", 27], ["cinderbolt", 30],
    ["galeburst", 34], ["spateburst", 38], ["cragburst", 43], ["pyreburst", 47],
    ["squallsurge", 51], ["tidesurge", 55], ["scarpsurge", 59], ["kilnsurge", 63],
  ];

  it("hits the authored max at each unlock level", () => {
    for (const [id, expected] of CHECKPOINTS) {
      const spell = BY_ID.get(id);
      expect(spell, id).toBeDefined();
      if (!spell) continue;
      expect(magicMaxHit(spell.reqLevel, TIER_10_MAGIC_POWER, spell), id).toBe(expected);
    }
  });

  it("reproduces the three PRD spells exactly, at their own kit tiers", () => {
    // These three are the ones the PRD solved by hand, and `content/equipment.ts` derives the whole
    // magic gear ladder from them. They must not move: PRD 2.4's "Voltrend kills a Cairnwight in
    // 24 s" claim is what the tier 10 kit's magicPower 32 and magicAccuracy 47 were solved from.
    expect(magicMaxHit(1, 6, BY_ID.get("emberlash")!)).toBe(3);
    expect(magicMaxHit(5, 14, BY_ID.get("stonebrand")!)).toBe(7);
    expect(magicMaxHit(10, 32, BY_ID.get("voltrend")!)).toBe(15);
  });

  it("never rewards a lower rung more than a higher one at the same level", () => {
    // The rotation the ladder is designed around only works if, at any given Magic level, the
    // spell with the highest requirement you meet is also the hardest-hitting one you meet.
    for (let level = 1; level <= 99; level += 1) {
      const available = SPELLS.filter((spell) => spell.reqLevel <= level);
      if (available.length === 0) continue;
      const byRequirement = available.reduce((best, spell) =>
        spell.reqLevel > best.reqLevel ? spell : best);
      const byDamage = available.reduce((best, spell) =>
        magicMaxHit(level, TIER_10_MAGIC_POWER, spell) > magicMaxHit(level, TIER_10_MAGIC_POWER, best)
          ? spell
          : best);
      expect(
        magicMaxHit(level, TIER_10_MAGIC_POWER, byRequirement),
        `at Magic ${level}, ${byRequirement.id} should not be out-damaged by ${byDamage.id}`,
      ).toBe(magicMaxHit(level, TIER_10_MAGIC_POWER, byDamage));
    }
  });
});

/**
 * Flight timing, which stopped being a presentation detail when damage started waiting for it.
 *
 * `systems/combat.ts` schedules a spell's damage against `spellFlightMs` and `render/spellVfx.ts`
 * draws the bolt against the same function, so these numbers decide when a health bar moves — not
 * just when a sprite does. Two copies of the table would be a bolt that lands visibly before or
 * after the damage it carries.
 */
describe("spell flight timing", () => {
  it("scales with distance rather than being a flat duration", () => {
    for (const rung of SPELL_RUNGS) {
      const near = spellFlightMs(rung, 2);
      const far = spellFlightMs(rung, 15);
      expect(far, `${rung} at 15 m vs 2 m`).toBeGreaterThan(near);
      // A flat duration is what this replaced: at the 15 m spell range it made a bolt cross the
      // whole field in the time it crossed a room, which read as a teleport.
      expect(far / near, `${rung} range spread`).toBeGreaterThan(1.5);
    }
  });

  it("gets slower up the ladder, so a surge reads as heavier than a lash", () => {
    const atRange = SPELL_RUNGS.map((rung) => spellFlightMs(rung, 12));
    for (let index = 1; index < atRange.length; index += 1) {
      expect(atRange[index]!, `${SPELL_RUNGS[index]} vs ${SPELL_RUNGS[index - 1]}`)
        .toBeGreaterThan(atRange[index - 1]!);
    }
  });

  it("never returns a delay a player would read as instant, or as a stall", () => {
    for (const rung of SPELL_RUNGS) {
      // Point blank still has to be visible: this is a delay on DAMAGE, and zero would put the
      // health drop on the same frame as the cast, which is the behaviour being fixed.
      expect(spellFlightMs(rung, 0), `${rung} point blank`).toBeGreaterThanOrEqual(300);
      // And the far end has to stay inside the 3.0 s cast interval, or a caster would be waiting on
      // the previous bolt to land before the next one leaves.
      expect(spellFlightMs(rung, SPELL_RANGE_M), `${rung} at maximum range`).toBeLessThan(2000);
    }
  });
});
