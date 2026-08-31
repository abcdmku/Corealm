import { chromium } from "playwright";
import { readdir } from "node:fs/promises";
import { startServer } from "./serve.mjs";

const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
await page.goto(`${server.url}/tools/animals/convert.html`);
await page.waitForFunction(() => typeof window.probeFbx === "function", null, { timeout: 30000 });

const files = (await readdir("./.asset-cache/animal-pack/models")).filter((f) => /\.fbx$/i.test(f));
for (const f of files.sort()) {
  try {
    const i = await page.evaluate((u) => window.probeFbx(u), `/.asset-cache/animal-pack/models/${f}`);
    const m = i.sizeM.map((v) => v.toFixed(2)).join(" x ");
    console.log(`${f.padEnd(30)} ${m.padStart(22)} m  bones=${String(i.boneCount).padStart(3)}  minY=${i.minM[1].toFixed(2)}`);
    for (const mesh of i.meshes) {
      console.log(`    mesh ${mesh.name.padEnd(26)} ${String(mesh.verts).padStart(6)}v  mats=[${mesh.materials.join(", ")}]`);
    }
  } catch (e) {
    console.error(`${f.padEnd(30)} FAILED ${e.message.split("\n")[0].slice(0, 90)}`);
  }
}
await browser.close();
await server.close();
