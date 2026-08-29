/**
 * Which haul corridors exist, and what the SURFACE actually measures along each authored
 * Karrowmoor road link. Reads the private corridor list off WorldScene; audit-only.
 */
import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";

interface Haul { xs: Float64Array; zs: Float64Array; heights: Float64Array; feather: Float64Array }
interface Pad { x: number; z: number; radius: number; blend: number; halfExtents?: readonly [number, number] }

const scene = new WorldScene(new THREE.Scene());
const t0 = Date.now();
scene.buildWorld(buildWorldTerrainSpec());
console.log("buildWorld ms", Date.now() - t0);
const inner = scene as unknown as { hauls: Haul[]; flats: Pad[] };
console.log("corridors:", inner.hauls.length, "of", inner.flats.length, "pads");

const named: { id: string; x: number; z: number }[] = [];
for (const r of REGIONS) for (const l of r.locations) named.push({ id: l.id, x: l.position[0], z: l.position[1] });
const nameAt = (x: number, z: number): string => {
  let best = "?"; let bd = 9;
  for (const n of named) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n.id; } }
  return best;
};

for (const h of inner.hauls) {
  const n = h.xs.length - 1;
  const span = Math.hypot(h.xs[n]! - h.xs[0]!, h.zs[n]! - h.zs[0]!);
  const step = span / n;
  let worst = 0;
  for (let i = 1; i <= n; i += 1) worst = Math.max(worst, Math.abs(h.heights[i]! - h.heights[i - 1]!) / step);
  console.log(
    `${nameAt(h.xs[0]!, h.zs[0]!).padEnd(24)} -> ${nameAt(h.xs[n]!, h.zs[n]!).padEnd(24)}`
    + ` span ${span.toFixed(1).padStart(6)} m  graded ${((Math.atan(worst) * 180) / Math.PI).toFixed(1).padStart(5)} deg`
    + `  collar ${Math.min(...h.feather).toFixed(1)}..${Math.max(...h.feather).toFixed(1)} m`,
  );
}

console.log("\n-- measured SURFACE along every authored Karrowmoor link, 1 m samples --");
const km = REGIONS.find((r) => r.id === "karrowmoor")!;
const at = (id: string): [number, number] => {
  const l = km.locations.find((n) => n.id === id)!;
  return [l.position[0], l.position[1]];
};
for (const edge of km.roads) {
  const [ax, az] = at(edge.from); const [bx, bz] = at(edge.to);
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(2, Math.round(len));
  let prev = scene.heightAtXZ(ax, az); let worst = 0; let worstAt = 0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const h = scene.heightAtXZ(ax + (bx - ax) * t, az + (bz - az) * t);
    const g = Math.abs(h - prev) / (len / steps);
    if (g > worst) { worst = g; worstAt = t * len; }
    prev = h;
  }
  const deg = (Math.atan(worst) * 180) / Math.PI;
  console.log(`${(edge.from + " -> " + edge.to).padEnd(48)} ${len.toFixed(1).padStart(6)} m  worst ${deg.toFixed(1).padStart(5)} deg at ${worstAt.toFixed(0)} m ${deg > 30 ? " OVER-30" : ""}${deg > 48 ? " UNWALKABLE" : ""}`);
}
