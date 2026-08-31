import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { startServer } from "./serve.mjs";
const { ANIMALS } = await import("./catalog.mjs");
const ranges = JSON.parse(readFileSync(".asset-cache/animal-pack/clip-ranges.json", "utf8"));
const lower = new Map(Object.entries(ranges).map(([k, v]) => [k.toLowerCase(), v]));

const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${server.url}/tools/animals/convert.html`);
await page.waitForFunction(() => typeof window.probeStride === "function", null, { timeout: 30000 });

console.log("animal                 stride   clip    implied   rate for 3.1 m/s");
for (const a of ANIMALS) {
  const walk = a.clips.find((c) => c[1] === "Walk");
  if (!walk) continue;
  const file = walk[0];
  const r = lower.get((file + ".fbx").toLowerCase()) ?? lower.get((file + ".FBX").toLowerCase());
  const frames = walk[2] ?? (r ? [r.first, r.last] : null);
  const info = await page.evaluate(
    ([rig, clip, f, n]) => window.probeStride(rig, clip, f, n),
    [`/.asset-cache/animal-pack/models/${a.rig}`, `/.asset-cache/animal-pack/anims/${file}.fbx`, frames, "Walk"],
  ).catch(() => null);
  if (!info) { console.log(`${a.id.padEnd(22)} FAILED`); continue; }
  const rate = info.impliedMps > 0.05 ? (3.1 / info.impliedMps) : 0;
  console.log(`${a.id.padEnd(22)} ${info.strideM.toFixed(2)}m ${info.duration.toFixed(2)}s ${info.impliedMps.toFixed(2)} m/s   x${rate.toFixed(2)}`);
}
await browser.close();
await server.close();
