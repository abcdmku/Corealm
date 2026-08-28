import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import type { Vec3 } from "../../../game/src/contracts.js";

const t0 = performance.now();
const scene = new WorldScene(new THREE.Scene());
const spec = buildWorldTerrainSpec();
const meshes = scene.buildWorld(spec);
const t1 = performance.now();
console.log("buildWorld ms", (t1 - t0).toFixed(0), "chunks", meshes.length);

// Roads, the way boot builds them.
let roads = 0;
for (const region of REGIONS) {
  const byId = new Map(region.locations.map((l) => [l.id, l]));
  for (const road of region.roads) {
    const from = byId.get(road.from);
    const to = byId.get(road.to);
    if (!from || !to) continue;
    const steps = Math.max(2, Math.ceil(Math.hypot(to.position[0] - from.position[0], to.position[1] - from.position[1]) / 6));
    const points: Vec3[] = [];
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = from.position[0] + (to.position[0] - from.position[0]) * t;
      const z = from.position[1] + (to.position[1] - from.position[1]) * t;
      points.push([x, scene.heightAt(region.id, x, z), z]);
    }
    if (scene.buildRoad(points, 3.2, region.id) !== null) roads += 1;
  }
}
const t2 = performance.now();
console.log("buildRoads ms", (t2 - t1).toFixed(0), "ribbon meshes drawn", roads, "polylines", scene.getRoadPolylines().length);

let waters = 0;
for (const region of REGIONS) {
  for (const cluster of region.clusters) {
    if (cluster.archetype !== "fishing_spot") continue;
    const [x, z] = cluster.centre;
    const half = cluster.radius + 14;
    const floor = scene.heightAt(region.id, x, z);
    scene.buildWater({ minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half }, floor + 0.9 * 0.55, region.id);
    waters += 1;
  }
}
const t3 = performance.now();
console.log("buildWater ms", (t3 - t2).toFixed(0), "bodies", waters);

// Splat coverage over the whole world.
const counts = { grass: 0, dry: 0, rock: 0, gravel: 0, dirt: 0, mud: 0, cobble: 0, wet: 0 };
const names = Object.keys(counts) as (keyof typeof counts)[];
let vertices = 0;
let colourDelta = 0;
let colourPairs = 0;
for (const mesh of meshes) {
  const a = mesh.geometry.getAttribute("aSplatA");
  const b = mesh.geometry.getAttribute("aSplatB");
  const colour = mesh.geometry.getAttribute("color");
  for (let i = 0; i < a.count; i += 1) {
    const w = [a.getX(i), a.getY(i), a.getZ(i), a.getW(i), b.getX(i), b.getY(i), b.getZ(i), b.getW(i)];
    for (let k = 0; k < 8; k += 1) if (w[k]! > 0.5) counts[names[k]!] += 1;
    vertices += 1;
  }
  // Adjacent-vertex colour delta along a row, the metric the diagnosis measured at 0.00140 of 3.0.
  const side = Math.round(Math.sqrt(colour.count));
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col + 1 < side; col += 1) {
      const i = row * side + col;
      const j = i + 1;
      colourDelta += Math.abs(colour.getX(i) - colour.getX(j)) + Math.abs(colour.getY(i) - colour.getY(j)) + Math.abs(colour.getZ(i) - colour.getZ(j));
      colourPairs += 1;
    }
  }
}
console.log("terrain vertices", vertices);
for (const name of names) console.log("  dominant", name.padEnd(7), ((counts[name] / vertices) * 100).toFixed(2) + "%");
console.log("mean adjacent vertex colour delta", (colourDelta / colourPairs).toFixed(5), "of 3.0 =", ((colourDelta / colourPairs / 3) * 255).toFixed(2), "of 255 per channel per 2 m");

const water = scene.scatterGroup.children.filter((o) => o.name.startsWith("water-"));
console.log("water meshes", water.length, "road meshes", scene.scatterGroup.children.filter((o) => o.name.startsWith("road-")).length);
for (const w of water) {
  const geo = (w as THREE.Mesh).geometry;
  const depth = geo.getAttribute("aWaterDepth");
  let maxDepth = 0;
  for (let i = 0; i < depth.count; i += 1) maxDepth = Math.max(maxDepth, depth.getX(i));
  console.log("  ", w.name, "verts", geo.getAttribute("position").count, "max depth", maxDepth.toFixed(2));
}
