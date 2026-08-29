import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { Navigation } from "../../../game/src/systems/navigation.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import type { Vec3 } from "../../../game/src/contracts.js";

await Navigation.initLibrary();
const root = new THREE.Scene();
const scene = new WorldScene(root);
const spec = buildWorldTerrainSpec();
scene.buildWorld(spec);
const nav = new Navigation();
const t0 = Date.now();
const ok = nav.build(scene.getWalkableMeshes());
console.log("nav.build", ok, "ms", Date.now() - t0, JSON.stringify({ ...nav.getDiagnostics(), bounds: undefined }));

const from: Vec3 = [60, scene.heightAtXZ(60, -16), -16];
// The exact grid the gate uses: x 50..300, z 0..-180
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
for (const l of [...km.locations]) {
  const to: Vec3 = [l.position[0], scene.heightAtXZ(l.position[0], l.position[1]), l.position[1]];
  const p = nav.findPathDetailed(from, to);
  console.log(`${l.id.padEnd(26)} ${nav.isConnected(from, to) ? "OK  " : "FAIL"} gap=${p ? p.arrivalGap.toFixed(2) : "n/a"}`);
}
// cross-world acceptance B3: Coldbrace bank -> Upper Karrow seam
const cb = REGIONS.find((r) => r.id === "fallowmarch")!.locations.find((l) => l.id === "bank_interior")!;
const uk = km.locations.find((l) => l.id === "upper_karrow_seam")!;
const a: Vec3 = [cb.position[0], scene.heightAtXZ(cb.position[0], cb.position[1]), cb.position[1]];
const bnode: Vec3 = [uk.position[0], scene.heightAtXZ(uk.position[0], uk.position[1]), uk.position[1]];
const path = nav.findPath(a, bnode);
let len = 0;
if (path) for (let i = 1; i < path.length; i += 1) len += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1], path[i]![2] - path[i - 1]![2]);
console.log(`\nB3 coldbrace bank -> upper karrow seam: connected=${nav.isConnected(a, bnode)} pathLength=${len.toFixed(1)} m (window 380-460)`);
