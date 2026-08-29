import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
await driver.launch(); await driver.open();
const page = (driver as any).page;
await page.evaluate(() => (window as any).__gameDebug.setCameraPreset("town_entrance"));
await new Promise((r) => setTimeout(r, 800));
const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  const s = d.getScatterStats();
  const regions = (s?.regions ?? s) as any[];
  const ev = d.getEntityViewStats();
  // Count visible InstancedMesh / Mesh by scene group.
  const r: any = (window as any).__renderer ?? null;
  return {
    scatter: Array.isArray(regions) ? regions.map((x: any) => ({
      region: x.regionId, placed: x.placed, meshes: x.instancedMeshes, calls: x.estimatedDrawCalls,
      tris: x.estimatedTriangles,
    })) : s,
    entityViews: {
      uniqueViews: ev.uniqueViews, instancedMeshes: ev.instancedMeshes,
      estimatedDrawCalls: ev.estimatedDrawCalls,
      namedDrawCalls: ev.namedDrawCalls, otherDrawCalls: ev.otherDrawCalls,
      instanceGroups: ev.instanceGroups ?? null,
    },
    scene: d.getSceneStats(),
  };
});
console.log(JSON.stringify(out, null, 1));
await driver.close(); await server.close();
