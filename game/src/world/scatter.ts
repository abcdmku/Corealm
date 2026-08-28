/**
 * Deterministic procedural dressing.
 *
 * Scatter is everything the player can see and nothing the player can touch. Gameplay entities are
 * authored in region data and built by the world layer; this file places grass, trees, rocks and
 * clutter around them. If something here becomes interactable, it has been put in the wrong file.
 *
 * Three properties are load-bearing:
 *
 *  1. **Deterministic.** Same seed, byte-identical layout. Every draw comes from `core/rng.ts`;
 *     `Math.random` is banned. Each layer gets its own derived stream, so adding a layer or
 *     changing one layer's count cannot shift the layout of any other layer.
 *  2. **Poisson-disc.** Uniform random scatter clumps and leaves holes. Bridson's algorithm gives
 *     the even, hand-placed-looking distribution the art target needs, with a guaranteed minimum
 *     spacing so nothing interpenetrates.
 *  3. **Instanced.** One `InstancedMesh` per (asset, material) pair, per region. That is the whole
 *     draw-call budget argument (runs/corealm/architecture.md, correction R6).
 *
 * The consequence of (3) worth stating out loud, because it decides every number in
 * `DEFAULT_SCATTER`: a region-wide `InstancedMesh` has a region-wide bounding sphere, so it is
 * never frustum-culled and never distance-culled below `WorldScene.updateStreaming`'s per-region
 * granularity. Draw calls are therefore flat in instance count and set purely by variant count,
 * while triangles are linear in instance count. Splitting a layer into spatial tiles would win the
 * triangles back, but it trades them for draw calls at a bad rate, and draw calls are the budget
 * that actually fails. Real per-layer draw distances need a per-object anchor and radius in
 * `WorldScene.registerScatter`/`updateStreaming`; see the round-2 report.
 *
 * Exclusion zones are how gameplay space stays clear: the root registers settlement footprints,
 * resource clusters, roads and the spawn approach before scattering, and nothing is placed inside
 * them.
 */
import type { RegionId, Vec3 } from "../contracts.js";
import { Rng } from "../core/rng.js";
import type { AssetRegistry } from "../render/assets.js";
import { createValueNoise, type Rect, type WorldScene } from "../render/scene.js";

// ------------------------------------------------------------- exclusions

export type ExclusionKind = "settlement" | "road" | "cluster" | "spawn" | "water" | "custom";

interface CircleZone { kind: ExclusionKind; id: string; x: number; z: number; radius: number }
interface RectZone { kind: ExclusionKind; id: string; rect: Rect; margin: number }

/**
 * Places nothing may be scattered. Registered by the root before `scatterRegion` runs, because
 * scatter has no idea what a bank or an ore seam is and must not learn.
 */
export class ExclusionZones {
  private circles: CircleZone[] = [];
  private rects: RectZone[] = [];

  addCircle(x: number, z: number, radius: number, kind: ExclusionKind = "custom", id = ""): this {
    this.circles.push({ kind, id, x, z, radius });
    return this;
  }

  addPoint(position: Vec3, radius: number, kind: ExclusionKind = "cluster", id = ""): this {
    return this.addCircle(position[0], position[2], radius, kind, id);
  }

  addRect(rect: Rect, margin = 0, kind: ExclusionKind = "settlement", id = ""): this {
    this.rects.push({ kind, id, rect, margin });
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

  /** True when a point is inside any zone, expanded by `margin` metres. */
  blocks(x: number, z: number, margin = 0): boolean {
    for (const circle of this.circles) {
      const radius = circle.radius + margin;
      const dx = x - circle.x;
      const dz = z - circle.z;
      if (dx * dx + dz * dz <= radius * radius) return true;
    }
    for (const zone of this.rects) {
      const total = zone.margin + margin;
      if (
        x >= zone.rect.minX - total && x <= zone.rect.maxX + total &&
        z >= zone.rect.minZ - total && z <= zone.rect.maxZ + total
      ) return true;
    }
    return false;
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
  }
}

/**
 * The registry the root writes settlement and cluster footprints into. `scatterRegion` uses it
 * unless a spec supplies its own, so the wiring is one import and a few `addCircle` calls.
 */
export const worldExclusions = new ExclusionZones();

// ------------------------------------------------------------------ specs

export interface ScatterLayerSpec {
  id: string;
  /** Explicit asset ids win. Otherwise every manifest asset carrying ALL of `tags`. */
  assetIds?: string[];
  tags?: string[];
  /**
   * Cap on distinct *assets* used. Not the same as a cap on draw calls: a source GLB costs one
   * `InstancedMesh` per primitive, and every tree in the Quaternius nature kit has two (trunk and
   * foliage are separate materials). So a 4-variant shadow-casting tree layer is
   * 4 assets x 2 primitives x 2 passes = 16 draw calls, while a 4-variant grass layer is 4.
   * Tune this first when the draw-call budget is tight; instance count does not affect it at all.
   */
  maxVariants?: number;
  /** Poisson-disc minimum spacing in metres. */
  spacing: number;
  /** Hard cap. Spacing is widened automatically to hit it, so the spread stays even. */
  maxCount: number;
  scale: [number, number];
  /** Extra clearance added to every exclusion zone for this layer. Big props need more. */
  clearance?: number;
  /** Reject placements steeper than this (rise over run). 0.7 is about 35 degrees. */
  slopeMax?: number;
  /** Only large silhouettes cast: shadow casters cost a second draw call each. */
  castShadow?: boolean;
  /** Metres to sink into the ground so rocks and stumps bed in. */
  sink?: number;
  /** 0..1. How strongly a low-frequency mask thins the layer into clumps and clearings. */
  patchiness?: number;
  /** Feature size of that mask, in metres. */
  patchScale?: number;
  /** Optional altitude band, in metres. */
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
  instancedMeshes: number;
  /** Estimated draw calls added, counting the shadow pass for casters. */
  estimatedDrawCalls: number;
  /**
   * Triangles this region submits when it is streamed in, counting the shadow pass. Region-wide
   * `InstancedMesh`es have region-wide bounding spheres, so nothing here is frustum-culled: this
   * number is what the GPU actually sees, not an upper bound. It is the figure to watch, because
   * draw calls are flat in instance count and triangles are linear in it.
   */
  estimatedTriangles: number;
  byLayer: Record<string, number>;
  missingAssets: string[];
}

// -------------------------------------------------------------- placement

interface Placement {
  position: Vec3;
  rotationY: number;
  scale: number;
}

/**
 * Bridson Poisson-disc sampling over a rect, seeded.
 *
 * `maxCount` is honoured by widening the radius rather than truncating the output: truncating a
 * frontier-order sample leaves a blob where the algorithm started and bare ground everywhere else.
 */
function poissonDisc(rect: Rect, minDistance: number, maxCount: number, rng: Rng): [number, number][] {
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  if (width <= 0 || depth <= 0 || maxCount <= 0) return [];

  const area = width * depth;
  const radius = Math.max(minDistance, Math.sqrt((area * 0.66) / maxCount));
  const cell = radius / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(depth / cell));
  const grid = new Int32Array(cols * rows).fill(-1);

  const points: [number, number][] = [];
  const active: number[] = [];

  const insert = (x: number, z: number): number => {
    const index = points.length;
    points.push([x, z]);
    const col = Math.min(cols - 1, Math.max(0, Math.floor((x - rect.minX) / cell)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((z - rect.minZ) / cell)));
    grid[row * cols + col] = index;
    active.push(index);
    return index;
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
  while (active.length > 0 && points.length < maxCount * 3) {
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

/**
 * Resolves the asset ids a layer will actually use, capped so draw calls stay predictable.
 *
 * Unknown explicit ids are reported rather than silently dropped. Every id in `DEFAULT_SCATTER` is
 * hand-picked off the measured triangle table, so a typo that quietly degrades a layer to two
 * variants is exactly the failure that is hardest to see in a screenshot.
 */
function resolveAssets(
  assets: AssetRegistry,
  layer: ScatterLayerSpec,
): { ids: string[]; unknown: string[] } {
  const limit = layer.maxVariants ?? 4;
  if (layer.assetIds && layer.assetIds.length > 0) {
    const ids: string[] = [];
    const unknown: string[] = [];
    for (const id of layer.assetIds) {
      if (assets.entry(id) === undefined) unknown.push(id);
      else if (ids.length < limit) ids.push(id);
    }
    return { ids, unknown };
  }
  if (!layer.tags || layer.tags.length === 0) return { ids: [], unknown: [] };
  return { ids: assets.byTags(...layer.tags).map((entry) => entry.id).slice(0, limit), unknown: [] };
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
    instancedMeshes: 0,
    estimatedDrawCalls: 0,
    estimatedTriangles: 0,
    byLayer: {},
    missingAssets: [],
  };
  if (!rect) return result;

  for (const layer of spec.layers) {
    const { ids, unknown } = resolveAssets(assets, layer);
    for (const id of unknown) result.missingAssets.push(`${layer.id}:${id}`);
    if (ids.length === 0) {
      result.missingAssets.push(layer.id);
      continue;
    }

    try {
      await assets.loadMany(ids);
    } catch {
      result.missingAssets.push(layer.id);
      continue;
    }

    const rng = new Rng(layerSeed(seed, regionId, layer.id));
    const mask = createValueNoise(layerSeed(seed, regionId, `${layer.id}-mask`));
    const patchiness = layer.patchiness ?? 0;
    const patchScale = layer.patchScale ?? 70;
    const clearance = layer.clearance ?? 0;
    const slopeMax = layer.slopeMax ?? 0.85;
    const sink = layer.sink ?? 0;

    const candidates = poissonDisc(rect, layer.spacing, layer.maxCount, rng);
    const buckets = new Map<string, Placement[]>();

    for (const [x, z] of candidates) {
      // The region border is a blend band; fading a layer out across it stops Vellenwood's canopy
      // from stopping dead on a straight line at x = 110.
      const belonging = scene.regionWeightAt(regionId, x, z);
      if (belonging < 0.5 && rng.next() > belonging * 2) {
        result.rejected += 1;
        continue;
      }
      if (exclusions.blocks(x, z, clearance)) {
        result.rejected += 1;
        continue;
      }
      if (scene.slopeAt(x, z) > slopeMax) {
        result.rejected += 1;
        continue;
      }

      const height = scene.heightAtXZ(x, z);
      if (layer.heightRange && (height < layer.heightRange[0] || height > layer.heightRange[1])) {
        result.rejected += 1;
        continue;
      }
      if (patchiness > 0) {
        const density = 1 - patchiness + patchiness * (mask(x / patchScale, z / patchScale) * 0.5 + 0.5);
        if (rng.next() > density) {
          result.rejected += 1;
          continue;
        }
      }

      const assetId = ids[Math.floor(rng.next() * ids.length)]!;
      const bucket = buckets.get(assetId) ?? [];
      bucket.push({
        position: [x, height - sink, z],
        rotationY: rng.next() * Math.PI * 2,
        scale: layer.scale[0] + rng.next() * (layer.scale[1] - layer.scale[0]),
      });
      buckets.set(assetId, bucket);
      result.placed += 1;
      result.byLayer[layer.id] = (result.byLayer[layer.id] ?? 0) + 1;
    }

    for (const [assetId, placements] of buckets) {
      const meshes = scene.scatterInstanced(
        assets.instance(assetId),
        placements,
        `scatter-${regionId}-${assetId}`,
        { regionId, castShadow: layer.castShadow ?? false },
      );
      result.instancedMeshes += meshes.length;
      result.estimatedDrawCalls += meshes.length * (layer.castShadow ? 2 : 1);
      for (const mesh of meshes) {
        const indices = mesh.geometry.getIndex();
        const positions = mesh.geometry.getAttribute("position");
        const triangles = Math.round((indices?.count ?? positions?.count ?? 0) / 3);
        result.estimatedTriangles += triangles * mesh.count * (layer.castShadow ? 2 : 1);
      }
    }
  }

  return result;
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

// --------------------------------------------------------- region presets

/**
 * Per-region density and species mix.
 *
 * Every id below is picked by hand off a triangle census of the nature kit, not by tag lookup,
 * because the manifest tag order happens to select the *most* expensive member of each family.
 * Measured, per source asset, trunk and foliage primitives summed:
 *
 * ```text
 *   tree_twisted_1..5   9134 - 10104     tree_dead_1..5      5648 - 6557
 *   tree_common_1..5    3182 -  6265     tree_pine_1..5      1646 - 4964
 *   bush/fern/plant       48 -   1368    grass/clover/flower   155 - 1690
 *   pebble/rock_small     48 -    124    boulder/cliff         288 - 1664
 * ```
 *
 * Two facts drive every number here (architecture.md, correction R6):
 *
 *  1. **Draw calls are flat in instance count.** One region-wide `InstancedMesh` costs one draw
 *     whether it holds 20 trees or 2000. Draw calls are set by *variant count*: assets per layer,
 *     times primitives per asset (2 for every tree in this kit, trunk plus foliage), times 2 again
 *     for a shadow caster. The way to buy draw calls back is to cut variants and shadow casters.
 *     Cutting density buys none.
 *  2. **Triangles are linear in instance count and in per-asset cost.** Those same region-wide
 *     bounding spheres mean nothing is ever frustum-culled, so the whole streamed-in region is
 *     submitted every frame. The only levers are count and species.
 *
 * Round 1 measured 803 draw calls and 12.5M triangles at `gravelmaw_entrance` against a 400-call
 * budget. Scatter's share was 129 calls and up to ~8.6M triangles (two regions streamed in). This
 * pass takes scatter to 62 calls and 4.8M triangles world-wide, 3.6M for the worst region pair.
 *
 * A note on `spacing`: `poissonDisc` widens its radius to `sqrt(area * 0.66 / maxCount)` whenever
 * that exceeds `spacing`, so on a 92,000 m^2 region any `spacing` below ~17 m is a floor that never
 * binds for a 200-count layer. Treat `maxCount` as the density control and `spacing` as the
 * anti-interpenetration minimum.
 *
 *  Fallowmarch  sparse, long sightlines (PRD, "Look"). Backdrop trees only; choppable trees are
 *               entities, not scatter.
 *  Vellenwood   deep green woodland. Enclosure comes from scale and clumping, not prop count.
 *  Karrowmoor   rock and scrub. Very large props, very few of them, big empty slate.
 */
export const DEFAULT_SCATTER: Record<RegionId, RegionScatterSpec> = {
  fallowmarch: {
    regionId: "fallowmarch",
    layers: [
      {
        // The two cheapest green broadleaves in the kit (3182 and 3505 tris). tree_common_1 and _2
        // are near twice that for no readable difference at a 20 m camera distance, and the old
        // tag lookup picked exactly those two.
        id: "copse", assetIds: ["tree_common_5", "tree_common_3"], maxVariants: 2,
        spacing: 13, maxCount: 90, scale: [0.95, 1.5], clearance: 5,
        slopeMax: 0.6, castShadow: true, patchiness: 0.85, patchScale: 95,
      },
      {
        // Bare silhouettes against the sky. One variant: 12 of them over 96,000 m^2 never repeat
        // inside a frame, and a second variant would cost 2 more draw calls for nothing.
        id: "deadwood", assetIds: ["tree_dead_5"], maxVariants: 1,
        spacing: 45, maxCount: 12, scale: [0.9, 1.35], clearance: 5, castShadow: true,
      },
      {
        // bush_flowering is 1368 tris across 2 primitives against bush_common's 900 across 1.
        // Dropping it halves this layer's draw cost; `bloom` already supplies the flower colour.
        id: "bracken", assetIds: ["bush_common"], maxVariants: 1,
        spacing: 11, maxCount: 140, scale: [0.7, 1.25], clearance: 3, patchiness: 0.5, patchScale: 55,
      },
      {
        // Deliberately NOT rock_medium_*: those are the ore-node meshes. Dressing that shares a
        // silhouette with a minable node is half of why ore is unreadable (critique finding 4).
        // Pebbles and rock_small are also 3x cheaper, so the count can stay up.
        id: "stones", assetIds: ["pebble_round_1", "pebble_round_2", "rock_small_1"], maxVariants: 3,
        spacing: 13, maxCount: 130, scale: [0.4, 0.95], clearance: 3, sink: 0.25, patchiness: 0.6,
      },
      {
        // The cheap layer that carries the density: 240 tris a clump. The wispy variants are 2-3x
        // the cost and read the same at grazing angles, so the two `common` meshes do the work.
        id: "tussock", assetIds: ["grass_common_short", "grass_common_tall"], maxVariants: 2,
        spacing: 3.4, maxCount: 800, scale: [0.8, 1.5], clearance: 1.5, patchiness: 0.55, patchScale: 34,
      },
      {
        // Colour accents only. Heavily patched so they read as drifts rather than as a lawn.
        id: "bloom", assetIds: ["clover_1", "flower_a_group"], maxVariants: 2,
        spacing: 7, maxCount: 240, scale: [0.7, 1.2], clearance: 1.5, patchiness: 0.8, patchScale: 26,
      },
    ],
  },

  vellenwood: {
    regionId: "vellenwood",
    layers: [
      {
        // Critique finding 5. The dominant layer used to be the `twisted` family, which is an
        // autumn tree in the source texture: a wood built from it renders crimson and black, and a
        // 0.25-strength retint cannot move a dark red albedo. The dominant canopy is now green
        // broadleaf, and it is also the cheapest green broadleaf: 3344 tris average against the
        // twisted family's 9596, a 65% cut per tree before a single tree is removed.
        //
        // Scale runs high and patchiness is moderate over a large feature size. Enclosure is bought
        // with canopy height and with dense stands separated by real clearings, which is also where
        // the PRD's "shafted light against canopy shadow" value contrast comes from. Raw prop count
        // buys uniform gloom instead, and uniform gloom is what round 1 shipped.
        id: "canopy", assetIds: ["tree_common_3", "tree_common_5"], maxVariants: 2,
        spacing: 11, maxCount: 200, scale: [1.05, 1.75], clearance: 6,
        slopeMax: 0.75, castShadow: true, patchiness: 0.4, patchScale: 85,
      },
      {
        // tree_pine_5 is 1646 tris, the cheapest tree in the kit by a factor of two, so conifers
        // can carry count where broadleaves cannot. One variant: a stand of a single conifer
        // species is what real conifers look like, and it saves 4 draw calls. Tall and dark, which
        // is the other half of the value contrast.
        id: "conifer", assetIds: ["tree_pine_5"], maxVariants: 1,
        spacing: 13, maxCount: 140, scale: [1.0, 1.9], clearance: 5,
        slopeMax: 0.8, castShadow: true, patchiness: 0.55, patchScale: 70,
      },
      {
        // The red tree survives as an accent, not as the wood. Twenty across 92,000 m^2 is a
        // handful per frame: a few autumn crowns in a green wood is deliberate art direction, and
        // at 9134 tris each that is 0.37M triangles instead of 1.63M. Scaled up hard so each one
        // reads as an individual worth walking towards.
        id: "duskoak", assetIds: ["tree_twisted_2"], maxVariants: 1,
        spacing: 40, maxCount: 20, scale: [1.35, 2.15], clearance: 8,
        slopeMax: 0.7, castShadow: true, patchiness: 0.3, patchScale: 130,
      },
      {
        // PRD: "ground clutter kept low so pathing stays legible". Count is down from 780 and the
        // clearance is up, so road corridors read as walkable rather than as a gap in the ferns.
        //
        // `bush_common` is deliberately absent even though it is the cheapest volume in the kit.
        // It shares the `Leaves_TwistedTree` material with the autumn tree, and sampling its
        // texture gives a mean of rgb(105,79,84) — red-dominant. At 360 instances on a 5.5 m
        // spacing that put a crimson mass at eye height across the whole wood, which is what kept
        // Vellenwood red after the canopy was already fixed to green broadleaf. `plant_broad_large`
        // uses the shared green `Leaves` texture, mean rgb(94,118,81), for the same silhouette.
        // It stays in Fallowmarch, where dry red bracken on a frontier plain is the right read.
        id: "undergrowth", assetIds: ["fern_1", "plant_leafy_large", "plant_broad_large"], maxVariants: 3,
        spacing: 5.5, maxCount: 360, scale: [0.8, 1.5], clearance: 3.2, patchiness: 0.5, patchScale: 40,
      },
      {
        // mushroom_bracket is 3216 triangles, more than a whole tree_common_5, for a prop the
        // player only ever sees from four metres. Dropped outright; mushroom_common is 880.
        id: "fungus", assetIds: ["mushroom_common"], maxVariants: 1,
        spacing: 13, maxCount: 70, scale: [0.7, 1.4], clearance: 2, patchiness: 0.85, patchScale: 30,
      },
      {
        // Pebbles again rather than rock_medium_*, to keep ore nodes distinguishable.
        id: "mossrock", assetIds: ["pebble_round_1", "pebble_round_2"], maxVariants: 2,
        spacing: 20, maxCount: 55, scale: [0.5, 1.1], clearance: 3, sink: 0.35,
      },
      {
        // Kept moderate. Grass is cheap, but a wall-to-wall forest floor is what stops a path from
        // reading as a path.
        id: "floor", assetIds: ["grass_common_short", "grass_wispy_short"], maxVariants: 2,
        spacing: 4.6, maxCount: 480, scale: [0.7, 1.3], clearance: 2, patchiness: 0.6, patchScale: 30,
      },
    ],
  },

  karrowmoor: {
    regionId: "karrowmoor",
    layers: [
      {
        // cliff_step_2 (1664 tris) and cliff_step_1 (864) cost five times boulder_medium for the
        // same read at this scale, and the terrain itself already does the terracing. cliff_tall is
        // 288 tris and is the vertical silhouette the terraces shot needs.
        id: "crags", assetIds: ["boulder_large", "boulder_medium", "cliff_tall"], maxVariants: 3,
        spacing: 24, maxCount: 70, scale: [0.8, 1.8], clearance: 8,
        castShadow: true, sink: 0.6, patchiness: 0.4, patchScale: 90,
      },
      {
        // Same cheapest-pine argument as Vellenwood. Wind-stunted here, so the scale band is low.
        id: "cairnpine", assetIds: ["tree_pine_5"], maxVariants: 1,
        spacing: 17, maxCount: 120, scale: [0.75, 1.2], clearance: 5,
        slopeMax: 0.62, castShadow: true, patchiness: 0.75, patchScale: 80,
      },
      {
        id: "windfall", assetIds: ["tree_dead_5"], maxVariants: 1,
        spacing: 40, maxCount: 16, scale: [0.7, 1.05], clearance: 4, castShadow: true,
      },
      {
        // Scree wants to be dense to read as scree, and at ~98 tris a stone it can be: 340 of them
        // cost 33k triangles, less than five broadleaf trees.
        id: "scree",
        assetIds: ["pebble_round_1", "pebble_round_2", "rock_small_1", "rock_small_2"],
        maxVariants: 4,
        spacing: 7, maxCount: 340, scale: [0.35, 1.1], clearance: 2, sink: 0.3, patchiness: 0.35,
      },
      {
        id: "scrub", assetIds: ["bush_common"], maxVariants: 1,
        spacing: 8, maxCount: 220, scale: [0.6, 1.0], clearance: 2, patchiness: 0.7, patchScale: 45,
      },
      {
        id: "moorgrass", assetIds: ["grass_common_short", "grass_wispy_short"], maxVariants: 2,
        spacing: 5.5, maxCount: 440, scale: [0.6, 1.1], clearance: 1.5, patchiness: 0.65, patchScale: 40,
      },
    ],
  },

  // Underground. Dressed by hand from the dungeon kit in a later round; scattering rubble in a
  // corridor produces nonsense.
  gravelmaw: { regionId: "gravelmaw", layers: [] },
};
