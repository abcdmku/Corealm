import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import fs from "node:fs";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch();
await driver.open();
const page = (driver as any).page;

const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  const ents: any[] = d.listEntities();
  const rows: any[] = [];
  for (const e of ents) {
    const p = e.position;
    const b = d.getDrawnBounds(e.id);
    rows.push({
      id: e.id, arch: e.archetype, region: e.regionId, tier: e.tier,
      asset: e.view?.assetId ?? null, scale: e.view?.scale ?? null,
      view: e.view ?? null,
      px: p[0], py: p[1], pz: p[2],
      minY: b ? b.min.y : null, maxY: b ? b.max.y : null, h: b ? b.height : null,
      minX: b ? b.min.x : null, maxX: b ? b.max.x : null,
      minZ: b ? b.min.z : null, maxZ: b ? b.max.z : null,
      w: b ? b.width : null, path: b ? b.path : null, meshes: b ? b.meshes : null,
      tags: e.tags ?? null, name: e.name ?? null,
    });
  }
  return {
    rows,
    keys: Object.keys(d),
    footing: typeof d.checkBuildingFooting === "function" ? d.checkBuildingFooting() : null,
    buildings: typeof d.listBuildings === "function" ? d.listBuildings() : null,
    stats: d.getEntityViewStats(),
    scene: d.getSceneStats(),
    player: d.getPlayer(),
    errors: d.getErrors(),
  };
});

fs.writeFileSync("runs/corealm/audit/grounding.json", JSON.stringify(out, null, 1));
console.log("entities", out.rows.length, "buildings", (out.buildings?out.buildings.length:0), "errors", JSON.stringify(out.errors).slice(0,300));
await driver.close();
await server.close();
