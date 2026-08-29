/** Scratch: every authored enemy group must resolve to a real stat block, not a synthesised one. */
import { REGIONS } from "../../../game/src/content/regions.js";
import { ENEMIES, ENEMY_BLOCKS, enemyIdFor } from "../../../game/src/content/enemies.js";

const byId = new Map(ENEMIES.map((row) => [row.id, row] as const));
let groups = 0;
let entities = 0;
let bad = 0;
for (const region of REGIONS) {
  const all = [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])];
  for (const g of all) {
    groups += 1;
    entities += g.count;
    const hit = byId.get(g.id) ?? byId.get(enemyIdFor(g.family, g.tier));
    if (!hit) { console.log(`UNRESOLVED ${region.id}/${g.id}`); bad += 1; continue; }
    if (hit.tier !== g.tier) { console.log(`TIER MISMATCH ${g.id}: group t${g.tier} block t${hit.tier}`); bad += 1; }
  }
}
console.log(`blocks ${ENEMY_BLOCKS.length}, published rows ${ENEMIES.length}, groups ${groups}, entities ${entities}, unresolved ${bad}`);
const families = new Set(ENEMY_BLOCKS.map((b) => b.family));
console.log(`families ${families.size}: ${[...families].sort().join(", ")}`);
process.exitCode = bad === 0 ? 0 : 1;
