import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";

const root = new THREE.Scene();
const scene = new WorldScene(root);
const spec = buildWorldTerrainSpec();
scene.buildWorld(spec);

const km = REGIONS.find((r) => r.id === "karrowmoor")!;
const spots = new Map<string, [number, number]>();
for (const l of km.locations) spots.set(l.id, l.position as [number, number]);

const routes: [string, string][] = [
  ["karrowmoor_north_gate", "moor_road_bend"],
  ["moor_road_bend", "karrowmoor_terraces"],
  ["karrowmoor_terraces", "gravelmaw_entrance"],
  ["moor_road_bend", "highcairn_outpost"],
  ["karrowmoor_terraces", "highcairn_outpost"],
  ["highcairn_outpost", "highcairn_bank"],
  ["highcairn_outpost", "highcairn_plots"],
  ["highcairn_bank", "karrow_ramp_two"],
  ["karrow_ramp_two", "karrow_ramp_three"],
  ["karrow_ramp_three", "upper_karrow_seam"],
  ["karrow_ramp_three", "great_cairn"],
  ["highcairn_outpost", "cairn_tarns"],
];
const WALK = Math.tan((48 * Math.PI) / 180);
console.log("walkable slope limit (rise/run) =", WALK.toFixed(3));
for (const [a, b] of routes) {
  const pa = spots.get(a); const pb = spots.get(b);
  if (!pa || !pb) { console.log("MISSING", a, b); continue; }
  const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  const steps = Math.max(2, Math.round(len / 1.0));
  let worst = 0; let worstAt: [number, number] = [0, 0];
  let hmin = Infinity; let hmax = -Infinity;
  let over = 0;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = pa[0] + (pb[0] - pa[0]) * t;
    const z = pa[1] + (pb[1] - pa[1]) * t;
    const h = scene.heightAtXZ(x, z);
    hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
    const s = scene.slopeAt(x, z, 1.0);
    if (s > WALK) over += 1;
    if (s > worst) { worst = s; worstAt = [x, z]; }
  }
  const deg = (Math.atan(worst) * 180) / Math.PI;
  console.log(
    `${a} -> ${b}  len ${len.toFixed(1)}m  h ${hmin.toFixed(2)}..${hmax.toFixed(2)} (rise ${(hmax - hmin).toFixed(2)})  worstSlope ${worst.toFixed(2)} = ${deg.toFixed(1)}deg at (${worstAt[0].toFixed(1)},${worstAt[1].toFixed(1)})  overLimit ${over}/${steps + 1}`,
  );
}
