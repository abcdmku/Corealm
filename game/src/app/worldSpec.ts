/**
 * Derives the terrain spec from canonical content.
 *
 * Round 1 shipped two descriptions of where the regions are: the authored one in
 * `content/regions.ts` and a hand-written one in `render/scene.ts`. They disagreed, which would
 * have put every entity on the wrong terrain. `content/regions.ts` wins, because the route-flip
 * arithmetic that makes Agility matter is measured against those exact coordinates.
 *
 * So the terrain spec is *derived*, not authored twice. There is one source of truth for where the
 * world is, and the renderer consumes it.
 *
 * FROZEN. Only the root edits this file.
 */
import type { RegionId } from "../contracts.js";
import { REGIONS, type RegionDef } from "../content/regions.js";
import type { FlatSpot, RegionTerrainSpec, WorldTerrainSpec, Rect } from "../render/scene.js";

function rectOf(region: RegionDef): Rect {
  return {
    minX: region.bounds.min[0],
    maxX: region.bounds.max[0],
    minZ: region.bounds.min[1],
    maxZ: region.bounds.max[1],
  };
}

function characterOf(regionId: RegionId): RegionTerrainSpec["character"] {
  switch (regionId) {
    case "vellenwood": return "woodland";
    case "karrowmoor": return "highlands";
    case "gravelmaw": return "cavern";
    default: return "plains";
  }
}

/**
 * How far below the surrounding ground a fishing basin is carved, in metres.
 *
 * Deliberately shallow. A 2.2 m basin filled to three quarters put the waterline above the
 * player's head — they stood on the basin floor and the surface was over them. These are shallows
 * and brooks, not lakes: a fisher stands shin-deep at the edge, which is both what the places are
 * named for and the only way the fishing-spot markers stay visible.
 */
export const WATER_BASIN_DEPTH = 0.9;

/**
 * Settlements, banks, and stations need buildable ground. Noise does not provide it, so every
 * settlement centre and every named location gets a flattened pad.
 *
 * Fishing clusters get the opposite: a pad sunk BELOW the surrounding ground, which carves the
 * basin the water plane then fills. Without it there is nowhere for water to sit — the plains are
 * rolling, not channelled — so a water plane either floats on grass or buries itself.
 */
function flatSpotsFor(region: RegionDef): FlatSpot[] {
  const flats: FlatSpot[] = [];

  const settlement = region.settlement;
  if (settlement) {
    flats.push({ x: settlement.centre[0], z: settlement.centre[1], radius: 34, blend: 26 });
  }

  // Named locations are where the player stands still: banks, seams, camps, gates. A 7 m pad keeps
  // an interaction from happening on a slope steep enough to look broken.
  for (const location of region.locations) {
    flats.push({ x: location.position[0], z: location.position[1], radius: 7, blend: 9 });
  }

  for (const cluster of region.clusters) {
    if (cluster.archetype !== "fishing_spot") continue;
    flats.push({
      x: cluster.centre[0],
      z: cluster.centre[1],
      radius: cluster.radius + 4,
      // A wide falloff, so the bank slopes into the water instead of dropping as a cliff the
      // navmesh would refuse to walk down.
      blend: cluster.radius + 16,
      height: -WATER_BASIN_DEPTH,
    });
  }

  return flats;
}

export function buildWorldTerrainSpec(): WorldTerrainSpec {
  const regions: RegionTerrainSpec[] = REGIONS.map((region) => {
    const spec: RegionTerrainSpec = {
      regionId: region.id,
      rect: rectOf(region),
      seed: region.terrainSeed,
      character: characterOf(region.id),
      baseHeight: region.baseHeight,
      amplitude: region.terrainAmplitude,
    };
    // Karrowmoor's terraces are authored as z-bands climbing toward -z.
    if (region.terraces && region.terraces.length > 0) {
      spec.terraceAxis = "-z";
      spec.terraceSteps = region.terraces.length;
    }
    return spec;
  });

  const flats = REGIONS.flatMap((region) => flatSpotsFor(region).map((flat) => (
    // A negative authored height means "this far below the region floor", which is how basins are
    // expressed. Everything else keeps its absolute height, or none at all.
    flat.height !== undefined && flat.height < 0
      ? { ...flat, height: region.baseHeight + flat.height }
      : flat
  )));

  const minX = Math.min(...regions.map((region) => region.rect.minX));
  const maxX = Math.max(...regions.map((region) => region.rect.maxX));
  const minZ = Math.min(...regions.map((region) => region.rect.minZ));
  const maxZ = Math.max(...regions.map((region) => region.rect.maxZ));

  return {
    bounds: { minX, maxX, minZ, maxZ },
    chunkSize: 100,
    metresPerQuad: 2,
    // Narrower than the renderer's 45 m default: the regions meet at a T-junction here, and a wide
    // band would smear Karrowmoor's terrace risers into Vellenwood's mounds at the corner.
    blendMetres: 28,
    regions,
    flats,
  };
}

/** The spawn point, taken from the starting region's authored value. */
export function startingSpawn(): { regionId: RegionId; x: number; z: number } {
  const region = REGIONS.find((candidate) => candidate.id === "fallowmarch") ?? REGIONS[0]!;
  return { regionId: region.id, x: region.spawnPoint[0], z: region.spawnPoint[1] };
}
