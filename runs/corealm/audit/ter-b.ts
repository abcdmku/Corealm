import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";

const root = new THREE.Scene();
const scene = new WorldScene(root);
const spec = buildWorldTerrainSpec();
// natural-only scene for comparison
const bare = new WorldScene(new THREE.Scene());
bare.buildWorld({ ...spec, flats: [] });
scene.buildWorld(spec);

function profile(label: string, a: [number, number], b: [number, number]) {
  console.log("\n== " + label + " ==");
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.round(len / 2);
  const rows: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    rows.push(`${(t * len).toFixed(0)}m nat=${bare.heightAtXZ(x, z).toFixed(2)} flat=${scene.heightAtXZ(x, z).toFixed(2)}`);
  }
  console.log(rows.join("\n"));
}
profile("moor_road_bend(170,-6) -> highcairn(144,-66)", [170, -6], [144, -66]);
profile("terraces(60,-16) -> gravelmaw(46,-24)", [60, -16], [46, -24]);
profile("highcairn_bank(150,-70) -> ramp_two(100,-80)", [150, -70], [100, -80]);
profile("ramp_three(118,-138) -> great_cairn(140,-176)", [118, -138], [140, -176]);
