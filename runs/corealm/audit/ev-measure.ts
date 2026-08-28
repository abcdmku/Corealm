/**
 * entityViews measurement harness (worker key: ev).
 *
 * Drives the real Vite game, walks the four presets the task names, and prints
 * getEntityViewStats() / getSceneStats() at each one plus a screenshot. Run:
 *
 *   npx tsx runs/corealm/audit/ev-measure.ts <namePrefix>
 */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const PRESETS = ["town_center", "bank", "rootfall", "highcairn"];

async function main(): Promise<void> {
  const prefix = process.argv[2] ?? "ev";
  const shots = process.argv[3] === "no-shots" ? false : true;
  const server = await startGameServer();
  const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
  const out: Record<string, unknown> = {};
  try {
    await driver.launch();
    await driver.open();
    await driver.wait(4000);
    out.spawn = {
      views: await driver.callDebug("getEntityViewStats"),
      scene: await driver.callDebug("getSceneStats"),
    };
    for (const preset of PRESETS) {
      await driver.callDebug("setCameraPreset", [preset]);
      await driver.wait(1200);
      out[preset] = {
        views: await driver.callDebug("getEntityViewStats"),
        scene: await driver.callDebug("getSceneStats"),
      };
      if (shots) {
        await driver.screenshot(
          path.join(process.cwd(), "runs", "corealm", "screenshots"),
          `${prefix}-${preset}`,
        );
      }
    }
    out.npcs = await driver.callDebug("listEntities", [{ archetype: "npc" }]);
    out.errors = await driver.callDebug("getErrors");
  } finally {
    await driver.close();
    await server.close();
  }
  console.log(JSON.stringify(out, null, 2));
}

await main();
