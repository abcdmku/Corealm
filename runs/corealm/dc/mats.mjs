import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
const root = "C:/Users/Borg/Documents/GitHub/Corealm/game/public/assets";
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const entries = Array.isArray(manifest) ? manifest : (manifest.assets ?? manifest.entries ?? []);
const byId = new Map(entries.map((e) => [e.id, e]));
const ents = JSON.parse(await readFile("C:/Users/Borg/Documents/GitHub/Corealm/runs/corealm/dc/keys.json", "utf8"));
const assets = [...new Set(ents.map((e) => e.asset))];

const global = new Map(); // key -> {assets:Set, prims:0}
const perAsset = [];
for (const id of assets) {
  const e = byId.get(id); if (!e) continue;
  const file = path.join(root, e.path ?? e.file ?? e.url);
  let bytes; try { bytes = await readFile(file); } catch { continue; }
  const len = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + len).trim());
  const binStart = 20 + len + 8;
  const imgHash = (i) => {
    const img = json.images?.[i]; if (!img) return "-";
    const bv = json.bufferViews?.[img.bufferView]; if (!bv) return img.uri ?? "-";
    const off = binStart + (bv.byteOffset ?? 0);
    return crypto.createHash("sha1").update(bytes.subarray(off, off + bv.byteLength)).digest("hex").slice(0, 10);
  };
  const matKey = (m) => {
    const p = m.pbrMetallicRoughness ?? {};
    const tex = p.baseColorTexture ? imgHash(json.textures[p.baseColorTexture.index].source) : "-";
    return [m.name ?? "?", tex, (p.baseColorFactor ?? [1,1,1,1]).map(v=>v.toFixed(3)).join(","), p.metallicFactor ?? 1, p.roughnessFactor ?? 1, m.doubleSided?1:0, m.alphaMode ?? "OPAQUE"].join("|");
  };
  const used = new Set();
  for (const n of json.nodes ?? []) {
    if (n.mesh === undefined) continue;
    for (const p of json.meshes[n.mesh].primitives ?? []) {
      const k = p.material === undefined ? "none" : matKey(json.materials[p.material]);
      used.add(k);
      const g = global.get(k) ?? { assets: new Set(), prims: 0 };
      g.assets.add(id); g.prims += 1; global.set(k, g);
    }
  }
  perAsset.push({ id, mats: used.size });
}
console.log("assets", assets.length, "distinct materials across all entity assets:", global.size);
const shared = [...global.entries()].filter(([, g]) => g.assets.size > 1).sort((a,b)=>b[1].prims-a[1].prims);
console.log("materials shared by >1 asset:", shared.length);
for (const [k, g] of shared.slice(0, 25)) console.log(String(g.prims).padStart(3), "prims", String(g.assets.size).padStart(3), "assets ", k.slice(0, 90));
