import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch(); await driver.open();
const page = (driver as any).page;
const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  const ents: any[] = d.listEntities({ regionId: "fallowmarch" });
  const tilted = ents.filter((e) => e.view?.groundNormal && (e.view.tiltStrength ?? 0) > 0);
  const byArch: Record<string, number> = {};
  for (const e of tilted) byArch[e.archetype] = (byArch[e.archetype] ?? 0) + 1;
  // Building parts carry meta.buildingId. Are any of them tilted?
  const tiltedParts = tilted.filter((e) => e.meta?.buildingId || String(e.id).includes("#"));
  // Roof parts specifically.
  const roofs = ents.filter((e) => /roof/.test(e.view?.assetId ?? ""));
  return {
    total: ents.length,
    tiltedCount: tilted.length,
    byArchetype: byArch,
    tiltedBuildingParts: tiltedParts.slice(0, 10).map((e) => ({ id: e.id, asset: e.view.assetId, n: e.view.groundNormal, s: e.view.tiltStrength })),
    roofSample: roofs.slice(0, 6).map((e) => ({ id: e.id, asset: e.view.assetId, rotY: e.view.rotationY, normal: e.view.groundNormal ?? null, tilt: e.view.tiltStrength ?? null })),
    drawCalls: d.getSceneStats().drawCalls ?? null,
  };
});
console.log(JSON.stringify(out, null, 1));
await driver.close(); await server.close();
