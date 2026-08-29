import { validateRegions, REGIONS } from "../../../game/src/content/regions.js";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8"));
const ids = new Set<string>((manifest.assets ?? []).map((a: { id: string }) => a.id));
const problems = validateRegions(ids);
console.log("validateRegions problems:", problems.length);
for (const p of problems.slice(0, 40)) console.log("  -", p);
for (const r of REGIONS) {
  const s = r.settlement;
  if (!s) continue;
  console.log(`${s.id.padEnd(11)} walls=${(s.walls ?? []).length} paving=${(s.paving ?? []).length} props=${(s.props ?? []).length} buildings=${s.buildings.length} stations=${s.stations.length} shops=${s.shops.length} npcs=${s.npcs.length} padShape=${s.padShape ? "yes" : "no"}`);
}
