import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

interface EntityView {
  id: string;
  position: [number, number, number];
  state: string;
}

const sites = [
  { id: "fallowmarch_air_altar", orb: "air_orb", label: "air" },
  { id: "vellenwood_earth_altar", orb: "earth_orb", label: "earth" },
  { id: "karrowmoor_water_altar", orb: "water_orb", label: "water" },
] as const;

const server = await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  settings: {
    renderScale: 0.7,
    shadowQuality: "off",
    drawDistance: "near",
    damageNumbers: true,
    invertCameraY: false,
    uiScale: "normal",
    music: 0,
    ambient: 0,
    sfx: 0,
  },
});

try {
  await driver.launch();
  await driver.open(240_000);
  await driver.callDebug("reset", [{ seed: 1337 }]);
  const out = path.join(process.cwd(), "runs", "corealm", "screenshots");

  for (const site of sites) {
    const before = await driver.callDebug("getEntity", [site.id]) as EntityView;
    await driver.callDebug("giveItem", [site.orb, 1, "inventory"]);
    await driver.callDebug("teleport", [{ entityId: site.id }]);
    await driver.callDebug("callTool", ["corealm_interact", {
      entityId: site.id,
      interaction: "awaken",
    }]);
    await driver.callDebug("focusEntity", [site.id]);
    await driver.wait(1_000);
    console.log(await driver.screenshot(out, `altar-court-${site.label}`));

    const [x, y, z] = before.position;
    const route = await driver.callDebug("getNavPath", [
      [x + 0.2, y, z - 7],
      [x + 0.2, y, z + 2],
    ]) as Array<{ x: number; z: number }> | null;
    const routeLength = route?.slice(1).reduce((sum, point, index) => {
      const previous = route[index]!;
      return sum + Math.hypot(point.x - previous.x, point.z - previous.z);
    }, 0) ?? 0;
    console.log(`${site.id}: ${route?.length ?? 0} points, ${routeLength.toFixed(2)} m around central stone`);
  }

  const water = await driver.callDebug("getEntity", ["karrowmoor_water_altar"]) as EntityView;
  await driver.callDebug("teleport", [[water.position[0] + 4, water.position[1], water.position[2]]]);
  await driver.callDebug("focusPlayer");
  await driver.wait(1_000);
  console.log(await driver.screenshot(out, "altar-court-water-walkable"));

  const diagnostics = {
    console: driver.consoleErrors,
    page: driver.pageErrors,
    request: driver.requestErrors,
  };
  if (diagnostics.console.length || diagnostics.page.length || diagnostics.request.length) {
    throw new Error(`Browser diagnostics: ${JSON.stringify(diagnostics)}`);
  }
} finally {
  await driver.close();
  await server.close();
}
