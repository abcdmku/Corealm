/** Ground heights under every walk-under structure, so canopy bands can be stated above ground. */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 640, height: 400 } });
try {
  await driver.launch();
  await driver.open();
  const page = driver.page;
  if (!page) throw new Error("no page");
  const out = await page.evaluate(() => {
    const api = window.__gameDebug as unknown as Record<string, (...a: unknown[]) => unknown>;
    const buildings = api.listBuildings() as { id: string; prefab: string; x: number; z: number }[];
    const kinds = ["porch", "arcade", "market_row", "well", "forge"];
    const entities = api.getEntities() as { id: string }[];
    return buildings.filter((b) => kinds.includes(b.prefab)).map((b) => {
      const parts = entities.filter((e) => e.id.startsWith(b.id + "#"));
      const bands: Record<string, [number, number]> = {};
      for (const p of parts) {
        const d = api.getDrawnBounds(p.id) as { min: { y: number }; max: { y: number } } | null;
        if (d) bands[p.id.slice(b.id.length + 1)] = [d.min.y, d.max.y];
      }
      return { id: b.id, prefab: b.prefab, ground: api.groundHeight(b.x, b.z), bands };
    });
  });
  for (const r of out) {
    const g = r.ground as number;
    const rows = Object.entries(r.bands as Record<string, [number, number]>)
      .map(([t, [a, b]]) => `${t}=${(a - g).toFixed(2)}..${(b - g).toFixed(2)}`).join("  ");
    console.log(`${r.id.padEnd(26)} ${String(r.prefab).padEnd(10)} ground=${g.toFixed(3)}  ${rows}`);
  }
} finally {
  await driver.close();
  await server.close();
}
