/**
 * Deterministic procedural dressing.
 *
 * Scatter is everything the player can see and nothing the player can touch. Gameplay entities are
 * authored in region data and built by the world layer; this file places grass, trees, rocks and
 * clutter around them. If something here becomes interactable, it has been put in the wrong file.
 *
 * Four properties are load-bearing:
 *
 *  1. **Deterministic.** Same seed, byte-identical layout. Every draw comes from `core/rng.ts`;
 *     `Math.random` is banned. Each layer gets its own derived stream, so adding a layer or
 *     changing one layer's count cannot shift the layout of any other layer.
 *  2. **Clustered, not even.** Round 2 measured the old sampler and found the mechanical cause of
 *     the brief's "random assets thrown on a board": `poissonDisc` overrode every authored
 *     `spacing` with `sqrt(area * 0.66 / maxCount)`, so Fallowmarch's authored 3.4 m grass had a
 *     10.4 m minimum and an 11.3 m mean nearest-neighbour gap, and Vellenwood's canopy a 15.3 m
 *     minimum. Poisson-disc is an ANTI-clustering algorithm, and the `patchiness` control layered
 *     on top was a per-point Bernoulli test that only ever removed points — so no grove, treeline,
 *     reed bed or rock field could form at any setting. Placement is now two-level: Poisson the
 *     cluster CENTRES at `cluster.spacing`, test the terrain, mask and settlement rules on the
 *     CENTRE, then Poisson the members inside a disc with a radial falloff and a dominant/secondary
 *     species split. `maxCount` caps accepted clusters rather than widening a radius.
 *  3. **Grounded.** Every instance sits on `meshHeightAt` (the DRAWN surface) rather than
 *     `heightAtXZ` (the analytic field); the two differ by meanAbs 0.031 m with 6.1% of samples
 *     over 5 cm, which is exactly the band in which a 9 cm pebble floats or vanishes. Instances
 *     also lean into `normalAt` by a per-layer `tilt`, so a stone on a scree slope beds into the
 *     slope instead of standing plumb through it.
 *  4. **Instanced and TILED.** One `InstancedMesh` per (asset, material, spatial tile), per region.
 *     That is the whole budget argument (runs/corealm/architecture.md, correction R6). Draw calls
 *     are FLAT in instance count and LINEAR in species count, so density is nearly free and each
 *     new species costs 1-2 calls (2-4 with shadows) in every tile it appears in. Every number in
 *     `DEFAULT_SCATTER` is chosen against that asymmetry: counts run high, species lists stay
 *     short.
 *  5. **Continuous, and REGIONAL.** Two layers carry the low cover: `groundcover` clusters it into
 *     tufts and `carpet` lays a Poisson floor under the whole region so it never drops to nothing.
 *     `carpet` names the same assets, so under (4) it shares their meshes and costs no extra draw
 *     call. Each region has its own pool — `MEADOW_COVER`, `WOODLAND_COVER`, `UPLAND_COVER` —
 *     because one shared pool made all three regions the same sward with a different vertex colour
 *     under it, and because a species another layer in the SAME region already instances is free.
 *
 * The consequence of (4) worth stating out loud, and what it used to cost: a REGION-wide
 * `InstancedMesh` has a region-wide bounding sphere, so it was never frustum-culled and never
 * distance-culled below `WorldScene.updateStreaming`'s per-region granularity. Every streamed-in
 * region submitted all of its triangles to the colour pass AND to a 96 x 96 m shadow pass, every
 * frame. Cutting the buckets on a grid — 96 m for shadow casters, matching the shadow box, 128 m
 * for the big ground-cover buckets — hands three.js a sphere it can actually reject.
 * `THREE.BatchedMesh` keyed on MATERIAL would additionally collapse the species-count cost, and is
 * the only way to spend fewer draw calls AND fewer triangles at once — the 63-asset nature+rock kit
 * uses only 17 materials — but it lives in `render/scene.ts`, which this pass does not own.
 *
 * ROUND 5 RE-EXAMINED THE TILING AND LEFT IT ALONE, which is worth writing down because the
 * standing recommendation said to undo it. The argument for undoing it was that the draw-call
 * budget was blown (517 of 400 at `town_entrance`) and frame time had 4x headroom, so trading calls
 * for triangles was the wrong way round. What was actually eating the budget was `render/
 * entityViews.ts` submitting 490 separate `InstancedMesh`es; batching those took the worst pose from
 * 517 to 299 and did not touch this file at all. With 100 calls of margin and median frame time
 * roughly doubled by the per-instance cull, the axis that is tight is now triangles, which is the
 * side of the trade the tiling is already on.
 *
 * The sweep behind that, per pose, is runs/corealm/audit/dcb-sweep.ts: it runs the real
 * `scatterRegion`, rebuilds every candidate shard's bounding sphere, and tests it against the real
 * camera frustum (fov 55, far = FOG_FAR 210) and the 96 m shadow box at all 18 shot poses.
 *
 * ```text
 *   config                                 worst-pose calls   worst-pose tris   mean calls   mean tris
 *   no tiling at all                                     60            12.01M           46       9.98M
 *   shipped: shadow 96, cover 128 / 4000                166             7.88M          103       5.59M  <-
 *   + a 4-instance-per-tile floor                       162             8.27M           99       5.91M
 *   + an 8-instance-per-tile floor                      156             8.87M           93       6.41M
 *   + a 16-instance-per-tile floor                      125            10.35M           80       7.44M
 *   + a 24-instance-per-tile floor                      113            10.61M           76       7.67M
 * ```
 *
 * Every step away from the shipped row buys draw calls at 100,000 triangles each, which is a worse
 * rate than any line in the original sweep. The suspicious-looking buckets are suspicious only
 * world-wide: `vellenwood:tree_twisted_2` really does hold 14 instances in 8 tiles, and un-tiling it
 * plus the two `tree_dead_5` buckets saves 74 draw calls WORLD-WIDE and only 4 at any actual pose,
 * because the culling those tiles exist for is already doing its job. Those species are also 3-10k
 * triangles each, so the 4 calls cost 0.39M triangles. Left as shipped.
 *
 * Exclusion zones are how gameplay space stays clear, and they are now a DENSITY FIELD rather than
 * a boolean: a settlement thins out over a band instead of ending in a bare 46 m disc.
 */
import type { RegionId, Vec3 } from "../contracts.js";
import { REGIONS } from "../content/regions.js";
import { Rng } from "../core/rng.js";
import type { AssetRegistry } from "../render/assets.js";
import {
  createValueNoise,
  type GrassSpritePlacement,
  type Rect,
  type ScatterPlacement,
  type WorldScene,
} from "../render/scene.js";

// ------------------------------------------------------------- exclusions

export type ExclusionKind = "building" | "settlement" | "road" | "cluster" | "spawn" | "water" | "custom";

interface CircleZone { kind: ExclusionKind; id: string; x: number; z: number; radius: number }
interface RectZone {
  kind: ExclusionKind;
  id: string;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  rotationY: number;
  margin: number;
}

/**
 * How one layer answers one zone: dead clear out to `hard` metres past the zone edge, then ramping
 * linearly to full density over the next `fade` metres.
 *
 * `hard` may be negative, which reaches INSIDE the zone. Ground cover uses that, because the root
 * registers every settlement on a flat 46 m circle while the widest settlement actually authored
 * measures 33.9 m from its centre (Coldbrace; Rootfall 22.4 m, Highcairn 22.1 m). A boolean test on
 * that circle is what produced the bare disc in every settlement screenshot.
 */
export interface ExclusionBand { hard: number; fade: number }

export interface ExclusionProfile {
  base: ExclusionBand;
  byKind?: Partial<Record<ExclusionKind, ExclusionBand>>;
  /**
   * Band against a settlement's own authored buildings, wall runs, paving and props, which are a
   * separate zone set from the root's one 46 m ring per settlement. Defaults to `base`.
   */
  authored?: ExclusionBand;
  /** Building-footprint override within the authored set. Defaults to `authored`. */
  authoredBuilding?: ExclusionBand;
}

const HARD_EDGE: ExclusionProfile = { base: { hard: 0, fade: 0 } };

/**
 * Widest reach the circle index is built for, in metres. Any profile asking for more than this
 * falls back to a linear scan, which is correct but O(zones); the world registers ~870 circles
 * (mostly road corridor stamps) and scatter evaluates the field ~50,000 times per build, so the
 * index is the difference between a 40 ms and a 2 s dressing pass.
 */
const ZONE_INDEX_REACH = 48;
const ZONE_CELL = 24;

/**
 * Places nothing may be scattered, and how sharply. Registered by the root before `scatterRegion`
 * runs, because scatter has no idea what a bank or an ore seam is and must not learn.
 */
export class ExclusionZones {
  private circles: CircleZone[] = [];
  private rects: RectZone[] = [];
  private index: Map<number, number[]> | null = null;
  private rectIndex: Map<number, number[]> | null = null;

  addCircle(x: number, z: number, radius: number, kind: ExclusionKind = "custom", id = ""): this {
    this.circles.push({ kind, id, x, z, radius });
    this.index = null;
    return this;
  }

  addPoint(position: Vec3, radius: number, kind: ExclusionKind = "cluster", id = ""): this {
    return this.addCircle(position[0], position[2], radius, kind, id);
  }

  addRect(rect: Rect, margin = 0, kind: ExclusionKind = "settlement", id = ""): this {
    return this.addOrientedRect(
      (rect.minX + rect.maxX) / 2,
      (rect.minZ + rect.maxZ) / 2,
      rect.maxX - rect.minX,
      rect.maxZ - rect.minZ,
      0,
      margin,
      kind,
      id,
    );
  }

  /** A precise footprint rectangle in its own rotated frame. Width/depth are full extents. */
  addOrientedRect(
    x: number,
    z: number,
    width: number,
    depth: number,
    rotationY: number,
    margin = 0,
    kind: ExclusionKind = "settlement",
    id = "",
  ): this {
    this.rects.push({
      kind,
      id,
      x,
      z,
      halfX: Math.max(0, width / 2),
      halfZ: Math.max(0, depth / 2),
      rotationY,
      margin,
    });
    this.rectIndex = null;
    return this;
  }

  /** A road, river or path. Registered as overlapping circles along the spline. */
  addCorridor(points: readonly Vec3[], width: number, kind: ExclusionKind = "road", id = ""): this {
    const radius = width / 2;
    const spacing = Math.max(1.5, radius * 0.85);
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const steps = Math.max(1, Math.ceil(length / spacing));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        this.addCircle(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, radius, kind, id);
      }
    }
    return this;
  }

  /**
   * 0..1 planting density at a point: 0 inside a zone plus its `hard` margin, 1 once every zone is
   * `hard + fade` metres away, linear between. The minimum over all zones, so the tightest rule
   * wins.
   *
   * This replaced a boolean `blocks()` because the boolean is what produced the bare 46 m disc
   * around every settlement — trees, bushes, grass and pebbles all stopped dead on the same circle
   * and nothing was planted inside it.
   */
  densityAt(x: number, z: number, profile: ExclusionProfile = HARD_EDGE): number {
    let density = 1;
    for (const circle of this.circleCandidates(x, z, profile)) {
      const band = profile.byKind?.[circle.kind] ?? profile.base;
      const outside = Math.hypot(x - circle.x, z - circle.z) - circle.radius;
      density = Math.min(density, ramp(outside, band));
      if (density <= 0) return 0;
    }
    for (const zone of this.rectCandidates(x, z, profile)) {
      const band = profile.byKind?.[zone.kind] ?? profile.base;
      const worldX = x - zone.x;
      const worldZ = z - zone.z;
      const cosine = Math.cos(zone.rotationY);
      const sine = Math.sin(zone.rotationY);
      const localX = worldX * cosine - worldZ * sine;
      const localZ = worldX * sine + worldZ * cosine;
      const outsideX = Math.max(Math.abs(localX) - zone.halfX, 0);
      const outsideZ = Math.max(Math.abs(localZ) - zone.halfZ, 0);
      density = Math.min(density, ramp(Math.hypot(outsideX, outsideZ) - zone.margin, band));
      if (density <= 0) return 0;
    }
    return density;
  }

  /** True when a point is inside any zone, expanded by `margin` metres. */
  blocks(x: number, z: number, margin = 0): boolean {
    return this.densityAt(x, z, { base: { hard: margin, fade: 0 } }) <= 0;
  }

  count(): number {
    return this.circles.length + this.rects.length;
  }

  /** JSON-safe, for the debug surface. */
  describe(): { circles: number; rects: number; kinds: Record<string, number> } {
    const kinds: Record<string, number> = {};
    for (const circle of this.circles) kinds[circle.kind] = (kinds[circle.kind] ?? 0) + 1;
    for (const zone of this.rects) kinds[zone.kind] = (kinds[zone.kind] ?? 0) + 1;
    return { circles: this.circles.length, rects: this.rects.length, kinds };
  }

  clear(): void {
    this.circles = [];
    this.rects = [];
    this.index = null;
    this.rectIndex = null;
  }

  /** Circles that can possibly affect `(x, z)`, from the grid when the profile fits inside it. */
  private circleCandidates(x: number, z: number, profile: ExclusionProfile): CircleZone[] {
    const reach = profileReach(profile);
    if (reach > ZONE_INDEX_REACH) return this.circles;
    const bucket = this.zoneIndex().get(cellKey(Math.floor(x / ZONE_CELL), Math.floor(z / ZONE_CELL)));
    if (!bucket) return EMPTY_ZONES;
    return bucket.map((slot) => this.circles[slot]!);
  }

  /** Rectangles that can affect `(x, z)`, using the same bounded-reach grid as circles. */
  private rectCandidates(x: number, z: number, profile: ExclusionProfile): RectZone[] {
    const reach = profileReach(profile);
    if (reach > ZONE_INDEX_REACH) return this.rects;
    const bucket = this.rectZoneIndex().get(cellKey(Math.floor(x / ZONE_CELL), Math.floor(z / ZONE_CELL)));
    if (!bucket) return EMPTY_RECT_ZONES;
    return bucket.map((slot) => this.rects[slot]!);
  }

  private zoneIndex(): Map<number, number[]> {
    if (this.index) return this.index;
    const index = new Map<number, number[]>();
    for (const [slot, circle] of this.circles.entries()) {
      const reach = circle.radius + ZONE_INDEX_REACH;
      const minCol = Math.floor((circle.x - reach) / ZONE_CELL);
      const maxCol = Math.floor((circle.x + reach) / ZONE_CELL);
      const minRow = Math.floor((circle.z - reach) / ZONE_CELL);
      const maxRow = Math.floor((circle.z + reach) / ZONE_CELL);
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const key = cellKey(col, row);
          const bucket = index.get(key);
          if (bucket) bucket.push(slot);
          else index.set(key, [slot]);
        }
      }
    }
    this.index = index;
    return index;
  }

  private rectZoneIndex(): Map<number, number[]> {
    if (this.rectIndex) return this.rectIndex;
    const index = new Map<number, number[]>();
    for (const [slot, zone] of this.rects.entries()) {
      const cosine = Math.abs(Math.cos(zone.rotationY));
      const sine = Math.abs(Math.sin(zone.rotationY));
      const extentX = zone.halfX * cosine + zone.halfZ * sine + zone.margin + ZONE_INDEX_REACH;
      const extentZ = zone.halfX * sine + zone.halfZ * cosine + zone.margin + ZONE_INDEX_REACH;
      const minCol = Math.floor((zone.x - extentX) / ZONE_CELL);
      const maxCol = Math.floor((zone.x + extentX) / ZONE_CELL);
      const minRow = Math.floor((zone.z - extentZ) / ZONE_CELL);
      const maxRow = Math.floor((zone.z + extentZ) / ZONE_CELL);
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const key = cellKey(col, row);
          const bucket = index.get(key);
          if (bucket) bucket.push(slot);
          else index.set(key, [slot]);
        }
      }
    }
    this.rectIndex = index;
    return index;
  }
}

const EMPTY_ZONES: CircleZone[] = [];
const EMPTY_RECT_ZONES: RectZone[] = [];

function profileReach(profile: ExclusionProfile): number {
  let reach = Math.max(0, profile.base.hard + profile.base.fade);
  for (const band of Object.values(profile.byKind ?? {})) {
    if (band) reach = Math.max(reach, band.hard + band.fade);
  }
  return reach;
}

function cellKey(col: number, row: number): number {
  return ((col & 0xffff) << 16) | (row & 0xffff);
}

/**
 * Metres per side of the spatial tile a large NON-casting bucket is cut into.
 *
 * One `InstancedMesh` per (asset, region) has a region-wide bounding sphere, and
 * `Frustum.intersectsObject` tests exactly that sphere, so a 240 x 400 m sphere intersects every
 * frustum there is: nothing was ever culled and every streamed-in region submitted 100% of its
 * instances to the colour pass AND to the shadow pass, every frame. Cutting a bucket on a grid
 * hands three.js a sphere it can reject.
 *
 * The sizes are a measured compromise, not a guess. A culled tile costs nothing but a VISIBLE one
 * costs a draw call, and draw calls are gated at 400 per pose, so every halving of the tile trades
 * calls for triangles. Measured over all 18 poses by `runs/corealm/audit/cov-offline.ts`, which
 * rebuilds each candidate mesh's bounding sphere and tests it against the real camera frustum and
 * the 96 m shadow box (scatter only — it isolates this file from the rest of the renderer):
 *
 * ```text
 *   config                   worst-pose calls   worst-pose triangles   mean calls   mean triangles
 *   one mesh per asset                46              11.44M              34           9.20M
 *   casters at 96 m                   76               9.08M              45           7.10M
 *   + cover 256 m over 1200          106               7.81M              66           5.58M
 *   + cover 160 m over 1200          130               7.06M              86           4.86M
 *   + cover 128 m over 1200          138               6.42M              88           4.34M
 *   + cover 128 m over 4000          112               6.64M              71           4.71M   <-
 *   + cover  96 m over 1200          177               6.05M             114           4.08M
 * ```
 *
 * 128 m over a 4,000-instance floor is the knee, and it beats the 160 m setting on BOTH axes: past
 * it, each further halving costs as many calls again for a tenth as many triangles. The small
 * buckets — bloom, fungus, the three stones, the mushrooms, and the two smaller carpets — are left
 * whole by `TILE_MIN_INSTANCES`, because each would multiply into several visible tiles for a few
 * hundred instances.
 */
const BUCKET_TILE_METRES = 128;

/**
 * Tile size for shadow casters, in metres.
 *
 * 96 because `render/renderer.ts` runs an orthographic shadow camera of exactly 96 x 96 m — 9,216
 * m2 against a 96,000 m2 region — so before this, 90% of every tree drawn into the shadow map was
 * outside the box it was being drawn for. This is the single best line in the table above: 2.36M
 * triangles for 30 draw calls, better than twice the rate of any cover setting, because a tree is
 * 3,200 triangles against a grass tuft's 155 and it pays for the shadow pass twice over.
 */
const SHADOW_TILE_METRES = 96;

/**
 * Instances below which a non-casting bucket is left as one region-wide mesh.
 *
 * A bucket of 300 pebbles cut into 5 visible tiles costs 4 extra draw calls to cull ~0.03M
 * triangles; a bucket of 8,700 grass tufts costs the same 4 calls to cull ~0.9M. The threshold
 * sorts one from the other, and 4,000 rather than 1,200 because the sweep above measured 1,200 as
 * 26 more draw calls at the worst pose for 0.22M fewer triangles — the wrong end of the trade.
 */
const TILE_MIN_INSTANCES = 4000;

interface MeshInstanceBucket {
  kind: "mesh";
  assetId: string;
  castShadow: boolean;
  placements: ScatterPlacement[];
}

interface GrassInstanceBucket {
  kind: "grass";
  assetId: "grass-sprite";
  castShadow: false;
  placements: GrassSpritePlacement[];
}

type InstanceBucket = MeshInstanceBucket | GrassInstanceBucket;

const GRASS_SPRITE_IDS = new Set([
  "grass_common_short",
  "grass_common_tall",
  "grass_wispy_short",
  "grass_wispy_tall",
]);

function isGrassSprite(assetId: string): boolean {
  return GRASS_SPRITE_IDS.has(assetId);
}

function tileIndex(x: number, z: number, metres: number): number {
  return cellKey(Math.floor(x / metres), Math.floor(z / metres));
}

/** One mesh per tile for a caster or a big bucket, one mesh for everything else. */
function shardByTile<T extends { position: Vec3 }>(
  bucket: { castShadow: boolean; placements: T[] },
): { tile: number; placements: T[] }[] {
  const metres = bucket.castShadow
    ? SHADOW_TILE_METRES
    : bucket.placements.length >= TILE_MIN_INSTANCES ? BUCKET_TILE_METRES : 0;
  if (metres <= 0) return [{ tile: 0, placements: bucket.placements }];
  const shards = new Map<number, T[]>();
  for (const placement of bucket.placements) {
    const tile = tileIndex(placement.position[0], placement.position[2], metres);
    const shard = shards.get(tile);
    if (shard) shard.push(placement);
    else shards.set(tile, [placement]);
  }
  return [...shards].map(([tile, placements]) => ({ tile, placements }));
}

/** 0 at or inside `hard`, 1 at `hard + fade`, linear between. A zero `fade` is a step. */
function ramp(distance: number, band: ExclusionBand): number {
  if (distance <= band.hard) return 0;
  if (band.fade <= 0) return 1;
  return Math.min(1, (distance - band.hard) / band.fade);
}

/**
 * The registry the root writes settlement and cluster footprints into. `scatterRegion` uses it
 * unless a spec supplies its own, so the wiring is one import and a few `addCircle` calls.
 */
export const worldExclusions = new ExclusionZones();

// ------------------------------------------------------------------ specs

/** Where a layer's candidate points come from. A layer may use more than one. */
export type ScatterSource = "field" | "road" | "shore";

export interface ScatterSpeciesSpec {
  assetId: string;
  /** Relative pick weight inside the layer. Defaults to 1. */
  weight?: number;
  /** Overrides the layer scale band. Multiplier on the GLB's native size. */
  scale?: [number, number];
  /** Overrides the layer tilt: 0 stands plumb, 1 aligns fully with the ground normal. */
  tilt?: number;
  /** Overrides the layer sink, in metres. */
  sink?: number;
  /** Restricts the species to some of the layer's sources. Reeds are `["shore"]`. */
  sources?: ScatterSource[];
}

/**
 * Two-level placement. Centres are Poisson-sampled at `spacing` and tested against terrain, mask
 * and settlement rules; members are Poisson-sampled inside a disc of radius drawn from `radius`.
 */
export interface ScatterClusterSpec {
  /** Minimum metres between cluster centres. Honoured exactly — no auto-widening. */
  spacing: number;
  /** Cluster radius band, in metres. */
  radius: [number, number];
  /** Minimum metres between members inside a cluster. */
  memberSpacing: number;
  /** Base probability a candidate centre becomes a cluster, before the terrain rules multiply it. */
  accept: number;
  /** 0..1. How hard members thin toward the rim, as `1 - falloff * (r/R)^2`. Defaults to 0.75. */
  falloff?: number;
  /** 0..1 share of members that use the cluster's dominant species. Defaults to 0.7. */
  dominance?: number;
}

/** Dressing that follows the CURVED road centrelines, not the authored endpoints. */
export interface ScatterRoadSpec {
  /** Lateral offset band from the centreline, in metres. Both sides. */
  band: [number, number];
  /** Instances per linear metre of road, summed over both sides. */
  perMetre: number;
}

/** Dressing that follows a measured waterline. */
export interface ScatterShoreSpec {
  /** Offset band from the waterline, in metres. Negative reaches into the water. */
  band: [number, number];
  /** Instances per metre of shoreline. */
  perMetre: number;
}

export interface ScatterTerrainSpec {
  /** Reject placements steeper than this (rise over run). 0.7 is about 35 degrees. */
  slopeMax?: number;
  /**
   * Acceptance multiplier from slope: `flat` at or below `low`, `steep` at or above `high`, lerped
   * between. Scree wants x4 on the risers and x0.15 on the terrace tops; grass wants the reverse.
   */
  slopeBias?: { low: number; high: number; flat: number; steep: number };
  /** Altitude band as a fraction of the region's terrain amplitude above its base height. */
  altitude?: [number, number];
  /** Metres of soft edge on the altitude band. Defaults to 4. */
  altitudeFade?: number;
  /** Acceptance multiplier within `reach` metres of a waterline. */
  moisture?: { reach: number; boost: number };
}

export interface ScatterLayerSpec {
  id: string;
  /** The species pool, with per-species weight, scale, tilt and source restrictions. */
  species?: ScatterSpeciesSpec[];
  /** Shorthand for a flat, equally weighted pool. */
  assetIds?: string[];
  /** Last resort: every manifest asset carrying ALL of `tags`, capped by `maxVariants`. */
  tags?: string[];
  /**
   * Cap on distinct assets from a `tags` lookup only; an explicit `species` list is taken whole.
   * A source GLB costs one `InstancedMesh` per primitive and every tree in this kit has two, so a
   * 2-variant shadow-casting tree layer is 2 x 2 x 2 = 8 draw calls while a 6-variant pebble layer
   * is 6. Instance count does not affect it at all.
   */
  maxVariants?: number;
  /**
   * Minimum spacing between lone props, in metres, for a layer with no `cluster`. Honoured exactly:
   * the old sampler silently widened it to `sqrt(area * 0.66 / maxCount)`, which on every region in
   * the world exceeded every authored value.
   */
  spacing?: number;
  /**
   * Cap on instances from the `field` generator. Stops accepting new CLUSTERS, so a cluster is
   * never cut in half; `road` and `shore` are budgeted by their own per-metre rates on top.
   */
  maxCount: number;
  scale: [number, number];
  /**
   * Exponent on the uniform draw inside the scale band. Above 1 most props are small and a few are
   * large, which is what gives a stand a size hierarchy instead of one uniform band. Defaults 2.2.
   */
  sizeBias?: number;
  /** 0..1 lean into the ground normal. 1 for pebbles and flat plants, 0.1 for trees. */
  tilt?: number;
  /** Metres to sink into the ground so rocks and stumps bed in. */
  sink?: number;
  /** Only large silhouettes cast: shadow casters cost a second draw call each. */
  castShadow?: boolean;
  /**
   * 50% negative-X mirroring. Free variety on top of the yaw, and safe on this kit because every
   * nature and rock material is authored `doubleSided`. Off by default and left off for shadow
   * casters: a negative determinant flips the winding, and the shadow pass culls on winding.
   */
  mirror?: boolean;
  /** Extra metres added to every exclusion band for this layer. */
  clearance?: number;
  exclusion?: ExclusionProfile;
  terrain?: ScatterTerrainSpec;
  cluster?: ScatterClusterSpec;
  /** Low-frequency fbm that carves clearings by rejecting whole clusters. */
  mask?: { strength: number; featureSize: number };
  /** Metres past the region rect that candidates may be generated. Defaults to the seam blend. */
  bleed?: number;
  road?: ScatterRoadSpec;
  shore?: ScatterShoreSpec;
  /** Optional absolute altitude band, in metres. */
  heightRange?: [number, number];
}

export interface RegionScatterSpec {
  regionId: RegionId;
  layers: ScatterLayerSpec[];
  /** Defaults to the region's rect from the scene. */
  rect?: Rect;
  exclusions?: ExclusionZones;
}

export interface ScatterResult {
  regionId: RegionId;
  placed: number;
  rejected: number;
  /** Accepted cluster centres, world-wide for this region. A copse is one; a tuft of grass is one. */
  clusters: number;
  instancedMeshes: number;
  /**
   * Draw calls added, counting the shadow pass for casters, WITH NOTHING CULLED.
   *
   * Same warning as `estimatedTriangles` below and it is easy to misread the other way: this is an
   * upper bound over the whole region, not a per-frame figure. Shipped, the three regions report
   * 127 / 167 / 130 = 424, while the frustum sweep in runs/corealm/audit/dcb-sweep.ts puts the
   * worst single pose at 166 and the mean at 103 — a quarter of the world-wide number. Do not
   * subtract this from `renderer.info.render.calls`; they are different quantities.
   */
  estimatedDrawCalls: number;
  /**
   * Triangles this region submits when it is streamed in AND nothing is frustum-culled, counting
   * the shadow pass. Since the buckets are tiled (`BUCKET_TILE_METRES`, `SHADOW_TILE_METRES`) this
   * is an upper bound rather than the per-frame figure: what the GPU actually sees is this number
   * times the share of tiles inside the camera frustum, and a much smaller share again for the
   * shadow pass. Measured across the 18 poses, the worst pose sees 58% of this and the mean 41%.
   */
  estimatedTriangles: number;
  /** Distinct spatial tiles the placements were cut into. `estimatedDrawCalls` scales with this. */
  tiles: number;
  byLayer: Record<string, number>;
  bySource: Record<string, number>;
  missingAssets: string[];
}

// ------------------------------------------------------------- sampling

/**
 * Bridson Poisson-disc sampling over a rect, seeded, at EXACTLY `minDistance`.
 *
 * The old version widened the radius to `sqrt(area * 0.66 / maxCount)` whenever that beat the
 * authored spacing, which on a 70,000-132,000 m2 region it always did. That is what made every
 * authored spacing inert and every layer an even sprinkle. Density is now controlled by capping
 * clusters, not by pushing points apart.
 *
 * `hardCap` only exists so a mis-authored spacing cannot hang the boot; it is not a density dial.
 */
function poissonDisc(rect: Rect, minDistance: number, rng: Rng, hardCap = 60000): [number, number][] {
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  if (width <= 0 || depth <= 0 || minDistance <= 0) return [];

  const radius = minDistance;
  const cell = radius / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(depth / cell));
  if (cols * rows > 4_000_000) return [];
  const grid = new Int32Array(cols * rows).fill(-1);

  const points: [number, number][] = [];
  const active: number[] = [];

  const insert = (x: number, z: number): void => {
    const index = points.length;
    points.push([x, z]);
    const col = Math.min(cols - 1, Math.max(0, Math.floor((x - rect.minX) / cell)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((z - rect.minZ) / cell)));
    grid[row * cols + col] = index;
    active.push(index);
  };

  const fits = (x: number, z: number): boolean => {
    if (x < rect.minX || x > rect.maxX || z < rect.minZ || z > rect.maxZ) return false;
    const col = Math.floor((x - rect.minX) / cell);
    const row = Math.floor((z - rect.minZ) / cell);
    for (let r = Math.max(0, row - 2); r <= Math.min(rows - 1, row + 2); r += 1) {
      for (let c = Math.max(0, col - 2); c <= Math.min(cols - 1, col + 2); c += 1) {
        const index = grid[r * cols + c]!;
        if (index < 0) continue;
        const other = points[index]!;
        const dx = other[0] - x;
        const dz = other[1] - z;
        if (dx * dx + dz * dz < radius * radius) return false;
      }
    }
    return true;
  };

  insert(rect.minX + rng.next() * width, rect.minZ + rng.next() * depth);

  const attempts = 18;
  while (active.length > 0 && points.length < hardCap) {
    const pick = Math.floor(rng.next() * active.length);
    const seedIndex = active[pick]!;
    const seed = points[seedIndex]!;
    let placed = false;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const angle = rng.next() * Math.PI * 2;
      const distance = radius * (1 + rng.next());
      const x = seed[0] + Math.cos(angle) * distance;
      const z = seed[1] + Math.sin(angle) * distance;
      if (!fits(x, z)) continue;
      insert(x, z);
      placed = true;
      break;
    }

    if (!placed) {
      active[pick] = active[active.length - 1]!;
      active.pop();
    }
  }
  return points;
}

/** Members of one cluster: Poisson over the bounding square, kept inside the disc. */
function poissonDisc2(centreX: number, centreZ: number, radius: number, minDistance: number, rng: Rng): [number, number][] {
  const rect: Rect = {
    minX: centreX - radius, maxX: centreX + radius,
    minZ: centreZ - radius, maxZ: centreZ + radius,
  };
  const points = poissonDisc(rect, minDistance, rng, 4000);
  return points.filter(([x, z]) => Math.hypot(x - centreX, z - centreZ) <= radius);
}

/** Integer hash. Used to reorder Poisson output so truncating it stays spatially uniform. */
function hash32(seed: number, value: number): number {
  let h = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Deterministic reorder.
 *
 * Bridson grows outward from its seed point, so taking the first N of its output leaves a blob
 * where the algorithm started and bare ground everywhere else. Sorting on a positional-independent
 * hash first makes any prefix a uniform sample of the whole rect.
 */
function shuffleByHash<T>(items: readonly T[], seed: number): T[] {
  return items
    .map((item, index) => ({ item, key: hash32(seed, index) }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}

/**
 * Three-octave fbm in 0..1.
 *
 * The old mask was single-octave value noise at a 85-130 m feature size over a 330-400 m region:
 * three or four lattice periods across the whole world, i.e. three giant smooth gradients with no
 * grove-scale structure at all. Three octaves at a 60-90 m base gives the clearings an edge.
 */
function createFbm(seed: number): (x: number, z: number) => number {
  const octave1 = createValueNoise(seed);
  const octave2 = createValueNoise((seed ^ 0x85ebca6b) >>> 0);
  const octave3 = createValueNoise((seed ^ 0xc2b2ae35) >>> 0);
  return (x: number, z: number): number => {
    const value = octave1(x, z) * 0.55 + octave2(x * 2.03, z * 2.03) * 0.3 + octave3(x * 4.11, z * 4.11) * 0.15;
    return clamp01(value * 0.5 + 0.5);
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

// --------------------------------------------------------- world features

/**
 * A fishing pond as scatter needs to see it: where the water actually meets the land.
 *
 * The root registers fishing clusters as `cluster.radius + 3` exclusions but builds the water disc
 * at `cluster.radius + 14`, so an 11 m annulus of grass and pebbles was drawn UNDER every pond.
 * Rather than guess a margin, the shoreline is solved with `WorldScene.buildWater`'s own solver —
 * march outward at 1 m for the FIRST radius where the drawn ground rises through the water plane,
 * then bisect inside that metre — so scatter's waterline and the drawn disc's are the same number.
 * Reeds then land on the real waterline even where the bank is asymmetric, and this is the only
 * thing keeping cover out of the pond now that `COVER_EXCLUSION` reaches inside cluster rings.
 */
interface WaterBody {
  x: number;
  z: number;
  level: number;
  maxRadius: number;
  /** Shoreline radius per azimuth, index 0 at +x, increasing counter-clockwise. */
  shoreline: number[];
}

/**
 * Azimuths the shoreline is solved at. 32, matching `WorldScene.buildWater`'s `WATER_SEGMENTS`, so
 * scatter's idea of the waterline and the drawn disc's are sampled at the same angles.
 */
const SHORE_AZIMUTHS = 32;

/** Outward march step, in metres. 1 m is half the terrain lattice's 2 m quad — see below. */
const SHORE_MARCH_METRES = 1;

/** `WorldScene.buildWater`'s `WATER_MIN_RADIUS`: the smallest disc it will draw. */
const SHORE_MIN_RADIUS = 2.5;

/**
 * Water surface height above the carved basin floor, in metres.
 *
 * `app/worldSpec.ts` carves the basin `WATER_BASIN_DEPTH` = 0.9 m deep and `app/boot.ts` fills it
 * to `floor + WATER_BASIN_DEPTH * 0.55`. Duplicated rather than imported because world/ must not
 * depend upward on app/; if the root retunes the fill, the reed band drifts by the difference and
 * nothing else breaks.
 */
const WATER_FILL_METRES = 0.9 * 0.55;

function measureWaterBodies(scene: WorldScene, regionId: RegionId): WaterBody[] {
  const region = REGIONS.find((entry) => entry.id === regionId);
  if (!region) return [];
  const bodies: WaterBody[] = [];
  for (const cluster of region.clusters) {
    if (cluster.archetype !== "fishing_spot") continue;
    const [x, z] = cluster.centre;
    const maxRadius = cluster.radius + 14;
    const level = scene.heightAt(regionId, x, z) + WATER_FILL_METRES;
    const shoreline: number[] = [];
    for (let i = 0; i < SHORE_AZIMUTHS; i += 1) {
      const angle = (i / SHORE_AZIMUTHS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      // FIRST crossing, found by marching then bisecting inside the metre it crossed in. This is
      // `WorldScene.buildWater`'s solver, character for character, and it is not a plain bisection
      // for the reason that file measured: the bank is not monotonic. 11% of the Redsill and Cairn
      // Tarn disc footprints stand ABOVE the surface, because a spur crosses the plane at r = 21
      // and drops back under it by r = 23. This function used to bisect with an early-out at
      // `maxRadius`, so it could answer a radius the drawn disc never reaches — which is either
      // grass floating on water or a bare annulus around the pond, depending on which way it erred.
      let low = 0;
      let high = maxRadius;
      for (let radius = SHORE_MARCH_METRES; radius <= maxRadius; radius += SHORE_MARCH_METRES) {
        if (scene.meshHeightAt(x + dx * radius, z + dz * radius) >= level) { high = radius; break; }
        low = radius;
      }
      for (let step = 0; step < 12; step += 1) {
        const mid = (low + high) / 2;
        if (scene.meshHeightAt(x + dx * mid, z + dz * mid) < level) low = mid;
        else high = mid;
      }
      shoreline.push(Math.max(SHORE_MIN_RADIUS, low));
    }
    bodies.push({ x, z, level, maxRadius, shoreline });
  }
  return bodies;
}

/** Shoreline radius toward a point, linearly interpolated between azimuth samples. */
function shorelineToward(body: WaterBody, x: number, z: number): number {
  const angle = Math.atan2(z - body.z, x - body.x);
  const turns = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
  const position = turns * SHORE_AZIMUTHS;
  const low = Math.floor(position) % SHORE_AZIMUTHS;
  const high = (low + 1) % SHORE_AZIMUTHS;
  const t = position - Math.floor(position);
  return body.shoreline[low]! + (body.shoreline[high]! - body.shoreline[low]!) * t;
}

/** Metres beyond the measured waterline that ordinary layers must stay. */
const WATER_MARGIN_METRES = 1.2;

/**
 * A settlement's own geometry, as one zone per authored thing rather than one disc round the lot.
 *
 * The root registers every settlement as a single 46 m circle. A boolean test on that circle is
 * what produced the bare disc in every settlement screenshot, and an enclosing circle measured off
 * the content is barely better: Coldbrace's wall runs reach ~40 m from its centre, so one disc that
 * clears them clears the entire approach as well. Registering the buildings, the wall runs, the
 * paving and the props separately lets grass grow in the yards, along the foot of the wall and
 * right up to the gate, and still keeps it out of a cottage.
 *
 * Everything here is read from `content/regions.ts`, so a settlement that gains a wall or a paved
 * square in a later pass pushes the planting back on its own.
 */
function authoredZones(regionId: RegionId): ExclusionZones {
  const zones = new ExclusionZones();
  const settlement = REGIONS.find((entry) => entry.id === regionId)?.settlement;
  if (!settlement) return zones;

  for (const building of settlement.buildings) {
    // Use the authored collision footprint in its own rotated frame. The old circumscribed circle
    // was radius hypot(width, depth)/2 + 1 m, which kept cover hard-clear 3.4 m past the narrow
    // side of a 6 x 4 m cottage and left the lanes between neighbouring houses bald. Cover wants
    // the wall edge, not the roof's circumscribed/eave envelope.
    const [width, depth] = building.footprint;
    zones.addOrientedRect(
      building.position[0], building.position[1],
      width, depth, building.rotationY, 0, "building", building.id,
    );
  }
  for (const wall of settlement.walls ?? []) {
    const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    const steps = Math.max(1, Math.ceil(length / 2.5));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      zones.addCircle(
        wall.from[0] + (wall.to[0] - wall.from[0]) * t,
        wall.from[1] + (wall.to[1] - wall.from[1]) * t,
        1.8, "settlement", wall.id,
      );
    }
  }
  for (const paving of settlement.paving ?? []) {
    zones.addRect(paving.rect, 0.5, "settlement", paving.id);
  }
  for (const station of settlement.stations) zones.addCircle(station.position[0], station.position[1], 1.8, "custom", station.id);
  for (const shop of settlement.shops) zones.addCircle(shop.position[0], shop.position[1], 2.2, "custom", shop.id);
  zones.addCircle(settlement.bank.position[0], settlement.bank.position[1], 2.2, "custom", settlement.bank.id);
  for (const prop of settlement.props ?? []) zones.addCircle(prop.position[0], prop.position[1], 1.4, "custom", prop.id);
  for (const npc of settlement.npcs) zones.addCircle(npc.position[0], npc.position[1], 1.2, "custom", npc.id);
  return zones;
}

/** Region terrain envelope, for the altitude rules. */
function regionAltitude(regionId: RegionId): { base: number; amplitude: number } {
  const region = REGIONS.find((entry) => entry.id === regionId);
  return { base: region?.baseHeight ?? 0, amplitude: Math.max(1, region?.terrainAmplitude ?? 1) };
}

/**
 * Road centrelines resampled to 1 m, clipped to this region.
 *
 * These are `scene.getRoadPolylines()` — the CURVED lines after the meander — not the authored
 * endpoints. The root's road exclusion corridor is built from the straight endpoints, and
 * `curveRoadPolyline` bows a road up to `ROAD_MAX_SWAY` = 7 m off that line, so the corridor and
 * the drawn road disagree by more than the corridor's own 4 m radius on a long link. Anything that
 * dresses a road has to follow the drawn one.
 */
function roadStations(scene: WorldScene, regionId: RegionId): { x: number; z: number; nx: number; nz: number }[] {
  const stations: { x: number; z: number; nx: number; nz: number }[] = [];
  for (const line of scene.getRoadPolylines()) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dz);
      if (length < 1e-3) continue;
      const nx = -dz / length;
      const nz = dx / length;
      const steps = Math.max(1, Math.round(length));
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        const x = a[0] + dx * t;
        const z = a[2] + dz * t;
        if (scene.regionAt(x, z) !== regionId) continue;
        stations.push({ x, z, nx, nz });
      }
    }
  }
  return stations;
}

// -------------------------------------------------------------- placement

interface Candidate { x: number; z: number; source: ScatterSource; assetId: string }

interface LayerContext {
  scene: WorldScene;
  regionId: RegionId;
  rect: Rect;
  exclusions: ExclusionZones;
  waters: WaterBody[];
  authored: ExclusionZones;
  altitude: { base: number; amplitude: number };
  roads: { x: number; z: number; nx: number; nz: number }[];
}

interface ResolvedSpecies {
  assetId: string;
  weight: number;
  scale: [number, number];
  tilt: number;
  sink: number;
  sources: ScatterSource[] | null;
}

/**
 * Resolves the species pool a layer will actually use.
 *
 * Unknown explicit ids are reported rather than silently dropped. Every id in `DEFAULT_SCATTER` is
 * hand-picked off the measured triangle and native-height tables, so a typo that quietly degrades a
 * layer to two variants is exactly the failure that is hardest to see in a screenshot.
 */
function resolveSpecies(
  assets: AssetRegistry,
  layer: ScatterLayerSpec,
): { species: ResolvedSpecies[]; unknown: string[] } {
  const declared: ScatterSpeciesSpec[] = layer.species
    ? layer.species
    : layer.assetIds
      ? layer.assetIds.map((assetId) => ({ assetId }))
      : (layer.tags && layer.tags.length > 0
        ? assets.byTags(...layer.tags).slice(0, layer.maxVariants ?? 4).map((entry) => ({ assetId: entry.id }))
        : []);

  const species: ResolvedSpecies[] = [];
  const unknown: string[] = [];
  for (const entry of declared) {
    if (assets.entry(entry.assetId) === undefined) { unknown.push(entry.assetId); continue; }
    species.push({
      assetId: entry.assetId,
      weight: entry.weight ?? 1,
      scale: entry.scale ?? layer.scale,
      tilt: entry.tilt ?? layer.tilt ?? 0.4,
      sink: entry.sink ?? layer.sink ?? 0,
      sources: entry.sources ?? null,
    });
  }
  return { species, unknown };
}

function pickSpecies(pool: ResolvedSpecies[], source: ScatterSource, rng: Rng): ResolvedSpecies | null {
  let total = 0;
  for (const entry of pool) {
    if (entry.sources && !entry.sources.includes(source)) continue;
    total += entry.weight;
  }
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (const entry of pool) {
    if (entry.sources && !entry.sources.includes(source)) continue;
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return null;
}

/** Stable per-region, per-layer seed. Order-independent so editing one layer never moves another. */
function layerSeed(seed: number, regionId: RegionId, layerId: string): number {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (const text of [regionId, layerId]) {
    for (let i = 0; i < text.length; i += 1) {
      hash = (Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0);
    }
  }
  return hash >>> 0;
}

/**
 * How far outside the region rect candidates are generated, in metres.
 *
 * The seam fade at the bottom of `siteFactor` was dead code before this: candidates only ever
 * existed inside the rect, where `regionWeightAt` returns >= 0.5 by construction, so the guard it
 * was written as (`weight < 0.5`) could never fire and every region border was a hard species swap.
 * Just under `worldSpec.ts`'s `blendMetres` of 28, so candidates land in the band where the weight
 * genuinely falls to 0 and the fade becomes live.
 */
const SEAM_BLEED_METRES = 26;

/**
 * Acceptance multipliers that depend only on where a point is.
 *
 * Returns 0 for a hard reject. Everything expensive lives here, so it is called on cluster CENTRES
 * and then only the cheap half is repeated per member.
 */
function siteFactor(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  x: number,
  z: number,
  source: ScatterSource,
  full: boolean,
): number {
  const profile = layerProfile(layer, source);
  let factor = ctx.exclusions.densityAt(x, z, profile);
  if (factor <= 0) return 0;

  const authoredBase = profile.authored ?? profile.base;
  factor *= ctx.authored.densityAt(x, z, {
    base: authoredBase,
    byKind: profile.authoredBuilding
      ? { building: profile.authoredBuilding }
      : undefined,
  });
  if (factor <= 0) return 0;

  // Water is a hard reject except for a shore layer that deliberately wades in. Round 1 excluded
  // fishing clusters at `radius + 3` while the water disc was built at `radius + 14`, so an 11 m
  // annulus of grass and pebbles was drawn under every pond.
  const waterMargin = source === "shore"
    ? Math.min(layer.shore?.band[0] ?? 0, WATER_MARGIN_METRES)
    : WATER_MARGIN_METRES;
  for (const body of ctx.waters) {
    const distance = Math.hypot(x - body.x, z - body.z);
    if (distance > body.maxRadius + 40) continue;
    if (distance < shorelineToward(body, x, z) + waterMargin) return 0;
  }

  const seam = ctx.scene.regionWeightAt(ctx.regionId, x, z);
  factor *= seam;
  if (factor <= 0) return 0;

  const rules = layer.terrain;
  const slope = ctx.scene.slopeAt(x, z);
  if (slope > (rules?.slopeMax ?? 0.85)) return 0;
  // Everything below is a PREFERENCE rather than a rule, and preferences belong to the cluster as a
  // whole. Applying them again per member would square them: a scree cluster biased x0.15 on flat
  // ground would then lose 85% of the members it did place there, and the cluster would dissolve
  // instead of moving.
  if (!full) return factor;
  if (rules?.slopeBias) {
    const { low, high, flat, steep } = rules.slopeBias;
    const t = high > low ? clamp01((slope - low) / (high - low)) : slope > low ? 1 : 0;
    factor *= flat + (steep - flat) * t;
  }

  const height = ctx.scene.meshHeightAt(x, z);
  if (layer.heightRange && (height < layer.heightRange[0] || height > layer.heightRange[1])) return 0;
  if (rules?.altitude) {
    const fade = rules.altitudeFade ?? 4;
    const lower = ctx.altitude.base + rules.altitude[0] * ctx.altitude.amplitude;
    const upper = ctx.altitude.base + rules.altitude[1] * ctx.altitude.amplitude;
    factor *= smoothstep01((height - lower) / fade) * smoothstep01((upper - height) / fade);
  }

  if (rules?.moisture) {
    let nearest = Infinity;
    for (const body of ctx.waters) {
      const distance = Math.hypot(x - body.x, z - body.z) - shorelineToward(body, x, z);
      nearest = Math.min(nearest, distance);
    }
    if (nearest < rules.moisture.reach) {
      factor *= 1 + (rules.moisture.boost - 1) * clamp01(1 - nearest / rules.moisture.reach);
    }
  }

  return factor;
}

/** The layer's exclusion profile, widened by `clearance` and opened up along its own source. */
function layerProfile(layer: ScatterLayerSpec, source: ScatterSource): ExclusionProfile {
  const base = layer.exclusion ?? SHRUB_EXCLUSION;
  const clearance = layer.clearance ?? 0;
  const widen = (band: ExclusionBand): ExclusionBand => ({ hard: band.hard + clearance, fade: band.fade });
  const byKind: Partial<Record<ExclusionKind, ExclusionBand>> = {};
  for (const [kind, band] of Object.entries(base.byKind ?? {})) {
    if (band) byKind[kind as ExclusionKind] = widen(band);
  }
  // A road layer answers to the CURVED centreline it was generated from, so the root's
  // straight-endpoint corridor must not veto it.
  if (source === "road") byKind.road = { hard: -1000, fade: 0 };
  // `authored` has to be carried through. Dropping it here made every `authored` band in every
  // profile dead code — `siteFactor` reads `profile.authored ?? profile.base` and always got the
  // base — so a wall or a paving kerb was answered with the open-country fade instead of the
  // tighter one written for it.
  return {
    base: widen(base.base),
    byKind,
    authored: base.authored ? widen(base.authored) : undefined,
    authoredBuilding: base.authoredBuilding ? widen(base.authoredBuilding) : undefined,
  };
}

/**
 * Places one region's dressing and returns what it cost.
 *
 * Everything is awaited up front (the GLBs a layer needs), then placement is synchronous and pure,
 * which is what makes the layout reproducible: no interleaved network timing can reorder the RNG.
 */
export async function scatterRegion(
  scene: WorldScene,
  assets: AssetRegistry,
  regionId: RegionId,
  spec: RegionScatterSpec,
  seed: number,
): Promise<ScatterResult> {
  const rect = spec.rect ?? scene.getRegionRect(regionId);
  const exclusions = spec.exclusions ?? worldExclusions;
  const result: ScatterResult = {
    regionId,
    placed: 0,
    rejected: 0,
    clusters: 0,
    instancedMeshes: 0,
    estimatedDrawCalls: 0,
    estimatedTriangles: 0,
    tiles: 0,
    byLayer: {},
    bySource: {},
    missingAssets: [],
  };
  if (!rect) return result;

  const ctx: LayerContext = {
    scene,
    regionId,
    rect,
    exclusions,
    waters: measureWaterBodies(scene, regionId),
    authored: authoredZones(regionId),
    altitude: regionAltitude(regionId),
    roads: roadStations(scene, regionId),
  };

  // Region-wide rather than per-layer: `scatterInstanced` builds one InstancedMesh per (asset,
  // primitive), so two layers naming the same asset used to pay for it twice. Vellenwood's fern,
  // broad-leaf mat and small leafy plant each appeared in two layers, which was 5 draw calls of
  // pure duplication world-wide. It is also what makes the continuous `carpet` layers free: they
  // name the same assets as `groundcover`, so they add instances to an existing mesh rather than a
  // new one.
  const buckets = new Map<string, InstanceBucket>();

  for (const layer of spec.layers) {
    const { species, unknown } = resolveSpecies(assets, layer);
    for (const id of unknown) result.missingAssets.push(`${layer.id}:${id}`);
    if (species.length === 0) {
      result.missingAssets.push(layer.id);
      continue;
    }

    try {
      // Grass uses a generated cutout and measured manifest dimensions. Its opaque source GLBs
      // are no longer render inputs, so loading them would spend boot time and memory for nothing.
      await assets.loadMany(species.filter((entry) => !isGrassSprite(entry.assetId)).map((entry) => entry.assetId));
    } catch {
      result.missingAssets.push(layer.id);
      continue;
    }

    const rng = new Rng(layerSeed(seed, regionId, layer.id));
    const mask = createFbm(layerSeed(seed, regionId, `${layer.id}-mask`));
    const candidates: Candidate[] = [];

    collectField(layer, ctx, species, rng, mask, candidates, result);
    collectRoad(layer, ctx, species, rng, candidates, result);
    collectShore(layer, ctx, species, rng, candidates, result);

    const castShadow = layer.castShadow ?? false;
    const byAsset = new Map(species.map((entry) => [entry.assetId, entry]));
    for (const candidate of candidates) {
      const entry = byAsset.get(candidate.assetId);
      if (!entry) continue;
      if (isGrassSprite(candidate.assetId)) {
        const key = "grass-sprite|-";
        const found = buckets.get(key);
        const bucket: GrassInstanceBucket = found?.kind === "grass"
          ? found
          : { kind: "grass", assetId: "grass-sprite", castShadow: false, placements: [] };
        bucket.placements.push(composeGrassPlacement(layer, ctx, entry, candidate, assets, rng));
        buckets.set(key, bucket);
        result.placed += 1;
        result.byLayer[layer.id] = (result.byLayer[layer.id] ?? 0) + 1;
        result.bySource[candidate.source] = (result.bySource[candidate.source] ?? 0) + 1;
        continue;
      }
      // Keyed on shadow as well as asset, because the shadow flag is a property of the
      // InstancedMesh: fern undergrowth and fern on a damp bank share one mesh, a shadow-casting
      // pine and a non-casting one could not.
      const key = `${candidate.assetId}|${castShadow ? "s" : "-"}`;
      const found = buckets.get(key);
      const bucket: MeshInstanceBucket = found?.kind === "mesh"
        ? found
        : { kind: "mesh", assetId: candidate.assetId, castShadow, placements: [] };
      bucket.placements.push(composePlacement(layer, ctx, entry, candidate, rng));
      buckets.set(key, bucket);
      result.placed += 1;
      result.byLayer[layer.id] = (result.byLayer[layer.id] ?? 0) + 1;
      result.bySource[candidate.source] = (result.bySource[candidate.source] ?? 0) + 1;
    }
  }

  for (const bucket of buckets.values()) {
    if (bucket.kind === "grass") {
      for (const shard of shardByTile(bucket)) {
        result.tiles += 1;
        const meshes = scene.scatterGrassSprites(
          shard.placements,
          `scatter-${regionId}-grass-sprite-t${shard.tile >>> 0}`,
          { regionId },
        );
        result.instancedMeshes += meshes.length;
        result.estimatedDrawCalls += meshes.length;
        for (const mesh of meshes) {
          const indices = mesh.geometry.getIndex();
          const positions = mesh.geometry.getAttribute("position");
          const triangles = Math.round((indices?.count ?? positions?.count ?? 0) / 3);
          result.estimatedTriangles += triangles * mesh.count;
        }
      }
      continue;
    }
    for (const shard of shardByTile(bucket)) {
      result.tiles += 1;
      const meshes = scene.scatterInstanced(
        assets.instance(bucket.assetId),
        shard.placements,
        `scatter-${regionId}-${bucket.assetId}-t${shard.tile >>> 0}`,
        { regionId, castShadow: bucket.castShadow },
      );
      result.instancedMeshes += meshes.length;
      result.estimatedDrawCalls += meshes.length * (bucket.castShadow ? 2 : 1);
      for (const mesh of meshes) {
        const indices = mesh.geometry.getIndex();
        const positions = mesh.geometry.getAttribute("position");
        const triangles = Math.round((indices?.count ?? positions?.count ?? 0) / 3);
        result.estimatedTriangles += triangles * mesh.count * (bucket.castShadow ? 2 : 1);
      }
    }
  }

  return result;
}

/** Region-wide placement: two-level clusters, or lone props when no `cluster` is authored. */
function collectField(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  species: ResolvedSpecies[],
  rng: Rng,
  mask: (x: number, z: number) => number,
  out: Candidate[],
  result: ScatterResult,
): void {
  const bounds = ctx.scene.getWorldBounds();
  const bleed = layer.bleed ?? SEAM_BLEED_METRES;
  const sampleRect: Rect = {
    minX: Math.max(bounds.minX, ctx.rect.minX - bleed),
    maxX: Math.min(bounds.maxX, ctx.rect.maxX + bleed),
    minZ: Math.max(bounds.minZ, ctx.rect.minZ - bleed),
    maxZ: Math.min(bounds.maxZ, ctx.rect.maxZ + bleed),
  };

  const maskAt = (x: number, z: number): number => {
    if (!layer.mask || layer.mask.strength <= 0) return 1;
    const value = mask(x / layer.mask.featureSize, z / layer.mask.featureSize);
    // Threshold rises with strength, so a strong mask carves real clearings rather than thinning
    // uniformly. strength 1 rejects roughly half the world; strength 0 rejects nothing.
    return smoothstep01((value - (0.5 - (1 - layer.mask.strength) * 0.5)) / 0.18);
  };

  const cluster = layer.cluster;
  if (!cluster) {
    // Ordinary layers keep the historical 120k guard. Grass-only carpets may sample farther:
    // exclusions reject roughly a quarter of their candidates around roads, water and authored
    // structures, so a 120k candidate ceiling could never deliver Fallowmarch's 145k safe card
    // budget. The grass ceiling remains explicit and bounded; no 3D layer can inherit it.
    const grassOnly = species.every((entry) => isGrassSprite(entry.assetId));
    const candidateCeiling = grassOnly ? 220000 : 120000;
    const candidateCap = Math.min(candidateCeiling, Math.max(60000, Math.ceil(layer.maxCount * 1.4)));
    const points = shuffleByHash(poissonDisc(sampleRect, layer.spacing ?? 6, rng, candidateCap), 0x5eed01);
    for (const [x, z] of points) {
      if (out.length >= layer.maxCount) break;
      const factor = siteFactor(layer, ctx, x, z, "field", true) * maskAt(x, z);
      if (factor <= 0 || rng.next() > factor) { result.rejected += 1; continue; }
      const entry = pickSpecies(species, "field", rng);
      if (!entry) break;
      out.push({ x, z, source: "field", assetId: entry.assetId });
    }
    return;
  }

  const falloff = cluster.falloff ?? 0.75;
  const dominance = cluster.dominance ?? 0.7;
  const centres = shuffleByHash(poissonDisc(sampleRect, cluster.spacing, rng), 0x5eed02);
  for (const [cx, cz] of centres) {
    if (out.length >= layer.maxCount) break;
    const factor = siteFactor(layer, ctx, cx, cz, "field", true) * maskAt(cx, cz) * cluster.accept;
    if (factor <= 0 || rng.next() > factor) { result.rejected += 1; continue; }

    // A cluster straddling a region seam is squeezed into a hedgerow rather than allowed to sprawl
    // into the neighbour, which is what turns the border from a paint-bucket edge into a treeline.
    const seam = ctx.scene.regionWeightAt(ctx.regionId, cx, cz);
    const onSeam = seam < 0.72;
    const radius = onSeam
      ? Math.min(9, cluster.radius[0])
      : cluster.radius[0] + rng.next() * (cluster.radius[1] - cluster.radius[0]);
    const memberSpacing = onSeam ? cluster.memberSpacing * 0.75 : cluster.memberSpacing;

    const dominant = pickSpecies(species, "field", rng);
    if (!dominant) break;
    result.clusters += 1;

    for (const [x, z] of poissonDisc2(cx, cz, radius, memberSpacing, rng)) {
      const reach = radius > 0 ? Math.hypot(x - cx, z - cz) / radius : 0;
      if (rng.next() > 1 - falloff * reach * reach) { result.rejected += 1; continue; }
      const site = siteFactor(layer, ctx, x, z, "field", false);
      if (site <= 0 || rng.next() > site) { result.rejected += 1; continue; }
      const entry = rng.next() < dominance ? dominant : pickSpecies(species, "field", rng);
      if (!entry) continue;
      out.push({ x, z, source: "field", assetId: entry.assetId });
    }
  }
}

/** Verge and surface dressing along the drawn road centrelines. */
function collectRoad(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  species: ResolvedSpecies[],
  rng: Rng,
  out: Candidate[],
  result: ScatterResult,
): void {
  const spec = layer.road;
  if (!spec || ctx.roads.length === 0) return;
  const [near, far] = spec.band;
  let credit = 0;
  for (const station of ctx.roads) {
    credit += spec.perMetre;
    while (credit >= 1) {
      credit -= 1;
      const side = rng.next() < 0.5 ? -1 : 1;
      const offset = (near + rng.next() * (far - near)) * side;
      const jitterX = rng.float(-0.4, 0.4);
      const jitterZ = rng.float(-0.4, 0.4);
      const x = station.x + station.nx * offset + jitterX;
      const z = station.z + station.nz * offset + jitterZ;
      const site = siteFactor(layer, ctx, x, z, "road", true);
      if (site <= 0 || rng.next() > site) { result.rejected += 1; continue; }
      const entry = pickSpecies(species, "road", rng);
      if (!entry) return;
      out.push({ x, z, source: "road", assetId: entry.assetId });
    }
  }
}

/** Reeds and moisture-loving cover on the measured waterline. */
function collectShore(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  species: ResolvedSpecies[],
  rng: Rng,
  out: Candidate[],
  result: ScatterResult,
): void {
  const spec = layer.shore;
  if (!spec) return;
  for (const body of ctx.waters) {
    let perimeter = 0;
    for (const radius of body.shoreline) perimeter += (radius * Math.PI * 2) / SHORE_AZIMUTHS;
    const wanted = Math.round(perimeter * spec.perMetre);
    for (let i = 0; i < wanted; i += 1) {
      const angle = rng.next() * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const shore = shorelineToward(body, body.x + dx, body.z + dz);
      if (shore <= 0) continue;
      const radius = shore + spec.band[0] + rng.next() * (spec.band[1] - spec.band[0]);
      const x = body.x + dx * radius;
      const z = body.z + dz * radius;
      const site = siteFactor(layer, ctx, x, z, "shore", true);
      if (site <= 0 || rng.next() > site) { result.rejected += 1; continue; }
      const entry = pickSpecies(species, "shore", rng);
      if (!entry) return;
      out.push({ x, z, source: "shore", assetId: entry.assetId });
    }
  }
}

/**
 * One instance transform.
 *
 * Three things the old composer did not do, all of them free because they ride the same matrix:
 * lean into the ground normal, vary width against height, and mirror half the instances. The
 * mirror is safe here because every material in the nature+rock kit is authored `doubleSided`.
 */
function composePlacement(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  entry: ResolvedSpecies,
  candidate: Candidate,
  rng: Rng,
): ScatterPlacement {
  const height = ctx.scene.meshHeightAt(candidate.x, candidate.z);
  const bias = layer.sizeBias ?? 2.2;
  const size = entry.scale[0] + (entry.scale[1] - entry.scale[0]) * Math.pow(rng.next(), bias);
  const width = 1 + rng.float(-0.12, 0.12);
  const stretch = 1 + rng.float(-0.15, 0.25);
  const mirror = (layer.mirror ?? false) && rng.next() < 0.5 ? -1 : 1;
  return {
    position: [candidate.x, height - entry.sink, candidate.z],
    rotationY: rng.next() * Math.PI * 2,
    scale: [size * width * mirror, size * stretch, size * width],
    normal: entry.tilt > 0 ? ctx.scene.normalAt(candidate.x, candidate.z) : undefined,
    tilt: entry.tilt,
  };
}

/**
 * Turns the same deterministic transform a GLB tuft would have received into a four-triangle card.
 * Source dimensions come from the manifest, so changing render geometry does not change authored
 * world height or the relative short/tall and common/wispy hierarchy.
 */
function composeGrassPlacement(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  entry: ResolvedSpecies,
  candidate: Candidate,
  assets: AssetRegistry,
  rng: Rng,
): GrassSpritePlacement {
  const placement = composePlacement(layer, ctx, entry, candidate, rng);
  const scale = typeof placement.scale === "number"
    ? [placement.scale, placement.scale, placement.scale] as const
    : placement.scale;
  const native = assets.assetSize(candidate.assetId) ?? { x: 0.8, y: 1.2, z: 0.8 };
  // The generated cutout contains eleven blades, so its physical width needs to read as one tuft,
  // not one stem. At the old 0.14 m floor almost every blade-carpet card collapsed to a pencil at
  // gameplay distance. A 0.18 m floor and 90% of the source footprint increase occupied width by
  // 1.22-1.29x without adding geometry, instances or draw calls.
  const width = clampRange(Math.max(native.x * Math.abs(scale[0]), native.z * Math.abs(scale[2])) * 0.9, 0.18, 2.1);
  const height = clampRange(native.y * Math.abs(scale[1]), 0.14, 2.3);
  return {
    position: placement.position,
    rotationY: placement.rotationY,
    width,
    height,
    colour: grassColour(candidate.assetId, candidate.x, candidate.z),
    normal: placement.normal,
    tilt: placement.tilt,
  };
}

/** A positional colour shift. No extra RNG draw, so neighbouring non-grass transforms stay put. */
function grassColour(assetId: string, x: number, z: number): number {
  let seed = 0x811c9dc5;
  for (let index = 0; index < assetId.length; index += 1) {
    seed = Math.imul(seed ^ assetId.charCodeAt(index), 0x01000193) >>> 0;
  }
  const position = (Math.imul(Math.round(x * 32), 0x1f123bb5)
    ^ Math.imul(Math.round(z * 32), 0x5f356495)) >>> 0;
  const unit = hash32(seed, position) / 0xffffffff;
  const gain = 0.86 + unit * 0.22;
  return scaleHex(assetId.startsWith("grass_wispy") ? 0xb69f00 : 0x79ab20, gain);
}

function scaleHex(colour: number, gain: number): number {
  const red = Math.min(255, Math.round(((colour >>> 16) & 0xff) * gain));
  const green = Math.min(255, Math.round(((colour >>> 8) & 0xff) * gain));
  const blue = Math.min(255, Math.round((colour & 0xff) * gain));
  return (red << 16) | (green << 8) | blue;
}

function clampRange(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Dresses every region the scene knows about. */
export async function scatterWorld(
  scene: WorldScene,
  assets: AssetRegistry,
  seed: number,
  specs: Partial<Record<RegionId, RegionScatterSpec>> = DEFAULT_SCATTER,
): Promise<ScatterResult[]> {
  const results: ScatterResult[] = [];
  for (const layout of scene.describeRegions()) {
    const spec = specs[layout.regionId];
    if (!spec) continue;
    results.push(await scatterRegion(scene, assets, layout.regionId, spec, seed));
  }
  return results;
}

// --------------------------------------------------- exclusion profiles

/**
 * Canopy. Nothing grows through a roof, so the hard clearance is generous, but the fade is 30 m so
 * a wood approaches a settlement rather than stopping on its property line.
 */
const TREE_EXCLUSION: ExclusionProfile = {
  base: { hard: 6, fade: 14 },
  byKind: {
    settlement: { hard: 9, fade: 30 },
    road: { hard: 5, fade: 12 },
    cluster: { hard: 5, fade: 10 },
    spawn: { hard: 9, fade: 20 },
  },
  authored: { hard: 6, fade: 12 },
};

/**
 * Waist-high volume. Close enough to a road to frame it, far enough not to hide a path.
 *
 * The `cluster` band reaches 6 m inside a resource cluster rather than stopping 2 m outside it, so
 * a copse or an ore field gets a ring of bracken in its outer few metres and stays clear in the
 * middle where the interactable nodes are. Nodes stay readable; the cluster stops looking like a
 * disc of mown lawn with props on it.
 */
const SHRUB_EXCLUSION: ExclusionProfile = {
  base: { hard: 2.5, fade: 9 },
  byKind: {
    settlement: { hard: -12, fade: 26 },
    road: { hard: 3, fade: 6 },
    cluster: { hard: -6, fade: 8 },
    spawn: { hard: 4, fade: 12 },
  },
  authored: { hard: 2.5, fade: 6 },
};

/**
 * Ground cover. Reaches straight through the root's placeholder rings, because a boolean test on
 * them is what produced every bare disc in the world. What actually keeps grass off a doorstep is
 * `authoredZones`, one small zone per building, wall segment, paving rect and prop.
 *
 * Both negative bands were measured against a screenshot rather than chosen. `cluster` was
 * `hard: -0.5`, which reads as "0.5 m inside the edge" and therefore leaves the whole INTERIOR of
 * the circle at zero: `app/boot.ts` registers every resource cluster at `radius + 3`, so Palewood
 * Copse (radius 15) held an 18 m bare disc and its route node another 9 m one. That is the entire
 * content of runs/corealm/screenshots/w2-palewood_copse.png — five trees on empty grass, with the
 * camera 18 m out and therefore looking at nothing but the hole. `-30` clears the deepest authored
 * cluster (18 m) with room to spare, so cover now grows between the choppable trees and between the
 * ore nodes, which is also what makes those nodes read as objects standing IN something.
 *
 * `settlement` was `-36` against a 46 m ring, leaving a 10 m bald spot on every town centre.
 */
const COVER_EXCLUSION: ExclusionProfile = {
  base: { hard: 0.6, fade: 3 },
  byKind: {
    settlement: { hard: -48, fade: 14 },
    road: { hard: 1.4, fade: 2.6 },
    cluster: { hard: -30, fade: 4 },
    spawn: { hard: 1, fade: 6 },
  },
  authored: { hard: 0.8, fade: 2.5 },
  // Only structural footprints use this close band. Paving, walls, doors/roads, stations and
  // props retain the authored 0.8 m hard / 2.5 m fade above, so foundations grow in without
  // putting cards in interaction or circulation space.
  authoredBuilding: { hard: 0.15, fade: 0.8 },
};

/** Pebbles and path rocks: allowed right up to anything, because they are ankle height. */
const LITTER_EXCLUSION: ExclusionProfile = {
  base: { hard: 0.5, fade: 3 },
  byKind: {
    settlement: { hard: -50, fade: 12 },
    road: { hard: -1, fade: 2 },
    cluster: { hard: -30, fade: 3 },
    spawn: { hard: 0.5, fade: 4 },
  },
  authored: { hard: 0.5, fade: 2 },
};

// --------------------------------------------------------- species presets

/**
 * The colour census every cover pool below is picked against.
 *
 * **Every species is picked off its own UVs, not off its material name.** The nature kit's
 * `Leaves` atlas is one 512x512 sheet holding greens, a blue leaf, two orange leaves and a purple
 * clover side by side, so two assets on the same material can be opposite colours and a
 * whole-texture mean says nothing. Sampled at the UVs each mesh actually reads
 * (`runs/corealm/audit/sct-uvcolour.mjs`):
 *
 *     plant_leafy_small/large  rgb(107,146,16)  green    fern_1             rgb(121,166,10)  green
 *     grass_common_short/tall  rgb(121,171,32)  green    grass_wispy_*      rgb(182,159,0)   gold
 *     plant_broad_small/large  rgb(184,63,27)   RED      clover_1/2         rgb(220,95,34)   RED
 *     flower_a_* petals        rgb(216,116,106) salmon   flower_b_* petals  rgb(167,129,190) violet
 *     mushroom_common          rgb(162,134,114) buff
 *
 * That table is why `plant_broad_small` is absent from every pool despite being, at 48 triangles
 * for a 1.05 x 0.96 m mat, by far the cheapest ground coverage in the kit — 46 triangles per
 * square metre against `grass_common_short`'s 330. It is red. `plant_broad_large`, `clover_1` and
 * `clover_2` are red for the same reason, and `bush_common`'s only material is the red autumn
 * `Leaves_TwistedTree`. Losing them is what makes dense cover cost triangles.
 *
 * ONE POOL PER REGION, which is this round's change and the brief's "not the same carpet tinted
 * three ways". The shared pool made all three regions the same sward with a different vertex
 * colour under it. Fallowmarch is river-plain meadow: common grass, a tall grass for silhouette,
 * and drifts of the salmon flower. Vellenwood is shaded woodland floor: fern and leafy plant carry
 * it, grass is thinned to a third, and mushrooms and stone litter stand in for leaf mould.
 * Karrowmoor is thin upland turf on scree: gold wispy moor grass, short common grass, and roughly
 * twice as much loose stone as either of the others.
 *
 * The cost argument that shapes every weight below: buckets are keyed on (asset, castShadow)
 * REGION-WIDE (`scatterRegion`), so a species already named by another layer in the same region
 * adds instances to an existing `InstancedMesh` and costs zero draw calls. `flower_a_single` is
 * free in Fallowmarch because `bloom` already instances it, `mushroom_common` is free in
 * Vellenwood because `fungus` does, and `grass_wispy_short` is free in Karrowmoor because `scrub`
 * does. Only `grass_common_tall` is genuinely new, and only in Fallowmarch.
 *
 * Scale bands are set against the manifest's native size. Round 2 put cover at 0.30-0.65 m and
 * that is measurably too small to read as a field: at the shipped 0.24 instances/m2 a 0.4 m tuft
 * covers about 3% of the ground, which is `w3-palewood_copse.png` — a green shader with occasional
 * props on it. Coverage is linear in count and QUADRATIC in scale, and scale is free in both
 * triangles and draw calls, so the bands here are ~1.35x wider and `sizeBias` has come down from
 * 1.6 to 1.25 so more of the draw lands near the top of the band. Together with roughly double the
 * count that is about 5x the ground coverage for about 2x the triangles.
 */

/**
 * Reeds and damp-bank fronds. Appended to every region's cover pool, because the moisture band is
 * the same plant everywhere and the shore source is what carries it.
 */
const SHORE_COVER: ScatterSpeciesSpec[] = [
  // 1.672 m native -> 1.25-2.09 m. Reeds stand plumb out of still water, so tilt is 0.
  { assetId: "grass_wispy_tall", weight: 5, scale: [0.75, 1.25], tilt: 0, sources: ["shore"] },
  // The same fern at damp-bank size. A second entry rather than a second asset: buckets are keyed
  // on asset id, so both sizes share one InstancedMesh and the variety costs no draw call.
  { assetId: "fern_1", weight: 3, scale: [0.45, 0.85], sources: ["shore"] },
];

/** Fallowmarch: river-plain meadow. Grass-dominant, waist-high tussocks, drifts of salmon flower. */
const MEADOW_COVER: ScatterSpeciesSpec[] = [
  // 1.334 m native -> 0.45-0.87 m. 155 triangles, and the backbone of the region.
  { assetId: "grass_common_short", weight: 11, scale: [0.34, 0.68] },
  // 1.014 m tall, 1.27 m wide native -> 0.44-0.83 m tall, 0.55-1.04 m across. 120 triangles: the
  // cheapest green leaf in the kit now that the red broad-leaf mats are out.
  { assetId: "plant_leafy_small", weight: 1.6, scale: [0.4, 0.72] },
  // 1.873 m native -> 0.60-1.09 m, 326 triangles. The only genuinely new species in any pool, and
  // the one thing a meadow needs that a scaled-up short tuft cannot fake: a different silhouette
  // at knee-to-waist height. Weight 1.6 keeps the bucket under `TILE_MIN_INSTANCES`, so it stays
  // one region-wide mesh and costs exactly one draw call.
  { assetId: "grass_common_tall", weight: 1.7, scale: [0.32, 0.58], tilt: 0.3 },
  // Small stones through the sward, and the cheapest trick in this file: 48 triangles, and the
  // `stones` layer already instances it, so these cost ZERO extra draw calls. 0.34 m native.
  { assetId: "rock_small_2", weight: 1.2, scale: [0.5, 1.4], tilt: 1, sink: 0.04 },
  // Same argument, 114 triangles, a rounder silhouette.
  { assetId: "pebble_round_1", weight: 1.1, scale: [0.5, 1.3], tilt: 1, sink: 0.03 },
  // 0.840 m tall, 2.83 m wide native -> 0.25-0.50 m tall, 0.85-1.70 m across: a low frond mat, and
  // the flat silhouette the red broad-leaf plants used to supply. Kept at weight 1: at 288
  // triangles it is 2.3x the cost of the greens either side of it.
  { assetId: "fern_1", weight: 0.7, scale: [0.3, 0.62], tilt: 1 },
  // 1.072 m tall, 1.32 m wide native -> 0.48-0.91 m tall, 0.59-1.12 m across. Gold, and free in
  // draw calls because `bracken` already instances it in this region. Fallowmarch is a FALLOW
  // march: a dry grass through the green is the region's name doing its job.
  { assetId: "grass_wispy_short", weight: 1.4, scale: [0.45, 0.85], tilt: 0.25 },
  // 2.068 m native -> 0.48-0.83 m. Free in draw calls (the `bloom` layer instances it) and weighted
  // low enough that the shared bucket stays one mesh. Colour through the whole field rather than
  // only in `bloom`'s drifts, which is what a river meadow in flower actually looks like.
  { assetId: "flower_a_single", weight: 0.5, scale: [0.23, 0.4], tilt: 0.3 },
  // Size hierarchy, and free. A field of cover all at one height reads as a texture; what makes it
  // read as ground is a few knee-high tussocks standing out of the ankle-high mat. Two more
  // ENTRIES on assets the pool already carries, so they share the same mesh and cost nothing.
  { assetId: "grass_common_short", weight: 2.6, scale: [0.62, 1.02], tilt: 0.25 },
  { assetId: "plant_leafy_small", weight: 0.5, scale: [0.8, 1.2], tilt: 0.3 },
  ...SHORE_COVER,
];

/** Vellenwood: shaded woodland floor. Fern and leaf, a third of the grass, mould-brown litter. */
const WOODLAND_COVER: ScatterSpeciesSpec[] = [
  // Fern leads here rather than trailing. 288 triangles, and the only asset in the kit whose
  // silhouette reads as a woodland floor rather than as a lawn.
  { assetId: "fern_1", weight: 3.4, scale: [0.32, 0.68], tilt: 0.9 },
  { assetId: "plant_leafy_small", weight: 2.6, scale: [0.36, 0.68] },
  // A third of Fallowmarch's grass weight. Grass under a closed canopy is patchy and thin, and
  // making it so is most of what separates this floor from that meadow.
  { assetId: "grass_common_short", weight: 4, scale: [0.3, 0.58] },
  // Stone litter carries what leaf mould would if the kit had a leaf-mould asset. 48 and 114
  // triangles, both already instanced by `stones`, so both are free.
  { assetId: "rock_small_2", weight: 2.8, scale: [0.5, 1.5], tilt: 1, sink: 0.05 },
  { assetId: "pebble_round_1", weight: 1.6, scale: [0.5, 1.4], tilt: 1, sink: 0.04 },
  // 880 triangles, so weighted to about 1.5% of the pool. Free in draw calls (`fungus` instances
  // it) and worth its triangles: a buff mushroom against dark green is the one warm note on this
  // floor, and finding them scattered rather than only in `fungus`'s rings is what makes the wood
  // feel walked in.
  { assetId: "mushroom_common", weight: 0.14, scale: [0.5, 1.0], tilt: 0.7 },
  // 360 triangles, free (the `undergrowth` layer instances it), and the mid-height green.
  { assetId: "plant_leafy_large", weight: 0.45, scale: [0.28, 0.5] },
  // The tussock entries, at woodland heights.
  { assetId: "plant_leafy_small", weight: 0.6, scale: [0.8, 1.2], tilt: 0.3 },
  { assetId: "fern_1", weight: 1.2, scale: [0.7, 1.15], tilt: 0.6 },
  ...SHORE_COVER,
];

/** Karrowmoor: thin upland turf on scree. Gold moor grass, short green, twice the loose stone. */
const UPLAND_COVER: ScatterSpeciesSpec[] = [
  // 1.072 m native -> 0.43-0.78 m of dry gold moor grass, rgb(182,159,0) at its own UVs. 494
  // triangles is expensive for cover, which is why it is weighted below the common grass despite
  // being the region's signature colour; free in draw calls because `scrub` already instances it.
  { assetId: "grass_wispy_short", weight: 1.8, scale: [0.4, 0.73], tilt: 0.25 },
  // Short, because upland turf is short. 155 triangles.
  { assetId: "grass_common_short", weight: 8, scale: [0.3, 0.58] },
  { assetId: "plant_leafy_small", weight: 1.3, scale: [0.36, 0.66] },
  // Roughly twice the stone weight of the other two regions, which is the whole read: this is turf
  // growing THROUGH scree rather than turf with a few stones on it. Both free in draw calls.
  { assetId: "rock_small_2", weight: 3.8, scale: [0.5, 1.6], tilt: 1, sink: 0.05 },
  { assetId: "pebble_round_1", weight: 2.2, scale: [0.5, 1.45], tilt: 1, sink: 0.04 },
  // The tussock entry. Gold, because a wind-blown moor tussock is the thing that catches the eye
  // on a grey slope.
  { assetId: "grass_wispy_short", weight: 0.8, scale: [0.62, 1.0], tilt: 0.2 },
  ...SHORE_COVER,
];

/**
 * The continuous floor under everything, and the answer to "open ground is bare".
 *
 * `groundcover` clusters into tufts, which is right for what a tuft is and wrong for the ground
 * between tufts: measured on the shot poses, only 22% of the 3 m cells within 30 m of Palewood
 * Copse held anything at all before this layer existed. A clustered layer cannot fix that, because
 * clustering is what makes the gaps.
 *
 * So this layer is deliberately NOT clustered and carries NO mask: plain Poisson at `spacing` over
 * the whole region, thinned only by the exclusion density field and the slope rule. That is what
 * "thins near roads and settlements but never drops to nothing" has to mean mechanically.
 *
 * Every id here is already instanced by that region's `groundcover` or by `stones`, so the whole
 * layer is free in draw calls — the entire cost is triangles, and each pool is the region's own
 * cover mix cut to its cheapest three or four members and scaled a size down, so the carpet reads
 * as the same ground as the tufts standing in it rather than as a second species list.
 */
const MEADOW_CARPET: ScatterSpeciesSpec[] = [
  { assetId: "grass_common_short", weight: 9, scale: [0.3, 0.6] },
  { assetId: "plant_leafy_small", weight: 1.6, scale: [0.34, 0.62] },
  { assetId: "rock_small_2", weight: 1.6, scale: [0.45, 1.2], tilt: 1, sink: 0.04 },
  { assetId: "pebble_round_1", weight: 0.8, scale: [0.45, 1.1], tilt: 1, sink: 0.03 },
  // 494 triangles is expensive for a carpet, so weight 1 — about 6% of the layer. Enough that the
  // gold reads as part of the sward rather than as a separate stratum sitting on top of it.
  { assetId: "grass_wispy_short", weight: 0.7, scale: [0.4, 0.75], tilt: 0.2 },
];

const WOODLAND_CARPET: ScatterSpeciesSpec[] = [
  { assetId: "plant_leafy_small", weight: 2.4, scale: [0.32, 0.6] },
  { assetId: "fern_1", weight: 1.6, scale: [0.26, 0.5], tilt: 0.9 },
  { assetId: "grass_common_short", weight: 4.5, scale: [0.28, 0.54] },
  { assetId: "rock_small_2", weight: 3.4, scale: [0.45, 1.3], tilt: 1, sink: 0.04 },
  { assetId: "pebble_round_1", weight: 1.4, scale: [0.45, 1.2], tilt: 1, sink: 0.03 },
];

const UPLAND_CARPET: ScatterSpeciesSpec[] = [
  { assetId: "grass_common_short", weight: 8, scale: [0.26, 0.52] },
  { assetId: "plant_leafy_small", weight: 1.4, scale: [0.34, 0.62] },
  { assetId: "rock_small_2", weight: 4, scale: [0.45, 1.4], tilt: 1, sink: 0.04 },
  { assetId: "pebble_round_1", weight: 2.4, scale: [0.45, 1.25], tilt: 1, sink: 0.03 },
];

/**
 * Low grass stems that buy density without multiplying the mixed cover pools.
 *
 * Keeping these pools grass-only matters. Halving the existing `carpet` spacing would multiply
 * every pebble, fern and broad plant along with the grass, undoing most of the triangle saving and
 * making paths look cluttered instead of grown in. All entries below merge with grass already
 * emitted by `groundcover` and `carpet` into the same per-region, per-tile sprite mesh.
 */
const MEADOW_BLADES: ScatterSpeciesSpec[] = [
  { assetId: "grass_common_short", weight: 10, scale: [0.14, 0.29] },
  { assetId: "grass_wispy_short", weight: 1.4, scale: [0.18, 0.34], tilt: 0.2 },
];

const WOODLAND_BLADES: ScatterSpeciesSpec[] = [
  { assetId: "grass_common_short", weight: 1, scale: [0.13, 0.26] },
];

const UPLAND_BLADES: ScatterSpeciesSpec[] = [
  { assetId: "grass_common_short", weight: 7, scale: [0.12, 0.25] },
  { assetId: "grass_wispy_short", weight: 3, scale: [0.17, 0.33], tilt: 0.2 },
];

/**
 * Pebbles, plus the six previously unused `path_rock_*` assets on roads only.
 *
 * All ten share the `PathRocks` material, so under a material-keyed batch the whole family would be
 * free; under per-asset InstancedMesh each one is another draw call, so the pool is cut to the
 * three cheapest silhouettes and one road stone.
 */
const STONE_SPECIES: ScatterSpeciesSpec[] = [
  { assetId: "pebble_round_1", weight: 4, scale: [0.5, 1.4], tilt: 1, sink: 0.04 },
  // pebble_round_2 is the same 0.4 m rounded stone at 124 triangles against 114 and was dropped:
  // a second near-identical silhouette is another draw call in every region for no read at all.
  { assetId: "rock_small_2", weight: 3, scale: [0.5, 1.5], tilt: 1, sink: 0.05 },
  // 559 triangles, and the cheapest of the six. Road only, and a minority even there. Its siblings
  // cost 998-3500 for a stone the player walks over, and each of them is another draw call.
  { assetId: "path_rock_small_2", weight: 2.4, scale: [0.7, 1.6], tilt: 1, sink: 0.06, sources: ["road"] },
];

// --------------------------------------------------------- region presets

/**
 * Per-region density and species mix.
 *
 * Every id below is picked by hand off a triangle and native-height census of the nature kit, not
 * by tag lookup, because the manifest tag order happens to select the *most* expensive member of
 * each family. Measured, per source asset, all primitives summed:
 *
 * ```text
 *   tree_twisted_1..5   9134 - 10104     tree_dead_1..5      5648 - 6557
 *   tree_common_1..5    3182 -  6265     tree_pine_1..5      1646 - 4964
 *   bush/fern/plant       48 -   1368    grass/clover/flower  155 -  1690
 *   pebble/rock_small     48 -    124    path_rock_*          559 -  3500
 *   boulder/cliff        288 -   1664
 * ```
 *
 * Two facts drive every number here (architecture.md, correction R6):
 *
 *  1. **Draw calls are flat in instance count.** One region-wide `InstancedMesh` costs one draw
 *     whether it holds 20 trees or 2000. Draw calls are set by *species count*, times primitives
 *     per asset (2 for every tree in this kit, trunk plus foliage), times 2 again for a shadow
 *     caster. Cutting density buys none. Cutting species and shadow casters buys all of them.
 *  2. **Triangles are linear in instance count and in per-asset cost.** Those same region-wide
 *     bounding spheres mean nothing is ever frustum-culled, so the whole streamed-in region is
 *     submitted every frame. The only levers are count and species.
 *
 * Round 1 shipped 2,019 instances over 28 ha — one prop per 139 m2, every one of them standing
 * alone — for 62 draw calls and 2.50M triangles. Round 2 took that to 59,534 instances and 12.0M
 * triangles by clustering. This round takes it to 128,766 and 25.0M, and the reason is that
 * instance COUNT was never the number the eye reads: measured with runs/corealm/audit/gd-cover.ts,
 * which sums each instance's drawn footprint rather than counting props, round 2's ground cover
 * covered 6% of the ground within 25 m of the Palewood pose. That is `w3-palewood_copse.png` — a
 * green shader with a few tufts on it — and it is what "the look and feel is terribly basic" and
 * "still look sparse" both point at. Coverage is linear in count and QUADRATIC in scale, so this
 * round spends on both: counts roughly double, scale bands widen about 1.35x, `sizeBias` drops
 * from 1.6 to 1.25 so more of the draw lands at the top of the band, and the pools lean on
 * `plant_leafy_small` (1.27 x 1.39 m native for 120 triangles, i.e. 87 triangles per square metre
 * covered, against `grass_common_short`'s 419). Palewood is now 26%, march_road 28%, the
 * Vellenwood floor 45%.
 *
 * The offline sweep (runs/corealm/audit/dcb-sweep.ts) puts the price at the worst of the 18 poses
 * at 201 draw calls against 166, and 17.5M triangles against 7.9M. Draw calls were the tight axis
 * and are still not tight; the 35 extra are almost all extra TILES, not extra species, because a
 * bucket that crosses `TILE_MIN_INSTANCES` starts being cut up.
 *
 *  Fallowmarch  sparse, long sightlines (PRD, "Look"). Real copses with real gaps between them;
 *               choppable trees are entities, not scatter.
 *  Vellenwood   deep green woodland. Enclosure comes from stands separated by clearings, not from
 *               a uniform gloom of evenly spaced trunks.
 *  Karrowmoor   rock and scrub. Scree belongs on the risers, not on the terrace tops.
 */
export const DEFAULT_SCATTER: Record<RegionId, RegionScatterSpec> = {
  fallowmarch: {
    regionId: "fallowmarch",
    layers: [
      {
        // The two cheapest green broadleaves in the kit (3182 and 3505 triangles). Clustered at a
        // 86 m centre spacing with a strong mask, so the region gets a handful of real copses and
        // long open sightlines between them rather than 38 lone trees on 13 m centres.
        id: "copse",
        assetIds: ["tree_common_5"],
        maxCount: 105, scale: [0.95, 1.6], sizeBias: 1.6,
        tilt: 0.1, castShadow: true, mirror: true,
        exclusion: TREE_EXCLUSION,
        terrain: { slopeMax: 0.45 },
        cluster: { spacing: 46, radius: [14, 26], memberSpacing: 8, accept: 0.95, falloff: 0.7, dominance: 0.78 },
        mask: { strength: 0.35, featureSize: 90 },
      },
      {
        // Bare silhouettes against the sky. One species: 12 of them over 132,000 m2 never repeat
        // inside a frame, and a second would cost 2 more draw calls for nothing. Deliberately not
        // clustered — a lone dead tree is a landmark, a stand of them is a swamp.
        id: "deadwood", assetIds: ["tree_dead_5"],
        spacing: 45, maxCount: 12, scale: [0.9, 1.35], sizeBias: 1.4,
        tilt: 0.08, castShadow: true, clearance: 2,
        exclusion: TREE_EXCLUSION,
      },
      {
        // Was 104 instances of `bush_common`, whose only material is `Leaves_TwistedTree` — the
        // red-dominant autumn texture this same file removed from Vellenwood for rendering crimson.
        // It read as magenta blobs on olive grass in every Fallowmarch screenshot. The replacement
        // is `plant_leafy_large` (rgb(107,146,16) at its UVs, 360 triangles against bush_common's
        // 900) and gold moor grass. `bush_flowering` was the obvious swap and is not used: it is
        // 1368 triangles across 2 primitives, i.e. twice the draw cost for one more silhouette.
        id: "bracken",
        species: [
          { assetId: "plant_leafy_large", weight: 3 },
          // 1.672 m native -> 0.84-1.51 m of dry gold moor grass, rgb(182,159,0) at its own UVs.
          { assetId: "grass_wispy_short", weight: 2, scale: [0.8, 1.4], tilt: 0.2 },
        ],
        maxCount: 1750, scale: [0.7, 1.25], tilt: 0.35, mirror: true,
        exclusion: SHRUB_EXCLUSION,
        cluster: { spacing: 17, radius: [5, 13], memberSpacing: 1.8, accept: 0.68, falloff: 0.75, dominance: 0.8 },
        mask: { strength: 0.45, featureSize: 62 },
      },
      {
        // Deliberately NOT rock_medium_*: those are the ore-node meshes, and dressing that shares a
        // silhouette with a minable node is half of why ore is unreadable. Clustered into rock
        // fields, biased onto slopes, and extended along the roads as verge gravel.
        id: "stones", species: STONE_SPECIES,
        maxCount: 480, scale: [0.5, 1.3], tilt: 1, sink: 0.05, mirror: true,
        exclusion: LITTER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.5, steep: 2.2 } },
        cluster: { spacing: 30, radius: [3, 10], memberSpacing: 1.3, accept: 0.42, falloff: 0.8, dominance: 0.5 },
        road: { band: [0.4, 4.6], perMetre: 0.55 },
        shore: { band: [1.5, 12], perMetre: 0.5 },
      },
      {
        // The layer that carries the ground read. Tufts at 0.62 m member spacing inside a
        // 2.4-5.6 m disc on 6.4 m centres: dense where it is, honestly thinner between, which is
        // what a grazed river meadow looks like from eye height. Member spacing came down from
        // 0.9 m and the cap up from 11,500, which is 2.1x the instances for 2.1x the triangles and
        // zero extra draw calls — the buckets already exist and are already tiled.
        id: "groundcover", species: MEADOW_COVER,
        maxCount: 29000, scale: [0.2, 0.4], sizeBias: 1.25, tilt: 0.55, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: {
          slopeBias: { low: 0.2, high: 0.7, flat: 1.35, steep: 0.35 },
          moisture: { reach: 18, boost: 2.5 },
        },
        cluster: { spacing: 6.4, radius: [2.4, 5.6], memberSpacing: 0.58, accept: 0.74, falloff: 0.55, dominance: 0.55 },
        mask: { strength: 0.22, featureSize: 46 },
        road: { band: [2.6, 6.5], perMetre: 2.2 },
        shore: { band: [-0.6, 9], perMetre: 3.0 },
      },
      {
        // The continuous floor. No mask and no cluster: this layer's whole job is that it never
        // goes to zero, so it is plain Bridson over the whole region thinned only by the exclusion
        // field and the slope rule. 1.75 m spacing rather than 2.7 m is 2.4x the points, and it is
        // the single change that most moves the "dense grass" read: `groundcover`'s tufts are what
        // the eye lands on, this is what stops the ground between them being bare shader.
        id: "carpet", species: MEADOW_CARPET,
        spacing: 1.6, maxCount: 30000, scale: [0.18, 0.4], sizeBias: 1.25, tilt: 0.8, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.3, high: 0.85, flat: 1.15, steep: 0.45 } },
        road: { band: [2.4, 7.5], perMetre: 1.1 },
      },
      {
        // A low, grass-only floor. At 0.67 m this settles at about 1.1 cards/m2 after road, water,
        // settlement and slope rejection: dense enough for a continuous town-edge sward, while
        // the authored road/building exclusions remain untouched. Four-triangle cards keep the
        // 145k cap under 0.6M triangles and one already-tiled instanced material family.
        id: "bladecarpet", species: MEADOW_BLADES,
        spacing: 0.67, maxCount: 145000, scale: [0.14, 0.34], sizeBias: 1.4, tilt: 0.45,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.8, flat: 1.2, steep: 0.35 } },
      },
      {
        // Colour accents only, as drifts rather than as a lawn. `flower_a_group` is 2.055 m native
        // and was scaled to 1.44-2.47 m in round 1; at [0.28, 0.5] it lands at 0.58-1.03 m.
        id: "bloom",
        assetIds: ["flower_a_single"],
        maxCount: 640, scale: [0.28, 0.5], tilt: 0.4, mirror: true,
        exclusion: COVER_EXCLUSION,
        cluster: { spacing: 24, radius: [2.5, 8], memberSpacing: 1.1, accept: 0.4, falloff: 0.8, dominance: 0.85 },
        mask: { strength: 0.6, featureSize: 40 },
      },
    ],
  },

  vellenwood: {
    regionId: "vellenwood",
    layers: [
      {
        // Critique finding 5. The dominant layer used to be the `twisted` family, which is an
        // autumn tree in the source texture: a wood built from it renders crimson and black, and a
        // 0.25-strength retint cannot move a dark red albedo. The dominant canopy is green
        // broadleaf, and also the cheapest green broadleaf: 3344 triangles average against the
        // twisted family's 9596.
        //
        // Enclosure is bought with stands and clearings, not with prop count. 38 m centres, a disc
        // of 10-19 m and a 6.4 m member spacing give ~20 groves of 10-14 trees with real gaps; a
        // flat sprinkle at the same total count gives uniform gloom, which is what round 1 shipped.
        // Capped at 210: at 3344 triangles with a shadow pass, 250 trees is 1.7M triangles and this
        // is the one number in the region that can move the frame budget.
        id: "canopy",
        species: [
          { assetId: "tree_common_3", weight: 3 },
          { assetId: "tree_common_5", weight: 2 },
        ],
        maxCount: 210, scale: [1.05, 1.7], sizeBias: 1.5,
        tilt: 0.1, castShadow: true, mirror: true,
        exclusion: TREE_EXCLUSION,
        terrain: { slopeMax: 0.6 },
        cluster: { spacing: 25, radius: [10, 19], memberSpacing: 6.4, accept: 0.95, falloff: 0.6, dominance: 0.75 },
        mask: { strength: 0.38, featureSize: 78 },
      },
      {
        // tree_pine_5 is 1646 triangles, the cheapest tree in the kit by a factor of two, so
        // conifers carry count where broadleaves cannot. One species: a stand of a single conifer
        // is what real conifers look like, and it saves 4 draw calls. Biased uphill, because a
        // pine stand on the shoulder above a broadleaf hollow is free legibility.
        id: "conifer", assetIds: ["tree_pine_5"],
        maxCount: 190, scale: [1.0, 1.9], sizeBias: 1.5,
        tilt: 0.1, castShadow: true, mirror: true,
        exclusion: TREE_EXCLUSION,
        terrain: { slopeMax: 0.8, slopeBias: { low: 0.2, high: 0.6, flat: 0.75, steep: 1.6 } },
        cluster: { spacing: 22, radius: [8, 16], memberSpacing: 5, accept: 0.9, falloff: 0.65, dominance: 1 },
        mask: { strength: 0.3, featureSize: 70 },
      },
      {
        // The red tree survives as an accent, not as the wood. Sixteen across 70,300 m2 is a
        // handful per frame: a few autumn crowns in a green wood is deliberate art direction, and
        // at 9134 triangles each that is 0.29M instead of 1.9M. Not clustered, and scaled up hard,
        // so each one reads as an individual worth walking toward.
        id: "duskoak", assetIds: ["tree_twisted_2"],
        spacing: 44, maxCount: 16, scale: [1.35, 2.15], sizeBias: 1.3,
        tilt: 0.06, castShadow: true, clearance: 3,
        exclusion: TREE_EXCLUSION,
      },
      {
        // PRD: "ground clutter kept low so pathing stays legible" — so it is clustered rather than
        // spread, which keeps the corridors between clumps walkable-looking.
        //
        // `bush_common` is deliberately absent even though it is the cheapest volume in the kit:
        // it shares `Leaves_TwistedTree` with the autumn tree and put a crimson mass at eye height
        // across the whole wood. `plant_broad_large` is NOT the green replacement this file used to
        // claim it was - it is rgb(184,63,27) at its own UVs, redder than the bush it replaced - so
        // the volume comes from ferns and the two leafy plants instead.
        id: "undergrowth",
        species: [
          { assetId: "fern_1", weight: 4, scale: [0.7, 1.5], tilt: 0.8 },
          { assetId: "plant_leafy_large", weight: 2 },
          { assetId: "plant_leafy_small", weight: 3, scale: [0.5, 1.1] },
        ],
        maxCount: 2600, scale: [0.8, 1.5], tilt: 0.5, mirror: true,
        exclusion: SHRUB_EXCLUSION,
        cluster: { spacing: 9.5, radius: [3, 8.5], memberSpacing: 1.45, accept: 0.74, falloff: 0.7, dominance: 0.7 },
        mask: { strength: 0.35, featureSize: 55 },
      },
      {
        // mushroom_bracket is 3216 triangles, more than a whole tree_common_5, for a prop the
        // player only ever sees from four metres. mushroom_common is 880, and in tight rings of
        // 6-10 it reads as a fairy ring rather than as scattered litter.
        id: "fungus", assetIds: ["mushroom_common"],
        maxCount: 130, scale: [0.7, 1.4], tilt: 0.7, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: { moisture: { reach: 22, boost: 2 } },
        cluster: { spacing: 32, radius: [1.2, 3.2], memberSpacing: 0.75, accept: 0.8, falloff: 0.6, dominance: 1 },
        mask: { strength: 0.4, featureSize: 50 },
      },
      {
        id: "stones", species: STONE_SPECIES,
        maxCount: 320, scale: [0.5, 1.3], tilt: 1, sink: 0.06, mirror: true,
        exclusion: LITTER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.6, steep: 2 } },
        cluster: { spacing: 28, radius: [3, 9], memberSpacing: 1.4, accept: 0.6, falloff: 0.8, dominance: 0.5 },
        road: { band: [0.4, 4.6], perMetre: 0.5 },
        shore: { band: [1.5, 10], perMetre: 0.4 },
      },
      {
        // Fern and leaf rather than turf, and clumpier than the meadow: a woodland floor is a
        // mosaic of dense patches under the gaps and near-bare ground under a closed crown, which
        // is what the lower `accept` and the stronger mask buy.
        id: "groundcover", species: WOODLAND_COVER,
        maxCount: 19000, scale: [0.2, 0.4], sizeBias: 1.25, tilt: 0.55, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: {
          slopeBias: { low: 0.2, high: 0.75, flat: 1.3, steep: 0.4 },
          moisture: { reach: 18, boost: 2.5 },
        },
        cluster: { spacing: 6.2, radius: [2.2, 5.2], memberSpacing: 0.66, accept: 0.72, falloff: 0.6, dominance: 0.58 },
        mask: { strength: 0.34, featureSize: 42 },
        road: { band: [2.6, 6.5], perMetre: 2.2 },
        shore: { band: [-0.6, 9], perMetre: 2.8 },
      },
      {
        // Woodland floor. See the Fallowmarch `carpet` for why this layer exists and why it costs
        // no draw calls; the difference here is that a wood's floor is leaf and stone rather than
        // turf, so `WOODLAND_CARPET` gives the stones and the fern more of the weight.
        id: "carpet", species: WOODLAND_CARPET,
        spacing: 1.85, maxCount: 17000, scale: [0.18, 0.4], sizeBias: 1.25, tilt: 0.8, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.3, high: 0.9, flat: 1.15, steep: 0.5 } },
        road: { band: [2.4, 7.5], perMetre: 1.1 },
      },
      {
        // Patchy low grass under the canopy. Ferns and leaf plants stay in the mixed layers above;
        // this count buys stems only and therefore does not turn Vellenwood's paths into clutter.
        id: "bladecarpet", species: WOODLAND_BLADES,
        spacing: 0.78, maxCount: 80000, scale: [0.13, 0.26], sizeBias: 1.45, tilt: 0.5,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.85, flat: 1.1, steep: 0.35 } },
        mask: { strength: 0.12, featureSize: 34 },
      },
    ],
  },

  karrowmoor: {
    regionId: "karrowmoor",
    layers: [
      {
        // The terrain already supplies the terraces. The old platformer boulder/cliff pair was
        // cheap, but its broad untextured faces filled the foreground and hid those terraces in
        // the authored shot. These textured rocks are already loaded by the stone layer, so the
        // crags retain their clustered silhouette without adding a material family or a draw call.
        id: "crags",
        species: [
          // Species scale composes with the layer's 0.8..1.8 band. Keep the product below 2.25:
          // larger values turn a crag on the first riser into the entire foreground.
          { assetId: "rock_medium_1", weight: 3, scale: [0.75, 1.25] },
          { assetId: "rock_medium_2", weight: 2, scale: [0.7, 1.2] },
          { assetId: "rock_medium_3", weight: 2, scale: [0.65, 1.15] },
        ],
        maxCount: 150, scale: [0.8, 1.8], sizeBias: 1.8, mirror: true,
        tilt: 0.3, sink: 0.6, castShadow: true,
        exclusion: SHRUB_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.5, steep: 2.4 } },
        cluster: { spacing: 26, radius: [9, 18], memberSpacing: 4.6, accept: 0.85, falloff: 0.7, dominance: 0.6 },
        mask: { strength: 0.25, featureSize: 80 },
      },
      {
        // Same cheapest-pine argument as Vellenwood. Wind-stunted here, so the scale band is low,
        // and banded to the middle of the region's 62 m amplitude: no pines on the tarn shore and
        // none on the summit.
        id: "cairnpine", assetIds: ["tree_pine_5"],
        maxCount: 150, scale: [0.75, 1.2], sizeBias: 1.5,
        tilt: 0.12, castShadow: true, mirror: true,
        exclusion: TREE_EXCLUSION,
        terrain: { slopeMax: 0.62, altitude: [0.06, 0.88], altitudeFade: 6 },
        cluster: { spacing: 24, radius: [8, 16], memberSpacing: 5.2, accept: 0.8, falloff: 0.7, dominance: 1 },
        mask: { strength: 0.35, featureSize: 74 },
      },
      {
        id: "windfall", assetIds: ["tree_dead_5"],
        spacing: 40, maxCount: 14, scale: [0.7, 1.05], sizeBias: 1.4,
        tilt: 0.1, castShadow: true, clearance: 2,
        exclusion: TREE_EXCLUSION,
      },
      {
        // Scree wants to be dense to read as scree, and at ~100 triangles a stone it can be. The
        // x4 slope bias is what round 1 was missing: `scree` had no slope rule at all, so the grey
        // terrace tops carried the same stone density as the risers.
        id: "scree", species: STONE_SPECIES,
        maxCount: 900, scale: [0.45, 1.4], sizeBias: 2, tilt: 1, sink: 0.06, mirror: true,
        exclusion: LITTER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.15, steep: 4 } },
        cluster: { spacing: 17, radius: [4, 13], memberSpacing: 1.2, accept: 0.7, falloff: 0.8, dominance: 0.45 },
        road: { band: [0.4, 4.6], perMetre: 0.5 },
        shore: { band: [1.2, 9], perMetre: 0.5 },
      },
      {
        // Was 134 instances of `bush_common` and the same red-material problem as Fallowmarch's
        // bracken. `plant_leafy_small` is 120 triangles against bush_common's 900, and green.
        id: "scrub",
        species: [
          { assetId: "plant_leafy_small", weight: 3 },
          // Dry gold moor grass, rgb(182,159,0). The `plant_broad_large` that used to sit here is
          // rgb(184,63,27) - the same red the `bush_common` swap was made to get rid of.
          { assetId: "grass_wispy_short", weight: 3, scale: [0.7, 1.3], tilt: 0.2 },
        ],
        maxCount: 1500, scale: [0.6, 1.1], tilt: 0.5, mirror: true,
        exclusion: SHRUB_EXCLUSION,
        terrain: { slopeBias: { low: 0.3, high: 0.7, flat: 1.2, steep: 0.5 } },
        cluster: { spacing: 14, radius: [4, 11], memberSpacing: 1.55, accept: 0.66, falloff: 0.75, dominance: 0.72 },
        mask: { strength: 0.45, featureSize: 58 },
      },
      {
        // Thin upland turf, so this is the least dense of the three cover layers by design: a
        // 0.72 m member spacing against the meadow's 0.62, a stronger mask, and `UPLAND_COVER`
        // spending roughly a third of its weight on loose stone. Karrowmoor should read as turf
        // growing through scree, not as a lawn on a hill.
        id: "groundcover", species: UPLAND_COVER,
        maxCount: 16000, scale: [0.2, 0.38], sizeBias: 1.25, tilt: 0.6, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: {
          slopeBias: { low: 0.25, high: 0.8, flat: 1.3, steep: 0.45 },
          moisture: { reach: 16, boost: 2.5 },
        },
        cluster: { spacing: 6.6, radius: [2.0, 5.0], memberSpacing: 0.72, accept: 0.7, falloff: 0.62, dominance: 0.58 },
        mask: { strength: 0.4, featureSize: 44 },
        road: { band: [2.6, 6.5], perMetre: 2.0 },
        shore: { band: [-0.6, 8], perMetre: 1.8 },
      },
      {
        // Moorland floor. The slope bias is harder here than in the other two regions because
        // Karrowmoor's risers reach 60 degrees and a turf carpet on a 60-degree face reads as a
        // texture bug; the `scree` layer is what dresses those, biased x4 the other way.
        id: "carpet", species: UPLAND_CARPET,
        spacing: 2.0, maxCount: 15000, scale: [0.18, 0.38], sizeBias: 1.25, tilt: 0.85, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.3, high: 0.8, flat: 1.2, steep: 0.3 } },
        road: { band: [2.4, 7.5], perMetre: 1.1 },
      },
      {
        // Wind-short moor grass, still thinner than the meadow. Gold remains common enough to
        // separate the upland turf from Fallowmarch without adding another material or draw call.
        id: "bladecarpet", species: UPLAND_BLADES,
        spacing: 0.8, maxCount: 80000, scale: [0.12, 0.33], sizeBias: 1.45, tilt: 0.55,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.78, flat: 1.15, steep: 0.25 } },
      },
    ],
  },

  // Underground. Dressed by hand from the dungeon kit in a later round; scattering rubble in a
  // corridor produces nonsense.
  gravelmaw: { regionId: "gravelmaw", layers: [] },
};
