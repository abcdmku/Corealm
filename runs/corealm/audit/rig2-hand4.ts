import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 700 } });
const eq = async () => Object.keys((((await driver.callDebug("getSceneStats")) as any).counts)).filter((k) => /^equip-/.test(k)).sort().join(", ") || "(nothing)";
try {
  await driver.launch();
  await driver.open();
  await driver.wait(6000);
  await driver.callDebug("setSkillLevel", ["melee", 40]);
  console.log("naked", await eq());
  for (const id of ["grithe_sword", "palewood_shield", "kaldite_sword"]) {
    await driver.callDebug("giveItem", [id, 1, "inventory"]);
    await driver.callDebug("callTool", ["corealm_equip", { itemId: id }]);
    for (const ms of [300, 700, 2000]) { await driver.wait(ms); console.log(id, "after", ms, "->", await eq()); }
  }
  for (const line of driver.consoleErrors) if (line.includes("RIG2DBG")) console.log("DBG", line);
  console.log("pageErrors", driver.pageErrors.slice(0, 3));
} finally { await driver.close(); await server.close(); }
