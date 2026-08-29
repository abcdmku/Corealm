import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
const scene = new WorldScene(new THREE.Scene());
const spec = buildWorldTerrainSpec();
scene.buildWorld(spec);
const bare = new WorldScene(new THREE.Scene());
bare.buildWorld({ ...spec, flats: [] });

// corridor ramp_two(100,-80) -> ramp_three(118,-138)
const a = [100, -80], b = [118, -138];
const L = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
const ux = (b[0]! - a[0]!) / L, uz = (b[1]! - a[1]!) / L;
console.log("along-corridor profile (t, x, z, natural, final, cut)");
for (let t = 0; t <= L; t += 3) {
  const x = a[0]! + ux * t, z = a[1]! + uz * t;
  const n = bare.heightAtXZ(x, z), f = scene.heightAtXZ(x, z);
  console.log(`${t.toFixed(0)}\t${x.toFixed(1)}\t${z.toFixed(1)}\t${n.toFixed(2)}\t${f.toFixed(2)}\t${(f - n).toFixed(2)}\tslope=${scene.slopeAt(x, z, 1).toFixed(2)}`);
}
console.log("\ncross-section at the worst point (101.9,-99.1), perpendicular offset -30..30");
const cx = 101.9, cz = -99.1;
for (let o = -30; o <= 30; o += 2) {
  const x = cx - uz * o, z = cz + ux * o;
  console.log(`${o}\t${scene.heightAtXZ(x, z).toFixed(2)}\tnat=${bare.heightAtXZ(x, z).toFixed(2)}\tslope=${scene.slopeAt(x, z, 1).toFixed(2)}`);
}
