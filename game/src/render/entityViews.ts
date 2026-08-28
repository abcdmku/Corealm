/**
 * Semantic entities -> Three.js objects.
 *
 * This is the render half of the seam the contract describes: the world layer owns what an entity
 * IS, this file owns what it LOOKS LIKE. It reads `SemanticEntity.view` and nothing else about
 * appearance, and it never writes gameplay state. If a value is not on `view`, it is not this
 * file's business to invent it.
 *
 * The performance shape that matters: entities are drawn through `InstancedMesh`, keyed by
 * (assetId, materialTier). Six hundred ore nodes across three regions are a handful of draw calls,
 * not six hundred. Each entity owns a fixed slot in its group, and the group holds TWO instanced
 * copies — the live one and the depleted/dead one. Changing state writes two matrices (show here,
 * hide there). No rebuild, no allocation, no reupload of anything but the instance matrices.
 */
import * as THREE from "three";
import type { EntityId, SemanticEntity } from "../contracts.js";
import type { AssetRegistry } from "./assets.js";
import type { WorldScene } from "./scene.js";
import { MaterialLibrary, tierSilhouetteScale } from "./materials.js";

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** States that render with the spent treatment. Everything else renders live. */
const SPENT_STATES = new Set(["depleted", "dead", "empty", "harvested", "closed", "spent"]);

interface SourcePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  triangles: number;
}

interface InstanceGroup {
  key: string;
  assetId: string;
  depletedAssetId: string | null;
  tier: number;
  capacity: number;
  /** slot -> entity, or null for a freed slot. */
  slots: (EntityId | null)[];
  free: number[];
  liveParts: SourcePart[];
  spentParts: SourcePart[];
  live: THREE.InstancedMesh[];
  spent: THREE.InstancedMesh[];
  dirty: boolean;
}

interface ViewRecord {
  entityId: EntityId;
  groupKey: string;
  slot: number;
  /** Non-instanced fallback for rigged characters. */
  unique: THREE.Object3D | null;
  /** Cheap change detection so a steady frame writes nothing. */
  signature: string;
  position: THREE.Vector3;
  rotationY: number;
  scale: number;
  spent: boolean;
  labelHeight: number;
  radius: number;
}

export interface EntityViewStats {
  entities: number;
  groups: number;
  instancedMeshes: number;
  uniqueViews: number;
  highlights: number;
  /** Instanced meshes + unique meshes + highlight meshes. Excludes the shadow pass. */
  estimatedDrawCalls: number;
  triangles: number;
  missingAssets: string[];
}

export interface EntityViewOptions {
  /**
   * A fully dressed character is ~27k triangles across 10 skinned meshes (measured,
   * stack-findings.md section 7). Past this many, rigged entities fall back to the instanced
   * static path rather than blowing the draw-call budget.
   */
  maxUniqueViews?: number;
  /** Ring radius floor, so a small node is still clickable-looking at 12 m. */
  minHighlightRadius?: number;
}

export class EntityViews {
  private readonly groups = new Map<string, InstanceGroup>();
  private readonly records = new Map<EntityId, ViewRecord>();
  private readonly highlights = new Map<EntityId, THREE.Object3D>();
  private readonly instanceOwners = new WeakMap<THREE.InstancedMesh, InstanceGroup>();
  private readonly missing = new Set<string>();
  private readonly group = new THREE.Group();
  private readonly highlightGroup = new THREE.Group();
  private readonly maxUniqueViews: number;
  private readonly minHighlightRadius: number;
  private ringGeometry: THREE.BufferGeometry | null = null;
  private pipGeometry: THREE.BufferGeometry | null = null;

  constructor(
    private readonly scene: WorldScene,
    private readonly assets: AssetRegistry,
    private readonly materials: MaterialLibrary,
    options: EntityViewOptions = {},
  ) {
    this.maxUniqueViews = options.maxUniqueViews ?? 16;
    this.minHighlightRadius = options.minHighlightRadius ?? 0.9;
    this.group.name = "entity-views";
    this.highlightGroup.name = "entity-highlights";
    this.scene.entityGroup.add(this.group);
    this.scene.overlayGroup.add(this.highlightGroup);
  }

  // ------------------------------------------------------------- loading

  /**
   * Loads every GLB the given entities reference. Call once after the world layer has built its
   * entities and before the first `sync`; `sync` silently skips anything not loaded, so a missing
   * asset costs one invisible entity rather than a boot failure.
   */
  async prepare(entities: readonly SemanticEntity[]): Promise<{ loaded: number; missing: string[] }> {
    const wanted = new Set<string>();
    for (const entity of entities) {
      if (!entity.view) continue;
      wanted.add(entity.view.assetId);
      if (entity.view.depletedAssetId) wanted.add(entity.view.depletedAssetId);
    }

    const ids = [...wanted].filter((id) => {
      if (this.assets.entry(id)) return true;
      this.missing.add(id);
      return false;
    });

    const results = await Promise.allSettled(ids.map((id) => this.assets.load(id)));
    let loaded = 0;
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") loaded += 1;
      else this.missing.add(ids[index]!);
    }
    return { loaded, missing: [...this.missing] };
  }

  // ---------------------------------------------------------------- sync

  /**
   * Reconciles the drawn world with the semantic world.
   *
   * Cheap by design: an entity whose position, state, tier and asset are unchanged costs one string
   * comparison. Entities that vanished from the list release their slot; new ones take one.
   */
  sync(entities: readonly SemanticEntity[]): void {
    const seen = new Set<EntityId>();

    for (const entity of entities) {
      if (!entity.view) continue;
      seen.add(entity.id);
      this.syncOne(entity);
    }

    for (const [entityId, record] of this.records) {
      if (seen.has(entityId)) continue;
      this.release(record);
      this.records.delete(entityId);
      this.clearHighlight(entityId);
    }

    this.flush();
  }

  private syncOne(entity: SemanticEntity): void {
    const view = entity.view!;
    if (this.missing.has(view.assetId) || !this.assets.isLoaded(view.assetId)) return;

    const tier = view.materialTier ?? entity.tier;
    const groupKey = `${view.assetId}|${view.depletedAssetId ?? "-"}|${tier}`;
    const spent = SPENT_STATES.has(entity.state);
    const scale = (view.scale ?? 1) * tierSilhouetteScale(tier);
    const signature = `${groupKey}|${spent ? 1 : 0}|${round(entity.position[0])},${round(entity.position[1])},${round(entity.position[2])}|${round(view.rotationY ?? 0)}|${round(scale)}`;

    const existing = this.records.get(entity.id);
    if (existing && existing.signature === signature) return;

    if (existing && existing.groupKey !== groupKey) {
      this.release(existing);
      this.records.delete(entity.id);
    }

    const record = this.records.get(entity.id) ?? this.acquire(entity, groupKey, tier);
    if (!record) return;

    record.signature = signature;
    record.position.set(entity.position[0], entity.position[1], entity.position[2]);
    record.rotationY = view.rotationY ?? 0;
    record.scale = scale;
    record.spent = spent;
    record.labelHeight = view.labelHeight ?? 1.6;
    record.radius = Math.max(this.minHighlightRadius, this.assetRadius(view.assetId) * scale);

    const group = this.groups.get(groupKey);
    if (!group) return;

    if (record.unique) {
      record.unique.position.copy(record.position);
      record.unique.rotation.y = record.rotationY;
      record.unique.scale.setScalar(scale);
      this.applyUniqueState(record.unique, tier, spent);
      return;
    }

    this.writeSlot(group, record.slot, record.position, record.rotationY, scale, spent);
    group.dirty = true;

    const highlight = this.highlights.get(entity.id);
    if (highlight) this.placeHighlight(highlight, record);
  }

  private acquire(entity: SemanticEntity, groupKey: string, tier: number): ViewRecord | null {
    const view = entity.view!;
    const group = this.ensureGroup(groupKey, view.assetId, view.depletedAssetId ?? null, tier);
    if (!group) return null;

    // Rigged characters cannot be instanced meaningfully (their pose lives in the skeleton), so a
    // capped number of them get their own object and the rest fall back to a static instance.
    const rigged = group.liveParts.length === 0 || this.isRigged(view.assetId);
    let unique: THREE.Object3D | null = null;
    if (rigged && this.countUnique() < this.maxUniqueViews) {
      unique = this.assets.instance(view.assetId);
      unique.userData.entityId = entity.id;
      unique.traverse((child) => { child.userData.entityId = entity.id; });
      this.materials.retint(unique, tier, 0.25);
      this.group.add(unique);
    }

    const slot = unique ? -1 : this.takeSlot(group, entity.id);
    if (!unique && slot < 0) return null;

    const record: ViewRecord = {
      entityId: entity.id,
      groupKey,
      slot,
      unique,
      signature: "",
      position: new THREE.Vector3(),
      rotationY: view.rotationY ?? 0,
      scale: 1,
      spent: false,
      labelHeight: view.labelHeight ?? 1.6,
      radius: this.minHighlightRadius,
    };
    this.records.set(entity.id, record);
    return record;
  }

  private release(record: ViewRecord): void {
    if (record.unique) {
      record.unique.removeFromParent();
      return;
    }
    const group = this.groups.get(record.groupKey);
    if (!group || record.slot < 0) return;
    group.slots[record.slot] = null;
    group.free.push(record.slot);
    for (const mesh of group.live) mesh.setMatrixAt(record.slot, HIDDEN);
    for (const mesh of group.spent) mesh.setMatrixAt(record.slot, HIDDEN);
    group.dirty = true;
  }

  // ------------------------------------------------------------- groups

  private ensureGroup(
    key: string,
    assetId: string,
    depletedAssetId: string | null,
    tier: number,
  ): InstanceGroup | null {
    const existing = this.groups.get(key);
    if (existing) return existing;

    const liveParts = this.collectParts(assetId, tier, false);
    const spentSource = depletedAssetId && this.assets.isLoaded(depletedAssetId) ? depletedAssetId : assetId;
    const spentParts = this.collectParts(spentSource, tier, true);

    const group: InstanceGroup = {
      key,
      assetId,
      depletedAssetId,
      tier,
      capacity: 0,
      slots: [],
      free: [],
      liveParts,
      spentParts,
      live: [],
      spent: [],
      dirty: false,
    };
    this.groups.set(key, group);
    this.resize(group, 8);
    return group;
  }

  /**
   * Pulls (geometry, material, local transform) out of a loaded GLB and builds the tier variant of
   * each material. `MaterialLibrary.variant` keeps the source's base-colour texture and swaps only
   * colour/roughness/emissive, which is what stops tier ladders from fragmenting instancing
   * (architecture correction R6).
   */
  private collectParts(assetId: string, tier: number, spent: boolean): SourcePart[] {
    if (!this.assets.isLoaded(assetId)) return [];
    const source = this.assets.instance(assetId);
    source.updateMatrixWorld(true);

    const parts: SourcePart[] = [];
    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!base) return;
      const index = mesh.geometry.getIndex();
      const positionAttribute = mesh.geometry.getAttribute("position");
      const triangles = index
        ? index.count / 3
        : positionAttribute
          ? positionAttribute.count / 3
          : 0;
      parts.push({
        geometry: mesh.geometry,
        material: this.materials.variant(base, { tier, state: spent ? "depleted" : "normal" }),
        matrix: mesh.matrixWorld.clone(),
        triangles: Math.round(triangles),
      });
    });
    return parts;
  }

  private isRigged(assetId: string): boolean {
    if (!this.assets.isLoaded(assetId)) return false;
    let rigged = false;
    this.assets.instance(assetId).traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) rigged = true;
    });
    return rigged;
  }

  private takeSlot(group: InstanceGroup, entityId: EntityId): number {
    const reused = group.free.pop();
    if (reused !== undefined) {
      group.slots[reused] = entityId;
      return reused;
    }
    const used = group.slots.length;
    if (used >= group.capacity) this.resize(group, Math.max(8, Math.ceil(group.capacity * 1.6) + 8));
    group.slots.push(entityId);
    return used;
  }

  /** Rebuilds a group's instanced meshes at a larger capacity, preserving every slot. */
  private resize(group: InstanceGroup, capacity: number): void {
    for (const mesh of [...group.live, ...group.spent]) mesh.removeFromParent();
    group.live = [];
    group.spent = [];
    group.capacity = capacity;

    const build = (parts: SourcePart[], suffix: string): THREE.InstancedMesh[] =>
      parts.map((part, index) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
        mesh.name = `entity-${group.key}-${suffix}-${index}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        for (let slot = 0; slot < capacity; slot += 1) mesh.setMatrixAt(slot, HIDDEN);
        mesh.instanceMatrix.needsUpdate = true;
        this.instanceOwners.set(mesh, group);
        this.group.add(mesh);
        return mesh;
      });

    group.live = build(group.liveParts, "live");
    group.spent = build(group.spentParts, "spent");

    // A resize throws away the old instance buffers, so every slot that already had an entity in it
    // has to be written back. Missing this is the classic instancing bug where half the world
    // disappears the moment one more node is added.
    for (const record of this.records.values()) {
      if (record.groupKey !== group.key || record.slot < 0 || record.slot >= capacity) continue;
      this.writeSlot(group, record.slot, record.position, record.rotationY, record.scale, record.spent);
    }
    group.dirty = true;
  }

  private writeSlot(
    group: InstanceGroup,
    slot: number,
    position: THREE.Vector3,
    rotationY: number,
    scale: number,
    spent: boolean,
  ): void {
    const placement = new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rotationY),
      new THREE.Vector3(scale, scale, scale),
    );
    const transform = new THREE.Matrix4();

    const active = spent ? group.spent : group.live;
    const activeParts = spent ? group.spentParts : group.liveParts;
    const hidden = spent ? group.live : group.spent;

    for (const [index, mesh] of active.entries()) {
      const part = activeParts[index];
      if (!part) continue;
      transform.multiplyMatrices(placement, part.matrix);
      mesh.setMatrixAt(slot, transform);
    }
    for (const mesh of hidden) mesh.setMatrixAt(slot, HIDDEN);
  }

  private applyUniqueState(object: THREE.Object3D, tier: number, spent: boolean): void {
    if (!spent) return;
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mapped = materials.map((material) => this.materials.variant(material, { tier, state: "dead" }));
      mesh.material = mapped.length === 1 ? mapped[0]! : mapped;
    });
  }

  private flush(): void {
    for (const group of this.groups.values()) {
      if (!group.dirty) continue;
      for (const mesh of [...group.live, ...group.spent]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      group.dirty = false;
    }
  }

  // --------------------------------------------------- hover / selection

  /**
   * Ring plus an overhead pip. The ring says "this is the thing on the ground", the pip is what
   * you can still see when the thing is a 7 m tree. Colour is `#rrggbb`, matching `OverlaySpec`.
   */
  setHighlight(entityId: EntityId, colour: string | number = "#ffd98a"): boolean {
    const record = this.records.get(entityId);
    if (!record) return false;

    this.clearHighlight(entityId);
    const material = this.materials.highlight(colour);
    const marker = new THREE.Group();
    marker.name = `highlight-${entityId}`;

    const ring = new THREE.Mesh(this.ring(), material);
    ring.rotation.x = -Math.PI / 2;
    marker.add(ring);

    const pip = new THREE.Mesh(this.pip(), material);
    pip.name = "pip";
    marker.add(pip);

    this.highlightGroup.add(marker);
    this.highlights.set(entityId, marker);
    this.placeHighlight(marker, record);
    return true;
  }

  clearHighlight(entityId: EntityId): void {
    const existing = this.highlights.get(entityId);
    if (!existing) return;
    existing.removeFromParent();
    this.highlights.delete(entityId);
  }

  clearAllHighlights(): void {
    for (const entityId of [...this.highlights.keys()]) this.clearHighlight(entityId);
  }

  private placeHighlight(marker: THREE.Object3D, record: ViewRecord): void {
    marker.position.copy(record.position);
    marker.position.y += 0.06;
    marker.scale.setScalar(record.radius);
    const pip = marker.getObjectByName("pip");
    if (pip) pip.position.y = record.labelHeight / Math.max(0.001, record.radius);
  }

  private ring(): THREE.BufferGeometry {
    if (!this.ringGeometry) this.ringGeometry = new THREE.RingGeometry(0.86, 1.06, 28);
    return this.ringGeometry;
  }

  private pip(): THREE.BufferGeometry {
    if (!this.pipGeometry) this.pipGeometry = new THREE.OctahedronGeometry(0.16, 0);
    return this.pipGeometry;
  }

  // ------------------------------------------------------------ picking

  /**
   * Which entity a ray hits, or null. Handles both instanced entities (via `instanceId`) and the
   * rigged fallback objects (via `userData.entityId`). The input layer sets the ray; this file
   * does not know about the mouse.
   */
  pick(raycaster: THREE.Raycaster): EntityId | null {
    const hits = raycaster.intersectObject(this.group, true);
    for (const hit of hits) {
      const instanced = hit.object as THREE.InstancedMesh;
      if (instanced.isInstancedMesh && hit.instanceId !== undefined) {
        const group = this.instanceOwners.get(instanced);
        const entityId = group?.slots[hit.instanceId];
        if (entityId) return entityId;
        continue;
      }
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const owner = node.userData.entityId;
        if (typeof owner === "string") return owner;
        node = node.parent;
      }
    }
    return null;
  }

  /** Distance-sorted pick, returning every entity under the ray. Right-click menus want this. */
  pickAll(raycaster: THREE.Raycaster): EntityId[] {
    const found: EntityId[] = [];
    for (const hit of raycaster.intersectObject(this.group, true)) {
      const instanced = hit.object as THREE.InstancedMesh;
      if (instanced.isInstancedMesh && hit.instanceId !== undefined) {
        const entityId = this.instanceOwners.get(instanced)?.slots[hit.instanceId];
        if (entityId && !found.includes(entityId)) found.push(entityId);
      }
    }
    return found;
  }

  /** World position an entity is drawn at. Used for overlays and camera framing. */
  positionOf(entityId: EntityId): THREE.Vector3 | null {
    const record = this.records.get(entityId);
    return record ? record.position.clone() : null;
  }

  has(entityId: EntityId): boolean {
    return this.records.has(entityId);
  }

  // -------------------------------------------------------------- stats

  private assetRadius(assetId: string): number {
    const entry = this.assets.entry(assetId);
    if (!entry) return this.minHighlightRadius;
    return Math.max(entry.size.x, entry.size.z) * 0.55;
  }

  private countUnique(): number {
    let count = 0;
    for (const record of this.records.values()) if (record.unique) count += 1;
    return count;
  }

  stats(): EntityViewStats {
    let instancedMeshes = 0;
    let triangles = 0;
    for (const group of this.groups.values()) {
      instancedMeshes += group.live.length + group.spent.length;
      const active = group.slots.filter((slot) => slot !== null).length;
      for (const part of group.liveParts) triangles += part.triangles * active;
    }
    let uniqueTriangles = 0;
    const unique = this.countUnique();
    for (const record of this.records.values()) {
      if (!record.unique) continue;
      record.unique.traverse((child) => {
        const mesh = child as THREE.Mesh;
        const index = mesh.isMesh ? mesh.geometry.getIndex() : null;
        if (index) uniqueTriangles += index.count / 3;
      });
    }

    return {
      entities: this.records.size,
      groups: this.groups.size,
      instancedMeshes,
      uniqueViews: unique,
      highlights: this.highlights.size,
      estimatedDrawCalls: instancedMeshes + unique * 10 + this.highlights.size * 2,
      triangles: Math.round(triangles + uniqueTriangles),
      missingAssets: [...this.missing],
    };
  }

  dispose(): void {
    this.clearAllHighlights();
    this.group.clear();
    this.groups.clear();
    this.records.clear();
    this.ringGeometry?.dispose();
    this.pipGeometry?.dispose();
    this.ringGeometry = null;
    this.pipGeometry = null;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
