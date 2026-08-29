import { REGIONS } from "../../../game/src/content/regions.js";
let total = 0;
for (const r of REGIONS) {
  const byId = new Map(r.locations.map((l) => [l.id, l]));
  let sub = 0;
  for (const road of r.roads) {
    const a = byId.get(road.from); const b = byId.get(road.to);
    if (!a || !b) continue;
    sub += Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]);
  }
  console.log(r.id, "roads", r.roads.length, "metres", sub.toFixed(0));
  total += sub;
}
console.log("world road metres", total.toFixed(0));
