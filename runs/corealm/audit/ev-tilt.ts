/** Drawn bounds of the steepest-standing surface entities, to measure the ground tilt (worker key: ev). */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const IDS = [
  "lower_quarry_kaldite_3", "duskoak_stand_trees_5", "hollowcut_corven_5",
  "thornbound_elders_ridge_3", "upper_karrow_seam_1", "karrow_scree_1",
];

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 600 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(4000);
  for (const id of IDS) {
    const entity = (await driver.callDebug("getEntity", [id])) as
      { position: number[]; archetype: string; view?: { groundNormal?: number[]; tiltStrength?: number } } | null;
    if (!entity) { console.log(`${id} missing`); continue; }
    const bounds = (await driver.callDebug("getDrawnBounds", [id])) as
      { min: { y: number }; max: { y: number }; width: number } | null;
    console.log(
      `${id} arch=${entity.archetype} normal=${JSON.stringify(entity.view?.groundNormal)}` +
      ` tilt=${entity.view?.tiltStrength} groundY=${entity.position[1]}` +
      ` drawnMinY=${bounds?.min.y.toFixed(3)} gap=${bounds ? (bounds.min.y - (entity.position[1] ?? 0)).toFixed(3) : "-"}`,
    );
  }
} finally {
  await driver.close();
  await server.close();
}
