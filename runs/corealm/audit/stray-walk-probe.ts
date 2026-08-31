/**
 * Catches whoever moves the player 30 m mid-fight: click-attack one cow, then log every
 * navigation event, the player's movement mode and position, and the combat target for 12 s.
 *
 *   npx tsx runs/corealm/audit/stray-walk-probe.ts
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
    undefined, { timeout: 60_000 },
  );

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

  // Hover-hunt the nearest cow, then click it.
  let spot: { x: number; y: number } | null = null;
  outer: for (let y = 220; y <= 640; y += 30) {
    for (let x = 260; x <= 1020; x += 30) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(16);
      const hovered = await page.evaluate(() => (window as never as {
        __gameDebug: { getState(): { hoveredEntityId?: string | null } };
      }).__gameDebug.getState().hoveredEntityId ?? null);
      if (hovered && hovered.includes("redsill_cattle")) { spot = { x, y }; break outer; }
    }
  }
  if (!spot) throw new Error("no cow hovered");

  // Drain the event queue to now, then click.
  const seq0: number = await page.evaluate(() => (window as never as {
    __gameDebug: { getEvents(sinceSeq?: number): { nextSeq: number } };
  }).__gameDebug.getEvents(0).nextSeq);
  await page.mouse.click(spot.x, spot.y);

  let since = seq0;
  for (let i = 0; i < 24; i += 1) {
    await page.waitForTimeout(500);
    const row = await page.evaluate((sinceSeq: number) => {
      const debug = (window as never as {
        __gameDebug: {
          getEvents(sinceSeq?: number): { events: { type: string; payload?: unknown; entityId?: string }[]; nextSeq: number };
          getPlayerPosition(): { x: number; y: number; z: number };
          getPlayer(): { moving: boolean };
          getNavigationState(): Record<string, unknown>;
          getState(): { combatTargetId?: string | null };
        };
      }).__gameDebug;
      const events = debug.getEvents(sinceSeq);
      const p = debug.getPlayerPosition();
      const nav = debug.getNavigationState();
      return {
        nextSeq: events.nextSeq,
        events: events.events
          .filter((e) => e.type.startsWith("navigation") || e.type.startsWith("combat"))
          .map((e) => `${e.type} ${JSON.stringify(e.payload ?? {}).slice(0, 220)}`),
        pos: `${p.x.toFixed(1)},${p.z.toFixed(1)}`,
        moving: debug.getPlayer().moving,
        nav: JSON.stringify(nav).slice(0, 200),
        target: debug.getState().combatTargetId ?? null,
      };
    }, since);
    since = row.nextSeq;
    console.log(`t=${(i + 1) * 0.5}s pos ${row.pos} moving=${row.moving} target=${row.target}`);
    for (const line of row.events) console.log(`   ${line}`);
    if (i === 0) console.log(`   nav: ${row.nav}`);
    await page.evaluate(() => undefined);
  }
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
