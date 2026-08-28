import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { startGameServer } from "../lib/server.js";
import type {} from "../lib/debug-api.js";

const SCRIPT = process.env.PROBE_SCRIPT ?? "(async()=>({}))()";

async function main(): Promise<void> {
  const server = await startGameServer();
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--mute-audio"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
  await page.goto(server.url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 90_000 });
  await page.evaluate(() => { (window.__gameDebug as unknown as { setTimeScale(n: number): void }).setTimeScale(20); });
  try {
    const out = await page.evaluate(SCRIPT);
    console.log(JSON.stringify(out, null, 2));
  } catch (error) {
    console.log("EVAL ERROR", error instanceof Error ? error.message.slice(0, 600) : String(error));
  }
  await browser.close();
  await server.close();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
