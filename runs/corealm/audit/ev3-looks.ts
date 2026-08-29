/**
 * Worker key ev3. One browser session: entity-view stats, scene stats, and close crops of every
 * NPC plus one member of each enemy group, so "are these different people / different animals" is
 * answerable from images rather than from the code.
 *
 * Camera geometry, measured rather than guessed: the follow camera sits on the -z side of the
 * player and looks toward +z, and a right-drag orbits at 0.006 rad/px (input/mouse.ts), so 524 px
 * is a half turn. An NPC is therefore parked 3.2 m up-camera of the player, and the camera is
 * flipped for the ones whose authored facing points away, or every portrait is the back of a head.
 *
 * Usage: npx tsx runs/corealm/audit/ev3-looks.ts <prefix>
 */
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startFrozenServer } from "./ev2-server.js";

const prefix = process.argv[2] ?? "ev3";
/** How many NPCs and how many enemy families to photograph. The whole roster is ~30 shots. */
const LIMIT = Number(process.argv[3] ?? 6);
const WIDTH = 1920;
const HEIGHT = 1200;
const HALF_TURN_PX = 524;
const shots = path.join(process.cwd(), "runs", "corealm", "screenshots");

interface Ent {
  id: string; position: number[]; tier: number;
  view?: { assetId: string; partAssetIds?: string[]; rotationY?: number };
}

const server = await startFrozenServer();
const driver = new GameDriver(server, { viewport: { width: WIDTH, height: HEIGHT } });
const out: Record<string, unknown> = {};
let flipped = false;

try {
  await driver.launch();
  await driver.open();
  await driver.wait(6000);
  out.entityViewStats = await driver.callDebug("getEntityViewStats");
  out.sceneStats = await driver.callDebug("getSceneStats");

  const npcs = (await driver.callDebug("listEntities", [{ archetype: "npc" }])) as Ent[];
  const enemies = (await driver.callDebug("listEntities", [{ archetype: "enemy" }])) as Ent[];
  const families = new Map<string, Ent>();
  for (const enemy of enemies) {
    const key = enemy.id.replace(/_\d+$/, "");
    if (!families.has(key)) families.set(key, enemy);
  }

  const setFlip = async (want: boolean): Promise<void> => {
    if (want === flipped) return;
    await driver.drag(WIDTH / 2 + 300, HEIGHT / 2, WIDTH / 2 + 300 - HALF_TURN_PX, HEIGHT / 2, "right");
    flipped = want;
    await driver.wait(700);
  };

  // The follow camera climbs over whatever occludes it (render/camera.ts), so a portrait taken
  // at the default distance inside a settlement is whatever the roofline allowed. Zooming to
  // CAMERA.minDistance (6 m) first makes every portrait the same size.
  const zoomIn = async (): Promise<void> => {
    const mouse = driver.page?.mouse;
    if (!mouse) return;
    await driver.moveMouse(WIDTH / 2, HEIGHT / 2);
    for (let notch = 0; notch < 24; notch += 1) await mouse.wheel(0, -120);
  };

  const shoot = async (ent: Ent, label: string, gap: number, face: boolean): Promise<void> => {
    const [x = 0, y = 0, z = 0] = ent.position;
    // Facing ~pi means the model looks toward -z, i.e. toward an unflipped camera.
    const looksSouth = Math.abs(Math.abs(ent.view?.rotationY ?? 0) - Math.PI) < Math.PI / 2;
    const flip = face && !looksSouth;
    await setFlip(flip);
    await driver.callDebug("teleport", [[x, y, z + (flip ? gap : -gap)]]);
    await driver.wait(2000);
    await zoomIn();
    await driver.wait(900);
    const raw = await driver.screenshot(shots, `${prefix}-${label}-raw`);
    const file = path.join(shots, `${prefix}-${label}.png`);
    await sharp(raw)
      .extract({ left: Math.round(WIDTH / 2) - 330, top: Math.round(HEIGHT / 2) - 470, width: 660, height: 700 })
      .toFile(file);
    await fs.rm(raw);
    console.log(label, "->", file);
  };

  for (const npc of npcs.slice(0, LIMIT)) await shoot(npc, `npc-${npc.id.replace(/^npc_/, "")}`, 3.2, true);
  for (const [key, ent] of [...families].slice(0, LIMIT)) await shoot(ent, `foe-${key}`, 4.4, false);

  for (const pose of ["town_center", "rootfall", "highcairn"]) {
    await driver.callDebug("setCameraPreset", [pose]);
    await driver.wait(1400);
    console.log(await driver.screenshot(shots, `${prefix}-pose-${pose}`));
  }
  out.errors = await driver.callDebug("getErrors");
} finally {
  await driver.close();
  await server.close();
}
await fs.writeFile(
  path.join(process.cwd(), "runs", "corealm", `_${prefix}-looks.json`),
  JSON.stringify(out, null, 2),
);
console.log("entityViewStats", JSON.stringify(out.entityViewStats));
console.log("errors", JSON.stringify(out.errors));
