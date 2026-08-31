/**
 * Measures the drawn yaw rate of a creature through a forced 180-degree reversal.
 *
 * The walk probe samples a straight-line chase, which never turns, so the "animals snap to new
 * directions" defect is invisible to it. This probe provokes a creature, lets it chase, then
 * teleports the player to the mirrored position on the far side of it — the hardest turn the AI
 * can be asked for — and samples `drawnRotationY` at ~30 ms through the pivot.
 *
 * Pass condition: max |dYaw/dt| stays at or under ENEMY_TURN_RATE_RAD_PER_S (7 rad/s = 401 deg/s)
 * plus sampling noise. Before the cap, this measured in the thousands of deg/s.
 *
 *   npx tsx runs/corealm/audit/turn-reversal-probe.ts goat cow hen
 */
import { chromium } from "playwright";
import { startGameServer } from "../../../tools/lib/server.js";

const filters = process.argv.slice(2);
const server = await startGameServer({ logLevel: "error" });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });

try {
  const base = server.url.endsWith("/") ? server.url : `${server.url}/`;
  await page.goto(new URL("/index.html?mode=combat", base).href, {
    waitUntil: "domcontentloaded", timeout: 30_000,
  });
  await page.waitForFunction(
    () => window.__featureLab?.getState().ready === true, undefined, { timeout: 30_000 },
  );

  const presets: { id: string }[] = await page.evaluate(
    () => window.__featureLab!.getCatalog().targets.creature.map((p: { id: string }) => ({ id: p.id })),
  );
  const chosen = presets.filter((p) => filters.length === 0 || filters.some((f) => p.id.includes(f)));

  await page.evaluate(() => {
    for (const skill of ["melee", "magic"]) window.__featureLab!.setLevel(skill as never, 1 as never);
  });
  await page.evaluate(async () => { await window.__featureLab!.equipPlayer("mainHand", null); });

  console.log(`${"creature".padEnd(24)} ${"turn max".padStart(9)} ${"turn p95".padStart(9)} ${"off med".padStart(8)} ${"off max".padStart(8)}  verdict`);
  for (const preset of chosen) {
    const row = await page.evaluate(async (presetId: string) => {
      const lab = window.__featureLab!;
      const debug = (window as never as {
        __gameDebug: {
          getEntityMotion(id: string): { drawnRotationY: number; drawnPosition: number[]; semanticPosition: number[] } | null;
          groundHeight(x: number, z: number): number;
          teleport(to: [number, number, number]): unknown;
          getPlayerPosition(): { x: number; y: number; z: number };
        };
      }).__gameDebug;

      const spawned = await lab.spawnTarget("creature", presetId, { distance: 6 });
      const entityId = spawned.target!.entityId;
      await lab.perform("attack");
      const until = performance.now() + 6_000;
      while (performance.now() < until) {
        if (lab.getState().target?.ai?.state === "aggro") break;
        await new Promise((r) => { setTimeout(r, 50); });
      }
      await lab.perform("flee");

      // Phase 1: 1.5 s of straight chase. Phase 2: mirror the player through the creature so the
      // pursuit heading reverses, then 2.5 s through the pivot. Sampling is inlined rather than a
      // named helper because tsx's keepNames wraps one in `__name`, which does not exist in-page.
      const samples: { atMs: number; yaw: number; off: number }[] = [];
      for (let i = 0; i < 130; i += 1) {
        if (i === 50) {
          const creature = debug.getEntityMotion(entityId)!.semanticPosition;
          const player = debug.getPlayerPosition();
          debug.teleport([
            creature[0]! * 2 - player.x, player.y, creature[2]! * 2 - player.z,
          ]);
        }
        const motion = debug.getEntityMotion(entityId);
        if (motion) {
          const [x, y, z] = motion.drawnPosition;
          samples.push({
            atMs: performance.now(),
            yaw: motion.drawnRotationY,
            off: Math.abs(y! - debug.groundHeight(x!, z!)),
          });
        }
        await new Promise((r) => { setTimeout(r, 30); });
      }
      return { samples };
    }, preset.id);

    const rates: number[] = [];
    const offs: number[] = [];
    for (let i = 1; i < row.samples.length; i += 1) {
      const a = row.samples[i - 1]!;
      const b = row.samples[i]!;
      const dt = (b.atMs - a.atMs) / 1000;
      if (dt <= 0) continue;
      let d = b.yaw - a.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      rates.push(Math.abs(d) / dt * 180 / Math.PI);
      offs.push(b.off);
    }
    rates.sort((x, y) => x - y);
    offs.sort((x, y) => x - y);
    const pick = (arr: number[], f: number): number => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] ?? 0;
    const max = rates.at(-1) ?? 0;
    const verdict = max <= 430 ? "ok" : `SNAP ${max.toFixed(0)} deg/s`;
    console.log(
      `${preset.id.padEnd(24)} ${max.toFixed(0).padStart(9)} ${pick(rates, 0.95).toFixed(0).padStart(9)}`
      + ` ${pick(offs, 0.5).toFixed(3).padStart(8)} ${(offs.at(-1) ?? 0).toFixed(3).padStart(8)}  ${verdict}`,
    );
    await page.evaluate(async () => { await window.__featureLab!.perform("reset-player"); });
  }
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  await server.close().catch(() => undefined);
}
