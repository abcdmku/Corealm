/** Enemy motion states in the live game (worker key: ev): idle -> walk -> death. */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1600, height: 1000 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);
  const enemies = (await driver.callDebug("listEntities", [{ archetype: "enemy" }])) as Array<{
    id: string; position: number[]; regionId: string; combat?: { maxHealth: number };
  }>;
  const target = enemies.find((enemy) => enemy.regionId === "fallowmarch");
  if (!target) throw new Error("no fallowmarch enemy");
  const [x = 0, y = 0, z = 0] = target.position;
  await driver.callDebug("setSkillLevel", ["attack", 60]);
  await driver.callDebug("setSkillLevel", ["strength", 60]);
  await driver.callDebug("teleport", [[x, y, z + 3]]);
  await driver.wait(1200);
  console.log("before", target.id, JSON.stringify(await driver.callDebug("getDrawnBounds", [target.id])));
  await driver.screenshot(path.join(process.cwd(), "runs", "corealm", "screenshots"), "ev-enemy-alive");

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await driver.callDebug("callTool", ["corealm_attack", { entityId: target.id }]);
    await driver.wait(400);
    const entity = (await driver.callDebug("getEntity", [target.id])) as { state: string } | null;
    if (entity?.state === "dead") break;
  }
  const entity = (await driver.callDebug("getEntity", [target.id])) as { state: string } | null;
  await driver.wait(1200);
  console.log("after state", entity?.state, JSON.stringify(await driver.callDebug("getDrawnBounds", [target.id])));
  await driver.screenshot(path.join(process.cwd(), "runs", "corealm", "screenshots"), "ev-enemy-dead");
  console.log("views", JSON.stringify(await driver.callDebug("getEntityViewStats")));
} finally {
  await driver.close();
  await server.close();
}
