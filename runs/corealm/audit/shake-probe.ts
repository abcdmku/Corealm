/**
 * Frame-rate sampling of one creature's drawn motion, to localise "rapid shaking".
 *
 * The walk and turn probes sample every 30-90 ms, which averages away anything oscillating at
 * frame rate — exactly the band a shake lives in. This one records EVERY rendered frame via
 * requestAnimationFrame: drawn position, drawn yaw, semantic position, clip name and clip time.
 *
 * The analysis separates the three possible culprits:
 *   - drawn root position reversing along its own path direction  -> movement/interp bug
 *   - drawn yaw reversing sign frame to frame                     -> facing bug
 *   - clip time going backwards or stalling while "moving"        -> animation playback bug
 *
 *   npx tsx runs/corealm/audit/shake-probe.ts goat
 */
import { chromium } from "playwright";
import { startGameServer } from "../../../tools/lib/server.js";

const filter = process.argv[2] ?? "goat";
const server = await startGameServer({ logLevel: "error" });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });

interface Frame {
  atMs: number;
  drawn: number[];
  sem: number[];
  yaw: number;
  clip: string | null;
  clipTime: number | null;
  motion: string | null;
}

try {
  const base = server.url.endsWith("/") ? server.url : `${server.url}/`;
  await page.goto(new URL("/index.html?mode=combat", base).href, {
    waitUntil: "domcontentloaded", timeout: 30_000,
  });
  await page.waitForFunction(
    () => window.__featureLab?.getState().ready === true, undefined, { timeout: 30_000 },
  );

  const frames: Frame[] = await page.evaluate(async (needle: string) => {
    const lab = window.__featureLab!;
    const debug = (window as never as {
      __gameDebug: {
        getEntityMotion(id: string): {
          drawnPosition: number[]; semanticPosition: number[]; drawnRotationY: number;
          clip: string | null; time: number | null; motion: string | null;
        } | null;
      };
    }).__gameDebug;

    for (const skill of ["melee", "magic"]) lab.setLevel(skill as never, 1 as never);
    await lab.equipPlayer("mainHand", null);
    const catalog = lab.getCatalog();
    const preset = catalog.targets.creature.find((p: { id: string }) => p.id.includes(needle));
    if (!preset) throw new Error(`no creature preset matches ${needle}`);
    const spawned = await lab.spawnTarget("creature", preset.id, { distance: 6 });
    const entityId = spawned.target!.entityId;
    await lab.perform("attack");
    const until = performance.now() + 6_000;
    while (performance.now() < until) {
      if (lab.getState().target?.ai?.state === "aggro") break;
      await new Promise((r) => { setTimeout(r, 50); });
    }
    await lab.perform("flee");

    const out: {
      atMs: number; drawn: number[]; sem: number[]; yaw: number;
      clip: string | null; clipTime: number | null; motion: string | null;
    }[] = [];
    // One await per rendered frame, no named inner function: tsx's keepNames wraps one in
    // `__name`, which does not exist inside the page.
    for (let i = 0; i < 400; i += 1) {
      await new Promise((r) => { requestAnimationFrame(r as FrameRequestCallback); });
      const motion = debug.getEntityMotion(entityId);
      if (!motion) continue;
      out.push({
        atMs: performance.now(),
        drawn: motion.drawnPosition.slice(),
        sem: motion.semanticPosition.slice(),
        yaw: motion.drawnRotationY,
        clip: motion.clip,
        clipTime: motion.time,
        motion: motion.motion,
      });
    }
    return out;
  }, filter);

  // ---------------------------------------------------------------- analysis
  let reversals = 0;
  let reversalMetres = 0;
  let worstBack = 0;
  let yawFlips = 0;
  let clipBackwards = 0;
  let moving = 0;
  const speeds: number[] = [];
  for (let i = 2; i < frames.length; i += 1) {
    const a = frames[i - 2]!;
    const b = frames[i - 1]!;
    const c = frames[i]!;
    const v1x = b.drawn[0]! - a.drawn[0]!;
    const v1z = b.drawn[2]! - a.drawn[2]!;
    const v2x = c.drawn[0]! - b.drawn[0]!;
    const v2z = c.drawn[2]! - b.drawn[2]!;
    const m1 = Math.hypot(v1x, v1z);
    const m2 = Math.hypot(v2x, v2z);
    const dt = (c.atMs - b.atMs) / 1000;
    if (dt > 0) speeds.push(m2 / dt);
    if (m1 > 1e-4 && m2 > 1e-4) {
      moving += 1;
      const dot = (v1x * v2x + v1z * v2z) / (m1 * m2);
      if (dot < -0.2) {
        reversals += 1;
        reversalMetres += m2;
        worstBack = Math.max(worstBack, m2);
      }
    }
    const d1 = wrap(b.yaw - a.yaw);
    const d2 = wrap(c.yaw - b.yaw);
    if (Math.abs(d1) > 0.003 && Math.abs(d2) > 0.003 && Math.sign(d1) !== Math.sign(d2)) {
      yawFlips += 1;
    }
    if (b.clip !== null && b.clip === c.clip
      && b.clipTime !== null && c.clipTime !== null
      && c.clipTime < b.clipTime - 0.001 && b.clipTime - c.clipTime < 0.5) {
      clipBackwards += 1;
    }
  }

  const clips = [...new Set(frames.map((f) => `${f.motion}:${f.clip}`))];
  const dts = frames.slice(1).map((f, i) => f.atMs - frames[i]!.atMs);
  dts.sort((x, y) => x - y);
  console.log(`creature filter: ${filter}`);
  console.log(`frames: ${frames.length}  median frame ${dts[Math.floor(dts.length / 2)]?.toFixed(1)} ms  clips seen: ${clips.join(", ")}`);
  console.log(`moving frame pairs: ${moving}`);
  console.log(`PATH REVERSALS (drawn root backtracks >0.2 dot): ${reversals}  total ${reversalMetres.toFixed(3)} m  worst single ${worstBack.toFixed(3)} m`);
  console.log(`YAW SIGN FLIPS frame-to-frame: ${yawFlips}`);
  console.log(`CLIP TIME BACKWARDS (same clip, not a loop wrap): ${clipBackwards}`);
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  await server.close().catch(() => undefined);
}

function wrap(delta: number): number {
  let value = delta;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}
