/**
 * Elevated third-person MMO camera: orbit yaw, adjustable pitch, zoom, smooth follow.
 * Readable framing over twitch responsiveness, per the brief.
 *
 * Two round-1 additions. The follow smoothing is frame-rate independent — the round-0 fixed lerp
 * per frame meant the camera lagged twice as far at 30 FPS as at 60, which shows up as inconsistent
 * screenshots. And there is an occlusion spring: when something solid sits between the player and
 * the camera, the camera pulls in rather than filming the inside of a Karrowmoor terrace.
 *
 * What changed in the world-polish wave, and why. `CAMERA.defaultPitch` dropped from 0.72 to 0.52.
 * At 0.72 and distance 18 the camera sat sin(0.72) * 18 = 11.9 m above the player, which is above
 * every roofline in the game, so the probe segment cleared every building: 0 occluded frames of
 * 3,449 around Coldbrace square, 0 of 1,202 under the Vellenwood canopy, 0 of 1,001 inside the
 * Gravelmaw chamber. At 0.52 the camera lives in the world, so the spring now fires constantly and
 * three things that did not matter at 11.9 m of clearance suddenly do: a single centre-line probe
 * lets the camera's edges bury themselves in a wall the centre ray misses; a blocker that clears
 * for one frame makes the camera lurch back out; and vertical follow that tracks the player exactly
 * turns every terrace step into a visible bob because the horizon is now near the middle of frame.
 * All three are handled below.
 */
import * as THREE from "three";
import type { Vec3 } from "../contracts.js";
import { CAMERA } from "../app/config.js";
import { clamp } from "../core/math.js";

/**
 * Line-of-sight query the camera uses to decide whether it can see the player.
 *
 * Contract, and the root owns every part of it:
 *  - `from` is the player's head, roughly 1.1 m above the feet. `to` is where the camera WANTS to
 *    sit this frame, already at the current yaw/pitch/zoom.
 *  - Return the distance IN METRES from `from` to the first solid hit along that segment, or
 *    `null` when the line is clear. Anything non-finite, negative, or beyond the segment is
 *    ignored, so a physics raycast that reports "no hit" as `Infinity` is safe to pass through.
 *  - The probe must exclude the player's own collider, or the camera will jam at the minimum
 *    distance permanently.
 *  - It is called five times when the requested pose is clear and fifteen at worst, and must not
 *    allocate. It was one call per frame until the centre ray proved insufficient at pitch 0.52:
 *    four of the five are parallel offsets that keep the camera's edges out of a wall the centre
 *    ray slips past, and the pose is re-probed once per pitch-climb candidate.
 */
export type OcclusionProbe = (from: Vec3, to: Vec3) => number | null;

/**
 * How close the camera may get when something is in the way. Deliberately below
 * `CAMERA.minDistance` (6 m): the user-facing zoom floor is a comfort setting, but an occluded
 * camera has to be allowed to go inside it or the player stays hidden, which is the whole bug.
 */
const MIN_OCCLUDED_DISTANCE = 2.6;

/** Metres of clearance kept in front of whatever the probe hit, so the near plane never enters it. */
const OCCLUSION_PADDING = 0.45;

/**
 * Lateral offsets for the extra probes, as fractions of the camera's own right and up axes.
 *
 * Sized to the near plane, not to a notional camera body. At FOV 55, aspect 1.78 and near 0.1 the
 * near plane's corner radius is 0.106 m, so 0.18 covers it with margin. The first attempt used
 * 0.4 m and it over-fired: a roof edge grazing 0.4 m off the sight line pulled the whole camera
 * from 15 m to 4.35 m at the Coldbrace bank, for an obstacle that was never in frame.
 */
const PROBE_OFFSET_METRES = 0.18;
const PROBE_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Per-60 Hz-frame rates. Pull in fast enough to never lose the player, ease out slowly. */
const PULL_IN_RATE = 0.4;
const EASE_OUT_RATE = 0.05;

/**
 * Extra pitch the camera is allowed to climb when something blocks the shot, in radians.
 *
 * Measured need: standing at the Coldbrace bank at pitch 0.52 and distance 18, the camera wants to
 * sit 11 m up and 15.6 m back, and the ray to it passes through a roofline 5 m behind the player.
 * The spring alone answers that by pulling in to 4.5 m, which is a shoulder-cam in a street the
 * player is trying to read. Climbing instead is what the old 0.72 pitch did for free, and it keeps
 * the frame. Tried in order, first one that clears wins, so the flat shot is always preferred.
 *
 * Capped at 0.24 rad (13.7 degrees) deliberately. An earlier version allowed 0.44 and the
 * `town_center` shot climbed from its authored 0.62 to 1.06, which is a map view: the square read
 * as a plan drawing and the player was four pixels tall. The colliders are boxes that include the
 * roof volume, so the probe reports blockers a rendered roofline does not have, and an unbounded
 * climb turns every one of those into a bird's-eye frame. 0.24 was enough for every pose measured:
 * `karrowmoor_terraces` recovers its full 34 m at +0.12.
 */
const PITCH_CLIMB_STEPS: readonly number[] = [0, 0.12, 0.24];

/** A climb only counts as having worked if it recovers this much of the requested distance. */
const CLIMB_ACCEPT_FRACTION = 0.8;

/**
 * How much clearance a climb has to buy before it is taken: this many metres, or this fraction of
 * the requested distance, whichever is larger.
 *
 * The fraction is what stops a marginal climb from wrecking a frame. Measured at `town_center`: the
 * flat pose clears 11.2 m of a requested 26 and a climb to 0.86 rad clears 12.7, so a flat 1.5 m
 * threshold took the climb — and traded a readable square at pitch 0.62 for a near-plan view of
 * empty ground for 1.5 m of nothing. At 25% the same case keeps its authored pitch, while
 * `karrowmoor_terraces` still climbs, because there the gain is 13.2 m of a requested 34.
 *
 * Without any gate at all the camera answers a wall it cannot clear by going BOTH steep and close —
 * measured at the Coldbrace bank as pitch 0.96 with distance 4.35.
 */
const CLIMB_MIN_GAIN_METRES = 1.5;
const CLIMB_MIN_GAIN_FRACTION = 0.25;

/**
 * How long the camera stays pulled in after the blocker clears.
 *
 * Without it, walking past a fence post or a tree trunk at pitch 0.52 makes the spring fire and
 * release several times a second, and the resulting in-out breathing is more distracting than the
 * occlusion was. 220 ms is longer than any single-post transit at 4.2 m/s and short enough that
 * stepping out of a doorway does not feel sticky.
 */
const EASE_OUT_HOLD_MS = 220;

/** Distance change below this is not worth acting on; it only produces visible jitter. */
const OCCLUSION_DEAD_ZONE = 0.05;

/**
 * Vertical follow runs slower than horizontal follow.
 *
 * The focus point is the player's head, and the player's head steps up and down every terrace,
 * ramp and doorstep in Karrowmoor. At the old 0.72 pitch that motion was mostly along the view
 * axis and invisible; at 0.52 it moves the whole frame vertically. 0.55 of the horizontal rate
 * smooths the step without letting the player drift out of frame — a full 4 m terrace step still
 * settles inside 0.2 s.
 */
const VERTICAL_FOLLOW_SCALE = 0.55;

export class OrbitCamera {
  yaw = Math.PI * 0.15;
  pitch = CAMERA.defaultPitch;
  distance = CAMERA.defaultDistance;

  private readonly focus = new THREE.Vector3();
  private readonly smoothed = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  /** Preallocated probe scratch. The probe contract forbids allocating; so does calling it. */
  private readonly probeRight = new THREE.Vector3();
  private readonly probeUp = new THREE.Vector3();
  private readonly probeFrom: [number, number, number] = [0, 0, 0];
  private readonly probeTo: [number, number, number] = [0, 0, 0];
  private initialised = false;
  private lastUpdateMs = 0;
  private occlusionProbe: OcclusionProbe | null = null;
  /** The distance actually used this frame, after occlusion. */
  private effectiveDistance = CAMERA.defaultDistance;
  /** Whether the probe reported a blocker on the most recent update. Read by the debug snapshot. */
  private occluded = false;
  /** Milliseconds left on the ease-out hold. See `EASE_OUT_HOLD_MS`. */
  private holdMs = 0;
  /** The pitch actually used this frame, after any climb over an occluder. */
  private effectivePitch = CAMERA.defaultPitch;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /**
   * Vertical orbit inversion, as a player preference.
   *
   * Applied here rather than at the mouse layer so every route into the camera — drag, keys, a
   * future gamepad — obeys it without each one remembering to.
   */
  invertPitch = false;

  rotate(deltaYaw: number, deltaPitch: number): void {
    if (this.invertPitch) deltaPitch = -deltaPitch;
    this.yaw += deltaYaw;
    this.pitch = clamp(this.pitch + deltaPitch, CAMERA.minPitch, CAMERA.maxPitch);
  }

  zoom(delta: number): void {
    this.distance = clamp(this.distance + delta, CAMERA.minDistance, CAMERA.maxDistance);
  }

  setPose(yaw: number, pitch: number, distance: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, CAMERA.minPitch, CAMERA.maxPitch);
    this.distance = clamp(distance, CAMERA.minDistance, CAMERA.maxDistance);
  }

  /**
   * Wire this to `Physics.raycast` to get the occlusion spring. Left unset, the camera behaves
   * exactly as it did in round 0, so nothing depends on physics being present.
   *
   * Root does:
   *   camera.setOcclusionProbe((from, to) => physics.raycast(from, to, { exclude: playerCollider }));
   *
   * The probe can only report what the physics world contains. Measured at the
   * `karrowmoor_terraces` pose: the spring fires and pulls distance 34 -> 20.76, and the frame is
   * STILL two thirds filled by a tan boulder, because the scatter and landmark rocks carry no
   * collider at all. A camera fix cannot cover for a missing collider; see `OccluderFade` for the
   * part that can be done from here.
   */
  setOcclusionProbe(probe: OcclusionProbe | null): void {
    this.occlusionProbe = probe;
    if (!probe) this.occluded = false;
  }

  /** True when the last update pulled the camera in because something blocked the player. */
  isOccluded(): boolean {
    return this.occluded;
  }

  /** Follows the player. `snap` skips smoothing, for teleports and screenshot poses. */
  update(targetX: number, targetY: number, targetZ: number, snap = false): void {
    const now = typeof performance === "undefined" ? 0 : performance.now();
    const deltaMs = this.lastUpdateMs === 0 ? 16.7 : clamp(now - this.lastUpdateMs, 0, 250);
    this.lastUpdateMs = now;

    this.focus.set(targetX, targetY + 1.1, targetZ);
    if (!this.initialised || snap) {
      this.smoothed.copy(this.focus);
      this.effectiveDistance = this.distance;
      this.effectivePitch = this.pitch;
      this.holdMs = 0;
      this.initialised = true;
    } else {
      // CAMERA.followLerp is authored as "per 60 Hz frame"; convert it to a per-second rate so the
      // lag is the same wall-clock duration at any frame rate.
      const alpha = 1 - Math.pow(1 - CAMERA.followLerp, deltaMs / 16.667);
      const verticalAlpha = 1 - Math.pow(1 - CAMERA.followLerp * VERTICAL_FOLLOW_SCALE, deltaMs / 16.667);
      this.smoothed.x += (this.focus.x - this.smoothed.x) * alpha;
      this.smoothed.z += (this.focus.z - this.smoothed.z) * alpha;
      this.smoothed.y += (this.focus.y - this.smoothed.y) * verticalAlpha;
    }

    const resolved = this.resolveOcclusion(this.distance);

    // Pull in fast so the player never disappears behind rock; ease back out slowly, and only after
    // the hold expires. Asymmetric on purpose: a symmetric spring either snaps outward through the
    // obstacle it just cleared, or lags far enough on the way in that the player is behind geometry
    // for a beat — the exact failure in the round-1 Vellenwood shot, where the player was not
    // visible in their own frame.
    if (snap) {
      this.effectiveDistance = resolved.distance;
      this.effectivePitch = resolved.pitch;
    } else {
      const pullingIn = resolved.distance < this.effectiveDistance;
      if (this.occluded) this.holdMs = EASE_OUT_HOLD_MS;
      else this.holdMs = Math.max(0, this.holdMs - deltaMs);
      if (pullingIn || this.holdMs <= 0) {
        if (Math.abs(resolved.distance - this.effectiveDistance) > OCCLUSION_DEAD_ZONE) {
          const rate = pullingIn ? PULL_IN_RATE : EASE_OUT_RATE;
          const alpha = 1 - Math.pow(1 - rate, deltaMs / 16.667);
          this.effectiveDistance += (resolved.distance - this.effectiveDistance) * alpha;
        }
        const pitchRate = resolved.pitch > this.effectivePitch ? PULL_IN_RATE : EASE_OUT_RATE;
        const pitchAlpha = 1 - Math.pow(1 - pitchRate, deltaMs / 16.667);
        this.effectivePitch += (resolved.pitch - this.effectivePitch) * pitchAlpha;
      }
    }

    const horizontal = Math.cos(this.effectivePitch) * this.effectiveDistance;
    this.camera.position.set(
      this.smoothed.x + Math.sin(this.yaw) * horizontal,
      this.smoothed.y + Math.sin(this.effectivePitch) * this.effectiveDistance,
      this.smoothed.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.smoothed);
  }

  /**
   * The pose the probe says is actually reachable: the requested zoom and pitch, or a climb over
   * whatever is in the way, or a shortened distance when nothing clears it.
   *
   * Returns the request untouched when no probe is wired, so this is a no-op for any caller that
   * has not opted in — the camera is exactly as it was before the probe exists.
   *
   * Every candidate is scored on its FULL clearance, centre ray and offsets together. Scoring the
   * candidates on the centre ray alone and only then running the offsets is what produced the
   * measured `town_center` regression: the climbed pitch had a clear centre line at the full 26 m,
   * won on that, and then an offset ray grazing a roof edge cut it to 12.7 m — worse than the flat
   * pose it beat. Cost: five probes when the requested pose is clear, fifteen worst case.
   */
  private resolveOcclusion(requested: number): { distance: number; pitch: number } {
    this.occluded = false;
    if (!this.occlusionProbe) return { distance: requested, pitch: this.pitch };

    let bestPitch = this.pitch;
    let bestClear = -1;
    let flatClear = -1;
    for (const step of PITCH_CLIMB_STEPS) {
      const pitch = Math.min(CAMERA.maxPitch, this.pitch + step);
      this.aim(pitch, requested);
      const clear = this.clearance(requested);
      if (flatClear < 0) flatClear = clear;
      if (clear > bestClear) {
        bestClear = clear;
        bestPitch = pitch;
      }
      if (clear >= requested * CLIMB_ACCEPT_FRACTION) break;
      // The clamp can make two candidates the same pitch; stop rather than probe it twice.
      if (pitch >= CAMERA.maxPitch) break;
    }

    const gainNeeded = Math.max(CLIMB_MIN_GAIN_METRES, requested * CLIMB_MIN_GAIN_FRACTION);
    if (bestClear < flatClear + gainNeeded) {
      bestPitch = this.pitch;
      bestClear = flatClear;
    }

    this.occluded = bestClear < requested;
    return { distance: bestClear, pitch: bestPitch };
  }

  /**
   * How far the camera can sit along the current aim before anything is in the way.
   *
   * `requested` when the line is clear. The four offset rays are what stop the camera's edges
   * burying themselves in a wall the centre ray slips past.
   */
  private clearance(requested: number): number {
    let nearest: number | null = this.probeSegment(0, 0, requested);
    for (const [right, up] of PROBE_OFFSETS) {
      const hit = this.probeSegment(right * PROBE_OFFSET_METRES, up * PROBE_OFFSET_METRES, requested);
      if (hit !== null && (nearest === null || hit < nearest)) nearest = hit;
    }
    if (nearest === null) return requested;
    return Math.max(MIN_OCCLUDED_DISTANCE, nearest - OCCLUSION_PADDING);
  }

  /** Points `desired` and the probe basis at the camera seat for a given pitch and distance. */
  private aim(pitch: number, distance: number): void {
    const horizontal = Math.cos(pitch) * distance;
    this.desired.set(
      this.smoothed.x + Math.sin(this.yaw) * horizontal,
      this.smoothed.y + Math.sin(pitch) * distance,
      this.smoothed.z + Math.cos(this.yaw) * horizontal,
    );
    // Right and up of the segment, so the offset probes bracket the camera rather than the world.
    // The segment is never vertical (pitch is clamped to 1.32 rad), so a fixed world-up reference
    // cannot degenerate here.
    this.probeRight.set(this.desired.x - this.smoothed.x, 0, this.desired.z - this.smoothed.z);
    const planar = Math.hypot(this.probeRight.x, this.probeRight.z) || 1;
    this.probeRight.set(this.probeRight.z / planar, 0, -this.probeRight.x / planar);
    this.probeUp.set(0, 1, 0);
  }

  /**
   * One probe, offset sideways and vertically from the centre line by the given metres.
   *
   * Returns the hit distance, or null for a clear line. A probe is allowed to report "clear" as
   * null, Infinity, or a distance past the segment. Anything nonsensical (NaN, negative) is treated
   * as clear rather than jamming the camera at the floor, because a wedged camera is far harder to
   * notice in a screenshot than a clipped one.
   */
  private probeSegment(right: number, up: number, requested: number): number | null {
    const probe = this.occlusionProbe;
    if (!probe) return null;
    const dx = this.probeRight.x * right;
    const dz = this.probeRight.z * right;
    const dy = this.probeUp.y * up;
    this.probeFrom[0] = this.smoothed.x + dx;
    this.probeFrom[1] = this.smoothed.y + dy;
    this.probeFrom[2] = this.smoothed.z + dz;
    this.probeTo[0] = this.desired.x + dx;
    this.probeTo[1] = this.desired.y + dy;
    this.probeTo[2] = this.desired.z + dz;
    const hit = probe(this.probeFrom, this.probeTo);
    if (hit === null || !Number.isFinite(hit) || hit <= 0 || hit >= requested) return null;
    return hit;
  }

  /** Frames a point from a fixed pose, immediately. Screenshot poses use this. */
  focusOn(position: Vec3, yaw = this.yaw, pitch = this.pitch, distance = this.distance): void {
    this.setPose(yaw, pitch, distance);
    this.update(position[0], position[1], position[2], true);
  }

  /**
   * JSON-safe, for the debug API. The harness asserts every value here is finite.
   *
   * `distance` is what the camera actually used; `requestedDistance` is what zoom asked for. Round
   * 1 could not tell the two apart, which is how "distance: 18 in every snapshot in both scenario
   * files" went unnoticed as evidence that the spring was never running.
   */
  snapshot(): {
    position: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
    distance: number;
    requestedDistance: number;
    effectivePitch: number;
    occluded: boolean;
    occlusionProbe: boolean;
  } {
    return {
      position: {
        x: Math.round(this.camera.position.x * 1000) / 1000,
        y: Math.round(this.camera.position.y * 1000) / 1000,
        z: Math.round(this.camera.position.z * 1000) / 1000,
      },
      yaw: Math.round(this.yaw * 1000) / 1000,
      pitch: Math.round(this.pitch * 1000) / 1000,
      distance: Math.round(this.effectiveDistance * 1000) / 1000,
      requestedDistance: Math.round(this.distance * 1000) / 1000,
      // `pitch` is what the player asked for; this is what the occlusion climb actually used.
      effectivePitch: Math.round(this.effectivePitch * 1000) / 1000,
      occluded: this.occluded,
      occlusionProbe: this.occlusionProbe !== null,
    };
  }

  reset(): void {
    this.yaw = Math.PI * 0.15;
    this.pitch = CAMERA.defaultPitch;
    this.distance = CAMERA.defaultDistance;
    this.effectiveDistance = CAMERA.defaultDistance;
    this.effectivePitch = CAMERA.defaultPitch;
    this.occluded = false;
    this.holdMs = 0;
    this.initialised = false;
    this.lastUpdateMs = 0;
  }
}

/** Opacity a faded occluder settles at. Low enough to see through, high enough to keep the roof. */
const FADE_OPACITY = 0.25;

/** Per-60 Hz-frame fade rates. Out fast so the player is never hidden; back in gently. */
const FADE_OUT_RATE = 0.3;
const FADE_IN_RATE = 0.12;

/** Below this the material is put back in the opaque pass; above it, it is treated as clear. */
const FADE_SETTLED = 0.995;

interface FadeState {
  material: THREE.Material;
  opacity: number;
  target: number;
  originalTransparent: boolean;
  originalOpacity: number;
  originalDepthWrite: boolean;
}

/**
 * Fades whatever stands between the camera and the player.
 *
 * Dormant by default and opt-in: nothing constructs it unless root does. Why it exists: at
 * `CAMERA.defaultPitch` 0.72 the camera cleared every roof in the game, so a building was never
 * between it and the player. At 0.52 it is, constantly, and the occlusion spring alone cannot solve
 * it — pulling the camera to 2.6 m inside a settlement just puts the wall closer to the lens.
 *
 * Cost, measured against the shape of the scene rather than guessed: three's `Raycaster` rejects a
 * mesh on its bounding sphere before touching a triangle, so the per-frame cost is one sphere test
 * per candidate mesh (39 building boxes' worth of parts) plus triangle tests for the one or two
 * meshes actually on the ray. `PROBE_INTERVAL_MS` throttles even that to 20 Hz; the fade itself
 * interpolates every frame, so the throttle is invisible.
 *
 * The one real cost is the shader: `transparent` is part of three's program cache key, so the first
 * frame a material fades would compile a new program. `Renderer.warmup({ transparentVariants })`
 * exists to pay that at boot instead. Wire both or neither.
 */
export class OccluderFade {
  private readonly raycaster = new THREE.Raycaster();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly states = new Map<THREE.Material, FadeState>();
  private candidates: THREE.Object3D[] = [];
  private sinceProbeMs = Number.POSITIVE_INFINITY;
  private lastFaded = new Set<THREE.Material>();

  /** How often the ray is cast. The fade interpolates every frame regardless. */
  private static readonly PROBE_INTERVAL_MS = 50;

  /**
   * Roots to test. Pass the building group, not the whole scene: fading an `InstancedMesh` fades
   * every instance sharing that material, so scatter rocks and trees are exactly the wrong
   * candidates — one boulder on the ray would take every boulder in the region with it.
   */
  setCandidates(objects: readonly THREE.Object3D[]): void {
    // Copied rather than aliased: `intersectObjects` wants a mutable array and copying once here is
    // cheaper than copying every frame to satisfy it.
    this.candidates = [...objects];
  }

  /** Whether anything was wired. False means `update` is a no-op and costs one comparison. */
  hasCandidates(): boolean {
    return this.candidates.length > 0;
  }

  /**
   * `from` is the player's head and `to` is the camera. Call once per rendered frame, after the
   * camera has been positioned.
   */
  update(from: THREE.Vector3, to: THREE.Vector3, deltaMs: number): void {
    if (this.candidates.length === 0) return;

    this.sinceProbeMs += deltaMs;
    if (this.sinceProbeMs >= OccluderFade.PROBE_INTERVAL_MS) {
      this.sinceProbeMs = 0;
      this.repick(from, to);
    }

    for (const state of this.states.values()) {
      const rate = state.target < state.opacity ? FADE_OUT_RATE : FADE_IN_RATE;
      const alpha = 1 - Math.pow(1 - rate, deltaMs / 16.667);
      state.opacity += (state.target - state.opacity) * alpha;
      this.apply(state);
    }
  }

  /** Puts every material back exactly as it was found. */
  releaseAll(): void {
    for (const state of this.states.values()) {
      state.opacity = 1;
      state.target = 1;
      this.apply(state);
    }
    this.states.clear();
    this.lastFaded.clear();
  }

  private repick(from: THREE.Vector3, to: THREE.Vector3): void {
    this.origin.copy(from);
    this.direction.copy(to).sub(from);
    const length = this.direction.length();
    if (length < 0.001) return;
    this.direction.divideScalar(length);
    this.raycaster.set(this.origin, this.direction);
    this.raycaster.near = 0;
    this.raycaster.far = length;

    const hits = this.raycaster.intersectObjects(this.candidates, true);
    const faded = new Set<THREE.Material>();
    for (const hit of hits) {
      const mesh = hit.object as THREE.Mesh;
      if (mesh.isMesh !== true) continue;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) faded.add(material);
    }

    for (const material of faded) {
      const state = this.states.get(material) ?? this.track(material);
      state.target = FADE_OPACITY;
    }
    for (const material of this.lastFaded) {
      if (faded.has(material)) continue;
      const state = this.states.get(material);
      if (state) state.target = 1;
    }
    this.lastFaded = faded;
  }

  private track(material: THREE.Material): FadeState {
    const state: FadeState = {
      material,
      opacity: 1,
      target: 1,
      originalTransparent: material.transparent,
      originalOpacity: material.opacity,
      originalDepthWrite: material.depthWrite,
    };
    this.states.set(material, state);
    return state;
  }

  private apply(state: FadeState): void {
    const material = state.material;
    if (state.opacity >= FADE_SETTLED) {
      // Back to exactly what it was. Leaving a settled material in the transparent pass would cost
      // sorting and depth-write behaviour it never asked for.
      if (material.transparent !== state.originalTransparent) {
        material.transparent = state.originalTransparent;
        material.depthWrite = state.originalDepthWrite;
        material.needsUpdate = true;
      }
      material.opacity = state.originalOpacity;
      this.states.delete(material);
      return;
    }
    if (material.transparent !== true) {
      material.transparent = true;
      material.depthWrite = false;
      // Required: three caches the compiled program per material and only re-derives it when the
      // version changes, so without this the material keeps its OPAQUE program, which forces alpha
      // to 1 and the fade would silently do nothing.
      material.needsUpdate = true;
    }
    material.opacity = state.opacity * state.originalOpacity;
  }
}
