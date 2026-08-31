import { describe, expect, it } from "vitest";
import {
  enemyAttackRangeMetres,
  enemyStandoffMetres,
  meleeReachMetres,
} from "../game/src/systems/combat.js";
import { MELEE_RANGE, PLAYER_RADIUS } from "../game/src/app/config.js";

/**
 * Melee happens between body SURFACES, not body centres.
 *
 * The old ranges were centre-to-centre constants tuned on the smallest animals: a Redsill cow is
 * 2.53 m nose to tail (bodyRadius 1.27 m), so the 1.35 m standoff parked its muzzle inside the
 * player and the player's 1.6 m swing gate could only be satisfied from inside the cow — reported
 * from play as "they get too close to each other to fight". Every range now adds the creature's
 * own measured half-length, and these are the relationships that must hold for EVERY size or some
 * creature ends up parked outside its own reach.
 *
 * The radii sampled run from a hen (0.2) through the cow (1.27) to a boss rhino with the 1.6x
 * boss scale on top (~2.8), plus 0 for the manifest-gap fallback.
 */
const RADII = [0, 0.2, 0.4, 0.64, 1.0, 1.27, 2.0, 2.8];

describe("melee spacing", () => {
  it("keeps the smallest animals exactly where they always stood", () => {
    // The base constants predate body-aware ranges, and everything hen-sized was tuned against
    // them: standoff 1.35, swing range 2.0. A radius small enough to sit under the base floor
    // must change nothing.
    expect(enemyStandoffMetres(0.2)).toBeCloseTo(1.35, 10);
    expect(enemyAttackRangeMetres(0.2)).toBeCloseTo(2.0, 10);
  });

  it("keeps daylight between the bodies at every size", () => {
    // Surface gap at the standoff: centre distance minus both half-bodies. If this ever reaches
    // zero the creature is standing inside the player again.
    for (const radius of RADII) {
      const surfaceGap = enemyStandoffMetres(radius) - radius - PLAYER_RADIUS;
      expect(surfaceGap, `radius ${radius}`).toBeGreaterThanOrEqual(0.15 - 1e-9);
    }
    // And for anything big enough that the radius term governs, the gap is the full daylight.
    expect(enemyStandoffMetres(1.27) - 1.27 - PLAYER_RADIUS).toBeCloseTo(0.5, 10);
  });

  it("lets the player reach every creature from outside its body", () => {
    // The player's swing gate is reach-to-surface. It must cover the ring the enemy stops on,
    // with margin, or a big creature at its own standoff is unhittable.
    for (const radius of RADII) {
      expect(meleeReachMetres(radius), `radius ${radius}`)
        .toBeGreaterThanOrEqual(enemyStandoffMetres(radius) + 0.25);
    }
  });

  it("lets every creature swing from its own standoff", () => {
    // The enemy's swing range must exceed where its own AI stops it, with slack for separation
    // shoves, or it closes and then stands there unable to attack.
    for (const radius of RADII) {
      expect(enemyAttackRangeMetres(radius), `radius ${radius}`)
        .toBeGreaterThanOrEqual(enemyStandoffMetres(radius) + 0.5);
    }
  });

  it("grows monotonically, so a bigger creature never stands closer", () => {
    for (let i = 1; i < RADII.length; i += 1) {
      expect(enemyStandoffMetres(RADII[i]!)).toBeGreaterThanOrEqual(enemyStandoffMetres(RADII[i - 1]!));
      expect(enemyAttackRangeMetres(RADII[i]!)).toBeGreaterThanOrEqual(enemyAttackRangeMetres(RADII[i - 1]!));
    }
  });

  it("has the player and the enemy stop on the same ring", () => {
    // MELEE_APPROACH_SLACK in systems/combat.ts is derived so reach minus slack IS the enemy's
    // standoff for every radius the radius term governs: both parties walk to the same distance
    // and meet with the authored daylight between them. This is the identity that keeps the two
    // sides from being tuned apart: MELEE_RANGE - slack = PLAYER_RADIUS + daylight.
    const MELEE_APPROACH_SLACK = 0.75;
    // Below 0.5 the base floor governs the standoff and the identity intentionally does not hold.
    for (const radius of RADII.filter((r) => r >= 0.5)) {
      expect(meleeReachMetres(radius) - MELEE_APPROACH_SLACK, `radius ${radius}`)
        .toBeCloseTo(enemyStandoffMetres(radius), 10);
    }
    expect(MELEE_RANGE - MELEE_APPROACH_SLACK).toBeCloseTo(PLAYER_RADIUS + 0.5, 10);
  });
});
