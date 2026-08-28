import { readFileSync } from "node:fs";
import { buildWorld, type AssetSize } from "../../../game/src/world/regionBuilder.js";
interface A { id: string; size: { x: number; y: number; z: number }; base?: { y: number } }
const m = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: A[] };
const byId = new Map(m.assets.map((a) => [a.id, a]));
const h = (): number => 0;
const world = buildWorld(1, h, { heightAt: h, baseY: (i) => byId.get(i)?.base?.y ?? 0, assetSize: (i): AssetSize | null => byId.get(i)?.size ?? null });
const ent = new Map(world.entities.map((e) => [e.id, e]));
const rows: string[] = [];
for (const s of world.solids) {
  const reach = s.kind === "box" ? Math.hypot(s.size[0] / 2, s.size[2] / 2) : s.radius;
  if (reach < 1.395 || reach > 1.405) continue;
  const e = ent.get(s.id);
  const asset = e?.view?.assetId ?? "(building/part)";
  const size = byId.get(asset)?.size;
  const raw = size ? Math.hypot(size.x / 2, size.z / 2) * (e?.view?.scale ?? 1) : NaN;
  rows.push(`${s.id} [${asset}] ${s.kind} uncapped ${raw.toFixed(2)} -> 1.40`);
}
rows.sort();
console.log(rows.length);
for (const r of rows) console.log(" ", r);
