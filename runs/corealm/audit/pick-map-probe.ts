/**
 * Maps where a cow can actually be hovered/clicked, against where it visibly is.
 *
 * Suspicion: the forgiving pick capsule is clamped to 1.35 m radius around the entity CENTRE,
 * and a cow is 2.53 m nose to tail — so its head and rump may not be clickable at all. A click
 * there falls through to the ground and walks the player away mid-fight, which is both reports:
 * "sometimes you can't attack a monster" and the monster left chasing a player who is marching
 * off. This renders the herd, fine-sweeps the mouse, and prints an ASCII hit map to compare with
 * the screenshot it saves.
 *
 *   npx tsx runs/corealm/audit/pick-map-probe.ts
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const SERVER = "http://127.0.0.1:4200";
const OUT = "test-results/pick-map";
mkdirSync(OUT, { recursive: true });

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

  const cowId: string = await page.evaluate(() => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: [number, number, number]): unknown;
        groundHeight(x: number, z: number): number;
        listEntities(filter?: { archetype?: string }): { id: string }[];
        getEntity(id: string): { position: number[] } | null;
        focusEntity(id: string): boolean;
      };
    }).__gameDebug;
    const id = debug.listEntities({ archetype: "enemy" })
      .map((e) => e.id).find((v) => v.includes("redsill_cattle"));
    if (!id) throw new Error("no cow");
    const cow = debug.getEntity(id)!;
    const [x, , z] = cow.position;
    debug.teleport([x!, debug.groundHeight(x!, z! + 6) + 0.2, z! + 6]);
    // The documentation camera frames the subject properly, which a fixed teleport cannot.
    debug.focusEntity(id);
    return id;
  });
  await page.waitForTimeout(2_000);
  // Freeze the sim so the cow cannot wander mid-sweep: the sweep takes ~40 s and a strolling cow
  // smears the hit map across everywhere it stood.
  await page.evaluate(() => (window as never as {
    __gameDebug: { setPaused(paused: boolean): void };
  }).__gameDebug.setPaused(true));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/scene.png` });

  // Fine hover sweep over the middle of the frame; 14 px steps.
  const rows: string[] = [];
  for (let y = 150; y <= 690; y += 18) {
    let row = "";
    for (let x = 300; x <= 980; x += 17) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(10);
      const hovered = await page.evaluate(() => (window as never as {
        __gameDebug: { getState(): { hoveredEntityId?: string | null } };
      }).__gameDebug.getState().hoveredEntityId ?? null);
      row += hovered === cowId ? "#" : hovered ? "o" : ".";
    }
    rows.push(row);
  }
  console.log(`cow: ${cowId}   ('#' = cow hovered, 'o' = other entity, '.' = nothing)`);
  for (const row of rows) console.log(row);
  await page.evaluate(() => (window as never as {
    __gameDebug: { setPaused(paused: boolean): void };
  }).__gameDebug.setPaused(false));
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
