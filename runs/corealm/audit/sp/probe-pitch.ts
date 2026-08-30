/**
 * The straight pitch line of each shipped tiled roof.
 *
 * A `roof_tiles_*` is not a triangle: the slope is straight over most of its span, then rolls over
 * into a rounded ridge cap that stands well above the line the slope was heading for. The bbox top
 * measures that cap, so `roofSmallApex` (3.718 on `roof_tiles_4x6`) is 0.35 m higher than the point
 * a straight rake laid on the tiles would reach — which is exactly how much of every gable in the
 * game sticks out through its own roof.
 *
 * This fits the straight part of the slope and reports the apex and half-span of the PITCH LINE,
 * which is what `roof_gable_brick` has to be sized to.
 *
 *   npx tsx runs/corealm/audit/sp/probe-pitch.ts
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

function topAt(tris: readonly Tri[], x: number, z: number): number | null {
  let best: number | null = null;
  for (const t of tris) {
    const [a, b, c] = t;
    const d = (b[2]! - c[2]!) * (a[0]! - c[0]!) + (c[0]! - b[0]!) * (a[2]! - c[2]!);
    if (Math.abs(d) < 1e-12) continue;
    const l0 = ((b[2]! - c[2]!) * (x - c[0]!) + (c[0]! - b[0]!) * (z - c[2]!)) / d;
    const l1 = ((c[2]! - a[2]!) * (x - c[0]!) + (a[0]! - c[0]!) * (z - c[2]!)) / d;
    const l2 = 1 - l0 - l1;
    if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
    const y = l0 * a[1]! + l1 * b[1]! + l2 * c[1]!;
    if (best === null || y > best) best = y;
  }
  return best;
}

for (const roofId of ["roof_tiles_4x6", "roof_tiles_6x8", "roof_tiles_6x12"]) {
  const tris = await trianglesOf(roofId);
  const zs = tris.flatMap((t) => t.map((p) => p[2]!));
  const xs = tris.flatMap((t) => t.map((p) => p[0]!));
  const ys = tris.flatMap((t) => t.map((p) => p[1]!));
  const maxZ = Math.max(...zs);
  const maxX = Math.max(...xs);
  const bboxTop = Math.max(...ys);
  const bboxBottom = Math.min(...ys);
  const stations: number[] = [];
  for (const f of [0, 0.2, 0.4, 0.6, 0.8, 0.9]) stations.push(f * maxZ);
  const slopes: number[] = [];
  const apexes: number[] = [];
  const halves: number[] = [];
  for (const z of stations) {
    const pts: { a: number; y: number }[] = [];
    for (let i = 0; i <= 300; i += 1) {
      const a = (i / 300) * maxX;
      const y = topAt(tris, a, z);
      if (y !== null) pts.push({ a, y });
    }
    // The straight run: from a fifth of the span out to nine tenths, which skips the ridge cap and
    // the fascia lip at the eave.
    const fit = pts.filter((p) => p.a > 0.22 * maxX && p.a < 0.88 * maxX);
    if (fit.length < 20) continue;
    const n = fit.length;
    const ma = fit.reduce((acc, p) => acc + p.a, 0) / n;
    const my = fit.reduce((acc, p) => acc + p.y, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of fit) { num += (p.a - ma) * (p.y - my); den += (p.a - ma) ** 2; }
    const slope = -num / den;
    const apex = my + slope * ma;
    slopes.push(slope);
    apexes.push(apex);
    halves.push(apex / slope);
  }
  const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
  const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
  console.log(`${roofId}`);
  console.log(`  bbox: halfX ${maxX.toFixed(3)}  y ${bboxBottom.toFixed(3)} .. ${bboxTop.toFixed(3)}  halfZ ${maxZ.toFixed(3)}`);
  console.log(`  pitch line: slope ${mean(slopes).toFixed(4)} (spread ${spread(slopes).toFixed(4)})`);
  console.log(`  pitch apex  ${mean(apexes).toFixed(4)} (spread ${spread(apexes).toFixed(4)})   vs bbox top ${bboxTop.toFixed(3)}`);
  console.log(`  pitch half  ${mean(halves).toFixed(4)} (spread ${spread(halves).toFixed(4)})   vs bbox half ${maxX.toFixed(3)}`);
  console.log(`  apex / bboxTop ${(mean(apexes) / bboxTop).toFixed(4)}   half / bboxHalf ${(mean(halves) / maxX).toFixed(4)}`);
  console.log("");
}
