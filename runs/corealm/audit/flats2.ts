import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
const scene: any = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const flats = scene.flats as any[];
function trace(x: number, z: number) {
  console.log(`\n@(${x},${z}) natural=${scene.naturalHeight(x, z).toFixed(2)} final=${scene.heightAtXZ(x, z).toFixed(2)}`);
  let result = scene.naturalHeight(x, z); let cored = false;
  for (let i = 0; i < flats.length; i++) {
    const f = flats[i]; const d = Math.hypot(x - f.x, z - f.z);
    if (d > f.radius + f.blend) continue;
    const before = result;
    if (d <= f.radius) { result = f.height; cored = true; console.log(`  #${i} (${f.x},${f.z}) r=${f.radius} CORE d=${d.toFixed(2)} -> ${result.toFixed(2)}`); continue; }
    if (cored) { console.log(`  #${i} (${f.x},${f.z}) r=${f.radius} b=${f.blend.toFixed(1)} d=${d.toFixed(2)} SKIPPED (cored) target=${f.height.toFixed(2)}`); continue; }
    const t = (d - f.radius) / Math.max(0.001, f.blend);
    const w = 1 - (t * t * (3 - 2 * t));
    result = result + (f.height - result) * w;
    console.log(`  #${i} (${f.x},${f.z}) r=${f.radius} b=${f.blend.toFixed(1)} d=${d.toFixed(2)} w=${w.toFixed(4)} ${before.toFixed(2)} -> ${result.toFixed(2)} (target ${f.height.toFixed(2)})`);
  }
}
trace(253.3, -101.8);
trace(254.3, -101.8);
trace(245.7, -91.3);
trace(246.7, -91.3);
