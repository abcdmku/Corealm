import type { ResourceClusterDef } from "../content/regions.js";
import { seedFromText, type OrganicShapeSpec } from "./organicFields.js";

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
  /** Shared radial deformation for every nested ring in this basin. */
  shape: OrganicShapeSpec;
}

const FLOOR_MARGIN = 4;
const SHORE_MARGIN = 12;
const CREST_MARGIN = 14;
const OUTER_MARGIN = 32;

type BasinShapeProfile = Pick<OrganicShapeSpec, "aspectRatio" | "irregularity" | "lobes">;

const DEFAULT_BASIN_SHAPE: BasinShapeProfile = {
  aspectRatio: 0.8,
  irregularity: 0.28,
  lobes: 5,
};

/** Four distinct silhouettes, with the seed still owning their rotation and cove phases. */
const BASIN_SHAPES: Readonly<Record<string, BasinShapeProfile>> = {
  redsill_spots: { aspectRatio: 0.74, irregularity: 0.3, lobes: 4 },
  blackwater_spots: { aspectRatio: 0.82, irregularity: 0.28, lobes: 5 },
  cairn_tarn_spots: { aspectRatio: 0.72, irregularity: 0.26, lobes: 6 },
  far_tarn_spots: { aspectRatio: 0.78, irregularity: 0.32, lobes: 7 },
};

function basinShape(id: string): OrganicShapeSpec {
  const seed = seedFromText(id);
  const profile = BASIN_SHAPES[id] ?? DEFAULT_BASIN_SHAPE;
  return {
    seed,
    ...profile,
    rotation: ((seed >>> 8) & 0xffff) / 0x1_0000 * Math.PI * 2,
  };
}

/** One source for the terrain carve, water mesh search bounds, and later shoreline consumers. */
export function waterBasinForCluster(cluster: ResourceClusterDef): WaterBasinSpec {
  if (cluster.archetype !== "fishing_spot") {
    throw new Error(`Water basin requested for non-fishing cluster "${cluster.id}".`);
  }
  const shape = basinShape(cluster.id);
  const shoreRadius = cluster.radius + SHORE_MARGIN;
  // The strongest possible cove is bounded by aspect * (1 - irregularity). Size the nominal
  // floor against that bound so every authored fishing marker still sits over flat basin floor.
  const minimumScale = (shape.aspectRatio ?? 1) * (1 - shape.irregularity);
  const floorRadius = Math.min(
    shoreRadius - 1,
    Math.max(cluster.radius + FLOOR_MARGIN, cluster.radius / minimumScale + 0.75),
  );
  return {
    id: cluster.id,
    x: cluster.centre[0],
    z: cluster.centre[1],
    floorRadius,
    shoreRadius,
    crestRadius: cluster.radius + CREST_MARGIN,
    outerRadius: cluster.radius + OUTER_MARGIN,
    depth: WATER_BASIN_DEPTH,
    fillFraction: WATER_FILL_FRACTION,
    freeboard: WATER_BANK_FREEBOARD,
    // `organicRadiusScale` only shrinks. The old radii remain hard outer limits for terrain edits.
    shape,
  };
}
