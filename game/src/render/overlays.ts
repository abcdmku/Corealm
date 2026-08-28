/**
 * The assistance overlay layer — Corealm's RuneLite-style annotation system.
 *
 * Four kinds, deliberately: highlight, path, marker, label. An agent drives these through
 * `corealm_overlay`, which is what turns "the agent knows something" into "the player can see what
 * the agent means". The same layer serves the human UI's quest markers and route previews.
 *
 * Overlays are pure presentation. Drawing one never changes gameplay state, and clearing them all
 * never breaks anything — that separation is what makes it safe to let an agent write here.
 *
 * Everything here CONFORMS TO THE GROUND. Rings and route lines used to be flat geometry parked at
 * whatever Y the caller happened to pass, which on Karrowmoor's terraces buries a highlight ring in
 * the hillside and puts a nav path up to 4.46 m under the surface it is meant to describe
 * (runs/corealm/diagnosis/animation-and-movement-feel.md: paths carry 2-3 corners over 50 m with Y
 * linearly interpolated between them). An annotation inside the terrain annotates nothing, so every
 * ground-plane vertex here is sampled against the terrain field instead of trusted from the caller.
 */
import * as THREE from "three";
import type { EntityId, OverlaySpec, Vec3 } from "../contracts.js";
import type { WorldScene } from "./scene.js";

/**
 * The mesh-exact height sampler `render/scene.ts` gains in this same wave.
 *
 * Declared optional so this file compiles against the scene exactly as it is today and picks the
 * better sampler up the moment it lands, with no second edit here. `meshHeightAt` beats
 * `heightAtXZ` because it interpolates the SAME 2 m lattice the terrain mesh is built from; the
 * analytic field disagrees with the drawn surface by up to half a quad's relief, which is exactly
 * the gap a ring lying on the ground is trying to close.
 */
interface MeshHeightSampler {
  meshHeightAt?(x: number, z: number): number;
}

interface LiveOverlay {
  spec: OverlaySpec;
  object: THREE.Object3D;
  /** Sim time at which this disappears, or null for "until cleared". */
  expiresAtMs: number | null;
  /** Kept so a followed entity's overlay tracks it as it moves. */
  entityId?: EntityId;
  element?: HTMLElement;
  /** Ground-plane rings that need re-seating when they move. Empty for kinds that have none. */
  conform: ConformRing[];
  /** Where the conform was last computed, so a stationary overlay never resamples. */
  conformedAt: THREE.Vector3;
  conformedAtMs: number;
}

/** A ring whose vertices are pushed onto the terrain in the owning object's local frame. */
interface ConformRing {
  mesh: THREE.Mesh;
  /** Local XZ of each vertex, captured once at build time. */
  localX: Float32Array;
  localZ: Float32Array;
  /** Metres above the sampled surface. */
  lift: number;
}

const DEFAULT_COLOUR = "#ffd98a";
const MAX_OVERLAYS = 64;
/** Re-sample the ground under a moving overlay once it has travelled this far, in metres. */
const CONFORM_MOVE_METRES = 0.2;
/** ...and at worst this often, which bounds the cost of a ring that is chasing a running enemy. */
const CONFORM_INTERVAL_MS = 400;
/** Metres between ground samples along a route line. */
const PATH_SAMPLE_METRES = 2;
/** How high the route line rides. Clears 2 m quad relief; low enough to still read as ground paint. */
const PATH_LIFT_METRES = 0.22;
/** A cap, because an agent can hand in a path of any length and every sample is a terrain query. */
const MAX_PATH_SAMPLES = 512;

export interface OverlayDeps {
  scene: WorldScene;
  camera: THREE.Camera;
  /** Current world position of an entity, so a followed overlay stays attached. */
  entityPosition(entityId: EntityId): Vec3 | null;
  /** Where world-space labels are mounted. */
  labelRoot: HTMLElement;
}

export class Overlays {
  private readonly live = new Map<string, LiveOverlay>();
  private readonly group = new THREE.Group();
  private readonly projected = new THREE.Vector3();
  private readonly terrain: WorldScene & MeshHeightSampler;

  constructor(private readonly deps: OverlayDeps) {
    this.group.name = "overlays";
    this.deps.scene.overlayGroup.add(this.group);
    this.terrain = this.deps.scene;
  }

  /** Creates or replaces an overlay. Returns the number now active. */
  set(spec: OverlaySpec, nowMs: number): number {
    this.clear(spec.id);

    // A hard cap, because an agent in a loop can otherwise fill the scene with rings.
    if (this.live.size >= MAX_OVERLAYS) {
      const oldest = this.live.keys().next();
      if (!oldest.done) this.clear(oldest.value);
    }

    const colour = new THREE.Color(spec.colour ?? DEFAULT_COLOUR);
    const position = this.resolvePosition(spec);

    let object: THREE.Object3D | null = null;
    let element: HTMLElement | undefined;
    const conform: ConformRing[] = [];

    switch (spec.kind) {
      case "highlight":
        object = this.makeHighlight(colour, conform);
        break;
      case "marker":
        object = this.makeMarker(colour, conform);
        break;
      case "path":
        object = this.makePath(spec.path ?? [], colour);
        break;
      case "label":
        object = new THREE.Object3D();
        element = this.makeLabel(spec.text ?? "", spec.colour ?? DEFAULT_COLOUR);
        break;
    }

    if (!object) return this.live.size;
    // A path is built in world coordinates, so it is the one kind that is never moved to a point.
    if (spec.kind !== "path" && position) object.position.set(position[0], position[1], position[2]);
    this.group.add(object);

    const entry: LiveOverlay = {
      spec,
      object,
      expiresAtMs: spec.ttlMs && spec.ttlMs > 0 ? nowMs + spec.ttlMs : null,
      ...(spec.entityId ? { entityId: spec.entityId } : {}),
      ...(element ? { element } : {}),
      conform,
      conformedAt: new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN),
      conformedAtMs: Number.NEGATIVE_INFINITY,
    };
    this.conformRings(entry, nowMs, true);
    this.live.set(spec.id, entry);
    return this.live.size;
  }

  /** Clears one overlay by id, or all of them. Returns the number remaining. */
  clear(id?: string): number {
    if (id === undefined) {
      for (const entry of this.live.values()) this.dispose(entry);
      this.live.clear();
      return 0;
    }
    const entry = this.live.get(id);
    if (entry) {
      this.dispose(entry);
      this.live.delete(id);
    }
    return this.live.size;
  }

  /** Per-frame: expire, follow entities, re-seat rings on the terrain, project labels. */
  update(nowMs: number): void {
    for (const [id, entry] of [...this.live]) {
      if (entry.expiresAtMs !== null && nowMs >= entry.expiresAtMs) {
        this.dispose(entry);
        this.live.delete(id);
        continue;
      }

      // A path is world-space geometry. Translating it by the followed entity's absolute position
      // used to fling the whole route out to twice its own coordinates, so `path` opts out.
      if (entry.entityId && entry.spec.kind !== "path") {
        const position = this.deps.entityPosition(entry.entityId);
        if (position) entry.object.position.set(position[0], position[1], position[2]);
      }

      // A slow pulse so a highlight reads as an annotation rather than as part of the world.
      //
      // Only X and Z pulse. Y now carries the conformed terrain profile, and scaling that would
      // make the ring breathe into and out of the hillside. The old `rotation.y += 0.004` is gone:
      // a RingGeometry is rotationally symmetric about Y, so it changed no pixel at any frame rate,
      // and being per-frame rather than per-second it also made every overlay recompute its world
      // matrix on every frame for that nothing.
      if (entry.spec.kind === "highlight") {
        const pulse = 1 + Math.sin(nowMs / 320) * 0.06;
        entry.object.scale.set(pulse, 1, pulse);
      }

      this.conformRings(entry, nowMs, false);
      if (entry.element) this.positionLabel(entry);
    }
  }

  activeCount(): number {
    return this.live.size;
  }

  list(): OverlaySpec[] {
    return [...this.live.values()].map((entry) => entry.spec);
  }

  // ------------------------------------------------------------- factories

  private resolvePosition(spec: OverlaySpec): Vec3 | null {
    if (spec.entityId) {
      const found = this.deps.entityPosition(spec.entityId);
      if (found) return found;
    }
    return spec.position ?? null;
  }

  /** Terrain height, from the mesh-exact sampler when the scene has one. */
  private groundY(x: number, z: number): number {
    return this.terrain.meshHeightAt?.(x, z) ?? this.terrain.heightAtXZ(x, z);
  }

  /** A ground ring. Reads at a distance without hiding the thing it marks. */
  private makeHighlight(colour: THREE.Color, conform: ConformRing[]): THREE.Object3D {
    const ring = this.makeGroundRing(colour, 0.85, 1.15, 40, 0.75, 0.06);
    conform.push(ring.conform);
    return ring.mesh;
  }

  /** A floating pin, for a destination the player cannot see yet. */
  private makeMarker(colour: THREE.Color, conform: ConformRing[]): THREE.Object3D {
    const group = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1.4, 10),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    cone.rotation.x = Math.PI;
    cone.position.y = 3.2;
    cone.renderOrder = 10;
    group.add(cone);

    const base = this.makeGroundRing(colour, 0.5, 0.72, 28, 0.9, 0.06);
    conform.push(base.conform);
    group.add(base.mesh);

    return group;
  }

  /**
   * A flat annulus plus the bookkeeping that lets `conformRings` re-seat it on the terrain.
   *
   * Segment count is the whole cost of conforming: a rebuild samples 2 x (segments + 1) heights, so
   * the 40-segment highlight is 82 samples and rebuilds at most 2.5 times a second while moving.
   */
  private makeGroundRing(
    colour: THREE.Color,
    inner: number,
    outer: number,
    segments: number,
    opacity: number,
    lift: number,
  ): { mesh: THREE.Mesh; conform: ConformRing } {
    const geometry = new THREE.RingGeometry(inner, outer, segments);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 10;
    // Conformed geometry has real relief, and the bounding sphere is only computed from the flat
    // bind pose, so a frustum test can cull a ring that is still on screen. These are a few dozen
    // triangles; skipping the test is cheaper than keeping the bounds honest every conform.
    mesh.frustumCulled = false;

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const localX = new Float32Array(position.count);
    const localZ = new Float32Array(position.count);
    for (let index = 0; index < position.count; index += 1) {
      localX[index] = position.getX(index);
      localZ[index] = position.getZ(index);
    }
    return { mesh, conform: { mesh, localX, localZ, lift } };
  }

  /**
   * A route line drawn just above the ground.
   *
   * The caller's Y is discarded rather than trusted. Nav paths carry 2-3 corners over 50 m with Y
   * linearly interpolated between them, so a straight segment across a terrace cuts through the
   * hill — the measured worst case on one Karrowmoor path is 4.46 m below the surface. Long
   * segments are subdivided every PATH_SAMPLE_METRES and each sample is seated on the terrain.
   */
  private makePath(points: readonly Vec3[], colour: THREE.Color): THREE.Object3D | null {
    if (points.length < 2) return null;
    const samples = this.resamplePath(points);
    const vertices = new Float32Array(samples.length * 3);
    for (const [index, point] of samples.entries()) {
      vertices[index * 3] = point[0];
      vertices[index * 3 + 1] = this.groundY(point[0], point[1]) + PATH_LIFT_METRES;
      vertices[index * 3 + 2] = point[1];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    line.renderOrder = 10;
    return line;
  }

  /** Corner list to an XZ polyline sampled densely enough to follow the ground. */
  private resamplePath(points: readonly Vec3[]): [number, number][] {
    const first = points[0]!;
    const out: [number, number][] = [[first[0], first[2]]];
    let budget = MAX_PATH_SAMPLES;
    for (let index = 1; index < points.length && budget > 0; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const span = Math.hypot(to[0] - from[0], to[2] - from[2]);
      const steps = Math.max(1, Math.min(budget, Math.ceil(span / PATH_SAMPLE_METRES)));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        out.push([from[0] + (to[0] - from[0]) * t, from[2] + (to[2] - from[2]) * t]);
      }
      budget -= steps;
    }
    return out;
  }

  /**
   * Pushes every conformed ring's vertices onto the terrain, in the owning object's local frame.
   *
   * Throttled on movement and on time because the samplers are not free: a highlight following a
   * running enemy resamples 2.5 times a second, and a stationary one resamples exactly once.
   */
  private conformRings(entry: LiveOverlay, nowMs: number, force: boolean): void {
    if (entry.conform.length === 0) return;
    const origin = entry.object.position;
    if (
      !force
      && nowMs - entry.conformedAtMs < CONFORM_INTERVAL_MS
      && entry.conformedAt.distanceToSquared(origin) < CONFORM_MOVE_METRES * CONFORM_MOVE_METRES
    ) {
      return;
    }
    entry.conformedAt.copy(origin);
    entry.conformedAtMs = nowMs;

    for (const ring of entry.conform) {
      const attribute = ring.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < attribute.count; index += 1) {
        const worldX = origin.x + ring.localX[index]!;
        const worldZ = origin.z + ring.localZ[index]!;
        attribute.setY(index, this.groundY(worldX, worldZ) - origin.y + ring.lift);
      }
      attribute.needsUpdate = true;
    }
  }

  private makeLabel(text: string, colour: string): HTMLElement {
    const element = document.createElement("div");
    element.className = "world-label";
    element.textContent = text;
    element.style.borderColor = colour;
    this.deps.labelRoot.appendChild(element);
    return element;
  }

  /** Projects a world-space label into screen space, hiding it when behind the camera. */
  private positionLabel(entry: LiveOverlay): void {
    if (!entry.element) return;
    this.projected.copy(entry.object.position);
    this.projected.y += 2.2;
    this.projected.project(this.deps.camera);

    const behind = this.projected.z > 1;
    if (behind) {
      entry.element.style.display = "none";
      return;
    }
    entry.element.style.display = "block";
    entry.element.style.left = `${(this.projected.x * 0.5 + 0.5) * window.innerWidth}px`;
    entry.element.style.top = `${(-this.projected.y * 0.5 + 0.5) * window.innerHeight}px`;
  }

  private dispose(entry: LiveOverlay): void {
    entry.object.removeFromParent();
    const seen = new Set<THREE.Material>();
    entry.object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const item of list) {
        if (seen.has(item)) continue;
        seen.add(item);
        item.dispose();
      }
    });
    entry.element?.remove();
  }
}
