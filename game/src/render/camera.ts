/**
 * Elevated third-person MMO camera: orbit yaw, adjustable pitch, zoom, smooth follow.
 * Readable framing over twitch responsiveness, per the brief.
 */
import * as THREE from "three";
import { CAMERA } from "../app/config.js";
import { clamp } from "../core/math.js";

export class OrbitCamera {
  yaw = Math.PI * 0.15;
  pitch = CAMERA.defaultPitch;
  distance = CAMERA.defaultDistance;

  private readonly focus = new THREE.Vector3();
  private readonly smoothed = new THREE.Vector3();
  private initialised = false;

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

  /** Follows the player. `snap` skips smoothing, for teleports and screenshot poses. */
  update(targetX: number, targetY: number, targetZ: number, snap = false): void {
    this.focus.set(targetX, targetY + 1.1, targetZ);
    if (!this.initialised || snap) {
      this.smoothed.copy(this.focus);
      this.initialised = true;
    } else {
      this.smoothed.lerp(this.focus, CAMERA.followLerp);
    }

    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.smoothed.x + Math.sin(this.yaw) * horizontal,
      this.smoothed.y + Math.sin(this.pitch) * this.distance,
      this.smoothed.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.smoothed);
  }

  /** JSON-safe, for the debug API. The harness asserts every value here is finite. */
  snapshot(): { position: { x: number; y: number; z: number }; yaw: number; pitch: number; distance: number } {
    return {
      position: {
        x: Math.round(this.camera.position.x * 1000) / 1000,
        y: Math.round(this.camera.position.y * 1000) / 1000,
        z: Math.round(this.camera.position.z * 1000) / 1000,
      },
      yaw: Math.round(this.yaw * 1000) / 1000,
      pitch: Math.round(this.pitch * 1000) / 1000,
      distance: Math.round(this.distance * 1000) / 1000,
    };
  }

  reset(): void {
    this.yaw = Math.PI * 0.15;
    this.pitch = CAMERA.defaultPitch;
    this.distance = CAMERA.defaultDistance;
    this.initialised = false;
  }
}
