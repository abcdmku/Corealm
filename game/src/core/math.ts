import type { Vec3 } from "../contracts.js";

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Horizontal distance. Most gameplay ranges ignore height. */
export function distanceXZ(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Rotates `current` toward `desired` by at most `rateRadPerSecond`, taking the short way round.
 *
 * Lives here rather than in `systems/movement.ts`, where it started, because combat needs it too:
 * the player has to turn to face whatever they are swinging at or casting at, and that is the same
 * capped, shortest-arc turn walking uses. Duplicating it would have let the two drift, and a
 * character who turns at one rate to walk and another to fight reads as two different characters.
 *
 * The wrap is a loop rather than a modulo because the inputs are already near the principal range
 * and a `%` on a negative angle needs a correction term that is easy to get wrong.
 */
export function turnToward(
  current: number,
  desired: number,
  rateRadPerSecond: number,
  deltaMs: number,
): number {
  let delta = desired - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const maxStep = rateRadPerSecond * (deltaMs / 1000);
  if (Math.abs(delta) <= maxStep) return desired;
  return current + Math.sign(delta) * maxStep;
}

/** Facing, in radians, from `from` to `to` in the XZ plane. Matches the rig's yaw convention. */
export function bearingXZ(from: Vec3, to: Vec3): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

export function pathLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/** Rounds for display without dragging float noise into JSON snapshots. */
export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundVec3(value: Vec3, decimals = 3): Vec3 {
  return [round(value[0], decimals), round(value[1], decimals), round(value[2], decimals)];
}

/**
 * Silhouette rule from the PRD: tier changes scale by at most 20% per authored step, and always
 * changes proportion as well. Colour does the heavy lifting; scale only nudges. Both together make
 * tier readable at 12 m at the default camera pitch.
 *
 * Round 1 ramped this over the PALETTE INDEX, which is why it failed the readability contract:
 * tiers 1, 5 and 10 are the first three of twelve authored palettes, so the whole of Phase 1's
 * content resolved to 0.920 / 0.943 / 0.967 — a 5% spread across the entire shipped tier range,
 * invisible at any distance. Ramping over log(tier) instead spends the budget where the content
 * actually is: 1 -> 0.900, 5 -> 1.075, 10 -> 1.151, and still only 1.400 at tier 99. The largest
 * authored step is 1 -> 5 at +19.4%, inside the PRD's 20% ceiling.
 *
 * It lives in `core/` rather than in `render/materials.ts`, where it was written, because
 * `world/regionBuilder.ts` has to cancel it exactly — a 2 m wall module drawn at 1.84 m would not
 * meet its own grid — and `world/*` may not touch Three.js. Importing it from materials.ts pulled
 * `import * as THREE` into the world layer transitively. This is four lines of arithmetic with no
 * dependencies, so the honest fix is to put it where both layers can reach it. `materials.ts`
 * re-exports it, so every existing caller is unchanged.
 */
export function tierSilhouetteScale(tier: number): number {
  const clamped = Math.min(99, Math.max(1, tier));
  return 0.9 + 0.5 * (Math.log(clamped) / Math.log(99));
}
