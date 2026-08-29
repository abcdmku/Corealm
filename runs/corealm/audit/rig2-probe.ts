/**
 * Worker key `rig2`. Close-crop probe of the PLAYER rig plus a dump of the rig's scene-graph
 * children by name, which is the only channel that tells "the part is missing" apart from "the part
 * is there and drawn in the wrong place".
 *
 * `getSceneStats().counts` keys on `object.name` with a trailing number stripped, and
 * `characterRig.ts` names every layered mesh `part-<assetId>-<meshName>` and every bone attachment
 * `equip-<slot>-<assetId>`, so the counts map is a readable inventory of what the player is wearing.
 *
 *   npx tsx runs/corealm/audit/rig2-probe.ts <shotId> [name]
 */
import path from "node:path";
import sharp from "sharp";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const WIDTH = 2560;
const HEIGHT = 1600;
const shotId = process.argv[2] ?? "bank";
const name = process.argv[3] ?? shotId;
const shots = path.join(process.cwd(), "runs", "corealm", "screenshots");

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: WIDTH, height: HEIGHT } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(4000);
  await driver.callDebug("setCameraPreset", [shotId]);
  await driver.wait(2500);

  const stats = (await driver.callDebug("getSceneStats")) as {
    totalObjects: number;
    counts: Record<string, number>;
  };
  const rig = Object.entries(stats.counts)
    .filter(([key]) => /part-|equip-|merged|character-rig|^body$|Face|Sphere|Hair|Plane/.test(key))
    .sort();
  console.log("totalObjects", stats.totalObjects);
  console.log("rig children:");
  for (const [key, count] of rig) console.log("  ", key, count);
  console.log("player", JSON.stringify(await driver.callDebug("getPlayerPosition")));

  const file = await driver.screenshot(shots, `rig2-${name}`);
  // The player is drawn at the screen centre by the orbit camera, so a fixed window around it is
  // stable across shots. 3x nearest so individual mesh seams survive.
  await sharp(file)
    .extract({ left: Math.round(WIDTH / 2 - 260), top: Math.round(HEIGHT / 2 - 340), width: 520, height: 640 })
    .resize({ width: 1040, kernel: "nearest" })
    .toFile(path.join(shots, `rig2-${name}-crop.png`));
  console.log("wrote", file);
} finally {
  await driver.close();
  await server.close();
}
