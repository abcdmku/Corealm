/**
 * Frame-rate herd observation in the real world, on the real GPU, to localise "rapid shaking".
 *
 * The lab shake probe cleared root motion and yaw at SwiftShader frame rates, which leaves the
 * skeletal animation and anything frame-rate-dependent. This one runs HEADED against the dev
 * server already on 4200, teleports beside the Redsill cattle, and records every rendered frame
 * for every cow in the herd:
 *
 *   - clip time advance per frame: a mixer that skips frames shows dClipTime = 0 streaks; a
 *     playback bug shows negative steps that are not loop wraps (wrap = backward step near the
 *     clip's whole duration).
 *   - drawn root: forward advance vs lateral residual against a smoothed heading, so a shake
 *     shows up as high-frequency lateral energy even when the path is broadly forward.
 *
 *   npx tsx runs/corealm/audit/herd-shake-probe.ts
 */
import { chromium } from "playwright";

const SERVER = "http://127.0.0.1:4200";
const FRAMES = 2_000;

interface FrameRow {
  atMs: number;
  id: string;
  drawn: number[];
  yaw: number;
  motion: string | null;
  clip: string | null;
  clipTime: number | null;
  duration: number | null;
  timeScale: number | null;
  path: string | null;
}

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

  const rows: FrameRow[] = await page.evaluate(async (frameBudget: number) => {
    const debug = (window as never as {
      __gameDebug: {
        teleport(to: [number, number, number]): unknown;
        groundHeight(x: number, z: number): number;
        listEntities(filter?: { archetype?: string }): { id: string }[];
        getEntityMotion(id: string): {
          drawnPosition: number[]; drawnRotationY: number; motion: string | null;
          clip: string | null; time: number | null; duration: number | null;
          timeScale: number | null; path: string | null;
        } | null;
      };
    }).__gameDebug;

    debug.teleport([-64, debug.groundHeight(-64, -88) + 0.2, -88]);
    const herd = debug.listEntities({ archetype: "enemy" })
      .map((e) => e.id)
      .filter((id) => id.includes("redsill_cattle"));
    if (herd.length === 0) throw new Error("no redsill_cattle entities found");

    // Give promotion, asset streaming and the first wander decision a moment on the real clock.
    await new Promise((r) => { setTimeout(r, 4_000); });

    const out: {
      atMs: number; id: string; drawn: number[]; yaw: number; motion: string | null;
      clip: string | null; clipTime: number | null; duration: number | null;
      timeScale: number | null; path: string | null;
    }[] = [];
    for (let i = 0; i < frameBudget; i += 1) {
      await new Promise((r) => { requestAnimationFrame(r as FrameRequestCallback); });
      const atMs = performance.now();
      for (const id of herd) {
        const motion = debug.getEntityMotion(id);
        if (!motion) continue;
        out.push({
          atMs, id,
          drawn: motion.drawnPosition.slice(),
          yaw: motion.drawnRotationY,
          motion: motion.motion,
          clip: motion.clip,
          clipTime: motion.time,
          duration: motion.duration,
          timeScale: motion.timeScale,
          path: motion.path,
        });
      }
    }
    return out;
  }, FRAMES);

  // ------------------------------------------------------------------ analysis
  const byId = new Map<string, FrameRow[]>();
  for (const row of rows) {
    const list = byId.get(row.id) ?? [];
    list.push(row);
    byId.set(row.id, list);
  }

  for (const [id, frames] of byId) {
    const dts = frames.slice(1).map((f, i) => f.atMs - frames[i]!.atMs).sort((a, b) => a - b);
    const medianDt = dts[Math.floor(dts.length / 2)] ?? 0;

    let starved = 0;
    let worstStarveStreak = 0;
    let streak = 0;
    let backwards = 0;
    let animatedFrames = 0;
    let movingFrames = 0;
    let lateralEnergy = 0;
    let reversals = 0;
    // The metric that actually catches the reported shake: the motion flipping walk<->idle while
    // the drawn root is still advancing. Every flip restarts a 0.18 s crossfade, so a handful per
    // second is a body stuck half-blended between two poses.
    let midStrideFlips = 0;

    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1]!;
      const b = frames[i]!;
      const rootStep = Math.hypot(b.drawn[0]! - a.drawn[0]!, b.drawn[2]! - a.drawn[2]!);
      if (a.motion !== b.motion && rootStep > 1e-4) midStrideFlips += 1;
      if (a.clip !== null && a.clip === b.clip && a.clipTime !== null && b.clipTime !== null
        && (b.timeScale ?? 0) > 0 && b.path === "live-rig") {
        animatedFrames += 1;
        const step = b.clipTime - a.clipTime;
        const duration = b.duration ?? 1;
        if (step === 0) {
          starved += 1;
          streak += 1;
          worstStarveStreak = Math.max(worstStarveStreak, streak);
        } else {
          streak = 0;
        }
        // A loop wrap steps back by nearly the whole duration; anything else negative is a bug.
        if (step < -0.001 && Math.abs(step) < duration * 0.5) backwards += 1;
      }

      if (i >= 2) {
        const z = frames[i - 2]!;
        const v1x = a.drawn[0]! - z.drawn[0]!;
        const v1z = a.drawn[2]! - z.drawn[2]!;
        const v2x = b.drawn[0]! - a.drawn[0]!;
        const v2z = b.drawn[2]! - a.drawn[2]!;
        const m1 = Math.hypot(v1x, v1z);
        const m2 = Math.hypot(v2x, v2z);
        if (m1 > 1e-5 && m2 > 1e-5) {
          movingFrames += 1;
          const dot = (v1x * v2x + v1z * v2z) / (m1 * m2);
          if (dot < -0.2) reversals += 1;
          // Component of this frame's step perpendicular to the previous step's direction.
          const lateral = Math.abs((v2x * v1z - v2z * v1x) / m1);
          lateralEnergy += lateral;
        }
      }
    }

    const motions = [...new Set(frames.map((f) => `${f.path}:${f.motion}:${f.clip}`))];
    console.log(`\n${id}  frames ${frames.length}  median frame ${medianDt.toFixed(1)} ms (${(1000 / Math.max(1, medianDt)).toFixed(0)} fps)`);
    console.log(`  states: ${motions.join(", ")}`);
    console.log(`  mixer: animated-frame pairs ${animatedFrames}, STARVED (clip frozen) ${starved}, worst streak ${worstStarveStreak}, BACKWARDS ${backwards}`);
    console.log(`  root: moving pairs ${movingFrames}, reversals ${reversals}, lateral drift total ${lateralEnergy.toFixed(4)} m`);
    console.log(`  MID-STRIDE MOTION FLIPS (the shake): ${midStrideFlips}`);
  }
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
