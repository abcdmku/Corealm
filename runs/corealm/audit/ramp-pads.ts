import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
const spec = buildWorldTerrainSpec();
const rows = (spec.flats ?? []).map((f) => ({
  x: f.x, z: f.z, radius: f.radius, blend: f.blend,
  half: f.halfExtents ? `${f.halfExtents[0]}x${f.halfExtents[1]}` : "-",
  height: f.height ?? null,
}));
console.log("total pads", rows.length);
const byShape = new Map<string, number>();
for (const r of rows) {
  const key = `radius=${r.radius} blend=${r.blend} half=${r.half} height=${r.height === null ? "-" : "set"}`;
  byShape.set(key, (byShape.get(key) ?? 0) + 1);
}
for (const [k, v] of [...byShape].sort()) console.log(String(v).padStart(3), k);
console.log("\nkarrowmoor-area pads (x 30..340, z -200..20):");
for (const r of rows) {
  if (r.x >= 30 && r.z <= 20) console.log(` (${r.x}, ${r.z}) radius=${r.radius} blend=${r.blend} half=${r.half} height=${r.height}`);
}
