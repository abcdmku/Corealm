/**
 * Corealm's material system.
 *
 * The style target sits between Synty low-poly and classic RuneScape readability: clean shapes,
 * simple surfaces, restrained PBR, strong silhouettes. That means high roughness, near-zero
 * metalness, and saturated-but-not-neon colour.
 *
 * Tier variants are deliberately colour/roughness swaps over a SHARED base texture rather than
 * distinct textures. That is what keeps `InstancedMesh` batching intact — distinct textures would
 * fragment instancing across tiers x families x regions and blow the 400-draw-call budget
 * (runs/corealm/architecture.md, correction R6).
 *
 * The one rule every method in here obeys: identical inputs return the IDENTICAL material instance.
 * A cache miss that clones a material silently doubles a draw call somewhere downstream.
 */
import * as THREE from "three";
import type { RegionId } from "../contracts.js";

export interface TierPalette {
  tier: number;
  name: string;
  /** Ore/metal accent. */
  metal: number;
  /** Rock or bark body colour. */
  body: number;
  /** Foliage or cloth accent. */
  accent: number;
  /** Emissive strength for high tiers. Zero through tier 10. */
  emissive: number;
}

/**
 * Tier palettes for the full 1-99 range. Phase 1 authors content for 1, 5, and 10 only, but the
 * table is complete so later phases add content without touching this file.
 */
export const TIER_PALETTES: Record<number, TierPalette> = {
  1: { tier: 1, name: "Grithe", metal: 0xb07a4a, body: 0x8d8579, accent: 0x7d8b5c, emissive: 0 },
  5: { tier: 5, name: "Corven", metal: 0x9aa4ad, body: 0x6f7a80, accent: 0x5f7f56, emissive: 0 },
  10: { tier: 10, name: "Kaldite", metal: 0x5f7f9e, body: 0x585f6b, accent: 0x4d6b78, emissive: 0 },
  20: { tier: 20, name: "Emberdrift", metal: 0xc2673a, body: 0x6b4a3d, accent: 0xa8533a, emissive: 0.05 },
  30: { tier: 30, name: "Mirevein", metal: 0x6d8f5a, body: 0x4e5b47, accent: 0x86a05e, emissive: 0.05 },
  40: { tier: 40, name: "Rimeshard", metal: 0xa9cfe0, body: 0x7f93a1, accent: 0xd2e8f2, emissive: 0.1 },
  50: { tier: 50, name: "Sunderglass", metal: 0xd9b168, body: 0xa08a5e, accent: 0xe6cd94, emissive: 0.1 },
  60: { tier: 60, name: "Galestone", metal: 0x7f9fc4, body: 0x5b6a7d, accent: 0xa8c4de, emissive: 0.15 },
  70: { tier: 70, name: "Blightiron", metal: 0x6b5f7a, body: 0x453f52, accent: 0x8a6f9e, emissive: 0.2 },
  80: { tier: 80, name: "Ashvarr", metal: 0xd0552f, body: 0x3a2b28, accent: 0xff8a45, emissive: 0.45 },
  90: { tier: 90, name: "Aetherfall", metal: 0x9d7fe0, body: 0x453a6b, accent: 0xc4a8ff, emissive: 0.6 },
  99: { tier: 99, name: "Corestone", metal: 0xf0e6c0, body: 0x2e2a3d, accent: 0xffd98a, emissive: 0.9 },
};

const AUTHORED_TIERS: readonly number[] = Object.keys(TIER_PALETTES)
  .map(Number)
  .sort((a, b) => a - b);

/** Nearest authored palette at or below the tier. */
export function paletteForTier(tier: number): TierPalette {
  let chosen = AUTHORED_TIERS[0]!;
  for (const candidate of AUTHORED_TIERS) if (tier >= candidate) chosen = candidate;
  return TIER_PALETTES[chosen]!;
}

/**
 * Silhouette rule from the PRD: tier changes scale by at most 20%, and always change proportion
 * as well. Colour does the heavy lifting; scale only nudges. Both together make tier readable at
 * 12 m at the default camera pitch.
 */
export function tierSilhouetteScale(tier: number): number {
  const palette = paletteForTier(tier);
  const index = AUTHORED_TIERS.indexOf(palette.tier);
  const span = Math.max(1, AUTHORED_TIERS.length - 1);
  return 0.92 + (index / span) * 0.28;
}

/**
 * A locked eight-swatch palette per region (PRD section 4, "Visual system"). Region ground
 * treatment blends `groundLow` -> `groundHigh` by altitude and slope, so one shared vertex-coloured
 * terrain material covers the whole world without a texture per region.
 */
export interface RegionPalette {
  id: RegionId;
  name: string;
  /** Low ground: valley floor, damp soil. */
  groundLow: number;
  /** High ground: exposed crest, dry grass. */
  groundHigh: number;
  /** Bare earth and worn track. */
  soil: number;
  /** Exposed stone on steep faces. */
  rock: number;
  /** Canopy / shrub. */
  foliage: number;
  /** Trunk and structural timber. */
  timber: number;
  /** Standing water. */
  water: number;
  /** The single warm accent that identifies the region at distance. */
  accent: number;
}

export const REGION_PALETTES: Record<RegionId, RegionPalette> = {
  // Bleached grass greens, weathered grey-brown timber, one copper-orange accent on Coldbrace roofs.
  fallowmarch: {
    id: "fallowmarch", name: "Fallowmarch",
    groundLow: 0x76854f, groundHigh: 0xa3a978, soil: 0x8a7a5c, rock: 0x8d8579,
    foliage: 0x7d8b5c, timber: 0x7a6a55, water: 0x4d6f74, accent: 0xc07a3e,
  },
  // Deep desaturated greens, strong value contrast, bark browns pushed purple.
  vellenwood: {
    id: "vellenwood", name: "Vellenwood",
    groundLow: 0x33452c, groundHigh: 0x576b3f, soil: 0x413630, rock: 0x5b5750,
    foliage: 0x3f5f38, timber: 0x4a3d4a, water: 0x2c3c36, accent: 0x9bb05a,
  },
  // Cold blue-grey slate, lichen green-yellow, one warm firelight per camp.
  karrowmoor: {
    id: "karrowmoor", name: "Karrowmoor",
    groundLow: 0x5c6169, groundHigh: 0x7c7a6d, soil: 0x655f54, rock: 0x545a64,
    foliage: 0x53664c, timber: 0x5d554b, water: 0x46606b, accent: 0xd08a44,
  },
  // Underground. Dark, near-monochrome, lit by torch only.
  gravelmaw: {
    id: "gravelmaw", name: "Gravelmaw",
    groundLow: 0x2a2723, groundHigh: 0x3b3730, soil: 0x2f2a25, rock: 0x3f434a,
    foliage: 0x3a4436, timber: 0x36302a, water: 0x22302f, accent: 0xc65a2a,
  },
};

/** Back-compatible flat lookup. Round 0 callers used this; keep it working. */
export const GROUND_COLOURS = {
  fallowmarch: REGION_PALETTES.fallowmarch.groundHigh,
  vellenwood: REGION_PALETTES.vellenwood.groundHigh,
  karrowmoor: REGION_PALETTES.karrowmoor.groundHigh,
  gravelmaw: REGION_PALETTES.gravelmaw.groundHigh,
} as const;

/** The eight swatches, as hex strings, for `RegionDef.palette`. */
export function regionSwatches(regionId: RegionId): string[] {
  const palette = REGION_PALETTES[regionId];
  return [
    palette.groundLow, palette.groundHigh, palette.soil, palette.rock,
    palette.foliage, palette.timber, palette.water, palette.accent,
  ].map((value) => `#${value.toString(16).padStart(6, "0")}`);
}

export type SurfaceState = "normal" | "depleted" | "dead";

/** How a `SemanticEntity.view` maps onto a material variant. Purely descriptive; no gameplay. */
export interface VariantSpec {
  tier: number;
  state?: SurfaceState;
  /** 0..1. How far the base colour is pulled toward the tier colour. */
  strength?: number;
}

/**
 * Material cache. Identical descriptors must return the identical material instance, or instancing
 * silently fragments and the draw-call budget is gone.
 */
export class MaterialLibrary {
  private cache = new Map<string, THREE.Material>();
  /** Variants are keyed off the source material so a shared base texture stays shared. */
  private variantKeys = new WeakMap<THREE.Material, string>();
  private nextVariantKey = 0;

  private key(parts: (string | number | boolean)[]): string {
    return parts.join("|");
  }

  private remember<T extends THREE.Material>(key: string, create: () => T): T {
    const cached = this.cache.get(key);
    if (cached) return cached as T;
    const material = create();
    this.cache.set(key, material);
    return material;
  }

  /** Flat stylized surface. The workhorse for terrain, rock, and architecture. */
  surface(colour: number, roughness = 0.92, metalness = 0): THREE.MeshStandardMaterial {
    return this.remember(this.key(["surface", colour, roughness, metalness]), () =>
      new THREE.MeshStandardMaterial({ color: colour, roughness, metalness, flatShading: false }));
  }

  /**
   * The one terrain material. Every terrain chunk in every region shares it; the region look comes
   * from baked vertex colours, so three regions cost one material and one shader program.
   */
  ground(): THREE.MeshStandardMaterial {
    return this.remember("ground", () =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.97,
        metalness: 0,
        flatShading: false,
      }));
  }

  /**
   * Roads and worn paths. Drawn as a thin ribbon laid over the terrain, so it needs a polygon
   * offset rather than a vertical lift — a lift would float over dips and sink into crests.
   */
  road(regionId: RegionId = "fallowmarch"): THREE.MeshStandardMaterial {
    return this.remember(this.key(["road", regionId]), () =>
      new THREE.MeshStandardMaterial({
        color: REGION_PALETTES[regionId].soil,
        roughness: 0.99,
        metalness: 0,
        vertexColors: true,
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
        depthWrite: false,
      }));
  }

  /**
   * Standing water. No water asset exists in the free library (asset-report gap 10), so this is a
   * plain tinted plane; the scrolling normal pass is a later art round, not a Phase 1 blocker.
   */
  water(regionId: RegionId = "fallowmarch"): THREE.MeshStandardMaterial {
    return this.remember(this.key(["water", regionId]), () =>
      new THREE.MeshStandardMaterial({
        color: REGION_PALETTES[regionId].water,
        roughness: 0.22,
        metalness: 0.05,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      }));
  }

  /** Exposed stone face for cliffs and terrace risers. */
  cliff(regionId: RegionId): THREE.MeshStandardMaterial {
    return this.surface(REGION_PALETTES[regionId].rock, 0.96, 0);
  }

  /** Metal for tools, weapons, and ore veins. Restrained: low metalness keeps it readable. */
  metal(tier: number): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["metal", palette.tier]), () =>
      new THREE.MeshStandardMaterial({
        color: palette.metal,
        roughness: 0.55,
        metalness: 0.35,
        emissive: palette.emissive > 0 ? palette.metal : 0x000000,
        emissiveIntensity: palette.emissive,
      }));
  }

  /** Rock body for ore nodes, tinted by tier so the tier reads from 12 m at the default pitch. */
  oreRock(tier: number, depleted: boolean): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["ore", palette.tier, depleted]), () => {
      const colour = new THREE.Color(depleted ? palette.body : palette.metal);
      if (depleted) applyDepletion(colour);
      return new THREE.MeshStandardMaterial({
        color: colour,
        roughness: depleted ? 0.98 : 0.78,
        metalness: depleted ? 0 : 0.18,
        emissive: !depleted && palette.emissive > 0 ? palette.metal : 0x000000,
        emissiveIntensity: depleted ? 0 : palette.emissive,
      });
    });
  }

  foliage(tier: number): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["foliage", palette.tier]), () =>
      new THREE.MeshStandardMaterial({
        color: palette.accent,
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
      }));
  }

  /**
   * THE tier-variant entry point, and the reason instancing survives 36 tier x family combinations.
   *
   * Given a material that came off a loaded GLB, this returns a cached variant that keeps the
   * ORIGINAL maps (base colour texture, alpha settings, side) and only swaps colour, roughness and
   * emissive. One texture, many tiers, one InstancedMesh per (asset, variant) pair.
   */
  variant(base: THREE.Material, spec: VariantSpec): THREE.Material {
    const source = base as THREE.MeshStandardMaterial;
    const palette = paletteForTier(spec.tier);
    const state: SurfaceState = spec.state ?? "normal";
    const strength = spec.strength ?? 0.55;
    const key = this.key(["variant", this.baseKey(base), palette.tier, state, strength]);

    return this.remember(key, () => {
      if (!source.isMeshStandardMaterial) {
        // Non-standard materials (rare, and only from third-party GLBs) pass through unchanged
        // rather than being silently replaced with something that does not match the art.
        return source;
      }
      const clone = source.clone();
      // clone() keeps the same texture object references. Do NOT reassign clone.map.
      clone.color = new THREE.Color(source.color.getHex()).lerp(new THREE.Color(palette.metal), strength);
      clone.roughness = Math.min(1, source.roughness * 0.9 + 0.12);
      clone.metalness = state === "normal" ? Math.max(source.metalness, 0.12) : 0;
      if (state !== "normal") {
        applyDepletion(clone.color);
        clone.roughness = 1;
        clone.emissive = new THREE.Color(0x000000);
        clone.emissiveIntensity = 0;
      } else if (palette.emissive > 0) {
        clone.emissive = new THREE.Color(palette.metal);
        clone.emissiveIntensity = palette.emissive;
      }
      return clone;
    });
  }

  /**
   * Desaturated, darkened treatment for a depleted node or a dead body when no `depletedAssetId`
   * is authored. Same geometry, same texture, different bucket — a state change costs one matrix
   * write, never a mesh rebuild.
   */
  depleted(base: THREE.Material): THREE.Material {
    const source = base as THREE.MeshStandardMaterial;
    const key = this.key(["depleted", this.baseKey(base)]);
    return this.remember(key, () => {
      if (!source.isMeshStandardMaterial) return source;
      const clone = source.clone();
      clone.color = new THREE.Color(source.color.getHex());
      applyDepletion(clone.color);
      clone.roughness = 1;
      clone.metalness = 0;
      clone.emissive = new THREE.Color(0x000000);
      clone.emissiveIntensity = 0;
      return clone;
    });
  }

  /** Hover / selection ring. Unlit so it stays legible against dark terrain and in shadow. */
  highlight(colour: string | number): THREE.MeshBasicMaterial {
    const value = typeof colour === "string" ? new THREE.Color(colour).getHex() : colour;
    return this.remember(this.key(["highlight", value]), () =>
      new THREE.MeshBasicMaterial({
        color: value,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })) as THREE.MeshBasicMaterial;
  }

  /** Stable identity for a source material, so variants of the same base share a cache namespace. */
  private baseKey(base: THREE.Material): string {
    const existing = this.variantKeys.get(base);
    if (existing) return existing;
    const created = `${base.name || base.type}#${(this.nextVariantKey += 1)}`;
    this.variantKeys.set(base, created);
    return created;
  }

  /**
   * Retints an asset's existing materials for a tier while keeping its base texture.
   * This is how one source mesh becomes a whole tier ladder without new art.
   */
  retint(object: THREE.Object3D, tier: number, strength = 0.65): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mapped = materials.map((source) => this.variant(source, { tier, strength }));
      mesh.material = mapped.length === 1 ? mapped[0]! : mapped;
    });
  }

  size(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
  }
}

/** Depleted nodes desaturate 45% and darken, so state reads at a glance from the default pitch. */
function applyDepletion(colour: THREE.Color): void {
  const hsl = { h: 0, s: 0, l: 0 };
  colour.getHSL(hsl);
  colour.setHSL(hsl.h, hsl.s * 0.55, hsl.l * 0.78);
}
