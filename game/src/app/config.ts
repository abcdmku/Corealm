/** Tunables the root owns. Numbers come from runs/corealm/PRD.md. */
import type { SpellRung } from "../contracts.js";

export const PLAYER_SPEED = 4.2;          // m/s over the navmesh
export const PLAYER_RADIUS = 0.35;        // m, capsule radius for collision and navmesh inset
export const PLAYER_HEIGHT = 1.8;         // m

/**
 * How the player gets up to speed and which locomotion clip that speed selects.
 *
 * NOT to be confused with `WALK_SPEED_MPS` in `content/regions.ts`, which is also 4.2 and is the
 * figure every route-graph edge cost and the whole Agility route-flip ledger is computed from.
 * That one is a content constant and must not move. These are the movement feel.
 *
 * `walkSpeed` exists because `Walk_Loop` was unreachable. `characterRig.poseFor` picks the run clip
 * above 2.2 m/s, and 4.2 m/s was once the only speed the player ever moved at. Of 11,050 recorded
 * frames of continuous movement, exactly one landed in the walk band. Forward-kinematics analysis
 * of `animation_library_1.glb` gives `Walk_Loop` an implied ground speed of 0.98 m/s, so a 1.6 m/s
 * walk can still match its stride by adjusting playback speed.
 *
 * `walkPoseThreshold` is the speed above which the rig should choose `Jog_Fwd_Loop` over
 * `Walk_Loop`. 2.2 sits between the two gaits rather than above both, which 3.0 did.
 *
 * Running deliberately uses a presentation cadence instead of planted-foot speed matching. The
 * jog's planted foot implies 5.92 m/s, so matching it to the game's 4.2 m/s translation requires
 * 0.71x playback. That turns its 0.933 s loop into 1.316 s of visible slow motion, about 91 steps
 * per minute and 2.76 m of translation per footfall. `runPlaybackRate` makes the steady run 1.2x,
 * about 154 steps per minute and 1.63 m per footfall. Some foot slide remains. A scalar playback
 * rate cannot give this clip both planted feet and a believable run at 4.2 m/s; fixing both needs
 * stride warping, foot IK, or a different animation.
 *
 * `runMinPlaybackRate` prevents the jog from entering slow motion during the short acceleration
 * through the run band. It does not affect translation speed.
 *
 * `accelMps2` / `decelMps2` replace binary velocity. Movement today is a switch: the player covers
 * 0.4202 m per 100 ms sim tick or stands still, and an input tap shorter than ~40 ms produces no
 * displacement at all. 18 m/s^2 takes 0 -> 4.2 in 0.23 s, 25 m/s^2 takes 4.2 -> 0 in 0.17 s —
 * short enough that the walk still feels immediate, long enough that a tap moves you and that the
 * animation time scale has a ramp to follow.
 */
export const MOVEMENT = {
  walkSpeed: 1.6,                 // m/s, the slow gait
  runSpeed: PLAYER_SPEED,         // m/s, the default gait — the same 4.2 the navmesh is walked at
  walkPoseThreshold: 2.2,         // m/s, above this the rig plays a jog rather than a walk
  runPlaybackRate: 1.2,           // authored clip speed multiplier at a steady 4.2 m/s run
  runMinPlaybackRate: 0.9,        // never show the jog or sprint fallback in slow motion
  accelMps2: 18,
  decelMps2: 25,
} as const;

export const INTERACT_RANGE = 2.4;        // m, walk-into-range threshold for gathering and talking
export const MELEE_RANGE = 1.6;           // m
/**
 * How far a spell reaches, in metres.
 *
 * 15, up from the PRD's 9. Nine metres is inside the distance a Marchwolf closes in two seconds, so
 * a caster who opened at maximum range was in melee before the second cast landed and magic played
 * as a slower sword. Fifteen is far enough that the first two casts are free, which is the trade the
 * 3.0 s cast time is priced against.
 *
 * Read by `world/interactions.ts` (how close a click walks you), `systems/combat.ts` (where a cast
 * is allowed to resolve from, and how close `pursue` re-closes to), and `content/spells.ts`'s
 * `SPELL_RANGE_M`, which mirrors it for the generated docs.
 */
export const SPELL_RANGE = 15.0;          // m

/**
 * How fast a cast spell crosses ground, in metres per second, and the wind-up before it leaves.
 *
 * THIS IS SIMULATION TIMING, not decoration, which is why it lives here rather than in the effect
 * layer that used to own it. A spell does not hurt anything until it arrives, so these numbers
 * decide when damage lands, when the target dies, and when the XP is paid — `systems/combat.ts`
 * schedules the impact from them, and `render/spellVfx.ts` draws the bolt against the SAME numbers
 * so the picture and the damage cannot disagree. Two copies of this table is a spell whose bolt
 * lands visibly before or after the health bar moves.
 *
 * Heavier rungs fly slower. A surge crossing the full 15 m takes 1.3 s, which is the longest gap
 * between a cast resolving and its damage landing that the game can produce.
 */
export const SPELL_FLIGHT = {
  lash: { speed: 22, chargeMs: 150, minMs: 300 },
  bolt: { speed: 19, chargeMs: 170, minMs: 330 },
  burst: { speed: 16, chargeMs: 200, minMs: 380 },
  surge: { speed: 14, chargeMs: 230, minMs: 430 },
} as const satisfies Record<SpellRung, { speed: number; chargeMs: number; minMs: number }>;

/**
 * Milliseconds from a cast resolving to the bolt reaching the target.
 *
 * Distance-driven rather than fixed: a flat duration made a 2 m shot and a 15 m shot take the same
 * time, which at 15 m read as the bolt teleporting.
 */
export function spellFlightMs(rung: SpellRung, distanceM: number): number {
  const profile = SPELL_FLIGHT[rung];
  const travel = Math.max(0, distanceM) / profile.speed;
  return Math.round(Math.max(profile.minMs, profile.chargeMs + travel * 1000));
}

export const HEALTH_REGEN_INTERVAL_MS = 6_000;
export const HEALTH_REGEN_BLOCKED_MS = 8_000;
export const LOW_HEALTH_FRACTION = 0.3;

export interface CameraConfig {
  minDistance: number;
  maxDistance: number;
  /** Hard limit for named screenshot poses, which may frame more of the world than player zoom. */
  maxAuthoredDistance: number;
  defaultDistance: number;
  minPitch: number;
  maxPitch: number;
  defaultPitch: number;
  fov: number;
  near: number;
  far: number;
  followLerp: number;
}

export const CAMERA: CameraConfig = {
  minDistance: 6,
  maxDistance: 11,
  maxAuthoredDistance: 34,
  defaultDistance: 11,
  minPitch: 0.18,
  maxPitch: 1.32,
  // 0.72 put the camera 11.9 m above every roofline, so the occlusion probe had nothing to hit:
  // 0 occluded frames out of 3,449 around Coldbrace square, 0 of 1,202 under the Vellenwood canopy,
  // and 0 of 1,001 inside the Gravelmaw chamber (camera at y = 22.36, filming through the rock).
  // The probe is not broken — at pitch 0.18 on the Karrowmoor terraces it reports occluded on
  // 401-1,058 frames per direction and pulls distance from 18 to 12.2. 0.52 is a shoulder view that
  // still clears a 5 m roof at distance 18 but sits low enough to be blocked by one.
  defaultPitch: 0.52,
  fov: 55,
  near: 0.1,
  // Fog ends at 260 m, so anything between there and the old 600 m far plane was drawn fully
  // fogged out: invisible geometry, fully paid for. 280 leaves a small margin past the fog.
  far: 280,
  followLerp: 0.14,
};

export const NAV_CONFIG = {
  cs: 0.3,
  ch: 0.2,
  // 1 voxel, not 2. `navigation.ts` picks LARGE_WORLD_CELL_SIZE 0.45 m because the world extent is
  // 700 m, so radius 2 erodes 0.90 m per side — 2.6x PLAYER_RADIUS. A 2 m gatehouse arch erodes to
  // 0.20 m, under one cell, and Recast never connects it: all three gatehouse arches in the game are
  // impassable, and every measured nav path detours 4-5 m around them, including the south gate of
  // the town the player spawns in front of. At radius 1 the inset is 0.45 m — still 0.10 m more than
  // PLAYER_RADIUS 0.35 — and a 2 m arch becomes a 1.10 m corridor. polyCount rises from 3169.
  walkableRadius: 1,     // voxels
  walkableClimb: 2,      // voxels
  walkableHeight: 9,     // voxels
  walkableSlopeAngle: 48,
  minRegionArea: 4,
} as const;

/**
 * Unchanged, deliberately. The budget is the point.
 *
 * Headroom as measured by `npm run perf`: the worst of the 18 poses is `highcairn` at 397 of 400
 * draw calls, so there are 3 calls spare at the tightest pose. The world-polish wave both adds
 * calls (ground-normal tilt splits no groups, but layered character parts and settlement props add
 * new (asset, tier) groups) and removes them (merging same-material outfit parts, dropping the
 * ~525 buried scatter pebbles). Anyone who needs more room pays for it by removing calls
 * elsewhere; do not raise `maxDrawCalls` to make a pose fit.
 */
export const RENDER_BUDGET = { maxDrawCalls: 400, targetFps: 55 } as const;

export const AUTOSAVE_INTERVAL_MS = 10_000;

export const ASSET_MANIFEST_URL = "assets/manifest.json";
export const ASSET_BASE_URL = "assets/";
