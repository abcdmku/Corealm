/**
 * Highcairn authoring verification, offline: validateRegions, entity ids, door bearings, AABB
 * clashes between everything the settlement places, and the instanced-group count.
 *
 * NPCs are checked with a 0.7 m body cylinder rather than their manifest bbox: `base_male` measures
 * 1.859 m wide because that is a T-pose arm span, and using it reports every NPC as clashing with
 * whatever counter they stand behind.
 */
import { readFileSync } from "node:fs";
import { buildWorld, type AssetSize } from "../../../game/src/world/regionBuilder.js";
import { validateRegions } from "../../../game/src/content/regions.js";
import { HIGHCAIRN } from "../../../game/src/content/settlements/highcairn.js";

interface ManifestAsset { id: string; size: { x: number; y: number; z: number }; base?: { x: number; y: number; z: number } }
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((a) => [a.id, a]));
const known = new Set(byId.keys());

console.log("=== validateRegions");
const problems = validateRegions(known);
console.log(problems.length === 0 ? "[]  (0 problems)" : problems.join("\n"));

const heightAt = (): number => 0;
const world = buildWorld(1, heightAt, {
  heightAt,
  baseY: (id: string): number => byId.get(id)?.base?.y ?? 0,
  assetSize: (id: string): AssetSize | null => byId.get(id)?.size ?? null,
});
const ids = new Set(world.entities.map((e) => e.id));
const owners = new Set([...ids].map((id) => id.split("#")[0] ?? id));

console.log("\n=== ids that must still exist (buildings emit only #part entities, so owners count)");
const need = [
  "highcairn_bank_counter", "highcairn_furnace", "highcairn_anvil", "highcairn_range",
  "highcairn_general", "highcairn_smith", "npc_foreman_arden", "npc_quarrier_vess",
  "npc_cairnkeeper_ode", "npc_watcher_hale", "highcairn_gate", "highcairn_crane",
  "highcairn_hut_1", "highcairn_hut_2", "highcairn_hut_3", "highcairn_hut_4", "highcairn_hut_5",
  "highcairn_hut_6", "highcairn_wall_n", "highcairn_wall_s", "highcairn_wall_w",
  "highcairn_plot_beds_1", "highcairn_plot_beds_2", "highcairn_plot_beds_3", "highcairn_plot_beds_4",
];
for (const id of need) if (!owners.has(id)) console.log("MISSING", id);
console.log("all present:", need.every((id) => owners.has(id)));

console.log("\n=== doors: bearing, and what stands in front of one");
const paved = (HIGHCAIRN.paving ?? []).map((p) => p.rect);
for (const b of HIGHCAIRN.buildings) {
  if (b.prefab !== "quarry_hut") continue;
  const w = b.footprint[0];
  const cos = Math.cos(b.rotationY);
  const sin = Math.sin(b.rotationY);
  const count = Math.max(1, Math.round(w / 2));
  const idx = Math.floor(count / 2);
  const spacing = w / count;
  const along = (idx + 0.5) * spacing - w / 2 - 0.55;
  const dx = -along;
  const dz = -(b.footprint[1] / 2 + 0.02);
  const doorX = b.position[0] + dx * cos + dz * sin;
  const doorZ = b.position[1] - dx * sin + dz * cos;
  const fx = -Math.sin(b.rotationY);
  const fz = -Math.cos(b.rotationY);
  // How far you can walk straight out of the door before hitting another building's footprint or
  // a wall run. This is the metric that matters; the old defect was 2.0 m.
  let clear = 40;
  for (const other of HIGHCAIRN.buildings) {
    if (other.id === b.id) continue;
    for (let t = 0.2; t < 40; t += 0.1) {
      const px = doorX + fx * t;
      const pz = doorZ + fz * t;
      const ocos = Math.cos(other.rotationY);
      const osin = Math.sin(other.rotationY);
      const rx = (px - other.position[0]) * ocos - (pz - other.position[1]) * osin;
      const rz = (px - other.position[0]) * osin + (pz - other.position[1]) * ocos;
      if (Math.abs(rx) <= other.footprint[0] / 2 && Math.abs(rz) <= other.footprint[1] / 2) {
        clear = Math.min(clear, t);
        break;
      }
    }
  }
  for (const run of HIGHCAIRN.walls ?? []) {
    for (let t = 0.2; t < 40; t += 0.1) {
      const px = doorX + fx * t;
      const pz = doorZ + fz * t;
      const ax = run.from[0]; const az = run.from[1];
      const bx = run.to[0]; const bz = run.to[1];
      const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
      const u = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / len2));
      const d = Math.hypot(px - (ax + u * (bx - ax)), pz - (az + u * (bz - az)));
      if (d < 0.25) { clear = Math.min(clear, t); break; }
    }
  }
  const onPaving = paved.some((r) => {
    const px = doorX + fx * 1.5;
    const pz = doorZ + fz * 1.5;
    return px >= r.minX && px <= r.maxX && pz >= r.minZ && pz <= r.maxZ;
  });
  console.log(
    `${b.id.padEnd(18)} door (${doorX.toFixed(2)},${doorZ.toFixed(2)})  clear ahead ${clear.toFixed(1)} m` +
    `  1.5 m out is ${onPaving ? "PAVED YARD" : "open ground"}`,
  );
}

console.log("\n=== wall circuit");
let circuit = 0;
let built = 0;
for (const run of HIGHCAIRN.walls ?? []) {
  const len = Math.hypot(run.to[0] - run.from[0], run.to[1] - run.from[1]);
  circuit += len;
  const count = Math.max(1, Math.round(len / 2));
  const spacing = len / count;
  for (let i = 0; i < count; i += 1) {
    const from = i * spacing;
    const to = from + spacing;
    const cut = (run.openings ?? []).some((o) => from < o.at + o.width / 2 - 1e-6 && to > o.at - o.width / 2 + 1e-6);
    if (!cut) built += spacing;
  }
}
console.log(`circuit ${circuit.toFixed(1)} m, built ${built.toFixed(1)} m = ${((built / circuit) * 100).toFixed(0)}%`);

console.log("\n=== AABB clash pass");
interface Box { id: string; minX: number; maxX: number; minZ: number; maxZ: number; y: number; top: number }
const boxes: Box[] = [];
for (const e of world.entities) {
  if (e.regionId !== "karrowmoor") continue;
  if (!e.id.startsWith("highcairn_") && !e.id.startsWith("npc_")) continue;
  const assetId = e.view?.assetId;
  if (!assetId) continue;
  const size = byId.get(assetId)?.size;
  const base = byId.get(assetId)?.base;
  if (!size || !base) continue;
  const s = e.view?.scale ?? 1;
  const rot = e.view?.rotationY ?? 0;
  const npc = e.archetype === "npc";
  let minX: number; let maxX: number; let minZ: number; let maxZ: number;
  if (npc) {
    minX = -0.35; maxX = 0.35; minZ = -0.35; maxZ = 0.35;
  } else {
    const cx0 = base.x * s; const cx1 = (base.x + size.x) * s;
    const cz0 = base.z * s; const cz1 = (base.z + size.z) * s;
    const cos = Math.cos(rot); const sin = Math.sin(rot);
    minX = Infinity; maxX = -Infinity; minZ = Infinity; maxZ = -Infinity;
    for (const [px, pz] of [[cx0, cz0], [cx1, cz0], [cx1, cz1], [cx0, cz1]]) {
      const wx = (px as number) * cos + (pz as number) * sin;
      const wz = -(px as number) * sin + (pz as number) * cos;
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
    }
  }
  boxes.push({
    id: e.id,
    minX: e.position[0] + minX, maxX: e.position[0] + maxX,
    minZ: e.position[2] + minZ, maxZ: e.position[2] + maxZ,
    y: e.position[1] + (npc ? 0 : base.y * s),
    top: e.position[1] + (npc ? 1.8 : (base.y + size.y) * s),
  });
}
console.log("boxes:", boxes.length);
const owner = (id: string): string => id.split("#")[0] ?? id;
// The four wall runs deliberately share a corner post: `buildWallRun` puts a kit.corner at BOTH
// ends of every run, which is what closes a corner two 8 m stubs used to leave open. Two coincident
// posts per corner is the emitter's design, not an authoring error, so they are counted separately.
const isCornerShare = (a: string, b: string): boolean =>
  a.startsWith("highcairn_wall_") && b.startsWith("highcairn_wall_");
let clashes = 0;
let cornerShares = 0;
for (let i = 0; i < boxes.length; i += 1) {
  for (let j = i + 1; j < boxes.length; j += 1) {
    const a = boxes[i]!; const b = boxes[j]!;
    if (owner(a.id) === owner(b.id)) continue;
    const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    const oy = Math.min(a.top, b.top) - Math.max(a.y, b.y);
    if (ox > 0.12 && oz > 0.12 && oy > 0.12) {
      if (isCornerShare(a.id, b.id)) { cornerShares += 1; continue; }
      clashes += 1;
      console.log(`clash ${a.id} x ${b.id}  ${ox.toFixed(2)} x ${oz.toFixed(2)} x ${oy.toFixed(2)}`);
    }
  }
}
console.log("authoring clashes over 0.12 m in all three axes:", clashes);
console.log("wall-run shared-corner overlaps (emitter design, 2 posts per corner):", cornerShares);

console.log("\n=== settlement content counts");
const hc = world.entities.filter((e) => e.id.startsWith("highcairn_"));
const count = (pred: (id: string) => boolean): number => hc.filter((e) => pred(e.id)).length;
console.log("paving tiles:", count((id) => /^highcairn_(yard|gate_road|postern_apron)#/.test(id)));
console.log("wall parts:", count((id) => /^highcairn_wall_[nsew]#/.test(id)));
console.log("props:", (HIGHCAIRN.props ?? []).length);
console.log("solid props:", (HIGHCAIRN.props ?? []).filter((p) => p.solid).length);
console.log("total highcairn entities:", hc.length);
console.log("solid volumes in karrowmoor:", world.solids.filter((s) => s.id.startsWith("highcairn_")).length);

console.log("\n=== instanced groups");
const before = new Set<string>();
const after = new Set<string>();
for (const e of world.entities) {
  if (e.regionId !== "karrowmoor" || !e.view?.assetId) continue;
  after.add(e.view.assetId);
  if (!e.id.startsWith("highcairn_")) before.add(e.view.assetId);
}
console.log("karrowmoor asset ids total:", after.size);
console.log("asset ids NOT owned by highcairn:", before.size);
const onlyHighcairn = [...after].filter((a) => !before.has(a)).sort();
console.log("asset ids only highcairn draws (= new instanced groups):", onlyHighcairn.length);
console.log(onlyHighcairn.join(", "));
