/**
 * Live reachability probe with HMR OFF.
 *
 * `npm run play` starts Vite with the default watcher, and five other agents are saving files in
 * game/src right now: every save triggers a full page reload and the driver dies with "Execution
 * context was destroyed". This harness is the same browser, the same page, the same __gameDebug
 * surface, with `server.hmr: false` and the watcher ignoring everything.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(here, "../../../game");

const vite = await createServer({
  root: gameRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: { ignored: ["**/*"] } },
});
await vite.listen();
const address = vite.httpServer?.address();
if (!address || typeof address === "string") throw new Error("no port");
const url = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 400)); });
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 400)));

const bootStart = Date.now();
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForFunction(() => (window as never as { __gameDebug?: { getState(): { ready?: boolean } } }).__gameDebug?.getState().ready === true, undefined, { timeout: 120_000 });
console.log("cold boot to ready:", Date.now() - bootStart, "ms");

const call = async (method: string, args: unknown[] = []): Promise<unknown> =>
  page.evaluate(async ({ m, a }) => {
    const api = (window as never as { __gameDebug: Record<string, (...v: unknown[]) => unknown> }).__gameDebug;
    const fn = api[m];
    if (typeof fn !== "function") throw new Error(`__gameDebug.${m} missing`);
    return JSON.parse(JSON.stringify((await fn(...a)) ?? null));
  }, { m: method, a: args });

const KARROW = ["highcairn_outpost", "highcairn_bank", "highcairn_plots", "karrow_ramp_two",
  "karrow_ramp_three", "upper_karrow_seam", "great_cairn", "gravelmaw_entrance"];

await call("teleport", [{ locationId: "karrowmoor_terraces" }]);
await page.waitForTimeout(400);
console.log("player at Lower Quarry:", JSON.stringify(await call("getPlayerPosition")));

// 6x7 grid over x 50..300, z 0..-180, the grid the earlier audit used.
console.log("\n-- reachability grid from the Lower Quarry (60,-16) --");
console.log("      " + [50, 100, 150, 200, 250, 300].map((v) => String(v).padStart(4)).join(""));
let reach = 0; let total = 0;
for (let z = 0; z >= -180; z -= 30) {
  let line = `z=${String(z).padStart(4)} `;
  for (let x = 50; x <= 300; x += 50) {
    const y = (await call("groundHeight", [x, z])) as number;
    const from = (await call("getPlayerPosition")) as { x: number; y: number; z: number };
    const p = await call("getNavPath", [[from.x, from.y, from.z], [x, y, z]]);
    total += 1;
    const okCell = Array.isArray(p) && p.length > 0;
    if (okCell) reach += 1;
    line += okCell ? " ok " : " XX ";
  }
  console.log(line);
}
console.log(`grid reachable ${reach}/${total}`);

console.log("\n-- named ids from the Lower Quarry --");
for (const id of KARROW) {
  const route = await call("planRoute", ["karrowmoor_terraces", id, 1]);
  const mv = await call("callTool", ["corealm_move_to", { locationId: id }]) as Record<string, unknown>;
  await call("callTool", ["corealm_stop", {}]);
  const r = route as { legs?: unknown[]; totalMetres?: number } | null;
  console.log(`${id.padEnd(22)} moveTo=${mv && mv.error ? "REFUSED " + mv.error : "ok len=" + Number(mv?.pathLength ?? 0).toFixed(1)}`
    + `  planRoute=${r ? `${r.legs?.length ?? 0} legs ${Number(r.totalMetres ?? 0).toFixed(1)} m` : "null"}`);
}

console.log("\n-- the three gate-check journeys --");
const journeys: [string, string, string][] = [
  ["arena -> gravelmaw_chamber1 (inside the dungeon)", "gravelmaw_arena", "gravelmaw_chamber1"],
  ["arena -> gravelmaw_entrance (the mouth, on the surface)", "gravelmaw_arena", "gravelmaw_entrance"],
  ["arena -> bracken_pit (cold-iron stage 1 after the boss)", "gravelmaw_arena", "bracken_pit"],
  ["arena -> great_cairn", "gravelmaw_arena", "great_cairn"],
  ["town_center -> great_cairn", "town_center", "great_cairn"],
  ["town_center -> highcairn_outpost", "town_center", "highcairn_outpost"],
];
for (const [label, fromId, toId] of journeys) {
  await call("teleport", [{ locationId: fromId }]);
  await page.waitForTimeout(400);
  const st = await call("getState") as { regionId?: string };
  const mv = await call("callTool", ["corealm_move_to", { locationId: toId }]) as Record<string, unknown>;
  await call("callTool", ["corealm_stop", {}]);
  console.log(`${label.padEnd(56)} region=${st.regionId} -> ${mv && mv.error ? "REFUSED " + mv.error : "ok len=" + Number(mv?.pathLength ?? 0).toFixed(1)}`);
}

console.log("\nconsole errors:", consoleErrors.length ? consoleErrors.slice(0, 5) : "none");
await browser.close();
await vite.close();
