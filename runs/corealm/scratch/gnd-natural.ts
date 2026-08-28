import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";

const spec = buildWorldTerrainSpec();
const bare = new WorldScene(new THREE.Scene());
bare.buildWorld({ ...spec, flats: [] });
const full = new WorldScene(new THREE.Scene());
full.buildWorld(buildWorldTerrainSpec());

const b = spec.bounds;
let steepNatural = 0;
let maxNatural = 0;
let atNatural: [number, number] = [0, 0];
let n = 0;
for (let x = b.minX + 1; x < b.maxX - 1; x += 2.7) {
  for (let z = b.minZ + 1; z < b.maxZ - 1; z += 2.7) {
    const s = bare.slopeAt(x, z);
    n += 1;
    if (s > 1) steepNatural += 1;
    if (s > maxNatural) { maxNatural = s; atNatural = [x, z]; }
  }
}
console.log("NATURAL field only: samples", n, "steep>45deg", steepNatural, "max", maxNatural.toFixed(2), "at", atNatural.map((v) => v.toFixed(1)).join(","));

for (const [cx, cz] of [[161.3, -20.8], [-72, -146], [-40, -60]] as [number, number][]) {
  const row: string[] = [];
  for (let d = -12; d <= 12; d += 2) row.push(`${bare.heightAtXZ(cx, cz + d).toFixed(1)}/${full.heightAtXZ(cx, cz + d).toFixed(1)}`);
  console.log(`z sweep at x=${cx} (natural/flattened):`, row.join(" "));
}
