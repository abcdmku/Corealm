import * as THREE from "three";
import { solidObstacleMeshes } from "../../../game/src/systems/navigation.js";
import type { SolidVolume } from "../../../game/src/contracts.js";

const volumes: SolidVolume[] = [
  { kind: "box", id: "hall", position: [-160, 1, -60], size: [12, 8, 8], rotationY: 0.3 },
  { kind: "cylinder", id: "trunk", position: [20, 0, 0], radius: 0.6, height: 6 },
  { kind: "box", id: "chest", position: [-160, 1, -88], size: [1.2, 0.8, 0.8], rotationY: 0 },
];

const meshes = solidObstacleMeshes(volumes);
let tris = 0;
for (const m of meshes) {
  const box = new THREE.Box3().setFromObject(m);
  const index = m.geometry.getIndex()!;
  tris += index.count / 3;
  const position = m.geometry.getAttribute("position");
  // Any triangle whose normal has |y| > 0.01 would be a cap; there must be none.
  let capped = 0;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position as THREE.BufferAttribute, index.getX(i));
    b.fromBufferAttribute(position as THREE.BufferAttribute, index.getX(i + 1));
    c.fromBufferAttribute(position as THREE.BufferAttribute, index.getX(i + 2));
    n.copy(c).sub(b).cross(a.clone().sub(b)).normalize();
    if (Math.abs(n.y) > 0.01) capped += 1;
  }
  console.log(
    m.name,
    "tris", index.count / 3,
    "visible", m.visible,
    "horizontal-faces", capped,
    "bbox y", +box.min.y.toFixed(3), "->", +box.max.y.toFixed(3),
    "bbox x", +box.min.x.toFixed(2), "->", +box.max.x.toFixed(2),
  );
}
console.log("total carve triangles for 3 volumes:", tris, "-> per 900 volumes ~", Math.round(tris / 3 * 900));
