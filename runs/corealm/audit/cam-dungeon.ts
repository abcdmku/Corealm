/** Terrain height over the Gravelmaw chambers, against where the camera sits down there. */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 640, height: 400 } });
try {
  await driver.launch();
  await driver.open(60_000);
  for (const [x, z] of [[40, -40], [42, -48], [42, -55], [30, -58], [46, -24]] as const) {
    const y = await driver.callDebug("groundHeight", [x, z]);
    console.log(`ground(${x},${z}) = ${String(y)}`);
  }
  await driver.callDebug("teleport", [[40, 16, -40]]);
  await driver.wait(700);
  console.log("dungeon camera", JSON.stringify(await driver.callDebug("getCamera")));
  console.log("player", JSON.stringify(await driver.callDebug("getPlayerPosition")));
} finally {
  await driver.close();
  await server.close();
}
