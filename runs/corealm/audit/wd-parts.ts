import { buildComposition, buildPrefab, prefabPartAssetIds, compositionPartAssetIds } from "../../../game/src/render/buildings.js";
import { readFile } from "node:fs/promises";

const man = JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) as
  { assets?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
const list = (Array.isArray(man) ? man : man.assets ?? []) as Array<{ id: string; size: { x: number; y: number; z: number }; base: { y: number } }>;
const byId = new Map(list.map((a) => [a.id, a]));

const missing = [...prefabPartAssetIds(), ...compositionPartAssetIds()].filter((id) => !byId.has(id));
console.log("missing asset ids:", missing);

function dump(name: string, parts: ReturnType<typeof buildComposition>, comp: number, originGround = 0): void {
  console.log(`--- ${name} (compensation ${comp})`);
  for (const p of parts) {
    const a = byId.get(p.assetId);
    if (!a) { console.log("  ?", p.assetId); continue; }
    const s = p.scale * comp;
    const bottom = p.dy + a.base.y * s;
    const top = bottom + a.size.y * s;
    const r = Math.hypot(p.dx, p.dz);
    console.log(`  ${p.tag.padEnd(14)} ${p.assetId.padEnd(22)} r=${r.toFixed(2).padStart(6)} bottom=${bottom.toFixed(2).padStart(6)} top=${top.toFixed(2).padStart(6)} w=${(Math.max(a.size.x, a.size.z) * s).toFixed(2)}`);
  }
}
dump("gravelmaw_mouth", buildComposition("gravelmaw_mouth", 1), 0.869);
dump("great_cairn", buildComposition("great_cairn", 1), 0.869);
dump("standing_stones", buildComposition("standing_stones", 1), 0.930);
const yard = buildComposition("farm_yard", 7, "plaster");
console.log("farm_yard parts:", yard.length, "max radius", Math.max(...yard.map((p) => Math.hypot(p.dx, p.dz))).toFixed(2));
const tags = new Set(yard.map((p) => p.tag));
console.log("farm_yard unique tags:", tags.size === yard.length);
const barn = buildPrefab("farmstead", [10, 6], 3, "plaster");
console.log("farmstead parts:", barn.length, "unique tags", new Set(barn.map((p) => p.tag)).size === barn.length);
