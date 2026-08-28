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

export type AssetCategory =
  | "nature" | "rock" | "building" | "prop" | "farm"
  | "dungeon" | "character" | "outfit" | "weapon" | "animation" | "water";

export interface AssetEntry {
  id: string;
  file: string;
  pack: string;
  category: AssetCategory;
  tags: string[];
  bytes: number;
  size: { x: number; y: number; z: number };
  animations: string[];
  materials: string[];
}

export interface AssetPack {
  id: string;
  name: string;
  author: string;
  source: string;
  license: string;
}

export interface AssetManifest {
  generatedAt: string;
  packs: AssetPack[];
  assets: AssetEntry[];
}

export class AssetRegistry {
  private manifest: AssetManifest | null = null;
  private byId = new Map<string, AssetEntry>();
  private loader = new GLTFLoader();
  private loaded = new Map<string, THREE.Group>();
  private inflight = new Map<string, Promise<THREE.Group>>();
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
    for (const entry of manifest.assets) this.byId.set(entry.id, entry);
    return manifest;
  }

  getManifest(): AssetManifest | null {
    return this.manifest;
  }

  entry(id: string): AssetEntry | undefined {
    return this.byId.get(id);
  }

  /** All assets in a category, in manifest order. */
  byCategory(category: AssetCategory): AssetEntry[] {
    return (this.manifest?.assets ?? []).filter((asset) => asset.category === category);
  }

  /** Assets carrying every one of the given tags. The main lookup for world composition. */
  byTags(...tags: string[]): AssetEntry[] {
    const wanted = tags.map((tag) => tag.toLowerCase());
    return (this.manifest?.assets ?? []).filter((asset) => {
      const owned = asset.tags.map((tag) => tag.toLowerCase());
      return wanted.every((tag) => owned.includes(tag));
    });
  }

  /** Loads a GLB and caches its scene graph. Callers clone; they never mutate the cached original. */
  async load(id: string): Promise<THREE.Group> {
    const cached = this.loaded.get(id);
    if (cached) return cached;
    const existing = this.inflight.get(id);
    if (existing) return existing;

    const entry = this.byId.get(id);
    if (!entry) throw new Error(`Unknown asset id: ${id}`);

    const promise = this.loader
      .loadAsync(`${ASSET_BASE_URL}${entry.file.replace(/^\/+/, "")}`)
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
        this.inflight.delete(id);
        return group;
      })
      .catch((error: unknown) => {
        this.inflight.delete(id);
        throw error instanceof Error ? error : new Error(String(error));
      });

    this.inflight.set(id, promise);
    return promise;
  }

  async loadMany(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.load(id)));
  }

  /**
   * Loads the animation libraries into the shared clip library. Call once during boot.
   * Every character rig plays from here; the 65-bone skeleton is identical across packs.
   */
  async loadAnimationLibraries(): Promise<number> {
    const libraries = this.byCategory("animation");
    await Promise.all(libraries.map((entry) => this.load(entry.id)));
    return this.clips.size;
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

  stats(): { manifestAssets: number; loaded: number; clips: number; assetClips: number } {
    return {
      manifestAssets: this.manifest?.assets.length ?? 0,
      loaded: this.loaded.size,
      clips: this.clips.size,
      assetClips: this.assetClips.size,
    };
  }
}
