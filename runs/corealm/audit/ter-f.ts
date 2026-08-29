import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
console.log("building base y vs the drawn mesh in a ring around it");
let worstStep = 0; let worstId = "";
for (const region of REGIONS) {
  const st = region.settlement;
  if (!st) continue;
  for (const b of st.buildings) {
    const [x, z] = b.position;
    const base = scene.heightAtXZ(x, z);
    const mesh = scene.meshHeightAt(x, z);
    const half = Math.hypot(b.footprint[0], b.footprint[1]) / 2;
    let lo = Infinity; let hi = -Infinity;
    for (let a = 0; a < 16; a += 1) {
      const ang = (a / 16) * Math.PI * 2;
      for (const r of [half, half + 1, half + 2.5]) {
        const h = scene.meshHeightAt(x + Math.cos(ang) * r, z + Math.sin(ang) * r);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
    }
    const step = Math.max(Math.abs(base - lo), Math.abs(base - hi));
    if (step > worstStep) { worstStep = step; worstId = b.id; }
    if (step > 0.05) console.log(`${b.id.padEnd(28)} base=${base.toFixed(3)} mesh=${mesh.toFixed(3)} ring ${lo.toFixed(3)}..${hi.toFixed(3)} worstStep=${step.toFixed(3)}`);
  }
}
console.log(`worst ring step over all buildings: ${worstStep.toFixed(4)} m (${worstId})`);
// field vs mesh at the building origin
let worstFm = 0;
for (const region of REGIONS) {
  for (const b of region.settlement?.buildings ?? []) {
    const d = Math.abs(scene.heightAtXZ(b.position[0], b.position[1]) - scene.meshHeightAt(b.position[0], b.position[1]));
    worstFm = Math.max(worstFm, d);
  }
}
console.log(`worst |field - mesh| at a building origin: ${worstFm.toFixed(5)} m`);
