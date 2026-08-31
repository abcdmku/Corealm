/**
 * Burst-captures sequential frames of a walking cow, headed, on the real GPU, so the reported
 * "rapid shaking" can be SEEN rather than inferred. Every numeric record-level metric is clean
 * (herd-shake-probe.ts), so whatever shakes is between the record and the pixels.
 *
 *   npx tsx runs/corealm/audit/shake-burst.ts
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const SERVER = "http://127.0.0.1:4200";
const OUT_DIR = "test-results/shake-burst";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ["--mute-audio", "--window-position=4000,4000", "--window-size=1280,800"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  await page.goto(`${SERVER}/index.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(
    () => (window as never as { __gameDebug?: { getState(): { ready: boolean } } })
      .__gameDebug?.getState().ready === true,
    undefined, { timeout: 60_000 },
  );

  const cowId: string = await page.evaluate(async () => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: [number, number, number]): unknown;
        groundHeight(x: number, z: number): number;
        listEntities(filter?: { archetype?: string }): { id: string }[];
        focusEntity(entityId: string): boolean;
        getEntityMotion(id: string): { motion: string | null } | null;
      };
    }).__gameDebug;
    debug.teleport([-64, debug.groundHeight(-64, -88) + 0.2, -88]);
    const herd = debug.listEntities({ archetype: "enemy" })
      .map((e) => e.id)
      .filter((id) => id.includes("redsill_cattle"));
    if (herd.length === 0) throw new Error("no cattle");
    await new Promise((r) => { setTimeout(r, 3_000); });

    // Wait for any cow to start a wander stroll, then frame it.
    const deadline = performance.now() + 45_000;
    while (performance.now() < deadline) {
      for (const id of herd) {
        if (debug.getEntityMotion(id)?.motion === "walk") {
          debug.focusEntity(id);
          return id;
        }
      }
      await new Promise((r) => { setTimeout(r, 40); });
    }
    throw new Error("no cow walked within 45 s");
  });

  console.log(`captured cow: ${cowId}`);
  for (let i = 0; i < 10; i += 1) {
    const stamp: { motion: string | null; clipTime: number | null; drawn: number[] } | null =
      await page.evaluate((id: string) => {
        const debug = (window as never as {
          __gameDebug: {
            getEntityMotion(id: string): {
              motion: string | null; time: number | null; drawnPosition: number[];
            } | null;
          };
        }).__gameDebug;
        const motion = debug.getEntityMotion(id);
        return motion
          ? { motion: motion.motion, clipTime: motion.time, drawn: motion.drawnPosition.slice() }
          : null;
      }, cowId);
    await page.screenshot({ path: `${OUT_DIR}/frame-${String(i).padStart(2, "0")}.png` });
    console.log(`frame ${i}: motion=${stamp?.motion} clipTime=${stamp?.clipTime?.toFixed(3)} drawn=${stamp?.drawn.map((v) => v.toFixed(3)).join(",")}`);
  }
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
