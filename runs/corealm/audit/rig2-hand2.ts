import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 700 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(4000);
  await driver.callDebug("setSkillLevel", ["melee", 40]);
  for (const id of ["grithe_sword", "palewood_shield"]) {
    await driver.callDebug("giveItem", [id, 1, "inventory"]);
    await driver.callDebug("callTool", ["corealm_equip", { itemId: id }]);
  }
  await driver.wait(2500);
  for (const line of driver.consoleErrors) console.log("CONSOLE", line);
  for (const line of driver.pageErrors) console.log("PAGEERR", line);
} finally { await driver.close(); await server.close(); }
