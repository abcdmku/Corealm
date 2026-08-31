import { describe, expect, it } from "vitest";
import { ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { ENEMY_RETURN_SPEED_MPS, ENEMY_SPEED_MPS } from "../game/src/systems/enemyAI.js";
import { PLAYER_SPEED } from "../game/src/app/config.js";

/**
 * Humanoids RUN — on the same Jog_Fwd_Loop the player runs on, only slightly slower.
 *
 * Two failed states bracket this file, both shipped and both reported. Retiming the 5.92 m/s jog
 * exactly to a 2.1 m/s pursuit played it at 0.35x: slow motion. Swapping to a sped-up walk fixed
 * the slow motion and produced "they should run, not walk fast": the read of a raider is a RUN.
 * The resolution is on the CONTENT side — pursuit speeds authored at 3.4-3.9, just under the
 * player's 4.2, so the shared jog plays at 0.57-0.66 against the player's own 0.71 and reads as
 * the same gait. The clip threshold and rate constants are duplicated from
 * `render/entityViews.ts` so a change there has to be meant.
 */
const HUMANOID_JOG_IMPLIED_MPS = 5.92;
const HUMANOID_WALK_IMPLIED_MPS = 1.15;
const HUMANOID_JOG_MIN_RATE = 0.55;
const RETURN_RATIO = ENEMY_RETURN_SPEED_MPS / ENEMY_SPEED_MPS;

const HUMANOIDS = ENEMY_BLOCKS.filter((block) => block.family === "reaver");

describe("humanoid gait", () => {
  it("has humanoid enemies to cover", () => {
    expect(HUMANOIDS.length).toBeGreaterThan(0);
  });

  it("pursues and returns on the jog, in the band where a jog reads as running", () => {
    for (const block of HUMANOIDS) {
      const pursuit = block.moveSpeedMps ?? ENEMY_SPEED_MPS;
      for (const [gait, speed] of [["run", pursuit], ["return", pursuit * RETURN_RATIO]] as const) {
        // At or above the threshold the clip choice is Jog_Fwd_Loop...
        expect(speed, `${block.id} ${gait} must land on the jog`)
          .toBeGreaterThanOrEqual(HUMANOID_JOG_IMPLIED_MPS * HUMANOID_JOG_MIN_RATE);
        // ...and the exact retime sits in the band the player's own 0.71 defines: fast enough to
        // read as running, never above 1 (nothing outruns the clip's authored tempo).
        const rate = speed / HUMANOID_JOG_IMPLIED_MPS;
        expect(rate, `${block.id} ${gait} jog rate`).toBeGreaterThanOrEqual(HUMANOID_JOG_MIN_RATE);
        expect(rate, `${block.id} ${gait} jog rate`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("runs slightly slower than the player, so escaping on foot stays possible", () => {
    for (const block of HUMANOIDS) {
      const pursuit = block.moveSpeedMps ?? ENEMY_SPEED_MPS;
      expect(pursuit, `${block.id} pursuit`).toBeLessThan(PLAYER_SPEED);
      // "Slightly": a raider that pursues at half the player's speed is not a threat, and one at
      // 95% is an escape that takes a minute of running. 80-93% is the authored band.
      expect(pursuit / PLAYER_SPEED, `${block.id} pursuit fraction`).toBeGreaterThan(0.8);
    }
  });

  it("potters on the walk cycle, below the jog threshold", () => {
    for (const block of HUMANOIDS) {
      const walk = block.walkSpeedMps ?? 0;
      expect(walk, `${block.id} walk`).toBeGreaterThan(0);
      expect(walk, `${block.id} walk stays under the jog threshold`)
        .toBeLessThan(HUMANOID_JOG_IMPLIED_MPS * HUMANOID_JOG_MIN_RATE);
      // And the walk retime is natural rather than clamped.
      const rate = walk / HUMANOID_WALK_IMPLIED_MPS;
      expect(rate, `${block.id} walk rate`).toBeGreaterThan(0.5);
      expect(rate, `${block.id} walk rate`).toBeLessThan(1.5);
    }
  });
});
