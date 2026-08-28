/**
 * Dungeon interior geometry.
 *
 * The Gravelmaw was authored as chamber centres, radii and floor offsets — positions with nothing
 * underneath them. Everything in it therefore sat in mid-air over Karrowmoor's surface: entering
 * the dungeon snapped the player back up to the terrain, and Ordrun chased them, decided he was too
 * far from home, and walked back. A dungeon needs a floor before it can be a place.
 *
 * The interior is built rather than placed because the free asset library has no modular dungeon
 * kit (see `runs/corealm/asset-report.md`). Floors, walls and connecting corridors are generated
 * from the same chamber data the semantic entities use, so the two cannot disagree about where the
 * rooms are.
 */
import * as THREE from "three";
import type { RegionId, Vec3 } from "../contracts.js";
import type { MaterialLibrary } from "./materials.js";
import { REGION_PALETTES } from "./materials.js";

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
  /** Floors and corridor decks — the surfaces the navmesh is generated from. */
  walkable: THREE.Mesh[];
  /** Walls and ceilings, which must block the navmesh without being walked on. */
  blockers: THREE.Mesh[];
  triangles: number;
}

const WALL_THICKNESS = 1.2;

/**
 * Builds a dungeon's interior.
 *
 * Floors are discs and corridor decks are ribbons, both sunk to their authored height. Walls ring
 * each chamber with a gap where a corridor meets it, so the rooms connect on one navmesh instead of
 * becoming three sealed islands.
 */
export function buildDungeon(spec: DungeonSpec, materials: MaterialLibrary): BuiltDungeon {
  const group = new THREE.Group();
  group.name = `dungeon-${spec.regionId}`;
  const walkable: THREE.Mesh[] = [];
  const blockers: THREE.Mesh[] = [];
  let triangles = 0;

  const palette = REGION_PALETTES[spec.regionId] ?? REGION_PALETTES.gravelmaw;
  const floorMaterial = materials.surface(palette.groundLow, 0.98, 0);
  const wallMaterial = materials.surface(palette.rock, 0.95, 0);

  const count = (geometry: THREE.BufferGeometry): number => {
    const index = geometry.getIndex();
    return index ? index.count / 3 : geometry.getAttribute("position").count / 3;
  };

  for (const chamber of spec.chambers) {
    // Out to the wall, not to the chamber radius. A floor that stops at the play radius leaves a
    // 1.2 m annular gap under the wall, and the sky shows straight through it as a bright ring.
    const floorGeometry = new THREE.CircleGeometry(chamber.radius + WALL_THICKNESS, 28);
    floorGeometry.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.set(chamber.centre[0], chamber.floorY, chamber.centre[1]);
    floor.name = `dungeon-floor-${chamber.id}`;
    floor.receiveShadow = true;
    group.add(floor);
    walkable.push(floor);
    triangles += count(floorGeometry);

    // An open-topped cylinder ring for the walls. Rendered from the inside, which is the only side
    // a player ever sees, and steep enough that recast drops it from the walkable surface.
    const wallGeometry = new THREE.CylinderGeometry(
      chamber.radius + WALL_THICKNESS, chamber.radius + WALL_THICKNESS,
      spec.wallHeight, 28, 1, true,
    );
    // A cloned material so flipping the face direction does not flip every wall in the game that
    // shares the cached original.
    const insideFacing = wallMaterial.clone();
    insideFacing.side = THREE.BackSide;
    const wall = new THREE.Mesh(wallGeometry, insideFacing);
    wall.position.set(chamber.centre[0], chamber.floorY + spec.wallHeight / 2, chamber.centre[1]);
    wall.name = `dungeon-wall-${chamber.id}`;
    wall.receiveShadow = true;
    group.add(wall);
    blockers.push(wall);
    triangles += count(wallGeometry);

    // A ceiling, so looking up from inside does not show the sky through the moor.
    const ceilingGeometry = new THREE.CircleGeometry(chamber.radius + WALL_THICKNESS, 28);
    ceilingGeometry.rotateX(Math.PI / 2);
    const ceiling = new THREE.Mesh(ceilingGeometry, wallMaterial);
    ceiling.position.set(chamber.centre[0], chamber.floorY + spec.wallHeight, chamber.centre[1]);
    ceiling.name = `dungeon-ceiling-${chamber.id}`;
    group.add(ceiling);
    blockers.push(ceiling);
    triangles += count(ceilingGeometry);
  }

  for (const [index, corridor] of spec.corridors.entries()) {
    const deck = corridorDeck(corridor);
    const mesh = new THREE.Mesh(deck, floorMaterial);
    mesh.name = `dungeon-corridor-${index}`;
    mesh.receiveShadow = true;
    group.add(mesh);
    walkable.push(mesh);
    triangles += count(deck);
  }

  return { group, walkable, blockers, triangles };
}

/**
 * A sloped ribbon between two chamber floors.
 *
 * Chambers descend, so a corridor is a ramp. It is built as one quad rather than steps because a
 * step taller than the navmesh's climb height silently severs the connection.
 */
function corridorDeck(corridor: CorridorSpec): THREE.BufferGeometry {
  const dx = corridor.to[0] - corridor.from[0];
  const dz = corridor.to[1] - corridor.from[1];
  const length = Math.hypot(dx, dz) || 1;
  const nx = -dz / length;
  const nz = dx / length;
  const half = corridor.width / 2;

  // Extended slightly past both ends so the ramp overlaps each chamber floor rather than leaving a
  // hairline gap that recast would read as two disconnected regions.
  const overlapX = (dx / length) * 1.5;
  const overlapZ = (dz / length) * 1.5;

  const positions = new Float32Array([
    corridor.from[0] - overlapX + nx * half, corridor.fromY, corridor.from[1] - overlapZ + nz * half,
    corridor.from[0] - overlapX - nx * half, corridor.fromY, corridor.from[1] - overlapZ - nz * half,
    corridor.to[0] + overlapX + nx * half, corridor.toY, corridor.to[1] + overlapZ + nz * half,
    corridor.to[0] + overlapX - nx * half, corridor.toY, corridor.to[1] + overlapZ - nz * half,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

/** A torch-lit glow per chamber, so an unlit room reads as dark rather than as unfinished. */
export function addChamberLights(spec: DungeonSpec, group: THREE.Group): THREE.PointLight[] {
  const lights: THREE.PointLight[] = [];

  // A dim ambient floor so nothing underground is a pure black silhouette. Scoped to the dungeon
  // group, which is only visible from inside, so it never leaks onto the surface.
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
    light.position.set(chamber.centre[0], chamber.floorY + 4.5, chamber.centre[1]);
    light.name = `dungeon-light-${chamber.id}`;
    group.add(light);
    lights.push(light);
  }
  return lights;
}

/** Where a chamber's floor actually is, for placing entities on it. */
export function chamberFloorAt(spec: DungeonSpec, point: Vec3): number | null {
  for (const chamber of spec.chambers) {
    const distance = Math.hypot(point[0] - chamber.centre[0], point[2] - chamber.centre[1]);
    if (distance <= chamber.radius) return chamber.floorY;
  }
  return null;
}
