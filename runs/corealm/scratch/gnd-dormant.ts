import * as THREE from "three";
import { WorldScene, type FlatSpot } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";

// 1. setGroundStamps before buildWorld: roads + paving + water baked in one pass.
const scene = new WorldScene(new THREE.Scene());
const spec = buildWorldTerrainSpec();
scene.setGroundStamps({
  roads: [{ points: [[-300, 0, -40], [-180, 0, 20]], width: 3.2 }],
  paving: [{ centre: [-160, -80], halfExtents: [10, 10] }],
  water: [{ centre: [-40, -60], radius: 20, level: -0.5 }],
  seed: 0x1234,
});
const t0 = performance.now();
const chunks = scene.buildWorld(spec);
console.log("baked buildWorld ms", (performance.now() - t0).toFixed(0), "chunks", chunks.length);
console.log("buildRoad after stamps returns", scene.buildRoad([[-300, 0, -40], [-180, 0, 20]], 3.2, "fallowmarch"));
console.log("road polylines", scene.getRoadPolylines().length, "points", scene.getRoadPolylines()[0]?.length);

// Cobble coverage under the paving rect.
let cobbled = 0;
for (const mesh of chunks) {
  const b = mesh.geometry.getAttribute("aSplatB");
  for (let i = 0; i < b.count; i += 1) if (b.getZ(i) > 0.5) cobbled += 1;
}
console.log("vertices dominated by cobble under a 20 x 20 m paving rect:", cobbled);

// 2. meshHeightAt / normalAt.
console.log("meshHeightAt(-160,-80)", scene.meshHeightAt(-160, -80).toFixed(3), "field", scene.heightAtXZ(-160, -80).toFixed(3));
console.log("normalAt(-160,-80)", scene.normalAt(-160, -80).map((v) => v.toFixed(3)).join(","));

// 3. Contact decals.
const decals = scene.buildContactDecals([
  { position: [-160, 0, -80], radius: 0.7 },
  { position: [-150, 0, -70], radius: 1.4 },
]);
console.log("contact decals", decals?.name, "count", decals?.count, "material", decals?.material.type);

// 4. scatterInstanced, both the old call shape and the new one.
const source = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
const legacy = scene.scatterInstanced(source, [{ position: [0, 0, 0], rotationY: 0, scale: 1 }], "legacy");
const modern = scene.scatterInstanced(source, [
  { position: [1, 0, 0], rotationY: 0.4, scale: [1, 2, 1], normal: scene.normalAt(1, 0), tilt: 0.6 },
], "modern");
console.log("scatterInstanced legacy", legacy.length, "modern", modern.length);
const matrix = new THREE.Matrix4();
modern[0]!.getMatrixAt(0, matrix);
const scale = new THREE.Vector3();
matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
console.log("modern instance scale", scale.toArray().map((v) => v.toFixed(2)).join(","));

// 5. Rectangular flat pad: the Highcairn terrace case worldSpec will need.
const rectScene = new WorldScene(new THREE.Scene());
const rectSpec = buildWorldTerrainSpec();
const flats: FlatSpot[] = (rectSpec.flats ?? []).map((f) => (
  f.radius === 35 && f.x === 144
    ? { ...f, radius: 0, halfExtents: [34, 15] as const, rotationY: 0 }
    : f
));
rectScene.buildWorld({ ...rectSpec, flats });
let lo = Infinity;
let hi = -Infinity;
for (let dx = -32; dx <= 32; dx += 2) {
  for (let dz = -13; dz <= 13; dz += 2) {
    const h = rectScene.heightAtXZ(144 + dx, -66 + dz);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
}
console.log("rect pad relief inside 68 x 26 m:", (hi - lo).toFixed(4), "m");
const circle = new WorldScene(new THREE.Scene());
circle.buildWorld(buildWorldTerrainSpec());
console.log("terrace riser 30 m north of Highcairn: circular pad",
  (circle.heightAtXZ(144, -96) - circle.heightAtXZ(144, -66)).toFixed(2),
  "m / rect pad",
  (rectScene.heightAtXZ(144, -96) - rectScene.heightAtXZ(144, -66)).toFixed(2), "m");
