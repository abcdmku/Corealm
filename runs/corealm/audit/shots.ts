import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
await driver.launch();
await driver.open();
const dir = "runs/corealm/screenshots";

const presets = ["highcairn", "karrowmoor_terraces", "great_cairn", "palewood_copse", "bracken_pit", "town_center", "marchfield_farm", "sunder_ledge"];
for (const p of presets) {
  await driver.callDebug("setCameraPreset", [p]);
  await driver.wait(400);
  await driver.screenshot(dir, `ground-preset-${p}`);
}

const spots: [string, number, number, number][] = [
  ["ridge-pines-pillar", 236, 43, -85],
  ["far-tarn", 284, 8, -110],
  ["fallen-duskoak", 172, 0, 108],
  ["coldbrace-fletching", -160, 0, -80],
];
for (const [name, x, y, z] of spots) {
  await driver.callDebug("teleport", [{ x, y, z }]);
  await driver.wait(700);
  const p = await driver.callDebug("getPlayerPosition");
  console.log(name, JSON.stringify(p));
  await driver.screenshot(dir, `ground-${name}`);
}
await driver.close();
await server.close();
