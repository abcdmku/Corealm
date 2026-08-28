/** Tunables the root owns. Numbers come from runs/corealm/PRD.md. */

export const PLAYER_SPEED = 4.2;          // m/s over the navmesh
export const PLAYER_RADIUS = 0.35;        // m, capsule radius for collision and navmesh inset
export const PLAYER_HEIGHT = 1.8;         // m

export const INTERACT_RANGE = 2.4;        // m, walk-into-range threshold for gathering and talking
export const MELEE_RANGE = 1.6;           // m
export const SPELL_RANGE = 9.0;           // m

export const HEALTH_REGEN_INTERVAL_MS = 6_000;
export const HEALTH_REGEN_BLOCKED_MS = 8_000;
export const LOW_HEALTH_FRACTION = 0.3;

export interface CameraConfig {
  minDistance: number;
  maxDistance: number;
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
  maxDistance: 34,
  defaultDistance: 18,
  minPitch: 0.18,
  maxPitch: 1.32,
  defaultPitch: 0.72,
  fov: 55,
  near: 0.1,
  far: 600,
  followLerp: 0.14,
};

export const NAV_CONFIG = {
  cs: 0.3,
  ch: 0.2,
  walkableRadius: 2,     // voxels
  walkableClimb: 2,      // voxels
  walkableHeight: 9,     // voxels
  walkableSlopeAngle: 48,
  minRegionArea: 4,
} as const;

export const RENDER_BUDGET = { maxDrawCalls: 400, targetFps: 55 } as const;

export const AUTOSAVE_INTERVAL_MS = 10_000;

export const ASSET_MANIFEST_URL = "assets/manifest.json";
export const ASSET_BASE_URL = "assets/";
