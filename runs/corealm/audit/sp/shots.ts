/**
 * Structure-polish capture pass.
 *
 * Orbits every subject named on the command line (or the default list) and writes one PNG per
 * bearing into runs/corealm/audit/sp/<tag>/.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { GameDriver } from "../../../../tools/lib/driver.js";
import { startGameServer } from "../../../../tools/lib/server.js";

interface Subject {
  tag: string;
  x: number;
  y: number;
  z: number;
  distance: number;
  pitch?: number;
  yaws?: number[];
}

const TAU = Math.PI * 2;
const SUBJECTS: Subject[] = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8")) as Subject[];
const outDir = process.argv[3] ?? "runs/corealm/audit/sp/shot";
mkdirSync(outDir, { recursive: true });

const server = await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1100, height: 760 },
  // Structure form, not fidelity: a low shadow pass and a medium draw distance keep each frame
  // inside the software rasteriser's budget while leaving silhouettes and seams fully readable.
  settings: {
    renderScale: 1, shadowQuality: "low", drawDistance: "medium",
    damageNumbers: false, invertCameraY: false, uiScale: "normal",
    music: 0, ambient: 0, sfx: 0,
  },
});
await driver.launch();
await driver.open(180_000);
await driver.callDebug("setPaused", [true]);

for (const subject of SUBJECTS) {
  const yaws = subject.yaws ?? [0, 0.25, 0.5, 0.75].map((f) => f * TAU);
  for (const [index, yaw] of yaws.entries()) {
    const ok = await driver.callDebug("inspectPose", [{
      x: subject.x, y: subject.y, z: subject.z,
      yaw, pitch: subject.pitch ?? 0.3, distance: subject.distance,
    }]);
    if (ok !== true) { console.log("pose failed", subject.tag); continue; }
    await driver.wait(260);
    await driver.screenshot(outDir, `${subject.tag}-${index}`);
  }
  console.log("captured", subject.tag);
}

console.log("console errors", driver.consoleErrors.slice(0, 5));
console.log("page errors", driver.pageErrors.slice(0, 5));
await driver.close();
await server.close();
