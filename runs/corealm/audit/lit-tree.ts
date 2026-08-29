import fs from "node:fs";
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const src = fs.readFileSync(path.join(process.cwd(), "runs/corealm/audit/lit-tree-page.js"), "utf8");
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  await driver.callDebug("setCameraPreset", [process.argv[2] ?? "rootfall"]);
  await driver.wait(1000);
  console.log(JSON.stringify(await driver.page!.evaluate(`${src}()`), null, 1));
} finally { await driver.close(); await server.close(); }
