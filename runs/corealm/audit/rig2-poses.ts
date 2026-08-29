/**
 * Worker key `rig2`. Drives the game into each of the 15 authored poses and photographs the player.
 *
 * There is no debug read-out of the rig's current clip — `window.__gameDebug` exposes `listClips()`
 * and nothing about what is PLAYING — so the evidence has to be the silhouette. Every shot is a 3x
 * nearest crop around the player at the 6 m camera minimum, which is enough to tell a kneeling
 * repair from a standing idle and a sword swing from a flinch.
 *
 *   npx tsx runs/corealm/audit/rig2-poses.ts
 */
import path from "node:path";
import sharp from "sharp";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const WIDTH = 1920;
const HEIGHT = 1200;
const shots = path.join(process.cwd(), "runs", "corealm", "screenshots");

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: WIDTH, height: HEIGHT } });

async function shot(name: string): Promise<void> {
  const file = await driver.screenshot(shots, `rig2-pose-${name}`);
  await sharp(file)
    .extract({ left: Math.round(WIDTH / 2 - 210), top: Math.round(HEIGHT / 2 - 300), width: 420, height: 560 })
    .resize({ width: 1260, kernel: "nearest" })
    .toFile(path.join(shots, `rig2-pose-${name}-crop.png`));
}

async function zoomIn(): Promise<void> {
  const page = driver.page;
  if (!page) return;
  await page.mouse.move(WIDTH / 2, HEIGHT / 2);
  for (let notch = 0; notch < 10; notch += 1) await page.mouse.wheel(0, -120);
  await driver.wait(600);
}

interface Entity { id: string; archetype: string; regionId: string; interactions?: string[] }

try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);
  await driver.callDebug("setSkillLevel", ["melee", 40]);
  await driver.callDebug("setSkillLevel", ["magic", 40]);
  await driver.callDebug("setSkillLevel", ["mining", 40]);
  await driver.callDebug("setSkillLevel", ["woodcutting", 40]);
  await driver.callDebug("setSkillLevel", ["fishing", 40]);
  await driver.callDebug("setSkillLevel", ["agility", 40]);
  await driver.callDebug("setSkillLevel", ["farming", 40]);
  await driver.callDebug("setSkillLevel", ["smithing", 40]);
  const all = (await driver.callDebug("listEntities", [{}])) as Entity[];
  const pick = (archetype: string, interaction?: string): string | null =>
    all.find((e) => e.archetype === archetype && e.regionId === "fallowmarch"
      && (!interaction || (e.interactions ?? []).includes(interaction)))?.id ?? null;

  await zoomIn();
  await driver.callDebug("setCameraPreset", ["spawn"]);
  await zoomIn();
  await driver.wait(1200);
  await shot("idle");

  // Locomotion. W walks the character forward under direct control.
  const page = driver.page;
  if (page) {
    await page.keyboard.down("KeyW");
    await driver.wait(1500);
    await shot("run-a");
    await driver.wait(400);
    await shot("run-b");
    await page.keyboard.up("KeyW");
  }
  await driver.wait(1500);

  const targets: readonly (readonly [string, string, string])[] = [
    ["mine", "ore", "mine"],
    ["chop", "tree", "chop"],
    ["fish", "fishing_spot", "fish"],
    ["farm", "farm_plot", "rake"],
    ["bank", "bank", "bank"],
  ];
  for (const [name, archetype, interaction] of targets) {
    const id = pick(archetype, interaction);
    if (!id) { console.log(name, "no entity"); continue; }
    await driver.callDebug("teleport", [{ entityId: id }]);
    await driver.wait(900);
    await zoomIn();
    const result = await driver.callDebug("callTool", ["corealm_interact", { entityId: id, interaction }]);
    await driver.wait(2200);
    await shot(name);
    console.log(name, id, JSON.stringify(result).slice(0, 140));
    await driver.callDebug("callTool", ["corealm_stop", {}]);
    await driver.wait(600);
  }

  // Combat: attack_melee on the player's swing, hit on the enemy's.
  const enemy = all.find((e) => e.archetype === "enemy" && e.regionId === "fallowmarch")?.id ?? null;
  if (enemy) {
    await driver.callDebug("giveItem", ["grithe_sword", 1, "inventory"]);
    await driver.callDebug("callTool", ["corealm_equip", { itemId: "grithe_sword" }]);
    await driver.callDebug("teleport", [{ entityId: enemy }]);
    await driver.wait(900);
    await zoomIn();
    await driver.callDebug("callTool", ["corealm_attack", { entityId: enemy }]);
    for (let frame = 0; frame < 10; frame += 1) {
      await driver.wait(420);
      await shot(`combat-${frame}`);
    }
    await driver.callDebug("callTool", ["corealm_stop", {}]);
  }
  console.log("errors", JSON.stringify(await driver.callDebug("getErrors")).slice(0, 400));
} finally {
  await driver.close();
  await server.close();
}
