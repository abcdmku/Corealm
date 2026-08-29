/** Worker key ev3. Entity-view stats only, at spawn and after a settle. One short session. */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startFrozenServer } from "./ev2-server.js";

const server = await startFrozenServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(6000);
  console.log("spawn      ", JSON.stringify(await driver.callDebug("getEntityViewStats")));
  await driver.callDebug("setCameraPreset", ["town_entrance"]);
  await driver.wait(2500);
  console.log("town_entr  ", JSON.stringify(await driver.callDebug("getEntityViewStats")));
  await driver.callDebug("setCameraPreset", ["bracken_pit"]);
  await driver.wait(2500);
  console.log("bracken_pit", JSON.stringify(await driver.callDebug("getEntityViewStats")));
  console.log("errors", JSON.stringify(await driver.callDebug("getErrors")));
} finally {
  await driver.close();
  await server.close();
}
