/**
 * Asset registry. Reads game/public/assets/manifest.json and loads GLBs on demand.
 *
 * Two things matter here and both are measured, not assumed (runs/corealm/stack-findings.md):
 *  - Every character pack shares one 65-bone skeleton, so animation clips load ONCE into a shared
 *    library and play on any rig without retargeting.
 *  - Assets are metres, Y-up. No global scale factor anywhere.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSET_BASE_URL, ASSET_MANIFEST_URL } from "../app/config.js";
import { BOOT_SPANS, bootTelemetry } from "../perf/bootTelemetry.js";
import { mirrorAnimationClip } from "./skinning.js";

/** Suffix for a generated mirror. Shared with `render/characterRig.ts`, which names the clips. */
export const MIRROR_SUFFIX = "_Mirror";

/**
 * Clips that exist only for the left hand and are needed for the right.
 *
 * The whole list is the spell set. Everything else in the library is either symmetric (locomotion)
 * or already authored for the main hand (`Sword_Attack`, `TreeChopping_Loop`).
 */
const MIRRORED_CLIPS: readonly string[] = ["Spell_Simple_Shoot", "Spell_Simple_Idle_Loop"];

export type AssetCategory =
  | "nature" | "rock" | "building" | "prop" | "farm"
  | "dungeon" | "character" | "outfit" | "weapon" | "animation" | "water";

export interface AssetEntry {
  id: string;
  file: string;
  pack: string;
  category: AssetCategory;
  /**
   * What this mesh IS. One word, the subject of the model.
   *
   * Separate from `tags`, and the separation is the point. `anvil_log` is tagged
   * ["anvil", "log", "stump", "smithing", "forge", "crafting"] because it is an anvil standing on a
   * cut log — and Phase 1 read "stump" off that list and used it as every felled tree in the world
   * and as the landmark Rootfall is built around. Tags say what a mesh contains, sits on, or is
   * used for. `is` says what it is, and it is the only field a "find me a stump" lookup may read.
   */
  is: string;
  /** What it contains, relates to, or is used for. Never what it is; see `is`. */
  tags: string[];
  bytes: number;
  size: { x: number; y: number; z: number };
  /**
   * World-space bounding-box MINIMUM corner in metres, from the same measurement as `size`, so
   * `base + size` is the maximum corner. Emitted by tools/build-assets.ts.
   *
   * Optional on the type only because a manifest built before Phase 2 will not carry it; read it
   * through `baseY()`, which falls back to 0. See `baseY` for why it matters.
   */
  base?: { x: number; y: number; z: number };
  animations: string[];
  materials: string[];
  /**
   * Ground speed this asset's `Walk` cycle looks like it travels at, metres per second.
   *
   * Emitted by tools/build-animals.ts, measured off the feet because the animal cycles are authored
   * in place. `render/entityViews.ts` divides the creature's real speed by it to retime the clip.
   */
  impliedWalkMps?: number;
  /**
   * Length of the walk cycle in seconds.
   *
   * NOT read at runtime — `motionTimeScale` has the live `AnimationClip` and uses its own duration.
   * This is the build-time copy, so `content/enemies.ts` can solve each creature's `moveSpeedMps`
   * against its gait and `tests/creature-gait.test.ts` can check the result without loading GLBs.
   * Cadence needs the clip's length as well as its playback rate: the same rate is 3.4 cycles a
   * second on the goat's 0.47 s clip and 1.2 on the hog's 1.33 s one.
   */
  walkClipSeconds?: number;
}

export interface AssetPack {
  id: string;
  name: string;
  author: string;
  source: string;
  license: string;
  /** Lowercase SHA-256 of the pinned source archive for reproducible provenance. */
  archiveSha256?: string;
}

export interface AssetManifest {
  generatedAt: string;
  packs: AssetPack[];
  assets: AssetEntry[];
}

/**
 * Scheduling class for a GLB request. Higher classes enter the bounded loader queue first.
 *
 * Region-scoped work outside the active region is temporarily treated as background work. Its
 * declared priority is retained, so returning to that region restores the request automatically.
 */
export type AssetPriority = "player" | "visible-spawn" | "travel-prefetch" | "background";

export interface PrimaryAssetRetryEvent {
  assetId: string;
  /** The loader attempt that just failed, starting at 1. */
  attempt: number;
  error: Error;
  /** Starts another deduplicated attempt. Safe for more than one listener to call. */
  retry: () => Promise<THREE.Group>;
}

export type PrimaryAssetRetryCallback = (event: PrimaryAssetRetryEvent) => void;

export interface AssetLoadOptions {
  priority?: AssetPriority;
  /** Semantic region that needs the visual. Used only to schedule the request. */
  regionId?: string;
  /** Notify retry listeners if this request fails. */
  primary?: boolean;
  /** Per-request listener for a failed primary asset. */
  onRetry?: PrimaryAssetRetryCallback;
}

export interface AssetLoadStats {
  /** Authored file assets in the loaded manifest. */
  total: number;
  /** Unique authored asset ids requested during this registry's lifetime. */
  requested: number;
  /** Requested authored assets currently present in the cache. */
  loaded: number;
  /** Unique requested assets whose latest completed attempt failed. */
  failed: number;
  queued: number;
  inflight: number;
}

interface QueuedAssetLoad {
  id: string;
  entry: AssetEntry;
  priority: AssetPriority;
  primary: boolean;
  retryCallbacks: Set<PrimaryAssetRetryCallback>;
  regions: Set<string>;
  unscoped: boolean;
  sequence: number;
  resolve: (group: THREE.Group) => void;
  reject: (error: Error) => void;
}

const ASSET_PRIORITY_RANK: Readonly<Record<AssetPriority, number>> = {
  player: 3,
  "visible-spawn": 2,
  "travel-prefetch": 1,
  background: 0,
};

const DEFAULT_ASSET_PRIORITY: AssetPriority = "background";
const MAX_CONCURRENT_ASSET_LOADS = 8;

export class AssetRegistry {
  private manifest: AssetManifest | null = null;
  private byId = new Map<string, AssetEntry>();
  private loader = new GLTFLoader();
  private loaded = new Map<string, THREE.Group>();
  /**
   * Ids that were BUILT rather than fetched, so `loadManifest` can catch a collision the other way
   * round. `registerBuilt` runs before the manifest resolves, so its own `byId` check has nothing to
   * compare against; this is the half that does the catching.
   */
  private readonly built = new Set<string>();
  /** Includes queued and actively loading requests so both states deduplicate callers. */
  private inflight = new Map<string, Promise<THREE.Group>>();
  private pendingRequests = new Map<string, QueuedAssetLoad>();
  private queued = new Map<string, QueuedAssetLoad>();
  private requested = new Set<string>();
  private loadedFiles = new Set<string>();
  private failed = new Set<string>();
  private attempts = new Map<string, number>();
  private primaryRetryCallbacks = new Set<PrimaryAssetRetryCallback>();
  private activeRegionId: string | null = null;
  private activeLoads = 0;
  private nextSequence = 0;
  private queueScheduled = false;
  /**
   * Shared humanoid clip library, keyed by bare clip name.
   *
   * Safe ONLY because every humanoid pack shares one identical 65-bone skeleton (measured, see
   * runs/corealm/stack-findings.md section 2), so a clip from any of them plays on any of them.
   */
  private clips = new Map<string, THREE.AnimationClip>();

  /**
   * Per-asset clips, keyed `${assetId}:${clipName}`.
   *
   * The monster GLBs each export clips called `Idle` / `Walk` / `Death` on three DIFFERENT
   * skeletons, so a single global name map lets whichever file loaded first win the name and
   * deform the others. Every clip is recorded here as well, so a caller that knows which asset it
   * is animating can ask for that asset's own clip instead of a same-named stranger's.
   */
  private assetClips = new Map<string, THREE.AnimationClip>();

  async loadManifest(): Promise<AssetManifest> {
    const response = await fetch(ASSET_MANIFEST_URL);
    if (!response.ok) throw new Error(`Asset manifest failed: ${response.status} ${response.statusText}`);
    const manifest = (await response.json()) as AssetManifest;
    this.manifest = manifest;
    this.byId.clear();
    for (const entry of manifest.assets) {
      // The other half of `registerBuilt`'s guard. Built assets are registered at boot, before this
      // fetch resolves, so their own collision check runs against an empty map. If a future
      // `tools/build-assets.ts` run ever emits a file under a built id, the built mesh would shadow
      // it silently for the whole session — so it fails here instead, once, at load.
      if (this.built.has(entry.id)) {
        throw new Error(`Manifest asset id collides with a procedurally built asset: ${entry.id}`);
      }
      this.byId.set(entry.id, entry);
    }
    return manifest;
  }

  getManifest(): AssetManifest | null {
    return this.manifest;
  }

  entry(id: string): AssetEntry | undefined {
    return this.byId.get(id);
  }

  /**
   * Distance from an asset's GLB origin down to the bottom of its geometry, metres, unscaled.
   * 0 for an unknown id or a manifest without the field.
   *
   * Placing a GLB's origin at ground height leaves it floating or sunk by exactly
   * `baseY(id) * scale` — measured to 3 decimals across 159 world entities in the Phase 2
   * grounding sweep, where it left the Fallen Duskoak (roof_log, base.y +3.849) hovering 5.77 m
   * and every farm plot (crop_carrot, base.y -0.238) fully underground. Ground-aligned placement
   * is `y = groundHeight - baseY(id) * scale`; 117 of 213 assets need more than 2 cm of it.
   *
   * Synchronous by contract: it is a map lookup against the already-parsed manifest, so world
   * construction can call it per entity. It takes an id and returns a number and touches nothing
   * else in this class, so it is injected into the world layer as a plain
   * `(assetId: string) => number` port the way `heightAt` already is — world/ must not import
   * render/, and with this shape it does not have to.
   */
  baseY(assetId: string): number {
    return this.byId.get(assetId)?.base?.y ?? 0;
  }

  /**
   * An asset's measured world-space bounding-box extent in metres, or null if the id is unknown.
   * Same data `baseY` reads; together they give the full box.
   */
  assetSize(assetId: string): { x: number; y: number; z: number } | null {
    return this.byId.get(assetId)?.size ?? null;
  }

  /** Local XZ centre of the measured mesh bounds relative to the GLB origin. */
  assetCenterXZ(assetId: string): { x: number; z: number } | null {
    const entry = this.byId.get(assetId);
    if (!entry) return null;
    return {
      x: (entry.base?.x ?? -entry.size.x / 2) + entry.size.x / 2,
      z: (entry.base?.z ?? -entry.size.z / 2) + entry.size.z / 2,
    };
  }

  /** All assets in a category, in manifest order. */
  byCategory(category: AssetCategory): AssetEntry[] {
    return (this.manifest?.assets ?? []).filter((asset) => asset.category === category);
  }

  /**
   * Assets that ARE the given subject.
   *
   * Use this, not `byTags`, whenever the question is "what mesh is a stump / a barrel / a door".
   * `byTags("stump")` answers with anything that has a stump somewhere in it, which is how a
   * blacksmith's anvil ended up standing where every felled tree in Phase 1 used to be.
   */
  byIs(subject: string): AssetEntry[] {
    const wanted = subject.toLowerCase();
    return (this.manifest?.assets ?? []).filter((asset) => (asset.is ?? "").toLowerCase() === wanted);
  }

  /**
   * Assets carrying every one of the given tags.
   *
   * Correct for "anything to do with farming" and wrong for "a stump". Tags are associations, not
   * identity: see `is`.
   */
  byTags(...tags: string[]): AssetEntry[] {
    const wanted = tags.map((tag) => tag.toLowerCase());
    return (this.manifest?.assets ?? []).filter((asset) => {
      const owned = asset.tags.map((tag) => tag.toLowerCase());
      return wanted.every((tag) => owned.includes(tag));
    });
  }

  /**
   * Loads a GLB and caches its scene graph. Callers clone; they never mutate the cached original.
   *
   * The returned promise is registered before the request enters the queue. Concurrent callers for
   * the same id therefore share one queued or active request. A later caller can raise that request's
   * priority or add an active-region consumer without starting a second fetch.
   */
  load(id: string, options: AssetLoadOptions = {}): Promise<THREE.Group> {
    const cached = this.loaded.get(id);
    if (cached) return Promise.resolve(cached);
    const existing = this.inflight.get(id);
    if (existing) {
      this.mergeQueuedOptions(id, options);
      return existing;
    }

    const entry = this.byId.get(id);
    if (!entry) return Promise.reject(new Error(`Unknown asset id: ${id}`));

    let resolve!: (group: THREE.Group) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<THREE.Group>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const request: QueuedAssetLoad = {
      id,
      entry,
      priority: options.priority ?? DEFAULT_ASSET_PRIORITY,
      primary: options.primary ?? options.onRetry !== undefined,
      retryCallbacks: new Set(options.onRetry ? [options.onRetry] : []),
      regions: new Set(options.regionId !== undefined ? [options.regionId] : []),
      unscoped: options.regionId === undefined,
      sequence: this.nextSequence++,
      resolve,
      reject,
    };

    this.requested.add(id);
    this.inflight.set(id, promise);
    this.pendingRequests.set(id, request);
    this.queued.set(id, request);
    this.scheduleQueue();
    return promise;
  }

  /** Re-attempts an asset after failure. Loaded and already-active assets still deduplicate. */
  retry(id: string, options: AssetLoadOptions = {}): Promise<THREE.Group> {
    return this.load(id, { ...options, primary: options.primary ?? true });
  }

  /**
   * Registers a session-wide listener for failed primary assets. The listener receives a retry
   * function rather than a placeholder, so a temporary fetch or parse failure never becomes a
   * permanent visual state.
   */
  onPrimaryAssetRetry(callback: PrimaryAssetRetryCallback): () => void {
    this.primaryRetryCallbacks.add(callback);
    return () => this.primaryRetryCallbacks.delete(callback);
  }

  /**
   * Changes only request scheduling. Queued non-player work for other regions drops to background
   * priority until its region becomes active again. Active fetches are allowed to finish and remain
   * useful in the cache.
   */
  setActiveRegion(regionId: string | null): void {
    if (this.activeRegionId === regionId) return;
    this.activeRegionId = regionId;
    this.scheduleQueue();
  }

  getActiveRegion(): string | null {
    return this.activeRegionId;
  }

  private mergeQueuedOptions(id: string, options: AssetLoadOptions): void {
    const request = this.pendingRequests.get(id);
    if (!request) return;

    const priority = options.priority ?? DEFAULT_ASSET_PRIORITY;
    if (ASSET_PRIORITY_RANK[priority] > ASSET_PRIORITY_RANK[request.priority]) {
      request.priority = priority;
    }
    request.primary ||= options.primary ?? options.onRetry !== undefined;
    if (options.onRetry) request.retryCallbacks.add(options.onRetry);
    if (options.regionId === undefined) request.unscoped = true;
    else request.regions.add(options.regionId);
    this.scheduleQueue();
  }

  private scheduleQueue(): void {
    if (this.queueScheduled) return;
    this.queueScheduled = true;
    queueMicrotask(() => {
      this.queueScheduled = false;
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    while (this.activeLoads < MAX_CONCURRENT_ASSET_LOADS) {
      const request = this.nextQueuedLoad();
      if (!request) return;
      this.queued.delete(request.id);
      this.activeLoads += 1;
      this.startQueuedLoad(request);
    }
  }

  private nextQueuedLoad(): QueuedAssetLoad | null {
    let best: QueuedAssetLoad | null = null;
    let bestRank = -1;
    for (const request of this.queued.values()) {
      const rank = ASSET_PRIORITY_RANK[this.effectivePriority(request)];
      if (rank > bestRank || (rank === bestRank && request.sequence < (best?.sequence ?? Infinity))) {
        best = request;
        bestRank = rank;
      }
    }
    return best;
  }

  private effectivePriority(request: QueuedAssetLoad): AssetPriority {
    if (request.priority === "player" || this.activeRegionId === null || request.unscoped) {
      return request.priority;
    }
    return request.regions.has(this.activeRegionId) ? request.priority : "background";
  }

  private startQueuedLoad(request: QueuedAssetLoad): void {
    const { id, entry } = request;
    const attempt = (this.attempts.get(id) ?? 0) + 1;
    this.attempts.set(id, attempt);
    const parseSpan = bootTelemetry.startSpan(BOOT_SPANS.GLTF_PARSE, {
      detail: { assetId: id, file: entry.file },
    });

    void Promise.resolve()
      .then(() => this.loader.loadAsync(`${ASSET_BASE_URL}${entry.file.replace(/^\/+/, "")}`))
      .then((gltf) => {
        const group = gltf.scene;
        group.name = id;
        for (const clip of gltf.animations) {
          this.assetClips.set(`${id}:${clip.name}`, clip);
          // The shared library is for the humanoid rig only. Letting a crab's "Idle" claim the
          // global name would hand it to every base character that asks for one.
          if (entry.category === "animation" && !this.clips.has(clip.name)) {
            this.clips.set(clip.name, clip);
          }
        }
        this.loaded.set(id, group);
        this.loadedFiles.add(id);
        this.failed.delete(id);
        this.inflight.delete(id);
        this.pendingRequests.delete(id);
        parseSpan.end({ assetId: id, file: entry.file, clips: gltf.animations.length });
        request.resolve(group);
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.failed.add(id);
        this.inflight.delete(id);
        this.pendingRequests.delete(id);
        parseSpan.fail(failure, { assetId: id, file: entry.file });
        if (request.primary) this.notifyPrimaryFailure(request, attempt, failure);
        request.reject(failure);
      })
      .finally(() => {
        this.activeLoads -= 1;
        this.scheduleQueue();
      });
  }

  private notifyPrimaryFailure(request: QueuedAssetLoad, attempt: number, error: Error): void {
    const event: PrimaryAssetRetryEvent = {
      assetId: request.id,
      attempt,
      error,
      retry: () => this.retryQueuedRequest(request),
    };
    const callbacks = new Set([...this.primaryRetryCallbacks, ...request.retryCallbacks]);
    for (const callback of callbacks) {
      // Retry observers must not replace the loader failure or prevent other observers from running.
      try {
        callback(event);
      } catch {
        // The original request still rejects with the loader error.
      }
    }
  }

  private retryQueuedRequest(previous: QueuedAssetLoad): Promise<THREE.Group> {
    const regions = [...previous.regions];
    const firstRegion = previous.unscoped ? undefined : regions[0];
    const promise = this.retry(previous.id, {
      priority: previous.priority,
      primary: true,
      regionId: firstRegion,
    });
    const request = this.queued.get(previous.id);
    if (request) {
      request.unscoped = previous.unscoped;
      for (const region of regions) request.regions.add(region);
      for (const callback of previous.retryCallbacks) request.retryCallbacks.add(callback);
    }
    return promise;
  }

  /**
   * Publishes an already-built group under an id, into the same cache `load()` checks first.
   * Callers keep ownership of its geometry and materials.
   */
  registerBuilt(id: string, group: THREE.Group): void {
    // A built id that collides with a real asset would shadow the GLB for the whole session and
    // there would be no error anywhere; fail at boot instead, where the id can still be renamed.
    //
    // BOTH maps are checked, and that is the point. `byId` is populated by `loadManifest()` alone,
    // and `app/boot.ts` registers the built staffs BEFORE the manifest fetch resolves — so a `byId`
    // check on its own is guaranteed to be empty at the only call site there is, and would catch
    // nothing. `loaded` catches a second registration of the same id, and the manifest check below
    // catches the real case: a future `build-assets.ts` run emitting a `proc_staff_*` GLB.
    if (this.loaded.has(id)) throw new Error(`Built asset id registered twice: ${id}`);
    if (this.byId.has(id)) throw new Error(`Built asset id collides with a manifest asset: ${id}`);
    group.name = id;
    this.loaded.set(id, group);
    this.built.add(id);
  }

  async loadMany(ids: readonly string[], options: AssetLoadOptions = {}): Promise<void> {
    await Promise.all(ids.map((id) => this.load(id, options)));
  }

  /**
   * Loads the animation libraries into the shared clip library. Call once during boot.
   * Every character rig plays from here; the 65-bone skeleton is identical across packs.
   */
  async loadAnimationLibraries(): Promise<number> {
    const libraries = this.byCategory("animation");
    await Promise.all(libraries.map((entry) => this.load(entry.id, { priority: "player", primary: true })));
    this.registerMirroredClips();
    return this.clips.size;
  }

  /**
   * Adds left-right mirrored copies of the clips that are authored for the wrong hand.
   *
   * Only the spell set, and only because the free tier of the Universal Animation Library ships one
   * cast — `Spell_Simple_Shoot` — which raises the LEFT hand while a staff is a main-hand item held
   * in the right. Verified against the pack itself rather than assumed: the Standard zip contains
   * exactly `UAL1_Standard.glb` and its root-motion twin, 43 clips, with no right-handed variant;
   * the remaining "120+" animations the pack advertises are the paid Pro tier.
   *
   * The mirror is exact here, not approximate. Measured by forward kinematics on this rig, the
   * mirrored clip puts the RIGHT hand at 0.086 m below the head with 0.684 m of reach — the
   * original's LEFT-hand figures to four decimal places — because the bind pose is symmetric about
   * x. `tests/skinning.test.ts` pins that.
   */
  private registerMirroredClips(): void {
    for (const name of MIRRORED_CLIPS) {
      const source = this.clips.get(name);
      if (!source) continue;
      const mirrored = `${name}${MIRROR_SUFFIX}`;
      if (!this.clips.has(mirrored)) this.clips.set(mirrored, mirrorAnimationClip(source, mirrored));
    }
  }

  /** A clip from the shared humanoid library. */
  clip(name: string): THREE.AnimationClip | undefined {
    return this.clips.get(name);
  }

  /**
   * A clip belonging to one specific asset. Prefer this whenever the rig is not the shared
   * humanoid skeleton — the monster packs reuse clip names across incompatible skeletons.
   */
  clipOf(assetId: string, name: string): THREE.AnimationClip | undefined {
    return this.assetClips.get(`${assetId}:${name}`);
  }

  /** Every clip an asset shipped, in load order. */
  clipsOf(assetId: string): THREE.AnimationClip[] {
    const prefix = `${assetId}:`;
    const found: THREE.AnimationClip[] = [];
    for (const [key, clip] of this.assetClips) {
      if (key.startsWith(prefix)) found.push(clip);
    }
    return found;
  }

  clipNames(): string[] {
    return [...this.clips.keys()].sort();
  }

  /**
   * A fresh instance of an asset, safe to place in the world and mutate.
   * Static props deep-clone; skinned meshes need SkeletonUtils, which is the character rig's job.
   */
  instance(id: string): THREE.Group {
    const source = this.loaded.get(id);
    if (!source) throw new Error(`Asset not loaded: ${id}`);
    return source.clone(true);
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  isFailed(id: string): boolean {
    return this.failed.has(id);
  }

  getLoadStats(): AssetLoadStats {
    return {
      total: this.manifest?.assets.length ?? 0,
      requested: this.requested.size,
      loaded: this.loadedFiles.size,
      failed: this.failed.size,
      queued: this.queued.size,
      inflight: this.activeLoads,
    };
  }

  stats(): {
    manifestAssets: number;
    loaded: number;
    clips: number;
    assetClips: number;
    total: number;
    requested: number;
    failed: number;
    queued: number;
    inflight: number;
  } {
    const loads = this.getLoadStats();
    return {
      manifestAssets: this.manifest?.assets.length ?? 0,
      // Preserve this debug field's existing meaning, including procedurally registered groups.
      loaded: this.loaded.size,
      clips: this.clips.size,
      assetClips: this.assetClips.size,
      total: loads.total,
      requested: loads.requested,
      failed: loads.failed,
      queued: loads.queued,
      inflight: loads.inflight,
    };
  }
}
