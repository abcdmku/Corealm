/**
 * Boot probe: does the page load, does the ground program link, and how long does a frame take?
 *
 * Exists because the first capture run after the ground shader gained two normal-map fetches hung
 * inside `page.screenshot`, and a hung screenshot cannot tell a shader link failure from a slow
 * frame. This prints console output, WebGL program info logs, metrics and a frame sample without
 * ever asking for an image.
 *
 *   npx tsx runs/corealm/audit/gd-probe.ts
 */
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

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
  on(event: string, handler: (message: { type(): string; text(): string }) => void): void;
}

const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  const page = (driver as unknown as { page: PageLike }).page;
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.log(`[${message.type()}] ${message.text().slice(0, 400)}`);
    }
  });
  page.on("pageerror", (error) => console.log(`[pageerror] ${String(error).slice(0, 400)}`));
  const startedAt = Date.now();
  await driver.open(120_000);
  console.log(`ready in ${Date.now() - startedAt} ms`);

  await driver.callDebug("setCameraPreset", ["palewood_copse"]);
  await driver.wait(1200);

  const report = await page.evaluate<Record<string, unknown>>(
    "(async () => { const m = window.__gameDebug.getMetrics();"
    + " const t = []; let last = performance.now();"
    + " await new Promise((done) => { let n = 0; const step = () => { const now = performance.now();"
    + "   t.push(now - last); last = now; n += 1; if (n < 90) requestAnimationFrame(step); else done(null); };"
    + "   requestAnimationFrame(step); });"
    + " const s = t.slice(5).sort((a, b) => a - b);"
    + " return { drawCalls: m.drawCalls, triangles: m.triangles, programs: m.programs, heapMB: m.heapMB,"
    + "   medianMs: Math.round(s[Math.floor(s.length / 2)] * 100) / 100,"
    + "   worstMs: Math.round(s[s.length - 1] * 100) / 100 }; })()",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await driver.close();
  await server.close();
}
