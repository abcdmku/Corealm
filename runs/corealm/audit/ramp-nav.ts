/**
 * Offline replica of boot.ts's navmesh build, so the ramp work can be measured in ~10 s instead
 * of a 4-minute gate-check. Same inputs boot uses: scene.buildWorld(buildWorldTerrainSpec()),
 * ground stamps, water bodies, buildWorld() solids -> solidObstacleMeshes, dungeon walkable.
 */
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { WorldScene } from "../../../game/src/render/scene.js";
import { WorldScene as HeadScene } from "./head/scene-head.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { Navigation, solidObstacleMeshes } from "../../../game/src/systems/navigation.js";
import { buildWorld } from "../../../game/src/world/regionBuilder.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import type { RegionId, Vec3 } from "../../../game/src/contracts.js";

interface ManifestAsset { id: string; size?: { x: number; y: number; z: number }; base?: { x: number; y: number; z: number } }
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((a) => [a.id, a]));

await Navigation.initLibrary();
const root = new THREE.Scene();
const useHead = process.argv.includes("--head");
const scene = (useHead ? new HeadScene(root) : new WorldScene(root)) as unknown as WorldScene;
console.log("terrain source:", useHead ? "HEAD (committed)" : "working tree");
const tWorld = Date.now();
scene.buildWorld(buildWorldTerrainSpec());
const worldMs = Date.now() - tWorld;

const heightAt = (regionId: RegionId, x: number, z: number): number => scene.heightAt(regionId, x, z);
const built = buildWorld(0x436f7265, heightAt, {
  heightAt,
  baseY: (id: string) => byId.get(id)?.base?.y ?? 0,
  assetSize: (id: string) => byId.get(id)?.size ?? null,
});
const carves = solidObstacleMeshes(built.solids);
const group = new THREE.Group();
for (const m of carves) group.add(m);
group.updateMatrixWorld(true);

const t0 = Date.now();
const nav = new Navigation();
const ok = nav.build([...scene.getWalkableMeshes(), ...carves]);
const buildMs = Date.now() - t0;
console.log("world build ms", worldMs, "| solids", built.solids.length, "| nav", ok, JSON.stringify({ ...nav.getDiagnostics(), bounds: undefined }));
console.log("navmesh build ms", buildMs);

nav.setRouteGraph(built.routeNodes, built.routeEdges);

const from: Vec3 = [60, scene.heightAtXZ(60, -16), -16];
let reach = 0; let total = 0;
const rows: string[] = [];
for (let z = 0; z >= -180; z -= 30) {
  let line = `z=${String(z).padStart(4)} `;
  for (let x = 50; x <= 300; x += 50) {
    const to: Vec3 = [x, scene.heightAtXZ(x, z), z];
    const c = nav.isConnected(from, to);
    total += 1; if (c) reach += 1;
    line += c ? " ok " : " XX ";
  }
  rows.push(line);
}
console.log("      " + [50, 100, 150, 200, 250, 300].map((v) => String(v).padStart(4)).join(""));
console.log(rows.join("\n"));
console.log(`grid reachable ${reach}/${total}`);

console.log("\n-- named Karrowmoor locations from Lower Quarry --");
const km = REGIONS.find((r) => r.id === "karrowmoor")!;
for (const l of km.locations) {
  const to: Vec3 = [l.position[0], scene.heightAtXZ(l.position[0], l.position[1]), l.position[1]];
  const p = nav.findPathDetailed(from, to);
  console.log(`${l.id.padEnd(26)} ${nav.isConnected(from, to) ? "OK  " : "FAIL"} gap=${p ? p.arrivalGap.toFixed(2) : "n/a"}`);
}

console.log("\n-- cross-world walks --");
const nodeAt = (regionId: string, id: string): Vec3 => {
  const l = REGIONS.find((r) => r.id === regionId)!.locations.find((n) => n.id === id)!;
  return [l.position[0], scene.heightAtXZ(l.position[0], l.position[1]), l.position[1]];
};
const walks: [string, Vec3, Vec3][] = [
  ["coldbrace bank -> upper karrow seam", nodeAt("fallowmarch", "bank_interior"), nodeAt("karrowmoor", "upper_karrow_seam")],
  ["highcairn -> bracken pit", nodeAt("karrowmoor", "highcairn_outpost"), nodeAt("fallowmarch", "bracken_pit")],
  ["great cairn -> bracken pit", nodeAt("karrowmoor", "great_cairn"), nodeAt("fallowmarch", "bracken_pit")],
  ["coldbrace square -> great cairn", nodeAt("fallowmarch", "town_center"), nodeAt("karrowmoor", "great_cairn")],
  ["coldbrace square -> highcairn", nodeAt("fallowmarch", "town_center"), nodeAt("karrowmoor", "highcairn_outpost")],
];
const measure = (a: Vec3, b: Vec3): { ok: boolean; len: number } => {
  const path = nav.findPath(a, b);
  let len = 0;
  if (path) for (let i = 1; i < path.length; i += 1) len += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1], path[i]![2] - path[i - 1]![2]);
  return { ok: nav.isConnected(a, b), len };
};

console.log("");
console.log("-- every authored road edge: straight-line metres vs walked path metres --");
for (const region of REGIONS) {
  for (const edge of region.roads) {
    const a = region.locations.find((l) => l.id === edge.from);
    const b = region.locations.find((l) => l.id === edge.to);
    if (!a || !b) continue;
    const av: Vec3 = [a.position[0], scene.heightAtXZ(a.position[0], a.position[1]), a.position[1]];
    const bv: Vec3 = [b.position[0], scene.heightAtXZ(b.position[0], b.position[1]), b.position[1]];
    const flat = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]);
    const m = measure(av, bv);
    const ratio = flat > 0 ? m.len / flat : 0;
    console.log(`${region.id.slice(0, 4)} ${(edge.from + " -> " + edge.to).padEnd(48)} flat ${flat.toFixed(1).padStart(6)} m  walked ${m.len.toFixed(1).padStart(6)} m  x${ratio.toFixed(2)}${m.ok ? "" : "  UNREACHABLE"}${ratio > 1.6 ? "  DETOUR" : ""}`);
  }
}

for (const [label, a, b] of walks) {
  const path = nav.findPath(a, b);
  let len = 0;
  if (path) for (let i = 1; i < path.length; i += 1) len += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1], path[i]![2] - path[i - 1]![2]);
  console.log(`${label.padEnd(38)} connected=${nav.isConnected(a, b)} len=${len.toFixed(1)}`);
}
