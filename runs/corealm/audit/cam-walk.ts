/**
 * Walks the player under every walk-under roof in the world and into the Gravelmaw, and records
 * where the camera ended up. Retries each stop, because concurrent edits reload the page.
 */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const stops: readonly (readonly [string, readonly [number, number, number]])[] = [
  ["porch", [-162.9, 1.0, -89.6]],
  ["forge", [-146.5, 1.0, -86.0]],
  ["arcade", [-171.0, 1.0, -80.0]],
  ["well", [-164.0, 1.0, -78.6]],
  ["rf_counter", [60.0, 8.4, 130.0]],
  ["hc_porch", [150.8, 27.2, -68.0]],
  ["dungeon1", [40, 16, -40]],
  ["dungeon2", [30, 12, -58]],
];

const prefix = process.argv[2] ?? "camwalk";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 800 } });
const dir = path.join(process.cwd(), "runs/corealm/screenshots");
try {
  await driver.launch();
  await driver.open(60_000);
  for (const [name, to] of stops) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await driver.callDebug("teleport", [to]);
        await driver.wait(900);
        const cam = await driver.callDebug("getCamera") as Record<string, number | boolean>;
        const pos = await driver.callDebug("getPlayerPosition") as Record<string, number>;
        const page = driver.page;
        if (!page) throw new Error("no page");
        await page.screenshot({ path: path.join(dir, `${prefix}-${name}.png`), type: "png", timeout: 180_000 });
        console.log(`${name.padEnd(12)} player=${JSON.stringify(pos)} cam=${JSON.stringify(cam)}`);
        break;
      } catch (cause) {
        console.log(`${name} attempt ${attempt}: ${String(cause).slice(0, 80)}`);
        await driver.open(60_000).catch(() => undefined);
      }
    }
  }
  if (driver.consoleErrors.length) console.log("CONSOLE:", driver.consoleErrors.slice(0, 3));
} finally {
  await driver.close();
  await server.close();
}
