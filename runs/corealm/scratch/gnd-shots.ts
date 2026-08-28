import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import { prepareRun } from "../../../tools/lib/paths.js";

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const ALL = [
  "spawn", "town_entrance", "town_center", "bank", "bracken_pit", "palewood_copse",
  "redsill_shallows", "marchfield_farm", "rootfall", "vellenwood_canopy", "hollowcut_seam",
  "karrowmoor_terraces", "highcairn", "upper_karrow_seam", "sunder_ledge", "gravelmaw_entrance",
  "great_cairn", "march_road",
];
const SHOTS = only.length > 0 ? only : ALL;

interface Metrics { drawCalls: number; triangles: number; programs: number }

const runDir = await prepareRun("runs/corealm");
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
try {
  await driver.launch();
  await driver.open();
  console.log("stats", JSON.stringify(await driver.callDebug("getSceneStats", [])).slice(0, 300));
  for (const shot of SHOTS) {
    let drawn = 0;
    for (let attempt = 0; attempt < 6 && drawn < 20; attempt += 1) {
      try {
        await driver.callDebug("setCameraPreset", [shot]);
        await driver.wait(500);
        const metrics = await driver.callDebug("getMetrics", []) as Metrics;
        drawn = metrics.drawCalls;
      } catch (cause) {
        console.log("retry", shot, String(cause).slice(0, 60));
        await driver.wait(2000);
        await driver.open();
      }
    }
    let saved = false;
    for (let attempt = 0; attempt < 5 && !saved; attempt += 1) {
      try {
        await driver.screenshot(path.join(runDir, "screenshots"), `gnd-${shot}`);
        saved = true;
      } catch (cause) {
        console.log("shot retry", shot, String(cause).slice(0, 60));
        await driver.wait(3000);
      }
    }
    console.log("wrote", shot, "draws", drawn, saved ? "" : "FAILED");
  }
} finally {
  await driver.close();
  await server.close();
}
