import { describe, expect, it } from "vitest";
import { separationPush } from "../game/src/systems/enemyAI.js";

/**
 * Enemies steer at one point - the player - and steering alone has no opinion about the other
 * enemies doing the same thing. Left at that, a sett of bears converges and arrives as one lump of
 * fur: measured in the running game with `tools/animals/overlap.ts --chase`, a chasing pair
 * finished 0.02 m apart inside bodies 1.20 m across, and the screenshot shows two bears sharing a
 * silhouette. `EnemyAI.separate` is the correction, and this pins the arithmetic it runs on.
 *
 * The push is deliberately HALF the overlap per creature: the caller applies it to one of the pair
 * and its negation to the other, so they meet in the middle rather than one being walked backwards
 * out of the other.
 */
describe("enemy separation", () => {
  const LIMIT = 0.11; // one 100 ms tick at the 1.1 m/s separation speed

  it("leaves creatures that are not touching alone", () => {
    expect(separationPush(3, 0, 1.2, LIMIT, 0)).toBeNull();
    // Exactly at the wanted distance is not overlapping. Pushing here would never settle.
    expect(separationPush(1.2, 0, 1.2, LIMIT, 0)).toBeNull();
  });

  it("pushes half the overlap each, along the line between them", () => {
    const push = separationPush(0.8, 0, 1.2, LIMIT, 0)!;
    // 0.4 m of overlap, half of it is 0.2, but one tick only allows 0.11.
    expect(push.x).toBeCloseTo(0.11, 6);
    expect(push.z).toBeCloseTo(0, 6);
  });

  it("never moves further in one tick than the separation speed allows", () => {
    // Deeply interpenetrated: half the overlap is 0.55 m, which would be a visible teleport.
    const push = separationPush(0.1, 0, 1.2, LIMIT, 0)!;
    expect(Math.hypot(push.x, push.z)).toBeCloseTo(LIMIT, 6);
  });

  it("closes the last of a shallow overlap rather than overshooting it", () => {
    // 2 cm of overlap. Half each is 1 cm, under the tick limit, so the limit must not apply.
    const push = separationPush(1.18, 0, 1.2, LIMIT, 0)!;
    expect(Math.hypot(push.x, push.z)).toBeCloseTo(0.01, 6);
  });

  it("resolves a coincident pair deterministically instead of returning NaN", () => {
    const first = separationPush(0, 0, 1.2, LIMIT, 90)!;
    const again = separationPush(0, 0, 1.2, LIMIT, 90)!;
    expect(Number.isFinite(first.x) && Number.isFinite(first.z)).toBe(true);
    expect(Math.hypot(first.x, first.z)).toBeCloseTo(LIMIT, 6);
    expect(again).toEqual(first);
    // A different pair index picks a different direction, so a pile of three does not all shove
    // the same way and stay a pile.
    expect(separationPush(0, 0, 1.2, LIMIT, 180)).not.toEqual(first);
  });

  it("takes a negative tie index without producing a NaN angle", () => {
    const push = separationPush(0, 0, 1.2, LIMIT, -30)!;
    expect(Number.isFinite(push.x) && Number.isFinite(push.z)).toBe(true);
  });

  it("pushes along both axes when the pair is on a diagonal", () => {
    const push = separationPush(0.3, 0.4, 1.2, LIMIT, 0)!;
    // Direction preserved: a 3-4-5 offset stays a 3-4-5 push.
    expect(push.x / push.z).toBeCloseTo(0.75, 6);
    expect(Math.hypot(push.x, push.z)).toBeCloseTo(LIMIT, 6);
  });
});
