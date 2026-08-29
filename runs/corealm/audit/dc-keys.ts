import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch(); await driver.open();
const page = (driver as any).page;
const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  const ents = d.listEntities() as any[];
  return ents.filter((e) => e.view).map((e) => ({
    id: e.id, arch: e.archetype,
    asset: e.view.assetId, dep: e.view.depletedAssetId ?? null,
    tier: e.view.materialTier ?? e.tier, clip: e.view.clipFraction ?? 0,
    parts: e.view.partAssetIds ?? null,
    pos: e.position, region: e.regionId,
  }));
});
console.log(JSON.stringify(out));
await driver.close(); await server.close();
