/**
 * All 18 named poses in one browser session.
 *
 * `npm run screenshot` launches Chromium, boots the world and tears it down per shot, which is ~25 s
 * of boot per image. Reusing one session makes an 18-shot sweep a 40 s job, which is what makes it
 * cheap enough to look at the whole world after every tuning change.
 */
import path from "node:path";
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { SHOTS } from "../../../game/src/debug/shots.js";

const prefix = process.argv[2] ?? "sct";
const only = process.argv[3]?.split(",");

// HMR off and the file watcher disabled: eight agents are editing this tree at once, and a hot
// reload halfway through a sweep tears down `window.__gameDebug` and kills the run.
const vite = await createServer({
  root: path.resolve("game"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (!address || typeof address === "string") throw new Error("vite did not expose a port");
const server = { url: `http://127.0.0.1:${address.port}`, close: async (): Promise<void> => { await vite.close(); } };
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
await driver.launch();
await driver.open();

for (const shot of SHOTS) {
  if (only && !only.includes(shot.id)) continue;
  await driver.callDebug("setCameraPreset", [shot.id]);
  await driver.wait(400);
  const file = await driver.screenshot("runs/corealm/screenshots", `${prefix}-${shot.id}`);
  console.log(shot.id, "->", file);
}

const errors = await driver.callDebug("getErrors", []);
console.log("errors", JSON.stringify(errors).slice(0, 400));
await driver.close();
await server.close();
