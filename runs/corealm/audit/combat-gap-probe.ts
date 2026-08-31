/**
 * Measures how close a fight actually happens: the centre-to-centre gap between the player and a
 * provoked creature once both settle into swinging, and the surface gap after subtracting the
 * creature's half-length.
 *
 * Written for the report "they get too close to each other to fight": with centre-to-centre
 * constants, a Redsill cow (bodyRadius 1.27 m) stood off at 1.35 m, its muzzle 0.08 m from the
 * player's CENTRE. After the body-aware ranges the cow should stop near 2.27 m with ~0.5 m of
 * daylight between the bodies, and both sides should still land swings from there.
 *
 *   npx tsx runs/corealm/audit/combat-gap-probe.ts redsill_cattle marchfield_hens
 */
import { chromium } from "playwright";
import { startGameServer } from "../../../tools/lib/server.js";

const presets = process.argv.slice(2);
const targets = presets.length > 0 ? presets : ["redsill_cattle", "marchfield_hens", "terrace_aurochs"];
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

  console.log(`${"creature".padEnd(22)} ${"radius".padStart(7)} ${"gap med".padStart(8)} ${"gap min".padStart(8)} ${"surface".padStart(8)}  ${"hits".padStart(4)}  verdict`);
  for (const presetId of targets) {
    const row = await page.evaluate(async (id: string) => {
      const lab = window.__featureLab!;
      const debug = (window as never as {
        __gameDebug: {
          getEntityMotion(id: string): { semanticPosition: number[] } | null;
          getPlayerPosition(): { x: number; y: number; z: number };
          getEntity(entityId: string): { combat?: { bodyRadius?: number } } | null;
        };
      }).__gameDebug;

      const spawned = await lab.spawnTarget("creature", id, { distance: 8 });
      const entityId = spawned.target!.entityId;
      const radius = debug.getEntity(entityId)?.combat?.bodyRadius ?? 0;
      await lab.perform("attack");
      const until = performance.now() + 8_000;
      while (performance.now() < until) {
        if (lab.getState().target?.ai?.state === "aggro") break;
        await new Promise((r) => { setTimeout(r, 50); });
      }
      // Let both sides finish closing, then sample the settled fight for four seconds.
      await new Promise((r) => { setTimeout(r, 2_500); });
      const gaps: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        const creature = debug.getEntityMotion(entityId)?.semanticPosition;
        const player = debug.getPlayerPosition();
        if (creature) {
          gaps.push(Math.hypot(creature[0]! - player.x, creature[2]! - player.z));
        }
        await new Promise((r) => { setTimeout(r, 100); });
      }
      const state = lab.getState();
      return {
        gaps,
        radius,
        playerHealth: state.player?.health ?? null,
        targetHealth: state.target?.health ?? null,
        maxHealth: state.target?.maxHealth ?? null,
      };
    }, presetId);

    const sorted = [...row.gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const min = sorted[0] ?? 0;
    const surface = median - row.radius;
    const damaged = row.targetHealth !== null && row.maxHealth !== null && row.targetHealth < row.maxHealth;
    const verdict = surface < 0.2 ? "TOO CLOSE" : damaged ? "ok, trading blows" : "ok (no hit seen)";
    console.log(
      `${presetId.padEnd(22)} ${row.radius.toFixed(2).padStart(7)} ${median.toFixed(2).padStart(8)}`
      + ` ${min.toFixed(2).padStart(8)} ${surface.toFixed(2).padStart(8)}  ${(damaged ? "yes" : "?").padStart(4)}  ${verdict}`,
    );
    await page.evaluate(async () => { await window.__featureLab!.perform("reset-player"); });
  }
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  await server.close().catch(() => undefined);
}
