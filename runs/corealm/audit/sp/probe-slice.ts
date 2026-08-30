/**
 * True silhouettes, sliced off the triangles rather than sampled at the vertices.
 *
 * `probe-gable.ts` read vertex positions, and both of these meshes are low-poly: a solid plaster
 * triangle has three vertices and no interior samples at all, so a vertex histogram reports zero
 * width across most of the gable. Slicing the triangles at a plane measures the shape a player
 * actually sees.
 *
 *   npx tsx runs/corealm/audit/sp/probe-slice.ts
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

async function trianglesOf(assetId: string, materialFilter?: RegExp): Promise<Tri[]> {
  const doc = await io.read(`game/public/assets/${fileById.get(assetId)!}`);
  const tris: Tri[] = [];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const world = node.getWorldMatrix() as unknown as number[];
      for (const prim of mesh.listPrimitives()) {
        const name = prim.getMaterial()?.getName() ?? "";
        if (materialFilter && !materialFilter.test(name)) continue;
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

/** Segments where the triangles cross the plane `axis = value`, projected onto the other two axes. */
function slice(tris: readonly Tri[], axis: 0 | 1 | 2, value: number): Vec[] {
  const points: Vec[] = [];
  for (const t of tris) {
    for (let i = 0; i < 3; i += 1) {
      const a = t[i]!;
      const b = t[(i + 1) % 3]!;
      const da = a[axis]! - value;
      const db = b[axis]! - value;
      if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue;
      if (da === db) continue;
      const f = da / (da - db);
      points.push([a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f, a[2]! + (b[2]! - a[2]!) * f]);
    }
  }
  return points;
}

const gable = await trianglesOf("roof_gable_brick");
const gablePlaster = await trianglesOf("roof_gable_brick", /Plaster/);
console.log("roof_gable_brick outline, sliced at 0.1 m of height:");
console.log("        y     |x| all   |x| plaster");
for (let y = -0.1; y <= 4.4; y += 0.2) {
  const all = slice(gable, 1, y);
  const plaster = slice(gablePlaster, 1, y);
  const wa = all.reduce((acc, p) => Math.max(acc, Math.abs(p[0]!)), 0);
  const wp = plaster.reduce((acc, p) => Math.max(acc, Math.abs(p[0]!)), 0);
  console.log(`    ${y.toFixed(2).padStart(6)}  ${wa.toFixed(3).padStart(8)}  ${wp.toFixed(3).padStart(8)}`);
}
{
  const zs = gable.flatMap((t) => t.map((p) => p[2]!));
  console.log(`  z span ${Math.min(...zs).toFixed(3)} .. ${Math.max(...zs).toFixed(3)}`);
}

for (const roofId of ["roof_tiles_4x6", "roof_tiles_6x8", "roof_tiles_6x12"]) {
  const roof = await trianglesOf(roofId);
  const zs = roof.flatMap((t) => t.map((p) => p[2]!));
  const maxZ = Math.max(...zs);
  console.log(`\n${roofId}: cross-sections along the ridge (maxZ ${maxZ.toFixed(3)})`);
  console.log("        z    |x| at eave   ridge y     y at |x|=0.5*half");
  for (const z of [0, maxZ * 0.5, maxZ * 0.8, maxZ * 0.9, maxZ * 0.96, maxZ * 0.995]) {
    const cut = slice(roof, 2, z);
    if (cut.length === 0) { console.log(`    ${z.toFixed(2).padStart(6)}  (empty)`); continue; }
    let widest = 0;
    let ridge = -Infinity;
    let lowest = Infinity;
    for (const p of cut) {
      widest = Math.max(widest, Math.abs(p[0]!));
      ridge = Math.max(ridge, p[1]!);
      lowest = Math.min(lowest, p[1]!);
    }
    // The upper surface of the slope, sampled across the span.
    const surface: string[] = [];
    for (const f of [0.25, 0.5, 0.75, 1.0]) {
      const x = widest * f;
      let top = -Infinity;
      for (const p of cut) if (Math.abs(Math.abs(p[0]!) - x) < 0.12) top = Math.max(top, p[1]!);
      surface.push(`${f}:${top === -Infinity ? "-" : top.toFixed(3)}`);
    }
    console.log(`    ${z.toFixed(2).padStart(6)}  ${widest.toFixed(3).padStart(8)}  ${ridge.toFixed(3).padStart(9)}  ${lowest.toFixed(3).padStart(8)}   ${surface.join("  ")}`);
  }
  // Where does the roof cross a given height, at mid-span? That is the line a gable has to match.
  const mid = slice(roof, 2, 0);
  for (const y of [0, -0.2]) {
    let widest = 0;
    for (const t of roof) {
      for (let i = 0; i < 3; i += 1) {
        const a = t[i]!;
        const b = t[(i + 1) % 3]!;
        if (Math.abs(a[2]!) > 0.6 || Math.abs(b[2]!) > 0.6) continue;
        const da = a[1]! - y;
        const db = b[1]! - y;
        if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
        const f = da / (da - db);
        widest = Math.max(widest, Math.abs(a[0]! + (b[0]! - a[0]!) * f));
      }
    }
    console.log(`    the tile surface reaches |x| = ${widest.toFixed(3)} at y = ${y}`);
  }
  console.log(`    mid-span slice has ${mid.length} crossing points`);
}
