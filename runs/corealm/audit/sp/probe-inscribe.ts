/**
 * The largest straight gable that fits UNDER each shipped roof.
 *
 * `gableEnds` models a tiled roof as a triangle from the eave to the ridge and sizes
 * `roof_gable_brick` — which really is a straight triangle — to it. The roofs are not triangles:
 * sliced off the GLB, `roof_tiles_4x6` runs 3.638 m up at the ridge but only 2.387 m at a quarter
 * of its half-span, where a straight chord would be at 2.769. The tile surface SAGS below its own
 * chord, so a gable fitted to apex and eave stands proud of the tiles across the whole middle of
 * its rake. That is the 0.09-0.26 m of plaster sticking through every roof in the game.
 *
 * This measures the sag and prints, per roof asset and per along-ridge station, the inscribed
 * triangle: the tallest apex and the widest base whose straight rake stays under the tiles.
 *
 *   npx tsx runs/corealm/audit/sp/probe-inscribe.ts
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
type Tri = readonly [Vec, Vec, Vec];

function mul(m: readonly number[], v: readonly number[]): Vec {
  return [
    m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
    m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
    m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
  ];
}

async function trianglesOf(assetId: string): Promise<Tri[]> {
  const doc = await io.read(`game/public/assets/${fileById.get(assetId)!}`);
  const tris: Tri[] = [];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const world = node.getWorldMatrix() as unknown as number[];
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const indices = prim.getIndices();
        const count = indices ? indices.getCount() : pos.getCount();
        const el = [0, 0, 0];
        const at = (i: number): Vec => {
          pos.getElement(indices ? indices.getScalar(i) : i, el);
          return mul(world, el);
        };
        for (let i = 0; i + 2 < count; i += 3) tris.push([at(i), at(i + 1), at(i + 2)]);
      }
    });
  }
  return tris;
}

/** Both surfaces of `tris` above (x, z): the soffit a gable has to reach and the tiles it must not break. */
function surfaces(tris: readonly Tri[], x: number, z: number): { low: number; high: number } | null {
  let low: number | null = null;
  let high: number | null = null;
  for (const t of tris) {
    const [a, b, c] = t;
    const d = (b[2]! - c[2]!) * (a[0]! - c[0]!) + (c[0]! - b[0]!) * (a[2]! - c[2]!);
    if (Math.abs(d) < 1e-12) continue;
    const l0 = ((b[2]! - c[2]!) * (x - c[0]!) + (c[0]! - b[0]!) * (z - c[2]!)) / d;
    const l1 = ((c[2]! - a[2]!) * (x - c[0]!) + (a[0]! - c[0]!) * (z - c[2]!)) / d;
    const l2 = 1 - l0 - l1;
    if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
    const y = l0 * a[1]! + l1 * b[1]! + l2 * c[1]!;
    if (low === null || y < low) low = y;
    if (high === null || y > high) high = y;
  }
  return low === null || high === null ? null : { low, high };
}

const CLEARANCE = 0.03;

for (const roofId of ["roof_tiles_4x6", "roof_tiles_6x8", "roof_tiles_6x12"]) {
  const tris = await trianglesOf(roofId);
  const zs = tris.flatMap((t) => t.map((p) => p[2]!));
  const xs = tris.flatMap((t) => t.map((p) => p[0]!));
  const maxZ = Math.max(...zs);
  const maxX = Math.max(...xs);
  console.log(`\n${roofId}  halfX ${maxX.toFixed(3)}  halfZ ${maxZ.toFixed(3)}`);
  console.log("   z/halfZ    ridge   surface@y=0   inscribed apex   inscribed half   apex/ridge  half/@y0");
  for (const f of [0, 0.4, 0.6, 0.75, 0.85, 0.92, 0.97]) {
    const z = f * maxZ;
    const samples: { a: number; low: number; high: number }[] = [];
    for (let i = 0; i <= 400; i += 1) {
      const a = (i / 400) * maxX;
      const s = surfaces(tris, a, z);
      if (s !== null) samples.push({ a, low: s.low, high: s.high });
    }
    if (samples.length < 10) { console.log(`   ${f.toFixed(2)}  (no surface)`); continue; }
    const ridge = samples[0]!.high;
    // Where the TILE surface crosses y = 0 going outward: the wall-head line the gable closes.
    let crossing = maxX;
    for (let i = 1; i < samples.length; i += 1) {
      if (samples[i - 1]!.high >= 0 && samples[i]!.high < 0) {
        const p = samples[i - 1]!;
        const q = samples[i]!;
        crossing = p.a + (q.a - p.a) * (p.high / (p.high - q.high));
        break;
      }
    }
    // The tallest straight rake through (half, 0) that stays under the tiles.
    const half = crossing;
    let apex = Infinity;
    // Ignore the outermost tenth: the tiles kick up into a fascia lip there, and the rake meets the
    // wall head under it whatever the apex is.
    for (const s of samples) {
      if (s.a < 0.02 * half || s.a > 0.9 * half || s.high <= 0) continue;
      apex = Math.min(apex, (s.high - CLEARANCE) / (1 - s.a / half));
    }
    apex = Math.min(apex, ridge - CLEARANCE);
    // Does that rake ever fall below the soffit, i.e. leave daylight under the tiles?
    let worstGap = 0;
    for (const s of samples) {
      if (s.a >= half || s.high <= 0) continue;
      worstGap = Math.max(worstGap, s.low - apex * (1 - s.a / half));
    }
    console.log(
      `   ${f.toFixed(2).padStart(7)}  ${ridge.toFixed(3).padStart(7)}  ${crossing.toFixed(3).padStart(11)}`
      + `  ${apex.toFixed(3).padStart(14)}  ${half.toFixed(3).padStart(14)}`
      + `  ${(apex / ridge).toFixed(4).padStart(10)}  ${(half / crossing).toFixed(4).padStart(8)}`
      + `  gap ${worstGap.toFixed(3)}`,
    );
    if (f === 0 || f === 0.85) {
      const chord = (a: number): number => ridge * (1 - a / half);
      const rows: string[] = [];
      for (let g = 0; g <= 1.0001; g += 0.1) {
        const a = g * half;
        let nearest = samples[0]!;
        for (const s of samples) if (Math.abs(s.a - a) < Math.abs(nearest.a - a)) nearest = s;
        rows.push(`${g.toFixed(1)}:tile ${nearest.high.toFixed(2)} chord ${chord(a).toFixed(2)} sag ${(chord(a) - nearest.high).toFixed(2)}`);
      }
      console.log(`        ${rows.join("  ")}`);
    }
  }
}
