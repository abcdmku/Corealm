/**
 * Offline geometry audit for the re-authored Rootfall. Not a test: a measuring stick used while
 * the layout was being placed, kept so the numbers in the file header can be re-derived.
 */
import { REGIONS, validateRegions } from "../../../game/src/content/regions.js";
import {
  BUILDING_KITS, MODULE_METRES, buildPrefab, prefabCollision, roofOverhang, variantSeed,
} from "../../../game/src/render/buildings.js";
import { ROOTFALL } from "../../../game/src/content/settlements/rootfall.js";

const problems = validateRegions();
console.log("validateRegions():", problems.length === 0 ? "[]" : problems);

type Box = { id: string; minX: number; maxX: number; minZ: number; maxZ: number };
const rot = (dx: number, dz: number, y: number): [number, number] =>
  [dx * Math.cos(y) + dz * Math.sin(y), -dx * Math.sin(y) + dz * Math.cos(y)];

// Footprint AABBs.
const foot: Box[] = ROOTFALL.buildings.map((b) => {
  const [hw, hd] = [b.footprint[0] / 2, b.footprint[1] / 2];
  const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => rot(x, z, b.rotationY));
  return {
    id: b.id,
    minX: b.position[0] + Math.min(...pts.map((p) => p[0])),
    maxX: b.position[0] + Math.max(...pts.map((p) => p[0])),
    minZ: b.position[1] + Math.min(...pts.map((p) => p[1])),
    maxZ: b.position[1] + Math.max(...pts.map((p) => p[1])),
  };
});
// Roof AABBs from the real per-axis overhang, which is prefab-, footprint- and kit-specific:
// ROOF_EAVE_METRES 1.73 is only the worst case in the game.
const roof: Box[] = foot.map((f, i) => {
  const b = ROOTFALL.buildings[i]!;
  const o = roofOverhang(b.prefab, b.footprint, ROOTFALL.kit);
  // The overhang is in the building's own frame; a quarter turn swaps the axes.
  const quarter = Math.abs(Math.cos(b.rotationY)) < 0.5;
  const ex = quarter ? o.z : o.x;
  const ez = quarter ? o.x : o.z;
  return { id: f.id, minX: f.minX - ex, maxX: f.maxX + ex, minZ: f.minZ - ez, maxZ: f.maxZ + ez };
});
for (const b of ROOTFALL.buildings) {
  const o = roofOverhang(b.prefab, b.footprint, ROOTFALL.kit);
  console.log(`overhang ${b.id} (${b.prefab} ${b.footprint.join("x")}): x ${o.x} z ${o.z}`);
}
let worst = { a: "", b: "", ox: 0, oz: 0 };
for (let i = 0; i < roof.length; i += 1) {
  for (let j = i + 1; j < roof.length; j += 1) {
    const a = roof[i]!; const b = roof[j]!;
    const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    if (ox > 0 && oz > 0 && ox * oz > worst.ox * worst.oz) worst = { a: a.id, b: b.id, ox, oz };
  }
}
console.log("worst roof interpenetration:", worst.ox > 0
  ? `${worst.a} x ${worst.b} = ${worst.ox.toFixed(2)} x ${worst.oz.toFixed(2)} m`
  : "none");

// Door facing: side 2 is local -Z, so world facing is rotationY + PI.
for (const b of ROOTFALL.buildings) {
  if (!["cottage", "shed", "hall", "quarry_hut", "tower"].includes(b.prefab)) continue;
  const f = b.rotationY + Math.PI;
  const fx = Math.sin(f); const fz = Math.cos(f);
  const dx = ROOTFALL.centre[0] - b.position[0];
  const dz = ROOTFALL.centre[1] - b.position[1];
  const len = Math.hypot(dx, dz) || 1;
  console.log(`door ${b.id}: dot ${(fx * dx / len + fz * dz / len).toFixed(2)}`);
}

// Wall circuit: built metres vs perimeter, and corner continuity.
let built = 0; let circuit = 0;
for (const run of ROOTFALL.walls ?? []) {
  const len = Math.hypot(run.to[0] - run.from[0], run.to[1] - run.from[1]);
  circuit += len;
  const open = (run.openings ?? []).reduce((sum, o) => sum + o.width, 0);
  built += len - open;
  const count = Math.round(len / MODULE_METRES);
  console.log(`run ${run.id}: ${len} m, ${count} modules, openings ${JSON.stringify(run.openings ?? [])}`);
}
console.log(`circuit ${circuit} m, built ${built} m (${((built / circuit) * 100).toFixed(0)}%)`);
const corners = new Map<string, number>();
for (const run of ROOTFALL.walls ?? []) {
  for (const end of [run.from, run.to]) {
    const key = `${end[0]},${end[1]}`;
    corners.set(key, (corners.get(key) ?? 0) + 1);
  }
}
console.log("wall ends:", [...corners].map(([k, n]) => `${k}=${n}`).join(" "));

// Paving tile and kerb counts, and the region bounds check.
let tiles = 0; let kerbs = 0;
const half = MODULE_METRES / 2;
for (const p of ROOTFALL.paving ?? []) {
  const fx = Math.ceil((p.rect.minX - half) / MODULE_METRES) * MODULE_METRES + half;
  const fz = Math.ceil((p.rect.minZ - half) / MODULE_METRES) * MODULE_METRES + half;
  let nx = 0; let nz = 0;
  for (let x = fx; x + half <= p.rect.maxX + 1e-6; x += MODULE_METRES) nx += 1;
  for (let z = fz; z + half <= p.rect.maxZ + 1e-6; z += MODULE_METRES) nz += 1;
  tiles += nx * nz;
  if (p.kerb) kerbs += 2 * nx + 2 * nz + 4;
  console.log(`paving ${p.id}: ${nx} x ${nz} = ${nx * nz} tiles`);
}
console.log(`paving total ${tiles} tiles, ${kerbs} kerb pieces`);

// Distinct asset ids Rootfall now draws, which is the draw-call unit (one group per asset+tier).
const assets = new Set<string>();
for (const b of ROOTFALL.buildings) {
  for (const part of buildPrefab(b.prefab, b.footprint, variantSeed(b.id), ROOTFALL.kit)) assets.add(part.assetId);
}
for (const kit of [BUILDING_KITS[ROOTFALL.kit]]) { assets.add(kit.wall); assets.add("wall_bottom_trim"); assets.add(kit.corner); }
for (const p of ROOTFALL.paving ?? []) { assets.add(p.assetId); if (p.kerb) { assets.add("kerb_straight"); assets.add("kerb_corner"); } }
for (const p of ROOTFALL.props ?? []) assets.add(p.assetId);
for (const s of ROOTFALL.stations) assets.add(s.assetId);
for (const s of ROOTFALL.shops) assets.add(s.assetId);
assets.add(ROOTFALL.bank.assetId);
console.log(`distinct asset ids in Rootfall: ${assets.size}`);
console.log([...assets].sort().join(" "));

// Forge interior, from the same collision the physics uses.
const forge = ROOTFALL.buildings.find((b) => b.id === "rootfall_forge")!;
for (const box of prefabCollision("forge", forge.footprint)) {
  const [wx, wz] = rot(box.dx, box.dz, forge.rotationY);
  const [sx, sz] = rot(box.sizeX, box.sizeZ, forge.rotationY);
  console.log(`forge ${box.tag}: centre (${(forge.position[0] + wx).toFixed(2)}, ${(forge.position[1] + wz).toFixed(2)}) size ${Math.abs(sx).toFixed(2)} x ${Math.abs(sz).toFixed(2)}`);
}

// Region bounds.
const region = REGIONS.find((r) => r.id === "vellenwood")!;
const outside: string[] = [];
for (const b of ROOTFALL.buildings) {
  if (b.position[0] < region.bounds.min[0] || b.position[0] > region.bounds.max[0]) outside.push(b.id);
}
console.log("outside bounds:", outside.length ? outside : "none");

console.log("--- roof boxes");
for (const r of roof) console.log(`${r.id}: x[${r.minX.toFixed(2)},${r.maxX.toFixed(2)}] z[${r.minZ.toFixed(2)},${r.maxZ.toFixed(2)}]`);
console.log("--- all roof overlaps");
for (let i = 0; i < roof.length; i += 1) {
  for (let j = i + 1; j < roof.length; j += 1) {
    const a = roof[i]!; const b = roof[j]!;
    const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    if (ox > 0 && oz > 0) console.log(`${a.id} x ${b.id} = ${ox.toFixed(2)} x ${oz.toFixed(2)}`);
  }
}

// Clearance from the two Agility obstacle entrances, whose meshes are drawn from `regions.ts`.
console.log("--- obstacle clearance");
for (const ob of region.obstacles) {
  const scale = ob.scale ?? 1;
  const yaw = ob.rotationY ?? 0;
  // Manifest sizes for the two Vellenwood entrance meshes.
  const size: Record<string, [number, number]> = { wall_arch: [2.0, 0.064], balcony_straight: [2.0, 2.0] };
  const s = size[ob.assetId];
  if (!s) continue;
  const hx = (Math.abs(s[0] * Math.cos(yaw)) + Math.abs(s[1] * Math.sin(yaw))) * scale / 2;
  const hz = (Math.abs(s[0] * Math.sin(yaw)) + Math.abs(s[1] * Math.cos(yaw))) * scale / 2;
  const box: Box = {
    id: ob.id,
    minX: ob.position[0] - hx, maxX: ob.position[0] + hx,
    minZ: ob.position[1] - hz, maxZ: ob.position[1] + hz,
  };
  console.log(`${ob.id} AABB x[${box.minX.toFixed(2)},${box.maxX.toFixed(2)}] z[${box.minZ.toFixed(2)},${box.maxZ.toFixed(2)}]`);
  for (const r of roof) {
    const ox = Math.min(r.maxX, box.maxX) - Math.max(r.minX, box.minX);
    const oz = Math.min(r.maxZ, box.maxZ) - Math.max(r.minZ, box.minZ);
    if (ox > 0 && oz > 0) console.log(`  CLIPPED by ${r.id}: ${ox.toFixed(2)} x ${oz.toFixed(2)} m`);
    else {
      const gap = Math.hypot(Math.max(0, -ox), Math.max(0, -oz));
      if (gap < 3) console.log(`  ${r.id} clears by ${gap.toFixed(2)} m`);
    }
  }
  for (const p of ROOTFALL.props ?? []) {
    if (Math.hypot(p.position[0] - ob.position[0], p.position[1] - ob.position[1]) < 3) {
      console.log(`  prop ${p.id} within 3 m`);
    }
  }
  for (const run of ROOTFALL.walls ?? []) {
    // Distance from the entrance to the run's centreline.
    const [ax, az] = run.from; const [bx, bz] = run.to;
    const dx = bx - ax; const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((ob.position[0] - ax) * dx + (ob.position[1] - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(ob.position[0] - (ax + dx * t), ob.position[1] - (az + dz * t));
    if (d < 6) console.log(`  wall ${run.id} centreline ${d.toFixed(2)} m away (at ${(t * Math.hypot(dx, dz)).toFixed(1)} m along)`);
  }
}
