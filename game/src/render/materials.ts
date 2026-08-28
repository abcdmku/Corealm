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
 */
import * as THREE from "three";

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

/** Nearest authored palette at or below the tier. */
export function paletteForTier(tier: number): TierPalette {
  const tiers = Object.keys(TIER_PALETTES).map(Number).sort((a, b) => a - b);
  let chosen = tiers[0]!;
  for (const candidate of tiers) if (tier >= candidate) chosen = candidate;
  return TIER_PALETTES[chosen]!;
}

export const GROUND_COLOURS = {
  fallowmarch: 0x7d8b57,
  vellenwood: 0x51683f,
  karrowmoor: 0x6e6a5c,
  gravelmaw: 0x3b3730,
} as const;

/**
 * Material cache. Identical descriptors must return the identical material instance, or instancing
 * silently fragments and the draw-call budget is gone.
 */
export class MaterialLibrary {
  private cache = new Map<string, THREE.Material>();

  private key(parts: (string | number | boolean)[]): string {
    return parts.join("|");
  }

  /** Flat stylized surface. The workhorse for terrain, rock, and architecture. */
  surface(colour: number, roughness = 0.92, metalness = 0): THREE.MeshStandardMaterial {
    const key = this.key(["surface", colour, roughness, metalness]);
    const cached = this.cache.get(key);
    if (cached) return cached as THREE.MeshStandardMaterial;
    const material = new THREE.MeshStandardMaterial({ color: colour, roughness, metalness, flatShading: false });
    this.cache.set(key, material);
    return material;
  }

  /** Metal for tools, weapons, and ore veins. Restrained: low metalness keeps it readable. */
  metal(tier: number): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    const key = this.key(["metal", palette.tier]);
    const cached = this.cache.get(key);
    if (cached) return cached as THREE.MeshStandardMaterial;
    const material = new THREE.MeshStandardMaterial({
      color: palette.metal,
      roughness: 0.55,
      metalness: 0.35,
      emissive: palette.emissive > 0 ? palette.metal : 0x000000,
      emissiveIntensity: palette.emissive,
    });
    this.cache.set(key, material);
    return material;
  }

  /** Rock body for ore nodes, tinted by tier so the tier reads from 12 m at the default pitch. */
  oreRock(tier: number, depleted: boolean): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    const key = this.key(["ore", palette.tier, depleted]);
    const cached = this.cache.get(key);
    if (cached) return cached as THREE.MeshStandardMaterial;

    const colour = new THREE.Color(depleted ? palette.body : palette.metal);
    if (depleted) {
      // Depleted nodes desaturate 45% and darken, so state reads at a glance.
      const hsl = { h: 0, s: 0, l: 0 };
      colour.getHSL(hsl);
      colour.setHSL(hsl.h, hsl.s * 0.55, hsl.l * 0.78);
    }

    const material = new THREE.MeshStandardMaterial({
      color: colour,
      roughness: depleted ? 0.98 : 0.78,
      metalness: depleted ? 0 : 0.18,
      emissive: !depleted && palette.emissive > 0 ? palette.metal : 0x000000,
      emissiveIntensity: depleted ? 0 : palette.emissive,
    });
    this.cache.set(key, material);
    return material;
  }

  foliage(tier: number): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    const key = this.key(["foliage", palette.tier]);
    const cached = this.cache.get(key);
    if (cached) return cached as THREE.MeshStandardMaterial;
    const material = new THREE.MeshStandardMaterial({
      color: palette.accent,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.cache.set(key, material);
    return material;
  }

  /**
   * Retints an asset's existing materials for a tier while keeping its base texture.
   * This is how one source mesh becomes a whole tier ladder without new art.
   */
  retint(object: THREE.Object3D, tier: number, strength = 0.65): void {
    const palette = paletteForTier(tier);
    const tint = new THREE.Color(palette.metal);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = materials.map((source) => {
        const clone = (source as THREE.MeshStandardMaterial).clone();
        if (clone.color) clone.color.lerp(tint, strength);
        if (palette.emissive > 0) {
          clone.emissive = new THREE.Color(palette.metal);
          clone.emissiveIntensity = palette.emissive;
        }
        return clone;
      });
      if (Array.isArray(mesh.material) && mesh.material.length === 1) mesh.material = mesh.material[0]!;
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
