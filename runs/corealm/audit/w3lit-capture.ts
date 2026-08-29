/**
 * ONE browser session: all 18 shots.ts presets, plus a scene census and an ambience ablation.
 *
 * A previous wave left ~10 GB of orphaned Chromium behind, so everything this pass needs from a
 * live page happens here and nowhere else. Writes runs/corealm/_w3lit-<tag>.json beside the PNGs.
 */
import fs from "node:fs";
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import { SHOTS } from "../../../game/src/debug/shots.js";

const tag = process.argv[2] ?? "before";
const prefix = `lit${tag === "before" ? "" : tag}`;
const dir = path.join(process.cwd(), "runs/corealm/screenshots");
const census = fs.readFileSync(path.join(process.cwd(), "runs/corealm/audit/w3lit-census.js"), "utf8");

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
const out: Record<string, unknown> = {};
try {
  await driver.launch();
  await driver.open(120_000);
  const page = driver.page;
  if (!page) throw new Error("driver has no page");

  const shots: Record<string, unknown> = {};
  for (const shot of SHOTS) {
    await driver.callDebug("setCameraPreset", [shot.id]);
    await driver.wait(600);
    await page.screenshot({ path: path.join(dir, `${prefix}-${shot.id}.png`), type: "png", timeout: 180_000 });
    shots[shot.id] = await driver.callDebug("getMetrics");
    console.log(`shot ${shot.id}`);
  }
  out.shots = shots;

  // The census needs the temporary __probeRenderer hook in renderer.ts. It is not in the shipped
  // file, so this half only runs when someone has put it back for a measurement pass.
  const hooked = await page.evaluate("typeof window.__probeRenderer !== 'undefined'");
  if (hooked === true) {
    out.census = await page.evaluate(`${census}({})`);
  } else {
    out.census = "no __probeRenderer hook in renderer.ts";
  }

  out.consoleErrors = driver.consoleErrors.slice(0, 8);
  out.pageErrors = driver.pageErrors.slice(0, 8);
} finally {
  await driver.close();
  await server.close();
}
fs.writeFileSync(path.join(process.cwd(), `runs/corealm/_w3lit-${tag}.json`), JSON.stringify(out, null, 1));
console.log("wrote", `runs/corealm/_w3lit-${tag}.json`);
