/**
 * Semantic entities -> Three.js objects.
 *
 * This is the render half of the seam the contract describes: the world layer owns what an entity
 * IS, this file owns what it LOOKS LIKE. It reads `SemanticEntity.view` and nothing else about
 * appearance, and it never writes gameplay state. If a value is not on `view`, it is not this
 * file's business to invent it.
 *
 * The performance shape that matters: entities are drawn through `InstancedMesh`, keyed by
 * (assetId, materialTier, archetype). Six hundred ore nodes across three regions are a handful of
 * draw calls, not six hundred. Each entity owns a fixed slot in its group, and the group holds TWO
 * instanced copies — the live one and the depleted/dead one. Changing state writes two matrices
 * (show here, hide there). No rebuild, no allocation, no reupload of anything but the matrices.
 *
 * Round 2 fixes two findings that both came down to this file:
 *
 *  - Tier was unreadable (finding 4). Tier now moves three things at once: the body colour (pulled
 *    hard toward the tier's `body` swatch), an added ore SEAM in the tier's brightened `metal`
 *    swatch, and the silhouette scale. See `APPEARANCE` and `seamGeometry`.
 *  - Nothing was animated (finding 6). 98 clips were loading and no `AnimationMixer` existed, so
 *    every character stood in bind pose with its arms out. Rigged entities now get a mixer with a
 *    per-entity idle clip and phase, and — this is the part that matters at scale — the ones that
 *    do NOT get a mixer are instanced from a CPU-baked idle pose rather than from bind pose, so a
 *    background NPC is a still character instead of a scarecrow.
 */
import * as THREE from "three";
import { clone as cloneRigged } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Archetype, EntityId, SemanticEntity } from "../contracts.js";
import type { AssetRegistry } from "./assets.js";
import type { WorldScene } from "./scene.js";
import type { PaletteSwatch } from "./materials.js";
import { Rng } from "../core/rng.js";
import { MaterialLibrary, tierSilhouetteScale } from "./materials.js";

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** States that render with the spent treatment. Everything else renders live. */
const SPENT_STATES = new Set(["depleted", "dead", "empty", "harvested", "closed", "spent"]);

/**
 * Archetypes whose tier is a gameplay ladder, and are therefore allowed to move their proportions.
 *
 * Round 1 scaled EVERYTHING by `tierSilhouetteScale`, so a Karrowmoor market stall was 12% larger
 * than the identical stall in Coldbrace purely because its region carries a higher tier. Tier is a
 * readability signal for things you gather from and fight; it is not a size rule for architecture.
 */
const TIERED_ARCHETYPES = new Set<Archetype>([
  "ore", "tree", "fishing_spot", "farm_plot", "enemy", "boss",
]);

/** How far a given archetype's art is pulled toward its tier palette, and toward which swatch. */
interface Appearance {
  swatch: PaletteSwatch;
  /** 0..1. Zero means "leave the authored art alone", and costs no material clone at all. */
  strength: number;
}

/**
 * The tier-legibility policy, in one table.
 *
 * Ore is the strong case and the one the PRD writes a contract for: at 0.88 a stock grey rock
 * texture actually lands on the tier's body colour, where round 1's 0.25 could not move it at all.
 * NPCs, buildings, props and landmarks are deliberately absent — they resolve to `NEUTRAL` and
 * render as authored, because tinting a shopkeeper toward "Kaldite blue-black" communicates
 * nothing and costs a cloned material.
 */
const APPEARANCE: Partial<Record<Archetype, Appearance>> = {
  ore: { swatch: "body", strength: 0.88 },
  tree: { swatch: "body", strength: 0.55 },
  fishing_spot: { swatch: "accent", strength: 0.7 },
  farm_plot: { swatch: "accent", strength: 0.45 },
  enemy: { swatch: "metal", strength: 0.45 },
  boss: { swatch: "metal", strength: 0.55 },
};

const NEUTRAL: Appearance = { swatch: "metal", strength: 0 };

/** Canopy materials follow the tier ACCENT, not the rock body a trunk shares its swatch with. */
const LEAF_MATERIAL = /leaf|leaves|foliage|canopy/i;

/**
 * Materials a tier tint must never touch. Eyes, teeth and the pure black/white trims on the
 * monster packs are art direction, not tier: pulling them toward a palette colour flattens a face
 * into a smear and buys no legibility.
 */
const PROTECTED_MATERIAL = /eye|teeth|tongue|hair|white|black/i;

/**
 * Humanoid idles, from the shared 65-bone clip library. Every character pack shares one skeleton
 * (stack-findings.md section 2), so these play on any rig with no retargeting.
 *
 * Four of them, picked per entity, because a settlement where five NPCs breathe in unison reads
 * worse than five NPCs standing still.
 */
const HUMANOID_IDLES: readonly string[] = [
  "Idle_Loop", "Idle_Talking_Loop", "Idle_FoldArms_Loop", "Idle_No_Loop",
];

/** Where a rigged asset ships its own clips, prefer these names before falling back to its first. */
const OWN_IDLE_PATTERN = /idle/i;

/** Shards in an ore seam. Five reads as a vein from any bearing and costs 40 triangles. */
const SEAM_SHARDS = 5;

/** Fraction of the idle clip to freeze at for the instanced fallback. Mid-clip, i.e. settled. */
const BAKE_PHASE = 0.35;

/**
 * Draw calls held in reserve for named characters, out of `maxUniqueDrawCalls`.
 *
 * Without this the budget is first-come, and entity order is region order: forty wilderness
 * enemies would spend the whole allowance before the first shopkeeper in Coldbrace is reached, so
 * the characters the player actually stands in front of would be the ones rendered as statues.
 */
const NAMED_CHARACTER_RESERVE = 64;

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
  archetype: Archetype;
  tier: number;
  capacity: number;
  /** slot -> entity, or null for a freed slot. */
  slots: (EntityId | null)[];
  free: number[];
  liveParts: SourcePart[];
  /** Built on first spent slot. See `ensureSpent`. */
  spentParts: SourcePart[] | null;
  live: THREE.InstancedMesh[];
  spent: THREE.InstancedMesh[];
  /** True when this group's parts came from a rigged asset baked into a pose. */
  posed: boolean;
  /** True when the asset is rigged but no baked pose was available when the group was built. */
  needsPose: boolean;
  dirty: boolean;
}

/** A live skeletal animation on one non-instanced entity. */
interface RigState {
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
  clipName: string;
}

interface ViewRecord {
  entityId: EntityId;
  archetype: Archetype;
  groupKey: string;
  slot: number;
  /** Non-instanced fallback for rigged characters. */
  unique: THREE.Object3D | null;
  /** Mixer driving `unique`, when this entity earned one. */
  rig: RigState | null;
  /** Meshes in `unique`, counted once at build rather than guessed. */
  uniqueMeshes: number;
  /** Draw calls `unique` costs, shadow pass included. Returned to the pool on release. */
  uniqueCost: number;
  /** Set when a rigged entity was built before its skeleton source was available. */
  awaitingRig: boolean;
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
  /** Unique views carrying a live `AnimationMixer`. */
  riggedViews: number;
  /** Mixers actually ticked on the most recent `update`, after the budget and radius cuts. */
  animatedLastFrame: number;
  /** Rigged assets whose instanced fallback runs from a baked idle pose, not bind pose. */
  bakedPoses: number;
  highlights: number;
  /**
   * Draw calls this layer is responsible for, INCLUDING the shadow pass.
   *
   * Round 1 excluded the shadow pass and assumed 10 meshes per character. Both were wrong in the
   * expensive direction: every instanced entity mesh casts, so it draws twice, and the base NPCs
   * Phase 1 uses are 3-4 meshes, not 10. A budget you cannot compare against
   * `renderer.info.render.calls` is not a budget.
   */
  estimatedDrawCalls: number;
  /** Draw calls currently spent on the non-instanced character path, against its own budget. */
  uniqueDrawCalls: number;
  triangles: number;
  missingAssets: string[];
}

export interface EntityViewOptions {
  /**
   * THE cap that matters, expressed in the unit the budget is written in.
   *
   * A rigged character cannot be instanced — its pose lives in its skeleton — so every one of them
   * is a straight per-mesh cost, doubled because they cast. A fully dressed character is 10 skinned
   * meshes (stack-findings.md section 7) and the Phase 1 base NPCs are 3-4, so a cap counted in
   * ENTITIES is off by a factor of three depending on which asset happens to be nearby. Counting
   * draw calls instead makes the ceiling mean the same thing whatever the art is.
   *
   * Off-screen characters are frustum-culled to nothing, so this is a world-wide allowance rather
   * than a per-frame one; the per-frame cost is whatever subset is actually in shot.
   */
  maxUniqueDrawCalls?: number;
  /** Hard ceiling on unique objects regardless of cost, so a cheap asset cannot flood the scene. */
  maxUniqueViews?: number;
  /**
   * Mixers ticked per frame, nearest first. Separate from `maxUniqueViews` because a mixer costs
   * CPU every frame while a unique object only costs draw calls when it is on screen.
   */
  maxAnimatedViews?: number;
  /** Metres past which a rig stops being ticked and holds its pose. Sits inside the fog start. */
  animationRadius?: number;
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

  /**
   * The ORIGINAL loaded scene graph per asset id, not a clone.
   *
   * `AssetRegistry.instance()` hands out `source.clone(true)`, and `Object3D.clone` copies a
   * SkinnedMesh's `skeleton` BY REFERENCE — every plain clone deforms with the original's bones,
   * so animating one animates none of them. `SkeletonUtils.clone` fixes that, but only when it is
   * handed the true original, which is why this map exists.
   */
  private readonly sources = new Map<string, THREE.Object3D>();
  private readonly sourceRequests = new Set<string>();
  private sourcesChanged = false;

  private readonly riggedAssets = new Map<string, boolean>();
  private readonly seamGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly bakedGeometries: THREE.BufferGeometry[] = [];
  /** Rigged records with a mixer. Kept as its own set so `update` never walks 600 ore nodes. */
  private readonly animated = new Set<ViewRecord>();
  private readonly animationOrder: ViewRecord[] = [];
  private animatedLastFrame = 0;
  /** Meshes per rigged asset, so the budget can be checked BEFORE paying for a skeleton clone. */
  private readonly meshCounts = new Map<string, number>();
  private uniqueDrawCalls = 0;

  private readonly maxUniqueDrawCalls: number;
  private readonly maxUniqueViews: number;
  private readonly maxAnimatedViews: number;
  private readonly animationRadiusSq: number;
  private readonly minHighlightRadius: number;
  private ringGeometry: THREE.BufferGeometry | null = null;
  private pipGeometry: THREE.BufferGeometry | null = null;

  constructor(
    private readonly scene: WorldScene,
    private readonly assets: AssetRegistry,
    private readonly materials: MaterialLibrary,
    options: EntityViewOptions = {},
  ) {
    this.maxUniqueDrawCalls = options.maxUniqueDrawCalls ?? 96;
    this.maxUniqueViews = options.maxUniqueViews ?? 24;
    this.maxAnimatedViews = options.maxAnimatedViews ?? 10;
    this.animationRadiusSq = (options.animationRadius ?? 40) ** 2;
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
   *
   * Calling this is OPTIONAL — `sync` requests any source it is missing and upgrades the affected
   * entities on the next pass — but calling it means characters are rigged on their very first
   * frame instead of a quarter of a second later.
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
      const id = ids[index]!;
      if (result.status === "fulfilled") {
        loaded += 1;
        this.sources.set(id, result.value);
      } else {
        this.missing.add(id);
      }
    }
    return { loaded, missing: [...this.missing] };
  }

  /**
   * Grabs the true source graph for an asset, kicking off the (already-resolved) registry load the
   * first time it is asked for. Returns null until that microtask lands; callers degrade to the
   * static path and `sync` retries them once `sourcesChanged` flips.
   */
  private sourceOf(id: string): THREE.Object3D | null {
    const cached = this.sources.get(id);
    if (cached) return cached;
    if (!this.assets.isLoaded(id) || this.sourceRequests.has(id)) return null;
    this.sourceRequests.add(id);
    void this.assets
      .load(id)
      .then((group) => {
        this.sources.set(id, group);
        this.sourcesChanged = true;
      })
      .catch(() => {
        this.missing.add(id);
      });
    return null;
  }

  // ---------------------------------------------------------------- sync

  /**
   * Reconciles the drawn world with the semantic world.
   *
   * Cheap by design: an entity whose position, state, tier and asset are unchanged costs one string
   * comparison. Entities that vanished from the list release their slot; new ones take one.
   */
  sync(entities: readonly SemanticEntity[]): void {
    if (this.sourcesChanged) {
      this.sourcesChanged = false;
      this.dropUnposed();
    }

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

  /**
   * Per-frame tick. The root calls this from the render frame:
   *
   *   entityViews.update(deltaSeconds, renderer.camera.position);
   *
   * `sync` is NOT this — it runs a few times a second and diffs semantics. Animation needs real
   * wall-clock delta every frame, which is why it is a separate entry point.
   *
   * The viewer position is optional. With it, rigs are ticked nearest-first and anything past
   * `animationRadius` stops being ticked at all; without it, the nearest-first ordering is skipped
   * and the budget alone applies. Either way an untickled rig FREEZES on its current pose rather
   * than snapping back to bind, so the fallback is a still character, never a T-pose.
   */
  update(deltaSeconds: number, viewer?: THREE.Vector3): void {
    this.animatedLastFrame = 0;
    if (this.animated.size === 0) return;

    // A backgrounded tab hands back a delta of seconds. Fast-forwarding a crowd through 40 loops
    // of an idle clip costs real time and looks identical to not doing it.
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.25);

    // Reused rather than rebuilt: this runs every frame, and a fresh array per frame is garbage
    // the collector has to walk during exactly the frames that are already the most expensive.
    const ranked = this.animationOrder;
    ranked.length = 0;
    for (const record of this.animated) ranked.push(record);
    if (viewer && ranked.length > 1) {
      ranked.sort((a, b) =>
        a.position.distanceToSquared(viewer) - b.position.distanceToSquared(viewer));
    }

    for (const record of ranked) {
      if (this.animatedLastFrame >= this.maxAnimatedViews) break;
      if (viewer && record.position.distanceToSquared(viewer) > this.animationRadiusSq) break;
      record.rig?.mixer.update(delta);
      this.animatedLastFrame += 1;
    }
  }

  private syncOne(entity: SemanticEntity): void {
    const view = entity.view!;
    if (this.missing.has(view.assetId) || !this.assets.isLoaded(view.assetId)) return;

    const tier = view.materialTier ?? entity.tier;
    const groupKey = `${view.assetId}|${view.depletedAssetId ?? "-"}|${tier}|${entity.archetype}`;
    const spent = SPENT_STATES.has(entity.state);
    const silhouette = TIERED_ARCHETYPES.has(entity.archetype) ? tierSilhouetteScale(tier) : 1;
    const scale = (view.scale ?? 1) * silhouette;
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
      this.applyUniqueState(record, tier);
    } else {
      this.writeSlot(group, record.slot, record.position, record.rotationY, scale, spent);
      group.dirty = true;
    }

    const highlight = this.highlights.get(entity.id);
    if (highlight) this.placeHighlight(highlight, record);
  }

  private acquire(entity: SemanticEntity, groupKey: string, tier: number): ViewRecord | null {
    const view = entity.view!;
    const group = this.ensureGroup(groupKey, view.assetId, view.depletedAssetId ?? null, entity.archetype, tier);
    if (!group) return null;

    // Rigged characters cannot be instanced with a live pose (their pose lives in the skeleton), so
    // a capped number of them get their own object and a mixer. The rest fall back to an instance
    // of the baked idle pose, which is cheap and — unlike bind pose — looks like a person.
    const rigged = group.liveParts.length === 0 || this.isRigged(view.assetId);
    const source = rigged ? this.sourceOf(view.assetId) : null;
    let unique: THREE.Object3D | null = null;
    let rig: RigState | null = null;
    let uniqueMeshes = 0;
    let uniqueCost = 0;

    if (source && this.canAffordUnique(entity.archetype, view.assetId, source)) {
      uniqueMeshes = this.meshesIn(view.assetId, source);
      uniqueCost = uniqueMeshes * 2;
      unique = cloneRigged(source);
      unique.userData.entityId = entity.id;
      unique.traverse((child) => {
        child.userData.entityId = entity.id;
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Characters ground themselves with their own shadow. It is the second draw the budget
        // above is counting, and a floating shadowless NPC reads as unfinished on its own.
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Keep the authored material, so a live -> dead -> respawned entity re-derives its look
        // from the ART rather than from its own previous variant. Compounding variants is how a
        // node that respawns after being mined comes back permanently grey.
        mesh.userData.baseMaterial = mesh.material;
      });
      this.group.add(unique);
      this.uniqueDrawCalls += uniqueCost;
      rig = this.attachRig(entity, unique, view.assetId);
    }

    const slot = unique ? -1 : this.takeSlot(group, entity.id);
    if (!unique && slot < 0) return null;

    const record: ViewRecord = {
      entityId: entity.id,
      archetype: entity.archetype,
      groupKey,
      slot,
      unique,
      rig,
      uniqueMeshes,
      uniqueCost,
      // A rigged entity built before its skeleton source arrived is re-acquired on the next sync.
      awaitingRig: rigged && !source,
      signature: "",
      position: new THREE.Vector3(),
      rotationY: view.rotationY ?? 0,
      scale: 1,
      spent: false,
      labelHeight: view.labelHeight ?? 1.6,
      radius: this.minHighlightRadius,
    };
    this.records.set(entity.id, record);
    if (rig) this.animated.add(record);
    return record;
  }

  private release(record: ViewRecord): void {
    if (record.rig) {
      record.rig.action.stop();
      record.rig.mixer.stopAllAction();
      if (record.unique) record.rig.mixer.uncacheRoot(record.unique);
      this.animated.delete(record);
      record.rig = null;
    }
    if (record.unique) {
      record.unique.removeFromParent();
      record.unique = null;
      this.uniqueDrawCalls = Math.max(0, this.uniqueDrawCalls - record.uniqueCost);
      record.uniqueCost = 0;
      record.uniqueMeshes = 0;
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

  /**
   * Throws away everything that was built while a skeleton source was still in flight, so the next
   * sync pass rebuilds it properly: unique objects get a real rig, and instanced rigged groups get
   * their baked pose instead of bind pose.
   *
   * This runs at most once per boot in practice. `AssetRegistry.load` resolves from cache in a
   * single microtask, so the only pass that ever sees a missing source is the synchronous one boot
   * fires before the loop starts.
   */
  private dropUnposed(): void {
    const stale = new Set<string>();
    for (const [key, group] of this.groups) {
      if (group.needsPose && this.sources.has(group.assetId)) stale.add(key);
    }

    for (const [entityId, record] of [...this.records]) {
      const group = this.groups.get(record.groupKey);
      const sourceReady = group ? this.sources.has(group.assetId) : false;
      if (!stale.has(record.groupKey) && !(record.awaitingRig && sourceReady)) continue;
      this.release(record);
      this.records.delete(entityId);
    }

    for (const key of stale) {
      const group = this.groups.get(key);
      if (!group) continue;
      for (const mesh of [...group.live, ...group.spent]) mesh.removeFromParent();
      this.groups.delete(key);
    }
  }

  // ------------------------------------------------------------- groups

  private ensureGroup(
    key: string,
    assetId: string,
    depletedAssetId: string | null,
    archetype: Archetype,
    tier: number,
  ): InstanceGroup | null {
    const existing = this.groups.get(key);
    if (existing) return existing;

    const rigged = this.isRigged(assetId);
    const source = rigged ? this.sourceOf(assetId) : null;
    const liveParts = rigged && source
      ? this.bakedParts(source, assetId, archetype, tier, false)
      : this.collectParts(assetId, archetype, tier, false);

    // The ore seam. It is a separate part on the LIVE side only: losing the vein is half of what
    // makes a depleted node read as depleted.
    if (archetype === "ore" && liveParts.length > 0) {
      const seam = this.seamPart(assetId, tier, liveParts);
      if (seam) liveParts.push(seam);
    }

    const group: InstanceGroup = {
      key,
      assetId,
      depletedAssetId,
      archetype,
      tier,
      capacity: 0,
      slots: [],
      free: [],
      liveParts,
      spentParts: null,
      live: [],
      spent: [],
      posed: rigged && source !== null,
      needsPose: rigged && source === null,
      dirty: false,
    };
    this.groups.set(key, group);
    this.resize(group, 8);
    return group;
  }

  /**
   * Builds the spent variant on first use.
   *
   * Round 1 built it eagerly for every group, which doubled the instanced mesh count of the whole
   * entity layer for a state most nodes are never in. With ~50 groups in the world that is ~50
   * draw calls spent on hidden geometry, against a 400 ceiling the world was already over.
   */
  private ensureSpent(group: InstanceGroup): void {
    if (group.spent.length > 0) return;
    if (!group.spentParts) {
      const spentSource = group.depletedAssetId && this.assets.isLoaded(group.depletedAssetId)
        ? group.depletedAssetId
        : group.assetId;
      const rigged = this.isRigged(spentSource);
      const source = rigged ? this.sourceOf(spentSource) : null;
      group.spentParts = rigged && source
        ? this.bakedParts(source, spentSource, group.archetype, group.tier, true)
        : this.collectParts(spentSource, group.archetype, group.tier, true);
    }
    if (group.spentParts.length === 0) return;
    group.spent = this.buildMeshes(group, group.spentParts, "spent");
  }

  /**
   * Pulls (geometry, material, local transform) out of a loaded GLB and builds the tier variant of
   * each material. `MaterialLibrary.variant` keeps the source's base-colour texture and swaps only
   * colour/roughness/emissive, which is what stops tier ladders from fragmenting instancing
   * (architecture correction R6).
   */
  private collectParts(
    assetId: string,
    archetype: Archetype,
    tier: number,
    spent: boolean,
  ): SourcePart[] {
    if (!this.assets.isLoaded(assetId)) return [];
    const source = this.sources.get(assetId) ?? this.assets.instance(assetId);
    source.updateMatrixWorld(true);

    const parts: SourcePart[] = [];
    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!base) return;
      parts.push({
        geometry: mesh.geometry,
        material: this.variantFor(base, archetype, tier, spent),
        matrix: mesh.matrixWorld.clone(),
        triangles: triangleCount(mesh.geometry),
      });
    });
    return parts;
  }

  /**
   * The instanced fallback for a rigged asset: one idle frame, CPU-skinned into static geometry.
   *
   * An `InstancedMesh` ignores skinning entirely, so instancing a skinned geometry raw draws it in
   * bind pose — the arms-straight-out look that was the single strongest "unfinished build" signal
   * in the round-1 screenshots. Baking costs a few milliseconds once per asset and nothing per
   * frame, and keeps forty background characters at four draw calls instead of a hundred and sixty.
   *
   * Falls back to the raw (bind-pose) parts if anything about the rig is unexpected. A slightly
   * wrong pose is worth having; a boot failure over a cosmetic path is not.
   */
  private bakedParts(
    source: THREE.Object3D,
    assetId: string,
    archetype: Archetype,
    tier: number,
    spent: boolean,
  ): SourcePart[] {
    try {
      const posed = cloneRigged(source);
      const clip = this.firstFittingClip(this.idleCandidates(assetId, assetId), posed);
      if (clip) {
        const mixer = new THREE.AnimationMixer(posed);
        mixer.clipAction(clip).play();
        mixer.setTime(clip.duration * BAKE_PHASE);
      }
      posed.updateMatrixWorld(true);

      const parts: SourcePart[] = [];
      posed.traverse((child) => {
        const skinned = child as THREE.SkinnedMesh;
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!base) return;
        const material = this.variantFor(base, archetype, tier, spent);

        if (skinned.isSkinnedMesh && skinned.skeleton) {
          const frozen = freezeSkin(skinned);
          if (frozen) {
            this.bakedGeometries.push(frozen);
            // `applyBoneTransform` returns positions in the mesh's bind space, so the bind matrix
            // is exactly the transform that puts them back where the bones live.
            parts.push({
              geometry: frozen,
              material,
              matrix: skinned.bindMatrix.clone(),
              triangles: triangleCount(frozen),
            });
            return;
          }
        }
        parts.push({
          geometry: mesh.geometry,
          material,
          matrix: mesh.matrixWorld.clone(),
          triangles: triangleCount(mesh.geometry),
        });
      });
      if (parts.length > 0) return parts;
    } catch {
      // fall through to the unposed path
    }
    return this.collectParts(assetId, archetype, tier, spent);
  }

  /** Which tier treatment a given source material on a given archetype gets. */
  private variantFor(
    base: THREE.Material,
    archetype: Archetype,
    tier: number,
    spent: boolean,
  ): THREE.Material {
    const look = this.appearanceFor(archetype, base);
    return this.materials.variant(base, {
      tier,
      state: spent ? "depleted" : "normal",
      strength: look.strength,
      swatch: look.swatch,
    });
  }

  private appearanceFor(archetype: Archetype, material: THREE.Material): Appearance {
    if (PROTECTED_MATERIAL.test(material.name)) return NEUTRAL;
    if (archetype === "tree" && LEAF_MATERIAL.test(material.name)) {
      // Canopy stays close to its authored colour: species and scale carry a tree's region look,
      // and a heavy tint here fights the world layer rather than helping it.
      return { swatch: "accent", strength: 0.25 };
    }
    return APPEARANCE[archetype] ?? NEUTRAL;
  }

  // -------------------------------------------------------------- seams

  /**
   * The ore seam geometry for one asset: a ring of angular shards sunk into the upper half of the
   * rock so a tip pokes out on every bearing.
   *
   * Built from the ACTUAL bounding box of the collected parts, not the manifest's size, because the
   * manifest records extent and says nothing about where the origin sits — a seam placed off a
   * guessed origin floats beside its rock half the time.
   *
   * Cached per asset and shared across every tier of it, so this adds exactly one InstancedMesh per
   * ore group, not one per node.
   */
  private seamPart(assetId: string, tier: number, parts: readonly SourcePart[]): SourcePart | null {
    const geometry = this.seamGeometry(assetId, parts);
    if (!geometry) return null;
    return {
      geometry,
      material: this.materials.oreRock(tier, false),
      matrix: new THREE.Matrix4(),
      triangles: triangleCount(geometry),
    };
  }

  private seamGeometry(assetId: string, parts: readonly SourcePart[]): THREE.BufferGeometry | null {
    const cached = this.seamGeometries.get(assetId);
    if (cached) return cached;

    const box = new THREE.Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      const bounds = part.geometry.boundingBox;
      if (!bounds) continue;
      box.union(bounds.clone().applyMatrix4(part.matrix));
    }
    if (box.isEmpty()) return null;

    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;

    // Deterministic jitter, seeded from the asset id: the same rock always grows the same vein, in
    // every session and every screenshot.
    const rng = new Rng(hashString(assetId));
    const radius = Math.min(size.x, size.z) * 0.34;
    const shards: THREE.BufferGeometry[] = [];
    for (let index = 0; index < SEAM_SHARDS; index += 1) {
      const angle = (index / SEAM_SHARDS) * Math.PI * 2 + rng.float(-0.3, 0.3);
      const shard = new THREE.OctahedronGeometry(1, 0);
      shard.scale(size.x * 0.115, size.y * 0.2, size.z * 0.115);
      shard.rotateZ(rng.float(-0.55, 0.55));
      shard.rotateY(angle);
      shard.translate(
        centre.x + Math.sin(angle) * radius,
        centre.y + size.y * rng.float(-0.02, 0.28),
        centre.z + Math.cos(angle) * radius,
      );
      shards.push(shard);
    }

    const merged = mergeGeometries(shards, false);
    for (const shard of shards) shard.dispose();
    if (!merged) return null;
    merged.computeBoundingSphere();
    this.seamGeometries.set(assetId, merged);
    return merged;
  }

  // ---------------------------------------------------------- animation

  /**
   * Gives one rigged object a looping idle.
   *
   * Two sources of variety, both deterministic from the entity id so a screenshot is reproducible:
   * WHICH idle clip (four humanoid idles, so a row of NPCs is not doing the same thing) and WHERE
   * in the clip it starts (so the two who did land on the same clip are not in lockstep). Timescale
   * is nudged +/-12% for the same reason — identical loop lengths resynchronise within a minute.
   */
  private attachRig(entity: SemanticEntity, root: THREE.Object3D, assetId: string): RigState | null {
    const rng = new Rng(hashString(entity.id));
    const clip = this.firstFittingClip(this.idleCandidates(assetId, entity.id), root);
    if (!clip) return null;

    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    // setTime applies the pose as well as setting it, so the very first rendered frame is already
    // mid-idle. Without it the object holds bind pose until the first update() lands.
    mixer.setTime(rng.float(0, Math.max(0.001, clip.duration)));
    action.timeScale = rng.float(0.88, 1.12);
    return { mixer, action, clipName: clip.name };
  }

  /**
   * Idle clip names to try, best first.
   *
   * An asset that ships its own clips uses them and nothing else: the monster packs are not the
   * shared 65-bone humanoid, so a humanoid clip would bind to bones that do not exist. Everything
   * else draws from the shared library, rotated by a seed so the choice varies per entity.
   */
  private idleCandidates(assetId: string, varySeed: string): string[] {
    const own = this.assets.entry(assetId)?.animations ?? [];
    if (own.length > 0) {
      const idles = own.filter((name) => OWN_IDLE_PATTERN.test(name));
      return [...idles, ...own.filter((name) => !idles.includes(name))];
    }
    const start = new Rng(hashString(varySeed) ^ 0x51ed_27b1).int(0, HUMANOID_IDLES.length - 1);
    return [...HUMANOID_IDLES.slice(start), ...HUMANOID_IDLES.slice(0, start)];
  }

  private firstFittingClip(names: readonly string[], root: THREE.Object3D): THREE.AnimationClip | null {
    for (const name of names) {
      const clip = this.assets.clip(name);
      if (clip && clipFits(root, clip)) return clip;
    }
    return null;
  }

  /**
   * Whether this entity may take the non-instanced path, checked BEFORE the skeleton clone.
   *
   * Deciding after cloning would mean paying for ~50 rejected character clones at boot, which is
   * the kind of cost that only shows up as "the loading screen got slower" with nothing to blame.
   */
  private canAffordUnique(archetype: Archetype, assetId: string, source: THREE.Object3D): boolean {
    if (this.countUnique() >= this.maxUniqueViews) return false;
    const cost = this.meshesIn(assetId, source) * 2;
    if (cost === 0) return false;
    const named = archetype === "npc" || archetype === "boss";
    const ceiling = named ? this.maxUniqueDrawCalls : this.maxUniqueDrawCalls - NAMED_CHARACTER_RESERVE;
    return this.uniqueDrawCalls + cost <= ceiling;
  }

  private meshesIn(assetId: string, source: THREE.Object3D): number {
    const cached = this.meshCounts.get(assetId);
    if (cached !== undefined) return cached;
    let count = 0;
    source.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) count += 1;
    });
    this.meshCounts.set(assetId, count);
    return count;
  }

  private isRigged(assetId: string): boolean {
    const cached = this.riggedAssets.get(assetId);
    if (cached !== undefined) return cached;
    if (!this.assets.isLoaded(assetId)) return false;
    // Prefer the source graph: `AssetRegistry.instance()` deep-clones, and doing that per lookup
    // once cost a full character clone every time a group was resolved.
    const probe = this.sources.get(assetId) ?? this.assets.instance(assetId);
    let rigged = false;
    probe.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) rigged = true;
    });
    this.riggedAssets.set(assetId, rigged);
    return rigged;
  }

  // ------------------------------------------------------------- slots

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
    const hadSpent = group.spent.length > 0;
    for (const mesh of [...group.live, ...group.spent]) mesh.removeFromParent();
    group.live = [];
    group.spent = [];
    group.capacity = capacity;

    group.live = this.buildMeshes(group, group.liveParts, "live");
    if (hadSpent && group.spentParts) group.spent = this.buildMeshes(group, group.spentParts, "spent");

    // A resize throws away the old instance buffers, so every slot that already had an entity in it
    // has to be written back. Missing this is the classic instancing bug where half the world
    // disappears the moment one more node is added.
    for (const record of this.records.values()) {
      if (record.groupKey !== group.key || record.slot < 0 || record.slot >= capacity) continue;
      this.writeSlot(group, record.slot, record.position, record.rotationY, record.scale, record.spent);
    }
    group.dirty = true;
  }

  private buildMeshes(
    group: InstanceGroup,
    parts: readonly SourcePart[],
    suffix: string,
  ): THREE.InstancedMesh[] {
    return parts.map((part, index) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, group.capacity);
      mesh.name = `entity-${group.key}-${suffix}-${index}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      for (let slot = 0; slot < group.capacity; slot += 1) mesh.setMatrixAt(slot, HIDDEN);
      mesh.instanceMatrix.needsUpdate = true;
      // Allocated capacity is not the same as occupied capacity. See `flush`.
      mesh.count = group.slots.length;
      this.instanceOwners.set(mesh, group);
      this.group.add(mesh);
      return mesh;
    });
  }

  private writeSlot(
    group: InstanceGroup,
    slot: number,
    position: THREE.Vector3,
    rotationY: number,
    scale: number,
    spent: boolean,
  ): void {
    if (spent) this.ensureSpent(group);

    const placement = new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rotationY),
      new THREE.Vector3(scale, scale, scale),
    );
    const transform = new THREE.Matrix4();

    const active = spent ? group.spent : group.live;
    const activeParts = spent ? group.spentParts ?? [] : group.liveParts;
    const hidden = spent ? group.live : group.spent;

    for (const [index, mesh] of active.entries()) {
      const part = activeParts[index];
      if (!part) continue;
      transform.multiplyMatrices(placement, part.matrix);
      mesh.setMatrixAt(slot, transform);
    }
    for (const mesh of hidden) mesh.setMatrixAt(slot, HIDDEN);
  }

  /**
   * Paints a non-instanced entity for its current state, always from the authored material.
   *
   * A dead character keeps its rig but stops being ticked, so it holds whatever pose it stopped in
   * rather than popping back to bind — which is the one thing that would put the arms-out silhouette
   * back on screen after all this.
   */
  private applyUniqueState(record: ViewRecord, tier: number): void {
    if (!record.unique) return;

    if (record.rig) {
      record.rig.action.paused = record.spent;
      if (record.spent) this.animated.delete(record);
      else this.animated.add(record);
    }

    restoreBaseMaterials(record.unique);
    const look = APPEARANCE[record.archetype] ?? NEUTRAL;
    if (!record.spent) {
      this.materials.retint(record.unique, tier, look.strength, look.swatch, (material) =>
        !PROTECTED_MATERIAL.test(material.name));
      return;
    }
    record.unique.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // Death ignores the protected-material rule on purpose: a corpse with bright living eyes is
      // the wrong read, and this is the state the player most needs to see from across a clearing.
      const mapped = materials.map((material) =>
        this.materials.variant(material, { tier, state: "dead", strength: look.strength, swatch: look.swatch }));
      mesh.material = mapped.length === 1 ? mapped[0]! : mapped;
    });
  }

  /**
   * Uploads changed instance matrices and, just as importantly, trims `InstancedMesh.count` to the
   * slots actually in use.
   *
   * Capacity grows in steps of 1.6x + 8, so a group holding 9 entities allocates 22 slots. Parking
   * the spare 13 at a zero-scale matrix makes them invisible but NOT free: the draw still submits
   * `count` instances and `renderer.info.render.triangles` still counts every one of them. On a
   * rigged fallback group at ~27k triangles per character that is millions of phantom triangles in
   * the perf report, which is most of the gap between the 12.56M measured at `gravelmaw_entrance`
   * and what the visible world can account for.
   *
   * Slots are dense from zero and freed slots are reused, so `slots.length` is exactly the
   * high-water mark and the correct count.
   */
  private flush(): void {
    for (const group of this.groups.values()) {
      if (!group.dirty) continue;
      for (const mesh of [...group.live, ...group.spent]) {
        mesh.count = group.slots.length;
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
    let bakedPoses = 0;
    for (const group of this.groups.values()) {
      instancedMeshes += group.live.length + group.spent.length;
      if (group.posed) bakedPoses += 1;
      const active = group.slots.filter((slot) => slot !== null).length;
      for (const part of group.liveParts) triangles += part.triangles * active;
    }

    let unique = 0;
    let uniqueMeshes = 0;
    let uniqueTriangles = 0;
    for (const record of this.records.values()) {
      if (!record.unique) continue;
      unique += 1;
      uniqueMeshes += record.uniqueMeshes;
      record.unique.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) uniqueTriangles += triangleCount(mesh.geometry);
      });
    }

    return {
      entities: this.records.size,
      groups: this.groups.size,
      instancedMeshes,
      uniqueViews: unique,
      riggedViews: this.animated.size,
      animatedLastFrame: this.animatedLastFrame,
      bakedPoses,
      highlights: this.highlights.size,
      // Counted, not guessed, and with the shadow pass in it. Every instanced entity mesh and every
      // unique character mesh casts, so each is two submitted draws; highlights are unlit overlays
      // and are not, so a ring plus a pip is two.
      estimatedDrawCalls: instancedMeshes * 2 + uniqueMeshes * 2 + this.highlights.size * 2,
      uniqueDrawCalls: this.uniqueDrawCalls,
      triangles: Math.round(triangles + uniqueTriangles),
      missingAssets: [...this.missing],
    };
  }

  dispose(): void {
    this.clearAllHighlights();
    for (const record of this.records.values()) this.release(record);
    this.group.clear();
    this.groups.clear();
    this.records.clear();
    this.animated.clear();
    this.meshCounts.clear();
    this.uniqueDrawCalls = 0;
    for (const geometry of this.seamGeometries.values()) geometry.dispose();
    for (const geometry of this.bakedGeometries) geometry.dispose();
    this.seamGeometries.clear();
    this.bakedGeometries.length = 0;
    this.sources.clear();
    this.sourceRequests.clear();
    this.riggedAssets.clear();
    this.ringGeometry?.dispose();
    this.pipGeometry?.dispose();
    this.ringGeometry = null;
    this.pipGeometry = null;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.round(index.count / 3);
  const position = geometry.getAttribute("position");
  return position ? Math.round(position.count / 3) : 0;
}

/** Puts a unique object back on the materials its GLB shipped with, before a state is re-applied. */
function restoreBaseMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const base = mesh.userData.baseMaterial as THREE.Material | THREE.Material[] | undefined;
    if (base) mesh.material = base;
  });
}

/** FNV-1a. Deterministic per-entity seeds, so animation phase survives a reload unchanged. */
function hashString(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/**
 * Whether a clip's tracks address bones this object actually has.
 *
 * `AssetRegistry` keys its clip library by NAME across every pack, and the three monster packs all
 * export a clip called `Idle` on three different skeletons — so "the clip named Idle" is whichever
 * GLB loaded first, and playing it on the wrong rig silently animates nothing. Sampling the first
 * dozen tracks (which are the root and spine bones, i.e. the discriminating ones) is enough to
 * reject a mismatch before it becomes a character frozen in bind pose with no error anywhere.
 */
function clipFits(root: THREE.Object3D, clip: THREE.AnimationClip): boolean {
  let checked = 0;
  let matched = 0;
  for (const track of clip.tracks) {
    if (checked >= 12) break;
    try {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      if (!parsed.nodeName) continue;
      checked += 1;
      if (THREE.PropertyBinding.findNode(root, parsed.nodeName)) matched += 1;
    } catch {
      return false;
    }
  }
  return checked > 0 && matched / checked >= 0.75;
}

/**
 * CPU-skins one posed frame of a `SkinnedMesh` into a static geometry.
 *
 * The bone matrices come from the object's world matrices, so the caller must have posed the
 * skeleton and called `updateMatrixWorld` first. Skin attributes are dropped from the result: they
 * are dead weight on an instanced draw, and leaving them means Three.js still reports the geometry
 * as skinnable.
 *
 * Returns null rather than the source geometry when the mesh cannot be baked. The caller registers
 * whatever it gets back for disposal, and handing it the shared source geometry would mean
 * disposing the asset itself out from under every other user of it.
 */
function freezeSkin(mesh: THREE.SkinnedMesh): THREE.BufferGeometry | null {
  const source = mesh.geometry;
  const position = source.getAttribute("position");
  if (!position || !source.getAttribute("skinIndex") || !source.getAttribute("skinWeight")) {
    return null;
  }

  const baked = source.clone();
  const output = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    mesh.applyBoneTransform(index, vertex);
    output.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }

  baked.setAttribute("position", output);
  baked.deleteAttribute("skinIndex");
  baked.deleteAttribute("skinWeight");
  // Normals were authored for the bind pose; a bent elbow needs them recomputed or it lights flat.
  baked.computeVertexNormals();
  baked.computeBoundingSphere();
  return baked;
}
