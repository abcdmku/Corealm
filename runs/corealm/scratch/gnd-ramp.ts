import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";

const scene = new WorldScene(new THREE.Scene());
const spec = buildWorldTerrainSpec();
const meshes = scene.buildWorld(spec);

// Old formula, for the side-by-side: (h - baseHeight) / amplitude, clamped.
for (const region of spec.regions) {
  const def = REGIONS.find((r) => r.id === region.regionId)!;
  let lo = Infinity;
  let hi = -Infinity;
  let clampLow = 0;
  let clampHigh = 0;
  let n = 0;
  for (let x = region.rect.minX; x <= region.rect.maxX; x += 4) {
    for (let z = region.rect.minZ; z <= region.rect.maxZ; z += 4) {
      const h = scene.heightAtXZ(x, z);
      const t = (h - region.baseHeight) / Math.max(1, region.amplitude);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
      if (t <= 0) clampLow += 1;
      if (t >= 1) clampHigh += 1;
      n += 1;
    }
  }
  console.log(`${region.regionId.padEnd(12)} OLD ramp ${lo.toFixed(2)}..${hi.toFixed(2)} clampLow ${(clampLow / n * 100).toFixed(1)}% clampHigh ${(clampHigh / n * 100).toFixed(1)}%  (baseHeight ${def.baseHeight}, amplitude ${def.terrainAmplitude})`);
}

// New: distribution of the dry-grass weight, which is the ramp the shipped code uses.
const buckets = new Array(10).fill(0);
let count = 0;
let uniqueColours = new Map<string, number>();
for (const mesh of meshes) {
  const a = mesh.geometry.getAttribute("aSplatA");
  const colour = mesh.geometry.getAttribute("color");
  for (let i = 0; i < a.count; i += 1) {
    const grass = a.getX(i);
    const dry = a.getY(i);
    const total = grass + dry;
    if (total < 0.5) continue;
    const t = dry / total;
    buckets[Math.min(9, Math.floor(t * 10))] += 1;
    count += 1;
  }
  for (let i = 0; i < colour.count; i += 1) {
    const key = `${Math.round(colour.getX(i) * 255)},${Math.round(colour.getY(i) * 255)},${Math.round(colour.getZ(i) * 255)}`;
    uniqueColours.set(key, (uniqueColours.get(key) ?? 0) + 1);
  }
}
console.log("NEW altitude ramp, decile histogram over", count, "vegetated vertices:");
console.log("  " + buckets.map((b, i) => `${(i / 10).toFixed(1)}:${(b / count * 100).toFixed(1)}%`).join(" "));
const top = [...uniqueColours.entries()].sort((a, b) => b[1] - a[1])[0]!;
let totalVerts = 0;
for (const v of uniqueColours.values()) totalVerts += v;
console.log("most common exact vertex colour", top[0], "covers", (top[1] / totalVerts * 100).toFixed(2) + "% of terrain vertices (was 21.7%)");
console.log("distinct vertex colours", uniqueColours.size, "over", totalVerts, "vertices");
