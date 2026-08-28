/**
 * The assistance overlay layer — Corealm's RuneLite-style annotation system.
 *
 * Four kinds, deliberately: highlight, path, marker, label. An agent drives these through
 * `corealm_overlay`, which is what turns "the agent knows something" into "the player can see what
 * the agent means". The same layer serves the human UI's quest markers and route previews.
 *
 * Overlays are pure presentation. Drawing one never changes gameplay state, and clearing them all
 * never breaks anything — that separation is what makes it safe to let an agent write here.
 */
import * as THREE from "three";
import type { EntityId, OverlaySpec, Vec3 } from "../contracts.js";
import type { WorldScene } from "./scene.js";

interface LiveOverlay {
  spec: OverlaySpec;
  object: THREE.Object3D;
  /** Sim time at which this disappears, or null for "until cleared". */
  expiresAtMs: number | null;
  /** Kept so a followed entity's overlay tracks it as it moves. */
  entityId?: EntityId;
  element?: HTMLElement;
}

const DEFAULT_COLOUR = "#ffd98a";
const MAX_OVERLAYS = 64;

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

  constructor(private readonly deps: OverlayDeps) {
    this.group.name = "overlays";
    this.deps.scene.overlayGroup.add(this.group);
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

    switch (spec.kind) {
      case "highlight":
        object = this.makeHighlight(colour);
        break;
      case "marker":
        object = this.makeMarker(colour);
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
    if (spec.kind !== "path" && position) object.position.set(position[0], position[1], position[2]);
    this.group.add(object);

    const entry: LiveOverlay = {
      spec,
      object,
      expiresAtMs: spec.ttlMs && spec.ttlMs > 0 ? nowMs + spec.ttlMs : null,
      ...(spec.entityId ? { entityId: spec.entityId } : {}),
      ...(element ? { element } : {}),
    };
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

  /** Per-frame: expire, follow entities, and project labels to screen space. */
  update(nowMs: number): void {
    for (const [id, entry] of [...this.live]) {
      if (entry.expiresAtMs !== null && nowMs >= entry.expiresAtMs) {
        this.dispose(entry);
        this.live.delete(id);
        continue;
      }

      if (entry.entityId) {
        const position = this.deps.entityPosition(entry.entityId);
        if (position) entry.object.position.set(position[0], position[1], position[2]);
      }

      // A slow pulse so a highlight reads as an annotation rather than as part of the world.
      if (entry.spec.kind === "highlight") {
        const pulse = 1 + Math.sin(nowMs / 320) * 0.06;
        entry.object.scale.setScalar(pulse);
        entry.object.rotation.y += 0.004;
      }

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

  /** A ground ring. Reads at a distance without hiding the thing it marks. */
  private makeHighlight(colour: THREE.Color): THREE.Object3D {
    const geometry = new THREE.RingGeometry(0.85, 1.15, 32);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.position.y = 0.08;
    ring.renderOrder = 10;
    return ring;
  }

  /** A floating pin, for a destination the player cannot see yet. */
  private makeMarker(colour: THREE.Color): THREE.Object3D {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false });

    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 10), material);
    cone.rotation.x = Math.PI;
    cone.position.y = 3.2;
    cone.renderOrder = 10;
    group.add(cone);

    const base = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 24), material);
    base.geometry.rotateX(-Math.PI / 2);
    base.position.y = 0.08;
    base.renderOrder = 10;
    group.add(base);

    return group;
  }

  /** A route line drawn just above the ground. */
  private makePath(points: readonly Vec3[], colour: THREE.Color): THREE.Object3D | null {
    if (points.length < 2) return null;
    const vertices = new Float32Array(points.length * 3);
    for (const [index, point] of points.entries()) {
      vertices[index * 3] = point[0];
      vertices[index * 3 + 1] = point[1] + 0.35;
      vertices[index * 3 + 2] = point[2];
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
    entry.object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else if (material) (material as THREE.Material).dispose();
    });
    entry.element?.remove();
  }
}
