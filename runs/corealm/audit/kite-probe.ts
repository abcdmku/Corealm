/**
 * The moving-player half of the approach reports: provoke a creature, then WALK AWAY on real key
 * input mid-fight. A healthy chase keeps the gap near the standoff; "monsters don't run towards
 * you" would show as the gap growing while the creature stands. Also screenshots the creature
 * mid-attack at its standoff, to judge whether the new body-aware spacing reads as an attack.
 *
 *   npx tsx runs/corealm/audit/kite-probe.ts
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const SERVER = "http://127.0.0.1:4200";
const OUT = "test-results/kite-probe";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ["--mute-audio", "--window-position=4000,4000", "--window-size=1280,800"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function gapAndState(id: string): Promise<{ gap: number; state: string | null; motion: string | null }> {
  return page.evaluate((entityId: string) => {
    const debug = (window as never as {
      __gameDebug: {
        getEntity(id: string): { state?: string } | null;
        getEntityMotion(id: string): { semanticPosition: number[]; motion: string | null } | null;
        getPlayerPosition(): { x: number; y: number; z: number };
      };
    }).__gameDebug;
    const c = debug.getEntityMotion(entityId)?.semanticPosition;
    const p = debug.getPlayerPosition();
    return {
      gap: c ? Math.hypot(c[0]! - p.x, c[2]! - p.z) : NaN,
      state: debug.getEntity(entityId)?.state ?? null,
      motion: debug.getEntityMotion(entityId)?.motion ?? null,
    };
  }, id);
}

try {
  await page.goto(`${SERVER}/index.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(
    () => (window as never as { __gameDebug?: { getState(): { ready: boolean } } })
      .__gameDebug?.getState().ready === true,
    undefined, { timeout: 60_000 },
  );

  // Stand inside the coyote pack's aggro so it engages by itself; no click needed.
  const coyoteId: string = await page.evaluate(async () => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: [number, number, number]): unknown;
        groundHeight(x: number, z: number): number;
        listEntities(filter?: { archetype?: string }): { id: string }[];
        getEntity(id: string): { position: number[] } | null;
        setHealth(health: number): void;
      };
    }).__gameDebug;
    const id = debug.listEntities({ archetype: "enemy" })
      .map((e) => e.id).find((v) => v.includes("coyote"));
    if (!id) throw new Error("no coyote");
    const c = debug.getEntity(id)!;
    debug.teleport([c.position[0]! + 6, debug.groundHeight(c.position[0]! + 6, c.position[2]!) + 0.2, c.position[2]!]);
    debug.setHealth(9999);
    return id;
  });

  // Wait for the engage.
  let engaged = false;
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(100);
    if ((await gapAndState(coyoteId)).state === "aggro") { engaged = true; break; }
  }
  console.log(`engaged: ${engaged}`);
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: `${OUT}/standoff-attack.png` });
  const atStandoff = await gapAndState(coyoteId);
  console.log(`at standoff: gap ${atStandoff.gap.toFixed(2)} motion ${atStandoff.motion}`);

  // Kite phase: hold S (walk backwards) for 6 s, sampling. A chasing coyote (2.1 m/s) cannot
  // outrun the player (4.2), so the gap SHOULD grow — but its state must stay aggro and its
  // motion must be a run while it loses ground. Then stop and see it re-close.
  await page.keyboard.down("s");
  const kite: { gap: number; state: string | null; motion: string | null }[] = [];
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(100);
    kite.push(await gapAndState(coyoteId));
  }
  await page.keyboard.up("s");
  const kiteStates = [...new Set(kite.map((k) => k.state))];
  const kiteMotions = [...new Set(kite.map((k) => k.motion))];
  console.log(`kite: gap ${kite[0]?.gap.toFixed(2)} -> ${kite.at(-1)?.gap.toFixed(2)}; states ${kiteStates.join(",")}; motions ${kiteMotions.join(",")}`);

  // Stop phase: the coyote should re-close to its standoff.
  const reclose: number[] = [];
  const recloseMotions = new Set<string>();
  for (let i = 0; i < 80; i += 1) {
    await page.waitForTimeout(100);
    const s = await gapAndState(coyoteId);
    reclose.push(s.gap);
    if (s.motion) recloseMotions.add(s.motion);
  }
  await page.screenshot({ path: `${OUT}/reclosed.png` });
  console.log(`reclose: gap ${reclose[0]?.toFixed(2)} -> min ${Math.min(...reclose).toFixed(2)} -> ${reclose.at(-1)?.toFixed(2)}; motions ${[...recloseMotions].join(",")}`);

  // Cross-behind phase: run THROUGH the creature repeatedly (W then S alternating) — forced
  // pivots. Does it keep chasing between pivots or freeze?
  const cross: { gap: number; motion: string | null }[] = [];
  for (let burst = 0; burst < 4; burst += 1) {
    await page.keyboard.down("w");
    await page.waitForTimeout(900);
    await page.keyboard.up("w");
    await page.keyboard.down("s");
    await page.waitForTimeout(900);
    await page.keyboard.up("s");
    const s = await gapAndState(coyoteId);
    cross.push({ gap: s.gap, motion: s.motion });
  }
  console.log(`cross-behind: ${cross.map((c) => `${c.gap.toFixed(2)}/${c.motion}`).join("  ")}`);
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
