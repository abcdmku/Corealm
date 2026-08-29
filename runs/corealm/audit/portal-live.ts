/**
 * Live proof that "walk to that thing" now crosses a portal.
 *
 * Teleports to the boss floor, plans a route out, then actually walks it and watches the player's
 * region flip from `gravelmaw` to `karrowmoor` mid-journey. HMR is off for the same reason
 * `ramp-live.ts` turns it off: other agents are saving files in game/src while this runs.
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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 300)));

  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(
    "window.__gameDebug && window.__gameDebug.getState().ready === true",
    undefined,
    { timeout: 120_000 },
  );

  const call = async (method: string, args: unknown[] = []): Promise<unknown> =>
    page.evaluate(async ({ m, a }) => {
      const api = (window as never as { __gameDebug: Record<string, (...v: unknown[]) => unknown> }).__gameDebug;
      const fn = api[m];
      if (typeof fn !== "function") throw new Error(`__gameDebug.${m} missing`);
      return JSON.parse(JSON.stringify((await fn(...a)) ?? null));
    }, { m: method, a: args });

  const where = async (): Promise<string> => {
    const p = await call("getPlayerPosition") as { x: number; y: number; z: number };
    const s = await call("getState") as { regionId?: string };
    return `(${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}) region=${s.regionId}`;
  };

  await call("setTimeScale", [20]);

  console.log("=== planRoute over the graph, arena -> bracken_pit, Agility 20");
  const plan = await call("planRoute", ["gravelmaw_arena", "bracken_pit", 20]) as
    { path?: string[]; cost?: number; legs?: { kind: string; fromId: string; toId: string; cost: number; toRegionId?: string }[] } | null;
  if (!plan) console.log("  NO PLAN");
  else {
    console.log(`  path: ${(plan.path ?? []).join(" > ")}`);
    console.log(`  cost: ${plan.cost}s over ${(plan.legs ?? []).length} legs`);
    for (const leg of plan.legs ?? []) {
      console.log(`    ${leg.kind.padEnd(8)} ${leg.fromId.padEnd(28)} -> ${leg.toId.padEnd(24)}`
        + ` ${leg.cost.toFixed(1)}s${leg.toRegionId ? ` region=${leg.toRegionId}` : ""}`);
    }
  }

  for (const target of [
    { label: "locationId gravelmaw_entrance (the mouth, on the surface)", arg: { locationId: "gravelmaw_entrance" } },
    { label: "entityId bracken_pit_grithe_1 (a Grithe seam 400 m away in Fallowmarch)", arg: { entityId: "bracken_pit_grithe_1" } },
  ]) {
    console.log(`\n=== corealm_move_to ${target.label}`);
    await call("teleport", [{ locationId: "gravelmaw_arena" }]);
    await page.waitForTimeout(600);
    console.log("  start:  " + await where());

    let cursor = ((await call("callTool", ["corealm_events", { sinceSeq: 0, timeoutMs: 0 }])) as { nextSeq?: number }).nextSeq ?? 0;
    const moved = await call("callTool", ["corealm_move_to", target.arg]) as Record<string, unknown>;
    if (moved && moved.error) { console.log("  REFUSED " + moved.error + " " + moved.message); continue; }
    console.log(`  accepted: pathLength ${Number(moved.pathLength).toFixed(1)} m, eta ${Math.round(Number(moved.etaMs) / 1000)}s of sim time`);

    let flipped = "";
    let done = "";
    for (let tick = 0; tick < 240 && !done; tick += 1) {
      const seen = await call("callTool", ["corealm_events",
        { sinceSeq: cursor, types: ["navigation.completed", "navigation.failed"], timeoutMs: 0 }]) as
        { events?: { type: string; data?: Record<string, unknown> }[]; nextSeq?: number };
      cursor = seen.nextSeq ?? cursor;
      const state = await call("getState") as { regionId?: string };
      if (!flipped && state.regionId !== "gravelmaw") flipped = "  crossed:  " + await where();
      const last = (seen.events ?? []).pop();
      if (last) done = last.type;
      await page.waitForTimeout(250);
    }
    if (flipped) console.log(flipped); else console.log("  crossed:  NEVER — still in the dungeon");
    console.log("  end:    " + await where() + (done ? `  [${done}]` : "  [still walking]"));
  }

  console.log("\nconsole errors:", consoleErrors.length ? consoleErrors.slice(0, 5) : "none");
} finally {
  await browser.close();
  await vite.close();
}
