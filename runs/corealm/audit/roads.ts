import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";
const scene: any = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const meshes = scene.getWalkableMeshes(); for (const m of meshes) m.updateMatrixWorld(true);
const ray = new THREE.Raycaster(); ray.far = 5000; const down = new THREE.Vector3(0, -1, 0);
const mh = (x: number, z: number) => { ray.set(new THREE.Vector3(x, 900, z), down); const h = ray.intersectObjects(meshes, false); return h.length ? h[0]!.point.y : NaN; };
const LIFT = 0.02;
let n = 0, buried = 0, worst = 0, wp: any = null; const gaps: number[] = [];
for (const region of REGIONS as any[]) {
  const loc = new Map(region.locations.map((l: any) => [l.id, l]));
  for (const road of region.roads) {
    const a: any = loc.get(road.from), b: any = loc.get(road.to); if (!a || !b) continue;
    const len = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]);
    const steps = Math.max(2, Math.ceil(len / 3));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.position[0] + (b.position[0] - a.position[0]) * t;
      const z = a.position[1] + (b.position[1] - a.position[1]) * t;
      const roadY = scene.heightAtXZ(x, z) + LIFT;
      const groundY = mh(x, z); if (Number.isNaN(groundY)) continue;
      const gap = roadY - groundY; gaps.push(gap); n++;
      if (gap < -0.001) buried++;
      if (Math.abs(gap) > Math.abs(worst)) { worst = gap; wp = [region.id, road.from + "->" + road.to, +x.toFixed(1), +z.toFixed(1)]; }
    }
  }
}
gaps.sort((x, y) => x - y);
console.log("road vertices sampled", n, "below the terrain mesh (invisible):", buried, (100 * buried / n).toFixed(1) + "%");
console.log("gap p1", gaps[Math.floor(n * 0.01)]!.toFixed(3), "p10", gaps[Math.floor(n * 0.1)]!.toFixed(3), "median", gaps[n >> 1]!.toFixed(3), "p90", gaps[Math.floor(n * 0.9)]!.toFixed(3));
console.log("worst", worst.toFixed(3), JSON.stringify(wp));
// water
for (const region of REGIONS as any[]) {
  for (const c of region.clusters.filter((c: any) => c.archetype === "fishing_spot")) {
    const [x, z] = c.centre; const floor = scene.heightAtXZ(x, z); const surface = floor + 0.9 * 0.55;
    const half = c.radius + 14;
    let above = 0, tot = 0, maxAbove = 0;
    for (let dx = -half; dx <= half; dx += 2) for (let dz = -half; dz <= half; dz += 2) {
      const g = mh(x + dx, z + dz); if (Number.isNaN(g)) continue; tot++;
      if (g > surface) { above++; maxAbove = Math.max(maxAbove, g - surface); }
    }
    console.log(`water ${c.id} centre=(${x},${z}) floor=${floor.toFixed(2)} surface=${surface.toFixed(2)} halfExtent=${half}  ground-above-water ${(100 * above / tot).toFixed(0)}% maxAbove=${maxAbove.toFixed(2)}`);
  }
}
