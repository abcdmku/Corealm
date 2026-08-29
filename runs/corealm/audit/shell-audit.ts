/**
 * "A house you can see through is not a house." Measures, for every (prefab, footprint, kit) the
 * three settlements actually author, the two ways a kit-bashed building leaks daylight:
 *
 *   1. RING COVERAGE. Each side of the ring is divided into `moduleCount` slots of `length/count`
 *      and a 2 m panel is dropped in each. When the slot is wider than the panel there is a
 *      full-height slot of daylight at every joint. Reported at the authored scale AND at the
 *      scale the game actually draws, which is `1 / tierSilhouetteScale(tier)` (world/
 *      regionBuilder.ts `emitParts`) - 1.111 at Coldbrace, 0.930 at Rootfall, 0.869 at Highcairn.
 *
 *   2. GABLE VOID. A tiled roof is a prism: the triangle between the wall head and the two slopes
 *      is open at both ends unless something closes it. Integrated numerically over the void.
 *
 *   npx tsx runs/corealm/audit/shell-audit.ts
 */
import { readFileSync } from "node:fs";
import {
  BUILDING_KITS, MODULE_METRES, STOREY_METRES,
  buildPrefab, buildWallRun, variantSeed,
  type KitId, type PartPlacement, type PrefabId,
} from "../../../game/src/render/buildings.js";
import { tierSilhouetteScale } from "../../../game/src/core/math.js";

interface ManifestAsset { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((a) => [a.id, a]));

interface Box { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
function drawnBox(part: PartPlacement, extra = 1): Box | null {
  const asset = byId.get(part.assetId);
  if (asset === undefined) return null;
  const s = part.scale * extra;
  const lo = { x: asset.base.x * s, y: asset.base.y * s, z: asset.base.z * s };
  const hi = { x: lo.x + asset.size.x * s, y: lo.y + asset.size.y * s, z: lo.z + asset.size.z * s };
  const cos = Math.cos(part.rotationY); const sin = Math.sin(part.rotationY);
  const box: Box = { minX: Infinity, maxX: -Infinity, minY: lo.y + part.dy, maxY: hi.y + part.dy, minZ: Infinity, maxZ: -Infinity };
  for (const x of [lo.x, hi.x]) {
    for (const z of [lo.z, hi.z]) {
      const wx = part.dx + x * cos + z * sin;
      const wz = part.dz - x * sin + z * cos;
      box.minX = Math.min(box.minX, wx); box.maxX = Math.max(box.maxX, wx);
      box.minZ = Math.min(box.minZ, wz); box.maxZ = Math.max(box.maxZ, wz);
    }
  }
  return box;
}

const problems: string[] = [];
const check = (ok: boolean, message: string): void => { if (!ok) problems.push(message); };

/** Exactly what the three settlements author, plus the tier each region draws at. */
const AUTHORED: { where: string; tier: number; kit: KitId; prefab: PrefabId; footprint: [number, number]; count: number }[] = [
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "cottage", footprint: [6, 4], count: 8 },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "hall", footprint: [12, 6], count: 1 },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "tower", footprint: [6, 6], count: 1 },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "forge", footprint: [6, 5], count: 1 },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "porch", footprint: [6, 3], count: 2 },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "porch", footprint: [4, 3], count: 1 },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "arcade", footprint: [8, 3], count: 1 },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "well", footprint: [2, 2], count: 1 },
  { where: "coldbrace", tier: 1, kit: "plaster", prefab: "gatehouse", footprint: [8, 3], count: 3 },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "cottage", footprint: [6, 4], count: 8 },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "shed", footprint: [4, 4], count: 1 },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "forge", footprint: [6, 4], count: 1 },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "arcade", footprint: [6, 3], count: 1 },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "porch", footprint: [6, 2.2], count: 1 },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "porch", footprint: [4, 2.2], count: 1 },
  { where: "rootfall", tier: 5, kit: "timber", prefab: "gatehouse", footprint: [8, 3], count: 3 },
  { where: "highcairn", tier: 10, kit: "stone", prefab: "quarry_hut", footprint: [5, 4], count: 6 },
  { where: "highcairn", tier: 10, kit: "stone", prefab: "forge", footprint: [6, 5], count: 1 },
  { where: "highcairn", tier: 10, kit: "stone", prefab: "porch", footprint: [4, 3], count: 1 },
  { where: "highcairn", tier: 10, kit: "stone", prefab: "arcade", footprint: [6, 3], count: 1 },
  { where: "highcairn", tier: 10, kit: "stone", prefab: "gatehouse", footprint: [8, 3], count: 2 },
];

const RING_PREFABS = new Set<PrefabId>(["cottage", "hall", "tower", "shed", "quarry_hut", "forge"]);
const n = (v: number): string => v.toFixed(3).padStart(7);

console.log("=== 1. ring coverage - is every side covered end to end?");
console.log("    'authored' is scale 1; 'drawn' is the 1/tierSilhouetteScale(tier) the game emits at.\n");
for (const a of AUTHORED) {
  if (!RING_PREFABS.has(a.prefab)) continue;
  const parts = buildPrefab(a.prefab, a.footprint, variantSeed(`${a.where}_${a.prefab}`), a.kit);
  const compensation = 1 / tierSilhouetteScale(a.tier);
  for (const [label, extra] of [["authored", 1], ["drawn", compensation]] as const) {
    // Group the ring panels by the side they face, then measure the union of their spans along
    // that side against the side's own run.
    const kit = BUILDING_KITS[a.kit];
    const cornerWidth = byId.get(kit.corner)!.size.x;
    const sides = new Map<string, { alongX: boolean; length: number; spans: [number, number][] }>();
    for (const part of parts) {
      // Panels, plus the joint studs, which are the kit corner on a CARDINAL yaw - the four
      // footprint corner posts sit on a diagonal, so the yaw tells them apart.
      const isPanel = part.assetId.startsWith("wall_") && !part.assetId.includes("trim")
        && part.assetId !== kit.frame;
      const cardinal = Math.abs(part.rotationY % (Math.PI / 2)) < 1e-3;
      const isStud = part.assetId === kit.corner && cardinal && part.dy < STOREY_METRES;
      if (!isPanel && !isStud) continue;
      const yaw = Math.round(part.rotationY / (Math.PI / 2)) * (Math.PI / 2);
      const key = yaw.toFixed(2);
      const alongX = Math.abs(Math.cos(yaw)) > 0.5;
      const length = alongX ? a.footprint[0] : a.footprint[1];
      const entry = sides.get(key) ?? { alongX, length, spans: [] };
      const centre = alongX ? part.dx : part.dz;
      const half = ((isPanel ? MODULE_METRES : cornerWidth) * part.scale * extra) / 2;
      entry.spans.push([centre - half, centre + half]);
      sides.set(key, entry);
    }
    let worstGap = 0; let worstWhere = ""; let worstEnd = 0;
    for (const [key, side] of sides) {
      const merged: [number, number][] = [];
      for (const span of [...side.spans].sort((p, q) => p[0] - q[0])) {
        const last = merged[merged.length - 1];
        if (last !== undefined && span[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], span[1]);
        else merged.push([span[0], span[1]]);
      }
      const need = side.length / 2;
      // The two ends are the footprint corners, which carry a diagonal `kit.corner` post that this
      // pass deliberately does not count as ring coverage; reported, not checked.
      worstEnd = Math.max(worstEnd, merged[0]![0] + need, need - merged[merged.length - 1]![1]);
      for (let i = 1; i < merged.length; i += 1) {
        const gap = merged[i]![0] - merged[i - 1]![1];
        if (gap > worstGap) { worstGap = gap; worstWhere = `yaw ${key}`; }
      }
    }
    const tag = `${a.where}/${a.prefab}[${a.footprint.join(",")}]`;
    console.log(`  ${tag.padEnd(34)} ${label.padEnd(8)} worst joint gap ${n(worstGap)} m  ${worstWhere.padEnd(9)}`
      + ` (corner shortfall ${n(Math.max(0, worstEnd))} m, taken by the corner post)`);
    check(worstGap < 1e-6, `${tag}: ${worstGap.toFixed(3)} m of daylight between panels at the ${label} scale`);
  }
}

console.log("\n=== 2. gable void - is the triangle between the wall head and the roof closed?");
// roof_gable_brick is a SOLID triangle (rasterised with gable-silhouette.mjs): its raking edges
// extrapolate to |x| = 3.35 at the pivot height and meet at y = 4.384 above it.
const GABLE_HALF_AT_BASE = 3.35;
const GABLE_APEX = 4.384;
for (const a of AUTHORED) {
  if (!RING_PREFABS.has(a.prefab)) continue;
  const parts = buildPrefab(a.prefab, a.footprint, variantSeed(`${a.where}_${a.prefab}`), a.kit);
  const roof = parts.find((p) => p.assetId.startsWith("roof_tiles") || p.assetId === "roof_tower");
  const tag = `${a.where}/${a.prefab}[${a.footprint.join(",")}]`;
  if (roof === undefined) { console.log(`  ${tag}: no tiled roof`); continue; }
  if (roof.assetId === "roof_tower") { console.log(`  ${tag}: hipped roof_tower, no gable`); continue; }
  const box = drawnBox(roof)!;
  const alongZ = box.maxZ - box.minZ > box.maxX - box.minX;
  const acrossHalf = (alongZ ? box.maxX - box.minX : box.maxZ - box.minZ) / 2;
  const gableSpan = alongZ ? a.footprint[0] : a.footprint[1];
  const wallTop = STOREY_METRES;
  const apexY = box.maxY; const eaveY = box.minY;
  const roofHalf = (y: number): number => Math.max(0, acrossHalf * (apexY - y) / (apexY - eaveY));
  const infills = parts.filter((p) => p.assetId === "roof_gable_brick");
  const gableHalf = (y: number): number => {
    let best = 0;
    for (const g of infills) {
      const top = g.dy + GABLE_APEX * g.scale;
      if (y > top) continue;
      best = Math.max(best, GABLE_HALF_AT_BASE * g.scale * (top - y) / (GABLE_APEX * g.scale));
    }
    return best;
  };
  let open = 0; const steps = 400;
  for (let i = 0; i < steps; i += 1) {
    const y = wallTop + ((i + 0.5) / steps) * (apexY - wallTop);
    open += 2 * Math.max(0, roofHalf(y) - gableHalf(y)) * ((apexY - wallTop) / steps);
  }
  console.log(`  ${tag.padEnd(34)} void ${n(apexY - wallTop)} m tall x ${n(2 * roofHalf(wallTop))} m wide,`
    + ` ${infills.length} infill, OPEN ${n(open)} m2/end (x2 x${a.count})`);
  check(open < 0.10, `${tag}: ${open.toFixed(2)} m2 of open gable per end (${(open * 2 * a.count).toFixed(1)} m2 across ${a.count} buildings)`);
  check(eaveY <= wallTop + 1e-6, `${tag}: eave sits ${(eaveY - wallTop).toFixed(3)} m ABOVE the wall head`);
  check(roofHalf(wallTop) >= gableSpan / 2 - 0.12,
    `${tag}: roof covers only ${roofHalf(wallTop).toFixed(2)} m of a ${(gableSpan / 2).toFixed(2)} m half-span at the wall head`);
  // The gable must stay inside the roof's own drawn box or it changes `roofOverhang`, which is the
  // number all three settlements spaced their buildings by.
  for (const g of infills) {
    const gb = drawnBox(g)!;
    check(gb.minX >= box.minX - 1e-3 && gb.maxX <= box.maxX + 1e-3
      && gb.minZ >= box.minZ - 1e-3 && gb.maxZ <= box.maxZ + 1e-3 && gb.maxY <= box.maxY + 1e-3,
      `${tag}: gable ${g.tag} sticks out of the roof box`);
  }
}

console.log("\n=== 3. wall runs - coverage, cap and variety");
const RUNS: { where: string; kit: KitId; length: number; openings: { at: number; width: number }[] }[] = [
  { where: "coldbrace_s", kit: "plaster", length: 52, openings: [{ at: 26, width: 8 }] },
  { where: "coldbrace_n", kit: "plaster", length: 52, openings: [] },
  { where: "rootfall_w", kit: "timber", length: 42, openings: [{ at: 22, width: 8 }] },
  { where: "rootfall_e", kit: "timber", length: 42, openings: [{ at: 6, width: 6 }, { at: 34, width: 8 }] },
  { where: "highcairn_s", kit: "stone", length: 40, openings: [] },
  { where: "highcairn_n", kit: "stone", length: 26, openings: [{ at: 16, width: 8 }] },
];
for (const run of RUNS) {
  const parts = buildWallRun(run.length, run.openings, BUILDING_KITS[run.kit], variantSeed(run.where));
  const panels = parts.filter((p) => p.assetId.startsWith("wall_") && !p.assetId.includes("trim")
    && p.assetId !== BUILDING_KITS[run.kit].frame);
  const spans = panels.map((p) => [p.dx - MODULE_METRES * p.scale / 2, p.dx + MODULE_METRES * p.scale / 2] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let gap = 0;
  for (let i = 1; i < spans.length; i += 1) {
    const d = spans[i]![0] - spans[i - 1]![1];
    // A gate opening is a gap on purpose; anything under one module is not.
    if (d > 1e-6 && d < MODULE_METRES) gap = Math.max(gap, d);
  }
  const assets = new Map<string, number>();
  for (const p of parts) assets.set(p.assetId, (assets.get(p.assetId) ?? 0) + 1);
  const cap = parts.filter((p) => p.dy >= STOREY_METRES - 0.45);
  console.log(`  ${run.where.padEnd(12)} L=${run.length} ${panels.length} panels, unintended gap ${n(gap)} m,`
    + ` ${cap.length} coping parts, ${assets.size} distinct assets`);
  console.log(`      ${[...assets].map(([k, v]) => `${k}x${v}`).join(" ")}`);
  check(gap < 1e-6, `${run.where}: ${gap.toFixed(3)} m gap between wall run panels`);
  check(cap.length >= panels.length, `${run.where}: ${cap.length} coping parts for ${panels.length} panels`);
  // Variety: one asset repeated on every module with one overlay on top of it is wallpaper at 50 m.
  const modal = Math.max(...panels.reduce((m, p) => m.set(p.assetId, (m.get(p.assetId) ?? 0) + 1), new Map<string, number>()).values());
  check(modal <= panels.length * 0.85 || panels.length < 4,
    `${run.where}: ${modal} of ${panels.length} panels are the same asset`);
}

console.log(`\n${problems.length === 0 ? "OK - no problems" : `${problems.length} PROBLEMS`}`);
for (const p of problems) console.log(`  ! ${p}`);
process.exitCode = problems.length === 0 ? 0 : 1;
