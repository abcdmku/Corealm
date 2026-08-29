/** All 18 poses in one browser session, prefixed `cov-`. One launch instead of eighteen. */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import { SHOTS } from "../../../game/src/debug/shots.js";

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
await driver.launch();
await driver.open();
const out = path.join("runs", "corealm", "screenshots");
for (const shot of SHOTS) {
  if (only.length > 0 && !only.includes(shot.id)) continue;
  await driver.callDebug("setCameraPreset", [shot.id]);
  await driver.wait(400);
  await driver.screenshot(out, `cov-${shot.id}`);
  console.log("captured", shot.id);
}
const stats = await (driver as unknown as { page: { evaluate: (fn: () => unknown) => Promise<unknown> } }).page.evaluate(() => {
  const d = (window as unknown as { __gameDebug: { getScatterStats(): unknown } }).__gameDebug;
  return d.getScatterStats();
});
console.log(JSON.stringify(stats, null, 1));
await driver.close();
await server.close();
