import { describe, expect, it } from "vitest";
import { corpseFade, corpseLinger } from "../game/src/render/entityViews.js";

/**
 * A killed creature should fall, settle for a beat, then dissolve - not lie in the grass for the
 * full 30 s until it respawns underneath itself, and not sit there waiting either.
 *
 * The rule that matters is that the wait is the CREATURE'S, taken from the death animation it
 * actually played. A single constant covering the whole roster was the first version and it read as
 * a delay: the clips run from the deer's 0.83 s to the coyote's 4.17 s
 * (`tools/animals/clip-durations.ts`), so one long enough for a coyote left a hen lying still for
 * three seconds after it had finished dying.
 */
describe("corpse fade", () => {
  const DIED = 10_000;
  /** Real measured death clips, in seconds. See `tools/animals/clip-durations.ts`. */
  const HEN = 1.5;
  const COYOTE = 4.17;

  it("waits for the creature's own death clip, not the longest one in the game", () => {
    expect(corpseLinger(HEN)).toBeLessThan(corpseLinger(COYOTE));
    // The hen is not still waiting on the coyote's four seconds.
    expect(corpseLinger(HEN)).toBeLessThan(2200);
  });

  it("never begins fading before the body has finished falling", () => {
    // The one guarantee that cannot be traded away, stated for both ends of the range: whatever the
    // constants are set to, no creature may start going transparent mid-collapse.
    for (const clip of [HEN, COYOTE, 0.83, 2.0]) {
      const linger = corpseLinger(clip);
      expect(corpseFade(DIED + clip * 1000, DIED, linger)).toBe(0);
    }
  });

  it("falls back to a fixed wait when there is no death clip to measure", () => {
    // Instanced corpses have no rig, and the pack ships no death animation for the three fish.
    expect(corpseLinger(null)).toBeGreaterThan(0);
    expect(corpseLinger(0)).toBe(corpseLinger(null));
    expect(corpseLinger(-1)).toBe(corpseLinger(null));
  });

  it("runs from whole to gone once it starts, and only ever forwards", () => {
    const linger = corpseLinger(HEN);
    const samples = [0, 200, 400, 600, 800, 1000, 1200]
      .map((dt) => corpseFade(DIED + linger + dt, DIED, linger));
    expect(samples.some((f) => f > 0 && f < 1)).toBe(true);
    expect(samples[samples.length - 1]).toBe(1);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
  });

  it("is completely gone long before the enemy respawns", () => {
    // ENEMY_RESPAWN_MS is 30 s. A body still lying there when its replacement stands up is the
    // thing this whole mechanism exists to prevent - and the slowest case must clear it too.
    expect(corpseFade(DIED + 8_000, DIED, corpseLinger(COYOTE))).toBe(1);
  });

  it("clamps rather than running negative or past one", () => {
    const linger = corpseLinger(HEN);
    // A clock that jumps backwards - a resumed save, a paused tab - must not produce an opacity
    // above 1 or below 0.
    expect(corpseFade(DIED - 5_000, DIED, linger)).toBe(0);
    expect(corpseFade(DIED + 600_000, DIED, linger)).toBe(1);
  });

  it("is a pure function of its arguments, not of how often it is asked", () => {
    const linger = corpseLinger(HEN);
    const once = corpseFade(DIED + linger + 400, DIED, linger);
    for (let i = 0; i < 5; i += 1) {
      expect(corpseFade(DIED + linger + 400, DIED, linger)).toBe(once);
    }
  });
});
