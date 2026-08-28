import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import fs from "node:fs";
import path from "node:path";

const base = "game/public/assets";
const manifest = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const out: any[] = [];
for (const a of manifest.assets) {
  try {
    const doc = await io.read(path.join(base, a.file));
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
    const b = getBounds(scene);
    out.push({
      id: a.id, cat: a.category, file: a.file,
      minY: +b.min[1].toFixed(4), maxY: +b.max[1].toFixed(4),
      minX: +b.min[0].toFixed(4), maxX: +b.max[0].toFixed(4),
      minZ: +b.min[2].toFixed(4), maxZ: +b.max[2].toFixed(4),
      sizeY: +(b.max[1] - b.min[1]).toFixed(4),
      manifestY: a.size.y,
    });
  } catch (e) { out.push({ id: a.id, cat: a.category, file: a.file, error: String(e).slice(0, 80) }); }
}
fs.writeFileSync("runs/corealm/audit/glb-bounds.json", JSON.stringify(out, null, 1));
const bad = out.filter((o) => o.minY !== undefined && Math.abs(o.minY) > 0.02);
console.log("assets", out.length, "with |minY| > 2cm:", bad.length);
bad.sort((a, b) => Math.abs(b.minY) - Math.abs(a.minY));
for (const o of bad.slice(0, 60)) console.log(o.id.padEnd(26), o.cat.padEnd(10), "minY=" + o.minY.toFixed(3).padStart(8), "sizeY=" + o.sizeY.toFixed(3));
