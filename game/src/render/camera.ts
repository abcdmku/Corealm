/**
 * Elevated third-person MMO camera: orbit yaw, adjustable pitch, zoom, smooth follow.
 * Readable framing over twitch responsiveness, per the brief.
 *
 * Two round-1 additions. The follow smoothing is now frame-rate independent — the round-0 fixed
 * lerp per frame meant the camera lagged twice as far at 30 FPS as at 60, which shows up as
 * inconsistent screenshots. And there is an optional occlusion spring: when something solid sits
 * between the player and the camera, the camera pulls in rather than filming the inside of a
 * Karrowmoor terrace.
 */
import * as THREE from "three";
import type { Vec3 } from "../contracts.js";
import { CAMERA } from "../app/config.js";
import { clamp } from "../core/math.js";

/** Distance to the first solid hit from `from` toward `to`, or null when the line is clear. */
export type OcclusionProbe = (from: Vec3, to: Vec3) => number | null;

const MIN_OCCLUDED_DISTANCE = 2.6;

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
   */
  setOcclusionProbe(probe: OcclusionProbe | null): void {
    this.occlusionProbe = probe;
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

    let distance = this.distance;
    if (this.occlusionProbe) {
      const horizontal = Math.cos(this.pitch) * distance;
      this.desired.set(
        this.smoothed.x + Math.sin(this.yaw) * horizontal,
        this.smoothed.y + Math.sin(this.pitch) * distance,
        this.smoothed.z + Math.cos(this.yaw) * horizontal,
      );
      const from: Vec3 = [this.smoothed.x, this.smoothed.y, this.smoothed.z];
      const to: Vec3 = [this.desired.x, this.desired.y, this.desired.z];
      const hit = this.occlusionProbe(from, to);
      if (hit !== null && hit < distance) {
        distance = Math.max(MIN_OCCLUDED_DISTANCE, hit * 0.9);
      }
    }

    // Pull in fast so the player never disappears behind rock; ease back out so the camera does not
    // lurch every time a tree clips the line of sight.
    if (snap) {
      this.effectiveDistance = distance;
    } else {
      const rate = distance < this.effectiveDistance ? 0.35 : 0.07;
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

  /** Frames a point from a fixed pose, immediately. Screenshot poses use this. */
  focusOn(position: Vec3, yaw = this.yaw, pitch = this.pitch, distance = this.distance): void {
    this.setPose(yaw, pitch, distance);
    this.update(position[0], position[1], position[2], true);
  }

  /** JSON-safe, for the debug API. The harness asserts every value here is finite. */
  snapshot(): {
    position: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
    distance: number;
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
    };
  }

  reset(): void {
    this.yaw = Math.PI * 0.15;
    this.pitch = CAMERA.defaultPitch;
    this.distance = CAMERA.defaultDistance;
    this.effectiveDistance = CAMERA.defaultDistance;
    this.initialised = false;
    this.lastUpdateMs = 0;
  }
}
