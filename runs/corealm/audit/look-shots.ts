/**
 * Captures every shots.ts preset from ONE browser session, so an 18-pose look pass costs one
 * launch rather than eighteen. `npm run screenshot` relaunches per shot, which measured 18x slower.
 *
 * page.screenshot direct rather than driver.screenshot: playwright's default 30 s cap is not
 * enough at the 2 s software-rendered frames this harness produces on a 7.5M-triangle pose.
 */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import { SHOTS } from "../../../game/src/debug/shots.js";

const prefix = process.argv[2] ?? "look";
const only = process.argv.slice(3);
const shots = only.length > 0 ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
const dir = path.join(process.cwd(), "runs/corealm/screenshots");
try {
  await driver.launch();
  await driver.open(120_000);
  for (const shot of shots) {
    await driver.callDebug("setCameraPreset", [shot.id]);
    await driver.wait(500);
    const file = path.join(dir, `${prefix}-${shot.id}.png`);
    const page = driver.page;
    if (!page) throw new Error("driver has no page");
    await page.screenshot({ path: file, type: "png", timeout: 180_000 });
    const metrics = await driver.callDebug("getMetrics");
    console.log(`${shot.id}\t${path.basename(file)}\t${JSON.stringify(metrics)}`);
  }
  if (driver.consoleErrors.length) console.log("CONSOLE ERRORS:", driver.consoleErrors.slice(0, 5));
  if (driver.pageErrors.length) console.log("PAGE ERRORS:", driver.pageErrors.slice(0, 5));
} finally {
  await driver.close();
  await server.close();
}
