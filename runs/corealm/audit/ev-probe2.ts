import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 600 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(4000);
  const stats = (await driver.callDebug("getSceneStats")) as { counts: Record<string, number> };
  for (const name of Object.keys(stats.counts)) {
    if (name.includes("base_male") || name.includes("base_female") || name.includes("enemy_")) {
      console.log(name, stats.counts[name]);
    }
  }
  console.log("views", JSON.stringify(await driver.callDebug("getEntityViewStats")));
  console.log("errors", JSON.stringify(await driver.callDebug("getErrors")));
} finally {
  await driver.close();
  await server.close();
}
