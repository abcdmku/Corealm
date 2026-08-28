import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import fs from "node:fs";
const scene: any = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const rows = JSON.parse(fs.readFileSync("runs/corealm/audit/grounding.json", "utf8")).rows;
const out: any[] = [];
for (const r of rows) {
  if (r.region === "gravelmaw" || r.id.includes("#") || r.minY === null) continue;
  const s = scene.slopeAt(r.px, r.pz, 1.0);
  const halfW = (r.w ?? 0) / 2;
  out.push({ id: r.id, arch: r.arch, slope: +s.toFixed(3), deg: +(Math.atan(s) * 180 / Math.PI).toFixed(1), halfW: +halfW.toFixed(2), gap: +(halfW * s).toFixed(3) });
}
out.sort((a, b) => b.gap - a.gap);
const byArch: Record<string, number[]> = {};
for (const o of out) (byArch[o.arch] ??= []).push(o.gap);
console.log("archetype    n   medianTiltGap  p90  max   (metres of daylight under the uphill/downhill edge)");
for (const [a, gs] of Object.entries(byArch)) { gs.sort((x, y) => x - y); console.log(a.padEnd(13), String(gs.length).padStart(3), gs[gs.length >> 1]!.toFixed(3).padStart(8), gs[Math.floor(gs.length * 0.9)]!.toFixed(3).padStart(7), gs[gs.length - 1]!.toFixed(3).padStart(7)); }
console.log("\nworst 15:"); for (const o of out.slice(0, 15)) console.log(" ", o.id.padEnd(28), o.arch.padEnd(10), "slope=" + o.deg + "deg", "halfWidth=" + o.halfW, "edgeGap=" + o.gap);
const steep = out.filter((o) => o.slope > 0.18);
console.log("\nentities on ground steeper than 10 deg:", steep.length, "of", out.length);
