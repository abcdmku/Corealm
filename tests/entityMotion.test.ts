import { describe, expect, it } from "vitest";
import { MOVING_EPSILON, crossedSimTick } from "../game/src/render/entityViews.js";

/**
 * `EntityViews.syncMotion` draws a moving entity by lerping between the last two simulated
 * positions with `clock.alpha()`. The span it lerps across has to collapse when the entity stops,
 * and nothing used to collapse it: a dead goat whose simulated position had not changed in seconds
 * still had `previous` one step behind `target`, so its DRAWN position swept between them every
 * frame. Measured in the running game, that was a 10 cm oscillation at frame rate, and a chasing
 * enemy stops after a 0.31 m step and swings over all of it.
 *
 * The vector version lives in a per-frame hot path and needs a renderer. This mirrors it on one
 * axis, driving the same exported predicate the real code branches on, so the rule that fixes it
 * stays pinned: collapse after a whole sim tick with no new position, and NOT merely because the
 * position stopped changing between two render frames within one tick.
 */
interface Span { previous: number; target: number; lastAlpha: number }

function advance(span: Span, position: number, alpha: number): number {
  const tickRolled = crossedSimTick(alpha, span.lastAlpha);
  span.lastAlpha = alpha;
  if (Math.abs(position - span.target) > MOVING_EPSILON) {
    span.previous = span.target;
    span.target = position;
  } else if (tickRolled) {
    span.previous = span.target;
  }
  return span.previous + (span.target - span.previous) * Math.min(1, Math.max(0, alpha));
}

/** Four render frames per 100 ms sim tick, the shape `clock.alpha()` actually produces. */
const FRAME_ALPHAS = [0.0, 0.25, 0.5, 0.75];

describe("entity motion interpolation", () => {
  it("reads a lower alpha than the frame before as a new sim tick", () => {
    expect(crossedSimTick(0.25, 0.0)).toBe(false);
    expect(crossedSimTick(0.75, 0.5)).toBe(false);
    expect(crossedSimTick(0.0, 0.75)).toBe(true);
    expect(crossedSimTick(0.1, 0.9)).toBe(true);
    // Equal alphas are not a rollover: a paused clock reports 1 every frame.
    expect(crossedSimTick(1, 1)).toBe(false);
  });

  it("still interpolates across the tick while the entity is moving", () => {
    const span: Span = { previous: 0, target: 0, lastAlpha: 1 };
    // One 0.31 m step, the distance an enemy covers per tick at 3.1 m/s.
    const drawn = FRAME_ALPHAS.map((alpha) => advance(span, 0.31, alpha));
    expect(drawn[0]).toBeCloseTo(0.0, 5);
    expect(drawn[1]).toBeCloseTo(0.0775, 5);
    expect(drawn[2]).toBeCloseTo(0.155, 5);
    expect(drawn[3]).toBeCloseTo(0.2325, 5);
    // Strictly advancing, which is what makes the motion read as smooth rather than stepped.
    for (let i = 1; i < drawn.length; i += 1) expect(drawn[i]!).toBeGreaterThan(drawn[i - 1]!);
  });

  it("settles to a single position once the entity stops, and never oscillates", () => {
    const span: Span = { previous: 0, target: 0, lastAlpha: 1 };
    for (const alpha of FRAME_ALPHAS) advance(span, 0.31, alpha);

    // The entity now holds still. Six ticks of four frames each.
    const resting: number[] = [];
    for (let tick = 0; tick < 6; tick += 1) {
      for (const alpha of FRAME_ALPHAS) resting.push(advance(span, 0.31, alpha));
    }

    // The very first frame of the first resting tick collapses the span; everything after is fixed.
    const settled = resting.slice(1);
    for (const value of settled) expect(value).toBeCloseTo(0.31, 6);
    expect(Math.max(...settled) - Math.min(...settled)).toBeCloseTo(0, 6);
  });

  it("does not collapse mid-tick, which would delete interpolation entirely", () => {
    const span: Span = { previous: 0, target: 0, lastAlpha: 1 };
    advance(span, 0.31, 0.0);
    // Frames 2..4 of the same tick report the same position: dx is zero, but the span must stay
    // open or the entity snaps to its target and every step becomes a jump.
    advance(span, 0.31, 0.25);
    expect(span.previous).toBe(0);
    expect(span.target).toBeCloseTo(0.31, 6);
  });

  it("ignores drift below the movement epsilon", () => {
    const span: Span = { previous: 0, target: 0, lastAlpha: 1 };
    const drift = MOVING_EPSILON / 2;
    for (let tick = 0; tick < 4; tick += 1) {
      for (const alpha of FRAME_ALPHAS) advance(span, drift, alpha);
    }
    expect(span.target).toBe(0);
    expect(span.previous).toBe(0);
  });
});

/**
 * The yaw span has the same shape as the position span and needed the same settle. It is worse
 * when it goes wrong: `systems/enemyAI.ts` writes `view.rotationY = atan2(...)` every tick while an
 * enemy turns, and an enemy passing the player can swing that by close to half a turn. Left open,
 * `shortestArc` sweeps all of it once per tick, forever, which reads as the animal spinning.
 */
function advanceYaw(span: Span, facing: number, alpha: number): number {
  const tickRolled = crossedSimTick(alpha, span.lastAlpha);
  span.lastAlpha = alpha;
  if (facing !== span.target) {
    span.previous = span.target;
    span.target = facing;
  } else if (tickRolled) {
    span.previous = span.target;
  }
  // Shortest arc between the two ends, matching `shortestArc` in entityViews.
  let delta = span.target - span.previous;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return span.previous + delta * Math.min(1, Math.max(0, alpha));
}

describe("entity yaw interpolation", () => {
  it("turns smoothly across the tick while the facing is changing", () => {
    const span: Span = { previous: 0, target: 0, lastAlpha: 1 };
    const drawn = FRAME_ALPHAS.map((alpha) => advanceYaw(span, 1.0, alpha));
    expect(drawn[0]).toBeCloseTo(0, 5);
    expect(drawn[3]).toBeCloseTo(0.75, 5);
    for (let i = 1; i < drawn.length; i += 1) expect(drawn[i]!).toBeGreaterThan(drawn[i - 1]!);
  });

  it("stops rocking once the facing settles", () => {
    const span: Span = { previous: 0, target: 0, lastAlpha: 1 };
    for (const alpha of FRAME_ALPHAS) advanceYaw(span, 1.0, alpha);

    const resting: number[] = [];
    for (let tick = 0; tick < 6; tick += 1) {
      for (const alpha of FRAME_ALPHAS) resting.push(advanceYaw(span, 1.0, alpha));
    }
    const settled = resting.slice(1);
    for (const value of settled) expect(value).toBeCloseTo(1.0, 6);
    expect(Math.max(...settled) - Math.min(...settled)).toBeCloseTo(0, 6);
  });

  it("does not sweep half a turn every tick after a sharp turn", () => {
    // An enemy walking past the player flips its facing by nearly pi in one tick.
    const span: Span = { previous: 0, target: 0, lastAlpha: 1 };
    const facing = Math.PI - 0.05;
    for (const alpha of FRAME_ALPHAS) advanceYaw(span, facing, alpha);

    const resting: number[] = [];
    for (let tick = 0; tick < 4; tick += 1) {
      for (const alpha of FRAME_ALPHAS) resting.push(advanceYaw(span, facing, alpha));
    }
    const spread = Math.max(...resting.slice(1)) - Math.min(...resting.slice(1));
    // Without the settle this spans the whole arc every tick.
    expect(spread).toBeLessThan(0.001);
  });
});
