/** Measures the drawn bounds of every walk-under structure's parts, per settlement. */
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
    const buildings = api.listBuildings() as { id: string; prefab: string; x: number; z: number; width: number; depth: number; rotationY: number }[];
    const entities = api.getEntities() as { id: string }[];
    const kinds = ["porch", "arcade", "market_row", "well", "forge"];
    const rows: unknown[] = [];
    for (const b of buildings) {
      if (!kinds.includes(b.prefab)) continue;
      const parts = entities.filter((e) => e.id.startsWith(b.id + "#"));
      const perPart: unknown[] = [];
      for (const p of parts) {
        const bounds = api.getDrawnBounds(p.id) as { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
        if (!bounds) continue;
        perPart.push({ tag: p.id.slice(b.id.length + 1), min: bounds.min, max: bounds.max });
      }
      rows.push({ b, parts: perPart });
    }
    return rows;
  });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await driver.close();
  await server.close();
}
