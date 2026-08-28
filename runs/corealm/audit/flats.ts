import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";
const scene = new WorldScene(new THREE.Scene());
const spec = buildWorldTerrainSpec();
scene.buildWorld(spec);
const flats = (scene as any).flats as any[];
console.log("flats", flats.length);
const near = (x: number, z: number) => flats.map((f, i) => ({ i, ...f, d: +Math.hypot(f.x - x, f.z - z).toFixed(1) }))
  .filter((f) => f.d < f.radius + f.blend + 5).sort((a, b) => a.d - b.d);
for (const [x, z, label] of [[245.7, -91.3, "ridge pine 2"], [253.3, -101.8, "global worst"], [178.4, -73.8, "highcairn worst"]] as any[]) {
  console.log("\n== " + label + " (" + x + "," + z + ")  field=" + scene.heightAtXZ(x, z).toFixed(2));
  for (const f of near(x, z)) console.log("  flat#" + f.i, "at", f.x.toFixed(1), f.z.toFixed(1), "r=" + f.radius.toFixed(1), "blend=" + f.blend.toFixed(1), "height=" + (f.height ?? "-").toFixed?.(2), "dist=" + f.d, f.d <= f.radius ? "  <-- CORE" : "");
}
// name the pads: rebuild the label mapping from content
const labels: string[] = [];
for (const r of REGIONS as any[]) {
  if (r.settlement) labels.push("settlement:" + r.settlement.id);
  for (const l of r.locations) labels.push("location:" + l.id);
  for (const c of r.clusters) if (c.archetype === "fishing_spot") labels.push("basin:" + c.id);
}
console.log("\nlabel count", labels.length, "flat count", flats.length);
// count overlapping cores with differing targets
let pairs = 0, worst = 0, wp: any = null;
for (let i = 0; i < flats.length; i++) for (let j = i + 1; j < flats.length; j++) {
  const a = flats[i], b = flats[j];
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  if (d < a.radius + b.radius) {
    const gap = Math.abs((a.height ?? 0) - (b.height ?? 0));
    if (gap > 0.25) { pairs++; if (gap > worst) { worst = gap; wp = [labels[i], labels[j], +gap.toFixed(2), +d.toFixed(1), a.radius, b.radius]; } }
  }
}
console.log("overlapping pad CORES with >25cm target difference:", pairs, "worst:", JSON.stringify(wp));
