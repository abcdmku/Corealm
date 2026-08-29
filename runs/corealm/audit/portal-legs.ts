/**
 * Which leg of the escape route dies, under the gate check's own conditions.
 *
 * gate-check reaches the cold-iron travel with Agility 20 and Melee 30, which changes the plan: the
 * planner takes the Chimney Climb and the Rootfall shortcut instead of walking round them. This
 * reproduces that and prints the `navigation.failed` payload, which carries the leg index.
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
  await page.waitForFunction("window.__gameDebug && window.__gameDebug.getState().ready === true", undefined, { timeout: 120_000 });

  const call = async (method: string, args: unknown[] = []): Promise<unknown> =>
    page.evaluate(async ({ m, a }) => {
      const api = (window as never as { __gameDebug: Record<string, (...v: unknown[]) => unknown> }).__gameDebug;
      const fn = api[m];
      if (typeof fn !== "function") throw new Error(`__gameDebug.${m} missing`);
      return JSON.parse(JSON.stringify((await fn(...a)) ?? null));
    }, { m: method, a: args });

  await call("setTimeScale", [20]);
  await call("setSkillLevel", ["agility", 20]);
  await call("setSkillLevel", ["melee", 30]);
  await call("setHealth", [999]);

  const plan = await call("planRoute", ["gravelmaw_arena", "bracken_pit", 20]) as
    { legs?: { kind: string; fromId: string; toId: string; from: number[]; to: number[]; cost: number }[] } | null;
  console.log("=== plan legs at Agility 20");
  for (const [i, leg] of (plan?.legs ?? []).entries()) {
    console.log(`  ${String(i).padStart(2)} ${leg.kind.padEnd(8)} ${leg.fromId.padEnd(28)} -> ${leg.toId.padEnd(26)}`
      + ` to (${leg.to.map((v) => v.toFixed(1)).join(", ")})`);
  }

  for (const target of [
    { label: "locationId bracken_pit (cold-iron stage 1)", arg: { locationId: "bracken_pit" } },
    { label: "entityId npc_cairnkeeper_ode (long-cairn stage 5, from The Collapse)", arg: { entityId: "npc_cairnkeeper_ode" }, from: "gravelmaw_chamber2" },
  ]) {
    console.log(`\n=== ${target.label}`);
    await call("teleport", [{ locationId: target.from ?? "gravelmaw_arena" }]);
    await call("setHealth", [999]);
    await page.waitForTimeout(600);

    let cursor = ((await call("callTool", ["corealm_events", { sinceSeq: 0, timeoutMs: 0 }])) as { nextSeq?: number }).nextSeq ?? 0;
    const moved = await call("callTool", ["corealm_move_to", target.arg]) as Record<string, unknown>;
    if (moved && moved.error) { console.log("  REFUSED " + moved.error + " " + moved.message); continue; }
    console.log(`  accepted: ${Number(moved.pathLength).toFixed(1)} m, eta ${Math.round(Number(moved.etaMs) / 1000)}s sim`);

    let done = "";
    for (let tick = 0; tick < 240 && !done; tick += 1) {
      const seen = await call("callTool", ["corealm_events",
        { sinceSeq: cursor, types: ["navigation.completed", "navigation.failed", "player.died"], timeoutMs: 0 }]) as
        { events?: { type: string; data?: Record<string, unknown> }[]; nextSeq?: number };
      cursor = seen.nextSeq ?? cursor;
      for (const e of seen.events ?? []) {
        console.log(`  event ${e.type} ${JSON.stringify(e.data)}`);
        done = e.type;
      }
      await page.waitForTimeout(250);
    }
    const p = await call("getPlayerPosition") as { x: number; y: number; z: number };
    const s = await call("getState") as { regionId?: string; health?: number };
    console.log(`  end (${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}) region=${s.regionId} health=${s.health} [${done || "still walking"}]`);
  }

  console.log("\nconsole errors:", consoleErrors.length ? consoleErrors.slice(0, 5) : "none");
} finally {
  await browser.close();
  await vite.close();
}
