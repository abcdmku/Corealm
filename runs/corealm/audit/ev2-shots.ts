/** Worker key ev2. Capture the verification poses in one browser session. */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startFrozenServer } from "./ev2-server.js";

const prefix = process.argv[2] ?? "ev2";
const POSES = (process.argv[3] ?? "town_center,bank,rootfall,highcairn,bracken_pit,gravelmaw_entrance,karrowmoor_terraces").split(",");
const out = path.join(process.cwd(), "runs", "corealm", "screenshots");

const server = await startFrozenServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);
  for (const pose of POSES) {
    await driver.callDebug("setCameraPreset", [pose]);
    await driver.wait(900);
    console.log(await driver.screenshot(out, `${prefix}-${pose}`));
  }
  console.log("errors", JSON.stringify(await driver.callDebug("getErrors")));
} finally {
  await driver.close();
  await server.close();
}
