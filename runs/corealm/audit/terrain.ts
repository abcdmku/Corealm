import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import fs from "node:fs";

const root = new THREE.Scene();
const scene = new WorldScene(root);
const spec = buildWorldTerrainSpec();
scene.buildWorld(spec);
const meshes = scene.getWalkableMeshes();
console.log("walkable meshes", meshes.length);
for (const m of meshes) { m.updateMatrixWorld(true); }

const ray = new THREE.Raycaster();
ray.far = 5000;
const down = new THREE.Vector3(0, -1, 0);

function meshHeight(x: number, z: number): number | null {
  ray.set(new THREE.Vector3(x, 500, z), down);
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? hits[0]!.point.y : null;
}

const b = spec.bounds;
let worst = { d: 0, x: 0, z: 0, field: 0, mesh: 0 };
let worstBelow = { d: 0, x: 0, z: 0 };  // mesh below field  (entity floats)
let worstAbove = { d: 0, x: 0, z: 0 };  // mesh above field  (entity buried)
const hist: Record<string, number> = {};
let n = 0; let sum = 0;
const step = 0.37; // irrational-ish stride so we do not land on grid points
for (let x = b.minX + 1; x < b.maxX - 1; x += step * 7.3) {
  for (let z = b.minZ + 1; z < b.maxZ - 1; z += step * 7.3) {
    const f = scene.heightAtXZ(x, z);
    const m = meshHeight(x, z);
    if (m === null) continue;
    const d = m - f;  // + = mesh above field = things placed at field are buried
    n += 1; sum += Math.abs(d);
    if (Math.abs(d) > Math.abs(worst.d)) worst = { d, x, z, field: f, mesh: m };
    if (d < worstBelow.d) worstBelow = { d, x, z };
    if (d > worstAbove.d) worstAbove = { d, x, z };
    const bucket = Math.abs(d) < 0.01 ? "<1cm" : Math.abs(d) < 0.05 ? "1-5cm" : Math.abs(d) < 0.1 ? "5-10cm" : Math.abs(d) < 0.25 ? "10-25cm" : Math.abs(d) < 0.5 ? "25-50cm" : ">50cm";
    hist[bucket] = (hist[bucket] ?? 0) + 1;
  }
}
console.log("samples", n, "meanAbsErr", (sum / n).toFixed(4));
console.log("hist", JSON.stringify(hist));
console.log("worst", JSON.stringify(worst));
console.log("mesh below field (float) worst", JSON.stringify(worstBelow));
console.log("mesh above field (bury) worst", JSON.stringify(worstAbove));

// Now: at every entity XZ, mesh vs field.
const ents = JSON.parse(fs.readFileSync("runs/corealm/audit/grounding.json", "utf8")).rows;
const per: any[] = [];
for (const e of ents) {
  const m = meshHeight(e.px, e.pz);
  if (m === null) continue;
  per.push({ id: e.id, arch: e.arch, asset: e.asset, field: e.py, mesh: +m.toFixed(3), d: +(m - e.py).toFixed(3), drawMin: e.minY });
}
per.sort((a, c) => c.d - a.d);
console.log("=== entity XZ: mesh - field, worst buried (mesh above) ===");
for (const p of per.slice(0, 12)) console.log(p.id.padEnd(30), p.arch.padEnd(10), "d=" + p.d);
console.log("=== worst floating (mesh below field) ===");
for (const p of per.slice(-12)) console.log(p.id.padEnd(30), p.arch.padEnd(10), "d=" + p.d);
const ds = per.map((p) => p.d);
console.log("entity mesh-field: mean", (ds.reduce((a, c) => a + Math.abs(c), 0) / ds.length).toFixed(4), "max", Math.max(...ds).toFixed(3), "min", Math.min(...ds).toFixed(3));
fs.writeFileSync("runs/corealm/audit/terrain.json", JSON.stringify({ hist, worst, per }, null, 1));
