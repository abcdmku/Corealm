/**
 * Focused visual evidence for the world-polish round, captured in one browser session.
 *
 * Review the named subjects, not merely whether PNGs exist:
 * - grass cards form a dense floor without obvious crossed-card walls;
 * - settlement shells and gate heads have no daylight gaps;
 * - every water surface sits inside a visible dry bank;
 * - map terrain remains legible before/after zoom, pan, and label toggle;
 * - the surface reaver is in a locomotion pose and faces its target.
 *
 *   npx tsx runs/corealm/audit/polish-shots.ts
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

const output = path.join("runs", "corealm", "screenshots");
const GPU_ARGS = [
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--mute-audio",
];
await mkdir(output, { recursive: true });

const vite = await createServer({
  root: gameRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (!address || typeof address === "string") throw new Error("Vite did not expose a TCP port");
const server = {
  url: `http://127.0.0.1:${address.port}`,
  close: async (): Promise<void> => { await vite.close(); },
};

const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: GPU_ARGS,
});
const captured: string[] = [];
async function capture(name: string): Promise<void> {
  captured.push(await driver.screenshot(output, `polish-${name}`));
}

try {
  await driver.launch();
  await driver.open(90_000);
  const page = driver.page;
  if (!page) throw new Error("GameDriver launched without a page");

  const presets: readonly [string, string][] = [
    ["grass-meadow", "marchfield_farm"],
    ["grass-woodland", "vellenwood_canopy"],
    ["grass-upland", "karrowmoor_terraces"],
    ["gate-south", "town_entrance"],
    ["town-coldbrace", "town_center"],
    ["town-rootfall", "rootfall"],
    ["town-highcairn", "highcairn"],
    ["water-redsill", "redsill_shallows"],
  ];
  for (const [name, preset] of presets) {
    const accepted = await driver.callDebug("setCameraPreset", [preset]);
    if (accepted !== true) throw new Error(`Unknown camera preset ${preset}`);
    await driver.wait(600);
    await capture(name);
  }

  const waters: readonly { name: string; basePreset: string; locationId: string }[] = [
    { name: "water-blackwater", basePreset: "rootfall", locationId: "blackwater_pools" },
    { name: "water-cairn-tarn", basePreset: "highcairn", locationId: "cairn_tarns" },
    { name: "water-far-tarn", basePreset: "highcairn", locationId: "far_tarn" },
  ];
  for (const water of waters) {
    await driver.callDebug("setCameraPreset", [water.basePreset]);
    const teleported = await driver.callDebug("teleport", [{ locationId: water.locationId }]);
    if (teleported !== true) throw new Error(`Could not teleport to ${water.locationId}`);
    await driver.wait(650);
    await capture(water.name);
  }

  await driver.reset();
  await driver.press("m");
  await driver.wait(500);
  await capture("map-overview-labels");
  await page.getByRole("button", { name: "Zoom map in" }).evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole("button", { name: "Zoom map in" }).evaluate((button: HTMLButtonElement) => button.click());
  await driver.wait(100);
  const mapBox = await page.locator(".map__figure").boundingBox();
  if (!mapBox) throw new Error("Map figure is not visible");
  await driver.drag(
    mapBox.x + mapBox.width * 0.5,
    mapBox.y + mapBox.height * 0.5,
    mapBox.x + mapBox.width * 0.66,
    mapBox.y + mapBox.height * 0.61,
  );
  await driver.wait(100);
  await capture("map-zoomed-panned-labels");
  await page.getByRole("button", { name: "Hide map labels" }).evaluate((button: HTMLButtonElement) => button.click());
  await driver.wait(100);
  await capture("map-zoomed-panned-no-labels");
  await driver.press("m");

  await driver.reset();
  await driver.callDebug("setCameraPreset", ["march_road"]);
  const reaver = await driver.callDebug("getEntity", ["march_road_reavers_1"]) as { position?: number[] } | null;
  if (!reaver?.position || reaver.position.length < 3) throw new Error("Surface reaver is missing");
  await driver.callDebug("teleport", [[reaver.position[0]! + 7, reaver.position[1]!, reaver.position[2]!]]);
  await driver.wait(750);
  await capture("humanoid-reaver-locomotion");

  const gameErrors = await driver.callDebug("getErrors") as unknown[];
  if (gameErrors.length > 0 || driver.consoleErrors.length > 0 || driver.pageErrors.length > 0 || driver.requestErrors.length > 0) {
    throw new Error(`Runtime errors while capturing: game=${gameErrors.length}, console=${driver.consoleErrors.length}, page=${driver.pageErrors.length}, request=${driver.requestErrors.length}`);
  }
} finally {
  await driver.close();
  await server.close();
}

console.log(`Captured ${captured.length} world-polish screenshots:`);
for (const file of captured) console.log(`  ${file}`);
