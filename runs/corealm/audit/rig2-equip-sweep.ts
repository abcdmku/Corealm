/**
 * Worker key `rig2`. Equips all 57 rows of content/equipment.ts through the real
 * `corealm_equip` agent tool and records what the scene graph gained.
 *
 * `getSceneStats().counts` is the only channel out of the page that names the rig's meshes:
 * `characterRig.ts` names every layered mesh `part-<assetId>-<meshName>` (or
 * `merged-part-<first>-...` when several merge into one draw) and every bone attachment
 * `equip-<slot>-<assetId>`. Diffing that map across an equip is the "visible yes/no" column.
 *
 *   npx tsx runs/corealm/audit/rig2-equip-sweep.ts
 */
import path from "node:path";
import sharp from "sharp";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import { EQUIPMENT } from "../../../game/src/content/equipment.js";
import { gearAppearanceParts } from "../../../game/src/render/equipmentVisuals.js";

const WIDTH = 2560;
const HEIGHT = 1600;
const shots = path.join(process.cwd(), "runs", "corealm", "screenshots");

/** Items worth a picture: one per weapon archetype, one per tier of armour, one staff. */
const SHOT_ITEMS = new Set([
  "grithe_sword", "kaldite_sword", "grithe_dagger", "palewood_shield", "cairnpine_shield",
  "cairnpine_staff", "kaldite_plate", "wightshroud_robe", "kaldite_helm",
]);

function rigKeys(counts: Record<string, number>): string[] {
  return Object.keys(counts).filter((key) => /(^|-)part-|^equip-/.test(key)).sort();
}

/** Total meshes the rig draws, so a merge that renames a mesh is not mistaken for a lost part. */
function rigMeshes(counts: Record<string, number>): number {
  return rigKeys(counts).reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: WIDTH, height: HEIGHT } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(4000);
  await driver.callDebug("setCameraPreset", ["bank"]);
  await driver.callDebug("setSkillLevel", ["melee", 40]);
  await driver.callDebug("setSkillLevel", ["magic", 40]);
  await driver.callDebug("setSkillLevel", ["ranged", 40]);
  await driver.wait(1500);

  const rows: string[] = [];
  for (const def of EQUIPMENT) {
    const before = rigKeys(((await driver.callDebug("getSceneStats")) as { counts: Record<string, number> }).counts);
    await driver.callDebug("giveItem", [def.id, 1, "inventory"]);
    const result = (await driver.callDebug("callTool", ["corealm_equip", { itemId: def.id }])) as {
      ok?: boolean; error?: { code?: string };
    };
    await driver.wait(1100);
    const after = rigKeys(((await driver.callDebug("getSceneStats")) as { counts: Record<string, number> }).counts);
    const gained = after.filter((key) => !before.includes(key));
    const lost = before.filter((key) => !after.includes(key));
    const changed = gained.length > 0 || lost.length > 0;
    const expected = gearAppearanceParts(def.id).map((part) => part.assetId);
    rows.push([
      def.id,
      def.equip?.slot ?? "-",
      expected.length > 0 ? expected.join("+") : "(none)",
      result.ok === false ? `EQUIP FAILED ${result.error?.code ?? "?"}` : changed ? "yes" : "no",
      `+[${gained.join(", ")}] -[${lost.join(", ")}]`,
    ].join(" | "));
    console.log(rows[rows.length - 1]);

    if (SHOT_ITEMS.has(def.id)) {
      const file = await driver.screenshot(shots, `rig2-equip-${def.id}`);
      await sharp(file)
        .extract({ left: Math.round(WIDTH / 2 - 230), top: Math.round(HEIGHT / 2 - 320), width: 460, height: 600 })
        .resize({ width: 920, kernel: "nearest" })
        .toFile(path.join(shots, `rig2-equip-${def.id}-crop.png`));
    }
  }
  console.log("\nerrors", JSON.stringify(await driver.callDebug("getErrors")));
} finally {
  await driver.close();
  await server.close();
}
