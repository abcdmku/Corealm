/**
 * Measures the walking grade along the three authored Karrowmoor ramp routes, on the committed
 * terrain (HEAD) and on the working-tree terrain, against NAV_CONFIG.walkableSlopeAngle.
 */
import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { WorldScene as HeadScene } from "./head/scene-head.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { NAV_CONFIG } from "../../../game/src/app/config.js";
import { REGIONS } from "../../../game/src/content/regions.js";

const km = REGIONS.find((r) => r.id === "karrowmoor")!;
const at = (id: string): [number, number] => {
  const l = km.locations.find((n) => n.id === id);
  if (!l) throw new Error("no location " + id);
  return [l.position[0], l.position[1]];
};

const ROUTES: [string, string[]][] = [
  ["moor_road_bend -> highcairn_outpost", ["moor_road_bend", "highcairn_outpost"]],
  ["highcairn_bank -> ramp_two -> ramp_three", ["highcairn_bank", "karrow_ramp_two", "karrow_ramp_three"]],
  ["karrowmoor_terraces -> gravelmaw_entrance", ["karrowmoor_terraces", "gravelmaw_entrance"]],
  ["ramp_three -> upper_karrow_seam", ["karrow_ramp_three", "upper_karrow_seam"]],
  ["ramp_three -> great_cairn", ["karrow_ramp_three", "great_cairn"]],
  ["highcairn_outpost -> highcairn_bank", ["highcairn_outpost", "highcairn_bank"]],
  ["highcairn_outpost -> highcairn_plots", ["highcairn_outpost", "highcairn_plots"]],
  ["highcairn_plots -> ramp_two (the cut corridor)", ["highcairn_plots", "karrow_ramp_two"]],
  ["moor_road_bend -> karrowmoor_terraces", ["moor_road_bend", "karrowmoor_terraces"]],
  ["karrowmoor_north_gate -> moor_road_bend", ["karrowmoor_north_gate", "moor_road_bend"]],
];

interface Sampler { heightAtXZ(x: number, z: number): number }

function profile(scene: Sampler, nodes: string[]): { worstGrade: number; worstDeg: number; rise: number; low: number; high: number; span: number } {
  let worst = 0; let low = Infinity; let high = -Infinity; let span = 0;
  for (let leg = 0; leg + 1 < nodes.length; leg += 1) {
    const [ax, az] = at(nodes[leg]!);
    const [bx, bz] = at(nodes[leg + 1]!);
    const length = Math.hypot(bx - ax, bz - az);
    span += length;
    const steps = Math.max(2, Math.round(length / 1));
    let previous = scene.heightAtXZ(ax, az);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const h = scene.heightAtXZ(x, z);
      const run = length / steps;
      worst = Math.max(worst, Math.abs(h - previous) / run);
      low = Math.min(low, h); high = Math.max(high, h);
      previous = h;
    }
  }
  return { worstGrade: worst, worstDeg: (Math.atan(worst) * 180) / Math.PI, rise: high - low, low, high, span };
}

const spec = buildWorldTerrainSpec();
const head = new HeadScene(new THREE.Scene()) as unknown as Sampler & { buildWorld(s: unknown): unknown };
head.buildWorld(spec);
const now = new WorldScene(new THREE.Scene());
now.buildWorld(spec);

console.log(`walkableSlopeAngle = ${NAV_CONFIG.walkableSlopeAngle} deg (grade ${Math.tan((NAV_CONFIG.walkableSlopeAngle * Math.PI) / 180).toFixed(2)})\n`);
console.log("route".padEnd(42) + "  HEAD worst      working-tree worst   ridable");
for (const [label, nodes] of ROUTES) {
  const a = profile(head as Sampler, nodes);
  const b = profile(now, nodes);
  console.log(
    label.padEnd(42)
    + `  ${a.worstDeg.toFixed(1).padStart(5)} deg`
    + ` (${a.low.toFixed(2)}..${a.high.toFixed(2)} m)`.padEnd(24)
    + `  ${b.worstDeg.toFixed(1).padStart(5)} deg`
    + ` (${b.low.toFixed(2)}..${b.high.toFixed(2)} m)`.padEnd(24)
    + `  ${b.worstDeg < NAV_CONFIG.walkableSlopeAngle ? "yes" : "NO"}`,
  );
}

// Straight-line metres between authored nodes: the Agility ledger's unit. Ramps change y only,
// but the walked ground distance changes if the surface tilts, so both are printed.
console.log("\nauthored node-to-node distance, flat metres vs walked surface metres");
for (const [label, nodes] of ROUTES) {
  const b = profile(now, nodes);
  let walked = 0;
  for (let leg = 0; leg + 1 < nodes.length; leg += 1) {
    const [ax, az] = at(nodes[leg]!);
    const [bx, bz] = at(nodes[leg + 1]!);
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.round(length / 1));
    let ph = now.heightAtXZ(ax, az);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const h = now.heightAtXZ(ax + (bx - ax) * t, az + (bz - az) * t);
      walked += Math.hypot(length / steps, h - ph);
      ph = h;
    }
  }
  console.log(`${label.padEnd(42)} flat ${b.span.toFixed(1).padStart(6)} m   walked ${walked.toFixed(1).padStart(6)} m   +${(walked - b.span).toFixed(2)} m`);
}
