/**
 * Scene composition: terrain, the walkable surface the navmesh is built from, and the player view.
 *
 * Round 0 builds the Fallowmarch terrain shell so navigation, movement, and the smoke test have
 * something real to work against. Region content (settlements, resources, dressing) is worker A1/A2
 * territory in round 1 and layers on top of the terrain this file produces.
 */
import * as THREE from "three";
import type { RegionId, Vec3 } from "../contracts.js";
import { GROUND_COLOURS, MaterialLibrary } from "./materials.js";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../app/config.js";
import { Rng } from "../core/rng.js";

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

/** Deterministic value noise. Seeded so terrain is identical across reloads and test runs. */
function makeNoise(seed: number): (x: number, z: number) => number {
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
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
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
    return lerp(
      lerp(grad(aa, xf, zf), grad(ba, xf - 1, zf), u),
      lerp(grad(ab, xf, zf - 1), grad(bb, xf - 1, zf - 1), u),
      v,
    );
  };
}

export class WorldScene {
  readonly root = new THREE.Group();
  readonly terrainGroup = new THREE.Group();
  readonly entityGroup = new THREE.Group();
  readonly overlayGroup = new THREE.Group();

  readonly materials = new MaterialLibrary();

  /** The meshes recast builds the navmesh from. */
  private walkable: THREE.Mesh[] = [];
  private heightSamplers = new Map<RegionId, (x: number, z: number) => number>();

  playerMesh: THREE.Object3D | null = null;

  constructor(parent: THREE.Scene) {
    this.root.name = "corealm-world";
    this.terrainGroup.name = "terrain";
    this.entityGroup.name = "entities";
    this.overlayGroup.name = "overlays";
    this.root.add(this.terrainGroup, this.entityGroup, this.overlayGroup);
    parent.add(this.root);
  }

  /**
   * Builds one region's terrain. Multi-octave value noise gives rolling ground that reads as
   * authored rather than flat, while staying gentle enough that the navmesh stays connected.
   */
  buildTerrain(spec: TerrainSpec): THREE.Mesh {
    const noise = makeNoise(spec.seed);
    const half = spec.size / 2;

    const heightAt = (worldX: number, worldZ: number): number => {
      const nx = (worldX - spec.centre[0]) / spec.size;
      const nz = (worldZ - spec.centre[1]) / spec.size;
      let height = 0;
      let amplitude = 1;
      let frequency = 3.2;
      let normaliser = 0;
      for (let octave = 0; octave < 4; octave += 1) {
        height += noise(nx * frequency, nz * frequency) * amplitude;
        normaliser += amplitude;
        amplitude *= 0.48;
        frequency *= 2.07;
      }
      // Flatten toward the centre so settlements sit on buildable ground.
      const radial = Math.min(1, Math.hypot(nx, nz) * 2.2);
      return (height / normaliser) * spec.amplitude * (0.25 + 0.75 * radial);
    };

    this.heightSamplers.set(spec.regionId, heightAt);

    const geometry = new THREE.PlaneGeometry(spec.size, spec.size, spec.segments, spec.segments);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i) + spec.centre[0];
      const z = position.getZ(i) + spec.centre[1];
      position.setY(i, heightAt(x, z));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    const colour = GROUND_COLOURS[spec.regionId] ?? GROUND_COLOURS.fallowmarch;
    const mesh = new THREE.Mesh(geometry, this.materials.surface(colour, 0.97, 0));
    mesh.name = `terrain-${spec.regionId}`;
    mesh.position.set(spec.centre[0], 0, spec.centre[1]);
    mesh.receiveShadow = true;
    mesh.userData.regionId = spec.regionId;
    mesh.userData.walkable = true;

    this.terrainGroup.add(mesh);
    this.walkable.push(mesh);
    void half;
    return mesh;
  }

  /** Sampled terrain height, for placing entities on the ground without a physics ray. */
  heightAt(regionId: RegionId, x: number, z: number): number {
    const sampler = this.heightSamplers.get(regionId);
    return sampler ? sampler(x, z) : 0;
  }

  getWalkableMeshes(): THREE.Mesh[] {
    return this.walkable;
  }

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

  syncPlayer(position: Vec3, facingRad: number): void {
    if (!this.playerMesh) return;
    this.playerMesh.position.set(position[0], position[1], position[2]);
    this.playerMesh.rotation.y = facingRad;
  }

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
    const scaleVector = new THREE.Vector3();
    const positionVector = new THREE.Vector3();

    for (const [index, part] of parts.entries()) {
      const instanced = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
      instanced.name = `${name}-${index}`;
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      instanced.frustumCulled = true;

      for (const [slot, entry] of placements.entries()) {
        positionVector.set(entry.position[0], entry.position[1], entry.position[2]);
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), entry.rotationY);
        scaleVector.setScalar(entry.scale);
        placement.compose(positionVector, quaternion, scaleVector);
        transform.multiplyMatrices(placement, part.matrix);
        instanced.setMatrixAt(slot, transform);
      }
      instanced.instanceMatrix.needsUpdate = true;

      this.terrainGroup.add(instanced);
      created.push(instanced);
    }
    return created;
  }

  clear(): void {
    this.terrainGroup.clear();
    this.entityGroup.clear();
    this.overlayGroup.clear();
    this.walkable = [];
    this.heightSamplers.clear();
    this.playerMesh = null;
  }
}
