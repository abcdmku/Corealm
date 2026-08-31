import type { FeatureLabMode, RegionId } from "../contracts.js";
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
  /** Initial workbench for a lab boot. The normal game never selects one. */
  readonly labMode: FeatureLabMode | null;
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
  labMode: null,
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

const FEATURE_LAB_YARD_BOUNDS = Object.freeze({
  minX: -128,
  maxX: 128,
  minZ: -128,
  maxZ: 128,
});

const FEATURE_LAB_BUILD_PAD = Object.freeze({
  x: 0,
  z: 0,
  radius: 48,
  blend: 24,
  halfExtents: Object.freeze([48, 48] as const),
});

const fallowmarch = (() => {
  const region = getRegion("fallowmarch");
  if (!region) throw new Error("Feature lab needs the canonical Fallowmarch region");
  return region;
})();

function buildFeatureLabTerrain(): WorldTerrainSpec {
  const bounds = { ...FEATURE_LAB_YARD_BOUNDS };
  return {
    bounds,
    chunkSize: 64,
    metresPerQuad: 2,
    blendMetres: 0,
    regions: [{
      regionId: "fallowmarch",
      rect: { ...bounds },
      seed: fallowmarch.terrainSeed,
      character: "plains",
      baseHeight: fallowmarch.baseHeight,
      amplitude: 3,
    }],
    flats: [{
      ...FEATURE_LAB_BUILD_PAD,
      halfExtents: [...FEATURE_LAB_BUILD_PAD.halfExtents] as const,
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

const FEATURE_LAB_SPAWN: BootSpawn = Object.freeze({
  regionId: "fallowmarch",
  x: 0,
  z: 0,
  facingRad: 0,
});

function createFeatureLabProfile(labMode: FeatureLabMode): BootProfile {
  return Object.freeze({
    kind: "feature-lab",
    labMode,
    terrain: buildFeatureLabTerrain,
    spawn: FEATURE_LAB_SPAWN,
    buildSemanticWorld: buildEmptySemanticWorld,
    persistent: false,
    worldSurface: false,
    dungeon: false,
    scatter: false,
    validateWorldRefs: false,
    fullWarmup: false,
  });
}

export const COMBAT_LAB_BOOT_PROFILE = createFeatureLabProfile("combat");
export const BUILDING_LAB_BOOT_PROFILE = createFeatureLabProfile("building");

/** Backwards-compatible name for the original actor/combat lab profile. */
export const FEATURE_LAB_BOOT_PROFILE: BootProfile = COMBAT_LAB_BOOT_PROFILE;

/*
 * Both workbenches boot the same production terrain and empty semantic yard. Only the panel's
 * initial mode differs. Runtime lab controls may switch mode without rebuilding the world.
 */
const FEATURE_LAB_PROFILES: Readonly<Record<FeatureLabMode, BootProfile>> = Object.freeze({
  combat: COMBAT_LAB_BOOT_PROFILE,
  building: BUILDING_LAB_BOOT_PROFILE,
});

/** Resolve the requested workbench while keeping every unrelated URL on the normal game. */
export function bootProfileFor(
  locationOrSearch: string | URLSearchParams | Pick<Location, "search">,
): BootProfile {
  const params = typeof locationOrSearch === "string"
    ? new URLSearchParams(locationOrSearch)
    : locationOrSearch instanceof URLSearchParams
      ? locationOrSearch
      : new URLSearchParams(locationOrSearch.search);
  const mode = params.get("mode");
  if (mode === "combat" || mode === "actors") return FEATURE_LAB_PROFILES.combat;
  if (mode === "building" || mode === "structures") return FEATURE_LAB_PROFILES.building;
  return GAME_BOOT_PROFILE;
}
