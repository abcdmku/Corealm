/**
 * Generated surface textures. No art dependency, no download, deterministic byte for byte.
 *
 * Why this file exists: measured before it, `CanvasTexture`, `DataTexture`, `RepeatWrapping`,
 * `onBeforeCompile`, `ShaderMaterial` and `envMap` returned ZERO hits across all of game/src. The
 * terrain was one `MeshStandardMaterial({vertexColors:true})` whose vertex colour changed by 0.12
 * of 255 per channel across a 2 m quad, which is below the 8-bit display floor, so the ground was
 * a solid colour field at every scale a player sees. Everything here is the high-frequency signal
 * that was missing. Hue stays in `REGION_PALETTES`, so the eight-swatch contract in materials.ts
 * is untouched: these textures are value-only and every one of them is `NoColorSpace`.
 *
 * Three decisions worth stating, because each is where an obvious alternative fails:
 *
 *  - `DataTexture`, not `CanvasTexture`. The audit scripts under runs/corealm/audit and the unit
 *    tests build a `WorldScene` in node, where there is no `document`, and a CanvasTexture throws
 *    there. A DataTexture is a typed array until something uploads it, so one code path runs
 *    headless and in the browser and produces identical bytes.
 *  - Lacunarity 2.0, not the 2.03 the diagnosis proposed. The atlas is sampled with
 *    `RepeatWrapping`; a non-integer lacunarity makes the octaves non-periodic and the tile stops
 *    being seamless, which reads as a hard grid line every 2.5 m across the whole world. The
 *    repeat is broken up by sampling the SAME texture at two scales in the shader instead, which
 *    costs no extra memory.
 *  - 512 px, not 1024. Measured generation cost, node 24 on this machine: 512 takes 125 ms and
 *    1024 takes 461 ms, and that cost lands on the boot path and on every headless audit run. At
 *    the 2.5 m detail tiling 512 px is 205 texels/m, finer than a 1080p frame resolves at the
 *    6-34 m camera distances in shots.ts. Memory with mips: 1.4 MB, against the 5.6 MB a 1024
 *    atlas would cost.
 */
import * as THREE from "three";
import { Rng } from "../core/rng.js";
import { clamp } from "../core/math.js";

/** Edge length of the detail atlas, in texels. See the header for why this is not 1024. */
export const DETAIL_ATLAS_SIZE = 512;

/**
 * Detail channel values live in 0.5..1.5 and are stored as `byte / 255 + 0.5`.
 *
 * A multiplier centred on 1.0 has to brighten as well as darken, so the raw 0..1 byte range is the
 * wrong interval to store it in. This encoding costs one add in the fragment shader and keeps full
 * 8-bit precision across the range the channels actually use, which is 0.48..1.26.
 */
export const DETAIL_VALUE_OFFSET = 0.5;

/** Master seed for every generated texture. Fixed, so the atlas is identical across reloads. */
const TEXTURE_SEED = 0x7ea11e5;

// ------------------------------------------------------------------ noise

/**
 * Periodic value noise on an integer lattice.
 *
 * Periodic because the atlas is sampled with `RepeatWrapping`: non-tiling noise leaves a seam at
 * every tile edge, which at 2.5 m tiling is a grid drawn over the entire world. The lattice index
 * is wrapped by the octave's own period before hashing, so every octave tiles at the atlas edge.
 */
function makePeriodicNoise(rng: Rng): (x: number, z: number, periodX: number, periodZ: number) => number {
  const permutation = new Uint8Array(256);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) source[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const swap = source[i]!;
    source[i] = source[j]!;
    source[j] = swap;
  }
  permutation.set(source);

  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const wrap = (value: number, period: number): number => ((value % period) + period) % period;
  const at = (xi: number, zi: number): number =>
    permutation[(permutation[xi & 255]! + zi) & 255]! / 255;

  return (x, z, periodX, periodZ) => {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const u = fade(x - x0);
    const v = fade(z - z0);
    const xa = wrap(x0, periodX);
    const xb = wrap(x0 + 1, periodX);
    const za = wrap(z0, periodZ);
    const zb = wrap(z0 + 1, periodZ);
    const c00 = at(xa, za);
    const c10 = at(xb, za);
    const c01 = at(xa, zb);
    const c11 = at(xb, zb);
    const top = c00 + (c10 - c00) * u;
    const bottom = c01 + (c11 - c01) * u;
    return top + (bottom - top) * v;
  };
}

type PeriodicNoise = ReturnType<typeof makePeriodicNoise>;

/** Fractal sum of periodic octaves. Returns roughly 0..1, centred near 0.5. */
function fbm(
  noise: PeriodicNoise,
  u: number,
  v: number,
  octaves: number,
  cellsX: number,
  cellsZ: number,
  gain = 0.5,
): number {
  let total = 0;
  let amplitude = 1;
  let normaliser = 0;
  let cx = cellsX;
  let cz = cellsZ;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise(u * cx, v * cz, cx, cz) * amplitude;
    normaliser += amplitude;
    amplitude *= gain;
    cx *= 2;
    cz *= 2;
  }
  return total / normaliser;
}

/**
 * Wrapped Worley field. Returns F1 and the F2-F1 edge distance, both in cell units.
 *
 * One jittered feature point per cell held in a table, so the 3x3 neighbourhood search is table
 * reads rather than repeated hashing. That is what keeps the two Worley channels inside the
 * generation budget quoted in the header.
 */
function makeWorley(rng: Rng, cells: number): (u: number, v: number) => { f1: number; edge: number } {
  const points = new Float32Array(cells * cells * 2);
  for (let i = 0; i < cells * cells; i += 1) {
    points[i * 2] = rng.next();
    points[i * 2 + 1] = rng.next();
  }
  return (u, v) => {
    const gx = u * cells;
    const gz = v * cells;
    const cx = Math.floor(gx);
    const cz = Math.floor(gz);
    // Squared distances through the search, square-rooted twice at the end. Ordering is preserved
    // by squaring, and `Math.hypot` in the inner loop was 40% of the atlas generation time.
    let f1 = Infinity;
    let f2 = Infinity;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = cx + dx;
        const nz = cz + dz;
        const wx = ((nx % cells) + cells) % cells;
        const wz = ((nz % cells) + cells) % cells;
        const index = (wz * cells + wx) * 2;
        const ex = nx + points[index]! - gx;
        const ez = nz + points[index + 1]! - gz;
        const d = ex * ex + ez * ez;
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    const near = Math.sqrt(f1);
    return { f1: Math.min(1, near), edge: Math.min(1, Math.sqrt(f2) - near) };
  };
}

/** Maps a 0..1 signal onto an authored multiplier range and encodes it for the atlas. */
function encode(value: number, low: number, high: number): number {
  const v = low + clamp(value, 0, 1) * (high - low);
  return clamp(Math.round((v - DETAIL_VALUE_OFFSET) * 255), 0, 255);
}

// ---------------------------------------------------------- detail atlas

let detailAtlas: THREE.DataTexture | null = null;

/**
 * The one detail atlas: four value-only channels packed into one RGBA8 texture.
 *
 *   R  grass    5 octaves from 8 cells, plus a Worley tussock clump at 0.15 weight
 *   G  soil/dry 4 octaves stretched 3:1 along x, so a worn track reads as dragged, not spotted
 *   B  rock     ridged (1 - |2n-1|), high contrast, for cliff faces and terrace risers
 *   A  gravel   Worley cell boundaries, for scree, rut bottoms and cobble joints
 *
 * One texture rather than four is what keeps the terrain on ONE sampler and therefore one draw
 * call per chunk. Four channels of a single fetch cost what one channel costs.
 */
export function createDetailAtlas(): THREE.DataTexture {
  if (detailAtlas) return detailAtlas;

  const size = DETAIL_ATLAS_SIZE;
  const data = new Uint8Array(size * size * 4);

  // One named stream per channel, drawn in a fixed order, so the atlas is byte-identical across
  // reloads and cannot be shifted by anything else in the frame that consumes randomness.
  const grassNoise = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x6a55) >>> 0));
  const grassClump = makeWorley(new Rng((TEXTURE_SEED ^ 0xc10b) >>> 0), 48);
  const soilNoise = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x5011) >>> 0));
  const rockNoise = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x0c0c) >>> 0));
  const gravelCells = makeWorley(new Rng((TEXTURE_SEED ^ 0x9a4e) >>> 0), 24);

  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = (y * size + x) * 4;

      const grass = fbm(grassNoise, u, v, 5, 8, 8);
      const tussock = 1 - grassClump(u, v).f1;
      data[index] = encode(grass * 0.85 + tussock * 0.15, 0.66, 1.26);

      // 3:1 stretch along x. Two cell counts rather than one keeps both axes periodic.
      const soil = fbm(soilNoise, u, v, 4, 4, 12);
      data[index + 1] = encode(soil, 0.7, 1.24);

      const ridged = 1 - Math.abs(fbm(rockNoise, u, v, 4, 13, 13) * 2 - 1);
      data[index + 2] = encode(ridged, 0.48, 1.15);

      const cell = gravelCells(u, v);
      const stone = clamp(cell.edge / 0.34, 0, 1) * 0.75 + (1 - cell.f1) * 0.25;
      data[index + 3] = encode(stone, 0.58, 1.26);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "detail-atlas";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  // The renderer clamps this against its own maximum, so 8 is a request rather than an assumption.
  texture.anisotropy = 8;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  detailAtlas = texture;
  return texture;
}

// ------------------------------------------------------------ water waves

const waterNormals = new Map<string, THREE.DataTexture>();

/**
 * A tangent-space normal map for a water surface, derived by central difference from the same
 * periodic value noise.
 *
 * Two of these at different tilings and scroll directions is what stops an animated normal map
 * from reading as one texture sliding across a plane. One alone always does.
 */
export function createWaterNormalMap(variant: "fine" | "coarse"): THREE.DataTexture {
  const cached = waterNormals.get(variant);
  if (cached) return cached;

  const size = 256;
  const fine = variant === "fine";
  const noise = makePeriodicNoise(new Rng((TEXTURE_SEED ^ (fine ? 0x77a1 : 0x77b2)) >>> 0));
  const cells = fine ? 12 : 6;
  const octaves = fine ? 3 : 4;
  // Ripple steepness, chosen so the two maps combined stay under about 25 degrees off vertical.
  // Steeper than that and a roughness-0.1 surface flashes the sun straight into the camera.
  const relief = fine ? 1.4 : 2.2;

  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      height[y * size + x] = fbm(noise, x / size, y / size, octaves, cells, cells);
    }
  }

  const data = new Uint8Array(size * size * 4);
  const wrapIndex = (value: number): number => ((value % size) + size) % size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const hl = height[y * size + wrapIndex(x - 1)]!;
      const hr = height[y * size + wrapIndex(x + 1)]!;
      const hd = height[wrapIndex(y - 1) * size + x]!;
      const hu = height[wrapIndex(y + 1) * size + x]!;
      const nx = (hl - hr) * relief;
      const nz = (hd - hu) * relief;
      const length = Math.hypot(nx, nz, 1);
      const index = (y * size + x) * 4;
      data[index] = clamp(Math.round(((nx / length) * 0.5 + 0.5) * 255), 0, 255);
      data[index + 1] = clamp(Math.round(((nz / length) * 0.5 + 0.5) * 255), 0, 255);
      data[index + 2] = clamp(Math.round((1 / length) * 0.5 * 255 + 127.5), 0, 255);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `water-normal-${variant}`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  waterNormals.set(variant, texture);
  return texture;
}

// ---------------------------------------------------------- contact decal

let contactDecal: THREE.DataTexture | null = null;

/**
 * The radial darkening under a prop, rock or tree, authored as a multiply mask: dark at the
 * centre, white at the rim.
 *
 * Multiply rather than alpha because the whole point is a contact shadow, and a multiply blend
 * needs no sorting against the ground it darkens. 64 px is enough for a 1 m quad seen from 6 m up;
 * the falloff is smooth, so there is nothing here for more resolution to resolve.
 */
export function createContactDecalTexture(): THREE.DataTexture {
  if (contactDecal) return contactDecal;

  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x - centre, y - centre) / centre;
      // 0.42 of the radius is the solid core and the rest is falloff, so everything outside the
      // quad's inscribed circle is pure white and the square edge never appears.
      const t = clamp((r - 0.42) / 0.58, 0, 1);
      const value = 0.34 + (1 - 0.34) * (t * t * (3 - 2 * t));
      const byte = clamp(Math.round(value * 255), 0, 255);
      const index = (y * size + x) * 4;
      data[index] = byte;
      data[index + 1] = byte;
      data[index + 2] = byte;
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "contact-decal";
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  contactDecal = texture;
  return texture;
}

/** Frees every generated texture. Only the material library's own dispose path calls this. */
export function disposeGeneratedTextures(): void {
  detailAtlas?.dispose();
  detailAtlas = null;
  for (const texture of waterNormals.values()) texture.dispose();
  waterNormals.clear();
  contactDecal?.dispose();
  contactDecal = null;
}
