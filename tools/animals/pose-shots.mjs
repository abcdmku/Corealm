import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { startServer } from "./serve.mjs";

const animals = process.argv.slice(2);
const targets = animals.length ? animals : ["animal_chicken", "animal_deer", "animal_frog"];
// Which model directory the ids live in. Bosses are built by tools/build-bosses.ts into
// models/boss, and are worth judging the same way: keyframe counts cannot tell you whether a
// charge reads as a charge, and four rendered phases with a locked camera can.
const dir = process.env.POSE_DIR ?? "animal";
const out = process.env.POSE_OUT ?? "runs/corealm/animals/poses";
await mkdir(out, { recursive: true });

const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 360 } });
await page.goto(`${server.url}/tools/animals/pose.html`);
await page.waitForFunction(() => typeof window.showPose === "function", null, { timeout: 30000 });

// 0.0 rest, 0.30 the strike, 0.55 the hold, 1.0 recovered.
const phases = (process.env.POSE_PHASES ?? "0,0.3,0.55").split(",").map(Number);
for (const id of targets) {
  for (const clip of (process.env.POSE_CLIPS ?? "Idle,Attack").split(",")) {
    for (const phase of phases) {
      const info = await page.evaluate(
        ([u, c, p]) => window.showPose(u, c, p),
        [`/game/public/assets/models/${dir}/${id}.glb`, clip, phase],
      );
      if (!info.found) { console.log(`${id} ${clip}: NOT FOUND`); break; }
      await page.screenshot({ path: `${out}/${id}-${clip}-${String(phase).replace(".", "")}.png`, timeout: 60000 });
    }
  }
  console.log(`shot ${id}`);
}
await browser.close();
await server.close();
