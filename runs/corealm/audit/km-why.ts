import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";

interface Pad { x: number; z: number; radius: number; blend: number; height?: number; halfExtents?: readonly [number, number] }
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const inner = scene as unknown as { flats: Pad[]; protectedPads: Pad[]; carvedPads: Set<Pad> };
const km = REGIONS.find((r) => r.id === "karrowmoor")!;
const at = (id: string): [number, number] => {
  const l = km.locations.find((n) => n.id === id)!;
  return [l.position[0], l.position[1]];
};
console.log("protected pads:", inner.protectedPads.map((p) => `(${p.x},${p.z}) reach=${p.halfExtents ? Math.hypot(p.halfExtents[0], p.halfExtents[1]).toFixed(1) : p.radius} blend=${p.blend.toFixed(1)}${inner.carvedPads.has(p) ? " CARVED" : ""}`).join("\n  "));

// Which pad vetoes the authored bank -> ramp_two link under the Gabriel test?
const pads = inner.flats.filter((p) => !inner.carvedPads.has(p));
for (const [fromId, toId] of [["highcairn_bank", "karrow_ramp_two"], ["moor_road_bend", "highcairn_outpost"], ["highcairn_plots", "karrow_ramp_two"], ["tarn_track", "far_tarn"]] as const) {
  const [ax, az] = at(fromId); const [bx, bz] = at(toId);
  const a = pads.find((p) => Math.hypot(p.x - ax, p.z - az) < 0.5);
  const b = pads.find((p) => Math.hypot(p.x - bx, p.z - bz) < 0.5);
  if (!a || !b) { console.log(`\n${fromId} -> ${toId}: one end is a carved pad (a=${!!a} b=${!!b})`); continue; }
  const mx = (a.x + b.x) / 2; const mz = (a.z + b.z) / 2;
  const r = Math.hypot(a.x - b.x, a.z - b.z) / 2;
  const blockers = pads.filter((p) => p !== a && p !== b && Math.hypot(p.x - mx, p.z - mz) < r)
    .map((p) => `(${p.x},${p.z}) at ${(Math.hypot(p.x - mx, p.z - mz) / r).toFixed(2)}R`);
  console.log(`\n${fromId} -> ${toId}  span ${(2 * r).toFixed(1)} m  vetoed by: ${blockers.join(", ") || "nothing (link exists)"}`);
  // per-metre surface profile with the nearest pad named
  const len = 2 * r; const steps = Math.round(len);
  let prev = scene.heightAtXZ(ax, az);
  const spikes: string[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = ax + (bx - ax) * t; const z = az + (bz - az) * t;
    const h = scene.heightAtXZ(x, z);
    const g = Math.abs(h - prev) / (len / steps);
    if (g > 0.5) spikes.push(`${(t * len).toFixed(0)}m ${((Math.atan(g) * 180) / Math.PI).toFixed(0)}deg y=${h.toFixed(2)}`);
    prev = h;
  }
  console.log("  over-26.6deg samples:", spikes.join("  ") || "none");
}
