/**
 * Real-world, real-input reproduction of "monsters don't run towards you when attacking" and
 * "sometimes you can't attack a monster": drives the fight the way a player does — hover the
 * creature with the mouse, click it, watch. The feature lab mis-anchors a spawned target's leash
 * ~200 m away, so lab fights longer than a few seconds are poisoned; this runs in the open world
 * against creatures standing on their genuine spawns.
 *
 * Scenario A: stand inside an aggressive pack's aggro radius. Do they run in and swing?
 * Scenario B: click-attack a Redsill cow five times over, logging the hover pick, whether combat
 * latched (combatTargetId), the gap over time, both healths, and any flip to "returning".
 *
 *   npx tsx runs/corealm/audit/world-approach-probe.ts
 */
import { chromium } from "playwright";

const SERVER = "http://127.0.0.1:4200";

const browser = await chromium.launch({
  headless: false,
  args: ["--mute-audio", "--window-position=4000,4000", "--window-size=1280,800"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

interface Snapshot {
  gap: number;
  state: string | null;
  health: number | null;
  playerHealth: number;
  combatTargetId: string | null;
}

async function snap(id: string): Promise<Snapshot> {
  return page.evaluate((entityId: string) => {
    const debug = (window as never as {
      __gameDebug: {
        getEntity(id: string): { state?: string; combat?: { health?: number } } | null;
        getEntityMotion(id: string): { semanticPosition: number[] } | null;
        getPlayerPosition(): { x: number; y: number; z: number };
        getPlayer(): { health: number };
        getState(): { combatTargetId?: string | null };
      };
    }).__gameDebug;
    const c = debug.getEntityMotion(entityId)?.semanticPosition;
    const p = debug.getPlayerPosition();
    return {
      gap: c ? Math.hypot(c[0]! - p.x, c[2]! - p.z) : NaN,
      state: debug.getEntity(entityId)?.state ?? null,
      health: debug.getEntity(entityId)?.combat?.health ?? null,
      playerHealth: debug.getPlayer().health,
      combatTargetId: (debug.getState().combatTargetId as string | null) ?? null,
    };
  }, id);
}

/** Sweeps the mouse over the viewport until the wanted entity reports as hovered. */
async function hover(idPrefix: string): Promise<{ x: number; y: number } | null> {
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 200; y <= 640; y += 36) {
      for (let x = 240; x <= 1040; x += 36) {
        await page.mouse.move(x, y);
        await page.waitForTimeout(16);
        const hovered = await page.evaluate(() => (window as never as {
          __gameDebug: { getState(): { hoveredEntityId?: string | null } };
        }).__gameDebug.getState().hoveredEntityId ?? null);
        if (hovered && hovered.includes(idPrefix)) return { x, y };
      }
    }
  }
  return null;
}

try {
  await page.goto(`${SERVER}/index.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(
    () => (window as never as { __gameDebug?: { getState(): { ready: boolean } } })
      .__gameDebug?.getState().ready === true,
    undefined, { timeout: 60_000 },
  );

  // ---- Scenario A: aggressive pack initiation, no input at all.
  const coyoteId: string | null = await page.evaluate(async () => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: [number, number, number]): unknown;
        groundHeight(x: number, z: number): number;
        listEntities(filter?: { archetype?: string }): { id: string }[];
        getEntity(id: string): { position: number[] } | null;
      };
    }).__gameDebug;
    const id = debug.listEntities({ archetype: "enemy" })
      .map((e) => e.id).find((v) => v.includes("coyote")) ?? null;
    if (!id) return null;
    const coyote = debug.getEntity(id)!;
    const [cx, , cz] = coyote.position;
    debug.teleport([cx! + 7, debug.groundHeight(cx! + 7, cz!) + 0.2, cz!]);
    return id;
  });
  if (coyoteId) {
    let engagedAt: number | null = null;
    let minGap = Number.POSITIVE_INFINITY;
    const states = new Set<string>();
    const started = Date.now();
    let playerHit = false;
    const health0 = (await snap(coyoteId)).playerHealth;
    for (let i = 0; i < 120; i += 1) {
      await page.waitForTimeout(100);
      const s = await snap(coyoteId);
      minGap = Math.min(minGap, s.gap);
      if (s.state) states.add(s.state);
      if (engagedAt === null && s.state === "aggro") engagedAt = Date.now() - started;
      if (s.playerHealth < health0) playerHit = true;
    }
    console.log(`A: ${coyoteId} aggro after ${engagedAt === null ? "NEVER" : `${(engagedAt / 1000).toFixed(1)} s`}; min gap ${minGap.toFixed(2)}; states ${[...states].join(",")}; player took damage: ${playerHit}`);
  } else {
    console.log("A: no coyote found");
  }

  // ---- Scenario B: click-attack a cow, five rounds.
  await page.evaluate(() => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: [number, number, number]): unknown;
        groundHeight(x: number, z: number): number;
      };
    }).__gameDebug;
    debug.teleport([-64, debug.groundHeight(-64, -88) + 0.2, -88]);
  });
  await page.waitForTimeout(1_500);

  for (let round = 0; round < 5; round += 1) {
    // Context first, so a pick failure is explainable: where is the player, are they alive, and
    // where are the cows?
    const context = await page.evaluate(() => {
      const debug = (window as never as {
        __gameDebug: {
          listEntities(filter?: { archetype?: string }): { id: string }[];
          getEntity(id: string): { state?: string; position: number[]; combat?: { health?: number } } | null;
          getPlayerPosition(): { x: number; y: number; z: number };
          getPlayer(): { health: number; dead?: boolean };
        };
      }).__gameDebug;
      const p = debug.getPlayerPosition();
      const cows = debug.listEntities({ archetype: "enemy" })
        .map((e) => e.id).filter((id) => id.includes("redsill_cattle"))
        .map((id) => {
          const e = debug.getEntity(id)!;
          return `${id}:${e.state}:${e.combat?.health}@${Math.hypot(e.position[0]! - p.x, e.position[2]! - p.z).toFixed(1)}m`;
        });
      return { player: `${p.x.toFixed(1)},${p.z.toFixed(1)} hp ${debug.getPlayer().health}`, cows: cows.join(" ") };
    });
    console.log(`B${round + 1}: player ${context.player}; cows ${context.cows}`);
    const spot = await hover("redsill_cattle");
    if (!spot) {
      await page.screenshot({ path: `test-results/kite-probe/pick-failed-${round + 1}.png` });
      console.log(`B${round + 1}: could not hover any cow — PICK FAILED (screenshot saved)`);
      continue;
    }
    const cowId: string = await page.evaluate(() => (window as never as {
      __gameDebug: { getState(): { hoveredEntityId?: string | null } };
    }).__gameDebug.getState().hoveredEntityId as string);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(400);
    const after = await snap(cowId);
    const latched = after.combatTargetId === cowId;
    // Watch the fight for six seconds: does the cow close, does anyone land a hit, does it flee?
    const gaps: number[] = [];
    const states = new Set<string>();
    let cowHealthStart = after.health;
    for (let i = 0; i < 60; i += 1) {
      await page.waitForTimeout(100);
      const s = await snap(cowId);
      gaps.push(s.gap);
      if (s.state) states.add(s.state);
    }
    const end = await snap(cowId);
    console.log(
      `B${round + 1}: click ${cowId} latched=${latched} gap ${gaps[0]?.toFixed(2)} -> ${gaps.at(-1)?.toFixed(2)}`
      + ` (min ${Math.min(...gaps).toFixed(2)}) states ${[...states].join(",")}`
      + ` cowHealth ${cowHealthStart} -> ${end.health} target-at-end ${end.combatTargetId}`,
    );
  }
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
