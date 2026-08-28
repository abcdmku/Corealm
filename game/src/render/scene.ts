/**
 * Scene composition: the walkable world surface, roads, water, scatter hosting, and the player view.
 *
 * Round 1 turns the round-0 single square into THREE connected regions in ONE coordinate system.
 * The important structural decision: there is a single continuous height function over the whole
 * world, and region identity is a weight on that function rather than a separate mesh per region.
 * Regions therefore cannot have a seam or a navmesh gap by construction — a seam would need two
 * height functions disagreeing at a border, and there is only one.
 *
 *   h(x,z) = SUM_i w_i(x,z) * h_i(x,z) / SUM_i w_i(x,z)
 *
 * `w_i` is a smoothstep of the signed distance into region i's rect, so two neighbouring regions
 * cross over at exactly 0.5 each on their shared border. Ground colour blends with the same
 * weights, which is why one vertex-coloured material covers all three region palettes.
 *
 * This file owns no gameplay state. It reads geometry parameters and draws.
 */
import * as THREE from "three";
import type { RegionId, Vec3 } from "../contracts.js";
import { MaterialLibrary, REGION_PALETTES, roadColour } from "./materials.js";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../app/config.js";
import { Rng } from "../core/rng.js";
import { clamp } from "../core/math.js";

// ----------------------------------------------------------------- specs

/** Round-0 shape. Still supported: the boot sequence and tests call it. */
export interface TerrainSpec {
  regionId: RegionId;
  /** Metres. The terrain is a square centred on `centre`. */
  size: number;
  centre: [number, number];
  segments: number;
  /** Peak vertical displacement in metres. */
  amplitude: number;
  seed: number;
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * How a region's ground behaves. Character is what makes the three regions feel authored rather
 * than "the same noise with a different colour".
 */
export type RegionCharacter = "plains" | "woodland" | "highlands" | "cavern";

export interface RegionTerrainSpec {
  regionId: RegionId;
  /** Region rects must tile the world with no gaps; blending happens across shared borders. */
  rect: Rect;
  seed: number;
  character: RegionCharacter;
  /** Vertical offset of the region's floor, in metres. */
  baseHeight: number;
  /** Peak displacement of the region's own relief, in metres. */
  amplitude: number;
  /**
   * Which way "uphill" runs for terraced characters, and from which end.
   *
   * The canonical region data in `content/regions.ts` authors Karrowmoor's terraces as z-bands
   * climbing toward -z, so the axis cannot be hardcoded to x. `"-z"` means the low end is at
   * `rect.maxZ` and the ridge is at `rect.minZ`.
   */
  terraceAxis?: "+x" | "-x" | "+z" | "-z";
  /** Number of terrace steps. Defaults to 4. */
  terraceSteps?: number;
}

/** A flattened pad. Settlements need buildable ground; noise does not provide it. */
export interface FlatSpot {
  x: number;
  z: number;
  /** Fully flat inside this radius. */
  radius: number;
  /** Metres of falloff outside the radius. */
  blend: number;
  /** Explicit height. Defaults to the natural height at the centre. */
  height?: number;
}

export interface WorldTerrainSpec {
  bounds: Rect;
  /** One draw call per chunk. 100 m over a 700x400 world is 28 chunks. */
  chunkSize: number;
  /** Terrain grid resolution. 2 m keeps the whole world under 150k triangles. */
  metresPerQuad: number;
  /** Half-width of the cross-region blend band, in metres. */
  blendMetres: number;
  regions: RegionTerrainSpec[];
  flats?: FlatSpot[];
}

/**
 * THE Corealm region layout. One coordinate system, 700 m x 400 m, three vertical bands running
 * west to east in ascending tier order, so the whole route Fallowmarch -> Vellenwood -> Karrowmoor
 * is one continuous walk with no loading and no teleport.
 *
 *   Fallowmarch  x -360 .. -120   (240 x 400)   centre (-240, 0)   floor  0 m
 *   Vellenwood   x -120 .. +110   (230 x 400)   centre   (-5, 0)   floor +4 m
 *   Karrowmoor   x +110 .. +340   (230 x 400)   centre (+225, 0)   floor +6 m, rising to +42 m
 *
 * Seams: x = -120 (Fallowmarch/Vellenwood) and x = +110 (Vellenwood/Karrowmoor).
 */
export const COREALM_WORLD: WorldTerrainSpec = {
  bounds: { minX: -360, maxX: 340, minZ: -200, maxZ: 200 },
  chunkSize: 100,
  metresPerQuad: 2,
  blendMetres: 45,
  regions: [
    {
      regionId: "fallowmarch",
      rect: { minX: -360, maxX: -120, minZ: -200, maxZ: 200 },
      seed: 0x0f4110,
      character: "plains",
      baseHeight: 0,
      amplitude: 15,
    },
    {
      regionId: "vellenwood",
      rect: { minX: -120, maxX: 110, minZ: -200, maxZ: 200 },
      seed: 0x0e11e2,
      character: "woodland",
      baseHeight: 4,
      amplitude: 22,
    },
    {
      regionId: "karrowmoor",
      rect: { minX: 110, maxX: 340, minZ: -200, maxZ: 200 },
      seed: 0x4a2200,
      character: "highlands",
      baseHeight: 6,
      amplitude: 36,
    },
  ],
};

// ----------------------------------------------------------------- noise

/**
 * Deterministic value noise. Seeded so terrain is identical across reloads and test runs.
 * Exported because the scatter system masks off the same noise family.
 */
export function createValueNoise(seed: number): (x: number, z: number) => number {
  const rng = new Rng(seed);
  const permutation = new Uint8Array(512);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) source[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const swap = source[i]!;
    source[i] = source[j]!;
    source[j] = swap;
  }
  for (let i = 0; i < 512; i += 1) permutation[i] = source[i & 255]!;

  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  const grad = (hash: number, x: number, z: number): number => {
    const h = hash & 3;
    const u = h < 2 ? x : z;
    const v = h < 2 ? z : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  return (x: number, z: number): number => {
    const xi = Math.floor(x) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(zf);
    const aa = permutation[permutation[xi]! + zi]!;
    const ab = permutation[permutation[xi]! + zi + 1]!;
    const ba = permutation[permutation[xi + 1]! + zi]!;
    const bb = permutation[permutation[xi + 1]! + zi + 1]!;
    return mix(
      mix(grad(aa, xf, zf), grad(ba, xf - 1, zf), u),
      mix(grad(ab, xf, zf - 1), grad(bb, xf - 1, zf - 1), u),
      v,
    );
  };
}

type Noise2D = (x: number, z: number) => number;

/** Fractal sum. Returns roughly -1..1. */
function fbm(noise: Noise2D, x: number, z: number, octaves: number, featureSize: number): number {
  let total = 0;
  let amplitude = 1;
  let normaliser = 0;
  let frequency = 1 / featureSize;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise(x * frequency, z * frequency) * amplitude;
    normaliser += amplitude;
    amplitude *= 0.48;
    frequency *= 2.07;
  }
  return total / normaliser;
}

function smoothstep01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Positive inside the rect, negative outside, in metres. */
function signedDepth(rect: Rect, x: number, z: number): number {
  const qx = Math.max(rect.minX - x, x - rect.maxX);
  const qz = Math.max(rect.minZ - z, z - rect.maxZ);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, qz), 0);
  return -(outside + inside);
}

/**
 * Soft terrace. `riserFraction` of each band is the climb, the rest is flat. Keeping the riser
 * wide is what makes Karrowmoor's verticality survive navmesh generation: a hard step would be a
 * vertical wall and Detour would drop the terrace above it out of the connected mesh.
 */
function terrace(t: number, riserFraction: number): number {
  const index = Math.floor(t);
  const f = t - index;
  const flat = 1 - riserFraction;
  if (f <= flat) return index;
  return index + smoothstep01((f - flat) / riserFraction);
}

// ------------------------------------------------------------- the scene

interface RegionField {
  spec: RegionTerrainSpec;
  height: (x: number, z: number) => number;
  palette: (typeof REGION_PALETTES)[RegionId];
}

export interface RegionLayout {
  regionId: RegionId;
  rect: Rect;
  centre: [number, number];
  character: RegionCharacter;
}

export interface HeightfieldSamples {
  /** Rapier wants (nrows+1) x (ncols+1) heights in COLUMN-major order. */
  heights: Float32Array;
  nrows: number;
  ncols: number;
  /** Total world extents the field covers. */
  scale: { x: number; y: number; z: number };
  /** Field centre in world space. */
  centre: { x: number; y: number; z: number };
}

export class WorldScene {
  readonly root = new THREE.Group();
  readonly terrainGroup = new THREE.Group();
  readonly scatterGroup = new THREE.Group();
  readonly entityGroup = new THREE.Group();
  readonly overlayGroup = new THREE.Group();

  readonly materials = new MaterialLibrary();

  /** The meshes recast builds the navmesh from. Ground only — never scatter, never props. */
  private walkable: THREE.Mesh[] = [];
  private fields: RegionField[] = [];
  private flats: FlatSpot[] = [];
  private world: WorldTerrainSpec | null = null;
  /** Round-0 fallback for single-region builds. */
  private legacySamplers = new Map<RegionId, (x: number, z: number) => number>();
  private scatterByRegion = new Map<RegionId, THREE.Object3D[]>();

  playerMesh: THREE.Object3D | null = null;
  private playerTarget = new THREE.Vector3();
  private playerFacing = 0;
  private lastSyncMs = 0;

  constructor(parent: THREE.Scene) {
    this.root.name = "corealm-world";
    // The input layer raycasts the object named "terrain" for click-to-move, so this group holds
    // ground and nothing else. Trees living in here would make every canopy click a move order.
    this.terrainGroup.name = "terrain";
    this.scatterGroup.name = "scatter";
    this.entityGroup.name = "entities";
    this.overlayGroup.name = "overlays";
    this.root.add(this.terrainGroup, this.scatterGroup, this.entityGroup, this.overlayGroup);
    parent.add(this.root);
  }

  // ------------------------------------------------------------ building

  /**
   * Builds the whole three-region world as one continuous surface, chunked for frustum culling.
   *
   * Returns the chunk meshes. They are already in the scene and already registered as walkable, so
   * the caller can hand them straight to `Navigation.build` and `Physics`.
   */
  buildWorld(spec: WorldTerrainSpec = COREALM_WORLD): THREE.Mesh[] {
    this.world = spec;
    // Flats registered through `addFlatSpot` before the build are kept: settlement pads are
    // registered by whoever knows where the settlement is, which is not this file.
    this.flats = [...this.flats, ...(spec.flats ?? [])].map((flat) => ({ ...flat }));
    this.fields = spec.regions.map((region) => ({
      spec: region,
      height: makeRegionField(region),
      palette: REGION_PALETTES[region.regionId],
    }));

    this.resolveFlatTargets();
    this.normaliseFlats();

    const { bounds, chunkSize } = spec;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const cols = Math.max(1, Math.round(width / chunkSize));
    const rows = Math.max(1, Math.round(depth / chunkSize));
    const chunkX = width / cols;
    const chunkZ = depth / rows;
    const segmentsX = Math.max(1, Math.round(chunkX / spec.metresPerQuad));
    const segmentsZ = Math.max(1, Math.round(chunkZ / spec.metresPerQuad));

    const material = this.materials.ground();
    const created: THREE.Mesh[] = [];

    for (let cz = 0; cz < rows; cz += 1) {
      for (let cx = 0; cx < cols; cx += 1) {
        const originX = bounds.minX + cx * chunkX;
        const originZ = bounds.minZ + cz * chunkZ;
        const mesh = this.buildChunk(originX, originZ, chunkX, chunkZ, segmentsX, segmentsZ, material);
        mesh.name = `terrain-chunk-${cx}-${cz}`;
        mesh.userData.walkable = true;
        mesh.userData.regionId = this.regionAt(originX + chunkX / 2, originZ + chunkZ / 2);
        this.terrainGroup.add(mesh);
        this.walkable.push(mesh);
        created.push(mesh);
      }
    }
    return created;
  }

  /**
   * Round-0 compatible single-region terrain. Kept because the boot sequence and the smoke test
   * call it; it now routes through the same field machinery so `heightAt` behaves identically
   * whichever entry point built the ground.
   */
  buildTerrain(spec: TerrainSpec): THREE.Mesh {
    const rect: Rect = {
      minX: spec.centre[0] - spec.size / 2,
      maxX: spec.centre[0] + spec.size / 2,
      minZ: spec.centre[1] - spec.size / 2,
      maxZ: spec.centre[1] + spec.size / 2,
    };
    const region: RegionTerrainSpec = {
      regionId: spec.regionId,
      rect,
      seed: spec.seed,
      character: characterFor(spec.regionId),
      baseHeight: 0,
      amplitude: spec.amplitude,
    };
    const field = makeRegionField(region);
    this.fields.push({ spec: region, height: field, palette: REGION_PALETTES[spec.regionId] });
    this.legacySamplers.set(spec.regionId, field);
    if (!this.world) {
      this.world = {
        bounds: rect,
        chunkSize: spec.size,
        metresPerQuad: spec.size / spec.segments,
        blendMetres: 45,
        regions: [region],
      };
    }

    const mesh = this.buildChunk(
      rect.minX, rect.minZ, spec.size, spec.size, spec.segments, spec.segments, this.materials.ground(),
    );
    mesh.name = `terrain-${spec.regionId}`;
    mesh.userData.regionId = spec.regionId;
    mesh.userData.walkable = true;
    this.terrainGroup.add(mesh);
    this.walkable.push(mesh);
    return mesh;
  }

  private buildChunk(
    originX: number,
    originZ: number,
    sizeX: number,
    sizeZ: number,
    segmentsX: number,
    segmentsZ: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(sizeX, sizeZ, segmentsX, segmentsZ);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colours = new Float32Array(position.count * 3);
    const centreX = originX + sizeX / 2;
    const centreZ = originZ + sizeZ / 2;
    const step = Math.max(0.5, Math.min(sizeX / segmentsX, sizeZ / segmentsZ));
    const colour = new THREE.Color();

    for (let i = 0; i < position.count; i += 1) {
      const worldX = position.getX(i) + centreX;
      const worldZ = position.getZ(i) + centreZ;
      const height = this.heightAtXZ(worldX, worldZ);
      position.setY(i, height);

      // Central-difference slope, used to expose rock on steep faces. Two extra samples per vertex
      // is cheaper than reconstructing normals afterwards and it matches across chunk borders.
      const dx = (this.heightAtXZ(worldX + step, worldZ) - this.heightAtXZ(worldX - step, worldZ)) / (2 * step);
      const dz = (this.heightAtXZ(worldX, worldZ + step) - this.heightAtXZ(worldX, worldZ - step)) / (2 * step);
      const slope = Math.hypot(dx, dz);

      this.groundColourAt(worldX, worldZ, height, slope, colour);
      colours[i * 3] = colour.r;
      colours[i * 3 + 1] = colour.g;
      colours[i * 3 + 2] = colour.b;
    }
    position.needsUpdate = true;
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centreX, 0, centreZ);
    mesh.receiveShadow = true;
    // Terrain never casts. It would double every terrain draw call in the shadow pass and the
    // relief is gentle enough that self-shadowing buys nothing.
    mesh.castShadow = false;
    return mesh;
  }

  /**
   * Widens each pad's falloff until its collar is walkable.
   *
   * A 7 m pad with a 9 m falloff on a Karrowmoor terrace riser cuts a mesa with 60-degree sides:
   * recast drops the sides, and the location on top becomes an island the player can path to but
   * not reach. Measured against the authored region data, this is where most of the world's
   * unwalkable ground came from. So each pad's falloff is expanded to whatever the local height
   * difference actually needs, capped at 4x so a pad on a cliff edge does not flatten a region.
   */
  /**
   * Pins each pad's target height, in order, against the pads already applied under it.
   *
   * Pads nest: a settlement gets a wide one and every named location inside it — the bank counter,
   * the gate, the square — gets a 7 m one of its own. Left unresolved, each pad targets the
   * NATURAL height at its own centre, so a location pad sitting inside a flattened settlement
   * pulled the raw hillside back up through the middle of the town. Highcairn's huts stood on
   * ground that moved 1.3 m across a six-metre footprint because of it, and a building is
   * assembled level: that 1.3 m came out as a corner in the air and a wall through the grass.
   *
   * Resolving in order makes an inner pad adopt the height of the pad it stands on, so its own
   * blend runs between two equal values and changes nothing. Pads that carry an explicit height —
   * the fishing basins — are left alone; theirs is the point.
   */
  private resolveFlatTargets(): void {
    for (let index = 0; index < this.flats.length; index += 1) {
      const flat = this.flats[index];
      if (!flat || flat.height !== undefined) continue;
      flat.height = this.applyFlats(flat.x, flat.z, this.naturalHeight(flat.x, flat.z), index);
    }
  }

  private normaliseFlats(): void {
    const maxGradient = 0.6; // about 31 degrees, comfortably inside the 48-degree walkable limit
    for (const flat of this.flats) {
      const centre = flat.height ?? this.naturalHeight(flat.x, flat.z);
      let drop = 0;
      const ring = flat.radius + flat.blend;
      for (let step = 0; step < 8; step += 1) {
        const angle = (step / 8) * Math.PI * 2;
        const sample = this.naturalHeight(flat.x + Math.cos(angle) * ring, flat.z + Math.sin(angle) * ring);
        drop = Math.max(drop, Math.abs(sample - centre));
      }
      flat.blend = Math.min(flat.blend * 4, Math.max(flat.blend, drop / maxGradient));
    }
  }

  /** Adds a flattened building pad. Call before `buildWorld`; it changes the ground. */
  addFlatSpot(flat: FlatSpot): void {
    this.flats.push(flat);
  }

  // ------------------------------------------------------------- queries

  /**
   * Sampled terrain height. The `regionId` argument is kept for the frozen call sites; the world
   * is one continuous field, so the answer is correct at region boundaries by construction and
   * does not depend on which region the caller thinks it is in.
   */
  heightAt(regionId: RegionId, x: number, z: number): number {
    if (this.fields.length === 0) {
      const legacy = this.legacySamplers.get(regionId);
      return legacy ? legacy(x, z) : 0;
    }
    return this.heightAtXZ(x, z);
  }

  /** Blended world height at a point, in metres. */
  heightAtXZ(x: number, z: number): number {
    return this.applyFlats(x, z, this.naturalHeight(x, z));
  }

  private naturalHeight(x: number, z: number): number {
    if (this.fields.length === 0) return 0;
    if (this.fields.length === 1) return this.fields[0]!.height(x, z);

    const blend = this.world?.blendMetres ?? 45;
    let total = 0;
    let weightSum = 0;
    let nearest = this.fields[0]!;
    let nearestDepth = -Infinity;

    for (const field of this.fields) {
      const depth = signedDepth(field.spec.rect, x, z);
      if (depth > nearestDepth) {
        nearestDepth = depth;
        nearest = field;
      }
      const weight = smoothstep01((depth + blend) / (2 * blend));
      if (weight <= 0) continue;
      total += field.height(x, z) * weight;
      weightSum += weight;
    }

    // Outside every region rect and outside every blend band. Fall back to the nearest region so
    // the surface stays defined rather than collapsing to y = 0 and tearing a cliff at the edge.
    if (weightSum <= 0) return nearest.height(x, z);
    return total / weightSum;
  }

  /**
   * Flattens `height` through every pad that reaches this point, in pad order.
   *
   * Two rules, and the second one is the load-bearing one:
   *
   *  1. Inside a pad's radius the ground IS that pad's height. Later pads may still override — a
   *     location pad inside a settlement resolves to the settlement's own height, so that override
   *     is a no-op by construction (see `resolveFlatTargets`).
   *  2. A pad's FALLOFF never disturbs ground another pad has already made flat. Without this, the
   *     fishing basins reached into the settlements: `normaliseFlats` widens a basin's blend to
   *     whatever the local drop needs, which on Karrowmoor's terraces is most of a hundred metres,
   *     and the Cairn Tarn was quietly pulling Highcairn's east side 1.3 m down toward the
   *     waterline. Buildings are assembled level, so that came out as huts with a corner in the
   *     air. Flat has to mean flat, or nothing that stands on it can be trusted.
   */
  private applyFlats(x: number, z: number, height: number, limit = this.flats.length): number {
    if (this.flats.length === 0) return height;
    let result = height;
    let cored = false;
    for (let index = 0; index < limit; index += 1) {
      const flat = this.flats[index];
      if (!flat) continue;
      const distance = Math.hypot(x - flat.x, z - flat.z);
      if (distance > flat.radius + flat.blend) continue;
      const target = flat.height ?? this.naturalHeight(flat.x, flat.z);
      if (distance <= flat.radius) {
        result = target;
        cored = true;
        continue;
      }
      if (cored) continue;
      const weight = 1 - smoothstep01((distance - flat.radius) / Math.max(0.001, flat.blend));
      result = result + (target - result) * weight;
    }
    return result;
  }

  /** Which region owns a point. The rect that contains it, or the nearest one. */
  regionAt(x: number, z: number): RegionId {
    if (this.fields.length === 0) return "fallowmarch";
    let best = this.fields[0]!;
    let bestDepth = -Infinity;
    for (const field of this.fields) {
      const depth = signedDepth(field.spec.rect, x, z);
      if (depth > bestDepth) {
        bestDepth = depth;
        best = field;
      }
    }
    return best.spec.regionId;
  }

  /** Blend weight of a region at a point, 0..1. Scatter uses it to fade species across seams. */
  regionWeightAt(regionId: RegionId, x: number, z: number): number {
    const field = this.fields.find((candidate) => candidate.spec.regionId === regionId);
    if (!field) return 0;
    const blend = this.world?.blendMetres ?? 45;
    return smoothstep01((signedDepth(field.spec.rect, x, z) + blend) / (2 * blend));
  }

  /** Terrain steepness at a point, as rise over run. 0 is flat, 1 is 45 degrees. */
  slopeAt(x: number, z: number, step = 1.5): number {
    const dx = (this.heightAtXZ(x + step, z) - this.heightAtXZ(x - step, z)) / (2 * step);
    const dz = (this.heightAtXZ(x, z + step) - this.heightAtXZ(x, z - step)) / (2 * step);
    return Math.hypot(dx, dz);
  }

  getRegionRect(regionId: RegionId): Rect | null {
    return this.fields.find((field) => field.spec.regionId === regionId)?.spec.rect ?? null;
  }

  getWorldBounds(): Rect {
    return this.world?.bounds ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }

  /** JSON-safe layout description, so the debug surface and the world builder can reconcile. */
  describeRegions(): RegionLayout[] {
    return this.fields.map((field) => ({
      regionId: field.spec.regionId,
      rect: { ...field.spec.rect },
      centre: [
        (field.spec.rect.minX + field.spec.rect.maxX) / 2,
        (field.spec.rect.minZ + field.spec.rect.maxZ) / 2,
      ] as [number, number],
      character: field.spec.character,
    }));
  }

  /** Midpoint of the border shared by two regions, snapped to the ground. Gates go here. */
  seamBetween(a: RegionId, b: RegionId): Vec3 | null {
    const rectA = this.getRegionRect(a);
    const rectB = this.getRegionRect(b);
    if (!rectA || !rectB) return null;
    const overlapZ = Math.min(rectA.maxZ, rectB.maxZ) - Math.max(rectA.minZ, rectB.minZ);
    const overlapX = Math.min(rectA.maxX, rectB.maxX) - Math.max(rectA.minX, rectB.minX);
    if (overlapZ > 0 && Math.abs(rectA.maxX - rectB.minX) < 0.01) {
      const z = (Math.max(rectA.minZ, rectB.minZ) + Math.min(rectA.maxZ, rectB.maxZ)) / 2;
      return [rectA.maxX, this.heightAtXZ(rectA.maxX, z), z];
    }
    if (overlapZ > 0 && Math.abs(rectB.maxX - rectA.minX) < 0.01) {
      const z = (Math.max(rectA.minZ, rectB.minZ) + Math.min(rectA.maxZ, rectB.maxZ)) / 2;
      return [rectA.minX, this.heightAtXZ(rectA.minX, z), z];
    }
    if (overlapX > 0 && Math.abs(rectA.maxZ - rectB.minZ) < 0.01) {
      const x = (Math.max(rectA.minX, rectB.minX) + Math.min(rectA.maxX, rectB.maxX)) / 2;
      return [x, this.heightAtXZ(x, rectA.maxZ), rectA.maxZ];
    }
    if (overlapX > 0 && Math.abs(rectB.maxZ - rectA.minZ) < 0.01) {
      const x = (Math.max(rectA.minX, rectB.minX) + Math.min(rectA.maxX, rectB.maxX)) / 2;
      return [x, this.heightAtXZ(x, rectA.minZ), rectA.minZ];
    }
    return null;
  }

  getWalkableMeshes(): THREE.Mesh[] {
    return this.walkable;
  }

  /**
   * A Rapier-ready heightfield of the whole world. Far cheaper than a 140k-triangle trimesh and it
   * gives exact ground queries. Heights are column-major, as Rapier requires.
   */
  heightfieldSamples(resolution = 2): HeightfieldSamples {
    const bounds = this.getWorldBounds();
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const ncols = Math.max(1, Math.round(width / resolution));
    const nrows = Math.max(1, Math.round(depth / resolution));
    const heights = new Float32Array((nrows + 1) * (ncols + 1));

    for (let col = 0; col <= ncols; col += 1) {
      const x = bounds.minX + (col / ncols) * width;
      for (let row = 0; row <= nrows; row += 1) {
        const z = bounds.minZ + (row / nrows) * depth;
        heights[col * (nrows + 1) + row] = this.heightAtXZ(x, z);
      }
    }

    return {
      heights,
      nrows,
      ncols,
      scale: { x: width, y: 1, z: depth },
      centre: { x: (bounds.minX + bounds.maxX) / 2, y: 0, z: (bounds.minZ + bounds.maxZ) / 2 },
    };
  }

  // -------------------------------------------------------- ground dress

  private groundColourAt(x: number, z: number, height: number, slope: number, out: THREE.Color): void {
    const blend = this.world?.blendMetres ?? 45;
    let r = 0;
    let g = 0;
    let b = 0;
    let rockR = 0;
    let rockG = 0;
    let rockB = 0;
    let weightSum = 0;

    const scratch = new THREE.Color();
    for (const field of this.fields) {
      const weight = this.fields.length === 1
        ? 1
        : smoothstep01((signedDepth(field.spec.rect, x, z) + blend) / (2 * blend));
      if (weight <= 0) continue;

      // Altitude within the region's own relief drives the low/high grass mix.
      const local = clamp(
        (height - field.spec.baseHeight) / Math.max(1, field.spec.amplitude),
        0,
        1,
      );
      scratch.setHex(field.palette.groundLow).lerp(new THREE.Color(field.palette.groundHigh), local);
      r += scratch.r * weight;
      g += scratch.g * weight;
      b += scratch.b * weight;

      scratch.setHex(field.palette.rock);
      rockR += scratch.r * weight;
      rockG += scratch.g * weight;
      rockB += scratch.b * weight;
      weightSum += weight;
    }

    if (weightSum <= 0) {
      out.setHex(REGION_PALETTES.fallowmarch.groundHigh);
      return;
    }
    out.setRGB(r / weightSum, g / weightSum, b / weightSum);
    // Slope above ~27 degrees loses its soil and shows stone. This is what makes Karrowmoor's
    // terrace risers read as rock faces without a second material or a second mesh.
    const rockAmount = smoothstep01((slope - 0.5) / 0.55);
    if (rockAmount > 0) {
      out.lerp(new THREE.Color(rockR / weightSum, rockG / weightSum, rockB / weightSum), rockAmount);
    }
  }

  /**
   * A road or worn path, drawn as a ribbon that follows the ground. Roads are NOT walkable meshes:
   * they sit on the terrain that already is one, and adding them to the navmesh input would only
   * add duplicate coplanar geometry for recast to argue with.
   */
  /**
   * A trodden track draped over the terrain, from a polyline.
   *
   * Four vertices per sample, not two: the outer pair is a skirt at zero alpha, so the track fades
   * into the grass instead of ending at a drawn line. Round 3 built it as a two-vertex ribbon
   * lifted 0.3 m, which gave every road in the world a hard edge and a visible lip. The last
   * sample at each end fades out entirely, so a route stops looking like a plank someone dropped.
   */
  buildRoad(points: readonly Vec3[], width = 4.5, regionId: RegionId = "fallowmarch"): THREE.Mesh | null {
    if (points.length < 2) return null;
    const samples = resamplePolyline(points, 3);
    const lanes = [-1, -1, 1, 1];
    const laneWidth = [ROAD_SKIRT, 1, 1, ROAD_SKIRT];
    const laneAlpha = [0, 1, 1, 0];
    const vertexCount = samples.length * 4;
    const positions = new Float32Array(vertexCount * 3);
    // RGBA, not RGB: three.js reads vertex alpha off a four-component colour attribute, and the
    // alpha is what feathers the skirt. A separate custom attribute would need a custom shader.
    const colours = new Float32Array(vertexCount * 4);
    const indices: number[] = [];
    const edge = new THREE.Color(roadColour(regionId));

    for (let i = 0; i < samples.length; i += 1) {
      const current = samples[i]!;
      const previous = samples[Math.max(0, i - 1)]!;
      const next = samples[Math.min(samples.length - 1, i + 1)]!;
      const dirX = next[0] - previous[0];
      const dirZ = next[2] - previous[2];
      const length = Math.hypot(dirX, dirZ) || 1;
      const nx = -dirZ / length;
      const nz = dirX / length;
      // Both ends taper to nothing over one sample, so a route does not end in a cut edge.
      const endFade = (i === 0 || i === samples.length - 1) ? 0 : 1;

      for (let lane = 0; lane < 4; lane += 1) {
        const index = i * 4 + lane;
        const half = (width / 2) * laneWidth[lane]!;
        const x = current[0] + nx * half * lanes[lane]!;
        const z = current[2] + nz * half * lanes[lane]!;
        positions[index * 3] = x;
        positions[index * 3 + 1] = this.heightAtXZ(x, z) + ROAD_LIFT;
        positions[index * 3 + 2] = z;
        colours[index * 4] = edge.r;
        colours[index * 4 + 1] = edge.g;
        colours[index * 4 + 2] = edge.b;
        colours[index * 4 + 3] = laneAlpha[lane]! * endFade;
      }

      if (i < samples.length - 1) {
        const base = i * 4;
        for (let lane = 0; lane < 3; lane += 1) {
          const a = base + lane;
          indices.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, this.materials.road(regionId));
    mesh.name = `road-${regionId}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 1;
    // Roads live under the scatter group, not the terrain group: click-to-move raycasts the
    // terrain group, and a road quad floating 6 cm above the ground would shift every click.
    this.scatterGroup.add(mesh);
    return mesh;
  }

  /**
   * A still water surface for a pool, tarn or brook. Not walkable, not a collider.
   *
   * A disc with a faded rim, not a rectangle. The basin under it is a circular flat spot (see
   * `flatSpotsFor`), so a rectangle was always the wrong shape: it cut four straight edges across
   * the bank and stopped dead where the pond kept going. The rim vertices fade to zero alpha and
   * sit slightly LOWER than the centre, so the waterline meets the sloping bank instead of ending
   * in a drawn line, and the shoreline is wherever the terrain rises through the surface.
   */
  buildWater(rect: Rect, level: number, regionId: RegionId): THREE.Mesh {
    const radius = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2;
    const geometry = new THREE.CircleGeometry(radius, WATER_SEGMENTS, 0, Math.PI * 2);
    geometry.rotateX(-Math.PI / 2);

    // CircleGeometry puts the hub at vertex 0 and the rim after it, so the fade is a straight walk
    // over the vertex list rather than a distance test.
    const position = geometry.getAttribute("position");
    const colours = new Float32Array(position.count * 4);
    for (let index = 0; index < position.count; index += 1) {
      const rim = index > 0;
      colours[index * 4] = 1;
      colours[index * 4 + 1] = 1;
      colours[index * 4 + 2] = 1;
      colours[index * 4 + 3] = rim ? 0 : 1;
      if (rim) position.setY(index, -WATER_RIM_DROP);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 4));
    position.needsUpdate = true;

    const mesh = new THREE.Mesh(geometry, this.materials.water(regionId));
    mesh.position.set((rect.minX + rect.maxX) / 2, level, (rect.minZ + rect.maxZ) / 2);
    mesh.name = `water-${regionId}`;
    mesh.renderOrder = 2;
    this.scatterGroup.add(mesh);
    return mesh;
  }

  // ------------------------------------------------------------- scatter

  /**
   * Places many copies of one asset as a single InstancedMesh per (geometry, material) pair.
   *
   * This is the draw-call discipline the budget depends on: 200 trees cost the same handful of
   * calls as one tree. Tier variants must be colour swaps over a shared texture, never separate
   * textures, or batching fragments (runs/corealm/architecture.md, correction R6).
   */
  scatterInstanced(
    source: THREE.Object3D,
    placements: { position: Vec3; rotationY: number; scale: number }[],
    name: string,
    options: { regionId?: RegionId; castShadow?: boolean } = {},
  ): THREE.InstancedMesh[] {
    if (placements.length === 0) return [];

    const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[] = [];
    source.updateMatrixWorld(true);
    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!material) return;
      parts.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld.clone() });
    });

    const created: THREE.InstancedMesh[] = [];
    const transform = new THREE.Matrix4();
    const placement = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const scaleVector = new THREE.Vector3();
    const positionVector = new THREE.Vector3();

    for (const [index, part] of parts.entries()) {
      const instanced = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
      instanced.name = `${name}-${index}`;
      instanced.castShadow = options.castShadow ?? true;
      instanced.receiveShadow = true;
      instanced.frustumCulled = true;

      for (const [slot, entry] of placements.entries()) {
        positionVector.set(entry.position[0], entry.position[1], entry.position[2]);
        quaternion.setFromAxisAngle(axis, entry.rotationY);
        scaleVector.setScalar(entry.scale);
        placement.compose(positionVector, quaternion, scaleVector);
        transform.multiplyMatrices(placement, part.matrix);
        instanced.setMatrixAt(slot, transform);
      }
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingSphere();

      this.scatterGroup.add(instanced);
      created.push(instanced);
      if (options.regionId) this.registerScatter(options.regionId, instanced);
    }
    return created;
  }

  /** Ties an object to a region so distance streaming can hide it. */
  registerScatter(regionId: RegionId, object: THREE.Object3D): void {
    const list = this.scatterByRegion.get(regionId) ?? [];
    list.push(object);
    this.scatterByRegion.set(regionId, list);
  }

  /**
   * Region-level distance streaming. Whole regions of scatter switch off once the viewer is more
   * than `radius` metres outside their rect. With 700 m of world and 260 m of fog that removes
   * roughly two thirds of scatter draw calls and triangles from any given frame, and it never
   * pops, because the cut-off is well past the fog wall.
   */
  updateStreaming(x: number, z: number, radius = 240): void {
    for (const [regionId, objects] of this.scatterByRegion) {
      const rect = this.getRegionRect(regionId);
      const visible = rect === null ? true : signedDepth(rect, x, z) > -radius;
      for (const object of objects) object.visible = visible;
    }
  }

  // -------------------------------------------------------------- player

  /**
   * Placeholder player body used until the character rig lands in round 4.
   * Deliberately a clear silhouette so movement is legible in round 0 screenshots.
   */
  createPlaceholderPlayer(): THREE.Object3D {
    const group = new THREE.Group();
    group.name = "player";

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 6, 12),
      this.materials.surface(0x4a6fa5, 0.7, 0.05),
    );
    body.position.y = PLAYER_HEIGHT / 2;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 10),
      this.materials.surface(0xe0b58c, 0.85, 0),
    );
    head.position.y = PLAYER_HEIGHT + 0.02;
    head.castShadow = true;
    group.add(head);

    // A nose-like wedge so facing direction is unambiguous in screenshots.
    const facing = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.34, 8),
      this.materials.surface(0xd8d0c0, 0.8, 0),
    );
    facing.rotation.x = Math.PI / 2;
    facing.position.set(0, PLAYER_HEIGHT * 0.62, PLAYER_RADIUS + 0.14);
    group.add(facing);

    this.entityGroup.add(group);
    this.playerMesh = group;
    return group;
  }

  /**
   * Draws the player at the store's position.
   *
   * The simulation ticks at 100 ms and the renderer runs at 60+ FPS, so following the store
   * position exactly would visibly step. This smooths toward it with a frame-rate-independent
   * factor, and snaps on a large jump so teleports and resets are instant.
   */
  syncPlayer(position: Vec3, facingRad: number, snap = false): void {
    if (!this.playerMesh) return;
    const now = typeof performance === "undefined" ? 0 : performance.now();
    const deltaMs = this.lastSyncMs === 0 ? 16.7 : clamp(now - this.lastSyncMs, 0, 250);
    this.lastSyncMs = now;

    this.playerTarget.set(position[0], position[1], position[2]);
    const jump = this.playerMesh.position.distanceTo(this.playerTarget);
    if (snap || jump > 3.5 || jump === 0) {
      this.playerMesh.position.copy(this.playerTarget);
      this.playerFacing = facingRad;
      this.playerMesh.rotation.y = facingRad;
      this.updateStreaming(position[0], position[2]);
      return;
    }

    const alpha = 1 - Math.pow(0.0015, deltaMs / 1000);
    this.playerMesh.position.lerp(this.playerTarget, alpha);

    let delta = facingRad - this.playerFacing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.playerFacing += delta * Math.min(1, alpha * 1.4);
    this.playerMesh.rotation.y = this.playerFacing;

    this.updateStreaming(position[0], position[2]);
  }

  clear(): void {
    this.terrainGroup.clear();
    this.scatterGroup.clear();
    this.entityGroup.clear();
    this.overlayGroup.clear();
    this.walkable = [];
    this.fields = [];
    this.flats = [];
    this.world = null;
    this.legacySamplers.clear();
    this.scatterByRegion.clear();
    this.playerMesh = null;
    this.lastSyncMs = 0;
  }
}

// ------------------------------------------------------------ region fields

function characterFor(regionId: RegionId): RegionCharacter {
  switch (regionId) {
    case "vellenwood": return "woodland";
    case "karrowmoor": return "highlands";
    case "gravelmaw": return "cavern";
    default: return "plains";
  }
}

/**
 * Each region gets its own relief, and each relief is chosen for how it plays, not how it looks:
 *
 *  - plains    long sightlines, low gradient. You can see Coldbrace from anywhere on the march.
 *  - woodland  tighter, higher-frequency undulation plus a shallow stream cut. Feels enclosed
 *              without ever producing a slope the navmesh will not accept.
 *  - highlands soft terraces climbing east, with ridge spurs. Real verticality, ~36 m of it, but
 *              every riser is a walkable ramp so all four terraces stay on one connected navmesh.
 */
function makeRegionField(spec: RegionTerrainSpec): (x: number, z: number) => number {
  const noise = createValueNoise(spec.seed);
  const detail = createValueNoise((spec.seed ^ 0x9e3779b9) >>> 0);
  const width = Math.max(1, spec.rect.maxX - spec.rect.minX);
  const depth = Math.max(1, spec.rect.maxZ - spec.rect.minZ);
  const centreX = (spec.rect.minX + spec.rect.maxX) / 2;
  const centreZ = (spec.rect.minZ + spec.rect.maxZ) / 2;

  switch (spec.character) {
    case "plains":
      return (x, z) => {
        const rolling = fbm(noise, x, z, 3, 120);
        const swell = fbm(detail, x, z, 2, 46) * 0.28;
        return spec.baseHeight + (rolling + swell) * spec.amplitude * 0.62;
      };

    case "woodland":
      return (x, z) => {
        // Billowed noise (|n|) gives rounded mounds and narrow hollows: the "enclosed" read.
        const mounds = Math.abs(fbm(noise, x, z, 4, 74));
        const ripple = fbm(detail, x, z, 3, 21) * 0.22;
        let height = spec.baseHeight + (mounds * 1.15 + ripple) * spec.amplitude * 0.55;

        // A shallow stream cut running north-west to south-east. Deliberately shallow (2.6 m) and
        // wide (22 m) so it reads as a gorge floor from inside while staying fully walkable.
        const along = ((x - centreX) / width) + ((z - centreZ) / depth) * 0.85;
        const meander = fbm(detail, x * 0.35, z * 0.35, 2, 55) * 0.09;
        const channel = Math.exp(-Math.pow((along + meander) / 0.085, 2));
        height -= channel * 2.6;
        return height;
      };

    case "highlands":
      return (x, z) => {
        // Terraces climb along the authored axis. Every riser stays a walkable ramp, which is what
        // keeps all terraces on one connected navmesh while still forcing a real switchback route.
        const ramp = clamp(terraceRamp(spec, x, z, width, depth), 0, 1);
        const warp = fbm(noise, x, z, 2, 190) * 0.18;
        const steps = spec.terraceSteps ?? 4;
        const terraced = terrace(clamp(ramp * 0.94 + warp, 0, 0.999) * steps, 0.55) / steps;

        // Ridge spurs running across the slope. Ridged noise (1 - |n|) makes crests, not bumps.
        const spur = (1 - Math.abs(fbm(detail, x, z, 3, 105))) * 0.32;
        const rubble = fbm(detail, x * 1.6, z * 1.6, 3, 26) * 0.06;

        return spec.baseHeight + (terraced + spur * 0.22 + rubble) * spec.amplitude;
      };

    case "cavern":
    default:
      return (x, z) => spec.baseHeight + fbm(noise, x, z, 3, 40) * spec.amplitude * 0.3;
  }
}

/** 0 at the low end of the authored terrace axis, 1 at the ridge. */
function terraceRamp(spec: RegionTerrainSpec, x: number, z: number, width: number, depth: number): number {
  switch (spec.terraceAxis ?? "+x") {
    case "-x": return (spec.rect.maxX - x) / width;
    case "+z": return (z - spec.rect.minZ) / depth;
    case "-z": return (spec.rect.maxZ - z) / depth;
    default: return (x - spec.rect.minX) / width;
  }
}

/**
 * How far a road ribbon floats above the analytic ground height, in metres.
 *
 * 0.06 was buried. The terrain MESH samples the height field on a 2 m grid and interpolates
 * between, so the drawn surface sits up to 0.35 m above the analytic value on a convex rise
 * (measured). A lift smaller than that error hides the road for most of its length. 0.30 clears it
 * almost everywhere while staying far too small to read as floating at the camera's distance.
 */
/**
 * How far a road ribbon floats above the ground, in metres.
 *
 * Two centimetres, not thirty. The material already carries a polygon offset, which is what keeps
 * the ribbon out of a z-fight; the lift only has to cover the difference between the terrain MESH
 * (sampled every 2 m) and the terrain FIELD the ribbon samples. At the round-3 value of 0.3 m a
 * road was a kerb: it stood a third of a metre proud of the grass, caught the directional light on
 * its edge, and dropped a hard shadow line down one side of every route in the world.
 */
const ROAD_LIFT = 0.02;

/** How far past the worn width the fade-out skirt reaches, as a multiple of the half-width. */
const ROAD_SKIRT = 1.7;

/** Rim segments on a water disc. 32 is round at the distance a pond is ever seen from. */
const WATER_SEGMENTS = 32;

/** How far the faded rim of a water disc sits below its centre, in metres. */
const WATER_RIM_DROP = 0.35;

/** Even-ish resampling of a polyline, so road ribbons do not stretch across long segments. */
function resamplePolyline(points: readonly Vec3[], spacing: number): Vec3[] {
  const output: Vec3[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  output.push(points[points.length - 1]!);
  return output;
}
