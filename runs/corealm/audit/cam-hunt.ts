/**
 * Does the occlusion spring hunt? Records the camera's effective distance and pitch every rendered
 * frame while the player walks a settlement street, then counts direction reversals.
 *
 * A reversal is a frame where the sign of the distance delta flips by more than the dead zone. A
 * spring that breathes in and out past a fence post shows up here and nowhere else.
 */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

interface Sample { d: number; p: number; occ: boolean }

const runs: readonly (readonly [string, readonly [number, number, number], string, number])[] = [
  ["coldbrace-street", [-160, 1, -100], "w", 6000],
  ["coldbrace-square", [-160, 1, -84], "w", 6000],
  ["bank-court", [-160, 1, -88], "a", 5000],
  ["highcairn", [144, 27.2, -60], "w", 6000],
];

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 320, height: 200 } });
try {
  await driver.launch();
  await driver.open(60_000);
  for (const [name, from, key, ms] of runs) {
    await driver.callDebug("teleport", [from]);
    await driver.wait(500);
    const page = driver.page;
    if (!page) throw new Error("no page");
    // Passed as source text, not as a closure: tsx compiles named function expressions with an
    // esbuild `__name` helper that does not exist in the page.
    await page.evaluate(`
      window.__camTrace = [];
      window.__camTick = function () {
        var c = window.__gameDebug.getCamera();
        window.__camTrace.push({ d: c.distance, p: c.effectivePitch, occ: c.occluded });
        requestAnimationFrame(window.__camTick);
      };
      requestAnimationFrame(window.__camTick);
    `);
    await driver.press(key, ms);
    const samples = (await page.evaluate("window.__camTrace || []")) as Sample[];
    if (samples.length < 20) { console.log(`${name}: only ${samples.length} frames, page reloaded mid-run`); continue; }
    await page.evaluate("window.__camTick = function () {}; window.__camTrace = [];");

    let reversals = 0;
    let maxStep = 0;
    let sign = 0;
    let occluded = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const delta = samples[i]!.d - samples[i - 1]!.d;
      maxStep = Math.max(maxStep, Math.abs(delta));
      if (samples[i]!.occ) occluded += 1;
      if (Math.abs(delta) < 0.02) continue;
      const next = delta > 0 ? 1 : -1;
      if (sign !== 0 && next !== sign) reversals += 1;
      sign = next;
    }
    const ds = samples.map((s) => s.d);
    const ps = samples.map((s) => s.p);
    console.log(
      `${name.padEnd(18)} frames=${String(samples.length).padEnd(5)} occluded=${occluded}`
      + ` d ${Math.min(...ds).toFixed(2)}..${Math.max(...ds).toFixed(2)}`
      + ` pitch ${Math.min(...ps).toFixed(2)}..${Math.max(...ps).toFixed(2)}`
      + ` reversals=${reversals} maxStep=${maxStep.toFixed(3)}`,
    );
  }
} finally {
  await driver.close();
  await server.close();
}
