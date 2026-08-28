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
import {
  DETAIL_VALUE_OFFSET,
  createContactDecalTexture,
  createDetailAtlas,
  createWaterNormalMap,
  disposeGeneratedTextures,
} from "./proceduralTextures.js";

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
 * The tier silhouette rule now lives in `core/math.ts` and is re-exported here.
 *
 * It moved because `world/regionBuilder.ts` has to cancel it exactly (a 2 m wall module drawn at
 * 1.84 m would not meet its own grid), and importing it from this file pulled `import * as THREE`
 * into the world layer transitively, which the layering rule forbids. The formula and its
 * derivation are documented at the new site.
 */
export { tierSilhouetteScale } from "../core/math.js";

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

/**
 * The colour of a trodden track in a region: its soil, lifted toward its rock tone.
 *
 * Kept for whoever dresses a route with kerbs or path rocks and needs the track's own tone. The
 * ground itself no longer uses it: the road is stamped into the terrain splat now, and an opaque
 * ground colour needs a gentler lift than a feathered transparent ribbon did. See `surfaceColour`.
 */
export function roadColour(regionId: RegionId): number {
  const palette = REGION_PALETTES[regionId];
  return mixHex(palette.soil, palette.rock, 0.45, 1.35);
}

/**
 * The four surface tones the terrain splat needs beyond the eight authored swatches.
 *
 * All four are DERIVED from the region's own eight, not authored, so the palette contract in the
 * PRD stays a list of eight and a region cannot acquire a hue nobody signed off. They exist
 * because slope alone could only ever express "grass or rock": the measured consequence was that
 * only 12.71% of the world had any surface variation at all, and a worn track, a scree hollow, a
 * cobbled square and a waterlogged bank were all literally undrawable.
 */
export function surfaceColour(
  regionId: RegionId,
  kind: "gravel" | "dirt" | "mud" | "cobble" | "wet",
): number {
  const palette = REGION_PALETTES[regionId];
  switch (kind) {
    // Scree and hollow debris: the region's rock, dragged toward its soil and lifted, so it
    // separates from a cliff face rather than reading as more of the same stone.
    case "gravel": return mixHex(palette.rock, palette.soil, 0.45, 1.08);
    // A trodden track is dust and exposed grit, so it reads BRIGHTER than the vegetation beside
    // it. Same reasoning as roadColour, but a gentler lift: roadColour's 1.35 was tuned for a
    // transparent ribbon feathered over the grass, and applied as an opaque ground colour under a
    // 3.0-intensity sun it bleached Coldbrace square to near white.
    case "dirt": return mixHex(palette.soil, palette.rock, 0.4, 1.12);
    // Churned wet earth at a waterline. Dark, and the only place in the palette that goes there.
    case "mud": return mixHex(palette.soil, palette.water, 0.3, 0.72);
    // Laid stone. Rock pulled hard toward its own grey and lifted, so a paved square separates
    // from the natural rock on the hillside behind it.
    case "cobble": return mixHex(palette.rock, 0x9a978f, 0.55, 1.06);
    // Saturated ground just above the waterline.
    default: return mixHex(palette.soil, palette.water, 0.55, 0.85);
  }
}

/** Linear mix of two packed colours, then a brightness multiplier, clamped per channel. */
function mixHex(a: number, b: number, t: number, gain = 1): number {
  let out = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const channelA = (a >> shift) & 0xff;
    const channelB = (b >> shift) & 0xff;
    const mixed = Math.round((channelA + (channelB - channelA) * t) * gain);
    out |= Math.min(255, Math.max(0, mixed)) << shift;
  }
  return out;
}

export type SurfaceState = "normal" | "depleted" | "dead";

/**
 * Which swatch of a tier palette a surface is pulled toward.
 *
 * The split matters for readability: an ore node's ROCK takes `body` (Grithe's soft grey,
 * Kaldite's blue-black) and its exposed SEAM takes `metal` (Grithe's warm ochre, Kaldite's cyan).
 * Round 1 pulled everything toward `metal`, which turned a tier 1 rock into an orange boulder and
 * still left it indistinguishable from the decorative boulder beside it.
 */
export type PaletteSwatch = "metal" | "body" | "accent";

/** How a `SemanticEntity.view` maps onto a material variant. Purely descriptive; no gameplay. */
export interface VariantSpec {
  tier: number;
  state?: SurfaceState;
  /** 0..1. How far the base colour is pulled toward the tier colour. 0 returns the base material. */
  strength?: number;
  /** Which tier swatch to pull toward. Defaults to `metal`, the round-0 behaviour. */
  swatch?: PaletteSwatch;
  /** Emissive floor for a self-lit seam or rune. The tier's own emissive wins when it is higher. */
  glow?: number;
}

function swatchColour(palette: TierPalette, swatch: PaletteSwatch): number {
  if (swatch === "body") return palette.body;
  if (swatch === "accent") return palette.accent;
  return palette.metal;
}

interface GroundUniforms {
  uDetail: { value: THREE.Texture };
  uDetailTiling: { value: THREE.Vector2 };
}

interface WaterUniforms {
  uTime: { value: number };
  uShallow: { value: THREE.Color };
  uDeep: { value: THREE.Color };
  uNormalB: { value: THREE.Texture };
  uDepthRange: { value: number };
  uEdgeFade: { value: number };
  uWaveScale: { value: THREE.Vector2 };
  uWaveScrollA: { value: THREE.Vector2 };
  uWaveScrollB: { value: THREE.Vector2 };
}

// ------------------------------------------------------------ ground splat
//
// Eight surface weights per vertex, packed as two normalised Uint8 vec4s written by
// `WorldScene.buildChunk` (8 bytes/vertex, about 584 KB over the world's ~73k terrain vertices):
//
//   aSplatA = (grass, dryGrass, rock, gravel)
//   aSplatB = (dirt, mud, cobble, wet)
//
// plus `aGround`, which carries the things a weight cannot express:
//
//   aGround.x  signed distance to the nearest road centreline, remapped -3.5..3.5 m onto 0..1
//   aGround.y  1 where a road is within reach, so wheel ruts exist only on roads
//   aGround.z  spare
//   aGround.w  spare
//
// The ruts are computed in the FRAGMENT shader from the interpolated perpendicular distance, not
// from a vertex weight, because the terrain lattice is 2 m and a rut band is 0.2 m wide: at vertex
// resolution a rut lands between samples and is never drawn at all.

const GROUND_VERTEX_HEADER = /* glsl */ `
attribute vec4 aSplatA;
attribute vec4 aSplatB;
attribute vec4 aGround;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec4 vGroundExtra;
varying vec3 vGroundWorld;
`;

const GROUND_VERTEX_BODY = /* glsl */ `
vSplatA = aSplatA;
vSplatB = aSplatB;
vGroundExtra = aGround;
vGroundWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const GROUND_FRAGMENT_HEADER = /* glsl */ `
uniform sampler2D uDetail;
uniform vec2 uDetailTiling;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec4 vGroundExtra;
varying vec3 vGroundWorld;
`;

const GROUND_FRAGMENT_BODY = /* glsl */ `
{
  vec4 detail = texture2D( uDetail, vGroundWorld.xz * uDetailTiling.x ) + ${DETAIL_VALUE_OFFSET.toFixed(1)};
  vec4 macro = texture2D( uDetail, vGroundWorld.xz * uDetailTiling.y ) + ${DETAIL_VALUE_OFFSET.toFixed(1)};

  // Atlas channels are R grass, G soil, B rock, A gravel. The eight weights fold onto those four.
  vec4 channel = vec4(
    vSplatA.x,
    vSplatA.y + vSplatB.x + vSplatB.y + vSplatB.w,
    vSplatA.z,
    vSplatA.w + vSplatB.z
  );
  float total = max( 0.001, channel.x + channel.y + channel.z + channel.w );
  channel /= total;

  // Multiplied, not mixed. The fine read mips away to its own mean by about 30 m, and if the
  // macro read only modulated it the ground went flat again at exactly the distance the 700 x 400
  // world is mostly seen from. Multiplying leaves the macro at full contrast once the fine read
  // has averaged out.
  float shade = dot( channel, detail ) * mix( 1.0, dot( channel, macro ), 0.85 );

  // Two wheel ruts at +/-0.55 m from the centreline, 0.16 m wide.
  float perpendicular = ( vGroundExtra.x - 0.5 ) * 7.0;
  float rut = vGroundExtra.y * exp( -pow( ( abs( perpendicular ) - 0.55 ) / 0.16, 2.0 ) );
  shade *= 1.0 - 0.18 * rut;

  diffuseColor.rgb *= shade;
}
`;

// ------------------------------------------------------------------- water

const WATER_VERTEX_HEADER = /* glsl */ `
attribute float aWaterDepth;
varying float vWaterDepth;
varying vec3 vWaterWorld;
`;

const WATER_VERTEX_BODY = /* glsl */ `
vWaterDepth = aWaterDepth;
vWaterWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const WATER_FRAGMENT_HEADER = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform sampler2D uNormalB;
uniform float uDepthRange;
uniform float uEdgeFade;
uniform vec2 uWaveScale;
uniform vec2 uWaveScrollA;
uniform vec2 uWaveScrollB;
varying float vWaterDepth;
varying vec3 vWaterWorld;
`;

const WATER_FRAGMENT_BODY = /* glsl */ `
{
  float depth01 = clamp( vWaterDepth / uDepthRange, 0.0, 1.0 );
  diffuseColor.rgb *= mix( uShallow, uDeep, depth01 );
  // The geometry already stops at the waterline, so this only softens the last few centimetres.
  diffuseColor.a *= smoothstep( 0.0, uEdgeFade, vWaterDepth );
}
`;

const WATER_NORMAL_BODY = /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 waveA = texture2D( normalMap, vWaterWorld.xz * uWaveScale.x + uWaveScrollA * uTime ).xyz * 2.0 - 1.0;
  vec3 waveB = texture2D( uNormalB, vWaterWorld.xz * uWaveScale.y + uWaveScrollB * uTime ).xyz * 2.0 - 1.0;
  // Partial-derivative blend: add the slopes, keep the product of the up components.
  vec3 mapN = normalize( vec3( waveA.xy + waveB.xy, waveA.z * waveB.z ) );
  mapN.xy *= normalScale;
  // The surface is an unrotated horizontal plane, so tangent space is world space with y and z
  // swapped. No tangent attribute and no getTangentFrame call, and it stays correct across
  // three.js versions that reshuffle the tangent chunk.
  //
  // viewMatrix, not normalMatrix: three declares normalMatrix in its VERTEX prefix only, so the
  // obvious version of this line fails to compile with "undeclared identifier" and the water
  // silently falls back to an error material.
  normal = normalize( ( viewMatrix * vec4( mapN.x, mapN.z, mapN.y, 0.0 ) ).xyz );
#endif
`;

/**
 * Material cache. Identical descriptors must return the identical material instance, or instancing
 * silently fragments and the draw-call budget is gone.
 */
export class MaterialLibrary {
  private cache = new Map<string, THREE.Material>();
  /** Variants are keyed off the source material so a shared base texture stays shared. */
  private variantKeys = new WeakMap<THREE.Material, string>();
  private nextVariantKey = 0;
  /** Held so the compiled ground program cannot outlive the atlas it samples. */
  private groundUniforms: GroundUniforms | null = null;
  private waterUniforms: WaterUniforms[] = [];

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
   *
   * The vertex colour still carries all of the hue — region palette, surface type, and the baked
   * horizon AO. What `onBeforeCompile` adds is the VALUE detail the vertex colour physically
   * cannot: measured, the colour changed by 0.12 of 255 per channel across a 2 m quad, which is
   * below the 8-bit display floor, so the ground was one flat colour at every scale a player sees.
   *
   * Eight per-vertex surface weights select which channel of the detail atlas is sampled, and the
   * atlas is read TWICE from the same texture at 2.5 m and 37 m tiling. Two scales from one
   * texture is what kills the tile repeat across a 700 x 400 m world at zero extra memory.
   *
   * Everything here happens to `diffuseColor` before `<lights_fragment_begin>`, so shadows, all
   * four lights, ACES tone mapping, fog and the sRGB output conversion stay downstream and keep
   * working untouched. The terrain has `castShadow = false`, so there is no depth-material variant
   * to keep in sync. This replaces the ground program rather than adding one: same material, same
   * draw calls, one more `customProgramCacheKey`.
   */
  ground(): THREE.MeshStandardMaterial {
    return this.remember("ground", () => {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.97,
        metalness: 0,
        flatShading: false,
      });
      material.name = "ground";

      const uniforms = {
        uDetail: { value: createDetailAtlas() },
        // 1/2.5 m for the detail read, 1/37 m for the macro read. 2.5 m is roughly a footstep at
        // the 6-34 m camera distances in shots.ts; 37 m is a prime-ish multiple of it, so the two
        // reads do not come back into phase inside the visible radius.
        uDetailTiling: { value: new THREE.Vector2(1 / 2.5, 1 / 37) },
      };
      // Held so a hot reload cannot orphan the atlas while a compiled program still references it.
      this.groundUniforms = uniforms;

      material.customProgramCacheKey = () => "corealm-ground-splat-v1";
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uDetail = uniforms.uDetail;
        shader.uniforms.uDetailTiling = uniforms.uDetailTiling;

        shader.vertexShader = `${GROUND_VERTEX_HEADER}\n${shader.vertexShader}`.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${GROUND_VERTEX_BODY}`,
        );
        shader.fragmentShader = `${GROUND_FRAGMENT_HEADER}\n${shader.fragmentShader}`.replace(
          "#include <map_fragment>",
          `#include <map_fragment>\n${GROUND_FRAGMENT_BODY}`,
        );
      };
      return material;
    });
  }

  /**
   * The 1 x 1 m contact patch drawn under a prop, rock or tree.
   *
   * `MultiplyBlending`, not alpha: a contact shadow is a darkening of whatever is already there,
   * so it needs no sorting against the ground and no depth write of its own, and the generated
   * texture is pure white outside its falloff, which makes the quad's square edge invisible.
   * One InstancedMesh of these is ONE draw call for the entire world's contact shadows, against
   * the alternative of an SSAO pass or a second shadow cascade.
   */
  contactDecal(): THREE.MeshBasicMaterial {
    return this.remember("contact-decal", () =>
      new THREE.MeshBasicMaterial({
        map: createContactDecalTexture(),
        blending: THREE.MultiplyBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      })) as THREE.MeshBasicMaterial;
  }

  /**
   * Standing water: depth-tinted, alpha driven by depth, and two generated normal maps scrolling
   * across each other.
   *
   * What was here before was a flat tinted plane whose rim faded to alpha 0 over the outer 40% of
   * the disc, which dissolved the shoreline instead of drawing one — measured, 55-56% of the tarn
   * footprints had dry hillside above the surface, so the "shoreline" was a wash lying on a slope.
   * The geometry now stops exactly where the terrain crosses the surface (see `WorldScene.
   * buildWater`), and this material fades the last 25 cm of depth so the waterline is a real edge
   * rather than a drawn line or a smear.
   *
   * TWO scrolled normal maps, not one. One always reads as a texture sliding across a plane; two
   * at different tilings and 33 degrees apart read as a surface. The plane is horizontal and
   * unrotated, so its tangent frame is world-axis-aligned and the perturbed normal needs no
   * tangent attribute and no `getTangentFrame` call.
   *
   * Roughness 0.14 with no `scene.environment` degrades to a diffuse-lit surface with a specular
   * sun glint, which is legible on its own; when the sky worker lands an environment map the same
   * material gains the sky reflection with no change here.
   */
  water(regionId: RegionId = "fallowmarch"): THREE.MeshStandardMaterial {
    return this.remember(this.key(["water", regionId]), () => {
      const palette = REGION_PALETTES[regionId];
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.14,
        metalness: 0,
        transparent: true,
        opacity: 0.94,
        side: THREE.DoubleSide,
        depthWrite: false,
        normalMap: createWaterNormalMap("fine"),
        normalScale: new THREE.Vector2(0.55, 0.55),
      });
      material.name = `water-${regionId}`;

      const uniforms = {
        uTime: { value: 0 },
        // Shallow lifts 45% toward the region's own low ground so the edge of the water agrees
        // with the bank it meets; deep darkens 30%, which is the whole depth cue.
        uShallow: { value: new THREE.Color(mixHex(palette.water, palette.groundLow, 0.45)) },
        uDeep: { value: new THREE.Color(mixHex(palette.water, 0x000000, 0.3)) },
        uNormalB: { value: createWaterNormalMap("coarse") },
        // Metres of depth over which the tint runs, and metres over which the edge fades out.
        uDepthRange: { value: 1.2 },
        uEdgeFade: { value: 0.25 },
        // 8.0 m and 3.7 m tiling. Scroll 0.012 and -0.019 m/s, 33 degrees apart, so neither the
        // pattern nor the drift direction ever resolves as one moving texture.
        uWaveScale: { value: new THREE.Vector2(1 / 8, 1 / 3.7) },
        uWaveScrollA: { value: new THREE.Vector2(0.012, 0.004) },
        uWaveScrollB: { value: new THREE.Vector2(-0.0159, 0.0104) },
      };
      this.waterUniforms.push(uniforms);

      material.customProgramCacheKey = () => "corealm-water-v1";
      material.onBeforeCompile = (shader) => {
        for (const [name, uniform] of Object.entries(uniforms)) shader.uniforms[name] = uniform;

        shader.vertexShader = `${WATER_VERTEX_HEADER}\n${shader.vertexShader}`.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${WATER_VERTEX_BODY}`,
        );
        shader.fragmentShader = `${WATER_FRAGMENT_HEADER}\n${shader.fragmentShader}`
          .replace("#include <map_fragment>", `#include <map_fragment>\n${WATER_FRAGMENT_BODY}`)
          .replace("#include <normal_fragment_maps>", WATER_NORMAL_BODY);
      };
      return material;
    });
  }

  /** Advances every animated material. View-only: nothing here feeds semantic state. */
  setTime(seconds: number): void {
    for (const uniforms of this.waterUniforms) uniforms.uTime.value = seconds;
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

  /**
   * The exposed ore seam sitting on a node's rock body.
   *
   * This is the half of the readability contract that colour on the rock alone could not carry.
   * The body takes the tier's `body` swatch through `variant()`; this material is the vein on top
   * of it, so a node reads as "grey rock + warm ochre vein" (Grithe) or "blue-black rock + cyan
   * fracture line" (Kaldite) exactly as the PRD authors them, instead of two grey rocks.
   *
   * Two deliberate departures from the raw palette:
   *  - `raiseContrast` pushes saturation and value up. `palette.metal` is authored to sit NEXT to
   *    the body colour on a chart, not on top of it; unmodified it loses the value contrast that
   *    makes the vein visible at 12 m.
   *  - a small emissive floor even at tiers with no authored glow, because an unlit ochre line
   *    disappears the moment the rock falls into shadow, which in Gravelmaw is always.
   *
   * Cached per (tier, depleted), so every ore node in a region shares one material instance.
   */
  oreRock(tier: number, depleted: boolean): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["ore", palette.tier, depleted]), () => {
      const colour = new THREE.Color(depleted ? palette.body : palette.metal);
      if (depleted) applyDepletion(colour);
      else raiseContrast(colour);
      const glow = depleted ? 0 : Math.max(SEAM_GLOW, palette.emissive);
      return new THREE.MeshStandardMaterial({
        color: colour,
        roughness: depleted ? 0.98 : 0.62,
        metalness: depleted ? 0 : 0.25,
        emissive: glow > 0 ? colour.clone() : new THREE.Color(0x000000),
        emissiveIntensity: glow,
        // Faceted, so the shards read as crystal against the smooth-shaded rock they sit in.
        flatShading: true,
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
    const strength = Math.min(1, Math.max(0, spec.strength ?? 0.55));
    const swatch: PaletteSwatch = spec.swatch ?? "metal";
    const glow = Math.max(0, spec.glow ?? 0);

    // A zero-strength, unlit, live surface IS the source material. Handing back the original
    // instance rather than an identical clone is not a micro-optimisation: a clone is a second
    // material, and a second material on the same geometry is a second draw call downstream.
    // Buildings, props and NPC art all take this path — they have no tier ladder to express.
    if (strength === 0 && glow === 0 && state === "normal") return base;

    const key = this.key(["variant", this.baseKey(base), palette.tier, state, strength, swatch, glow]);

    return this.remember(key, () => {
      if (!source.isMeshStandardMaterial) {
        // Non-standard materials (rare, and only from third-party GLBs) pass through unchanged
        // rather than being silently replaced with something that does not match the art.
        return source;
      }
      const target = new THREE.Color(swatchColour(palette, swatch));
      const clone = source.clone();
      // clone() keeps the same texture object references. Do NOT reassign clone.map.
      clone.color = new THREE.Color(source.color.getHex()).lerp(target, strength);
      clone.roughness = Math.min(1, source.roughness * 0.9 + 0.12);
      clone.metalness = state === "normal" ? Math.max(source.metalness, 0.12) : 0;
      if (state !== "normal") {
        applyDepletion(clone.color);
        clone.roughness = 1;
        clone.metalness = 0;
        clone.emissive = new THREE.Color(0x000000);
        clone.emissiveIntensity = 0;
      } else {
        const intensity = Math.max(glow, palette.emissive);
        if (intensity > 0) {
          clone.emissive = target.clone();
          clone.emissiveIntensity = intensity;
        }
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
   *
   * `accept` exists because a blanket retint is wrong on character art: pulling an eye, a tooth or
   * a pure-black trim toward the tier colour destroys the read of the face while doing nothing for
   * tier legibility. Callers pass a predicate; materials it rejects are left exactly as authored
   * (and, via `variant`'s zero-strength path, are not even cloned).
   */
  retint(
    object: THREE.Object3D,
    tier: number,
    strength = 0.7,
    swatch: PaletteSwatch = "metal",
    accept: (material: THREE.Material) => boolean = () => true,
  ): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mapped = materials.map((source) =>
        this.variant(source, { tier, swatch, strength: accept(source) ? strength : 0 }));
      mesh.material = mapped.length === 1 ? mapped[0]! : mapped;
    });
  }

  size(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
    this.groundUniforms = null;
    this.waterUniforms = [];
    disposeGeneratedTextures();
  }
}

/**
 * Depleted nodes go nearly grey and lose almost half their value, so "spent" reads at a glance
 * from the default pitch.
 *
 * Round 1 used s*0.55 / l*0.78. On a rock texture that is already desaturated and mid-value, that
 * is a change of a few percent per channel — a state transition nobody could see, which is why the
 * PRD's "visible state change" was not met. This is deliberately blunt.
 */
function applyDepletion(colour: THREE.Color): void {
  const hsl = { h: 0, s: 0, l: 0 };
  colour.getHSL(hsl);
  colour.setHSL(hsl.h, hsl.s * 0.15, Math.max(0.06, hsl.l * 0.55));
}

/** Emissive floor on an ore seam, so a vein still reads in shadow and underground. */
const SEAM_GLOW = 0.3;

/**
 * Pushes a swatch up in saturation and value. Used on the ore seam: the tier palette's `metal` is
 * authored to sit beside its `body`, not on top of it, and side by side at 12 m the two collapse
 * into one grey blob without this.
 */
function raiseContrast(colour: THREE.Color): void {
  const hsl = { h: 0, s: 0, l: 0 };
  colour.getHSL(hsl);
  colour.setHSL(hsl.h, Math.min(1, hsl.s * 1.5 + 0.16), Math.min(0.82, hsl.l * 1.2 + 0.12));
}
