/**
 * Worker key `rig2`. Foot slide: does the stride rate match the ground speed?
 *
 * Position and clock are read in ONE in-page evaluate, so the tool round-trip cancels instead of
 * being charged to the elapsed time. Reading them as two separate `callDebug` calls reported
 * 1.27 m/s for the same run, because 1.7 s of round-trip landed inside a 2 s window.
 *
 * The model below mirrors `CharacterRig.setLocomotionSpeed` exactly: `poseFor` picks walk or run by
 * `MOVEMENT.walkPoseThreshold`, then the rig re-picks whichever locomotion clip has the smallest
 * residual after the [MIN_TIME_SCALE, MAX_TIME_SCALE] clamp, with a CLIP_SWITCH_MARGIN of
 * 0.25 m/s of hysteresis.
 *
 *   npx tsx runs/corealm/audit/rig2-slide.ts
 */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const IMPLIED = { Walk_Loop: 0.98, Jog_Fwd_Loop: 5.92, Sprint_Loop: 9.15 };
type ClipName = keyof typeof IMPLIED;
const MIN_TIME_SCALE = 0.6;
const MAX_TIME_SCALE = 2.2;
const CLIP_SWITCH_MARGIN = 0.25;

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 700 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);
  const page = driver.page;
  if (!page) throw new Error("no page");

  const sample = async (): Promise<{ x: number; z: number; t: number }> =>
    page.evaluate(() => {
      const debug = window.__gameDebug;
      if (!debug) throw new Error("no debug api");
      const p = debug.getPlayerPosition();
      return { x: p.x, z: p.z, t: performance.now() };
    });

  await driver.callDebug("teleport", [[-160, 1, -95]]);
  await driver.wait(800);
  for (const [label, key] of [["run-w", "KeyW"], ["run-s", "KeyS"], ["run-d", "KeyD"]] as const) {
    await page.keyboard.down(key);
    await driver.wait(1200);
    const a = await sample();
    await driver.wait(2500);
    const b = await sample();
    await page.keyboard.up(key);
    const elapsed = (b.t - a.t) / 1000;
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const speed = distance / elapsed;

    const stride = (name: ClipName): number =>
      IMPLIED[name] * Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, speed / IMPLIED[name]));
    let clip: ClipName = speed > 2.2 ? "Jog_Fwd_Loop" : "Walk_Loop";
    const posed = clip;
    for (const candidate of ["Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop"] as const) {
      if (Math.abs(speed - stride(candidate)) < Math.abs(speed - stride(clip)) - CLIP_SWITCH_MARGIN) clip = candidate;
    }
    const raw = speed / IMPLIED[clip];
    const scale = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, raw));
    console.log(
      label,
      `distance=${distance.toFixed(3)}m elapsed=${elapsed.toFixed(3)}s speed=${speed.toFixed(3)}m/s`,
      `posed=${posed} clip=${clip} rawScale=${raw.toFixed(3)} clampedScale=${scale.toFixed(3)}`,
      `strideSpeed=${stride(clip).toFixed(3)} slide=${(speed - stride(clip)).toFixed(3)}m/s`,
      `oldModel(max1.6,noReselect)=${(speed - IMPLIED[posed] * Math.min(1.6, Math.max(0.6, speed / IMPLIED[posed]))).toFixed(3)}m/s`,
    );
    await driver.callDebug("teleport", [[-160, 1, -95]]);
    await driver.wait(800);
  }
} finally {
  await driver.close();
  await server.close();
}
