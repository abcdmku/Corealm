/**
 * Worker key `rig2`. One session, four kits, four close crops: does tier read through material?
 *
 * Also samples the mean RGB of the blade region so "the three tints differ" is a number rather than
 * an impression.
 *
 *   npx tsx runs/corealm/audit/rig2-tiers.ts
 */
import path from "node:path";
import sharp from "sharp";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const WIDTH = 2560;
const HEIGHT = 1600;
const shots = path.join(process.cwd(), "runs", "corealm", "screenshots");

const KITS: readonly (readonly [string, readonly string[]])[] = [
  ["t1", ["grithe_sword", "palewood_shield", "grithe_helm", "grithe_cuirass", "grithe_greaves", "grithe_boots", "grithe_gloves"]],
  ["t5", ["corven_sword", "duskoak_shield", "corven_helm", "corven_plate", "corven_greaves", "corven_boots", "corven_gauntlets"]],
  ["t10", ["kaldite_sword", "cairnpine_shield", "kaldite_helm", "kaldite_plate", "kaldite_greaves", "kaldite_boots", "kaldite_gauntlets"]],
  ["magic", ["cairnpine_staff", "garnet_focus", "wightshroud_hood", "wightshroud_robe", "wightshroud_leggings", "wightshroud_boots", "wightshroud_wraps"]],
  ["dagger", ["grithe_dagger", "quartz_focus"]],
];

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: WIDTH, height: HEIGHT } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);
  await driver.callDebug("setCameraPreset", ["bank"]);
  await driver.callDebug("setSkillLevel", ["melee", 40]);
  await driver.callDebug("setSkillLevel", ["magic", 40]);
  const page = driver.page;
  if (page) {
    await page.mouse.move(WIDTH / 2, HEIGHT / 2);
    for (let notch = 0; notch < 10; notch += 1) await page.mouse.wheel(0, -120);
  }
  await driver.wait(1500);

  for (const [name, items] of KITS) {
    for (const id of items) {
      await driver.callDebug("giveItem", [id, 1, "inventory"]);
      await driver.callDebug("callTool", ["corealm_equip", { itemId: id }]);
    }
    await driver.wait(2200);
    const file = await driver.screenshot(shots, `rig2-tier-${name}`);
    const crop = path.join(shots, `rig2-tier-${name}-crop.png`);
    await sharp(file)
      .extract({ left: Math.round(WIDTH / 2 - 340), top: Math.round(HEIGHT / 2 - 460), width: 680, height: 900 })
      .resize({ width: 1360, kernel: "nearest" })
      .toFile(crop);
    // Torso and blade windows, located by eye off the crop and then converted back to screen space.
    for (const [label, left, top, w, h] of [["torso", 1235, 760, 50, 50], ["blade", 1372, 826, 36, 24]] as const) {
      const stat = await sharp(file).extract({ left, top, width: w, height: h }).stats();
      console.log(name, label, stat.channels.slice(0, 3).map((c) => Math.round(c.mean)).join(","));
    }
  }
  console.log("errors", JSON.stringify(await driver.callDebug("getErrors")));
} finally {
  await driver.close();
  await server.close();
}
