/**
 * Where exactly does a gable break through its own roof?
 *
 * Prints the assembled cross-section of one prefab: the roof's tile surface and the gable's
 * outline, both measured off placed triangles, so the fit constants can be corrected against
 * numbers instead of against a rasterised silhouette.
 *
 *   npx tsx runs/corealm/audit/sp/probe-fit.ts cottage 6 4 plaster
 */
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import {
  buildPrefab, type KitId, type PartPlacement, type PrefabId,
} from "../../../../game/src/render/buildings.js";

interface ManifestAsset { id: string; file: string }
const manifest = JSON.parse(
  readFileSync("game/public/assets/manifest.json", "utf8"),
) as { assets: ManifestAsset[] };
const fileById = new Map(manifest.assets.map((a) => [a.id, a.file]));
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);

type Vec = [number, number, number];
type Tri = readonly [Vec, Vec, Vec];
const cache = new Map<string, Tri[]>();

function mul(m: readonly number[], v: readonly number[]): Vec {
  return [
    m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
    m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
    m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
  ];
}

async function trianglesOf(assetId: string): Promise<Tri[]> {
  const hit = cache.get(assetId);
  if (hit) return hit;
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
  cache.set(assetId, tris);
  return tris;
}

function placed(part: PartPlacement, tris: readonly Tri[]): Tri[] {
  const cos = Math.cos(part.rotationY);
  const sin = Math.sin(part.rotationY);
  const ax = (part.scaleAxes?.[0] ?? 1) * part.scale;
  const ay = (part.scaleAxes?.[1] ?? 1) * part.scale;
  const az = (part.scaleAxes?.[2] ?? 1) * part.scale;
  const map = (p: Vec): Vec => {
    const x = p[0] * ax;
    const y = p[1] * ay;
    const z = p[2] * az;
    return [part.dx + x * cos + z * sin, part.dy + y, part.dz - x * sin + z * cos];
  };
  return tris.map((t) => [map(t[0]), map(t[1]), map(t[2])] as Tri);
}

/** Highest surface of `tris` above (x, z), or null. */
function surfaceAt(tris: readonly Tri[], x: number, z: number): number | null {
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

const prefab = (process.argv[2] ?? "cottage") as PrefabId;
const width = Number(process.argv[3] ?? 6);
const depth = Number(process.argv[4] ?? 4);
const kit = (process.argv[5] ?? "plaster") as KitId;
const parts = buildPrefab(prefab, [width, depth], 0, kit);

const roofTris: Tri[] = [];
const gables: { part: PartPlacement; tris: Tri[] }[] = [];
for (const part of parts) {
  const base = await trianglesOf(part.assetId);
  if (/^roof_tiles_/.test(part.assetId)) roofTris.push(...placed(part, base));
  if (part.assetId === "roof_gable_brick") gables.push({ part, tris: placed(part, base) });
}
console.log(`${prefab} [${width},${depth}] ${kit}: ${parts.length} parts, ${gables.length} gables`);

for (const gable of gables) {
  console.log(`\n  gable ${gable.part.tag} at (${gable.part.dx}, ${gable.part.dy}, ${gable.part.dz})`
    + ` yaw ${gable.part.rotationY.toFixed(4)} axes ${JSON.stringify(gable.part.scaleAxes)}`);
  let worst = 0;
  let worstAt: Vec = [0, 0, 0];
  let worstRoof = 0;
  for (const t of gable.tris) {
    for (const p of t) {
      const roofY = surfaceAt(roofTris, p[0], p[2]);
      if (roofY === null) {
        console.log(`    OUTSIDE roof at (${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)})`);
        continue;
      }
      if (p[1] - roofY > worst) { worst = p[1] - roofY; worstAt = p; worstRoof = roofY; }
    }
  }
  console.log(`    worst proud ${worst.toFixed(4)} m at (${worstAt[0].toFixed(3)}, ${worstAt[1].toFixed(3)},`
    + ` ${worstAt[2].toFixed(3)}); roof surface there is ${worstRoof.toFixed(3)}`);

  // Print the paired profiles across the gable's own span.
  const alongZ = Math.abs(Math.cos(gable.part.rotationY)) > 0.5;
  console.log("      across    gable top    roof top   delta");
  for (let f = -1; f <= 1.0001; f += 0.125) {
    const across = f * 4;
    const x = alongZ ? across : gable.part.dx;
    const z = alongZ ? gable.part.dz : across;
    const g = surfaceAt(gable.tris, x, z);
    const r = surfaceAt(roofTris, x, z);
    console.log(`      ${across.toFixed(2).padStart(6)}  ${(g === null ? "-" : g.toFixed(3)).padStart(10)}`
      + `  ${(r === null ? "-" : r.toFixed(3)).padStart(10)}`
      + `  ${(g !== null && r !== null ? (g - r).toFixed(3) : "-").padStart(7)}`);
  }
}
