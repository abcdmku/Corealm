import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import fs from "node:fs";

const root = new THREE.Scene();
const scene = new WorldScene(root);
const spec = buildWorldTerrainSpec();
scene.buildWorld(spec);
const meshes = scene.getWalkableMeshes();
for (const m of meshes) m.updateMatrixWorld(true);
const ray = new THREE.Raycaster(); ray.far = 5000;
const down = new THREE.Vector3(0, -1, 0);
const mh = (x: number, z: number) => { ray.set(new THREE.Vector3(x, 900, z), down); const h = ray.intersectObjects(meshes, false); return h.length ? h[0]!.point.y : null; };

console.log("--- probe (253,-101) neighbourhood: field vs mesh ---");
for (let dx = -4; dx <= 4; dx += 1) {
  const row: string[] = [];
  for (let dz = -4; dz <= 4; dz += 2) {
    const x = 253.323 + dx, z = -101.764 + dz;
    row.push(`${scene.heightAtXZ(x, z).toFixed(1)}/${(mh(x, z) ?? NaN).toFixed(1)}`);
  }
  console.log((253.323 + dx).toFixed(1), row.join("  "));
}

// per-entity terrain error, surface only
const ents = JSON.parse(fs.readFileSync("runs/corealm/audit/grounding.json", "utf8")).rows;
const per: any[] = [];
for (const e of ents) {
  if (e.region === "gravelmaw") continue;
  const f = scene.heightAtXZ(e.px, e.pz);
  const m = mh(e.px, e.pz);
  if (m === null) continue;
  per.push({ id: e.id, arch: e.arch, part: e.id.includes("#"), field: +f.toFixed(3), mesh: +m.toFixed(3), terr: +(m - f).toFixed(3), drawMin: e.minY, py: e.py });
}
per.sort((a, b) => b.terr - a.terr);
console.log("\n--- terrain error at entity XZ (mesh - field). + = drawn ground is ABOVE where things were placed ---");
console.log("n =", per.length, "meanAbs", (per.reduce((a, c) => a + Math.abs(c.terr), 0) / per.length).toFixed(4));
for (const p of per.slice(0, 10)) console.log("BURY", p.id.padEnd(30), p.arch.padEnd(10), p.terr);
for (const p of per.slice(-10)) console.log("FLOAT", p.id.padEnd(30), p.arch.padEnd(10), p.terr);

// settlement squares
for (const region of REGIONS) {
  const s = (region as any).settlement; if (!s) continue;
  let worst = 0, wx = 0, wz = 0;
  for (let x = s.centre[0] - 45; x <= s.centre[0] + 45; x += 0.63) {
    for (let z = s.centre[1] - 45; z <= s.centre[1] + 45; z += 0.63) {
      const f = scene.heightAtXZ(x, z); const m = mh(x, z); if (m === null) continue;
      if (Math.abs(m - f) > Math.abs(worst)) { worst = m - f; wx = x; wz = z; }
    }
  }
  console.log(`\nsettlement ${s.id} centre=${s.centre} worst mesh-field ${worst.toFixed(3)} at (${wx.toFixed(1)},${wz.toFixed(1)})`);
}

// total drawn error per surface entity: drawnMin - meshHeight
const tot = per.filter((p) => !p.part && p.drawMin !== null).map((p) => ({ ...p, gap: +(p.drawMin - p.mesh).toFixed(3) }));
tot.sort((a, b) => b.gap - a.gap);
const byArch: Record<string, number[]> = {};
for (const t of tot) (byArch[t.arch] ??= []).push(t.gap);
console.log("\n--- FINAL VISIBLE GAP: drawn bottom minus rendered ground, by archetype ---");
for (const [a, gs] of Object.entries(byArch)) {
  gs.sort((x, y) => x - y);
  const float = gs.filter((g) => g > 0.05).length, bury = gs.filter((g) => g < -0.05).length;
  console.log(a.padEnd(14), "n=" + String(gs.length).padEnd(5), "min=" + gs[0]!.toFixed(3), "med=" + gs[gs.length >> 1]!.toFixed(3), "max=" + gs[gs.length - 1]!.toFixed(3), "float>5cm=" + float, "buried>5cm=" + bury);
}
console.log("\nworst 12 by gap:"); for (const t of tot.slice(0, 12)) console.log(" ", t.id.padEnd(30), t.arch.padEnd(10), t.gap);
console.log("\nmost buried 12:"); for (const t of tot.slice(-12)) console.log(" ", t.id.padEnd(30), t.arch.padEnd(10), t.gap);
fs.writeFileSync("runs/corealm/audit/terrain2.json", JSON.stringify({ per, tot }, null, 1));
