import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec, WATER_BASIN_DEPTH } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const meshes = scene.getWalkableMeshes();
for (const m of meshes) m.updateMatrixWorld(true);
const ray = new THREE.Raycaster(); ray.far = 5000;
const down = new THREE.Vector3(0, -1, 0);
const groundAt = (x: number, z: number) => {
  ray.set(new THREE.Vector3(x, 2000, z), down);
  const h = ray.intersectObjects(meshes, false);
  return h.length ? h[0]!.point.y : NaN;
};
console.log("DRAWN water discs vs the drawn ground");
for (const region of REGIONS) {
  for (const cluster of region.clusters) {
    if (cluster.archetype !== "fishing_spot") continue;
    const [x, z] = cluster.centre;
    const half = cluster.radius + 14;
    const floor = scene.heightAt(region.id, x, z);
    const level = floor + WATER_BASIN_DEPTH * 0.55;
    const mesh = scene.buildWater({ minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half }, level, region.id);
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const depth = mesh.geometry.getAttribute("aWaterDepth") as THREE.BufferAttribute;
    let above = 0; let maxAbove = 0; let maxR = 0; let minR = Infinity; let negDepth = 0;
    for (let i = 0; i < pos.count; i += 1) {
      const wx = x + pos.getX(i); const wz = z + pos.getZ(i);
      const g = groundAt(wx, wz);
      if (g > level) { above += 1; maxAbove = Math.max(maxAbove, g - level); }
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      maxR = Math.max(maxR, r); minR = Math.min(minR, r);
      if (depth.getX(i) <= 0.001) negDepth += 1;
    }
    // per-azimuth shoreline, read back off the drawn rim ring
    const rings = 10;
    const shore: number[] = [];
    for (let a = 0; a < 32; a += 1) {
      const i = 1 + a * rings + (rings - 1);
      shore.push(Math.hypot(pos.getX(i), pos.getZ(i)));
    }
    console.log("  shoreline radii: " + shore.map((v) => v.toFixed(1)).join(" "));
    // sample the DRAWN polygon interior on a 1 m grid
    let gAbove = 0; let gTotal = 0; let gMax = 0;
    for (let dx = -maxR; dx <= maxR; dx += 1) for (let dz = -maxR; dz <= maxR; dz += 1) {
      const r = Math.hypot(dx, dz);
      let ang = Math.atan2(dz, dx); if (ang < 0) ang += Math.PI * 2;
      const f = (ang / (Math.PI * 2)) * 32;
      const i0 = Math.floor(f) % 32; const i1 = (i0 + 1) % 32; const t = f - Math.floor(f);
      const limit = shore[i0]! + (shore[i1]! - shore[i0]!) * t;
      if (r > limit) continue;
      gTotal += 1;
      const g = groundAt(x + dx, z + dz);
      if (g > level) { gAbove += 1; gMax = Math.max(gMax, g - level); }
    }
    console.log(`${cluster.id.padEnd(20)} nominalR=${half} drawnR=${maxR.toFixed(1)} level=${level.toFixed(2)} vertsAboveWater=${above}/${pos.count} max=+${maxAbove.toFixed(2)}m  discFootprint above=${((gAbove / gTotal) * 100).toFixed(0)}% max=+${gMax.toFixed(2)}m  zeroDepthVerts=${negDepth}`);
  }
}
