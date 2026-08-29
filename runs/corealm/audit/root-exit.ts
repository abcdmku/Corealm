import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
try {
  await driver.launch(); await driver.open();
  const page = (driver as any).page;
  const out = await page.evaluate(`(async () => {
    const d = window.__gameDebug;
    d.teleport({ locationId: "gravelmaw_arena" });
    const inside = d.getPlayer().regionId;
    const exit = d.getEntity("gravelmaw_exit_portal");
    const before = { region: inside, exitExists: !!exit, exitPos: exit ? exit.position : null };
    d.teleport({ entityId: "gravelmaw_exit_portal" });
    const atPortal = d.getPlayer().regionId;
    const used = await d.callTool("corealm_interact", { entityId: "gravelmaw_exit_portal", interaction: "enter" });
    await new Promise((r) => setTimeout(r, 500));
    const after = { region: d.getPlayer().regionId, position: d.getPlayerPosition() };
    let toBracken = null;
    try { toBracken = await d.callTool("corealm_move_to", { entityId: "bracken_pit_grithe_1" }); } catch (e) { toBracken = String(e); }
    return { before, atPortal, used, after, toBracken };
  })()`);
  console.log(JSON.stringify(out, null, 1));
} finally { await driver.close(); await server.close(); }
