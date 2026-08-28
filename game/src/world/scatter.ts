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
  /** Cap on distinct meshes used, which is a direct cap on draw calls. */
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

/** Resolves the asset ids a layer will actually use, capped so draw calls stay predictable. */
function resolveAssets(assets: AssetRegistry, layer: ScatterLayerSpec): string[] {
  const limit = layer.maxVariants ?? 4;
  if (layer.assetIds && layer.assetIds.length > 0) {
    return layer.assetIds.filter((id) => assets.entry(id) !== undefined).slice(0, limit);
  }
  if (!layer.tags || layer.tags.length === 0) return [];
  return assets.byTags(...layer.tags).map((entry) => entry.id).slice(0, limit);
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
    byLayer: {},
    missingAssets: [],
  };
  if (!rect) return result;

  for (const layer of spec.layers) {
    const ids = resolveAssets(assets, layer);
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
 * Per-region density and species mix. The counts come off the measured triangle budget:
 * `tree_twisted_*` is ~9.7k triangles, `tree_common_*` 3.2-6.3k, `tree_pine_*` 1.6-5k, ground
 * cover 50-700. So the expensive silhouettes are rationed and the cheap ones carry the density.
 *
 *  Fallowmarch  sparse, long sightlines, roughly one prop per 40 m^2 (PRD, "Look").
 *  Vellenwood   dense canopy, enclosed. The worst-case view for the draw-call budget.
 *  Karrowmoor   rock and scrub. Very large props, very few of them, big empty slate.
 */
export const DEFAULT_SCATTER: Record<RegionId, RegionScatterSpec> = {
  fallowmarch: {
    regionId: "fallowmarch",
    layers: [
      {
        id: "copse", tags: ["tree", "broadleaf"], maxVariants: 4,
        spacing: 13, maxCount: 110, scale: [0.85, 1.3], clearance: 5,
        slopeMax: 0.6, castShadow: true, patchiness: 0.85, patchScale: 95,
      },
      {
        id: "deadwood", tags: ["tree", "dead"], maxVariants: 2,
        spacing: 45, maxCount: 14, scale: [0.9, 1.25], clearance: 5, castShadow: true,
      },
      {
        id: "bracken", tags: ["bush"], maxVariants: 2,
        spacing: 11, maxCount: 170, scale: [0.7, 1.2], clearance: 3, patchiness: 0.5, patchScale: 55,
      },
      {
        id: "stones", tags: ["rock", "stone"], maxVariants: 4,
        spacing: 13, maxCount: 130, scale: [0.4, 0.95], clearance: 3, sink: 0.25, patchiness: 0.6,
      },
      {
        id: "tussock", tags: ["grass"], maxVariants: 4,
        spacing: 3.4, maxCount: 1300, scale: [0.8, 1.5], clearance: 1.5, patchiness: 0.55, patchScale: 34,
      },
      {
        id: "bloom", tags: ["ground-cover", "plains"], maxVariants: 4,
        spacing: 7, maxCount: 380, scale: [0.7, 1.2], clearance: 1.5, patchiness: 0.8, patchScale: 26,
      },
    ],
  },

  vellenwood: {
    regionId: "vellenwood",
    layers: [
      {
        id: "duskoak", tags: ["tree", "twisted"], maxVariants: 3,
        spacing: 18, maxCount: 85, scale: [1.15, 1.75], clearance: 7,
        slopeMax: 0.7, castShadow: true, patchiness: 0.35, patchScale: 120,
      },
      {
        id: "canopy", tags: ["tree", "common"], maxVariants: 4,
        spacing: 10, maxCount: 300, scale: [0.9, 1.45], clearance: 5,
        slopeMax: 0.75, castShadow: true, patchiness: 0.45, patchScale: 70,
      },
      {
        id: "conifer", tags: ["tree", "pine"], maxVariants: 3,
        spacing: 14, maxCount: 120, scale: [0.85, 1.3], clearance: 5, castShadow: true, patchiness: 0.7,
      },
      {
        id: "undergrowth", tags: ["undergrowth"], maxVariants: 4,
        spacing: 4.4, maxCount: 780, scale: [0.8, 1.5], clearance: 2.5, patchiness: 0.45, patchScale: 40,
      },
      {
        id: "fungus", tags: ["mushroom"], maxVariants: 2,
        spacing: 13, maxCount: 110, scale: [0.7, 1.3], clearance: 2, patchiness: 0.85, patchScale: 30,
      },
      {
        id: "mossrock", tags: ["rock", "stone"], maxVariants: 3,
        spacing: 20, maxCount: 65, scale: [0.5, 1.1], clearance: 3, sink: 0.35,
      },
      {
        id: "floor", tags: ["grass"], maxVariants: 3,
        spacing: 4.2, maxCount: 900, scale: [0.7, 1.3], clearance: 1.5, patchiness: 0.6, patchScale: 30,
      },
    ],
  },

  karrowmoor: {
    regionId: "karrowmoor",
    layers: [
      {
        id: "crags", tags: ["cliff"], maxVariants: 4,
        spacing: 24, maxCount: 85, scale: [0.7, 1.5], clearance: 8,
        castShadow: true, sink: 0.6, patchiness: 0.4, patchScale: 90,
      },
      {
        id: "cairnpine", tags: ["tree", "pine"], maxVariants: 4,
        spacing: 17, maxCount: 130, scale: [0.75, 1.15], clearance: 5,
        slopeMax: 0.62, castShadow: true, patchiness: 0.75, patchScale: 80,
      },
      {
        id: "windfall", tags: ["tree", "dead"], maxVariants: 2,
        spacing: 40, maxCount: 22, scale: [0.7, 1.0], clearance: 4, castShadow: true,
      },
      {
        id: "scree", tags: ["rock", "stone"], maxVariants: 4,
        spacing: 7, maxCount: 420, scale: [0.35, 1.1], clearance: 2, sink: 0.3, patchiness: 0.35,
      },
      {
        id: "scrub", tags: ["undergrowth"], maxVariants: 3,
        spacing: 8, maxCount: 300, scale: [0.6, 1.0], clearance: 2, patchiness: 0.7, patchScale: 45,
      },
      {
        id: "moorgrass", tags: ["grass", "ground-cover"], maxVariants: 3,
        spacing: 5.5, maxCount: 620, scale: [0.6, 1.1], clearance: 1.5, patchiness: 0.65, patchScale: 40,
      },
    ],
  },

  // Underground. Dressed by hand from the dungeon kit in a later round; scattering rubble in a
  // corridor produces nonsense.
  gravelmaw: { regionId: "gravelmaw", layers: [] },
};
