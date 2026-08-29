import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch(); await driver.open();
const page = (driver as any).page;
const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  const g = d.checkGrounding();
  const rows = (g.entities ?? []) as any[];
  const detail = g.entries.map((row: any) => {
    const e: any = d.getEntity(row.id);
    const b: any = d.getDrawnBounds(row.id);
    const gh = d.groundHeight(e.position[0], e.position[2]);
    return {
      id: row.id, gap: row.gap, arch: e.archetype, asset: e.view?.assetId,
      state: e.state, tilt: e.view?.tiltStrength, normal: e.view?.groundNormal,
      clip: e.view?.clipFraction, scale: e.view?.scale, tier: e.tier,
      posY: e.position[1], groundY: gh,
      min: b ? b.min : null, max: b ? b.max : null, meshes: b?.meshes, path: b?.path,
    };
  });
  return { summary: { considered: g.considered, measured: g.measured, notDrawn: g.notDrawn, worst: g.worst, overTolerance: g.overTolerance }, detail, rows: rows.length };
});
console.log(JSON.stringify(out, null, 1));
await driver.close(); await server.close();
