/**
 * Screenshots the three props the colour regression was measured on — the bank chest, the anvil and
 * the furnace cauldron — by teleporting to each and shooting from the bank pose. `look2-bank.png`
 * cannot be used for this: the settlement pass put a bank counter between that camera and the chest.
 */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const prefix = process.argv[2] ?? "look";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
const dir = path.join(process.cwd(), "runs/corealm/screenshots");
try {
  await driver.launch();
  await driver.open();
  const stations = await driver.callDebug("listEntities", [{ archetype: "station" }]) as { id: string; name?: string }[];
  const banks = await driver.callDebug("listEntities", [{ archetype: "bank" }]) as { id: string; name?: string }[];
  console.log("stations:", stations.map((s) => s.id).join(", "));
  console.log("banks:", banks.map((s) => s.id).join(", "));
  const preset = process.env.PRESET ?? "bank";
  for (const id of process.argv.slice(3)) {
    const ok = await driver.callDebug("teleport", [{ entityId: id }]);
    await driver.callDebug("setCameraPreset", [preset]);
    await driver.wait(900);
    const file = path.join(dir, `${prefix}-prop-${id}.png`);
    await driver.page?.screenshot({ path: file, type: "png", timeout: 180_000 });
    console.log(`${id}\tteleport=${ok}\t${path.basename(file)}`);
  }
} finally {
  await driver.close();
  await server.close();
}
