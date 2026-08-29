import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch(); await driver.open();
const page = (driver as any).page;
const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  const s: any = d.getScatterStats();
  const regions = (s?.regions ?? []) as any[];
  const renderer: any = d.renderer ?? null;
  // Reach the scene through the debug surface if exposed; else through the three scene on window.
  const scene: any = (window as any).__scene ?? null;
  return {
    scatter: regions.map((r: any) => ({
      regionId: r.regionId, placed: r.placed, rejected: r.rejected, clusters: r.clusters,
      meshes: r.instancedMeshes, draw: r.estimatedDrawCalls, tris: r.estimatedTriangles,
      byLayer: r.byLayer, bySource: r.bySource, missing: r.missingAssets,
    })),
    hasScene: !!scene, hasRenderer: !!renderer,
  };
});
console.log(JSON.stringify(out, null, 1));
await driver.close(); await server.close();
