/**
 * Five poses plus their draw-call and triangle counts in ONE browser session. Answers "is a
 * building opaque from outside" by eye and "what did buildings.ts cost" by number, for one launch.
 *
 * HMR IS OFF. The first run of this died on "Execution context was destroyed": three other agents
 * are editing render/ right now and vite reloaded the page mid-pose. `watch: null` also stops the
 * file watcher, so a concurrent write cannot restart the module graph underneath a capture.
 *
 *   npx tsx runs/corealm/audit/w4-shots.ts <prefix> [shotId ...]
 */
import path from "node:path";
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

const args = process.argv.slice(2);
const prefix = args[0] ?? "w4";
const shots = args.length > 1 ? args.slice(1)
  : ["rootfall", "town_entrance", "highcairn", "town_center", "hollowcut_seam"];

const vite = await createServer({
  root: gameRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
const server = { url: `http://127.0.0.1:${address.port}`, close: async (): Promise<void> => { await vite.close(); } };

const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  const page = (driver as unknown as { page: { evaluate: (fn: () => unknown) => Promise<unknown> } }).page;
  const out = path.join("runs", "corealm", "screenshots");
  const rows: Record<string, unknown>[] = [];
  for (const shot of shots) {
    await driver.callDebug("setCameraPreset", [shot]);
    await driver.wait(700);
    await driver.screenshot(out, `${prefix}-${shot}`);
    const m = await page.evaluate(() => (window as unknown as {
      __gameDebug: { getMetrics(): Record<string, number> } }).__gameDebug.getMetrics()) as Record<string, number>;
    rows.push({ shot, dc: m.drawCalls ?? 0, tris: m.triangles ?? 0 });
    console.log(`captured ${prefix}-${shot}  dc=${m.drawCalls} tris=${m.triangles}`);
  }
  console.log(JSON.stringify(rows));
} finally {
  await driver.close();
  await server.close();
}
