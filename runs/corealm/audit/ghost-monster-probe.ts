/**
 * Reproduces and verifies the fix for the reload ghost: kill a hen, refresh the page inside the
 * same browser context (so the autosave persists), and confirm the monster does NOT come back as
 * an alive-looking, unattackable ghost for the rest of its 30 s respawn timer.
 *
 * Post-fix, one of two honest states is acceptable after the reload:
 *   - still inside the respawn window -> the entity is a DEAD, dissolved corpse (state "dead"),
 *     and it must not be hover-pickable;
 *   - already respawned -> alive, and a click-attack must actually land damage within seconds.
 * The pre-fix ghost fails both: alive-looking, clickable, and never damageable.
 *
 *   npx tsx runs/corealm/audit/ghost-monster-probe.ts
 */
import { chromium } from "playwright";

const SERVER = "http://127.0.0.1:4200";

const browser = await chromium.launch({
  headless: false,
  args: ["--mute-audio", "--window-position=4000,4000", "--window-size=1280,800"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

async function ready(page: import("playwright").Page): Promise<void> {
  await page.goto(`${SERVER}/index.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(
    () => (window as never as { __gameDebug?: { getState(): { ready: boolean } } })
      .__gameDebug?.getState().ready === true,
    undefined, { timeout: 90_000 },
  );
}

async function hoverFor(page: import("playwright").Page, needle: string): Promise<{ x: number; y: number } | null> {
  for (let y = 220; y <= 640; y += 26) {
    for (let x = 300; x <= 1000; x += 26) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(14);
      const hovered = await page.evaluate(() => (window as never as {
        __gameDebug: { getState(): { hoveredEntityId?: string | null } };
      }).__gameDebug.getState().hoveredEntityId ?? null);
      if (hovered && hovered.includes(needle)) return { x, y };
    }
  }
  return null;
}

try {
  // ---- Session 1: kill a hen, let the close-save carry it.
  const page1 = await context.newPage();
  await ready(page1);
  const henId: string = await page1.evaluate(() => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: [number, number, number]): unknown;
        groundHeight(x: number, z: number): number;
        listEntities(filter?: { archetype?: string }): { id: string }[];
        getEntity(id: string): { position: number[] } | null;
        setSkillLevel(skill: string, level: number): number;
      };
    }).__gameDebug;
    debug.setSkillLevel("melee", 99);
    const id = debug.listEntities({ archetype: "enemy" })
      .map((e) => e.id).find((v) => v.includes("marchfield_hens"));
    if (!id) throw new Error("no hen");
    const hen = debug.getEntity(id)!;
    debug.teleport([hen.position[0]! + 2, debug.groundHeight(hen.position[0]! + 2, hen.position[2]!) + 0.2, hen.position[2]!]);
    return id;
  });
  await page1.waitForTimeout(1_500);
  const spot = await hoverFor(page1, henId);
  if (!spot) throw new Error("could not hover the hen");
  await page1.mouse.click(spot.x, spot.y);
  const killed = await page1.waitForFunction((id: string) => (window as never as {
    __gameDebug: { getEntity(e: string): { state?: string } | null };
  }).__gameDebug.getEntity(id)?.state === "dead", henId, { timeout: 20_000 }).catch(() => null);
  console.log(`session 1: ${henId} killed: ${killed !== null}`);
  await page1.close();   // pagehide persists the save, dead runtime included.

  // ---- Session 2: reload and check for the ghost.
  const page2 = await context.newPage();
  await ready(page2);
  const after: { state: string | null; health: number | null } = await page2.evaluate((id: string) => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: [number, number, number]): unknown;
        groundHeight(x: number, z: number): number;
        getEntity(e: string): { state?: string; position: number[]; combat?: { health?: number } } | null;
      };
    }).__gameDebug;
    const hen = debug.getEntity(id);
    if (hen) {
      debug.teleport([hen.position[0]! + 2, debug.groundHeight(hen.position[0]! + 2, hen.position[2]!) + 0.2, hen.position[2]!]);
    }
    return { state: hen?.state ?? null, health: hen?.combat?.health ?? null };
  }, henId);
  console.log(`session 2 after reload: state=${after.state} health=${after.health}`);

  if (after.state === "dead") {
    // Correct: a corpse dissolving from boot. A still-fading corpse is deliberately pickable for
    // its ~2.4 s dissolve, so the unpickability check waits it out.
    await page2.waitForTimeout(3_500);
    const pick = await hoverFor(page2, henId);
    console.log(`corpse pickable: ${pick ? "YES (BUG)" : "no (correct)"}`);
    const respawned = await page2.waitForFunction((id: string) => (window as never as {
      __gameDebug: { getEntity(e: string): { state?: string } | null };
    }).__gameDebug.getEntity(id)?.state === "alive", henId, { timeout: 45_000 }).catch(() => null);
    console.log(`respawned within 45 s: ${respawned !== null}`);
    if (respawned === null) throw new Error("hen never respawned");
  }

  // Whether it respawned just now or was already alive, a click must produce real damage.
  await page2.waitForTimeout(800);
  const spot2 = await hoverFor(page2, henId);
  if (!spot2) throw new Error("could not hover the hen after reload/respawn");
  await page2.mouse.click(spot2.x, spot2.y);
  for (let i = 0; i < 10; i += 1) {
    await page2.waitForTimeout(1_000);
    const snap = await page2.evaluate((id: string) => {
      const debug = (window as never as {
        __gameDebug: {
          getEntity(e: string): { state?: string; position: number[]; combat?: { health?: number } } | null;
          getPlayerPosition(): { x: number; y: number; z: number };
          getState(): { combatTargetId?: string | null; clock?: { elapsedMs?: number } };
          getPlayer(): { moving: boolean };
        };
      }).__gameDebug;
      const hen = debug.getEntity(id);
      const p = debug.getPlayerPosition();
      const st = debug.getState();
      return {
        state: hen?.state, health: hen?.combat?.health,
        gap: hen ? Math.hypot(hen.position[0]! - p.x, hen.position[2]! - p.z).toFixed(2) : "?",
        target: st.combatTargetId ?? null,
        clock: st.clock?.elapsedMs ?? null,
        moving: debug.getPlayer().moving,
      };
    }, henId);
    console.log(`  +${i + 1}s state=${snap.state} hp=${snap.health} gap=${snap.gap} target=${snap.target} moving=${snap.moving} clock=${snap.clock}`);
  }
  const damaged = await page2.waitForFunction((id: string) => {
    const hen = (window as never as {
      __gameDebug: { getEntity(e: string): { state?: string; combat?: { health?: number; maxHealth?: number } } | null };
    }).__gameDebug.getEntity(id);
    if (!hen) return false;
    return hen.state === "dead" || (hen.combat?.health ?? 99) < (hen.combat?.maxHealth ?? 99);
  }, henId, { timeout: 10_000 }).catch(() => null);
  console.log(`attack after reload lands damage: ${damaged !== null ? "yes (FIXED)" : "NO - GHOST STILL PRESENT"}`);
} finally {
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
