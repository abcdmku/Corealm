import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
try {
  await driver.launch(); await driver.open();
  const page = (driver as any).page;
  const out = await page.evaluate(`(() => {
    const d = window.__gameDebug;
    const rows = [];
    for (const e of d.listEntities({ regionId: "fallowmarch" })) {
      const id = String(e.id);
      if (!/coldbrace_bank_porch|coldbrace_bank\b|coldbrace_well/.test(id)) continue;
      const b = d.getDrawnBounds(id);
      rows.push({
        id, asset: e.view ? e.view.assetId : null,
        scale: e.view ? e.view.scale : null,
        rotY: e.view ? e.view.rotationY : null,
        size: b ? [ +(b.max.x-b.min.x).toFixed(2), +(b.max.y-b.min.y).toFixed(2), +(b.max.z-b.min.z).toFixed(2) ] : null,
        minY: b ? +b.min.y.toFixed(2) : null,
      });
    }
    rows.sort((a,b) => (b.size ? b.size[0]*b.size[2] : 0) - (a.size ? a.size[0]*a.size[2] : 0));
    return rows;
  })()`);
  console.log(JSON.stringify(out, null, 1));
} finally { await driver.close(); await server.close(); }
