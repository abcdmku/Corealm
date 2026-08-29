/**
 * Offline geometry audit of the Coldbrace layout. No browser, no terrain: it reads the authored
 * data and the same `render/buildings.ts` the world is assembled from, so it measures exactly what
 * gets built. Run with `npx tsx runs/corealm/audit/w2-coldbrace.ts`.
 *
 * Checks, in order: door facing against the settlement centre, footprint overlap, roof-tile
 * overlap at ROOF_EAVE_METRES, wall circuit closure and openings against the gatehouses,
 * paving tile counts, station/shop/bank attachment distances, and solid-vs-solid overlap for
 * every collider a settlement now emits.
 */
import { REGIONS, validateRegions } from "../../../game/src/content/regions.js";
import {
  BUILDING_KITS, GATE_GAP_METRES, MODULE_METRES, ROOF_EAVE_METRES,
  buildPrefab, prefabCollision, prefabHeight, roofOverhang, variantSeed, wallRunCollision,
} from "../../../game/src/render/buildings.js";
import type { BuildingDef, SettlementDef, Spot } from "../../../game/src/content/regions.js";

const manifest = JSON.parse(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (await import("node:fs")).readFileSync("game/public/assets/manifest.json", "utf8"),
) as { assets: { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }[] };
const sizeOf = new Map(manifest.assets.map((a) => [a.id, a.size]));
const baseOf = new Map(manifest.assets.map((a) => [a.id, a.base]));

const region = REGIONS.find((r) => r.id === "fallowmarch")!;
const s: SettlementDef = region.settlement;
const kit = BUILDING_KITS[s.kit];
const fail: string[] = [];
const note = (line: string): void => { console.log(line); };

/** The transform `regionBuilder.emitParts` applies to a local offset. */
function toWorld(origin: Spot, yaw: number, dx: number, dz: number): Spot {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [origin[0] + dx * cos + dz * sin, origin[1] - dx * sin + dz * cos];
}

interface Rect { minX: number; minZ: number; maxX: number; maxZ: number; tag: string }

/** Axis-aligned world rect of a rotated footprint. Every rotation here is a quarter turn. */
function footprintRect(b: BuildingDef, pad = 0): Rect {
  const q = Math.round(b.rotationY / (Math.PI / 2)) & 1;
  const w = q === 0 ? b.footprint[0] : b.footprint[1];
  const d = q === 0 ? b.footprint[1] : b.footprint[0];
  return {
    tag: b.id,
    minX: b.position[0] - w / 2 - pad, maxX: b.position[0] + w / 2 + pad,
    minZ: b.position[1] - d / 2 - pad, maxZ: b.position[1] + d / 2 + pad,
  };
}

function overlap(a: Rect, b: Rect): { x: number; z: number } | undefined {
  const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return x > 1e-6 && z > 1e-6 ? { x, z } : undefined;
}

// ------------------------------------------------------------- 1. door facing
note("=== doors ===");
let doorsGood = 0;
let doorsTotal = 0;
for (const b of s.buildings) {
  const parts = buildPrefab(b.prefab, b.footprint, variantSeed(b.id), s.kit);
  const door = parts.find((p) => p.tag === "door");
  const mouth = b.prefab === "forge" || b.prefab === "porch" || b.prefab === "arcade";
  if (!door && !mouth) continue;
  doorsTotal += 1;
  // A door faces rotationY + PI (it is on side index 2). An open-fronted prefab faces rotationY.
  const facing = mouth ? b.rotationY : b.rotationY + Math.PI;
  const at: Spot = door ? toWorld(b.position, b.rotationY, door.dx, door.dz) : b.position;
  const dir: Spot = [Math.sin(facing), Math.cos(facing)];
  const toCentre: Spot = [s.centre[0] - at[0], s.centre[1] - at[1]];
  const len = Math.hypot(toCentre[0], toCentre[1]) || 1;
  const dot = (dir[0] * toCentre[0] + dir[1] * toCentre[1]) / len;
  if (dot > 0) doorsGood += 1;
  note(`${b.id.padEnd(24)} ${mouth ? "mouth" : "door "} (${at[0].toFixed(2)},${at[1].toFixed(2)}) `
    + `facing ${facing.toFixed(2)} dot-to-centre ${dot.toFixed(2)}`);
}
note(`doors/mouths pointing inward: ${doorsGood}/${doorsTotal}`);

// -------------------------------------------------- 2. footprint + roof overlap
note("\n=== building spacing ===");
const rects = s.buildings.map((b) => footprintRect(b));
// `roofOverhang` is the real per-axis number for this prefab, this footprint and this kit;
// ROOF_EAVE_METRES is only the worst case across the whole game. On top of that, regionBuilder
// currently emits every prefab part at 1 / tierSilhouetteScale(tier), which is 1.111 in Coldbrace
// (a KNOWN BREAK documented on MODULE_METRES), so what the player actually sees is 1.111x the
// authored roof. Spacing is checked against the drawn size, not the authored one.
const DRAW = 1.111;
function roofRect(b: BuildingDef): Rect {
  const q = Math.round(b.rotationY / (Math.PI / 2)) & 1;
  const oh = roofOverhang(b.prefab, b.footprint, s.kit);
  const halfW = (b.footprint[0] / 2 + oh.x) * DRAW;
  const halfD = (b.footprint[1] / 2 + oh.z) * DRAW;
  const hx = q === 0 ? halfW : halfD;
  const hz = q === 0 ? halfD : halfW;
  return { tag: b.id, minX: b.position[0] - hx, maxX: b.position[0] + hx, minZ: b.position[1] - hz, maxZ: b.position[1] + hz };
}
const roofs = s.buildings.map((b) => roofRect(b));
for (const b of s.buildings) {
  const oh = roofOverhang(b.prefab, b.footprint, s.kit);
  note(`${b.id.padEnd(24)} ${b.prefab.padEnd(10)} overhang ${(oh.x * DRAW).toFixed(2)} / ${(oh.z * DRAW).toFixed(2)} m drawn`);
}
let worstRoof = 0;
for (let i = 0; i < s.buildings.length; i += 1) {
  for (let j = i + 1; j < s.buildings.length; j += 1) {
    const foot = overlap(rects[i]!, rects[j]!);
    if (foot) fail.push(`FOOTPRINT OVERLAP ${rects[i]!.tag} x ${rects[j]!.tag} ${foot.x.toFixed(2)} x ${foot.z.toFixed(2)} m`);
    const roof = overlap(roofs[i]!, roofs[j]!);
    // `tower` hangs its spire at y >= 2 * STOREY_METRES = 6.25 m and `porch` tops out at the
    // 3.36 m drawn height of `overhang_plaster`, so the two roofs cannot touch however far the
    // spire reaches in plan. Measured on the pair this exempts: 0.33 m of plan overlap.
    const stacked = (s.buildings[i]!.prefab === "tower" && s.buildings[j]!.prefab === "porch")
      || (s.buildings[j]!.prefab === "tower" && s.buildings[i]!.prefab === "porch");
    if (roof && !stacked) {
      worstRoof = Math.max(worstRoof, Math.min(roof.x, roof.z));
      fail.push(`ROOF OVERLAP ${rects[i]!.tag} x ${rects[j]!.tag} ${roof.x.toFixed(2)} x ${roof.z.toFixed(2)} m`);
    }
  }
}
note(`footprint pairs checked: ${s.buildings.length * (s.buildings.length - 1) / 2}; worst roof overlap ${worstRoof.toFixed(2)} m`);
let tightest = Infinity;
let tightestPair = "";
for (let i = 0; i < roofs.length; i += 1) {
  for (let j = i + 1; j < roofs.length; j += 1) {
    const a = roofs[i]!;
    const b = roofs[j]!;
    const gap = Math.max(
      Math.max(a.minX - b.maxX, b.minX - a.maxX),
      Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ),
    );
    const stacked = (s.buildings[i]!.prefab === "tower" && s.buildings[j]!.prefab === "porch")
      || (s.buildings[j]!.prefab === "tower" && s.buildings[i]!.prefab === "porch");
    if (!stacked && gap < tightest) { tightest = gap; tightestPair = `${a.tag} / ${b.tag}`; }
  }
}
note(`tightest drawn roof-to-roof clearance: ${tightest.toFixed(2)} m (${tightestPair})`);

// Every door must open onto pavement, which is the check that actually matters; "dot to the
// settlement centre" says nothing about a house on a street corner.
note("\n=== doors onto pavement ===");
for (const b of s.buildings) {
  const parts = buildPrefab(b.prefab, b.footprint, variantSeed(b.id), s.kit);
  const door = parts.find((p) => p.tag === "door");
  if (!door) continue;
  const at = toWorld(b.position, b.rotationY, door.dx, door.dz);
  const facing = b.rotationY + Math.PI;
  // Two metres out from the leaf, which is where the player stands.
  const step: Spot = [at[0] + 2 * Math.sin(facing), at[1] + 2 * Math.cos(facing)];
  let best = Infinity;
  let where = "none";
  for (const p of s.paving ?? []) {
    const d = Math.hypot(
      Math.max(0, Math.max(p.rect.minX - step[0], step[0] - p.rect.maxX)),
      Math.max(0, Math.max(p.rect.minZ - step[1], step[1] - p.rect.maxZ)),
    );
    if (d < best) { best = d; where = p.id; }
  }
  note(`${b.id.padEnd(24)} doorstep (${step[0].toFixed(1)},${step[1].toFixed(1)}) -> ${where} ${best.toFixed(2)} m`);
  if (best > 9) fail.push(`DOORSTEP ${b.id} is ${best.toFixed(1)} m from any pavement`);
  else if (best > 0.5) note(`  (back lane - dressed, not paved)`);
}

// ------------------------------------------------------------ 3. wall circuit
note("\n=== wall circuit ===");
const runs = s.walls ?? [];
let perimeter = 0;
let built = 0;
for (const run of runs) {
  const length = Math.hypot(run.to[0] - run.from[0], run.to[1] - run.from[1]);
  perimeter += length;
  const boxes = wallRunCollision(length, run.openings ?? []);
  const solid = boxes.reduce((sum, box) => sum + box.sizeX, 0);
  built += solid;
  note(`${run.id.padEnd(20)} ${length.toFixed(0)} m, ${boxes.length} span(s), ${solid.toFixed(0)} m built`);
}
// Closure: every endpoint must be shared by exactly two runs.
const endpoints = new Map<string, number>();
for (const run of runs) {
  for (const p of [run.from, run.to]) {
    const key = `${p[0]},${p[1]}`;
    endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
  }
}
for (const [key, count] of endpoints) {
  if (count !== 2) fail.push(`WALL CORNER ${key} is shared by ${count} runs, not 2 - the circuit is open`);
}
note(`perimeter ${perimeter.toFixed(0)} m, built ${built.toFixed(0)} m (${(100 * built / perimeter).toFixed(0)}%), `
  + `corners closed: ${[...endpoints.values()].every((c) => c === 2)}`);

// Every gatehouse must stand in an opening, and the opening must be at least as wide as the arch.
for (const gate of s.buildings.filter((b) => b.prefab === "gatehouse")) {
  let matched = false;
  for (const run of runs) {
    const length = Math.hypot(run.to[0] - run.from[0], run.to[1] - run.from[1]);
    const ux = (run.to[0] - run.from[0]) / length;
    const uz = (run.to[1] - run.from[1]) / length;
    const along = (gate.position[0] - run.from[0]) * ux + (gate.position[1] - run.from[1]) * uz;
    const perp = Math.abs((gate.position[0] - run.from[0]) * -uz + (gate.position[1] - run.from[1]) * ux);
    if (along < -1 || along > length + 1 || perp > 1.5) continue;
    for (const opening of run.openings ?? []) {
      if (Math.abs(opening.at - along) < 0.5 && opening.width >= gate.footprint[0] - 0.01) {
        matched = true;
        note(`${gate.id.padEnd(24)} sits in ${run.id} at ${along.toFixed(0)} m, opening ${opening.width} m, arch ${GATE_GAP_METRES} m`);
      }
    }
  }
  if (!matched) fail.push(`GATEHOUSE ${gate.id} does not stand in an opening of its own wall run`);
}
// The wall_vault obstacle must land on solid wall.
const vault = region.obstacles.find((o) => o.id === "wall_vault")!;
for (const run of runs) {
  const length = Math.hypot(run.to[0] - run.from[0], run.to[1] - run.from[1]);
  const ux = (run.to[0] - run.from[0]) / length;
  const uz = (run.to[1] - run.from[1]) / length;
  const along = (vault.position[0] - run.from[0]) * ux + (vault.position[1] - run.from[1]) * uz;
  const perp = Math.abs((vault.position[0] - run.from[0]) * -uz + (vault.position[1] - run.from[1]) * ux);
  if (along < 0 || along > length || perp > 1.5) continue;
  const cut = (run.openings ?? []).some((o) => Math.abs(o.at - along) < o.width / 2);
  note(`wall_vault (${vault.position}) is on ${run.id} at ${along.toFixed(0)} m; opening there: ${cut}`);
  if (cut) fail.push("WALL VAULT: the Agility shortcut vaults a gate opening, not a wall");
}

// ------------------------------------------------------------------ 4. paving
note("\n=== paving ===");
let tiles = 0;
let kerbs = 0;
const half = MODULE_METRES / 2;
for (const p of s.paving ?? []) {
  const firstX = Math.ceil((p.rect.minX - half) / MODULE_METRES) * MODULE_METRES + half;
  const firstZ = Math.ceil((p.rect.minZ - half) / MODULE_METRES) * MODULE_METRES + half;
  let nx = 0;
  let nz = 0;
  for (let cx = firstX; cx + half <= p.rect.maxX + 1e-6; cx += MODULE_METRES) nx += 1;
  for (let cz = firstZ; cz + half <= p.rect.maxZ + 1e-6; cz += MODULE_METRES) nz += 1;
  tiles += nx * nz;
  if (p.kerb) kerbs += 2 * nx + 2 * nz + 4;
  note(`${p.id.padEnd(30)} ${nx} x ${nz} = ${nx * nz} tiles of ${p.assetId}${p.kerb ? " + kerb" : ""}`);
}
note(`total ${tiles} tiles, ${kerbs} kerb pieces; instanced groups: 1 floor + ${kerbs ? 2 : 0} kerb`);

// ------------------------------------------------------------- 5. attachments
note("\n=== attachments ===");
function distanceToFootprint(point: Spot, b: BuildingDef): number {
  const cos = Math.cos(b.rotationY);
  const sin = Math.sin(b.rotationY);
  const wx = point[0] - b.position[0];
  const wz = point[1] - b.position[1];
  const dx = wx * cos - wz * sin;
  const dz = wx * sin + wz * cos;
  return Math.hypot(
    Math.max(0, Math.abs(dx) - b.footprint[0] / 2),
    Math.max(0, Math.abs(dz) - b.footprint[1] / 2),
  );
}
const attached: { what: string; id: string; position: Spot; to?: string }[] = [
  ...s.stations.map((x) => ({ what: "station", id: x.id, position: x.position, to: x.attachedTo })),
  ...s.shops.map((x) => ({ what: "shop", id: x.id, position: x.position, to: x.attachedTo })),
  { what: "bank", id: s.bank.id, position: s.bank.position, to: s.bank.attachedTo },
];
for (const a of attached) {
  if (!a.to) { fail.push(`${a.what} ${a.id} has no attachedTo`); continue; }
  const b = s.buildings.find((x) => x.id === a.to);
  if (!b) { fail.push(`${a.what} ${a.id} attachedTo unknown ${a.to}`); continue; }
  const d = distanceToFootprint(a.position, b);
  note(`${a.id.padEnd(24)} -> ${a.to!.padEnd(22)} ${d.toFixed(2)} m`);
  if (d > 3) fail.push(`ATTACHMENT ${a.id} is ${d.toFixed(2)} m from ${a.to}`);
}

// ------------------------------------------------------------- 6. solid clash
note("\n=== solids ===");
interface Box { tag: string; cx: number; cz: number; sx: number; sz: number; yaw: number }
const boxes: Box[] = [];
for (const b of s.buildings) {
  for (const box of prefabCollision(b.prefab, b.footprint)) {
    const at = toWorld(b.position, b.rotationY, box.dx, box.dz);
    boxes.push({ tag: `${b.id}#${box.tag}`, cx: at[0], cz: at[1], sx: box.sizeX, sz: box.sizeZ, yaw: b.rotationY });
  }
}
for (const run of runs) {
  const length = Math.hypot(run.to[0] - run.from[0], run.to[1] - run.from[1]);
  const yaw = Math.atan2(-(run.to[1] - run.from[1]), run.to[0] - run.from[0]);
  for (const box of wallRunCollision(length, run.openings ?? [])) {
    const at = toWorld(run.from, yaw, box.dx, box.dz);
    boxes.push({ tag: `${run.id}#${box.tag}`, cx: at[0], cz: at[1], sx: box.sizeX, sz: box.sizeZ, yaw });
  }
}
const solidThing = (id: string, at: Spot, assetId: string, scale: number, yaw: number): void => {
  const size = sizeOf.get(assetId);
  if (!size) { fail.push(`unknown asset ${assetId} on ${id}`); return; }
  const sx = size.x * scale;
  const sz = size.z * scale;
  if (sx * sz < 0.09) return;
  boxes.push({ tag: id, cx: at[0], cz: at[1], sx, sz, yaw });
};
for (const st of s.stations) solidThing(st.id, st.position, st.assetId, st.scale ?? 1, st.rotationY);
for (const sh of s.shops) solidThing(sh.id, sh.position, sh.assetId, 1, sh.rotationY);
solidThing(s.bank.id, s.bank.position, s.bank.assetId, 1, s.bank.rotationY);
for (const p of s.props ?? []) {
  if (p.solid) solidThing(p.id, p.position, p.assetId, p.scale ?? 1, p.rotationY);
}
/** Separating-axis test for two rotated rectangles. */
function boxOverlap(a: Box, b: Box): boolean {
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2];
  for (const axis of axes) {
    const ax = Math.cos(axis);
    const az = Math.sin(axis);
    const proj = (box: Box): { min: number; max: number } => {
      const c = box.cx * ax + box.cz * az;
      const r = Math.abs(Math.cos(box.yaw) * ax + Math.sin(box.yaw) * az) * box.sx / 2
        + Math.abs(-Math.sin(box.yaw) * ax + Math.cos(box.yaw) * az) * box.sz / 2;
      return { min: c - r, max: c + r };
    };
    const pa = proj(a);
    const pb = proj(b);
    if (pa.max < pb.min + 1e-6 || pb.max < pa.min + 1e-6) return false;
  }
  return true;
}
let clashes = 0;
for (let i = 0; i < boxes.length; i += 1) {
  for (let j = i + 1; j < boxes.length; j += 1) {
    const a = boxes[i]!;
    const b = boxes[j]!;
    // Parts of the same structure are meant to touch.
    if (a.tag.split("#")[0] === b.tag.split("#")[0]) continue;
    // Two wall runs meeting at a corner overlap by design: that shared post is what closes the
    // circuit instead of leaving the 1.5 m hole every corner used to have.
    if (a.tag.includes("_wall_") && b.tag.includes("_wall_")) continue;
    if (boxOverlap(a, b)) { clashes += 1; note(`  clash ${a.tag} x ${b.tag}`); }
  }
}
note(`${boxes.length} colliders, ${clashes} cross-structure clashes`);

// ------------------------------------------------------------- 7. npc clearance
note("\n=== npcs ===");
for (const npc of s.npcs) {
  let nearest = Infinity;
  let what = "";
  for (const box of boxes) {
    const wx = npc.position[0] - box.cx;
    const wz = npc.position[1] - box.cz;
    const lx = wx * Math.cos(box.yaw) - wz * Math.sin(box.yaw);
    const lz = wx * Math.sin(box.yaw) + wz * Math.cos(box.yaw);
    const ox = Math.abs(lx) - box.sx / 2;
    const oz = Math.abs(lz) - box.sz / 2;
    const d = ox > 0 || oz > 0 ? Math.hypot(Math.max(0, ox), Math.max(0, oz)) : Math.max(ox, oz);
    if (d < nearest) { nearest = d; what = box.tag; }
  }
  note(`${npc.id.padEnd(22)} (${npc.position}) nearest collider ${nearest.toFixed(2)} m (${what})`);
  if (nearest < -0.35) fail.push(`NPC ${npc.id} stands inside ${what}`);
}

// -------------------------------------------------------------- 8. pad radius
note("\n=== pad ===");
let furthest = 0;
for (const b of s.buildings) {
  const halfDiag = Math.hypot(b.footprint[0], b.footprint[1]) / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    furthest = Math.max(furthest, Math.hypot(
      b.position[0] + sx * halfDiag - s.centre[0], b.position[1] + sz * halfDiag - s.centre[1]));
  }
}
for (const x of [...s.stations, ...s.shops, ...s.npcs, s.bank]) {
  furthest = Math.max(furthest, Math.hypot(x.position[0] - s.centre[0], x.position[1] - s.centre[1]));
}
note(`settlementRadius input: furthest authored thing ${furthest.toFixed(1)} m from centre`);
const corner = Math.hypot(-186 + 160, -108 + 80);
note(`wall corner (-186,-108) is ${corner.toFixed(1)} m from centre`);

// ---------------------------------------------------------------- 9. validate
note("\n=== validateRegions ===");
const known = new Set([...sizeOf.keys()]);
const problems = validateRegions(known);
if (problems.length === 0) note("validateRegions(): []");
else for (const p of problems) note(`  ${p}`);

note(`\nprefabHeight(forge)=${prefabHeight("forge")} kit=${kit.id} baseY(roof_log)=${baseOf.get("roof_log")?.y}`);
note(fail.length === 0 ? "\nALL CHECKS PASS" : `\n${fail.length} FAILURES:\n${fail.map((f) => "  " + f).join("\n")}`);
process.exitCode = fail.length + problems.length > 0 ? 1 : 0;
