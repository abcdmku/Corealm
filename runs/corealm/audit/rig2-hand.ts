/**
 * Worker key `rig2`. Why does a worn weapon draw nothing? Equips one sword and one shield and dumps
 * every scene-graph name that could plausibly be either, plus the recorded errors.
 *
 *   npx tsx runs/corealm/audit/rig2-hand.ts
 */
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
    console.log(id, JSON.stringify(await driver.callDebug("callTool", ["corealm_equip", { itemId: id }])).slice(0, 220));
  }
  await driver.wait(2500);
  const stats = (await driver.callDebug("getSceneStats")) as { counts: Record<string, number>; hidden: Record<string, number> };
  for (const [k, v] of Object.entries(stats.counts).sort()) {
    if (/equip|sword|shield|weapon|hand/i.test(k)) console.log("count", v, k);
  }
  console.log("hidden", JSON.stringify(stats.hidden));
  console.log("errors", JSON.stringify(await driver.callDebug("getErrors")));
  console.log("worn", JSON.stringify((await driver.callDebug("callTool", ["corealm_inventory", {}]))).slice(0, 600));
} finally {
  await driver.close();
  await server.close();
}
