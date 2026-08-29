import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
const root = "C:/Users/Borg/Documents/GitHub/Corealm/game/public/assets";
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const entries = Array.isArray(manifest) ? manifest : (manifest.assets ?? manifest.entries ?? []);
const byId = new Map(entries.map((e) => [e.id, e]));
const ents = JSON.parse(await readFile("C:/Users/Borg/Documents/GitHub/Corealm/runs/corealm/dc/keys.json", "utf8"));
const assets = [...new Set(ents.map((e) => e.asset))];
// include every asset in the manifest, not just the ones in use, so scatter/equipment don't surprise us
const all = new Set([...assets, ...entries.map((e) => e.id)]);

const byNameKey = new Map(); // runtime-visible key -> Map(fullhash -> [assets])
let attrSets = new Map();
for (const id of all) {
  const e = byId.get(id); if (!e) continue;
  const file = path.join(root, e.path ?? e.file ?? e.url);
  let bytes; try { bytes = await readFile(file); } catch { continue; }
  if (bytes.toString("ascii", 0, 4) !== "glTF") continue;
  const len = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + len).trim());
  const binStart = 20 + len + 8;
  const imgHash = (i) => {
    const img = json.images?.[i]; if (!img) return "-";
    const bv = json.bufferViews?.[img.bufferView]; if (!bv) return img.uri ?? "-";
    const off = binStart + (bv.byteOffset ?? 0);
    return crypto.createHash("sha1").update(bytes.subarray(off, off + bv.byteLength)).digest("hex").slice(0, 10);
  };
  const texName = (t) => { const tex = json.textures?.[t]; if (!tex) return "-"; const src = json.images?.[tex.source] ?? {}; return tex.name || src.name || src.uri || ""; };
  for (const m of json.materials ?? []) {
    const p = m.pbrMetallicRoughness ?? {};
    const bc = p.baseColorTexture?.index;
    // what the renderer can see at runtime
    const runtime = [m.name ?? "?", bc === undefined ? "-" : texName(bc),
      (p.baseColorFactor ?? [1,1,1,1]).map(v=>v.toFixed(3)).join(","),
      (p.metallicFactor ?? 1), (p.roughnessFactor ?? 1),
      m.doubleSided?1:0, m.alphaMode ?? "OPAQUE", (m.alphaCutoff ?? 0.5),
      (m.emissiveFactor ?? [0,0,0]).join(","),
      m.normalTexture ? texName(m.normalTexture.index) : "-",
      p.metallicRoughnessTexture ? texName(p.metallicRoughnessTexture.index) : "-",
    ].join("|");
    const truth = [runtime, bc === undefined ? "-" : imgHash(json.textures[bc].source),
      m.normalTexture ? imgHash(json.textures[m.normalTexture.index].source) : "-"].join("#");
    const slot = byNameKey.get(runtime) ?? new Map();
    const list = slot.get(truth) ?? [];
    list.push(id); slot.set(truth, list); byNameKey.set(runtime, slot);
  }
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives ?? []) {
    const sig = Object.keys(p.attributes).sort().join(",") + (p.indices !== undefined ? "|idx" : "");
    attrSets.set(sig, (attrSets.get(sig) ?? 0) + 1);
  }
}
let collisions = 0;
for (const [k, slot] of byNameKey) if (slot.size > 1) {
  collisions += 1;
  console.log("COLLISION", k.slice(0, 70), [...slot.entries()].map(([h, a]) => `${h.split('#').slice(1).join('#')}:${a.slice(0,3).join(',')}`).join("  ||  "));
}
console.log("runtime material keys:", byNameKey.size, "collisions:", collisions);
console.log("attribute signatures:", [...attrSets.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12));
