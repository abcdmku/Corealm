/**
 * All 18 shot presets in ONE browser session, with per-pose draw calls and triangles.
 *
 * Batched into a single launch on purpose: every `npm run screenshot` starts its own Chromium and
 * its own Vite server, and eighteen of those is eighteen servers. HMR and the file watcher are off
 * because other agents are writing render/ while this runs.
 *
 *   npx tsx runs/corealm/audit/gd-shots.ts <prefix> [shotId ...]
 */
import path from "node:path";
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

const ALL_SHOTS = [
  "spawn", "town_entrance", "town_center", "bank", "bracken_pit", "palewood_copse",
  "redsill_shallows", "marchfield_farm", "rootfall", "vellenwood_canopy", "hollowcut_seam",
  "karrowmoor_terraces", "highcairn", "upper_karrow_seam", "sunder_ledge", "gravelmaw_entrance",
  "great_cairn", "march_road",
];

const args = process.argv.slice(2);
const prefix = args[0] ?? "gd";
const shots = args.length > 1 ? args.slice(1) : ALL_SHOTS;

const vite = await createServer({
  root: gameRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
const server = { url: `http://127.0.0.1:${address.port}`, close: async (): Promise<void> => { await vite.close(); } };

interface PageLike {
  evaluate<T>(fn: string): Promise<T>;
  screenshot(options: { path: string; type: "png"; timeout: number }): Promise<unknown>;
}

const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  // A string body, not an arrow function: tsx rewrites arrow functions with a `__name` helper that
  // does not exist inside the page, and the evaluate then throws.
  const page = driver as unknown as { page: PageLike };
  const out = path.join("runs", "corealm", "screenshots");
  const rows: { shot: string; calls: number; tris: number; programs: number }[] = [];

  for (const shot of shots) {
    await driver.callDebug("setCameraPreset", [shot]);
    await driver.wait(900);
    // page.screenshot directly rather than driver.screenshot, for the timeout: four other agents
    // run their own headless Chromium against the same GPU, and eight instances deep a frame takes
    // 850 ms, which blows the driver's fixed 30 s.
    await page.page.screenshot({ path: path.join(out, `${prefix}-${shot}.png`), type: "png", timeout: 180_000 });
    const row = await page.page.evaluate<{ calls: number; tris: number; programs: number }>(
      "(() => { const m = window.__gameDebug.getMetrics();"
      + " return { calls: m.drawCalls || 0, tris: m.triangles || 0, programs: m.programs || 0 }; })()",
    );
    rows.push({ shot, ...row });
    console.log(`${shot.padEnd(22)} calls ${String(row.calls).padStart(4)}  tris ${(row.tris / 1e6).toFixed(2)}M`);
  }

  const worstCalls = rows.reduce((a, b) => (b.calls > a.calls ? b : a));
  const worstTris = rows.reduce((a, b) => (b.tris > a.tris ? b : a));
  console.log(`\nworst calls ${worstCalls.calls} (${worstCalls.shot})`);
  console.log(`worst tris  ${(worstTris.tris / 1e6).toFixed(2)}M (${worstTris.shot})`);
} finally {
  await driver.close();
  await server.close();
}
