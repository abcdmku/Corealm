import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";

const root = new THREE.Scene();
const scene = new WorldScene(root);
const spec = buildWorldTerrainSpec();
const t0 = Date.now();
scene.buildWorld(spec);
console.log("buildWorld ms", Date.now() - t0);

const meshes = scene.getWalkableMeshes();
for (const m of meshes) m.updateMatrixWorld(true);
const ray = new THREE.Raycaster(); ray.far = 5000;
const down = new THREE.Vector3(0, -1, 0);
const mh = (x: number, z: number) => {
  ray.set(new THREE.Vector3(x, 2000, z), down);
  const h = ray.intersectObjects(meshes, false);
  return h.length ? h[0]!.point.y : NaN;
};

// --- A. analytic slope over the world
const b = spec.bounds;
let steep = 0, n = 0, maxSlope = 0; let ms: [number, number] = [0, 0];
for (let x = b.minX + 1; x < b.maxX - 1; x += 2.7) {
  for (let z = b.minZ + 1; z < b.maxZ - 1; z += 2.7) {
    const s = scene.slopeAt(x, z); n += 1;
    if (s > 1) steep += 1;
    if (s > maxSlope) { maxSlope = s; ms = [x, z]; }
  }
}
console.log(`analytic slope: n=${n} over45deg=${steep} max=${maxSlope.toFixed(2)} at (${ms[0].toFixed(1)},${ms[1].toFixed(1)})`);

// --- B. mesh vs field
let sum = 0, cnt = 0, over50 = 0, worst = 0; let wa: [number, number] = [0, 0];
for (let x = b.minX + 1; x < b.maxX - 1; x += 2.7) {
  for (let z = b.minZ + 1; z < b.maxZ - 1; z += 2.7) {
    const d = Math.abs(mh(x, z) - scene.heightAtXZ(x, z));
    if (!Number.isFinite(d)) continue;
    sum += d; cnt += 1;
    if (d > 0.5) over50 += 1;
    if (d > worst) { worst = d; wa = [x, z]; }
  }
}
console.log(`mesh vs field: n=${cnt} meanAbs=${(sum / cnt).toFixed(4)} over0.5m=${over50} worst=${worst.toFixed(3)} at (${wa[0].toFixed(1)},${wa[1].toFixed(1)})`);

// --- C. triangle slope of the drawn mesh (what recast sees)
let triMax = 0; let triAt: [number, number] = [0, 0]; let triOver = 0; let triN = 0;
const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
const LIMIT = Math.cos((48 * Math.PI) / 180);
for (const mesh of meshes) {
  const g = mesh.geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const idx = g.getIndex()!;
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
    va.fromBufferAttribute(pos, ia); vb.fromBufferAttribute(pos, ib); vc.fromBufferAttribute(pos, ic);
    e1.subVectors(vb, va); e2.subVectors(vc, va); nrm.crossVectors(e1, e2).normalize();
    const cosT = Math.abs(nrm.y);
    triN += 1;
    if (cosT < LIMIT) triOver += 1;
    const slope = Math.hypot(nrm.x, nrm.z) / Math.max(1e-6, Math.abs(nrm.y));
    if (slope > triMax) {
      triMax = slope;
      triAt = [(va.x + vb.x + vc.x) / 3 + mesh.position.x, (va.z + vb.z + vc.z) / 3 + mesh.position.z];
    }
  }
}
console.log(`mesh triangles: n=${triN} steeperThan48deg=${triOver} (${((triOver / triN) * 100).toFixed(2)}%) maxSlope=${triMax.toFixed(2)}=${((Math.atan(triMax) * 180) / Math.PI).toFixed(1)}deg at (${triAt[0].toFixed(1)},${triAt[1].toFixed(1)})`);

// --- D. route corridors
const WALK = Math.tan((48 * Math.PI) / 180);
console.log("\n-- authored routes, worst mesh-triangle-scale slope along a 6 m wide corridor --");
for (const region of REGIONS) {
  const byId = new Map(region.locations.map((l) => [l.id, l.position as [number, number]]));
  for (const road of region.roads) {
    const pa = byId.get(road.from); const pb = byId.get(road.to);
    if (!pa || !pb) continue;
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const steps = Math.max(2, Math.round(len));
    // Best walkable lane: for each cross-section offset, track the max slope along it.
    const OFFSETS = [-3, -1.5, 0, 1.5, 3];
    const ux = (pb[0] - pa[0]) / len, uz = (pb[1] - pa[1]) / len;
    let bestLane = Infinity; let bestOff = 0;
    for (const off of OFFSETS) {
      let laneMax = 0;
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const x = pa[0] + (pb[0] - pa[0]) * t - uz * off;
        const z = pa[1] + (pb[1] - pa[1]) * t + ux * off;
        laneMax = Math.max(laneMax, scene.slopeAt(x, z, 1.0));
      }
      if (laneMax < bestLane) { bestLane = laneMax; bestOff = off; }
    }
    const flag = bestLane > WALK ? "  <<< BLOCKED" : "";
    console.log(`${region.id}: ${road.from} -> ${road.to}  bestLane off=${bestOff} maxSlope=${bestLane.toFixed(2)}=${((Math.atan(bestLane) * 180) / Math.PI).toFixed(1)}deg${flag}`);
  }
}

// --- E. water discs
console.log("\n-- water footprints --");
for (const region of REGIONS) {
  for (const cluster of region.clusters) {
    if (cluster.archetype !== "fishing_spot") continue;
    const [cx, cz] = cluster.centre;
    const floor = scene.heightAtXZ(cx, cz);
    const level = floor + 0.9 * 0.55;
    const radius = cluster.radius + 14;
    let above = 0, total = 0, maxAbove = 0;
    for (let x = cx - radius; x <= cx + radius; x += 2) {
      for (let z = cz - radius; z <= cz + radius; z += 2) {
        if (Math.hypot(x - cx, z - cz) > radius) continue;
        total += 1;
        const g = mh(x, z);
        if (g > level) { above += 1; maxAbove = Math.max(maxAbove, g - level); }
      }
    }
    console.log(`${cluster.id}: r=${radius} level=${level.toFixed(2)} aboveWater=${((above / total) * 100).toFixed(0)}% max=+${maxAbove.toFixed(2)}m`);
  }
}
