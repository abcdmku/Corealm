import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { Navigation } from "../../../game/src/systems/navigation.js";
import type { Vec3 } from "../../../game/src/contracts.js";
await Navigation.initLibrary();
const scene = new WorldScene(new THREE.Scene());
const spec = buildWorldTerrainSpec();
scene.buildWorld(spec);
const nav = new Navigation();
nav.build(scene.getWalkableMeshes());
// Empirical: for each slope bucket, what fraction of points are ON the navmesh?
const buckets = new Map<number, { on: number; total: number }>();
const b = spec.bounds;
for (let x = b.minX + 3; x < b.maxX - 3; x += 3.3) {
  for (let z = b.minZ + 3; z < b.maxZ - 3; z += 3.3) {
    const y = scene.heightAtXZ(x, z);
    const s = scene.slopeAt(x, z, 0.9);
    const key = Math.min(20, Math.floor(s / 0.1));
    const p: Vec3 = [x, y, z];
    const snapped = nav.closestPoint(p);
    const on = snapped !== null && Math.hypot(snapped[0] - x, snapped[1] - y, snapped[2] - z) < 0.7;
    const entry = buckets.get(key) ?? { on: 0, total: 0 };
    entry.total += 1; if (on) entry.on += 1;
    buckets.set(key, entry);
  }
}
console.log("slope bucket -> fraction of samples that land ON the navmesh");
for (const key of [...buckets.keys()].sort((p, q) => p - q)) {
  const e = buckets.get(key)!;
  console.log(`${(key * 0.1).toFixed(1)}-${(key * 0.1 + 0.1).toFixed(1)}  n=${String(e.total).padStart(5)}  onMesh=${((e.on / e.total) * 100).toFixed(1)}%`);
}
