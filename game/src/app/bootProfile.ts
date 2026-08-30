import type { RegionId } from "../contracts.js";
import { getRegion } from "../content/regions.js";
import type { WorldTerrainSpec } from "../render/scene.js";
import {
  buildWorld,
  type BuiltWorld,
  type HeightAt,
  type WorldPorts,
} from "../world/regionBuilder.js";
import { buildWorldTerrainSpec, startingSpawn } from "./worldSpec.js";

export interface BootSpawn {
  readonly regionId: RegionId;
  readonly x: number;
  readonly z: number;
  readonly facingRad: number;
}

/**
 * Selects production boot work without replacing any of the systems that consume it.
 *
 * The feature lab intentionally changes data and expensive world setup only. Player input,
 * simulation, combat, rendering, animation, and UI continue through the normal game boot.
 */
export interface BootProfile {
  readonly kind: "game" | "feature-lab";
  readonly terrain: () => WorldTerrainSpec;
  readonly spawn: BootSpawn;
  readonly buildSemanticWorld: (
    seed: number,
    heightAt: HeightAt,
    ports?: WorldPorts,
  ) => BuiltWorld;
  readonly persistent: boolean;
  readonly worldSurface: boolean;
  readonly dungeon: boolean;
  readonly scatter: boolean;
  readonly validateWorldRefs: boolean;
  readonly fullWarmup: boolean;
}

const authoredSpawn = startingSpawn();

export const GAME_BOOT_PROFILE: BootProfile = Object.freeze({
  kind: "game",
  terrain: buildWorldTerrainSpec,
  spawn: Object.freeze({
    ...authoredSpawn,
    facingRad: getRegion(authoredSpawn.regionId)?.spawnFacingRad ?? 0,
  }),
  buildSemanticWorld: buildWorld,
  persistent: true,
  worldSurface: true,
  dungeon: true,
  scatter: true,
  validateWorldRefs: true,
  fullWarmup: true,
});

const FEATURE_LAB_BOUNDS = Object.freeze({
  minX: -32,
  maxX: 32,
  minZ: -24,
  maxZ: 24,
});

function buildFeatureLabTerrain(): WorldTerrainSpec {
  const bounds = { ...FEATURE_LAB_BOUNDS };
  return {
    bounds,
    chunkSize: 64,
    metresPerQuad: 2,
    blendMetres: 0,
    regions: [{
      regionId: "fallowmarch",
      rect: { ...bounds },
      seed: 0,
      character: "plains",
      baseHeight: 0,
      amplitude: 0,
    }],
  };
}

const buildEmptySemanticWorld: BootProfile["buildSemanticWorld"] = () => ({
  entities: [],
  routeNodes: [],
  routeEdges: [],
  knownLocations: [],
  buildings: [],
  solids: [],
});

export const FEATURE_LAB_BOOT_PROFILE: BootProfile = Object.freeze({
  kind: "feature-lab",
  terrain: buildFeatureLabTerrain,
  spawn: Object.freeze({ regionId: "fallowmarch", x: 0, z: 0, facingRad: 0 }),
  buildSemanticWorld: buildEmptySemanticWorld,
  persistent: false,
  worldSurface: false,
  dungeon: false,
  scatter: false,
  validateWorldRefs: false,
  fullWarmup: false,
});

/** Resolve the current feature-lab actor route while keeping every other URL on the real game. */
export function bootProfileFor(
  locationOrSearch: string | URLSearchParams | Pick<Location, "search">,
): BootProfile {
  const params = typeof locationOrSearch === "string"
    ? new URLSearchParams(locationOrSearch)
    : locationOrSearch instanceof URLSearchParams
      ? locationOrSearch
      : new URLSearchParams(locationOrSearch.search);
  return params.get("mode") === "actors" ? FEATURE_LAB_BOOT_PROFILE : GAME_BOOT_PROFILE;
}
