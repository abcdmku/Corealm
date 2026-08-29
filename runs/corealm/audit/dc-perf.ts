/**
 * Same measurement as tools/perf-test.ts, with vite HMR off so a concurrent agent editing another
 * render file cannot reload the page halfway through an 18-pose run.
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { gameRoot } from "../../../tools/lib/paths.js";

const GPU_ARGS = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit", "--disable-gpu-vsync", "--mute-audio"];
const seconds = Number(process.env.DC_SECONDS ?? 4);
const vite = await createServer({
  root: gameRoot, logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const addr = vite.httpServer!.address() as { port: number };
const url = `http://127.0.0.1:${addr.port}`;
const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForFunction(() => (window as any).__gameDebug?.getState().ready === true, undefined, { timeout: 90_000 });
const shots = await page.evaluate(() => (window as any).__gameDebug.listShots()) as string[];
const src = (ms: number) => `new Promise((resolve)=>{const t=[];let p=performance.now();const d=p+${Math.round(ms)};function s(n){t.push(n-p);p=n;if(n<d)requestAnimationFrame(s);else resolve(t);}requestAnimationFrame(s);})`;
const rows: any[] = [];
for (const shot of shots) {
  await page.evaluate((id: string) => (window as any).__gameDebug.focusCamera(id), shot);
  await page.waitForTimeout(700);
  const samples = (await page.evaluate(src(seconds * 1000))) as number[];
  const m = await page.evaluate(() => (window as any).__gameDebug.getMetrics()) as Record<string, number>;
  const u = samples.slice(3).sort((a, b) => a - b);
  const at = (f: number) => u.length ? Math.round(u[Math.min(u.length - 1, Math.floor(u.length * f))]! * 100) / 100 : 0;
  rows.push({ shot, med: at(0.5), p95: at(0.95), worst: u.length ? Math.round(u[u.length - 1]! * 100) / 100 : 0,
    dc: m.drawCalls ?? 0, tris: m.triangles ?? 0, heap: m.heapMB ?? 0 });
}
console.log(JSON.stringify(rows));
await browser.close(); await vite.close();
