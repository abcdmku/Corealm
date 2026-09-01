/**
 * Rare miniboss weapon lab sweep: equips all eight rare weapons on the production player rig in
 * the combat feature lab and screenshots each at grip-inspection distance.
 *
 * This is the amendment's lab proof for grip sockets, clipping, scale and tint readability. The
 * shots land in test-results/rare-weapons/ (gitignored, disposable) for the root to inspect; the
 * script itself asserts only what state can prove — the equip landed, the rig stayed live, and no
 * console or page error fired.
 *
 * BODY TYPES. Production ships one player body (`app/boot.ts: bodyAssetId "base_male"`); the
 * female rig is the same Universal Base Characters skeleton with identical hand-bone names, and
 * `equipmentVisuals.ts` sockets are authored in hand-bone space, so the socket transform cannot
 * differ per body. The sweep therefore proves the live rig and leans on that shared-skeleton
 * contract for the other body, the same position `characterRig.ts` takes for NPC outfits.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { startGameServer, type RunningGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "test-results", "rare-weapons");

const RARE_WEAPONS = [
  // Two production references first, so every rare shot has a known-good neighbour to compare
  // grip, rest pose and scale against.
  "kaldite_sword", "cairnpine_staff",
  "galeskin_sword", "galeskin_staff",
  "mossbound_sword", "mossbound_staff",
  "tideworn_sword", "tideworn_staff",
  "cinderwake_sword", "cinderwake_staff",
] as const;

const clearDeadline = installTestDeadline("rare weapon lab sweep", 240_000);
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
let server: RunningGameServer | null = null;

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const lab = (window as never as { __featureLab?: { getState(): { ready: boolean } } }).__featureLab;
    return lab?.getState().ready === true;
  }, undefined, { timeout: 40_000 });
}

try {
  await mkdir(outDir, { recursive: true });
  server = await startGameServer({ logLevel: "error" });
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));

  await page.goto(`${server.url}/index.html?mode=combat`, { waitUntil: "domcontentloaded" });
  await waitReady(page);

  // Wheel in from the 12 m default toward the 4 m floor so the grip is legible in the frame,
  // and VERIFY the zoom landed rather than trusting the wheel events: the first run shipped ten
  // wide shots because the deltas never reached the camera.
  await page.mouse.move(400, 420);
  for (let step = 0; step < 30; step += 1) {
    const distance = await page.evaluate(() => {
      const debug = (window as never as {
        __gameDebug?: { getCamera?: () => { distance?: number } };
      }).__gameDebug;
      return debug?.getCamera?.().distance ?? null;
    });
    if (distance !== null && distance <= 5.2) break;
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
  const finalDistance = await page.evaluate(() => (
    (window as never as { __gameDebug: { getCamera(): { distance?: number } } })
      .__gameDebug.getCamera().distance ?? null
  ));

  const results: Record<string, boolean> = {};
  for (const itemId of RARE_WEAPONS) {
    const equipped = await page.evaluate(async (id) => {
      const lab = (window as never as {
        __featureLab: { equipPlayer(slot: string, itemId: string): Promise<unknown> };
      }).__featureLab;
      try {
        await lab.equipPlayer("mainHand", id);
        return true;
      } catch {
        return false;
      }
    }, itemId);
    // The rig warms the weapon GLB on first request, so the swap can lag the state change by a
    // load; the shot must show THIS item, not the previous one still in hand.
    await page.waitForTimeout(1_800);
    const inHand = await page.evaluate(() => {
      const lab = (window as never as {
        __featureLab: { getState(): { equipment: { mainHand: string | null } } };
      }).__featureLab;
      return lab.getState().equipment.mainHand;
    });
    results[itemId] = equipped && inHand === itemId;
    await page.screenshot({ path: path.join(outDir, `${itemId}.png`) });
  }

  const failed = Object.entries(results).filter(([, ok]) => !ok).map(([id]) => id);
  const passed = failed.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0;
  console.log(JSON.stringify({
    passed,
    cameraDistance: finalDistance,
    results,
    errors: { console: consoleErrors, page: pageErrors },
    screenshots: RARE_WEAPONS.map((id) => path.join("test-results", "rare-weapons", `${id}.png`)),
  }, null, 2));
  await browser.close();
  process.exitCode = passed ? 0 : 1;
} catch (cause) {
  console.error(JSON.stringify({
    passed: false,
    error: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
    errors: { console: consoleErrors, page: pageErrors },
  }, null, 2));
  process.exitCode = 1;
} finally {
  clearDeadline();
  await server?.close();
}
