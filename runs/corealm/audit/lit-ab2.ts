/** Ablates one thing at a time and reports how many pixels still clip to white. */
import fs from "node:fs";
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const preset = process.argv[2] ?? "rootfall";
const steps = (process.argv[3] ?? "group:overlays;group:scatter;group:entities;group:terrain;sun:0;env:0")
  .split(";").map((s) => { const [mode, value] = s.split(":"); return { mode, value }; });
const src = fs.readFileSync(path.join(process.cwd(), "runs/corealm/audit/lit-ab2-page.js"), "utf8");
const dir = path.join(process.cwd(), "runs/corealm/screenshots");
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  await driver.callDebug("setCameraPreset", [preset]);
  await driver.wait(1500);
  for (const step of steps) {
    await driver.page!.evaluate(`${src}(${JSON.stringify({ mode: "restore", value: "" })})`);
    await driver.wait(250);
    const n = await driver.page!.evaluate(`${src}(${JSON.stringify(step)})`);
    await driver.wait(350);
    const file = path.join(dir, `lit-ab2-${preset}-${step.mode}-${String(step.value).replace(/\W/g, "")}.png`);
    await driver.page!.screenshot({ path: file, type: "png" });
    console.log(`${step.mode}:${step.value}\ttouched=${n}\t${path.basename(file)}`);
  }
} finally {
  await driver.close();
  await server.close();
}
