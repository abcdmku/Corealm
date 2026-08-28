import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import fs from "node:fs";
const root = new THREE.Scene(); const scene = new WorldScene(root);
const spec = buildWorldTerrainSpec(); scene.buildWorld(spec);
const meshes = scene.getWalkableMeshes(); for (const m of meshes) m.updateMatrixWorld(true);
const ray = new THREE.Raycaster(); ray.far = 5000; const down = new THREE.Vector3(0, -1, 0);
const mh = (x: number, z: number) => { ray.set(new THREE.Vector3(x, 900, z), down); const h = ray.intersectObjects(meshes, false); return h.length ? h[0]!.point.y : NaN; };
const ents = JSON.parse(fs.readFileSync("runs/corealm/audit/grounding.json", "utf8")).rows;
const e = ents.find((r: any) => r.id === "ridge_pines_trees_2");
console.log("ridge_pines_trees_2", e.px, e.pz, "py", e.py);
for (const [cx, cz, label] of [[178.4, -73.8, "highcairn worst"], [e.px, e.pz, "ridge pine 2"], [253.3, -101.8, "global worst"]] as any[]) {
  console.log("\n== " + label + " at " + cx.toFixed(1) + "," + cz.toFixed(1) + "  (field / mesh) ==");
  for (let dz = -3; dz <= 3; dz += 1) {
    const row: string[] = [];
    for (let dx = -3; dx <= 3; dx += 1) row.push((scene.heightAtXZ(cx + dx, cz + dz)).toFixed(1) + "/" + mh(cx + dx, cz + dz).toFixed(1));
    console.log("dz=" + dz, row.join(" "));
  }
  // steepest analytic gradient nearby
  console.log("slope at centre", scene.slopeAt(cx, cz).toFixed(2));
}
// how many world samples have analytic slope > 1 (45 deg)
let steep = 0, n = 0, maxSlope = 0, ms: any = null;
const b = spec.bounds;
for (let x = b.minX + 1; x < b.maxX - 1; x += 2.7) for (let z = b.minZ + 1; z < b.maxZ - 1; z += 2.7) {
  const s = scene.slopeAt(x, z); n += 1; if (s > 1) steep += 1; if (s > maxSlope) { maxSlope = s; ms = [x, z]; }
}
console.log("\nanalytic slope samples", n, "steeper than 45deg", steep, "max", maxSlope.toFixed(2), "at", ms);
