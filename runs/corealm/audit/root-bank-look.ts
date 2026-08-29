import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import path from "node:path";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
try {
  await driver.launch(); await driver.open();
  const page = (driver as any).page;
  const dir = path.join(process.cwd(), "runs/corealm/screenshots");

  // Does the porch / forge geometry exist at all?
  const built = await page.evaluate(() => {
    const d: any = (window as any).__gameDebug;
    const ids = ["coldbrace_bank_porch", "coldbrace_forge_shed", "coldbrace_market", "coldbrace_well", "coldbrace_cookhouse"];
    return ids.map((id) => {
      const parts = d.listEntities({ regionId: "fallowmarch" }).filter((e: any) => String(e.id).startsWith(id + "#"));
      const b = d.getDrawnBounds(parts[0]?.id ?? id);
      return { id, parts: parts.length, firstPart: parts[0]?.id ?? null, bounds: b ? { minY: b.min.y, maxY: b.max.y } : null };
    });
  });
  console.log(JSON.stringify(built, null, 1));

  // Stand back and look at the bank porch and the forge from the square.
  const poses: [string, number, number, number, number, number][] = [
    ["bankporch", -163, -84, Math.PI, 0.45, 12],
    ["forgeyard", -150, -86, Math.PI / 2, 0.45, 13],
  ];
  for (const [name, x, z, yaw, pitch, dist] of poses) {
    await page.evaluate(([x, z, yaw, pitch, dist]: number[]) => {
      const d: any = (window as any).__gameDebug;
      d.teleport({ x, y: 1, z });
      d.setCameraPose?.(yaw, pitch, dist);
    }, [x, z, yaw, pitch, dist]);
    await new Promise((r) => setTimeout(r, 600));
    await driver.screenshot(dir, `root-${name}`);
  }
} finally {
  await driver.close();
  await server.close();
}
