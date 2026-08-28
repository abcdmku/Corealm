/**
 * Close crop of one NPC (worker key: ev).
 *
 * Teleports the player next to a named NPC at a large viewport, screenshots, and cuts a window out
 * of the middle so the head, the clothes and the seam between them are actually inspectable — a
 * 1440x900 town shot puts an NPC in about 40x90 pixels, which cannot answer "is there bare skin
 * poking through the trousers".
 */
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const TARGETS = process.argv.slice(2);
const WIDTH = 2560;
const HEIGHT = 1600;

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: WIDTH, height: HEIGHT } });
const shots = path.join(process.cwd(), "runs", "corealm", "screenshots");
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);
  const npcs = (await driver.callDebug("listEntities", [{ archetype: "npc" }])) as Array<{
    id: string; position: number[]; view?: { assetId: string; partAssetIds?: string[]; rotationY?: number };
  }>;
  for (const id of TARGETS.length > 0 ? TARGETS : [npcs[0]?.id ?? ""]) {
    const npc = npcs.find((candidate) => candidate.id === id);
    if (!npc) continue;
    const [x = 0, y = 0, z = 0] = npc.position;
    // The camera's default yaw looks toward +z, so the player must stand on the -z side of an NPC
    // whose facing is ~pi to see its FACE, and on the +z side of one facing ~0 to see its back.
    const facing = npc.view?.rotationY ?? 0;
    const front = Math.abs(Math.abs(facing) - Math.PI) < 0.5 ? -2.4 : 2.4;
    await driver.callDebug("teleport", [[x, y, z + front]]);
    await driver.wait(3500);
    // Right-drag orbits at ORBIT_YAW_PER_PX = 0.006 rad/px (input/mouse.ts:27), so 524 px is a
    // half turn. The camera keeps a fixed world yaw otherwise, and every NPC would be shot from
    // behind.
    if (process.env.EV_ORBIT === "1") {
      await driver.drag(WIDTH / 2 + 300, HEIGHT / 2, WIDTH / 2 + 300 - 524, HEIGHT / 2, "right");
      await driver.wait(900);
    }
    const file = await driver.screenshot(shots, `ev-crop-${id}-raw`);
    const cropped = path.join(shots, `ev-crop-${id}.png`);
    await sharp(file)
      .extract({ left: Math.round(WIDTH / 2) - 260, top: Math.round(HEIGHT / 2) - 330, width: 520, height: 560 })
      .resize({ width: 1040 })
      .toFile(cropped);
    await fs.rm(file);
    console.log(`${id} parts=${npc.view?.partAssetIds?.join(",")} -> ${cropped}`);
  }
} finally {
  await driver.close();
  await server.close();
}
