/**
 * Focus a set of shot presets, screenshot each, and log what the camera resolved to.
 *
 * Retries per shot: five other workers are saving files into this repo while it runs, and every
 * save is a vite HMR reload that destroys the page's execution context mid-call.
 */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const prefix = process.argv[2] ?? "cam";
const ids = process.argv.slice(3);
const shots = ids.length > 0 ? ids : [
  "bank", "town_center", "rootfall", "highcairn", "gravelmaw_entrance", "karrowmoor_terraces",
];

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
const dir = path.join(process.cwd(), "runs/corealm/screenshots");
try {
  await driver.launch();
  await driver.open();
  for (const id of shots) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await driver.callDebug("focusCamera", [id]);
        await driver.wait(600);
        const page = driver.page;
        if (!page) throw new Error("no page");
        await page.screenshot({ path: path.join(dir, `${prefix}-${id}.png`), type: "png", timeout: 180_000 });
        const cam = await driver.callDebug("getCamera") as Record<string, unknown>;
        const pos = await driver.callDebug("getPlayerPosition") as Record<string, number>;
        console.log(`${id.padEnd(22)} ${JSON.stringify(cam)} player=${JSON.stringify(pos)}`);
        break;
      } catch (cause) {
        console.log(`${id} attempt ${attempt} failed: ${String(cause).slice(0, 90)}`);
        await driver.open(60_000).catch(() => undefined);
      }
    }
  }
  if (driver.consoleErrors.length) console.log("CONSOLE ERRORS:", driver.consoleErrors.slice(0, 5));
  if (driver.pageErrors.length) console.log("PAGE ERRORS:", driver.pageErrors.slice(0, 3));
} finally {
  await driver.close();
  await server.close();
}
