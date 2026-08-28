import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";

const root = new THREE.Scene();
const scene = new WorldScene(root);
const spec = buildWorldTerrainSpec();
const authored = (buildWorldTerrainSpec().flats ?? []).map((f) => ({ ...f }));
scene.buildWorld(spec);
const flats = spec.flats ?? [];

console.log("pads with radius >= 20 (settlements):");
for (const [i, f] of flats.entries()) {
  if (f.radius >= 20) console.log(" ", i, f.x, f.z, "r", f.radius, "blend", f.blend.toFixed(1), "h", f.height?.toFixed(2));
}
console.log("authored blends for the same pads:");
for (const [i, f] of authored.entries()) {
  if (f.radius >= 20) console.log(" ", i, f.x, f.z, "r", f.radius, "blend", f.blend);
}

for (const [i, f] of flats.entries()) {
  const a = authored[i]!;
  if (Math.abs(f.blend - a.blend) > 0.05) {
    console.log("widened", i, `(${f.x},${f.z}) r${f.radius}`, a.blend, "->", f.blend.toFixed(1), f.height !== undefined ? `h ${a.height} -> ${f.height.toFixed(2)}` : "");
  }
}

const probe = (cx: number, cz: number, label: string): void => {
  console.log(`\n== radial profile at ${label} (${cx},${cz}) ==`);
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const row: string[] = [];
    for (let d = 0; d <= 40; d += 4) {
      row.push(scene.heightAtXZ(cx + Math.cos(angle) * d, cz + Math.sin(angle) * d).toFixed(1));
    }
    console.log(" ang", angle.toFixed(2), row.join(" "));
  }
  let worst = 0;
  let at: [number, number] = [0, 0];
  for (let dx = -40; dx <= 40; dx += 1) {
    for (let dz = -40; dz <= 40; dz += 1) {
      const s = scene.slopeAt(cx + dx, cz + dz);
      if (s > worst) { worst = s; at = [cx + dx, cz + dz]; }
    }
  }
  console.log(" worst slope nearby", worst.toFixed(2), "at", at.join(","));
};

probe(-72, -146, "vellenwood pad 10");
probe(161.3, -20.8, "global worst");

// Settlement pad relief, using the real pad centres and radii.
for (const [i, f] of flats.entries()) {
  if (f.radius < 20) continue;
  let lo = Infinity;
  let hi = -Infinity;
  for (let a = 0; a < 64; a += 1) {
    const ang = (a / 64) * Math.PI * 2;
    for (let d = 0; d <= f.radius; d += 2) {
      const h = scene.heightAtXZ(f.x + Math.cos(ang) * d, f.z + Math.sin(ang) * d);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  console.log(`pad ${i} (${f.x},${f.z}) r${f.radius} relief ${(hi - lo).toFixed(4)} m`);
}
