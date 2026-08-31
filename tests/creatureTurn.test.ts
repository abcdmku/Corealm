import { describe, expect, it } from "vitest";
import {
  ENEMY_TURN_RATE_RAD_PER_S,
  TURN_IN_PLACE_RAD,
  headingGap,
} from "../game/src/systems/enemyAI.js";
import { turnToward } from "../game/src/core/math.js";

/**
 * Creatures turn at a bounded rate instead of snapping.
 *
 * `enemyAI.faceDirection` used to assign `atan2` outright, so a wander destination picked behind
 * a cow turned it 180 degrees inside one 100 ms tick — 1800 deg/s against the player's own 400.
 * Every facing write now goes through `turnToward` at `ENEMY_TURN_RATE_RAD_PER_S`, and a heading
 * error past `TURN_IN_PLACE_RAD` is walked off as a pivot on the spot before the body translates.
 *
 * These are relationships between constants that live in three files, which is exactly the kind of
 * thing that regresses silently when one of them is retuned alone.
 */
describe("creature turning", () => {
  const SIM_TICK_MS = 100;

  it("never turns faster than the player's own path-following cap", () => {
    // 7 rad/s is `systems/movement.ts: MAX_TURN_RATE`, and it is also the reference line
    // `tools/creature-walk-probe.ts` scores every creature against. A creature allowed past it
    // would fail the probe by construction.
    expect(ENEMY_TURN_RATE_RAD_PER_S).toBeLessThanOrEqual(7);
  });

  it("caps one tick's turn well under a visible snap", () => {
    const turned = turnToward(0, Math.PI, ENEMY_TURN_RATE_RAD_PER_S, SIM_TICK_MS);
    expect(turned).toBeCloseTo(ENEMY_TURN_RATE_RAD_PER_S * (SIM_TICK_MS / 1000), 10);
    expect(turned).toBeLessThan(Math.PI / 4);
  });

  it("finishes a full reversal inside the renderer's walk-pose hold", () => {
    // `render/entityViews.ts: MOVING_HOLD_SYNCS` keeps the walk pose latched for two 250 ms syncs
    // after the last observed position change. A pivot is exactly such a stillness — the body
    // turns, the position holds — so the slowest possible pivot (a 180) has to complete inside
    // 500 ms or every mid-walk reversal flips walk-idle-walk again.
    expect(Math.PI / ENEMY_TURN_RATE_RAD_PER_S).toBeLessThan(0.5);
  });

  it("pivots only on genuine reversals, never on ordinary cornering", () => {
    // Below the gate the error is walked off mid-stride. The threshold has to clear the few
    // degrees of tick-to-tick wobble a navmesh snap or a separation shove can put into the step
    // direction, and stay under a right angle so approaching a target at a diagonal never stalls.
    expect(TURN_IN_PLACE_RAD).toBeGreaterThan(Math.PI / 6);
    expect(TURN_IN_PLACE_RAD).toBeLessThanOrEqual(Math.PI / 2);
  });

  it("measures heading error the short way round", () => {
    expect(headingGap(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
    expect(headingGap(Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2, 10);
    // Across the +-pi seam: 3 rad to -3 rad is 0.283 rad the short way, not 6.
    expect(headingGap(3, -3)).toBeCloseTo(Math.PI * 2 - 6, 10);
    // The gate compares against fresh `atan2` output on both sides, so the principal range is the
    // whole domain — but a full lap fed in anyway must not read as a turn.
    expect(headingGap(-Math.PI, Math.PI)).toBeCloseTo(0, 10);
  });
});
