/**
 * Rapier world. Phase 1 uses it for static collision and ground queries; the navmesh does the
 * pathing. Init must complete before any world building (runs/corealm/stack-findings.md section 1).
 *
 * Deliberately NO dynamic character controller. Movement is navmesh-driven and authoritative in the
 * store; giving the player a rigid body would create a second source of truth for position, and the
 * two would disagree within a minute of play. Physics here answers two questions only: "what is the
 * ground height under this point" and "does this box overlap a building".
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { Vec3 } from "../contracts.js";

export interface HeightfieldInput {
  /** Column-major, (nrows + 1) * (ncols + 1) entries. `WorldScene.heightfieldSamples` produces it. */
  heights: Float32Array;
  /** Subdivisions along Z. */
  nrows: number;
  /** Subdivisions along X. */
  ncols: number;
  /** Total world extents the field covers. `y` scales the heights and is normally 1. */
  scale: { x: number; y: number; z: number };
  centre: { x: number; y: number; z: number };
}

/** Straight down, then nudged off the cell seam in each diagonal. See `castDown`. */
const CELL_SEAM_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0], [0.01, 0.01], [-0.01, -0.01],
];

export interface PhysicsStats {
  ready: boolean;
  bodies: number;
  colliders: number;
  terrainColliders: number;
  buildingColliders: number;
}

export class Physics {
  world: RAPIER.World | null = null;
  private ready = false;
  private staticBodies: RAPIER.RigidBody[] = [];
  /** Colliders were added since the last step, so the query pipeline is stale. */
  private queriesDirty = false;
  private terrainColliders = 0;
  private buildingColliders = 0;

  static async initLibrary(): Promise<void> {
    await RAPIER.init();
  }

  create(): void {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready && this.world !== null;
  }

  // ----------------------------------------------------------- colliders

  /**
   * The terrain collider, as a heightfield rather than a trimesh.
   *
   * The round-1 world is ~140k triangles of ground. As a trimesh that is a slow build and a fat
   * BVH; as a heightfield it is one array and an O(1) cell lookup per query, which is what makes
   * `groundHeight` cheap enough to call per entity during world construction.
   */
  addHeightfield(field: HeightfieldInput): boolean {
    if (!this.world) return false;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(field.centre.x, field.centre.y, field.centre.z),
    );
    const desc = RAPIER.ColliderDesc.heightfield(
      field.nrows,
      field.ncols,
      field.heights,
      { x: field.scale.x, y: field.scale.y, z: field.scale.z },
    );
    this.world.createCollider(desc, body);
    this.staticBodies.push(body);
    this.terrainColliders += 1;
    this.queriesDirty = true;
    return true;
  }

  /** Static trimesh collider from a Three.js mesh. Used for terrain chunks and buildings. */
  addStaticMesh(mesh: THREE.Mesh, kind: "terrain" | "building" = "terrain"): boolean {
    if (!this.world) return false;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return false;

    mesh.updateMatrixWorld(true);
    const vertices = new Float32Array(position.count * 3);
    const vertex = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
      vertices[i * 3] = vertex.x;
      vertices[i * 3 + 1] = vertex.y;
      vertices[i * 3 + 2] = vertex.z;
    }

    const index = geometry.getIndex();
    const indices = index
      ? new Uint32Array(index.array)
      : new Uint32Array(Array.from({ length: position.count }, (_, i) => i));

    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), body);
    this.staticBodies.push(body);
    if (kind === "terrain") this.terrainColliders += 1;
    else this.buildingColliders += 1;
    this.queriesDirty = true;
    return true;
  }

  /** Every mesh under an object, as one static body each. The building path. */
  addStaticObject(object: THREE.Object3D, kind: "terrain" | "building" = "building"): number {
    let added = 0;
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (this.addStaticMesh(mesh, kind)) added += 1;
    });
    return added;
  }

  /**
   * A static box. Cheaper and more predictable than a trimesh for a wall or a building footprint,
   * and it is what the world layer should register for anything the player must not walk through.
   */
  addStaticBox(centre: Vec3, halfExtents: Vec3, rotationY = 0): boolean {
    if (!this.world) return false;
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(centre[0], centre[1], centre[2])
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfExtents[0], halfExtents[1], halfExtents[2]),
      body,
    );
    this.staticBodies.push(body);
    this.buildingColliders += 1;
    this.queriesDirty = true;
    return true;
  }

  /** A static upright cylinder. Pillars, tree trunks the player should not clip through. */
  addStaticCylinder(centre: Vec3, radius: number, height: number): boolean {
    if (!this.world) return false;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(centre[0], centre[1] + height / 2, centre[2]),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius), body);
    this.staticBodies.push(body);
    this.buildingColliders += 1;
    this.queriesDirty = true;
    return true;
  }

  // -------------------------------------------------------------- rays

  /**
   * Rapier rebuilds its query pipeline inside `step()`, so a collider added since the last step is
   * invisible to `castRay`. World construction adds every static collider and then immediately asks
   * for ground heights, which is exactly that window — without this, every boot-time ground query
   * silently returns null and entities end up at y = 0.
   */
  private ensureQueryable(): void {
    if (!this.queriesDirty || !this.world) return;
    this.world.step();
    this.queriesDirty = false;
  }

  /**
   * Ground height under a point, via a downward ray from well above it.
   *
   * Casting from `point.y + 60` rather than from the point itself matters: entity construction asks
   * for the ground under a position whose y is still 0, and a ray starting below the terrace it is
   * standing on would miss the surface entirely and report nothing.
   */
  groundHeight(point: Vec3, maxDrop = 160, startAbove = 60): number | null {
    const hit = this.castDown(point[0], point[2], point[1] + startAbove, maxDrop, false);
    return hit ? hit.y : null;
  }

  /** Ground height and surface normal. Slope-aware placement wants both. */
  groundHit(x: number, z: number, fromY = 80, maxDrop = 220): { y: number; normal: Vec3 } | null {
    const hit = this.castDown(x, z, fromY, maxDrop, true);
    if (!hit) return null;
    return { y: hit.y, normal: hit.normal ?? [0, 1, 0] };
  }

  /**
   * One downward cast, retried with a 1 cm offset on a miss.
   *
   * Measured, not defensive: a ray that lands exactly on a heightfield cell boundary slips between
   * the two triangles and reports no hit. Entities get placed on round coordinates, the field is
   * sampled every 2.5 m, and round numbers divide by 2.5 — so 8% of naive queries missed and
   * `groundHit(190, 20)` returned null on perfectly solid ground. A 1 cm nudge moves the ray off
   * the seam and changes the answer by under a centimetre even on the steepest Karrowmoor riser.
   */
  private castDown(
    x: number,
    z: number,
    fromY: number,
    maxDrop: number,
    withNormal: boolean,
  ): { y: number; normal?: Vec3 } | null {
    if (!this.world) return null;
    this.ensureQueryable();

    for (const [offsetX, offsetZ] of CELL_SEAM_OFFSETS) {
      const ray = new RAPIER.Ray({ x: x + offsetX, y: fromY, z: z + offsetZ }, { x: 0, y: -1, z: 0 });
      if (withNormal) {
        const hit = this.world.castRayAndGetNormal(ray, maxDrop, true);
        if (hit) return { y: fromY - hit.timeOfImpact, normal: [hit.normal.x, hit.normal.y, hit.normal.z] };
      } else {
        const hit = this.world.castRay(ray, maxDrop, true);
        if (hit) return { y: fromY - hit.timeOfImpact };
      }
    }
    return null;
  }

  /** Generic ray. Returns the hit distance in metres, or null. */
  raycast(origin: Vec3, direction: Vec3, maxDistance = 100): number | null {
    if (!this.world) return null;
    this.ensureQueryable();
    const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
    const ray = new RAPIER.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: direction[0] / length, y: direction[1] / length, z: direction[2] / length },
    );
    const hit = this.world.castRay(ray, maxDistance, true);
    return hit ? hit.timeOfImpact : null;
  }

  /** Is the straight line between two points clear of static geometry? Camera occlusion uses it. */
  lineOfSight(from: Vec3, to: Vec3): boolean {
    const direction: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (length < 0.001) return true;
    const hit = this.raycast(from, direction, length);
    return hit === null || hit >= length - 0.05;
  }

  // ------------------------------------------------------------- upkeep

  step(): void {
    this.world?.step();
    this.queriesDirty = false;
  }

  stats(): PhysicsStats {
    return {
      ready: this.isReady(),
      bodies: this.world?.bodies.len() ?? 0,
      colliders: this.world?.colliders.len() ?? 0,
      terrainColliders: this.terrainColliders,
      buildingColliders: this.buildingColliders,
    };
  }

  /** Drops every static body. Used when the world is rebuilt, not per frame. */
  clearStatic(): void {
    if (!this.world) return;
    for (const body of this.staticBodies) this.world.removeRigidBody(body);
    this.staticBodies = [];
    this.terrainColliders = 0;
    this.buildingColliders = 0;
    this.queriesDirty = true;
  }

  dispose(): void {
    this.staticBodies = [];
    this.terrainColliders = 0;
    this.buildingColliders = 0;
    this.world?.free();
    this.world = null;
    this.ready = false;
  }
}
