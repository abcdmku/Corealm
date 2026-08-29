/**
 * Worker key `rig2`. Close crop of what is IN the player's hands.
 *
 * Zooms the orbit camera to its 6 m minimum with the wheel, equips one kit through the real
 * `corealm_equip` path, and cuts a 4x nearest-neighbour window around the torso so the grip can be
 * judged against the fist rather than guessed at from a 40-pixel silhouette.
 *
 *   npx tsx runs/corealm/audit/rig2-hands-crop.ts <name> <itemId...>
 */
import path from "node:path";
import sharp from "sharp";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const WIDTH = 2560;
const HEIGHT = 1600;
const [name = "hands", ...items] = process.argv.slice(2);
const shots = path.join(process.cwd(), "runs", "corealm", "screenshots");

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: WIDTH, height: HEIGHT } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);
  await driver.callDebug("setCameraPreset", ["bank"]);
  await driver.callDebug("setSkillLevel", ["melee", 40]);
  await driver.callDebug("setSkillLevel", ["magic", 40]);
  for (const id of items) {
    await driver.callDebug("giveItem", [id, 1, "inventory"]);
    await driver.callDebug("callTool", ["corealm_equip", { itemId: id }]);
  }
  await driver.wait(2500);
  // CAMERA.minDistance 6, maxDistance 34, ZOOM_STEP_FRACTION per notch: eight notches bottoms out.
  const page = driver.page;
  if (page) {
    await page.mouse.move(WIDTH / 2, HEIGHT / 2);
    for (let notch = 0; notch < 10; notch += 1) await page.mouse.wheel(0, -120);
  }
  await driver.wait(1200);
  const file = await driver.screenshot(shots, `rig2-${name}`);
  await sharp(file)
    .extract({ left: Math.round(WIDTH / 2 - 340), top: Math.round(HEIGHT / 2 - 460), width: 680, height: 900 })
    .resize({ width: 1360, kernel: "nearest" })
    .toFile(path.join(shots, `rig2-${name}-crop.png`));
  console.log("camera", JSON.stringify(await driver.callDebug("getCamera")));
  console.log("wrote", file);
} finally {
  await driver.close();
  await server.close();
}
