/**
 * Measures what the camera's occlusion spring actually does at each authored shot pose.
 * Read-only: focuses the preset, then reads camera.snapshot() and the player position.
 */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import { SHOTS } from "../../../game/src/debug/shots.js";

const only = process.argv.slice(2);
const shots = only.length > 0 ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  for (const shot of shots) {
    await driver.callDebug("focusCamera", [shot.id]);
    await driver.wait(300);
    const cam = await driver.callDebug("getCamera") as Record<string, unknown>;
    const pos = await driver.callDebug("getPlayerPosition") as Record<string, number>;
    console.log(
      `${shot.id.padEnd(22)} req=${String(cam.requestedDistance).padEnd(6)} dist=${String(cam.distance).padEnd(8)}`
      + ` pitch=${cam.pitch} eff=${cam.effectivePitch} occ=${cam.occluded}`
      + ` probe=${cam.occlusionProbe} player=(${pos.x},${pos.y},${pos.z}) cam=${JSON.stringify(cam.position)}`,
    );
  }
  if (driver.consoleErrors.length) console.log("CONSOLE ERRORS:", driver.consoleErrors.slice(0, 5));
  if (driver.pageErrors.length) console.log("PAGE ERRORS:", driver.pageErrors.slice(0, 5));
} finally {
  await driver.close();
  await server.close();
}
