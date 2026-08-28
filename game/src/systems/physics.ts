/**
 * Rapier world. Phase 1 uses it for static collision and ground queries; the navmesh does the
 * pathing. Init must complete before any world building (runs/corealm/stack-findings.md section 1).
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { Vec3 } from "../contracts.js";

export class Physics {
  world: RAPIER.World | null = null;
  private ready = false;

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

  /** Static trimesh collider from a Three.js mesh. Used for terrain and buildings. */
  addStaticMesh(mesh: THREE.Mesh): void {
    if (!this.world) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;

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
  }

  /** Ground height under a point, via a downward ray. Null when nothing is hit. */
  groundHeight(point: Vec3, maxDrop = 60): number | null {
    if (!this.world) return null;
    const ray = new RAPIER.Ray({ x: point[0], y: point[1] + 20, z: point[2] }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDrop, true);
    if (!hit) return null;
    return point[1] + 20 - hit.timeOfImpact;
  }

  step(): void {
    this.world?.step();
  }

  dispose(): void {
    this.world?.free();
    this.world = null;
    this.ready = false;
  }
}
