// Triangle / primitive / native-size census of the nature + rock kit, for picking a cheap cover pool.
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("game/public/assets/manifest.json", "utf8"));
const entries = Array.isArray(manifest) ? manifest : manifest.assets;
const rows = [];
for (const entry of entries) {
  const tags = (entry.tags ?? []).join(",");
  if (!/nature|rock|plant|tree|grass|flower|mushroom/.test(tags + " " + entry.id)) continue;
  let buf;
  try { buf = fs.readFileSync("game/public/assets/" + entry.file); } catch { continue; }
  const len = buf.readUInt32LE(12);
  let json;
  try { json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8")); } catch { continue; }
  let tris = 0; let prims = 0;
  const mats = new Set();
  for (const mesh of json.meshes ?? []) for (const prim of mesh.primitives) {
    prims += 1;
    if (prim.material != null) mats.add(json.materials?.[prim.material]?.name ?? prim.material);
    const n = prim.indices != null ? json.accessors[prim.indices].count : json.accessors[prim.attributes.POSITION].count;
    tris += Math.round(n / 3);
  }
  const size = entry.size ?? entry.bounds ?? null;
  rows.push({ id: entry.id, tris, prims, mats: [...mats].join("/"), tags, size: JSON.stringify(size) });
}
rows.sort((a, b) => a.tris - b.tris);
for (const r of rows) {
  console.log(String(r.tris).padStart(5), "p" + r.prims, r.id.padEnd(24), r.mats.padEnd(26), r.size ?? "");
}
console.log("total assets", rows.length);
