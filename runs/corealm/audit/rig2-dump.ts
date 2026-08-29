/** Worker key `rig2`. Full `getSceneStats().counts` dump, to see what the rig's meshes are named. */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 800, height: 600 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(4000);
  const stats = (await driver.callDebug("getSceneStats")) as { counts: Record<string, number> };
  for (const [k, v] of Object.entries(stats.counts).sort()) console.log(v, k);
} finally { await driver.close(); await server.close(); }
