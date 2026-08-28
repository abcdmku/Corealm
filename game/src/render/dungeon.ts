/**
 * Dungeon interior geometry.
 *
 * The Gravelmaw was authored as chamber centres, radii and floor offsets — positions with nothing
 * underneath them. Everything in it therefore sat in mid-air over Karrowmoor's surface: entering
 * the dungeon snapped the player back up to the terrain, and Ordrun chased them, decided he was too
 * far from home, and walked back. A dungeon needs a floor before it can be a place.
 *
 * The interior is built rather than placed because the free asset library has no modular dungeon
 * kit (see `runs/corealm/asset-report.md`).
 *
 * Rebuilt in the world-polish wave, because the round-1 version was three separate rooms that could
 * not have worked. Measured from the authored data in `content/regions.ts`: chamber centres sit
 * 20.6 m and 19.7 m apart with wall radii of 12.2, 13.2 and 13.2 m, so consecutive chambers OVERLAP
 * by 4.8 m and 6.7 m. Three consequences followed, and all three are fixed here:
 *
 *  - Each chamber got a full 360-degree wall ring, so every ring drove a solid wall straight through
 *    the middle of its neighbour's room and sealed the two apart. The comment that used to sit on
 *    that code claimed the rings had "a gap where a corridor meets it". They did not; there was no
 *    gap logic anywhere in the file.
 *  - Each chamber got a flat floor disc at its own height, and consecutive discs overlap, so the
 *    upper disc hung 4 m above the lower one as an unreachable shelf (`NAV_CONFIG.walkableClimb` is
 *    2 voxels = 0.4 m).
 *  - Corridors ran centre to centre at a linear slope, which put the first 9.3 m of every ramp
 *    UNDERNEATH the floor disc it started from, with less than the 1.8 m of clearance Recast needs.
 *
 * The replacement is one continuous cavern surface: a single height field over the union of the
 * chamber footprints, blended between the authored floor heights, with the walls following the
 * outline of that union rather than each chamber's own circle. The chambers keep their authored
 * centres, radii and floor heights; what changes is that the space between them is now floor.
 */
import * as THREE from "three";
import type { RegionId, SolidVolume, Vec3 } from "../contracts.js";
import type { MaterialLibrary } from "./materials.js";
import { REGION_PALETTES } from "./materials.js";
import { Rng } from "../core/rng.js";

export interface ChamberSpec {
  id: string;
  name: string;
  /** World-space centre. */
  centre: [number, number];
  radius: number;
  /** Absolute floor height. */
  floorY: number;
  lit: boolean;
}

export interface CorridorSpec {
  from: [number, number];
  to: [number, number];
  fromY: number;
  toY: number;
  width: number;
}

export interface DungeonSpec {
  regionId: RegionId;
  chambers: ChamberSpec[];
  corridors: CorridorSpec[];
  /** Interior height, floor to ceiling. */
  wallHeight: number;
}

export interface BuiltDungeon {
  group: THREE.Group;
  /** The cavern floor — the surface the navmesh is generated from. One mesh, not one per chamber. */
  walkable: THREE.Mesh[];
  /** Walls and ceilings, which must block the navmesh without being walked on. */
  blockers: THREE.Mesh[];
  triangles: number;
}

/** How far the rock wall stands outside a chamber's play radius. */
const WALL_THICKNESS = 1.2;

/**
 * Floor grid resolution.
 *
 * 1.25 m is finer than Recast's own 0.45 m large-world cell only needs, but the grid also carries
 * the vertex-colour contact darkening, and at 2.5 m the darkening banded visibly across a chamber.
 */
const FLOOR_CELL_METRES = 1.25;

/**
 * How far the floor runs past the wall line.
 *
 * The floor is a square grid and the wall is an arc, so their edges cannot coincide. Running the
 * floor 1.6 m past the wall puts the ragged grid edge behind opaque rock from every point a player
 * can stand, which is cheaper than clipping the grid to the circle and produces no seam.
 */
const FLOOR_MARGIN_METRES = 1.6;

/** Arc resolution of a chamber wall. Chord at the Gravelmaw's 12.2 m radius is 1.91 m. */
const WALL_SEGMENTS = 40;

/**
 * Wall segments per emitted collision box.
 *
 * Two segments span 3.8 m of arc whose sagitta is R * (1 - cos(9 deg)) = 0.15 m, which is under the
 * player radius, so the box approximation never pushes anyone out of a metre they could see floor
 * under. Halves the collider count against one box per rendered segment.
 */
const SOLID_SEGMENT_STRIDE = 2;

/** Metres the wall overlaps the floor below and the ceiling above, so no hairline gap can show. */
const WALL_OVERLAP = 0.5;

/**
 * How much of the sky's image lighting reaches a cave.
 *
 * `scene.environment` is global in three — it lights every standard material in the scene no matter
 * where the geometry is. Left at 1.0 the Gravelmaw is lit by the sky it is buried under. 0.12 keeps
 * a trace so the rock is not a flat silhouette between torches.
 */
const INTERIOR_ENV_INTENSITY = 0.12;

/**
 * Opt-in wiring the dungeon cannot work out for itself.
 *
 * `ceilingAt` is the one that matters. `wallHeight` is authored as 13 m in `boot.ts` with the note
 * "tall enough to reach the terrain above", and it overshoots: with chamber floors at 17.9, 13.9 and
 * 9.9 m the ceilings land at 30.9, 26.9 and 22.9 m, and Karrowmoor's surface above them is lower
 * than that. The chamber volume comes out of the moor, and because a terrain backface is culled the
 * player looks THROUGH the hillside at daylight — two bright green wedges, measured in
 * `sky-dungeon-chamber3-up.png`. Hand this the terrain sampler and the roof stops where the rock
 * does.
 */
export interface DungeonOptions {
  /** The highest a ceiling may sit at this world XZ. Normally the terrain height less a margin. */
  ceilingAt?: (x: number, z: number) => number;
}

/** Never squash a chamber below this, whatever `ceilingAt` says. A cave you cannot stand in is worse. */
const MIN_HEADROOM = 4;

interface FloorGrid {
  minX: number;
  minZ: number;
  cells: number;
  columns: number;
  rows: number;
  /** Per grid corner, in row-major order over (rows + 1) x (columns + 1). */
  height: Float32Array;
  depth: Float32Array;
  /** Whether the cell at [row * columns + column] is inside the cavern. */
  filled: Uint8Array;
}

/**
 * Builds a dungeon's interior.
 *
 * Returns three meshes: one floor, one merged wall, one merged ceiling. Round 1 returned eleven
 * (three floors, three walls, three ceilings, two corridor decks); the merge is possible because
 * every wall now shares one material and one winding, and it costs the interior 3 draw calls
 * instead of 11 whenever the player is underground.
 */
export function buildDungeon(
  spec: DungeonSpec,
  // Retained so `boot.ts` compiles unchanged. The dungeon builds its own two materials now: both
  // need vertex colours for the contact darkening, and both need a near-zero `envMapIntensity`,
  // neither of which can be asked of the shared library without changing the surface world too.
  _materials: MaterialLibrary,
  options?: DungeonOptions,
): BuiltDungeon {
  const group = new THREE.Group();
  group.name = `dungeon-${spec.regionId}`;
  const walkable: THREE.Mesh[] = [];
  const blockers: THREE.Mesh[] = [];
  let triangles = 0;

  const palette = REGION_PALETTES[spec.regionId] ?? REGION_PALETTES.gravelmaw;
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.97, metalness: 0,
    envMapIntensity: INTERIOR_ENV_INTENSITY,
  });
  floorMaterial.name = "dungeon-floor";
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true,
    envMapIntensity: INTERIOR_ENV_INTENSITY,
  });
  rockMaterial.name = "dungeon-rock";

  const grid = buildFloorGrid(spec);

  const floorGeometry = buildFloorGeometry(grid, palette.groundLow, false);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = "dungeon-floor";
  floor.receiveShadow = true;
  group.add(floor);
  walkable.push(floor);
  triangles += triangleCount(floorGeometry);

  const ceilingGeometry = buildFloorGeometry(grid, palette.rock, true, spec.wallHeight, options);
  const ceiling = new THREE.Mesh(ceilingGeometry, rockMaterial);
  ceiling.name = "dungeon-ceiling";
  group.add(ceiling);
  blockers.push(ceiling);
  triangles += triangleCount(ceilingGeometry);

  const wallGeometry = buildWallGeometry(spec, palette.rock, options);
  const wall = new THREE.Mesh(wallGeometry, rockMaterial);
  wall.name = "dungeon-wall";
  wall.receiveShadow = true;
  group.add(wall);
  blockers.push(wall);
  triangles += triangleCount(wallGeometry);

  return { group, walkable, blockers, triangles };
}

/**
 * The height of the cavern floor at a world XZ.
 *
 * Inverse-distance weighting over the authored chamber floors, cubed. The exponent is the whole
 * design: at p = 3 the surface is within 0.21 m of the authored floor height across a chamber's own
 * disc, and the steepest gradient between two chambers is `drop * p / separation` = 4 * 3 / 20.6 =
 * 30 degrees, which clears `NAV_CONFIG.walkableSlopeAngle` (48) with margin. p = 2 would flatten the
 * ramp to 21 degrees but bow each chamber floor 0.88 m below its authored height at the rim; p = 4
 * holds the floors flat but ramps at 38 degrees.
 */
export function dungeonFloorHeight(spec: DungeonSpec, x: number, z: number): number {
  let weighted = 0;
  let total = 0;
  for (const chamber of spec.chambers) {
    const distance = Math.hypot(x - chamber.centre[0], z - chamber.centre[1]);
    const weight = 1 / (distance * distance * distance + 0.05);
    weighted += chamber.floorY * weight;
    total += weight;
  }
  return total > 0 ? weighted / total : 0;
}

/** The roof height at a world XZ, clamped under the rock when a `ceilingAt` sampler is supplied. */
function ceilingHeightAt(spec: DungeonSpec, x: number, z: number, options?: DungeonOptions): number {
  const floor = dungeonFloorHeight(spec, x, z);
  const wanted = floor + spec.wallHeight;
  const limit = options?.ceilingAt?.(x, z);
  if (limit === undefined || !Number.isFinite(limit)) return wanted;
  return Math.max(floor + MIN_HEADROOM, Math.min(wanted, limit));
}

/** Where a chamber's floor actually is, for placing entities on it. */
export function chamberFloorAt(spec: DungeonSpec, point: Vec3): number | null {
  for (const chamber of spec.chambers) {
    const distance = Math.hypot(point[0] - chamber.centre[0], point[2] - chamber.centre[1]);
    // The blended surface, not `chamber.floorY`. The two differ by up to 2.4 m near the mouth of a
    // chamber that overlaps a deeper one, and returning the authored constant is what left dungeon
    // entities standing in the air over the ramp down to the next room.
    if (distance <= chamber.radius) return dungeonFloorHeight(spec, point[0], point[2]);
  }
  return null;
}

/**
 * Collision volumes for the dungeon shell, in the frozen `SolidVolume` shape.
 *
 * Why this exists: the camera films the Gravelmaw from OUTSIDE the rock. Measured over a 1,001
 * frame walk through the chamber, the occlusion probe reported 0 occluded frames and the camera sat
 * at y = 22.36 while the player stood on a floor at roughly y = 6 — because `buildDungeon`'s meshes
 * were added to the scene and never handed to `physics.addStaticBox`, so the Rapier world contained
 * nothing at all underground for a ray to hit.
 *
 * Two things a caller must know:
 *  - `position.y` is the BASE of each volume, per the contract.
 *  - Pass the same `ceilingAt` here that `buildDungeon` got, or the collision roof sits above the
 *    rendered one.
 *  - The ceiling volumes must NOT be turned into navmesh obstacles. Each one spans a whole chamber
 *    footprint, so carving it would delete the room from the navmesh. Pass
 *    `{ includeCeilings: false }` for the navmesh and the full list to physics.
 *
 * These are also the one place the "half-diagonal under INTERACT_RANGE" rule in `contracts.ts` is
 * deliberately broken: that rule exists so `moveTo({ entityId })` can still reach the entity a
 * volume wraps, and a wall wraps no entity.
 */
export function dungeonSolids(
  spec: DungeonSpec,
  options?: DungeonOptions & { includeCeilings?: boolean },
): SolidVolume[] {
  const volumes: SolidVolume[] = [];
  const includeCeilings = options?.includeCeilings ?? true;

  for (const chamber of spec.chambers) {
    const outer = chamber.radius + WALL_THICKNESS;
    const jitter = wallJitter(chamber);
    for (let index = 0; index < WALL_SEGMENTS; index += SOLID_SEGMENT_STRIDE) {
      const from = (index / WALL_SEGMENTS) * Math.PI * 2;
      const to = ((index + SOLID_SEGMENT_STRIDE) / WALL_SEGMENTS) * Math.PI * 2;
      const middle = (from + to) / 2;
      if (isOpening(spec, chamber, middle, outer)) continue;
      const radius = outer * jitter(index);
      const x = chamber.centre[0] + Math.cos(middle) * radius;
      const z = chamber.centre[1] + Math.sin(middle) * radius;
      const chord = 2 * radius * Math.sin((to - from) / 2);
      volumes.push({
        kind: "box",
        id: `dungeon-wall-${chamber.id}-${index}`,
        position: [x, dungeonFloorHeight(spec, x, z) - WALL_OVERLAP, z],
        size: [chord * 1.08, spec.wallHeight + WALL_OVERLAP * 2, WALL_THICKNESS],
        // Local +X runs along the tangent. Rotating by -(a + pi/2) maps (1,0,0) onto
        // (-sin a, 0, cos a), which is the tangent at angle a.
        rotationY: -(middle + Math.PI / 2),
      });
    }

    if (!includeCeilings) continue;
    const ceilingBase = ceilingHeightAt(spec, chamber.centre[0], chamber.centre[1], options);
    volumes.push({
      kind: "box",
      id: `dungeon-ceiling-${chamber.id}`,
      position: [chamber.centre[0], ceilingBase, chamber.centre[1]],
      size: [outer * 2, 1.2, outer * 2],
      rotationY: 0,
    });
  }

  return volumes;
}

/** A torch-lit glow per chamber, so an unlit room reads as dark rather than as unfinished. */
export function addChamberLights(spec: DungeonSpec, group: THREE.Group): THREE.PointLight[] {
  const lights: THREE.PointLight[] = [];

  // A dim ambient floor so nothing underground is a pure black silhouette. Parented to the dungeon
  // group, which `loop.addInterior` hides whenever the player is on the surface — and three skips
  // lights under an invisible ancestor entirely, so this genuinely never leaks outdoors.
  const ambient = new THREE.HemisphereLight(0x4a4038, 0x1a1614, 0.9);
  ambient.name = "dungeon-ambient";
  group.add(ambient);

  for (const chamber of spec.chambers) {
    // Underground has no sun, so the only light is what the chamber provides. These are much
    // brighter than a surface fill because the scene's directional light contributes nothing here,
    // and a decay of 1.0 rather than 1.6 keeps the chamber edges readable instead of pitch black.
    const light = new THREE.PointLight(
      chamber.lit ? 0xffc07a : 0xd07a45,
      chamber.lit ? 90 : 55,
      chamber.radius * 3.4,
      1.0,
    );
    const floorY = dungeonFloorHeight(spec, chamber.centre[0], chamber.centre[1]);
    light.position.set(chamber.centre[0], floorY + 4.5, chamber.centre[1]);
    light.name = `dungeon-light-${chamber.id}`;
    group.add(light);
    lights.push(light);
  }
  return lights;
}

// ----------------------------------------------------------------- geometry

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return index ? index.count / 3 : geometry.getAttribute("position").count / 3;
}

/**
 * A cell grid over the union of every chamber footprint and every corridor, with the blended floor
 * height and an "how far inside the cavern is this" depth at each corner.
 */
function buildFloorGrid(spec: DungeonSpec): FloorGrid {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const chamber of spec.chambers) {
    const reach = chamber.radius + WALL_THICKNESS + FLOOR_MARGIN_METRES;
    minX = Math.min(minX, chamber.centre[0] - reach);
    maxX = Math.max(maxX, chamber.centre[0] + reach);
    minZ = Math.min(minZ, chamber.centre[1] - reach);
    maxZ = Math.max(maxZ, chamber.centre[1] + reach);
  }
  for (const corridor of spec.corridors) {
    const reach = corridor.width / 2 + FLOOR_MARGIN_METRES;
    minX = Math.min(minX, corridor.from[0] - reach, corridor.to[0] - reach);
    maxX = Math.max(maxX, corridor.from[0] + reach, corridor.to[0] + reach);
    minZ = Math.min(minZ, corridor.from[1] - reach, corridor.to[1] - reach);
    maxZ = Math.max(maxZ, corridor.from[1] + reach, corridor.to[1] + reach);
  }
  if (!Number.isFinite(minX)) {
    minX = 0; maxX = 0; minZ = 0; maxZ = 0;
  }

  const columns = Math.max(1, Math.ceil((maxX - minX) / FLOOR_CELL_METRES));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / FLOOR_CELL_METRES));
  const height = new Float32Array((columns + 1) * (rows + 1));
  const depth = new Float32Array((columns + 1) * (rows + 1));
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const x = minX + column * FLOOR_CELL_METRES;
      const z = minZ + row * FLOOR_CELL_METRES;
      const corner = row * (columns + 1) + column;
      height[corner] = dungeonFloorHeight(spec, x, z);
      depth[corner] = cavernDepth(spec, x, z);
    }
  }

  const filled = new Uint8Array(columns * rows);
  let cells = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = minX + (column + 0.5) * FLOOR_CELL_METRES;
      const z = minZ + (row + 0.5) * FLOOR_CELL_METRES;
      if (cavernDepth(spec, x, z) < -FLOOR_MARGIN_METRES) continue;
      filled[row * columns + column] = 1;
      cells += 1;
    }
  }

  return { minX, minZ, cells, columns, rows, height, depth, filled };
}

/**
 * Metres from a point to the outside of the cavern. Positive inside the wall line, negative past it.
 *
 * Corridors count as inside so that a spec whose chambers do NOT overlap still gets a floor between
 * them. In the authored Gravelmaw every corridor lies entirely inside the union of the chamber
 * discs (they overlap by 4.8 m and 6.7 m), so this term contributes nothing there.
 */
function cavernDepth(spec: DungeonSpec, x: number, z: number): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const chamber of spec.chambers) {
    const outer = chamber.radius + WALL_THICKNESS;
    best = Math.max(best, outer - Math.hypot(x - chamber.centre[0], z - chamber.centre[1]));
  }
  for (const corridor of spec.corridors) {
    const distance = distanceToSegment(x, z, corridor.from[0], corridor.from[1], corridor.to[0], corridor.to[1]);
    best = Math.max(best, corridor.width / 2 - distance);
  }
  return best;
}

function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0) return Math.hypot(x - ax, z - az);
  let t = ((x - ax) * dx + (z - az) * dz) / lengthSquared;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

/**
 * The floor, or the ceiling when `flip` is set.
 *
 * Corner positions are shared between cells so `computeVertexNormals` gives the floor a smooth
 * surface across the ramps; only the cells inside the cavern are indexed, so the corners outside it
 * cost 32 bytes each and nothing else.
 */
function buildFloorGeometry(
  grid: FloorGrid,
  baseColour: number,
  flip: boolean,
  lift = 0,
  options?: DungeonOptions,
): THREE.BufferGeometry {
  const cornerColumns = grid.columns + 1;
  const cornerCount = cornerColumns * (grid.rows + 1);
  const positions = new Float32Array(cornerCount * 3);
  const colours = new Float32Array(cornerCount * 3);
  const tint = new THREE.Color().setHex(baseColour, THREE.SRGBColorSpace);

  for (let row = 0; row <= grid.rows; row += 1) {
    for (let column = 0; column < cornerColumns; column += 1) {
      const corner = row * cornerColumns + column;
      const x = grid.minX + column * FLOOR_CELL_METRES;
      const z = grid.minZ + row * FLOOR_CELL_METRES;
      const base = grid.height[corner] ?? 0;
      const limit = options?.ceilingAt?.(x, z) ?? Number.POSITIVE_INFINITY;
      const y = lift === 0 ? base : Math.max(base + MIN_HEADROOM, Math.min(base + lift, limit));
      positions[corner * 3] = x;
      positions[corner * 3 + 1] = y;
      positions[corner * 3 + 2] = z;
      // Contact darkening. Nothing in this game had any: props, rocks and walls all met the ground
      // at a hard cut with no occlusion term, which is the single biggest reason everything read as
      // floating. Ramping over the last 3.5 m before the wall costs one multiply per vertex.
      const shade = 0.5 + 0.5 * clamp01((grid.depth[corner] ?? 0) / 3.0);
      colours[corner * 3] = tint.r * shade;
      colours[corner * 3 + 1] = tint.g * shade;
      colours[corner * 3 + 2] = tint.b * shade;
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      if (grid.filled[row * grid.columns + column] !== 1) continue;
      const a = row * cornerColumns + column;
      const b = (row + 1) * cornerColumns + column;
      const c = row * cornerColumns + column + 1;
      const d = (row + 1) * cornerColumns + column + 1;
      // (a, b, c) and (b, d, c) wind so the normal is +Y; reversed, it is -Y for the ceiling.
      if (flip) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The rock wall, as arcs around each chamber with the overlaps left open.
 *
 * A segment is dropped when its midpoint falls inside another chamber's wall line, which is what
 * turns two overlapping circles into one figure-of-eight cavern instead of two sealed silos. At the
 * authored Gravelmaw separations that opens a 75-degree arc between chambers 1 and 2.
 */
function buildWallGeometry(spec: DungeonSpec, baseColour: number, options?: DungeonOptions): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const tint = new THREE.Color().setHex(baseColour, THREE.SRGBColorSpace);

  for (const chamber of spec.chambers) {
    const outer = chamber.radius + WALL_THICKNESS;
    const jitter = wallJitter(chamber);
    const lean = wallLean(chamber);

    for (let index = 0; index < WALL_SEGMENTS; index += 1) {
      const a0 = (index / WALL_SEGMENTS) * Math.PI * 2;
      const a1 = ((index + 1) / WALL_SEGMENTS) * Math.PI * 2;
      if (isOpening(spec, chamber, (a0 + a1) / 2, outer)) continue;

      const rb0 = outer * jitter(index);
      const rb1 = outer * jitter(index + 1);
      const rt0 = rb0 * lean(index);
      const rt1 = rb1 * lean(index + 1);

      const b0 = wallVertex(spec, chamber, a0, rb0, -WALL_OVERLAP);
      const b1 = wallVertex(spec, chamber, a1, rb1, -WALL_OVERLAP);
      const t0 = wallTopVertex(spec, chamber, a0, rt0, options);
      const t1 = wallTopVertex(spec, chamber, a1, rt1, options);

      // (b0, b1, t0) and (b1, t1, t0) both wind to (-cos a, 0, -sin a): inward, which is the only
      // face a player ever sees. Round 1 used BackSide on a cloned material to get the same effect;
      // getting the winding right instead means walls, floor and ceiling can share one material.
      pushTriangle(positions, b0, b1, t0);
      pushTriangle(positions, b1, t1, t0);

      // Darker toward the roof, so a 13 m wall does not read as one flat band of rock.
      pushColour(colours, tint, 1.0, 1.0, 0.55);
      pushColour(colours, tint, 1.0, 0.55, 0.55);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colours), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function wallVertex(
  spec: DungeonSpec,
  chamber: ChamberSpec,
  angle: number,
  radius: number,
  lift: number,
): [number, number, number] {
  const x = chamber.centre[0] + Math.cos(angle) * radius;
  const z = chamber.centre[1] + Math.sin(angle) * radius;
  return [x, dungeonFloorHeight(spec, x, z) + lift, z];
}

/** The top of the wall, half a metre into the ceiling so no hairline gap can open between them. */
function wallTopVertex(
  spec: DungeonSpec,
  chamber: ChamberSpec,
  angle: number,
  radius: number,
  options?: DungeonOptions,
): [number, number, number] {
  const x = chamber.centre[0] + Math.cos(angle) * radius;
  const z = chamber.centre[1] + Math.sin(angle) * radius;
  return [x, ceilingHeightAt(spec, x, z, options) + WALL_OVERLAP, z];
}

function pushTriangle(
  out: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): void {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function pushColour(out: number[], tint: THREE.Color, s0: number, s1: number, s2: number): void {
  for (const shade of [s0, s1, s2]) out.push(tint.r * shade, tint.g * shade, tint.b * shade);
}

/**
 * True when this piece of wall would stand inside another chamber.
 *
 * This is the fix for the sealed-rooms bug: with centres 20.6 m apart and wall radii of 12.2 and
 * 13.2 m, `cos(theta) > 0.7938` — a 75-degree arc of chamber 1's wall — falls inside chamber 2.
 */
function isOpening(spec: DungeonSpec, chamber: ChamberSpec, angle: number, radius: number): boolean {
  const x = chamber.centre[0] + Math.cos(angle) * radius;
  const z = chamber.centre[1] + Math.sin(angle) * radius;
  for (const other of spec.chambers) {
    if (other === chamber) continue;
    const outer = other.radius + WALL_THICKNESS;
    if (Math.hypot(x - other.centre[0], z - other.centre[1]) < outer) return true;
  }
  for (const corridor of spec.corridors) {
    const distance = distanceToSegment(x, z, corridor.from[0], corridor.from[1], corridor.to[0], corridor.to[1]);
    if (distance < corridor.width / 2) return true;
  }
  return false;
}

/**
 * Per-angle radius scale, inward only.
 *
 * Inward only on purpose: a wall pushed outward would leave a gap between it and the floor grid's
 * edge, and the void would show through. The 0.95 floor keeps the wall clear of `chamber.radius`
 * (11 m against a jittered minimum of 11.59 m at the Gravelmaw), so nothing shrinks the play area.
 *
 * Seeded from the chamber's own coordinates rather than from a shared stream, so this consumes no
 * draws from any `RngStreams` stream and cannot shift a gather roll or a scatter layout by existing.
 */
function wallJitter(chamber: ChamberSpec): (index: number) => number {
  const values = sampleRing(chamber, 0x9e37, 0.95, 1.0);
  return (index: number) => values[index % WALL_SEGMENTS] ?? 1;
}

/** Per-angle inward lean of the wall top, so the chamber reads as carved rather than as a silo. */
function wallLean(chamber: ChamberSpec): (index: number) => number {
  const values = sampleRing(chamber, 0x51ed, 0.86, 0.96);
  return (index: number) => values[index % WALL_SEGMENTS] ?? 1;
}

function sampleRing(chamber: ChamberSpec, salt: number, low: number, high: number): number[] {
  const seed = (Math.imul(Math.round(chamber.centre[0] * 16), 73856093)
    ^ Math.imul(Math.round(chamber.centre[1] * 16), 19349663)
    ^ salt) >>> 0;
  const rng = new Rng(seed);
  const values: number[] = [];
  for (let index = 0; index < WALL_SEGMENTS; index += 1) values.push(rng.float(low, high));
  return values;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
