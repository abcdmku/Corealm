/** Screenshots a preset with one named scene object hidden, to prove what it contributes. */
import fs from "node:fs";
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const preset = process.argv[2] ?? "rootfall";
const target = process.argv[3] ?? "ambience";
const src = fs.readFileSync(path.join(process.cwd(), "runs/corealm/audit/lit-ablate-page.js"), "utf8");
const dir = path.join(process.cwd(), "runs/corealm/screenshots");
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  await driver.callDebug("setCameraPreset", [preset]);
  await driver.wait(1500);
  await driver.page!.screenshot({ path: path.join(dir, `lit-abl-${preset}-with.png`), type: "png" });
  console.log(await driver.page!.evaluate(`${src}(${JSON.stringify({ name: target, visible: false })})`));
  await driver.wait(400);
  await driver.page!.screenshot({ path: path.join(dir, `lit-abl-${preset}-without.png`), type: "png" });
} finally {
  await driver.close();
  await server.close();
}
