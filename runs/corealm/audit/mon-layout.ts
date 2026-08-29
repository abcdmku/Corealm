/** Scratch: dump the region layout so enemy groups can be placed off measured coordinates. */
import { REGIONS } from "../../../game/src/content/regions.js";

for (const r of REGIONS) {
  console.log(`=== ${r.id} tier ${r.tier} bounds ${JSON.stringify(r.bounds)} spawn ${JSON.stringify(r.spawnPoint)}`);
  const s = r.settlement;
  console.log(`  settlement ${s.id} centre ${JSON.stringify(s.centre)} pad ${JSON.stringify(s.padShape ?? null)}`);
  for (const l of r.locations) console.log(`  loc ${l.id.padEnd(28)} ${JSON.stringify(l.position)} ${l.kind}${l.routeNode ? " [node]" : ""}`);
  for (const c of r.clusters) console.log(`  clu ${c.id.padEnd(28)} ${JSON.stringify(c.centre)} r=${c.radius} n=${c.count}`);
  for (const g of r.enemyGroups) console.log(`  ENE ${g.id.padEnd(28)} ${JSON.stringify(g.centre)} r=${g.radius} n=${g.count}`);
  console.log(`  roads: ${r.roads.map((rd) => `${rd.from}->${rd.to}`).join(", ")}`);
  const d = r.dungeon;
  if (d) {
    console.log(`  --- dungeon ${d.id} entrance ${JSON.stringify(d.entrance)}`);
    for (const ch of d.chambers) console.log(`    ch ${ch.id.padEnd(24)} ${JSON.stringify(ch.centre)} r=${ch.radius} floor=${ch.floorOffset}`);
    for (const g of d.enemyGroups) console.log(`    ENE ${g.id.padEnd(28)} ${JSON.stringify(g.centre)} r=${g.radius} n=${g.count}`);
  }
}
