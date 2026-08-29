/**
 * What the generated ground normal maps actually contain.
 *
 * Reports, per surface, the mean and 95th-percentile tilt off vertical in degrees, plus the
 * albedo channel's own standard deviation, so the relief constants in proceduralTextures.ts can be
 * chosen against a number rather than against a screenshot. Also prints the multi-scale feature
 * ladder the four ground reads cover, which is the thing that was measurably missing.
 *
 *   npx tsx runs/corealm/audit/gd-normals.ts
 */
import {
  DETAIL_ATLAS_SIZE,
  DETAIL_TILING_METRES,
  DETAIL_VALUE_OFFSET,
  createDetailAtlas,
  createDetailNormals,
  createMacroVariation,
} from "../../../game/src/render/proceduralTextures.js";

function stats(values: number[]): { mean: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((total, v) => total + v, 0) / values.length;
  return { mean, p95: sorted[Math.floor(sorted.length * 0.95)]!, max: sorted[sorted.length - 1]! };
}

const started = Date.now();
const atlas = createDetailAtlas();
const normals = createDetailNormals();
const macro = createMacroVariation();
const generationMs = Date.now() - started;

const size = DETAIL_ATLAS_SIZE;
const atlasData = atlas.image.data as Uint8Array;
const macroData = macro.image.data as Uint8Array;

console.log(`generation ${generationMs} ms for atlas + normals + macro`);
console.log(`detail atlas ${size}px at ${DETAIL_TILING_METRES} m -> ${(size / DETAIL_TILING_METRES).toFixed(0)} texels/m`);

const channels: { name: string; texture: Uint8Array; offset: number; albedo: number }[] = [
  { name: "grass", texture: normals.grassSoil.image.data as Uint8Array, offset: 0, albedo: 0 },
  { name: "soil", texture: normals.grassSoil.image.data as Uint8Array, offset: 2, albedo: 1 },
  { name: "rock", texture: normals.rockGravel.image.data as Uint8Array, offset: 0, albedo: 2 },
  { name: "gravel", texture: normals.rockGravel.image.data as Uint8Array, offset: 2, albedo: 3 },
];

console.log("surface   tilt mean  tilt p95  tilt max   albedo sd  albedo p1..p99");
for (const channel of channels) {
  const tilts: number[] = [];
  const albedo: number[] = [];
  for (let index = 0; index < size * size; index += 1) {
    const base = index * 4 + channel.offset;
    const nx = (channel.texture[base]! / 255) * 2 - 1;
    const nz = (channel.texture[base + 1]! / 255) * 2 - 1;
    const horizontal = Math.min(1, Math.hypot(nx, nz));
    tilts.push((Math.asin(horizontal) * 180) / Math.PI);
    albedo.push(atlasData[index * 4 + channel.albedo]! / 255 + DETAIL_VALUE_OFFSET);
  }
  const tilt = stats(tilts);
  const value = stats(albedo);
  const mean = albedo.reduce((total, v) => total + v, 0) / albedo.length;
  const sd = Math.sqrt(albedo.reduce((total, v) => total + (v - mean) ** 2, 0) / albedo.length);
  const sorted = [...albedo].sort((a, b) => a - b);
  console.log(
    channel.name.padEnd(9),
    `${tilt.mean.toFixed(1)}deg`.padStart(9),
    `${tilt.p95.toFixed(1)}deg`.padStart(9),
    `${tilt.max.toFixed(1)}deg`.padStart(9),
    sd.toFixed(3).padStart(11),
    `${sorted[Math.floor(sorted.length * 0.01)]!.toFixed(3)}..${sorted[Math.floor(sorted.length * 0.99)]!.toFixed(3)}`.padStart(16),
    `(max ${value.max.toFixed(2)})`,
  );
}

// The point of the four-rate ladder: no gap in feature size between the reads.
const macroSize = Math.round(Math.sqrt(macroData.length / 4));
console.log(`\nmacro texture ${macroSize}px, 4 octaves from 2-3 base cells`);
console.log("read      tiling   coarsest feature   finest feature");
const reads: [string, number, number, number][] = [
  ["detail", DETAIL_TILING_METRES, 12, 12 * 2 ** 4],
  ["near", 6.3, 3, 3 * 2 ** 3],
  ["middle", 16, 3, 3 * 2 ** 3],
  ["macro", 40, 3, 3 * 2 ** 3],
];
for (const [name, tiling, coarse, fine] of reads) {
  console.log(
    name.padEnd(9),
    `${tiling} m`.padStart(7),
    `${(tiling / coarse).toFixed(2)} m`.padStart(18),
    `${(tiling / fine).toFixed(3)} m`.padStart(16),
  );
}
