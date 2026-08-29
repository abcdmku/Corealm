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
 *    repeat is broken up by a second, separately authored macro texture instead — see the last
 *    paragraph, and note that the first attempt at this reused the atlas and printed a honeycomb.
 *  - 512 px, not 1024. Measured generation cost, node 24 on this machine: 512 takes 144 ms with
 *    the contrast stretch (125 ms without it, and the macro texture adds 25 ms) and 1024 takes
 *    461 ms, and that cost lands on the boot path and on every headless audit run. At
 *    the 2.5 m detail tiling 512 px is 205 texels/m, finer than a 1080p frame resolves at the
 *    6-34 m camera distances in shots.ts. Memory with mips: 1.4 MB, against the 5.6 MB a 1024
 *    atlas would cost.
 *
 * TWO textures, not one sampled twice. The first pass read this atlas again at 37 m tiling to break
 * the repeat, and that printed the atlas's OWN cell structure across the world at nine to fifteen
 * times its authored size: the gravel channel's Worley cells landed at 1.54 m and the rock
 * channel's ridges at 2.85 m, which is exactly the honeycomb / lizard-skin reported in
 * `wire-*.png` on stone and gravel. A texture authored for 2.5 m cannot also be a macro texture.
 * `createMacroVariation` is the far read now, and it contains nothing but low-frequency fbm — no
 * Worley, no ridges, nothing with an edge for the eye to lock onto. It is 256 px because at its
 * closest tiling, 9.5 m, that is 27 texels/m and its finest authored feature is 1.2 m, so more
 * resolution would store nothing.
 */
import * as THREE from "three";
import { Rng } from "../core/rng.js";
import { clamp } from "../core/math.js";

/** Edge length of the detail atlas, in texels. See the header for why this is not 1024. */
export const DETAIL_ATLAS_SIZE = 512;

/** Edge length of the macro-variation texture. See the header for why this is not the atlas. */
export const MACRO_TEXTURE_SIZE = 256;

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

interface WorleySample {
  /** Distance to the nearest feature point, in cell units, clamped to 1. */
  f1: number;
  /** F2 - F1: zero exactly on a cell boundary, largest at a cell's centre. */
  edge: number;
  /** The nearest cell's own 0..1 value, so every stone can have a tone of its own. */
  tone: number;
}

/**
 * Wrapped Worley field.
 *
 * `tone` exists because a thresholded F1 or a thresholded edge distance IS a honeycomb — one
 * repeated cell shape at one size, which is precisely how the shipped gravel channel read. Real
 * gravel is a field of stones that differ from EACH OTHER, with a dark joint between them, so the
 * cell's own random value is the signal that matters and the edge distance is only the joint.
 *
 * One jittered feature point per cell held in a table, so the 3x3 neighbourhood search is table
 * reads rather than repeated hashing. That is what keeps the Worley channels inside the generation
 * budget quoted in the header.
 */
function makeWorley(rng: Rng, cells: number): (u: number, v: number) => WorleySample {
  const points = new Float32Array(cells * cells * 3);
  for (let i = 0; i < cells * cells; i += 1) {
    points[i * 3] = rng.next();
    points[i * 3 + 1] = rng.next();
    points[i * 3 + 2] = rng.next();
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
    let tone = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = cx + dx;
        const nz = cz + dz;
        const wx = ((nx % cells) + cells) % cells;
        const wz = ((nz % cells) + cells) % cells;
        const index = (wz * cells + wx) * 3;
        const ex = nx + points[index]! - gx;
        const ez = nz + points[index + 1]! - gz;
        const d = ex * ex + ez * ez;
        if (d < f1) {
          f2 = f1;
          f1 = d;
          tone = points[index + 2]!;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    const near = Math.sqrt(f1);
    return { f1: Math.min(1, near), edge: Math.min(1, Math.sqrt(f2) - near), tone };
  };
}

/** Hermite ease on an already-clamped 0..1 signal. Local, because core/math.ts has no smoothstep. */
function smoothstep01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Maps a 0..1 signal onto an authored multiplier range and encodes it for the atlas. */
function encode(value: number, low: number, high: number): number {
  const v = low + clamp(value, 0, 1) * (high - low);
  return clamp(Math.round((v - DETAIL_VALUE_OFFSET) * 255), 0, 255);
}

/**
 * Rescales a generated field in place so its 1st and 99th percentiles land on 0 and 1 AND its mean
 * lands on 0.5.
 *
 * Without this, an authored range is a range the texture never reaches, and that is measurably
 * most of why the ground reads as one flat field past about 20 m. A four-octave fbm at gain 0.5 is
 * a sum of four bounded terms, so its output concentrates hard around 0.5 by the central limit
 * theorem and the tails are almost empty. Measured on the shipped generator with
 * runs/corealm/audit/w3lit-tex.mjs: the macro grass channel is authored 0.74..1.26 and realises
 * 0.810..1.206, with p5..p95 of only 0.857..1.127 and a standard deviation of 0.077. The gravel
 * channel is worse — authored 0.87..1.13, sd 0.035. At 20-60 m the 2.5 m detail read has already
 * mipped to its own mean, so those two ARE the surface, and a +/-8% multiplier on ground colour is
 * about four levels of 255 after the sRGB transfer. Four levels is not a surface.
 *
 * Percentiles rather than min/max, because a value-noise fbm has isolated extremes: stretching on
 * the extremes moves almost nothing. 1% and 99% clip 5,243 texels of a 512 atlas and 655 of the
 * macro, and those clip against the authored bound, which is where the darkest joint and the
 * brightest crest are supposed to sit anyway.
 *
 * The two halves are stretched SEPARATELY, onto [0, 0.5] and [0.5, 1]. That pins the channel mean
 * to the midpoint of whatever range `encode` maps it onto, and every range in this file is
 * symmetric about 1.0, so each channel is a pure contrast signal whose mean multiplier lands
 * within 4% of 1.0 (measured 0.994 to 1.041; the residual is the 1% tails clipping against the
 * authored bound on the skewed rock and gravel channels). This is what keeps the file's stated contract — hue and VALUE live in `REGION_PALETTES`,
 * these textures are variation only — true after the stretch. A single-piece stretch broke it: the
 * detail rock channel came out with a mean of 0.923 and the macro gravel channel 1.070, so
 * retuning the contrast would silently have darkened every cliff by 8% and brightened every
 * cobbled square by 7%. The kink at the mean is a slope discontinuity in a multiplier, which
 * nothing downstream can see.
 *
 * A histogram, not a sort. Sorting four 262,144-element channels measured 80 ms against the 125 ms
 * the whole atlas costs, and this runs on the boot path and in every headless audit. 4,096 bins
 * over the field's own range is a quantisation of 1/4096 of that range, far finer than the 1/255
 * the result is stored at.
 */
function contrastStretch(field: Float32Array): void {
  const bins = 4096;
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  for (let i = 0; i < field.length; i += 1) {
    const v = field[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
    total += v;
  }
  const span = max - min;
  if (span <= 1e-6) return;
  const mean = total / field.length;

  const histogram = new Uint32Array(bins);
  for (let i = 0; i < field.length; i += 1) {
    const bin = Math.min(bins - 1, Math.floor(((field[i]! - min) / span) * bins));
    histogram[bin] = histogram[bin]! + 1;
  }

  const lowTarget = field.length * 0.01;
  const highTarget = field.length * 0.99;
  let seen = 0;
  let low = min;
  let high = max;
  let haveLow = false;
  for (let bin = 0; bin < bins; bin += 1) {
    seen += histogram[bin]!;
    if (!haveLow && seen >= lowTarget) {
      low = min + (bin / bins) * span;
      haveLow = true;
    }
    if (seen >= highTarget) {
      high = min + ((bin + 1) / bins) * span;
      break;
    }
  }

  const below = Math.max(1e-6, mean - low);
  const above = Math.max(1e-6, high - mean);
  for (let i = 0; i < field.length; i += 1) {
    const v = field[i]!;
    field[i] = v <= mean
      ? clamp(0.5 * (v - low) / below, 0, 0.5)
      : clamp(0.5 + 0.5 * (v - mean) / above, 0.5, 1);
  }
}

// ---------------------------------------------------------- detail atlas

let detailAtlas: THREE.DataTexture | null = null;

/**
 * The one detail atlas: four value-only channels packed into one RGBA8 texture, authored for ONE
 * tiling rate — 2.5 m, which is roughly a footstep at the 6-34 m camera distances in shots.ts.
 *
 *   R  grass    fine blade fbm from 12 cells (21 cm), with a soft tussock clump on top
 *   G  soil/dry 1.6:1 drag along x, plus an isotropic grit octave so it is dirt, not corduroy
 *   B  rock     ridged fracture at 18 cells (14 cm) over a broad face term
 *   A  gravel   a field of stones that differ from each other, with dark joints between them
 *
 * Two things here are corrections of measured defects rather than taste.
 *
 * The soil channel was stretched 3:1 (4 cells across x against 12 across z). Every splat weight
 * except grass, rock and cobble folds onto this channel, so that stretch was drawn over the whole
 * of Coldbrace square and every road in the world: `wire-bank.png` and `wire-town_entrance.png`
 * are covered in metre-long horizontal streaks, which is what "the paving and gravel are very
 * smeary" is. 1.6:1 still drags, and the grit octave gives the eye something at the scale it is
 * actually looking at.
 *
 * The gravel channel was `edge/0.34` thresholded plus `1 - f1` — bright veins tracing every cell
 * boundary at one cell size, i.e. a honeycomb by construction. It is now the cell's own tone with
 * a dark joint, which is what a gravel bed and a cobbled square both actually are.
 *
 * One texture rather than four is what keeps the terrain on ONE atlas sampler and therefore one
 * draw call per chunk. Four channels of a single fetch cost what one channel costs.
 */
export function createDetailAtlas(): THREE.DataTexture {
  if (detailAtlas) return detailAtlas;

  const size = DETAIL_ATLAS_SIZE;
  const data = new Uint8Array(size * size * 4);

  // One named stream per channel, drawn in a fixed order, so the atlas is byte-identical across
  // reloads and cannot be shifted by anything else in the frame that consumes randomness.
  const grassNoise = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x6a55) >>> 0));
  const grassClump = makeWorley(new Rng((TEXTURE_SEED ^ 0xc10b) >>> 0), 26);
  const soilNoise = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x5011) >>> 0));
  const gritNoise = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x671f) >>> 0));
  const rockNoise = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x0c0c) >>> 0));
  const gravelCells = makeWorley(new Rng((TEXTURE_SEED ^ 0x9a4e) >>> 0), 32);

  // Fields first, encoded second, because `contrastStretch` needs the whole channel before it can
  // know what its percentiles are. Four 512 x 512 Float32Arrays are 4 MB of transient allocation
  // against the 1.4 MB the finished atlas occupies with mips, and they are released on return.
  const texels = size * size;
  const grassField = new Float32Array(texels);
  const soilField = new Float32Array(texels);
  const rockField = new Float32Array(texels);
  const gravelField = new Float32Array(texels);

  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;

      // Grass. The clump is a broad tussock swell, NOT a thresholded cell: `1 - f1` smoothed to
      // its own midpoint is a soft dome per cell with no visible boundary between domes.
      const clump = grassClump(u, v);
      const tussock = smoothstep01(0.25 + 0.75 * (1 - clump.f1)) * (0.72 + 0.28 * clump.tone);
      grassField[index] = fbm(grassNoise, u, v, 5, 12, 12) * 0.82 + tussock * 0.18;

      // Soil. 1.6:1 drag (10 cells across x against 16 across z), and a third of the signal is an
      // isotropic grit octave so a road reads as worn dirt rather than as brushed metal.
      const drag = fbm(soilNoise, u, v, 4, 10, 16);
      const grit = fbm(gritNoise, u, v, 3, 40, 40);
      soilField[index] = drag * 0.66 + grit * 0.34;

      // Rock. Ridged fracture over a broad face term, so a cliff has both a shape and a grain.
      const face = fbm(rockNoise, u, v, 2, 5, 5);
      const ridged = 1 - Math.abs(fbm(rockNoise, u, v, 3, 18, 18) * 2 - 1);
      rockField[index] = ridged * 0.62 + face * 0.38;

      // Gravel and cobble. Per-stone tone, joints darkened where F2-F1 approaches zero, and a
      // little grit inside each stone so a close-up face is not a flat chip.
      const cell = gravelCells(u, v);
      const joint = clamp(cell.edge / 0.09, 0, 1);
      const stone = (0.30 + 0.70 * smoothstep01(joint)) * (0.62 + 0.50 * cell.tone);
      gravelField[index] = stone * 0.86 + grit * 0.14;
    }
  }

  for (const field of [grassField, soilField, rockField, gravelField]) contrastStretch(field);

  for (let index = 0; index < texels; index += 1) {
    const offset = index * 4;
    // Symmetric about 1.0, every one of them, so `contrastStretch`'s mean-centring makes each
    // channel's mean multiplier exactly 1.0 and the region palette keeps sole authority over how
    // light a surface is. The half-widths are the authored contrast per surface: grass and worn
    // soil are gentle, a fracture face and a gravel bed are not.
    data[offset] = encode(grassField[index]!, 0.73, 1.27);
    data[offset + 1] = encode(soilField[index]!, 0.75, 1.25);
    data[offset + 2] = encode(rockField[index]!, 0.65, 1.35);
    data[offset + 3] = encode(gravelField[index]!, 0.65, 1.35);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "detail-atlas";
  applyGroundTextureSettings(texture, 8);
  detailAtlas = texture;
  return texture;
}

// ------------------------------------------------------- macro variation

let macroVariation: THREE.DataTexture | null = null;

/**
 * The far read: four channels of low-frequency variation, sampled at 37 m so the 2.5 m detail tile
 * stops repeating visibly across a 700 x 400 m world.
 *
 * Sampled TWICE, at 9.5 m and at 37 m, so this one texture covers everything from 1.5 m features
 * up to 12 m ones. That range is where a 700 x 400 m world is actually looked at: measured, the
 * 2.5 m detail read has mipped away to its own mean by about 20 m.
 *
 * Nothing in here has an edge. Four octaves of plain fbm per channel and no Worley, no ridge, no
 * threshold, because ANY repeated shape becomes a pattern once it is drawn 12 m across: that is
 * what put a honeycomb on every stone and gravel surface in the shipped build. The channel order
 * matches the atlas so one dot product selects both.
 *
 *   R  grass   patchy sward, and now also the dry/lush selector the ground shader tints with
 *   G  soil    broad dust drift over a track
 *   B  rock    the widest range of the four; a cliff face wants macro value breaks
 *   A  gravel  scree drift, gentle, because a cobbled square must stay flat
 *
 * The authored ranges are wide and, since `contrastStretch`, they are the ranges the texture
 * actually realises. Measured with runs/corealm/audit/w3lit-tex.mjs, the grass channel went from
 * p5..p95 = 0.857..1.127 and sigma 0.077 to 0.747..1.237 and sigma 0.140 — 1.8x the contrast, on
 * the one read that survives to 20-60 m. Gravel is deliberately left the tightest of the four: it
 * covers every cobbled square and paved approach in the game, and a macro swell drawn 12 m across
 * a laid floor reads as a sagging floor.
 */
export function createMacroVariation(): THREE.DataTexture {
  if (macroVariation) return macroVariation;

  const size = MACRO_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const grass = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x1a30) >>> 0));
  const soil = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x2b41) >>> 0));
  const rock = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x3c52) >>> 0));
  const gravel = makePeriodicNoise(new Rng((TEXTURE_SEED ^ 0x4d63) >>> 0));

  const texels = size * size;
  const grassField = new Float32Array(texels);
  const soilField = new Float32Array(texels);
  const rockField = new Float32Array(texels);
  const gravelField = new Float32Array(texels);

  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      grassField[index] = fbm(grass, u, v, 4, 3, 3);
      soilField[index] = fbm(soil, u, v, 4, 2, 3);
      rockField[index] = fbm(rock, u, v, 4, 3, 3);
      gravelField[index] = fbm(gravel, u, v, 4, 2, 2);
    }
  }

  for (const field of [grassField, soilField, rockField, gravelField]) contrastStretch(field);

  for (let index = 0; index < texels; index += 1) {
    const offset = index * 4;
    // Symmetric about 1.0 for the same reason as the atlas. These half-widths are wider than the
    // atlas's because this texture is the ONLY signal left at 20-60 m: the 2.5 m detail read has
    // mipped to its own mean by about 20 m, so whatever contrast the far ground has, it has from
    // here. Gravel stays the tightest of the four — a cobbled square is laid flat and a macro
    // swell across it reads as a sagging floor.
    data[offset] = encode(grassField[index]!, 0.70, 1.30);
    data[offset + 1] = encode(soilField[index]!, 0.75, 1.25);
    data[offset + 2] = encode(rockField[index]!, 0.67, 1.33);
    data[offset + 3] = encode(gravelField[index]!, 0.84, 1.16);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "macro-variation";
  // Anisotropy 4 rather than 8: at 37 m tiling the macro read never reaches the grazing footprint
  // that makes the detail read smear, so the extra taps would buy nothing.
  applyGroundTextureSettings(texture, 4);
  macroVariation = texture;
  return texture;
}

/**
 * Wrap, mip and filter settings shared by both ground textures.
 *
 * `anisotropy` is a request: three clamps it against `capabilities.getMaxAnisotropy()` at upload,
 * and on a context without EXT_texture_filter_anisotropic it silently becomes 1. The value has to
 * be set BEFORE the first upload or the sampler is already built without it, which is why this
 * lives here and not at a call site that runs after the texture is in use.
 */
function applyGroundTextureSettings(texture: THREE.DataTexture, anisotropy: number): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = anisotropy;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
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
  macroVariation?.dispose();
  macroVariation = null;
  for (const texture of waterNormals.values()) texture.dispose();
  waterNormals.clear();
  contactDecal?.dispose();
  contactDecal = null;
}
