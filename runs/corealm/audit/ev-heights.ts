/** Drawn height of every NPC and a sample of enemies (worker key: ev). */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 600 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(6000);
  for (const archetype of ["npc", "boss"]) {
    const list = (await driver.callDebug("listEntities", [{ archetype }])) as Array<{
      id: string; position: number[]; view?: { assetId: string };
    }>;
    for (const entity of list) {
      const b = (await driver.callDebug("getDrawnBounds", [entity.id])) as
        { min: { y: number }; max: { y: number }; height: number; meshes: number; path: string } | null;
      const ground = entity.position[1] ?? 0;
      console.log(
        `${entity.id} path=${b?.path} meshes=${b?.meshes} height=${b?.height}` +
        ` topAboveGround=${b ? (b.max.y - ground).toFixed(3) : "-"}` +
        ` baseGap=${b ? (b.min.y - ground).toFixed(3) : "-"}`,
      );
    }
  }
  const enemies = (await driver.callDebug("listEntities", [{ archetype: "enemy" }])) as Array<{ id: string }>;
  let animated = 0;
  for (const enemy of enemies) {
    const b = (await driver.callDebug("getDrawnBounds", [enemy.id])) as { path: string } | null;
    if (b?.path.startsWith("animated")) animated += 1;
  }
  console.log(`enemies ${enemies.length} animated ${animated}`);
  console.log("views", JSON.stringify(await driver.callDebug("getEntityViewStats")));
} finally {
  await driver.close();
  await server.close();
}
