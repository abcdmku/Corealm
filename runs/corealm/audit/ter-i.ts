import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { Navigation } from "../../../game/src/systems/navigation.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import type { Vec3 } from "../../../game/src/contracts.js";
await Navigation.initLibrary();
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const nav = new Navigation();
nav.build(scene.getWalkableMeshes());
const fm = REGIONS.find((r) => r.id === "fallowmarch")!;
const spawn: Vec3 = [fm.spawnPoint[0], scene.heightAtXZ(fm.spawnPoint[0], fm.spawnPoint[1]), fm.spawnPoint[1]];
console.log("spawn", spawn.map((v) => v.toFixed(1)).join(","));
let bad = 0;
for (const region of REGIONS) {
  for (const l of region.locations) {
    const p: Vec3 = [l.position[0], scene.heightAtXZ(l.position[0], l.position[1]), l.position[1]];
    const snap = nav.closestPoint(p);
    const off = snap ? Math.hypot(snap[0] - p[0], snap[1] - p[1], snap[2] - p[2]) : Infinity;
    const conn = nav.isConnected(spawn, p);
    if (!conn || off > 1.5) { bad += 1; console.log(`${region.id}/${l.id.padEnd(26)} connected=${conn} snapOffset=${off.toFixed(2)}`); }
  }
}
console.log(`locations off-mesh or unreachable from spawn: ${bad}`);
