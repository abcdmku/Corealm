import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch(); await driver.open();
const page = (driver as any).page;
const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  const s = d.getScatterStats();
  const scene = d.getSceneStats();
  const regions = (s?.regions ?? s) as any[];
  return {
    sceneStats: scene,
    scatter: Array.isArray(regions) ? regions.map((r: any) => ({
      regionId: r.regionId, placed: r.placed, rejected: r.rejected,
      instancedMeshes: r.instancedMeshes, drawCalls: r.estimatedDrawCalls,
      triangles: r.estimatedTriangles, missing: r.missingAssets,
    })) : s,
  };
});
console.log(JSON.stringify(out, null, 1));
await driver.close(); await server.close();
