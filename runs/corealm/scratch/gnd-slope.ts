import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";

const root = new THREE.Scene();
const scene = new WorldScene(root);
const spec = buildWorldTerrainSpec();
scene.buildWorld(spec);

const flats = spec.flats ?? [];
const b = spec.bounds;
const steep: { x: number; z: number; s: number }[] = [];
let n = 0;
let maxSlope = 0;
let worst: [number, number] = [0, 0];
for (let x = b.minX + 1; x < b.maxX - 1; x += 2.7) {
  for (let z = b.minZ + 1; z < b.maxZ - 1; z += 2.7) {
    const s = scene.slopeAt(x, z);
    n += 1;
    if (s > 1) steep.push({ x, z, s });
    if (s > maxSlope) { maxSlope = s; worst = [x, z]; }
  }
}
console.log("samples", n, "steep>45deg", steep.length, "max", maxSlope.toFixed(2), "at", worst.map((v) => v.toFixed(1)).join(","));

// Which flat is nearest each steep sample, and how far past its core?
const buckets = new Map<string, number>();
for (const p of steep) {
  let best = "none";
  let bestD = Infinity;
  for (const [i, f] of flats.entries()) {
    const d = Math.hypot(p.x - f.x, p.z - f.z) - f.radius;
    if (d < bestD) { bestD = d; best = `${i}@${f.x},${f.z} r${f.radius} b${f.blend.toFixed(1)}${f.height !== undefined ? " h" + f.height.toFixed(1) : ""}`; }
  }
  const key = bestD < 60 ? best : "no pad within 60 m";
  buckets.set(key, (buckets.get(key) ?? 0) + 1);
}
const rows = [...buckets.entries()].sort((a, b2) => b2[1] - a[1]);
for (const [key, count] of rows.slice(0, 14)) console.log(String(count).padStart(5), key);

// Settlement pad flatness: 64 rays x 2 m
for (const [label, cx, cz, r] of [["coldbrace", -232, 8, 48], ["rootfall", -8, 22, 35], ["highcairn", 144, -66, 35]] as [string, number, number, number][]) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let a = 0; a < 64; a += 1) {
    const ang = (a / 64) * Math.PI * 2;
    for (let d = 0; d <= r; d += 2) {
      const h = scene.heightAtXZ(cx + Math.cos(ang) * d, cz + Math.sin(ang) * d);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  console.log(`${label} pad relief ${(hi - lo).toFixed(4)} m over r=${r}`);
}

// Mesh vs field disagreement, and how many terrain vertices sit far off.
const meshes = scene.getWalkableMeshes();
for (const m of meshes) m.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
ray.far = 5000;
const down = new THREE.Vector3(0, -1, 0);
let over50 = 0;
let sum = 0;
let count = 0;
for (let x = b.minX + 3; x < b.maxX - 3; x += 2.7) {
  for (let z = b.minZ + 3; z < b.maxZ - 3; z += 2.7) {
    ray.set(new THREE.Vector3(x, 900, z), down);
    const hit = ray.intersectObjects(meshes, false);
    if (!hit.length) continue;
    const d = Math.abs(hit[0]!.point.y - scene.heightAtXZ(x, z));
    sum += d;
    count += 1;
    if (d > 0.5) over50 += 1;
  }
}
console.log("mesh vs field: samples", count, "meanAbs", (sum / count).toFixed(4), "over 0.5 m", over50);
