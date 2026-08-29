import { readFile } from "node:fs/promises";
import path from "node:path";
const root = "C:/Users/Borg/Documents/GitHub/Corealm/game/public/assets";
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const entries = Array.isArray(manifest) ? manifest : (manifest.assets ?? manifest.entries ?? []);
const byId = new Map();
for (const e of entries) byId.set(e.id, e);
export async function meshInfo(id) {
  const e = byId.get(id);
  if (!e) return null;
  const file = path.join(root, e.path ?? e.file ?? e.url);
  let bytes;
  try { bytes = await readFile(file); } catch { return null; }
  const len = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + len).trim());
  // count primitives referenced by nodes (three creates one Mesh per primitive)
  const meshes = json.meshes ?? [];
  const nodes = json.nodes ?? [];
  let prims = 0;
  const mats = new Set();
  for (const n of nodes) {
    if (n.mesh === undefined) continue;
    const m = meshes[n.mesh];
    for (const p of m.primitives ?? []) { prims += 1; mats.add(p.material ?? -1); }
  }
  return { prims, mats: mats.size, matNames: [...mats].map((i) => (json.materials?.[i]?.name ?? String(i))) };
}
export { byId };
