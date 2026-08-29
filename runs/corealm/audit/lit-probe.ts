/**
 * Raycasts the scene through named screen pixels and takes a vertex-colour census.
 * The page half lives in lit-probe-page.js as plain JS: tsx's esbuild transform injects a `__name`
 * helper into any function it compiles, and that helper does not exist inside page scope.
 * Requires the TEMPORARY __probeRenderer hook in renderer.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const preset = process.argv[2] ?? "rootfall";
const points = (process.argv[3] ?? "1189,592;636,80;60,240;160,235;100,215")
  .split(";").map((p) => p.split(",").map(Number) as [number, number]);
const source = fs.readFileSync(path.join(process.cwd(), "runs/corealm/audit/lit-probe-page.js"), "utf8");

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  await driver.callDebug("setCameraPreset", [preset]);
  await driver.wait(1500);
  // Playwright does not auto-invoke a string that parses as a function expression, so the call
  // and its argument are baked into the source instead.
  const invoked = `${source}(${JSON.stringify({ pts: points })})`;
  const out = await driver.page!.evaluate(invoked);
  console.log(JSON.stringify(out, null, 1));
} finally {
  await driver.close();
  await server.close();
}
