/**
 * Per-entity probe (worker key: ev): which render path each NPC, boss and enemy landed on.
 */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 600 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(800);
  for (const archetype of ["npc", "boss", "enemy"]) {
    const list = (await driver.callDebug("listEntities", [{ archetype }])) as Array<{
      id: string; state: string; view?: { assetId: string };
    }>;
    let shown = 0;
    for (const entity of list) {
      const bounds = (await driver.callDebug("getDrawnBounds", [entity.id])) as
        { min: number[]; max: number[]; meshes: number; path: string } | null;
      if (archetype === "enemy" && bounds?.path === "instanced" && shown > 4) continue;
      shown += 1;
      console.log(
        `${archetype} ${entity.id} asset=${entity.view?.assetId} state=${entity.state}` +
        ` path=${bounds?.path} meshes=${bounds?.meshes}` +
        ` y=${bounds ? `${bounds.min[1]?.toFixed(3)}..${bounds.max[1]?.toFixed(3)}` : "-"}`,
      );
      if (archetype === "enemy" && shown > 8) break;
    }
  }
  console.log("stats", JSON.stringify(await driver.callDebug("getEntityViewStats")));
} finally {
  await driver.close();
  await server.close();
}
