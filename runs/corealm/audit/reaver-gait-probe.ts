/**
 * Watches a reaver charge and verifies its locomotion clip and rate: the slow-motion report was a
 * 0.35x Jog_Fwd_Loop; the fix should show Walk_Loop at roughly speed/1.15 with planted feet.
 *
 *   npx tsx runs/corealm/audit/reaver-gait-probe.ts
 */
import { chromium } from "playwright";

const SERVER = "http://127.0.0.1:4200";

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
    undefined, { timeout: 90_000 },
  );

  const rows = await page.evaluate(async () => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: [number, number, number]): unknown;
        groundHeight(x: number, z: number): number;
        listEntities(filter?: { archetype?: string }): { id: string }[];
        getEntity(id: string): { position: number[]; state?: string } | null;
        getEntityMotion(id: string): {
          semanticPosition: number[]; motion: string | null; clip: string | null;
          timeScale: number | null; path: string | null;
        } | null;
        setHealth(health: number): void;
      };
    }).__gameDebug;
    const id = debug.listEntities({ archetype: "enemy" })
      .map((e) => e.id).find((v) => v.includes("reaver"));
    if (!id) throw new Error("no reaver");
    const reaver = debug.getEntity(id)!;
    debug.teleport([reaver.position[0]! + 8, debug.groundHeight(reaver.position[0]! + 8, reaver.position[2]!) + 0.2, reaver.position[2]!]);
    debug.setHealth(9999);

    const out: { atMs: number; x: number; z: number; motion: string | null; clip: string | null; timeScale: number | null; path: string | null; state: string | null }[] = [];
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => { setTimeout(r, 100); });
      const m = debug.getEntityMotion(id);
      if (!m) continue;
      out.push({
        atMs: performance.now(),
        x: m.semanticPosition[0]!, z: m.semanticPosition[2]!,
        motion: m.motion, clip: m.clip, timeScale: m.timeScale, path: m.path,
        state: debug.getEntity(id)?.state ?? null,
      });
    }
    return out;
  });

  const moving = rows.filter((r, i) => i > 0 && Math.hypot(r.x - rows[i - 1]!.x, r.z - rows[i - 1]!.z) > 0.02);
  const speeds: number[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const dt = (rows[i]!.atMs - rows[i - 1]!.atMs) / 1000;
    const d = Math.hypot(rows[i]!.x - rows[i - 1]!.x, rows[i]!.z - rows[i - 1]!.z);
    if (dt > 0 && d / dt > 0.3) speeds.push(d / dt);
  }
  speeds.sort((a, b) => a - b);
  const med = speeds[Math.floor(speeds.length / 2)] ?? 0;
  const clips = [...new Set(moving.map((r) => `${r.motion}:${r.clip}@${r.timeScale?.toFixed(2)}`))];
  const states = [...new Set(rows.map((r) => r.state))];
  console.log(`states: ${states.join(",")}`);
  console.log(`moving samples: ${moving.length}, median ground speed ${med.toFixed(2)} m/s`);
  console.log(`locomotion seen: ${clips.join("  ")}`);
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
