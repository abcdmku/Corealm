/**
 * Does the mouse still name what it is pointing at?
 *
 * Moving the entity layer from `InstancedMesh` to `BatchedMesh` changes how a raycast hit is
 * resolved: three reports the hit instance as `intersection.batchId` rather than `instanceId`, and
 * one shared batch serves many groups, so `EntityViews.ownerOf` has to look the (group, slot) up
 * from the batch instead of reading `group.slots[instanceId]`. Nothing in gate-check drives the
 * mouse — it acts through `moveTo({entityId})` — so this is the only check that would catch a
 * silently dead picker.
 *
 * It sweeps real `mousemove` events over a grid of canvas points at two dense poses and reads back
 * the `.hover-label` the mouse controller writes, which is downstream of `EntityViews.pick`.
 *
 *   npx tsx runs/corealm/audit/dcb-pick.ts
 */
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

const vite = await createServer({
  root: gameRoot, logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
const server = { url: `http://127.0.0.1:${address.port}`, close: async (): Promise<void> => { await vite.close(); } };

interface MouseLike { move(x: number, y: number): Promise<void> }
interface PageLike {
  mouse: MouseLike;
  evaluate<T>(fn: () => T): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
}

const width = 1440;
const height = 900;
const driver = new GameDriver(server, { viewport: { width, height } });
try {
  await driver.launch();
  await driver.open();
  const page = (driver as unknown as { page: PageLike }).page;

  for (const shot of ["bracken_pit", "town_center", "highcairn"]) {
    await driver.callDebug("setCameraPreset", [shot]);
    await driver.wait(800);
    const found = new Set<string>();
    for (let gy = 2; gy <= 7; gy += 1) {
      for (let gx = 1; gx <= 8; gx += 1) {
        await page.mouse.move((gx * width) / 9, (gy * height) / 10);
        // The hover pick is throttled to HOVER_THROTTLE_MS (70) and runs off the frame loop.
        await page.waitForTimeout(110);
        const label = await page.evaluate(() =>
          document.querySelector(".hover-label")?.textContent ?? "");
        if (label) found.add(label);
      }
    }
    console.log(`${shot}: ${found.size} distinct hover labels -> ${[...found].slice(0, 8).join(" | ")}`);
  }
} finally {
  await driver.close();
  await server.close();
}
