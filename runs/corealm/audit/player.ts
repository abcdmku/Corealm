import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
const scene: any = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const meshes = scene.getWalkableMeshes(); for (const m of meshes) m.updateMatrixWorld(true);
const ray = new THREE.Raycaster(); ray.far = 5000; const down = new THREE.Vector3(0, -1, 0);
const mh = (x: number, z: number) => { ray.set(new THREE.Vector3(x, 900, z), down); const h = ray.intersectObjects(meshes, false); return h.length ? h[0]!.point.y : NaN; };
for (const [x, z, y, label] of [[236, -85, 10.572, "ridge pines"], [284, -110, 7.441, "far tarn"], [172, 106.9, 2.974, "fallen duskoak"], [-160, -80, 1.041, "coldbrace square"]] as any[]) {
  console.log(label.padEnd(16), "navmeshY=" + y, "field=" + scene.heightAtXZ(x, z).toFixed(3), "mesh=" + mh(x, z).toFixed(3), "player above mesh=" + (y - mh(x, z)).toFixed(3));
}
