/** Dump every authored building and landmark position, for the structure-polish pass. */
import { writeFileSync } from "node:fs";
import { GameDriver } from "../../../../tools/lib/driver.js";
import { startGameServer } from "../../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 800 } });
await driver.launch();
await driver.open(180_000);
const buildings = await driver.callDebug("listBuildings");
const landmarks = await driver.callDebug("listEntities", [{ archetype: "landmark" }]);
writeFileSync("runs/corealm/audit/sp/buildings.json", JSON.stringify(buildings, null, 1));
writeFileSync("runs/corealm/audit/sp/landmarks.json", JSON.stringify(landmarks, null, 1));
console.log("buildings", Array.isArray(buildings) ? buildings.length : buildings);
console.log("landmark entities", Array.isArray(landmarks) ? landmarks.length : landmarks);
await driver.close();
await server.close();
