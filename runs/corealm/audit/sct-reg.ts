import { REGIONS } from "../../../game/src/content/regions.js";
for (const r of REGIONS) {
  const b: any = (r as any).bounds;
  console.log(r.id, "bounds", JSON.stringify(b), "base", r.baseHeight, "amp", r.terrainAmplitude, "fogStart", r.fogStart);
  const s = r.settlement;
  if (s) {
    let maxd = 0; const pts: [number,number][] = [];
    for (const bd of s.buildings) pts.push([bd.position[0], bd.position[1]]);
    for (const st of s.stations) pts.push([st.position[0], st.position[1]]);
    if (s.bank) pts.push([s.bank.position[0], s.bank.position[1]]);
    for (const sh of s.shops) pts.push([sh.position[0], sh.position[1]]);
    for (const p of (s as any).props ?? []) pts.push([p.position[0], p.position[1]]);
    for (const w of (s as any).walls ?? []) { pts.push([w.from[0],w.from[1]]); pts.push([w.to[0],w.to[1]]); }
    for (const p of pts) maxd = Math.max(maxd, Math.hypot(p[0]-s.centre[0], p[1]-s.centre[1]));
    console.log("   settlement", s.id, "centre", s.centre, "maxExtent", maxd.toFixed(2), "buildings", s.buildings.length, "walls", ((s as any).walls??[]).length, "props", ((s as any).props??[]).length);
  }
  for (const c of r.clusters) if (c.archetype === "fishing_spot") console.log("   water", c.id, c.centre, "r", c.radius, "-> waterR", c.radius + 14);
  console.log("   roads", r.roads.length, "locations", r.locations.length, "clusters", r.clusters.length);
}
