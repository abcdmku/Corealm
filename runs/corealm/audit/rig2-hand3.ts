import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 700 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);
  await driver.callDebug("setSkillLevel", ["melee", 40]);
  for (const id of ["grithe_sword", "palewood_shield"]) {
    await driver.callDebug("giveItem", [id, 1, "inventory"]);
    await driver.callDebug("callTool", ["corealm_equip", { itemId: id }]);
    await driver.wait(2000);
    const s = (await driver.callDebug("getSceneStats")) as { counts: Record<string, number> };
    console.log(id, "->", Object.keys(s.counts).filter((k) => /^equip-/.test(k)).sort().join(", ") || "(nothing)");
  }
  for (const line of driver.consoleErrors) if (line.includes("RIG2DBG")) console.log("DBG", line);
} finally { await driver.close(); await server.close(); }
