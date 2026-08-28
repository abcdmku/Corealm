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
 * The second structural decision, added later: THE GROUND ABSORBS THE THINGS DRAWN ON IT. Roads,
 * paved squares and waterlogged banks are per-vertex surface weights and colours on the terrain
 * mesh, not separate geometry laid over it. That removed 42 transparent depth-write-off road
 * ribbons — the frame's largest overdraw source and its largest single draw-call block — and with
 * them a whole family of defects that only exist when two surfaces describe the same ground:
 * z-fighting, a lift tuned against the wrong interpolant, and an unpainted hole at every junction.
 *
 * Everything the surface knows is sampled onto ONE 2 m height lattice, the same lattice the chunk
 * meshes are tessellated from and the same one `heightfieldSamples` hands to Rapier, so the drawn
 * ground, the physics ground and every derived quantity are the same surface by construction.
 *
 * This file owns no gameplay state. It reads geometry parameters and draws.
 */
import * as THREE from "three";
import type { RegionId, Vec3 } from "../contracts.js";
import { MaterialLibrary, REGION_PALETTES, surfaceColour } from "./materials.js";
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
  /** Fully flat inside this radius. Ignored when `halfExtents` is set. */
  radius: number;
  /** Metres of falloff outside the radius. */
  blend: number;
  /** Explicit height. Defaults to the natural height at the centre. */
  height?: number;
  /**
   * Rectangular pad, as half-extents along the pad's local x and z. When present the core is that
   * rectangle rather than a circle, and `radius` is only used to size the falloff sweep.
   *
   * This exists because a circular pad cannot hold a terrace. Highcairn is authored around an 18 m
   * riser and its 35 m circular pad erases the whole thing: the region's one piece of designed
   * verticality becomes a disc of uniform grey, visible in terrain-highcairn as an arc where the
   * pad boundary meets the hillside. A rectangle whose long axis runs ALONG the terrace flattens
   * the building ground without touching the riser above or below it.
   */
  halfExtents?: readonly [number, number];
  /** Yaw of a rectangular pad, in radians. Ignored for circular pads. */
  rotationY?: number;
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
  /**
   * The height range the region's field ACTUALLY produces over its own rect, swept at 4 m.
   *
   * The altitude ramp used to normalise against `baseHeight` and `amplitude`, which assumes the
   * field spans exactly 0..amplitude. It does not. Measured over each rect: Fallowmarch used
   * -0.35..2.34 of that ramp, so 46.9% of it clamped to `groundLow` and 0.8% clamped to
   * `groundHigh`; Vellenwood used 0.00..0.33, so #576b3f was never drawn anywhere in the game;
   * Karrowmoor used -0.13..1.08. Normalising against the measured range instead restores the full
   * eight-swatch palette that materials.ts had already authored.
   */
  hMin: number;
  hMax: number;
}

/**
 * The pieces of the world that change the GROUND rather than stand on it.
 *
 * Roads, paved squares and water bodies used to be separate geometry laid over the terrain: 42
 * transparent depth-write-off road ribbons (the frame's largest overdraw source and largest single
 * draw-call block), no paving at all, and a water disc that did not know where the bank was.
 * Stamped into the terrain's own vertex colours and splat weights they are mip-correct,
 * shadow-correct and z-fight-free by construction, and they cost nothing to draw.
 */
export interface RoadStamp {
  /** World-space polyline. Only x and z are read; the ground supplies y. */
  points: readonly Vec3[];
  /** Worn width in metres. Defaults to `ROAD_WORN_HALF * 2`. */
  width?: number;
}

export interface PavingStamp {
  centre: readonly [number, number];
  halfExtents: readonly [number, number];
  rotationY?: number;
}

export interface WaterStamp {
  centre: readonly [number, number];
  radius: number;
  /** Surface height in metres. The mud and wet bands are placed against this. */
  level: number;
}

export interface GroundStamps {
  roads?: readonly RoadStamp[];
  paving?: readonly PavingStamp[];
  water?: readonly WaterStamp[];
  /** Seeds the road meander. Fixed derivation per road index, so it is reproducible. */
  seed?: number;
}

/** One instance in a `scatterInstanced` call. */
export interface ScatterPlacement {
  position: Vec3;
  rotationY: number;
  /** A single number scales uniformly; a triple scales per axis. */
  scale: number | readonly [number, number, number];
  /** Terrain normal to lean into. Omitted means upright. */
  normal?: Vec3;
  /** 0..1 fraction of the way from upright to fully aligned with `normal`. */
  tilt?: number;
}

/** One contact patch. `radius` is the half-width of the darkening, in metres. */
export interface ContactDecalPlacement {
  position: Vec3;
  radius: number;
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

  /**
   * The 2 m height lattice the terrain mesh is actually built from.
   *
   * `heightAtXZ` is the analytic field; the surface a player stands on and clicks is the mesh
   * INTERPOLATED between lattice nodes, and the two disagree by meanAbs 0.031 m (6.1% of samples
   * over 5 cm). That gap is why 10% of road ribbon vertices were below the drawn ground. Sampling
   * the lattice once and reading it everywhere makes the mesh, the physics heightfield and every
   * derived quantity agree by construction, and it turns the 24 horizon-AO samples per vertex from
   * 1.75M analytic field evaluations into 1.75M array reads.
   */
  private lattice: HeightLattice | null = null;
  private chunks: ChunkRecord[] = [];
  private roads: RoadSegment[] = [];
  private roadPolylines: Vec3[][] = [];
  private roadGrid = new Map<number, number[]>();
  private paving: PavingStamp[] = [];
  private waters: WaterStamp[] = [];
  /** Set once stamps have been supplied, which is what retires the road ribbon path. */
  private stampsProvided = false;

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
    this.fields = spec.regions.map((region) => {
      const height = makeRegionField(region);
      const range = sweepFieldRange(region.rect, height);
      return {
        spec: region,
        height,
        palette: REGION_PALETTES[region.regionId],
        hMin: range.min,
        hMax: range.max,
      };
    });

    this.resolveFlatTargets();
    this.normaliseFlats();
    this.buildLattice();

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
    const range = sweepFieldRange(rect, field);
    this.fields.push({
      spec: region,
      height: field,
      palette: REGION_PALETTES[spec.regionId],
      hMin: range.min,
      hMax: range.max,
    });
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
    this.buildLattice();

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
    // Eight surface weights as two normalised Uint8 vec4s, plus the road frame. 12 bytes/vertex,
    // about 876 KB over the world's ~73k terrain vertices. See the splat block in materials.ts.
    const splatA = new Uint8Array(position.count * 4);
    const splatB = new Uint8Array(position.count * 4);
    const extra = new Uint8Array(position.count * 4);
    const centreX = originX + sizeX / 2;
    const centreZ = originZ + sizeZ / 2;
    const surface: SurfaceSample = emptySurface();

    for (let i = 0; i < position.count; i += 1) {
      const worldX = position.getX(i) + centreX;
      const worldZ = position.getZ(i) + centreZ;
      // The lattice IS the mesh: chunk vertices land exactly on lattice nodes, so reading the
      // lattice here rather than re-evaluating the analytic field costs nothing in accuracy and
      // makes the drawn surface and `meshHeightAt` identical by construction.
      const height = this.sampleLattice(worldX, worldZ);
      position.setY(i, height);

      this.sampleSurface(worldX, worldZ, height, surface);
      colours[i * 3] = surface.colour.r;
      colours[i * 3 + 1] = surface.colour.g;
      colours[i * 3 + 2] = surface.colour.b;
      writeSplat(splatA, splatB, extra, i, surface);
    }
    position.needsUpdate = true;
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    geometry.setAttribute("aSplatA", new THREE.BufferAttribute(splatA, 4, true));
    geometry.setAttribute("aSplatB", new THREE.BufferAttribute(splatB, 4, true));
    geometry.setAttribute("aGround", new THREE.BufferAttribute(extra, 4, true));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centreX, 0, centreZ);
    mesh.receiveShadow = true;
    // Terrain never casts. It would double every terrain draw call in the shadow pass and the
    // relief is gentle enough that self-shadowing buys nothing.
    mesh.castShadow = false;
    this.chunks.push({ mesh, centreX, centreZ, sizeX, sizeZ });
    return mesh;
  }

  /**
   * Recomputes the surface of every terrain vertex inside a world-space box.
   *
   * Used when a stamp arrives after the chunks are already built, which is the case for the road
   * corridor: `buildRoad` is called after `buildWorld` and the corridor has to reach the ground
   * that was drawn without it. Everything is recomputed from scratch against the CURRENT stamp
   * list rather than blended into what is already there, so restamping the same ground twice
   * produces the same answer as stamping it once.
   */
  private restampArea(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const surface: SurfaceSample = emptySurface();
    for (const chunk of this.chunks) {
      const halfX = chunk.sizeX / 2;
      const halfZ = chunk.sizeZ / 2;
      if (chunk.centreX + halfX < minX || chunk.centreX - halfX > maxX) continue;
      if (chunk.centreZ + halfZ < minZ || chunk.centreZ - halfZ > maxZ) continue;

      const geometry = chunk.mesh.geometry;
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      const colour = geometry.getAttribute("color") as THREE.BufferAttribute;
      const splatA = geometry.getAttribute("aSplatA") as THREE.BufferAttribute;
      const splatB = geometry.getAttribute("aSplatB") as THREE.BufferAttribute;
      const extra = geometry.getAttribute("aGround") as THREE.BufferAttribute;
      if (!colour || !splatA || !splatB || !extra) continue;

      const colours = colour.array as Float32Array;
      const arrayA = splatA.array as Uint8Array;
      const arrayB = splatB.array as Uint8Array;
      const arrayExtra = extra.array as Uint8Array;
      let touched = false;

      for (let i = 0; i < position.count; i += 1) {
        const worldX = position.getX(i) + chunk.centreX;
        const worldZ = position.getZ(i) + chunk.centreZ;
        if (worldX < minX || worldX > maxX || worldZ < minZ || worldZ > maxZ) continue;
        this.sampleSurface(worldX, worldZ, position.getY(i), surface);
        colours[i * 3] = surface.colour.r;
        colours[i * 3 + 1] = surface.colour.g;
        colours[i * 3 + 2] = surface.colour.b;
        writeSplat(arrayA, arrayB, arrayExtra, i, surface);
        touched = true;
      }

      if (!touched) continue;
      colour.needsUpdate = true;
      splatA.needsUpdate = true;
      splatB.needsUpdate = true;
      extra.needsUpdate = true;
    }
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
    // Pads that carry an explicit height are clamped against the ground they sit on FIRST, because
    // every later decision (the implicit pads' targets, the falloff widths) is measured against
    // them. The fishing basins are authored as a depth below the REGION FLOOR, and Karrowmoor's
    // terraces climb 36 m above their floor, so the Cairn Tarn and the Far Tarn were both authored
    // 36 m inside a hillside. Measured consequence: `normaliseFlats` widened their falloffs to
    // 63.0 m and 84.8 m to keep the sides walkable, which dragged a natural 43 m ridge down to
    // 10.4 m and left the ridge_pines location pad standing in it as a 7 m-radius, 32.75 m-tall
    // pillar with an unblended vertical wall. A tarn belongs ON its terrace, not in a crater
    // through it, so a pad may carve at most MAX_PAD_CARVE below the natural ground at its centre.
    for (const flat of this.flats) {
      if (flat.height === undefined) continue;
      const natural = this.naturalHeight(flat.x, flat.z);
      flat.height = Math.max(flat.height, natural - MAX_PAD_CARVE);
    }
    for (let index = 0; index < this.flats.length; index += 1) {
      const flat = this.flats[index];
      if (!flat || flat.height !== undefined) continue;
      flat.height = this.applyFlats(flat.x, flat.z, this.naturalHeight(flat.x, flat.z), index);
    }
  }

  /**
   * Widens each pad's falloff until its collar is walkable, and no further.
   *
   * A 7 m pad with a 9 m falloff on a Karrowmoor terrace riser cuts a mesa with 60-degree sides:
   * recast drops the sides, and the location on top becomes an island the player can path to but
   * not reach. So each pad's falloff expands to whatever the local height difference actually
   * needs — but the previous cap of 4x had no relationship to the pad, which is how a 16 m basin
   * acquired an 84.8 m falloff and became a regional depression. The cap is now 3x the pad's own
   * radius, which is a collar, not a landscape.
   *
   * The ring is sampled against the FLATTENED height rather than the natural one. Sampling the
   * natural field meant a pad could not see the neighbour that was about to pull the ground out
   * from under its collar, which is the other half of how the 32.75 m cliff was cut.
   */
  private normaliseFlats(): void {
    const maxGradient = 0.6; // about 31 degrees, comfortably inside the 48-degree walkable limit
    // Two passes: the first pass changes the flattened field the second pass measures against.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const flat of this.flats) {
        const centre = flat.height ?? this.naturalHeight(flat.x, flat.z);
        const reach = padReach(flat);
        let drop = 0;
        const ring = reach + flat.blend;
        for (let step = 0; step < 8; step += 1) {
          const angle = (step / 8) * Math.PI * 2;
          const x = flat.x + Math.cos(angle) * ring;
          const z = flat.z + Math.sin(angle) * ring;
          drop = Math.max(drop, Math.abs(this.heightAtXZ(x, z) - centre));
        }
        const needed = Math.max(flat.blend, drop / maxGradient);
        flat.blend = Math.min(needed, Math.max(flat.blend, reach * 3));
      }
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
   * Flattens `height` through every pad that reaches this point.
   *
   * This used to hard-set `result = target` inside a pad's radius and then SKIP every later pad's
   * falloff, on the reasoning that a pad's falloff must never disturb ground another pad has
   * already made flat. The reasoning was right and the implementation cut a cliff: at
   * (253.3,-101.8) the ridge_pines core kept its natural 43.12 m with both fishing-basin falloffs
   * skipped, while one metre away the same natural ground took both falloffs and landed at
   * 10.37 m. That is a 32.75 m step in 1 m, and 3.4% of the world (1317 of 38332 samples) came out
   * steeper than 45 degrees with a maximum of 86.3.
   *
   * The replacement is inverse-distance weighting. Every pad in range contributes
   * `((1-t)/t)^3` where `t` is the fraction of the way through its falloff, so:
   *
   *  - the weight rises without bound toward a pad's core, which is what makes flat mean flat: at
   *    Coldbrace's centre the settlement pad outweighs anything else that reaches it by 10^5, so
   *    the measured relief across the pad stays 0.000 m and buildings still assemble level;
   *  - it is continuous everywhere, including across a core boundary, so two pads with different
   *    targets produce a RAMP between them instead of a step;
   *  - cores weight by penetration depth, so where two cores overlap the deeper one wins smoothly
   *    rather than by list order.
   *
   * `influence` is a separate plain falloff that returns the result to the natural field at the
   * outer edge of the outermost pad, which the raw weighted mean cannot do on its own.
   */
  private applyFlats(x: number, z: number, height: number, limit = this.flats.length): number {
    if (this.flats.length === 0) return height;
    let accumulated = 0;
    let weightSum = 0;
    let influence = 0;

    for (let index = 0; index < limit; index += 1) {
      const flat = this.flats[index];
      if (!flat) continue;
      const distance = padDistance(flat, x, z);
      if (distance > flat.blend) continue;
      const target = flat.height ?? this.naturalHeight(flat.x, flat.z);

      // ONE expression across the core boundary, which is the whole point. Weighting the core by a
      // separate constant makes the weight jump by orders of magnitude at `distance == 0`, and a
      // discontinuous weight is a discontinuous surface: it measured as a 4.4 m step in the ground
      // 2 m outside a location pad, which is the same class of defect as the 32.75 m cliff.
      const t = distance <= 0 ? 0 : distance / Math.max(0.001, flat.blend);
      const falloff = distance <= 0 ? 1 : 1 - smoothstep01(t);
      const depth = distance < 0 ? -distance : 0;
      const weight = (1 + depth) / (t * t * t + PAD_CORE_EPSILON);
      influence = Math.max(influence, falloff);
      accumulated += target * weight;
      weightSum += weight;
    }

    if (weightSum <= 0 || influence <= 0) return height;
    return height + (accumulated / weightSum - height) * influence;
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

  // -------------------------------------------------- the 2 m mesh lattice

  /**
   * Samples the analytic field once onto the 2 m lattice the chunks are tessellated from.
   *
   * ~70k evaluations, and it replaces the ~365k the old `buildChunk` did (five per vertex for the
   * height and its central differences). Everything downstream — vertex heights, slope, curvature,
   * horizon AO, `meshHeightAt`, `normalAt`, the water shoreline — reads this array instead, which
   * is both faster and, more importantly, guarantees they all describe the SAME surface.
   */
  private buildLattice(): void {
    const world = this.world;
    if (!world) return;
    const bounds = world.bounds;
    const step = Math.max(0.25, world.metresPerQuad);
    const cols = Math.max(1, Math.round((bounds.maxX - bounds.minX) / step)) + 1;
    const rows = Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / step)) + 1;
    const heights = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      const z = bounds.minZ + row * step;
      for (let col = 0; col < cols; col += 1) {
        heights[row * cols + col] = this.heightAtXZ(bounds.minX + col * step, z);
      }
    }
    this.lattice = { heights, cols, rows, minX: bounds.minX, minZ: bounds.minZ, step };
  }

  /** Bilinear read of the lattice, falling back to the analytic field before it exists. */
  private sampleLattice(x: number, z: number): number {
    const lattice = this.lattice;
    if (!lattice) return this.heightAtXZ(x, z);
    const fx = clamp((x - lattice.minX) / lattice.step, 0, lattice.cols - 1);
    const fz = clamp((z - lattice.minZ) / lattice.step, 0, lattice.rows - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, lattice.cols - 1);
    const z1 = Math.min(z0 + 1, lattice.rows - 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = lattice.heights[z0 * lattice.cols + x0]!;
    const h10 = lattice.heights[z0 * lattice.cols + x1]!;
    const h01 = lattice.heights[z1 * lattice.cols + x0]!;
    const h11 = lattice.heights[z1 * lattice.cols + x1]!;
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * tz;
  }

  /**
   * The height of the DRAWN ground, bilinear on the same 2 m lattice the mesh is built from.
   *
   * Not the same thing as `heightAtXZ`, which is the analytic field: measured over 38332 samples,
   * the two differ by meanAbs 0.031 m, 6.1% of samples exceed 5 cm, and 10% of road ribbon
   * vertices sat BELOW the drawn ground because of it. Anything that has to touch the surface a
   * player sees — a decal, a shoreline, a placed prop — belongs on this one.
   */
  meshHeightAt(x: number, z: number): number {
    return this.sampleLattice(x, z);
  }

  /** Unit surface normal of the drawn ground. Central difference on the same 2 m lattice. */
  normalAt(x: number, z: number): Vec3 {
    const step = this.lattice?.step ?? 2;
    const dx = (this.sampleLattice(x + step, z) - this.sampleLattice(x - step, z)) / (2 * step);
    const dz = (this.sampleLattice(x, z + step) - this.sampleLattice(x, z - step)) / (2 * step);
    const length = Math.hypot(dx, 1, dz);
    return [-dx / length, 1 / length, -dz / length];
  }

  // -------------------------------------------------------- ground stamps

  /**
   * Hands the ground the things that change it rather than stand on it.
   *
   * Call BEFORE `buildWorld` and the stamps are baked into the chunks as they are built. Call
   * after and only the roads reach the ground, through `restampArea`. Supplying roads here also
   * retires the ribbon path: `buildRoad` becomes a no-op, because the corridor is already in the
   * terrain and drawing it twice is exactly the z-fighting the ribbon's polygon offset existed to
   * paper over.
   */
  setGroundStamps(stamps: GroundStamps): void {
    this.stampsProvided = true;
    this.paving = (stamps.paving ?? []).map((entry) => ({ ...entry }));
    this.waters = (stamps.water ?? []).map((entry) => ({ ...entry }));
    this.roadPolylines = [];
    this.roads = [];
    const seed = stamps.seed ?? 0x0a0d;
    for (const [index, road] of (stamps.roads ?? []).entries()) {
      const curved = curveRoadPolyline(road.points, (seed ^ (index * 0x9e37)) >>> 0);
      this.roadPolylines.push(curved);
      appendRoadSegments(this.roads, curved);
    }
    this.rebuildRoadGrid();
    if (this.chunks.length > 0) this.restampArea(-Infinity, -Infinity, Infinity, Infinity);
  }

  /**
   * The road centrelines as they were actually stamped, after the meander.
   *
   * Kerbs, path rocks and anything else that follows a route needs the CURVED line, not the
   * authored endpoints, or the edge dressing runs beside the road rather than along it.
   */
  getRoadPolylines(): Vec3[][] {
    return this.roadPolylines.map((line) => line.map((point) => [point[0], point[1], point[2]] as Vec3));
  }

  private rebuildRoadGrid(): void {
    this.roadGrid.clear();
    for (const [index, segment] of this.roads.entries()) {
      const minX = Math.min(segment.ax, segment.bx) - ROAD_FADE_HALF;
      const maxX = Math.max(segment.ax, segment.bx) + ROAD_FADE_HALF;
      const minZ = Math.min(segment.az, segment.bz) - ROAD_FADE_HALF;
      const maxZ = Math.max(segment.az, segment.bz) + ROAD_FADE_HALF;
      for (let cz = Math.floor(minZ / ROAD_CELL); cz <= Math.floor(maxZ / ROAD_CELL); cz += 1) {
        for (let cx = Math.floor(minX / ROAD_CELL); cx <= Math.floor(maxX / ROAD_CELL); cx += 1) {
          const key = cellKey(cx, cz);
          const bucket = this.roadGrid.get(key);
          if (bucket) bucket.push(index);
          else this.roadGrid.set(key, [index]);
        }
      }
    }
  }

  /**
   * Distance from a point to the nearest road centreline, with the sign of which side it is on.
   *
   * Bucketed on an 8 m grid, so a terrain vertex tests a handful of segments rather than all ~700.
   * Returns `null` past `ROAD_FADE_HALF`, which is most of the world.
   */
  private roadAt(x: number, z: number): { distance: number; perpendicular: number } | null {
    if (this.roads.length === 0) return null;
    let best = Infinity;
    let bestPerpendicular = 0;
    const cx = Math.floor(x / ROAD_CELL);
    const cz = Math.floor(z / ROAD_CELL);
    const bucket = this.roadGrid.get(cellKey(cx, cz));
    if (!bucket) return null;
    for (const index of bucket) {
      const segment = this.roads[index]!;
      const ex = segment.bx - segment.ax;
      const ez = segment.bz - segment.az;
      const lengthSquared = ex * ex + ez * ez;
      const t = lengthSquared <= 1e-9
        ? 0
        : clamp(((x - segment.ax) * ex + (z - segment.az) * ez) / lengthSquared, 0, 1);
      const px = segment.ax + ex * t;
      const pz = segment.az + ez * t;
      const distance = Math.hypot(x - px, z - pz);
      if (distance >= best) continue;
      best = distance;
      const length = Math.sqrt(lengthSquared) || 1;
      bestPerpendicular = ((x - px) * (ez / length) - (z - pz) * (ex / length));
    }
    if (best > ROAD_FADE_HALF) return null;
    return { distance: best, perpendicular: bestPerpendicular };
  }

  /**
   * Everything the ground needs to know about itself at one point: eight surface weights, the
   * colour they blend to, the horizon AO that multiplies it, and the road frame.
   *
   * `groundColourAt` before this returned a lerp of two palette swatches by altitude, and altitude
   * only varies at the 74-190 m feature sizes of the height noise. That is why the terrain read as
   * a solid colour field, why 21.7% of all sampled vertices in the world were one exact colour,
   * and why a worn track, a scree hollow, a paved square and a waterlogged bank were all
   * undrawable. Every weight below comes from data the chunk builder already had (slope, altitude,
   * the second derivative of the same central differences) or from a stamp.
   */
  private sampleSurface(x: number, z: number, height: number, out: SurfaceSample): void {
    const blend = this.world?.blendMetres ?? 45;
    let weightSum = 0;
    let local = 0;
    let lowR = 0; let lowG = 0; let lowB = 0;
    let highR = 0; let highG = 0; let highB = 0;
    let rockR = 0; let rockG = 0; let rockB = 0;
    let gravelR = 0; let gravelG = 0; let gravelB = 0;
    let dirtR = 0; let dirtG = 0; let dirtB = 0;
    let mudR = 0; let mudG = 0; let mudB = 0;
    let cobbleR = 0; let cobbleG = 0; let cobbleB = 0;
    let wetR = 0; let wetG = 0; let wetB = 0;

    for (const field of this.fields) {
      const weight = this.fields.length === 1
        ? 1
        : smoothstep01((signedDepth(field.spec.rect, x, z) + blend) / (2 * blend));
      if (weight <= 0) continue;
      const swatches = swatchesFor(field.spec.regionId);
      // Altitude within the height range the region's field ACTUALLY produces. See RegionField.
      local += smoothstep01((height - field.hMin) / Math.max(1, field.hMax - field.hMin)) * weight;
      lowR += swatches.low.r * weight; lowG += swatches.low.g * weight; lowB += swatches.low.b * weight;
      highR += swatches.high.r * weight; highG += swatches.high.g * weight; highB += swatches.high.b * weight;
      rockR += swatches.rock.r * weight; rockG += swatches.rock.g * weight; rockB += swatches.rock.b * weight;
      gravelR += swatches.gravel.r * weight; gravelG += swatches.gravel.g * weight; gravelB += swatches.gravel.b * weight;
      dirtR += swatches.dirt.r * weight; dirtG += swatches.dirt.g * weight; dirtB += swatches.dirt.b * weight;
      mudR += swatches.mud.r * weight; mudG += swatches.mud.g * weight; mudB += swatches.mud.b * weight;
      cobbleR += swatches.cobble.r * weight; cobbleG += swatches.cobble.g * weight; cobbleB += swatches.cobble.b * weight;
      wetR += swatches.wet.r * weight; wetG += swatches.wet.g * weight; wetB += swatches.wet.b * weight;
      weightSum += weight;
    }

    if (weightSum <= 0) {
      const fallback = swatchesFor("fallowmarch");
      out.colour.copy(fallback.high);
      out.grass = 1; out.dry = 0; out.rock = 0; out.gravel = 0;
      out.dirt = 0; out.mud = 0; out.cobble = 0; out.wet = 0;
      out.roadPerpendicular = 0.5;
      out.roadPresence = 0;
      return;
    }

    const inverse = 1 / weightSum;
    local *= inverse;

    const step = this.lattice?.step ?? 2;
    const hxp = this.sampleLattice(x + step, z);
    const hxm = this.sampleLattice(x - step, z);
    const hzp = this.sampleLattice(x, z + step);
    const hzm = this.sampleLattice(x, z - step);
    const slope = Math.hypot((hxp - hxm) / (2 * step), (hzp - hzm) / (2 * step));
    // Laplacian on the same stencil. Positive is a hollow, negative is a crest. Measured over the
    // world this lands in roughly -0.35..0.35 m, so 0.10 is a pronounced hollow, not a wobble.
    const curvature = (hxp + hxm + hzp + hzm - 4 * height) / (step * step);

    // Slope above ~23 degrees loses its soil and shows stone. Lowered from the old 0.5 threshold
    // because at 0.5 only 12.71% of the world had any surface variation at all.
    const rock = smoothstep01((slope - 0.42) / 0.5);
    // Debris collects in hollows and washes off crests.
    const gravel = smoothstep01((curvature - 0.05) / 0.14) * (1 - rock * 0.6);

    // Stamps, in priority order: paving beats a road, a road beats a waterlogged bank.
    const road = this.roadAt(x, z);
    let dirt = 0;
    let roadPerpendicular = 0.5;
    let roadPresence = 0;
    if (road) {
      dirt = 1 - smoothstep01((road.distance - ROAD_WORN_HALF) / (ROAD_FADE_HALF - ROAD_WORN_HALF));
      roadPerpendicular = clamp(road.perpendicular / (ROAD_PERP_RANGE * 2) + 0.5, 0, 1);
      roadPresence = dirt > 0.02 ? 1 : 0;
    }

    let cobble = 0;
    for (const pad of this.paving) {
      const distance = rectDistance(x, z, pad.centre, pad.halfExtents, pad.rotationY ?? 0);
      cobble = Math.max(cobble, 1 - smoothstep01(distance / PAVING_FEATHER));
    }

    let wet = 0;
    let mud = 0;
    for (const body of this.waters) {
      const distance = Math.hypot(x - body.centre[0], z - body.centre[1]);
      if (distance > body.radius + WATER_BANK_METRES) continue;
      const above = height - body.level;
      // Waterlogged right at and below the line, churned mud for the next 0.9 m up the bank.
      wet = Math.max(wet, 1 - smoothstep01((above + 0.05) / 0.35));
      mud = Math.max(mud, (1 - smoothstep01((above - 0.2) / 0.9)) * smoothstep01((above + 0.1) / 0.3));
    }

    // Paving covers a road; both cover the bank.
    dirt = Math.min(dirt, 1 - cobble);
    wet = Math.min(wet, 1 - cobble - dirt);
    mud = Math.min(mud, Math.max(0, 1 - cobble - dirt - wet));

    const stamped = clamp(cobble + dirt + wet + mud, 0, 1);
    const natural = 1 - stamped;
    out.rock = rock * natural;
    out.gravel = clamp(gravel, 0, 1) * (1 - rock) * natural;
    const remaining = Math.max(0, natural - out.rock - out.gravel);
    out.dry = remaining * local;
    out.grass = remaining * (1 - local);
    out.cobble = cobble;
    out.dirt = dirt;
    out.wet = wet;
    out.mud = mud;
    out.roadPerpendicular = roadPerpendicular;
    out.roadPresence = roadPresence;

    out.colour.setRGB(
      (lowR * out.grass + highR * out.dry + rockR * out.rock + gravelR * out.gravel
        + dirtR * out.dirt + mudR * out.mud + cobbleR * out.cobble + wetR * out.wet) * inverse,
      (lowG * out.grass + highG * out.dry + rockG * out.rock + gravelG * out.gravel
        + dirtG * out.dirt + mudG * out.mud + cobbleG * out.cobble + wetG * out.wet) * inverse,
      (lowB * out.grass + highB * out.dry + rockB * out.rock + gravelB * out.gravel
        + dirtB * out.dirt + mudB * out.mud + cobbleB * out.cobble + wetB * out.wet) * inverse,
    );

    const ao = this.horizonAo(x, z, height);
    out.colour.multiplyScalar(ao);
  }

  /**
   * Baked sky occlusion: how much of the horizon is blocked, at 8 azimuths and three ranges.
   *
   * There was no ambient occlusion and no contact darkening anywhere in the renderer, which is
   * why terrain-great_cairn read as a beige card rather than a mountainside — a slope with no
   * shading break has no form, whatever its silhouette does. 24 lattice reads per vertex over
   * ~73k vertices is about 40 ms at build time and exactly zero at runtime, and it is the single
   * change that makes relief legible.
   */
  private horizonAo(x: number, z: number, height: number): number {
    if (!this.lattice) return 1;
    let maxAngle = 0;
    for (let step = 0; step < AO_AZIMUTHS; step += 1) {
      const angle = (step / AO_AZIMUTHS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      for (const range of AO_RANGES) {
        const rise = this.sampleLattice(x + dx * range, z + dz * range) - height;
        if (rise <= 0) continue;
        const angleTo = Math.atan2(rise, range);
        if (angleTo > maxAngle) maxAngle = angleTo;
      }
    }
    return AO_FLOOR + (1 - AO_FLOOR) * (1 - clamp(maxAngle / (Math.PI / 2), 0, 1));
  }

  /**
   * A worn track. Stamped into the ground rather than drawn on top of it.
   *
   * This used to build a four-lane transparent ribbon per authored link. Measured, that was 42
   * separate `depthWrite:false` meshes — the frame's largest overdraw source and its largest
   * single draw-call block — and it had three defects the ribbon form could not be rid of:
   * `endFade` zeroed the alpha across the whole first and last cross-section, so 3-5 links ending
   * at the same node punched an unpainted circle of grass at the exact point the routes meet
   * (visible as green at the centre of the X in terrain-bracken_pit); 10% of the ribbon's vertices
   * sat below the drawn ground, because the ribbon sampled the analytic field while the mesh is
   * the 2 m interpolant; and the ribbon and the water disc did not know about each other, so a
   * road ran across the surface of a pond.
   *
   * In the terrain's own splat weights all three stop existing by construction: mip-correct,
   * shadow-correct, z-fight-free, and a junction is just ground that two corridors both cover.
   *
   * Returns null and draws nothing. The signature is kept because boot calls it, and the
   * `width` and `regionId` arguments still do their jobs — width sets the worn half-width, and
   * the region decides which soil the track exposes.
   */
  buildRoad(points: readonly Vec3[], width = 4.5, regionId: RegionId = "fallowmarch"): THREE.Mesh | null {
    void regionId;
    if (points.length < 2) return null;
    // Stamps supplied up front already contain the roads; stamping them again would double-count
    // the corridor at every vertex the two descriptions share.
    if (this.stampsProvided) return null;

    const curved = curveRoadPolyline(points, (0x0a0d ^ (this.roadPolylines.length * 0x9e37)) >>> 0);
    this.roadPolylines.push(curved);
    const before = this.roads.length;
    appendRoadSegments(this.roads, curved);
    this.rebuildRoadGrid();

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = before; index < this.roads.length; index += 1) {
      const segment = this.roads[index]!;
      minX = Math.min(minX, segment.ax, segment.bx);
      maxX = Math.max(maxX, segment.ax, segment.bx);
      minZ = Math.min(minZ, segment.az, segment.bz);
      maxZ = Math.max(maxZ, segment.az, segment.bz);
    }
    const reach = Math.max(ROAD_FADE_HALF, width) + 1;
    this.restampArea(minX - reach, minZ - reach, maxX + reach, maxZ + reach);
    return null;
  }

  /**
   * A still water surface for a pool, tarn or brook. Not walkable, not a collider.
   *
   * A radial grid whose OUTER RING IS THE SHORELINE, not a 34-vertex triangle fan with a faded
   * rim. Measured, the fan was wrong in three separate ways at once: `CircleGeometry(radius, 32)`
   * is one hub plus 33 rim vertices over a 46 m disc, so there was no interior geometry to vary;
   * the rim was dropped 0.35 m and faded to alpha 0, which dissolved the outer 40% of the disc
   * into a wash instead of drawing a waterline; and the disc was sized `cluster.radius + 14` with
   * no relationship to the basin, so 55-56% of the tarn footprints had dry hillside above the
   * surface by up to 7.3 m.
   *
   * Instead: 32 azimuths, and along each one a bisection for the exact distance at which the DRAWN
   * ground crosses the surface height. Ten rings out to that distance. Per-vertex depth into an
   * `aWaterDepth` attribute, which the material turns into a shallow-to-deep tint and an alpha
   * that reaches zero exactly at the bank. The shoreline is then a property of the geometry rather
   * than something the shader has to guess at.
   */
  buildWater(rect: Rect, level: number, regionId: RegionId): THREE.Mesh {
    const centreX = (rect.minX + rect.maxX) / 2;
    const centreZ = (rect.minZ + rect.maxZ) / 2;
    const maxRadius = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2;

    // Shoreline distance per azimuth. Bisection rather than a linear walk because the bank is
    // monotonic over the basin's own falloff and 18 samples resolve it to under a centimetre.
    const shoreline = new Float64Array(WATER_SEGMENTS);
    for (let step = 0; step < WATER_SEGMENTS; step += 1) {
      const angle = (step / WATER_SEGMENTS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      let low = 0;
      let high = maxRadius;
      if (this.meshHeightAt(centreX + dx * high, centreZ + dz * high) < level) {
        shoreline[step] = high;
        continue;
      }
      for (let iteration = 0; iteration < 18; iteration += 1) {
        const mid = (low + high) / 2;
        if (this.meshHeightAt(centreX + dx * mid, centreZ + dz * mid) < level) low = mid;
        else high = mid;
      }
      // A floor, so a basin that was carved too shallow still draws something a player can see is
      // water rather than collapsing to a point.
      shoreline[step] = Math.max(WATER_MIN_RADIUS, low);
    }

    const rings = WATER_RINGS;
    const vertexCount = 1 + WATER_SEGMENTS * rings;
    const positions = new Float32Array(vertexCount * 3);
    const depths = new Float32Array(vertexCount);
    const indices: number[] = [];

    depths[0] = Math.max(0, level - this.meshHeightAt(centreX, centreZ));
    for (let step = 0; step < WATER_SEGMENTS; step += 1) {
      const angle = (step / WATER_SEGMENTS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const reach = shoreline[step]!;
      for (let ring = 0; ring < rings; ring += 1) {
        const radius = (reach * (ring + 1)) / rings;
        const index = 1 + step * rings + ring;
        const x = dx * radius;
        const z = dz * radius;
        positions[index * 3] = x;
        positions[index * 3 + 2] = z;
        depths[index] = Math.max(0, level - this.meshHeightAt(centreX + x, centreZ + z));
      }
    }

    for (let step = 0; step < WATER_SEGMENTS; step += 1) {
      const next = (step + 1) % WATER_SEGMENTS;
      const a0 = 1 + step * rings;
      const b0 = 1 + next * rings;
      indices.push(0, b0, a0);
      for (let ring = 0; ring < rings - 1; ring += 1) {
        const a = a0 + ring;
        const b = b0 + ring;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aWaterDepth", new THREE.BufferAttribute(depths, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.materials.water(regionId));
    mesh.position.set(centreX, level, centreZ);
    mesh.name = `water-${regionId}`;
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scatterGroup.add(mesh);
    // The bank treatment in the terrain splat needs to know where the waterline is. Registering
    // here rather than requiring a separate call is what keeps the mud and the shoreline agreeing
    // even when the caller only knows about the water.
    this.waters.push({ centre: [centreX, centreZ], radius: maxRadius, level });
    if (this.chunks.length > 0) {
      const reach = maxRadius + WATER_BANK_METRES;
      this.restampArea(centreX - reach, centreZ - reach, centreX + reach, centreZ + reach);
    }
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
    placements: ScatterPlacement[],
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
    const tiltQuaternion = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const normalVector = new THREE.Vector3();
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
        // A ground normal leans the instance into the slope it stands on. Applied on the LEFT of
        // the yaw, so the asset still faces where it was told to and only its footing changes;
        // multiplying the other way rotates the lean around with the yaw and a row of trees on one
        // hillside ends up leaning in different directions.
        if (entry.normal && (entry.tilt ?? 1) > 0) {
          normalVector.set(entry.normal[0], entry.normal[1], entry.normal[2]).normalize();
          tiltQuaternion.setFromUnitVectors(axis, normalVector);
          const amount = clamp(entry.tilt ?? 1, 0, 1);
          if (amount < 1) tiltQuaternion.slerp(IDENTITY_QUATERNION, 1 - amount);
          quaternion.premultiply(tiltQuaternion);
        }
        if (typeof entry.scale === "number") scaleVector.setScalar(entry.scale);
        else scaleVector.set(entry.scale[0], entry.scale[1], entry.scale[2]);
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

  /**
   * One InstancedMesh of contact patches — the whole world's contact shadows in ONE draw call.
   *
   * There was no ambient occlusion, no cavity term and no contact decal anywhere, so the only
   * thing joining an object to the ground was the directional shadow, which at the old 50-degree
   * sun elevation landed metres away from the object's base. terrain-hollowcut_seam showed six ore
   * boulders meeting the grass at a hard elliptical cut with no darkening at all.
   *
   * Each quad is laid on the DRAWN ground (`meshHeightAt`, not the analytic field) and tilted to
   * the local normal, so it stays in contact on a slope instead of clipping through one edge, and
   * it multiplies rather than blends so it needs no sorting against the terrain under it.
   *
   * Returns null for an empty list rather than an empty InstancedMesh, which would still cost a
   * draw call.
   */
  buildContactDecals(placements: readonly ContactDecalPlacement[], name = "contact-decals"): THREE.InstancedMesh | null {
    if (placements.length === 0) return null;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geometry, this.materials.contactDecal(), placements.length);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 1;
    mesh.frustumCulled = true;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const normalVector = new THREE.Vector3();

    for (const [slot, entry] of placements.entries()) {
      const x = entry.position[0];
      const z = entry.position[2];
      const normal = this.normalAt(x, z);
      normalVector.set(normal[0], normal[1], normal[2]);
      quaternion.setFromUnitVectors(up, normalVector);
      // 3 cm of lift on top of the material's polygon offset. Less and a 2 m quad clips into the
      // lattice interpolant on a convex rise; more and the patch reads as a floating card.
      position.set(x, this.meshHeightAt(x, z) + CONTACT_DECAL_LIFT, z);
      const size = Math.max(0.3, entry.radius * 2);
      scale.set(size, 1, size);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(slot, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.scatterGroup.add(mesh);
    return mesh;
  }

  /** Advances every animated surface. View-only: no gameplay state is read or written here. */
  updateTime(seconds: number): void {
    this.materials.setTime(seconds);
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
    const now = typeof performance === "undefined" ? 0 : performance.now();
    // The water's scroll clock lives here rather than in a new per-frame call, so the surface
    // animates without boot having to wire anything. `updateTime` is still public for whoever
    // eventually owns the frame loop.
    this.updateTime(now / 1000);
    if (!this.playerMesh) return;
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
    this.lattice = null;
    this.chunks = [];
    this.roads = [];
    this.roadPolylines = [];
    this.roadGrid.clear();
    this.paving = [];
    this.waters = [];
    this.stampsProvided = false;
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
 * The road corridor, in metres either side of the centreline.
 *
 * `ROAD_WORN_HALF` is fully worn track; from there the dirt weight feathers out to
 * `ROAD_FADE_HALF`. Wider than the old ribbon's 1.6 m half-width because a corridor written into a
 * 2 m vertex lattice needs to catch at least two vertices across to read as a track at all.
 * `ROAD_PERP_RANGE` is only the encoding range of the perpendicular distance in `aGround.x`; at
 * 3.5 m it gives the fragment shader 2.7 cm of resolution, which is finer than the 16 cm rut band.
 */
const ROAD_WORN_HALF = 1.9;
const ROAD_FADE_HALF = 3.4;
const ROAD_PERP_RANGE = 3.5;

/** Bucket size for the road segment grid, in metres. One bucket covers the whole fade width. */
const ROAD_CELL = 8;

/** How far a paved edge feathers into the ground around it, in metres. */
const PAVING_FEATHER = 1.2;

/** How far past a water body's radius the bank treatment reaches, in metres. */
const WATER_BANK_METRES = 6;

/** Azimuths on a water disc. 32 is round at the distance a pond is ever seen from. */
const WATER_SEGMENTS = 32;

/** Rings between the hub and the shoreline. 10 x 32 + 1 = 321 vertices, against the old 34. */
const WATER_RINGS = 10;

/** Smallest shoreline radius a water body will draw, in metres. */
const WATER_MIN_RADIUS = 2.5;

/**
 * Horizon-AO sampling: 8 azimuths at 12 / 25 / 50 m, and a floor of 0.62 at a fully blocked
 * horizon. Three ranges rather than one because a hillside is read at three scales at once — a
 * bank at 12 m, a spur at 25 m, a ridge at 50 m — and a single range only darkens one of them.
 */
const AO_AZIMUTHS = 8;
const AO_RANGES: readonly number[] = [12, 25, 50];
const AO_FLOOR = 0.62;

/**
 * How far a pad may carve BELOW the natural ground at its own centre, in metres.
 *
 * The fishing basins are authored as a depth below the region floor, and Karrowmoor's terraces
 * climb 36 m above theirs, so the Cairn Tarn and the Far Tarn were both authored 36 m inside a
 * hillside. See `resolveFlatTargets` for what that cost. 2.6 m is deeper than the 0.9 m the
 * content asks for and shallow enough that the bank stays walkable without a wide collar.
 */
const MAX_PAD_CARVE = 2.6;

/**
 * Softening term in the inverse-distance pad weight, which sets the weight at a pad's core edge.
 *
 * 1e-5 puts the core-edge weight at 1e5 against about 8 for a pad halfway through its falloff, so
 * a settlement pad outweighs anything reaching into it by roughly four orders of magnitude. That
 * is what keeps the measured relief across the 7,238 m2 Coldbrace pad at 0.0000 m and lets a
 * building assemble level on it. Finite, so the field stays continuous across the core boundary.
 */
const PAD_CORE_EPSILON = 1e-5;

/** Vertical lift on a contact decal, in metres, on top of the material's polygon offset. */
const CONTACT_DECAL_LIFT = 0.03;

/** Spacing at which a stamped road polyline is resampled into segments, in metres. */
const ROAD_SEGMENT_SPACING = 4;

/** How far a road may bow away from its straight line, in metres. */
const ROAD_MAX_SWAY = 7;

/** Reused in the scatter tilt slerp. Allocating one per instance showed up in the profile. */
const IDENTITY_QUATERNION = new THREE.Quaternion();

interface HeightLattice {
  heights: Float32Array;
  cols: number;
  rows: number;
  minX: number;
  minZ: number;
  step: number;
}

interface ChunkRecord {
  mesh: THREE.Mesh;
  centreX: number;
  centreZ: number;
  sizeX: number;
  sizeZ: number;
}

interface RoadSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** The eight surface weights at one point, plus the colour they blend to. */
interface SurfaceSample {
  colour: THREE.Color;
  grass: number;
  dry: number;
  rock: number;
  gravel: number;
  dirt: number;
  mud: number;
  cobble: number;
  wet: number;
  /** Signed perpendicular distance to the nearest road, remapped onto 0..1. 0.5 is no road. */
  roadPerpendicular: number;
  /** 1 where a road is close enough for wheel ruts to exist. */
  roadPresence: number;
}

function emptySurface(): SurfaceSample {
  return {
    colour: new THREE.Color(),
    grass: 1, dry: 0, rock: 0, gravel: 0,
    dirt: 0, mud: 0, cobble: 0, wet: 0,
    roadPerpendicular: 0.5, roadPresence: 0,
  };
}

function toByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/** Packs one surface sample into the three Uint8 vertex attributes the ground shader reads. */
function writeSplat(
  splatA: Uint8Array,
  splatB: Uint8Array,
  extra: Uint8Array,
  index: number,
  surface: SurfaceSample,
): void {
  splatA[index * 4] = toByte(surface.grass);
  splatA[index * 4 + 1] = toByte(surface.dry);
  splatA[index * 4 + 2] = toByte(surface.rock);
  splatA[index * 4 + 3] = toByte(surface.gravel);
  splatB[index * 4] = toByte(surface.dirt);
  splatB[index * 4 + 1] = toByte(surface.mud);
  splatB[index * 4 + 2] = toByte(surface.cobble);
  splatB[index * 4 + 3] = toByte(surface.wet);
  extra[index * 4] = toByte(surface.roadPerpendicular);
  extra[index * 4 + 1] = toByte(surface.roadPresence);
  extra[index * 4 + 2] = 0;
  extra[index * 4 + 3] = 0;
}

interface GroundSwatches {
  low: THREE.Color;
  high: THREE.Color;
  rock: THREE.Color;
  gravel: THREE.Color;
  dirt: THREE.Color;
  mud: THREE.Color;
  cobble: THREE.Color;
  wet: THREE.Color;
}

/**
 * The palette swatches the terrain blends between, as linear colours, cached per region.
 *
 * Hue lives in `REGION_PALETTES` and in `materials.surfaceColour`; the terrain only weights them.
 * The cache exists because `sampleSurface` runs ~73k times and allocating eight `THREE.Color`
 * objects per call was the largest single cost in the chunk builder.
 */
const SWATCH_CACHE = new Map<RegionId, GroundSwatches>();

function swatchesFor(regionId: RegionId): GroundSwatches {
  const cached = SWATCH_CACHE.get(regionId);
  if (cached) return cached;
  const palette = REGION_PALETTES[regionId];
  const swatches: GroundSwatches = {
    low: new THREE.Color(palette.groundLow),
    high: new THREE.Color(palette.groundHigh),
    rock: new THREE.Color(palette.rock),
    gravel: new THREE.Color(surfaceColour(regionId, "gravel")),
    dirt: new THREE.Color(surfaceColour(regionId, "dirt")),
    mud: new THREE.Color(surfaceColour(regionId, "mud")),
    cobble: new THREE.Color(surfaceColour(regionId, "cobble")),
    wet: new THREE.Color(surfaceColour(regionId, "wet")),
  };
  SWATCH_CACHE.set(regionId, swatches);
  return swatches;
}

/** The height range a region's own field produces over its rect, swept at 4 m. Costs about 6 ms. */
function sweepFieldRange(rect: Rect, height: (x: number, z: number) => number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let z = rect.minZ; z <= rect.maxZ; z += 4) {
    for (let x = rect.minX; x <= rect.maxX; x += 4) {
      const value = height(x, z);
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-3) return { min: 0, max: 1 };
  return { min, max };
}

/** How far a pad's core reaches from its centre, in metres. Half-diagonal for a rectangle. */
function padReach(flat: FlatSpot): number {
  if (!flat.halfExtents) return flat.radius;
  return Math.hypot(flat.halfExtents[0], flat.halfExtents[1]);
}

/** Distance from a point to the edge of a pad's core. Zero or negative inside it. */
function padDistance(flat: FlatSpot, x: number, z: number): number {
  if (!flat.halfExtents) return Math.hypot(x - flat.x, z - flat.z) - flat.radius;
  return rectDistance(x, z, [flat.x, flat.z], flat.halfExtents, flat.rotationY ?? 0);
}

/**
 * Signed distance from a point to a rotated rectangle: 0 on the boundary, negative inside.
 *
 * Inside is the negative of the distance to the nearest edge, which is what makes a rectangular
 * pad's core weight rise toward its middle exactly the way a circular pad's does.
 */
function rectDistance(
  x: number,
  z: number,
  centre: readonly [number, number],
  halfExtents: readonly [number, number],
  rotationY: number,
): number {
  const dx = x - centre[0];
  const dz = z - centre[1];
  const cos = Math.cos(-rotationY);
  const sin = Math.sin(-rotationY);
  const lx = Math.abs(dx * cos - dz * sin) - halfExtents[0];
  const lz = Math.abs(dx * sin + dz * cos) - halfExtents[1];
  const outside = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
  const inside = Math.min(Math.max(lx, lz), 0);
  return outside + inside;
}

function cellKey(cx: number, cz: number): number {
  // 20 bits per axis, biased into the positive range. The world is 700 x 400 m at 8 m per cell, so
  // this cannot collide for anything the game is able to build.
  return ((cx + 0x40000) << 20) ^ (cz + 0x40000);
}

/**
 * Turns a `content/regions.ts` `PavingDef.rect` into a stamp.
 *
 * Exported so the wiring in boot cannot get the centre/half-extent conversion wrong: the content
 * layer authors paving as an axis-aligned min/max rect and the stamp works in centre-plus-extent,
 * and a sign error there would put a cobbled square in the wrong half of a settlement.
 */
export function pavingStampFromRect(rect: {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}): PavingStamp {
  return {
    centre: [(rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2],
    halfExtents: [Math.abs(rect.maxX - rect.minX) / 2, Math.abs(rect.maxZ - rect.minZ) / 2],
  };
}

/** Chops a polyline into short segments for the road distance grid. */
function appendRoadSegments(into: RoadSegment[], points: readonly Vec3[]): void {
  const samples = resamplePolyline(points, ROAD_SEGMENT_SPACING);
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    into.push({ ax: a[0], az: a[2], bx: b[0], bz: b[2] });
  }
}

/**
 * Bends a straight authored link into a route.
 *
 * Roads were interpolated linearly between two location positions, so there was not one curve in
 * the world's road network: terrain-march_road is four dead-straight gradients radiating from a
 * point. The two interior control points are offset perpendicular to the link by up to 9% of its
 * length and the result is resampled through a Catmull-Rom, which reads as a route that went
 * around something without ever wandering far enough to leave the corridor that scatter is
 * already excluded from.
 *
 * The route graph is unaffected. It works on node ids, and both endpoints here are untouched, so
 * the distance ledger the Agility route flip is measured against does not move.
 */
export function curveRoadPolyline(points: readonly Vec3[], seed: number): Vec3[] {
  if (points.length < 2) return points.map((point) => [point[0], point[1], point[2]] as Vec3);
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const length = Math.hypot(dx, dz);
  if (length < 12) return points.map((point) => [point[0], point[1], point[2]] as Vec3);

  const rng = new Rng(seed);
  const nx = -dz / length;
  const nz = dx / length;
  const sway = Math.min(ROAD_MAX_SWAY, length * 0.09);
  const control: THREE.Vector3[] = [new THREE.Vector3(start[0], 0, start[2])];
  for (let i = 1; i <= 2; i += 1) {
    const t = i / 3;
    const offset = rng.float(-sway, sway);
    control.push(new THREE.Vector3(start[0] + dx * t + nx * offset, 0, start[2] + dz * t + nz * offset));
  }
  control.push(new THREE.Vector3(end[0], 0, end[2]));

  const curve = new THREE.CatmullRomCurve3(control, false, "catmullrom", 0.5);
  const divisions = Math.max(4, Math.round(length / ROAD_SEGMENT_SPACING));
  return curve.getSpacedPoints(divisions).map((point) => [point.x, 0, point.z] as Vec3);
}

/** Even-ish resampling of a polyline, so road corridors do not stretch across long segments. */
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
