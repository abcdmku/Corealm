/**
 * Scratch audit for render/buildings.ts. Nothing in the game calls the new prefabs yet, so this is
 * the only way to see them: assemble each one, turn every part into a real drawn AABB using the
 * manifest's own size/base, and check the arithmetic.
 *
 *   npx tsx runs/corealm/audit/buildings-audit.ts
 */
import { readFileSync } from "node:fs";
import {
  BUILDING_KITS, GATE_GAP_METRES, MODULE_METRES, PREFAB_IDS, STOREY_METRES,
  buildComposition, buildPrefab, buildWallRun, compositionPartAssetIds, prefabCollision,
  prefabHeight, prefabPartAssetIds, variantSeed, wallRunCollision,
  type BuildingKit, type KitId, type PartPlacement, type PrefabBox, type PrefabId,
} from "../../../game/src/render/buildings.js";

interface ManifestAsset {
  id: string;
  size: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
}
const manifest = JSON.parse(
  readFileSync("game/public/assets/manifest.json", "utf8"),
) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((a) => [a.id, a]));

interface Box { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

function drawnBox(part: PartPlacement): Box | null {
  const asset = byId.get(part.assetId);
  if (asset === undefined) return null;
  const s = part.scale;
  const lo = { x: asset.base.x * s, y: asset.base.y * s, z: asset.base.z * s };
  const hi = { x: lo.x + asset.size.x * s, y: lo.y + asset.size.y * s, z: lo.z + asset.size.z * s };
  const cos = Math.cos(part.rotationY);
  const sin = Math.sin(part.rotationY);
  const box: Box = {
    minX: Infinity, maxX: -Infinity, minY: lo.y + part.dy, maxY: hi.y + part.dy,
    minZ: Infinity, maxZ: -Infinity,
  };
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
function check(ok: boolean, message: string): void {
  if (!ok) problems.push(message);
}
const n = (v: number): string => v.toFixed(2).padStart(7);

// ------------------------------------------------------------------ prefabs

const probes: { prefab: PrefabId; footprint: [number, number]; kits: KitId[] }[] = [
  { prefab: "forge", footprint: [6, 5], kits: ["plaster", "timber", "stone"] },
  { prefab: "forge", footprint: [4, 4], kits: ["plaster"] },
  { prefab: "porch", footprint: [4, 3], kits: ["plaster", "stone"] },
  { prefab: "porch", footprint: [6, 2.4], kits: ["timber"] },
  { prefab: "arcade", footprint: [6, 3], kits: ["plaster", "stone"] },
  { prefab: "market_row", footprint: [9, 3], kits: ["plaster"] },
  { prefab: "well", footprint: [2, 2], kits: ["plaster", "stone"] },
  { prefab: "gatehouse", footprint: [8, 3], kits: ["plaster", "stone"] },
  { prefab: "gatehouse", footprint: [6, 3], kits: ["stone"] },
  { prefab: "cottage", footprint: [6, 4], kits: ["plaster"] },
];

for (const probe of probes) {
  for (const kitId of probe.kits) {
    const seed = variantSeed(`${probe.prefab}_${probe.footprint.join("x")}_${kitId}`);
    const parts = buildPrefab(probe.prefab, probe.footprint, seed, kitId);
    const boxes = prefabCollision(probe.prefab, probe.footprint);
    const [w, d] = probe.footprint;
    console.log(`\n=== ${probe.prefab} [${w},${d}] kit ${kitId} — ${parts.length} parts`);

    // Duplicate placements: two parts at the same pose with the same asset is a double draw.
    const seen = new Map<string, string>();
    const tags = new Set<string>();
    let solidMinX = Infinity, solidMaxX = -Infinity, solidMinZ = Infinity, solidMaxZ = -Infinity;
    let roofTop = -Infinity, wallTop = -Infinity;
    for (const part of parts) {
      check(!tags.has(part.tag), `${probe.prefab}/${kitId}: duplicate tag ${part.tag}`);
      tags.add(part.tag);
      const key = `${part.assetId}@${part.dx},${part.dy},${part.dz}/${part.rotationY}`;
      const clash = seen.get(key);
      check(clash === undefined, `${probe.prefab}/${kitId}: ${part.tag} duplicates ${clash ?? ""} (${key})`);
      seen.set(key, part.tag);
      const box = drawnBox(part);
      check(box !== null, `${probe.prefab}/${kitId}: ${part.tag} names unknown asset ${part.assetId}`);
      if (box === null) continue;
      const isRoof = part.assetId.startsWith("roof") || part.assetId.startsWith("overhang");
      // Fittings project past the footprint by design: lamp_wall hangs its lantern 1.30 m out from
      // its mounting point and banner_1's cloth is 1.61 m wide. Both predate this pass.
      const isFitting = isRoof || part.assetId === "chimney" || part.assetId.startsWith("banner")
        || part.assetId === "lamp_wall" || part.assetId === "support_beam"
        || part.assetId === "torch" || part.assetId === "vine_1"
        || part.assetId.startsWith("crate") || part.assetId === "market_stall"
        || part.assetId === "kerb_straight" || part.assetId === "barrel"
        || part.assetId === "sack" || part.assetId === "bucket_wood"
        || part.assetId === "chain_coil";
      if (isRoof) roofTop = Math.max(roofTop, box.maxY);
      if (isFitting) { /* not part of the structural extent */ }
      else {
        solidMinX = Math.min(solidMinX, box.minX); solidMaxX = Math.max(solidMaxX, box.maxX);
        solidMinZ = Math.min(solidMinZ, box.minZ); solidMaxZ = Math.max(solidMaxZ, box.maxZ);
        if (part.assetId.startsWith("wall_") && !part.assetId.includes("trim")) {
          wallTop = Math.max(wallTop, box.maxY);
        }
      }
      check(box.minY > -1.3, `${probe.prefab}/${kitId}: ${part.tag} sinks to y ${box.minY.toFixed(2)}`);
    }
    console.log(`  non-roof extent x[${n(solidMinX)},${n(solidMaxX)}] z[${n(solidMinZ)},${n(solidMaxZ)}]`
      + `   footprint x±${(w / 2).toFixed(2)} z±${(d / 2).toFixed(2)}`);
    console.log(`  wall top ${wallTop.toFixed(3)}   roof/canopy top ${roofTop.toFixed(3)}`);
    if (roofTop > -Infinity && wallTop > -Infinity) {
      check(roofTop > wallTop, `${probe.prefab}/${kitId}: roof apex ${roofTop} is not above wall top ${wallTop}`);
    }
    // Walls stand 0.093 m proud of the footprint face and corner_brick's pivot is 0.353 off its own
    // centre, so a stone corner post reaches 0.52 m past the footprint corner. Pre-existing.
    const slack = 0.55;
    if (probe.prefab !== "porch" && probe.prefab !== "arcade" && probe.prefab !== "well") {
      check(solidMaxX <= w / 2 + slack && solidMinX >= -w / 2 - slack,
        `${probe.prefab}/${kitId}: solid parts overrun the footprint in X`);
      check(solidMaxZ <= d / 2 + slack && solidMinZ >= -d / 2 - slack,
        `${probe.prefab}/${kitId}: solid parts overrun the footprint in Z`);
    }

    for (const box of boxes) {
      const half = Math.hypot(box.sizeX, box.sizeZ) / 2;
      console.log(`  box ${box.tag.padEnd(7)} centre(${n(box.dx)},${n(box.dz)}) size ${n(box.sizeX)} x ${n(box.sizeZ)} h ${n(box.height)} halfDiag ${half.toFixed(2)}`);
      check(box.sizeX > 0 && box.sizeZ > 0, `${probe.prefab}: box ${box.tag} has a non-positive extent`);
    }
    check(boxes.every((b) => b.height <= prefabHeight(probe.prefab) + 1e-9),
      `${probe.prefab}: a collision box is taller than prefabHeight`);
  }
}

// --------------------------------------------------------------- the gate

console.log("\n=== gate clearance");
for (const width of [6, 8, 10, 12]) {
  const boxes = prefabCollision("gatehouse", [width, 3]);
  const left = boxes.find((b) => b.tag === "pier_l")!;
  const right = boxes.find((b) => b.tag === "pier_r")!;
  const collidedGap = (right.dx - right.sizeX / 2) - (left.dx + left.sizeX / 2);
  const parts = buildPrefab("gatehouse", [width, 3], 7, "stone");
  // Drawn clearance at head height: the innermost edge of any part below y = STOREY_METRES.
  let innerLeft = -Infinity, innerRight = Infinity;
  for (const part of parts) {
    const box = drawnBox(part);
    if (box === null || box.minY > STOREY_METRES - 0.2) continue;
    if (box.maxX <= 0) innerLeft = Math.max(innerLeft, box.maxX);
    if (box.minX >= 0) innerRight = Math.min(innerRight, box.minX);
  }
  const drawnGap = innerRight - innerLeft;
  console.log(`  width ${width}: collided gap ${collidedGap.toFixed(3)} m, drawn gap ${drawnGap.toFixed(3)} m`);
  check(Math.abs(collidedGap - drawnGap) < 0.25,
    `gatehouse ${width}: collided gap ${collidedGap} vs drawn gap ${drawnGap}`);
  if (width >= 8) {
    check(collidedGap >= GATE_GAP_METRES - 1e-6,
      `gatehouse ${width}: collided gap ${collidedGap} below GATE_GAP_METRES`);
  }
  // Headroom: nothing drawn across the gap below one storey.
  const blockers = parts.filter((p) => {
    const box = drawnBox(p);
    return box !== null && box.minY < STOREY_METRES - 0.2 && box.maxX > -drawnGap / 2 + 0.1
      && box.minX < drawnGap / 2 - 0.1;
  });
  check(blockers.length === 0, `gatehouse ${width}: ${blockers.map((b) => b.tag).join(",")} stand in the gap`);
  // And the gap IS covered above the passage, or the gate is a hole in the skyline.
  const head = parts.filter((p) => p.tag.startsWith("hf_"));
  check(head.length > 0, `gatehouse ${width}: no head course over the gap`);
  const headSpan = head.reduce((acc, p) => {
    const box = drawnBox(p)!;
    return { lo: Math.min(acc.lo, box.minX), hi: Math.max(acc.hi, box.maxX) };
  }, { lo: Infinity, hi: -Infinity });
  console.log(`    head course covers x[${headSpan.lo.toFixed(2)},${headSpan.hi.toFixed(2)}] over a ${drawnGap.toFixed(2)} m gap`);
  check(headSpan.hi - headSpan.lo >= drawnGap - 1e-6, `gatehouse ${width}: head course narrower than the gap`);
}

// ------------------------------------------------------------- wall runs

console.log("\n=== wall runs");
const runProbes: { length: number; openings: { at: number; width: number }[] }[] = [
  { length: 52, openings: [] },
  { length: 52, openings: [{ at: 26, width: 8 }] },
  { length: 34, openings: [{ at: 8, width: 4 }, { at: 26, width: 6 }] },
  { length: 42, openings: [{ at: 0, width: 4 }, { at: 42, width: 4 }] },
];
for (const probe of runProbes) {
  const kit: BuildingKit = BUILDING_KITS.plaster;
  const parts = buildWallRun(probe.length, probe.openings, kit, variantSeed(`run${probe.length}`));
  const boxes = wallRunCollision(probe.length, probe.openings);
  const panels = parts.filter((p) => p.assetId.startsWith("wall_") && !p.assetId.includes("trim"));
  const trims = parts.filter((p) => p.assetId === "wall_bottom_trim" && p.dy === 0);
  const posts = parts.filter((p) => p.assetId === kit.corner);
  let minX = Infinity, maxX = -Infinity, maxAbsZ = 0;
  for (const part of parts) {
    const box = drawnBox(part)!;
    minX = Math.min(minX, box.minX); maxX = Math.max(maxX, box.maxX);
    maxAbsZ = Math.max(maxAbsZ, Math.abs(box.minZ), Math.abs(box.maxZ));
  }
  const built = boxes.reduce((sum, b) => sum + b.sizeX, 0);
  console.log(`  L=${probe.length} openings=${JSON.stringify(probe.openings)}`);
  console.log(`    ${panels.length} panels, ${trims.length} trims, ${posts.length} posts, ${boxes.length} boxes,`
    + ` ${built.toFixed(1)} m built of ${probe.length} m`);
  console.log(`    parts span x[${minX.toFixed(3)},${maxX.toFixed(3)}], |z| max ${maxAbsZ.toFixed(3)}`);
  console.log(`    spans ${boxes.map((b) => `[${(b.dx - b.sizeX / 2).toFixed(1)},${(b.dx + b.sizeX / 2).toFixed(1)}]`).join(" ")}`);
  check(panels.length === trims.length, `run ${probe.length}: ${panels.length} panels but ${trims.length} trims`);
  check(minX >= -0.4, `run ${probe.length}: a part starts before 0 (${minX})`);
  check(maxX <= probe.length + 0.4, `run ${probe.length}: a part ends past the length (${maxX})`);
  // Only the part of an opening that lies inside the run can remove wall.
  const removed = probe.openings.reduce((sum, o) => sum
    + Math.max(0, Math.min(probe.length, o.at + o.width / 2) - Math.max(0, o.at - o.width / 2)), 0);
  check(built <= probe.length + 1e-6, `run ${probe.length}: built more wall than the run is long`);
  check(probe.length - built >= removed - 1e-6 || probe.openings.length === 0,
    `run ${probe.length}: openings did not remove at least ${removed} m`);
  for (const box of boxes) {
    check(box.dx - box.sizeX / 2 >= -1e-6 && box.dx + box.sizeX / 2 <= probe.length + 1e-6,
      `run ${probe.length}: box ${box.tag} leaves the run`);
    check(box.sizeZ === 0.5, `run ${probe.length}: box ${box.tag} is not 0.5 m thick`);
  }
  // Each span's ends must carry a post.
  for (const box of boxes) {
    for (const end of [box.dx - box.sizeX / 2, box.dx + box.sizeX / 2]) {
      check(posts.some((p) => Math.abs(p.dx - end) < 0.02),
        `run ${probe.length}: no jamb post at ${end.toFixed(2)}`);
    }
  }
}

// determinism
const a = buildWallRun(52, [{ at: 26, width: 8 }], BUILDING_KITS.timber, 4242);
const b = buildWallRun(52, [{ at: 26, width: 8 }], BUILDING_KITS.timber, 4242);
check(JSON.stringify(a) === JSON.stringify(b), "buildWallRun is not deterministic");

// ---------------------------------------------------------- compositions

console.log("\n=== compositions");
for (const id of ["bank_counter", "forge_yard", "market_pitch", "wood_pile", "garden"] as const) {
  for (const kit of ["plaster", "stone"] as const) {
    const parts = buildComposition(id, variantSeed(id), kit);
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const part of parts) {
      const box = drawnBox(part);
      check(box !== null, `${id}/${kit}: unknown asset ${part.assetId}`);
      if (box === null) continue;
      minY = Math.min(minY, box.minY); maxY = Math.max(maxY, box.maxY);
      minX = Math.min(minX, box.minX); maxX = Math.max(maxX, box.maxX);
      minZ = Math.min(minZ, box.minZ); maxZ = Math.max(maxZ, box.maxZ);
    }
    console.log(`  ${id.padEnd(13)} ${kit.padEnd(8)} ${String(parts.length).padStart(2)} parts`
      + ` x[${n(minX)},${n(maxX)}] y[${n(minY)},${n(maxY)}] z[${n(minZ)},${n(maxZ)}]`);
    check(minY > -0.35, `${id}/${kit}: something is buried at y ${minY.toFixed(2)}`);
  }
}

// -------------------------------------------------------------- manifest

const missingPrefab = prefabPartAssetIds().filter((id) => !byId.has(id));
const missingComposition = compositionPartAssetIds().filter((id) => !byId.has(id));
check(missingPrefab.length === 0, `prefab asset ids not in the manifest: ${missingPrefab.join(", ")}`);
check(missingComposition.length === 0, `composition asset ids not in the manifest: ${missingComposition.join(", ")}`);
console.log(`\nprefabPartAssetIds(): ${prefabPartAssetIds().length} ids, all in the manifest`);
console.log(`compositionPartAssetIds(): ${compositionPartAssetIds().length} ids, all in the manifest`);
console.log(`PREFAB_IDS covers ${PREFAB_IDS.length}; MODULE_METRES ${MODULE_METRES}; GATE_GAP_METRES ${GATE_GAP_METRES}`);

// -------------------------------------------------------------- verdict

console.log(`\n${problems.length === 0 ? "OK — no problems" : `${problems.length} PROBLEMS`}`);
for (const problem of problems) console.log(`  ! ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;

export type { PrefabBox };
