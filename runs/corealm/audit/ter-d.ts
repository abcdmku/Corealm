import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { Navigation } from "../../../game/src/systems/navigation.js";
import type { Vec3 } from "../../../game/src/contracts.js";
await Navigation.initLibrary();
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const nav = new Navigation();
nav.build(scene.getWalkableMeshes());
const from: Vec3 = [60, scene.heightAtXZ(60, -16), -16];
const legs: [string, [number, number], [number, number]][] = [
  ["ramp_two->ramp_three", [100, -80], [118, -138]],
  ["ramp_three->great_cairn", [118, -138], [140, -176]],
];
for (const [label, a, b] of legs) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.round(L / 2);
  let line = "";
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    line += nav.isConnected(from, [x, scene.heightAtXZ(x, z), z]) ? "." : "X";
  }
  console.log(label.padEnd(26), line);
}
// widen the search: try a lateral sweep near where it breaks
for (const [label, a, b] of legs) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  console.log("\n" + label + " lateral map (rows = along 0..L step 4, cols = offset -12..12 step 2)");
  for (let s = 0; s <= L; s += 4) {
    let line = String(Math.round(s)).padStart(4) + " ";
    for (let o = -12; o <= 12; o += 2) {
      const x = a[0] + ux * s - uz * o;
      const z = a[1] + uz * s + ux * o;
      line += nav.isConnected(from, [x, scene.heightAtXZ(x, z), z]) ? "." : "X";
    }
    console.log(line);
  }
}
