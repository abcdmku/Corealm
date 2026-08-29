/**
 * WHERE, IN METRES, YOU CAN SEE THROUGH A HOUSE - at the size the game actually draws it.
 *
 * bld-geometry.ts already fires rays through an assembled prefab, but it does two things that hide
 * the defect runs/corealm/screenshots/w4a-rootfall.png shows: it samples at the authored scale, and
 * it insets 0.15 m from each corner so a corner post's thickness is not mistaken for a wall. The
 * game draws every building part at `scale * (1 / tierSilhouetteScale(tier))` on UNSCALED centres
 * (world/regionBuilder.ts `emitParts`), so at Rootfall a 2 m panel is 1.860 m and the corner is
 * exactly where the shortfall lands.
 *
 * This one applies that compensation, samples the whole side including the corners, and prints the
 * offset of every open column rather than a percentage - so the answer is "0.21 m of daylight at
 * x = +-2.93", which names the part to fix.
 *
 *   npx tsx runs/corealm/audit/w4-leak.ts [prefab ...]
 */
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import {
  STOREY_METRES, buildPrefab, variantSeed,
  type KitId, type PartPlacement, type PrefabId,
} from "../../../game/src/render/buildings.js";
import { tierSilhouetteScale } from "../../../game/src/core/math.js";

interface ManifestAsset { id: string; file: string }
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: ManifestAsset[] };
const srcById = new Map(manifest.assets.map((a) => [a.id, a.file]));
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);

/** A triangle plus its world bbox, so a cast can reject most of a building before any arithmetic. */
interface Tri { p: number[][]; loX: number; hiX: number; loY: number; hiY: number; loZ: number; hiZ: number }
const triCache = new Map<string, number[][][]>();

function mul(m: number[], v: number[]): number[] {
  return [
    m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
    m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
    m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
  ];
}

async function trianglesOf(assetId: string): Promise<number[][][]> {
  const cached = triCache.get(assetId);
  if (cached !== undefined) return cached;
  const src = srcById.get(assetId);
  if (src === undefined) throw new Error(`asset ${assetId} is not in the manifest`);
  const doc = await io.read(`game/public/assets/${src}`);
  const tris: number[][][] = [];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (mesh === null) return;
      const world = node.getWorldMatrix() as unknown as number[];
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (pos === null) continue;
        const indices = prim.getIndices();
        const count = indices === null ? pos.getCount() : indices.getCount();
        const el = [0, 0, 0];
        const at = (i: number): number[] => {
          pos.getElement(indices === null ? i : indices.getScalar(i), el);
          return mul(world, el);
        };
        for (let i = 0; i + 2 < count; i += 3) tris.push([at(i), at(i + 1), at(i + 2)]);
      }
    });
  }
  triCache.set(assetId, tris);
  return tris;
}

function place(part: PartPlacement, extra: number, tris: number[][][], out: Tri[]): void {
  const cos = Math.cos(part.rotationY);
  const sin = Math.sin(part.rotationY);
  const s = part.scale * extra;
  for (const t of tris) {
    const p: number[][] = [];
    let loX = Infinity; let hiX = -Infinity;
    let loY = Infinity; let hiY = -Infinity;
    let loZ = Infinity; let hiZ = -Infinity;
    for (const v of t) {
      const x = v[0]! * s; const y = v[1]! * s; const z = v[2]! * s;
      const w = [part.dx + x * cos + z * sin, part.dy + y, part.dz - x * sin + z * cos];
      p.push(w);
      loX = Math.min(loX, w[0]!); hiX = Math.max(hiX, w[0]!);
      loY = Math.min(loY, w[1]!); hiY = Math.max(hiY, w[1]!);
      loZ = Math.min(loZ, w[2]!); hiZ = Math.max(hiZ, w[2]!);
    }
    out.push({ p, loX, hiX, loY, hiY, loZ, hiZ });
  }
}

/** Crossings of the infinite horizontal line along `axis` (0 = X, 2 = Z) at offset `u`, height `y`. */
function crossings(tris: readonly Tri[], axis: 0 | 2, u: number, y: number): number {
  const a = axis === 0 ? 2 : 0;
  let hits = 0;
  for (const t of tris) {
    if (y < t.loY || y > t.hiY) continue;
    if (axis === 0 ? (u < t.loZ || u > t.hiZ) : (u < t.loX || u > t.hiX)) continue;
    const x0 = t.p[0]![a]!; const y0 = t.p[0]![1]!;
    const x1 = t.p[1]![a]!; const y1 = t.p[1]![1]!;
    const x2 = t.p[2]![a]!; const y2 = t.p[2]![1]!;
    const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(d) < 1e-12) continue;
    const l0 = ((y1 - y2) * (u - x2) + (x2 - x1) * (y - y2)) / d;
    const l1 = ((y2 - y0) * (u - x2) + (x0 - x2) * (y - y2)) / d;
    const l2 = 1 - l0 - l1;
    if (l0 >= 0 && l1 >= 0 && l2 >= 0) hits += 1;
  }
  return hits;
}

/** Exactly what the three settlements author, with the tier each region draws at. */
const AUTHORED: { where: string; tier: number; kit: KitId; prefab: PrefabId; footprint: [number, number] }[] = [
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "cottage", footprint: [6, 4] },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "hall", footprint: [12, 6] },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "tower", footprint: [6, 6] },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "forge", footprint: [6, 5] },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "cottage", footprint: [6, 4] },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "shed", footprint: [4, 4] },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "forge", footprint: [6, 4] },
  { where: "highcairn", tier: 10, kit: "stone", prefab: "quarry_hut", footprint: [5, 4] },
  { where: "highcairn", tier: 10, kit: "stone", prefab: "forge", footprint: [6, 5] },
];

/** Which casts have to be closed. `forge` is open on +Z on purpose, so only the X cast counts. */
const CLOSED: Partial<Record<PrefabId, ("x" | "z")[]>> = {
  cottage: ["x", "z"], hall: ["x", "z"], tower: ["x", "z"], shed: ["x", "z"], quarry_hut: ["x", "z"],
  forge: ["x"],
};

const only = process.argv.slice(2);
const problems: string[] = [];

console.log("=== open columns at the DRAWN scale, corners included");
console.log("    a column is open when a horizontal ray at that offset crosses < 2 surfaces at");
console.log("    every sampled height. Offsets are metres from the footprint centre.\n");

for (const a of AUTHORED) {
  if (only.length > 0 && !only.includes(a.prefab)) continue;
  const compensation = 1 / tierSilhouetteScale(a.tier);
  const parts = buildPrefab(a.prefab, a.footprint, variantSeed(`${a.where}_${a.prefab}`), a.kit);
  const tris: Tri[] = [];
  for (const part of parts) {
    if (part.assetId.startsWith("roof_") || part.assetId === "chimney") continue;
    place(part, compensation, await trianglesOf(part.assetId), tris);
  }
  const [w, d] = a.footprint;
  const tag = `${a.where}/${a.prefab}[${w},${d}]`;
  for (const axis of [0, 2] as const) {
    const span = axis === 0 ? d : w;
    const label = axis === 0 ? "X" : "Z";
    // 0.02 m columns across the full side, so a 0.07 m shortfall cannot fall between samples.
    const step = 0.02;
    const from = -span / 2 - 0.3;
    const cols = Math.round((span + 0.6) / step);
    const open: number[] = [];
    let leaked = 0;
    let sampled = 0;
    for (let i = 0; i < cols; i += 1) {
      const u = from + (i + 0.5) * step;
      let holes = 0;
      // Over the plinth and under the DRAWN wall head, which is `STOREY_METRES * compensation` and
      // not STOREY_METRES: at Highcairn the ring is only 2.714 m tall. Above that is the eaves band
      // this file cannot close (see the header note on emitParts), and the roof is excluded from
      // the triangle set, so sampling up there would report the band rather than the walls.
      for (let j = 0; j < 12; j += 1) {
        const y = 0.35 + (j / 11) * (STOREY_METRES * compensation - 0.47);
        sampled += 1;
        if (crossings(tris, axis, u, y) < 2) { holes += 1; leaked += 1; }
      }
      if (holes > 0) open.push(u);
    }
    // Merge adjacent open columns into runs, and drop anything outside the footprint, which is
    // open air rather than a hole in a wall.
    const runs: [number, number][] = [];
    for (const u of open) {
      if (Math.abs(u) > span / 2 + 0.05) continue;
      const last = runs[runs.length - 1];
      if (last !== undefined && u - last[1] < step * 1.5) last[1] = u;
      else runs.push([u, u]);
    }
    const widest = runs.reduce((m, r) => Math.max(m, r[1] - r[0] + step), 0);
    const shown = runs.map((r) => `${r[0].toFixed(2)}..${r[1].toFixed(2)} (${(r[1] - r[0] + step).toFixed(2)} m)`);
    console.log(`  ${tag.padEnd(30)} through ${label}: ${runs.length} slot(s), widest ${widest.toFixed(3)} m,`
      + ` ${((leaked / sampled) * 100).toFixed(1)}% of the elevation`
      + (shown.length > 0 ? `  [${shown.join(", ")}]` : ""));
    if ((CLOSED[a.prefab] ?? []).includes(label.toLowerCase() as "x" | "z") && widest > 0.05) {
      problems.push(`${tag}: ${widest.toFixed(3)} m slot through ${label} at the drawn scale`);
    }
  }
}

console.log("\n=== the eaves band: STOREY_METRES * compensation up to STOREY_METRES");
console.log("    the wall head stops below the gable base at every tier but Coldbrace. On the two");
console.log("    eave sides the tiles cover the band; along the ridge the roof prism is open at");
console.log("    both ends, so that cast is the letterbox. Roofs INCLUDED here.\n");

for (const a of AUTHORED) {
  if (only.length > 0 && !only.includes(a.prefab)) continue;
  const compensation = 1 / tierSilhouetteScale(a.tier);
  const head = STOREY_METRES * compensation;
  if (head >= STOREY_METRES) {
    console.log(`  ${`${a.where}/${a.prefab}[${a.footprint.join(",")}]`.padEnd(30)} wall head ${head.toFixed(3)} m is at or above the gable base, no band`);
    continue;
  }
  const parts = buildPrefab(a.prefab, a.footprint, variantSeed(`${a.where}_${a.prefab}`), a.kit);
  const tris: Tri[] = [];
  for (const part of parts) {
    // `W4_NO_PLATE=1` drops the eaves plate, which is how the before/after on this band was taken.
    if (process.env.W4_NO_PLATE === "1" && part.tag.startsWith("plate")) continue;
    place(part, compensation, await trianglesOf(part.assetId), tris);
  }
  const [w, d] = a.footprint;
  const tag = `${a.where}/${a.prefab}[${w},${d}]`;
  let worst = 0;
  let worstLabel = "";
  for (const axis of [0, 2] as const) {
    const span = axis === 0 ? d : w;
    const label = axis === 0 ? "X" : "Z";
    const step = 0.05;
    const cols = Math.round(span / step);
    let openCols = 0;
    for (let i = 0; i < cols; i += 1) {
      const u = -span / 2 + (i + 0.5) * step;
      for (let j = 0; j < 6; j += 1) {
        const y = head + ((j + 0.5) / 6) * (STOREY_METRES - head);
        if (crossings(tris, axis, u, y) < 2) { openCols += 1; break; }
      }
    }
    const fraction = openCols / cols;
    console.log(`  ${tag.padEnd(30)} band ${(STOREY_METRES - head).toFixed(3)} m tall,`
      + ` through ${label}: ${(fraction * 100).toFixed(1)}% of the width open`);
    if (fraction > worst) { worst = fraction; worstLabel = label; }
  }
  if (worst > 0.15) {
    problems.push(`${tag}: ${(worst * 100).toFixed(0)}% of the eaves band is open through ${worstLabel}`);
  }
}

console.log(`\n${problems.length === 0 ? "OK - no open columns" : `${problems.length} PROBLEMS`}`);
for (const p of problems) console.log(`  ! ${p}`);
process.exitCode = problems.length === 0 ? 0 : 1;
