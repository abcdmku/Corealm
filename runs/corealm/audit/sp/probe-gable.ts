/**
 * Measure the shipped gable and the shipped roofs against each other.
 *
 * `gableEnds` fits `roof_gable_brick` by two constants read off a rasterised silhouette. This
 * prints what the real triangles say, so the fit can be derived rather than guessed.
 *
 *   npx tsx runs/corealm/audit/sp/probe-gable.ts
 */
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";

interface ManifestAsset { id: string; file: string }
const manifest = JSON.parse(
  readFileSync("game/public/assets/manifest.json", "utf8"),
) as { assets: ManifestAsset[] };
const fileById = new Map(manifest.assets.map((a) => [a.id, a.file]));
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);

type Vec = [number, number, number];

function mul(m: readonly number[], v: readonly number[]): Vec {
  return [
    m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
    m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
    m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
  ];
}

async function verticesOf(assetId: string): Promise<{ p: Vec; material: string }[]> {
  const doc = await io.read(`game/public/assets/${fileById.get(assetId)!}`);
  const out: { p: Vec; material: string }[] = [];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const world = node.getWorldMatrix() as unknown as number[];
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const material = prim.getMaterial()?.getName() ?? "?";
        const el = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i += 1) {
          pos.getElement(i, el);
          out.push({ p: mul(world, el), material });
        }
      }
    });
  }
  return out;
}

/** Widest |x| at each height band, which is the profile a fit has to match. */
function profile(points: { p: Vec }[], bands = 24): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { p } of points) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const widest = new Array<number>(bands).fill(0);
  for (const { p } of points) {
    const band = Math.min(bands - 1, Math.floor(((p[1] - minY) / (maxY - minY)) * bands));
    widest[band] = Math.max(widest[band]!, Math.abs(p[0]));
  }
  console.log(`    y ${minY.toFixed(3)} .. ${maxY.toFixed(3)}`);
  for (let band = 0; band < bands; band += 1) {
    const y = minY + ((band + 0.5) / bands) * (maxY - minY);
    console.log(`      y=${y.toFixed(3)}  |x|max=${widest[band]!.toFixed(3)}`);
  }
}

const gable = await verticesOf("roof_gable_brick");
console.log("roof_gable_brick materials:", [...new Set(gable.map((v) => v.material))].join(", "));
console.log("  half-width profile:");
profile(gable);
let gz0 = Infinity;
let gz1 = -Infinity;
for (const { p } of gable) { gz0 = Math.min(gz0, p[2]); gz1 = Math.max(gz1, p[2]); }
console.log(`  z span ${gz0.toFixed(3)} .. ${gz1.toFixed(3)}`);

// Straight-line fit of the raking edge through the widest points above the rail.
{
  const samples: { y: number; x: number }[] = [];
  const bands = 40;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { p } of gable) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const widest = new Array<number>(bands).fill(0);
  for (const { p } of gable) {
    const band = Math.min(bands - 1, Math.floor(((p[1] - minY) / (maxY - minY)) * bands));
    widest[band] = Math.max(widest[band]!, Math.abs(p[0]));
  }
  for (let band = 2; band < bands - 2; band += 1) {
    samples.push({ y: minY + ((band + 0.5) / bands) * (maxY - minY), x: widest[band]! });
  }
  const n = samples.length;
  const sx = samples.reduce((a, s) => a + s.y, 0) / n;
  const sy = samples.reduce((a, s) => a + s.x, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of samples) { num += (s.y - sx) * (s.x - sy); den += (s.y - sx) ** 2; }
  const slope = num / den;
  const intercept = sy - slope * sx;
  console.log(`  raking edge |x| = ${intercept.toFixed(4)} ${slope.toFixed(4)}*y`
    + `  ->  |x| at y=0 is ${intercept.toFixed(4)}, apex at y=${(-intercept / slope).toFixed(4)}`);
}

for (const roofId of ["roof_tiles_4x6", "roof_tiles_6x8", "roof_tiles_6x12"]) {
  const roof = await verticesOf(roofId);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const { p } of roof) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
  }
  console.log(`\n${roofId}: x ${minX.toFixed(3)}..${maxX.toFixed(3)}  y ${minY.toFixed(3)}..${maxY.toFixed(3)}  z ${minZ.toFixed(3)}..${maxZ.toFixed(3)}`);
  // Cross-section: for slices of |x|, the highest y anywhere in that slice.
  const bands = 16;
  for (let band = 0; band < bands; band += 1) {
    const lo = (band / bands) * maxX;
    const hi = ((band + 1) / bands) * maxX;
    let top = -Infinity;
    let bottom = Infinity;
    for (const { p } of roof) {
      if (Math.abs(p[0]) < lo || Math.abs(p[0]) >= hi) continue;
      top = Math.max(top, p[1]); bottom = Math.min(bottom, p[1]);
    }
    if (top === -Infinity) continue;
    console.log(`   |x| ${lo.toFixed(2)}..${hi.toFixed(2)}  y ${bottom.toFixed(3)} .. ${top.toFixed(3)}`);
  }
  // How far in z the tile surface reaches at each end, and whether the ends are square.
  const endBand = roof.filter(({ p }) => p[2] > maxZ - 0.15);
  let endTop = -Infinity;
  let endWide = 0;
  for (const { p } of endBand) { endTop = Math.max(endTop, p[1]); endWide = Math.max(endWide, Math.abs(p[0])); }
  console.log(`   at the +z end: top y ${endTop.toFixed(3)}, widest |x| ${endWide.toFixed(3)}`);
}
