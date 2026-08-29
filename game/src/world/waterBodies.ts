import type { ResourceClusterDef } from "../content/regions.js";

/** Vertical distance from the dry ground at a body's centre to its basin floor. */
export const WATER_BASIN_DEPTH = 0.9;

/** Fraction of the basin depth filled with water. */
export const WATER_FILL_FRACTION = 0.55;

/** Water depth over the flat centre of every authored body. */
export const WATER_FILL_DEPTH = WATER_BASIN_DEPTH * WATER_FILL_FRACTION;

/** Height of the closed bank above the water plane. */
export const WATER_BANK_FREEBOARD = 0.45;

/**
 * An authored fishing body as terrain understands it.
 *
 * The four radii describe one continuous radial profile. The floor holds every fishing marker on
 * level ground. The rising bed meets the water at `shoreRadius`, then climbs to a dry crest before
 * returning to the terrain outside. `outerRadius` is deliberately wider than the old basin
 * falloff: even the 4.3 m low side of Cairn Tarn returns at a walkable mean grade.
 */
export interface WaterBasinSpec {
  id: string;
  x: number;
  z: number;
  floorRadius: number;
  shoreRadius: number;
  crestRadius: number;
  outerRadius: number;
  depth: number;
  fillFraction: number;
  freeboard: number;
}

const FLOOR_MARGIN = 4;
const SHORE_MARGIN = 12;
const CREST_MARGIN = 14;
const OUTER_MARGIN = 32;

/** One source for the terrain carve, water mesh search bounds, and later shoreline consumers. */
export function waterBasinForCluster(cluster: ResourceClusterDef): WaterBasinSpec {
  if (cluster.archetype !== "fishing_spot") {
    throw new Error(`Water basin requested for non-fishing cluster "${cluster.id}".`);
  }
  return {
    id: cluster.id,
    x: cluster.centre[0],
    z: cluster.centre[1],
    floorRadius: cluster.radius + FLOOR_MARGIN,
    shoreRadius: cluster.radius + SHORE_MARGIN,
    crestRadius: cluster.radius + CREST_MARGIN,
    outerRadius: cluster.radius + OUTER_MARGIN,
    depth: WATER_BASIN_DEPTH,
    fillFraction: WATER_FILL_FRACTION,
    freeboard: WATER_BANK_FREEBOARD,
  };
}
