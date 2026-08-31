/**
 * Reproduces two reports against the live build: "monsters don't run towards you when attacking"
 * and "sometimes you can't attack a monster".
 *
 * For each preset: spawn at 12 m, provoke with a real attack, STAND STILL, and sample the fight
 * at 100 ms for 12 s — does the creature close to its standoff, in what motion, and do both sides
 * actually land damage? Then re-issue the attack repeatedly to catch an intermittent refusal.
 *
 *   npx tsx runs/corealm/audit/approach-probe.ts cattle coyote hens
 */
import { chromium } from "playwright";
import { startGameServer } from "../../../tools/lib/server.js";

const filters = process.argv.slice(2);
const wanted = filters.length > 0 ? filters : ["marchfield_hens", "redsill_cattle", "coyote", "boar", "reaver"];
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
  await page.evaluate(() => {
    for (const skill of ["melee", "magic"]) window.__featureLab!.setLevel(skill as never, 1 as never);
  });
  await page.evaluate(async () => { await window.__featureLab!.equipPlayer("mainHand", null); });

  const catalog: { id: string }[] = await page.evaluate(
    () => window.__featureLab!.getCatalog().targets.creature.map((p: { id: string }) => ({ id: p.id })),
  );
  const chosen = catalog.filter((p) => wanted.some((w) => p.id.includes(w)));

  for (const preset of chosen) {
    const out = await page.evaluate(async (id: string) => {
      const lab = window.__featureLab!;
      const debug = (window as never as {
        __gameDebug: {
          getEntityMotion(id: string): { semanticPosition: number[]; motion: string | null } | null;
          getPlayerPosition(): { x: number; y: number; z: number };
          getEntity(entityId: string): { combat?: { bodyRadius?: number } } | null;
        };
      }).__gameDebug;

      const errors: string[] = [];
      const spawned = await lab.spawnTarget("creature", id, { distance: 12 });
      const entityId = spawned.target!.entityId;
      const radius = debug.getEntity(entityId)?.combat?.bodyRadius ?? 0;
      try {
        await lab.perform("attack");
      } catch (cause) {
        errors.push(`initial attack: ${cause instanceof Error ? cause.message : String(cause)}`);
      }

      const samples: { atMs: number; gap: number; motion: string | null; ai: string | null; th: number | null; ph: number }[] = [];
      const started = performance.now();
      for (let i = 0; i < 120; i += 1) {
        const creature = debug.getEntityMotion(entityId);
        const player = debug.getPlayerPosition();
        const state = lab.getState();
        if (creature) {
          samples.push({
            atMs: performance.now() - started,
            gap: Math.hypot(creature.semanticPosition[0]! - player.x, creature.semanticPosition[2]! - player.z),
            motion: creature.motion,
            ai: state.target?.ai?.state ?? null,
            th: state.target?.health ?? null,
            ph: state.player?.health ?? 0,
          });
        }
        await new Promise((r) => { setTimeout(r, 100); });
      }

      // The intermittent refusal: re-issue the attack several times against the live creature.
      const reattacks: string[] = [];
      for (let round = 0; round < 4; round += 1) {
        try {
          await lab.perform("attack");
          reattacks.push("ok");
        } catch (cause) {
          reattacks.push(cause instanceof Error ? cause.message : String(cause));
        }
        await new Promise((r) => { setTimeout(r, 700); });
      }
      return { entityId, radius, samples, errors, reattacks };
    }, preset.id);

    const first = out.samples[0];
    const gaps = out.samples.map((s) => s.gap);
    const minGap = Math.min(...gaps);
    const lastGap = gaps.at(-1) ?? 0;
    const motions = [...new Set(out.samples.map((s) => s.motion))];
    const states = [...new Set(out.samples.map((s) => s.ai))];
    const firstHealth = out.samples.find((s) => s.th !== null)?.th ?? null;
    const lastHealth = [...out.samples].reverse().find((s) => s.th !== null)?.th ?? null;
    const playerStart = first?.ph ?? 0;
    const playerEnd = out.samples.at(-1)?.ph ?? 0;
    const closed = out.samples.find((s) => s.gap < out.radius + 1.5);

    console.log(`\n${preset.id}  radius ${out.radius.toFixed(2)}`);
    console.log(`  gap: start ${first?.gap.toFixed(2)} -> min ${minGap.toFixed(2)} -> end ${lastGap.toFixed(2)}  closed in ${closed ? `${(closed.atMs / 1000).toFixed(1)} s` : "NEVER"}`);
    console.log(`  motions: ${motions.join(", ")}  ai: ${states.join(", ")}`);
    console.log(`  target health ${firstHealth} -> ${lastHealth}  player health ${playerStart} -> ${playerEnd}`);
    console.log(`  attack errors: ${out.errors.length ? out.errors.join("; ") : "none"}  re-attacks: ${out.reattacks.join(", ")}`);
    await page.evaluate(async () => { await window.__featureLab!.perform("reset-player"); });
  }
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  await server.close().catch(() => undefined);
}
