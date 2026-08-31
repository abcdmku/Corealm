import { describe, expect, it } from "vitest";
import { ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { ENEMY_RETURN_SPEED_MPS, ENEMY_SPEED_MPS } from "../game/src/systems/enemyAI.js";

/**
 * Humanoids get the same per-gait retiming discipline the animals have, against the two shared
 * library cycles. The constants are duplicated from `render/entityViews.ts` so a change there has
 * to be meant — the same convention `tests/creature-gait.test.ts` uses.
 *
 * The defect this pins against: retiming the 5.92 m/s Jog_Fwd_Loop exactly to a reaver's authored
 * 2.1 m/s pursuit played it at 0.35x, and every humanoid in the game ran in slow motion. Below
 * `HUMANOID_JOG_MIN_RATE` the renderer now runs them on Walk_Loop sped up instead.
 */
const HUMANOID_JOG_IMPLIED_MPS = 5.92;
const HUMANOID_WALK_IMPLIED_MPS = 1.15;
const HUMANOID_JOG_MIN_RATE = 0.7;
const WALK_RATE_MIN = 0.6;
const WALK_RATE_MAX = 3.2;
const MAX_WALK_CADENCE_HZ = 2.4;
/** Walk_Loop's authored length, from the animation library manifest entry. */
const WALK_LOOP_SECONDS = 1.333;
const RETURN_RATIO = ENEMY_RETURN_SPEED_MPS / ENEMY_SPEED_MPS;

const HUMANOIDS = ENEMY_BLOCKS.filter((block) => block.family === "reaver");

describe("humanoid gait", () => {
  it("has humanoid enemies to cover", () => {
    expect(HUMANOIDS.length).toBeGreaterThan(0);
  });

  it("never asks the jog for a slow-motion rate at any authored speed", () => {
    // Every reaver speed — walk, pursuit, and hurried return — sits below the jog threshold, so
    // the clip choice lands on Walk_Loop and the jog's slow-motion band is simply never entered.
    for (const block of HUMANOIDS) {
      for (const speed of [
        block.walkSpeedMps ?? 0,
        block.moveSpeedMps ?? ENEMY_SPEED_MPS,
        (block.moveSpeedMps ?? ENEMY_SPEED_MPS) * RETURN_RATIO,
      ]) {
        expect(speed, `${block.id} at ${speed} m/s must prefer the walk cycle`)
          .toBeLessThan(HUMANOID_JOG_IMPLIED_MPS * HUMANOID_JOG_MIN_RATE);
      }
    }
  });

  it("keeps the sped-up walk inside the rate and cadence bands at every speed", () => {
    for (const block of HUMANOIDS) {
      for (const [gait, speed] of [
        ["walk", block.walkSpeedMps ?? 0],
        ["run", block.moveSpeedMps ?? ENEMY_SPEED_MPS],
        ["return", (block.moveSpeedMps ?? ENEMY_SPEED_MPS) * RETURN_RATIO],
      ] as const) {
        if (speed <= 0) continue;
        const rate = Math.min(
          WALK_RATE_MAX,
          Math.max(WALK_RATE_MIN, speed / HUMANOID_WALK_IMPLIED_MPS),
        );
        const applied = Math.min(rate, MAX_WALK_CADENCE_HZ * WALK_LOOP_SECONDS);
        const cadence = applied / WALK_LOOP_SECONDS;
        const slide = Math.abs(1 - (HUMANOID_WALK_IMPLIED_MPS * applied) / speed);
        expect(cadence, `${block.id} ${gait} cadence`).toBeLessThanOrEqual(MAX_WALK_CADENCE_HZ + 1e-6);
        expect(cadence, `${block.id} ${gait} cadence floor`).toBeGreaterThan(0.4);
        // The clamps should not be doing real work: feet stay planted at every authored speed.
        expect(slide, `${block.id} ${gait} slide`).toBeLessThan(0.25);
      }
    }
  });

  it("keeps the jog floor above the slow-motion band for a walkless rig", () => {
    // The floor only bites when Walk_Loop is missing; when it does, a slightly-sliding jog at
    // 0.7x is the chosen failure over a body hanging mid-air at 0.35x.
    expect(HUMANOID_JOG_MIN_RATE).toBeGreaterThanOrEqual(0.7);
    expect(HUMANOID_JOG_MIN_RATE).toBeLessThan(1);
  });
});
