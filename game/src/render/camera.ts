/**
 * Elevated third-person MMO camera: orbit yaw, adjustable pitch, zoom, smooth follow.
 * Readable framing over twitch responsiveness, per the brief.
 *
 * Two round-1 additions. The follow smoothing is now frame-rate independent — the round-0 fixed
 * lerp per frame meant the camera lagged twice as far at 30 FPS as at 60, which shows up as
 * inconsistent screenshots. And there is an optional occlusion spring: when something solid sits
 * between the player and the camera, the camera pulls in rather than filming the inside of a
 * Karrowmoor terrace.
 *
 * The occlusion spring is inert until a probe is injected. It stayed inert through all of round 1,
 * which is why `distance` read a constant 18 in every snapshot of both scenario files, including
 * the Vellenwood frame where the player was completely hidden behind canopy. The probe is the
 * root's to supply — see `setOcclusionProbe` for the exact contract.
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
 *  - It is called at most once per rendered frame and must not allocate.
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

/** Per-60 Hz-frame rates. Pull in fast enough to never lose the player, ease out slowly. */
const PULL_IN_RATE = 0.4;
const EASE_OUT_RATE = 0.05;

/** Distance change below this is not worth acting on; it only produces visible jitter. */
const OCCLUSION_DEAD_ZONE = 0.05;

export class OrbitCamera {
  yaw = Math.PI * 0.15;
  pitch = CAMERA.defaultPitch;
  distance = CAMERA.defaultDistance;

  private readonly focus = new THREE.Vector3();
  private readonly smoothed = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private initialised = false;
  private lastUpdateMs = 0;
  private occlusionProbe: OcclusionProbe | null = null;
  /** The distance actually used this frame, after occlusion. */
  private effectiveDistance = CAMERA.defaultDistance;
  /** Whether the probe reported a blocker on the most recent update. Read by the debug snapshot. */
  private occluded = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  rotate(deltaYaw: number, deltaPitch: number): void {
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
      this.initialised = true;
    } else {
      // CAMERA.followLerp is authored as "per 60 Hz frame"; convert it to a per-second rate so the
      // lag is the same wall-clock duration at any frame rate.
      const alpha = 1 - Math.pow(1 - CAMERA.followLerp, deltaMs / 16.667);
      this.smoothed.lerp(this.focus, alpha);
    }

    const distance = this.resolveOcclusion(this.distance);

    // Pull in fast so the player never disappears behind rock; ease back out so the camera does not
    // lurch every time a tree clips the line of sight. Asymmetric on purpose: a symmetric spring
    // either snaps outward through the obstacle it just cleared, or lags far enough on the way in
    // that the player is behind geometry for a beat — the exact failure in the round-1 Vellenwood
    // shot, where the player was not visible in their own frame.
    if (snap) {
      this.effectiveDistance = distance;
    } else if (Math.abs(distance - this.effectiveDistance) > OCCLUSION_DEAD_ZONE) {
      const rate = distance < this.effectiveDistance ? PULL_IN_RATE : EASE_OUT_RATE;
      const alpha = 1 - Math.pow(1 - rate, deltaMs / 16.667);
      this.effectiveDistance += (distance - this.effectiveDistance) * alpha;
    }

    const horizontal = Math.cos(this.pitch) * this.effectiveDistance;
    this.camera.position.set(
      this.smoothed.x + Math.sin(this.yaw) * horizontal,
      this.smoothed.y + Math.sin(this.pitch) * this.effectiveDistance,
      this.smoothed.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.smoothed);
  }

  /**
   * The requested zoom, shortened to whatever the probe says is actually reachable.
   *
   * Returns the requested distance untouched when no probe is wired, so this is a no-op for any
   * caller that has not opted in — the camera is exactly as it was before the probe exists.
   */
  private resolveOcclusion(requested: number): number {
    this.occluded = false;
    if (!this.occlusionProbe) return requested;

    const horizontal = Math.cos(this.pitch) * requested;
    this.desired.set(
      this.smoothed.x + Math.sin(this.yaw) * horizontal,
      this.smoothed.y + Math.sin(this.pitch) * requested,
      this.smoothed.z + Math.cos(this.yaw) * horizontal,
    );
    const from: Vec3 = [this.smoothed.x, this.smoothed.y, this.smoothed.z];
    const to: Vec3 = [this.desired.x, this.desired.y, this.desired.z];

    const hit = this.occlusionProbe(from, to);
    // A probe is allowed to report "clear" as null, Infinity, or a distance past the segment.
    // Anything nonsensical (NaN, negative) is treated as clear rather than jamming the camera at
    // the floor, because a wedged camera is far harder to notice in a screenshot than a clipped one.
    if (hit === null || !Number.isFinite(hit) || hit <= 0 || hit >= requested) return requested;

    this.occluded = true;
    return Math.max(MIN_OCCLUDED_DISTANCE, hit - OCCLUSION_PADDING);
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
      occluded: this.occluded,
      occlusionProbe: this.occlusionProbe !== null,
    };
  }

  reset(): void {
    this.yaw = Math.PI * 0.15;
    this.pitch = CAMERA.defaultPitch;
    this.distance = CAMERA.defaultDistance;
    this.effectiveDistance = CAMERA.defaultDistance;
    this.occluded = false;
    this.initialised = false;
    this.lastUpdateMs = 0;
  }
}
