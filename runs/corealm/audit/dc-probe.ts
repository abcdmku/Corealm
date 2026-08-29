import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch(); await driver.open();
const page = (driver as any).page;
const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  const ents = d.listEntities() as any[];
  const byAsset: Record<string, { n: number; arch: string; tiers: number[]; parts?: string[] }> = {};
  for (const e of ents) {
    const v = e.view; if (!v) continue;
    const key = v.assetId;
    const row = byAsset[key] ?? (byAsset[key] = { n: 0, arch: e.archetype, tiers: [] });
    row.n += 1;
    const t = v.materialTier ?? e.tier;
    if (!row.tiers.includes(t)) row.tiers.push(t);
    if (v.partAssetIds) row.parts = v.partAssetIds;
  }
  return { stats: d.getEntityViewStats(), scene: d.getSceneStats(), byAsset, entities: ents.length };
});
console.log(JSON.stringify(out, null, 1));
await driver.close(); await server.close();
