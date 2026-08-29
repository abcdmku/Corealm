import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";

const km = REGIONS.find((r) => r.id === "karrowmoor")!;
const at = (id: string): [number, number] => {
  const l = km.locations.find((n) => n.id === id)!;
  return [l.position[0], l.position[1]];
};
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());

for (const [a, b] of [["moor_road_bend", "highcairn_outpost"], ["highcairn_bank", "karrow_ramp_two"], ["karrow_ramp_two", "karrow_ramp_three"], ["karrowmoor_terraces", "gravelmaw_entrance"]] as const) {
  const [ax, az] = at(a); const [bx, bz] = at(b);
  const len = Math.hypot(bx - ax, bz - az);
  console.log(`\n${a} -> ${b}   ${len.toFixed(1)} m`);
  const steps = Math.round(len);
  let prev = scene.heightAtXZ(ax, az);
  const parts: string[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const h = scene.heightAtXZ(ax + (bx - ax) * t, az + (bz - az) * t);
    const g = (h - prev) / (len / steps);
    parts.push(`${(i * len / steps).toFixed(0)}m:${h.toFixed(2)}(${g >= 0 ? "+" : ""}${g.toFixed(2)})`);
    prev = h;
  }
  console.log(parts.join(" "));
}
