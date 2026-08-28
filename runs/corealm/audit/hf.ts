import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
const scene: any = new WorldScene(new THREE.Scene());
const spec = buildWorldTerrainSpec();
scene.buildWorld(spec);
const b = spec.bounds;
const width = b.maxX - b.minX, depth = b.maxZ - b.minZ;
console.log("world bounds", JSON.stringify(b), "width", width, "depth", depth);
const cols = Math.max(1, Math.round(width / spec.chunkSize)), rows = Math.max(1, Math.round(depth / spec.chunkSize));
console.log("chunk grid", cols, "x", rows, "chunkX", width / cols, "chunkZ", depth / rows,
  "segX", Math.round((width / cols) / spec.metresPerQuad), "segZ", Math.round((depth / rows) / spec.metresPerQuad),
  "-> mesh quad", (width / cols) / Math.round((width / cols) / spec.metresPerQuad), "x", (depth / rows) / Math.round((depth / rows) / spec.metresPerQuad));
const hf = scene.heightfieldSamples();
console.log("heightfield ncols", hf.ncols, "nrows", hf.nrows, "-> spacing", width / hf.ncols, "x", depth / hf.nrows, "scale", JSON.stringify(hf.scale), "centre", JSON.stringify(hf.centre));
// max disagreement between rapier bilinear heightfield and analytic field
function hfHeight(x: number, z: number): number {
  const cx = (x - b.minX) / width * hf.ncols;
  const cz = (z - b.minZ) / depth * hf.nrows;
  const c0 = Math.min(hf.ncols - 1, Math.max(0, Math.floor(cx))), r0 = Math.min(hf.nrows - 1, Math.max(0, Math.floor(cz)));
  const fx = cx - c0, fz = cz - r0;
  const at = (c: number, r: number) => hf.heights[c * (hf.nrows + 1) + r] as number;
  return at(c0, r0) * (1 - fx) * (1 - fz) + at(c0 + 1, r0) * fx * (1 - fz) + at(c0, r0 + 1) * (1 - fx) * fz + at(c0 + 1, r0 + 1) * fx * fz;
}
let worst = 0, wp: any = null, sum = 0, n = 0;
for (let x = b.minX + 0.7; x < b.maxX - 1; x += 1.7) for (let z = b.minZ + 0.7; z < b.maxZ - 1; z += 1.7) {
  const d = hfHeight(x, z) - scene.heightAtXZ(x, z); n++; sum += Math.abs(d);
  if (Math.abs(d) > Math.abs(worst)) { worst = d; wp = [+x.toFixed(1), +z.toFixed(1)]; }
}
console.log("physics heightfield vs analytic field: n", n, "meanAbs", (sum / n).toFixed(4), "worst", worst.toFixed(3), "at", JSON.stringify(wp));
