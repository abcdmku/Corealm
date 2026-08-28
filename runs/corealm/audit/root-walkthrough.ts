import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch();
await driver.open();
const page = (driver as any).page;

// Walk into things and see whether we end up inside them.
const targets = [
  "coldbrace_bank", "coldbrace_anvil", "coldbrace_furnace",
  "coldbrace_general", "coldbrace_smith", "march_vault_tower",
];

const results: unknown[] = [];
for (const id of targets) {
  const placed = await page.evaluate((entityId: string) => {
    const d: any = (window as any).__gameDebug;
    const e = d.getEntity(entityId);
    if (!e) return null;
    const p = e.position;
    // Stand 3 m south of it, facing north.
    d.teleport({ x: p[0], y: p[1], z: p[2] + 3 });
    d.setPaused(false);
    return { id: entityId, target: p, start: d.getPlayerPosition() };
  }, id);
  if (!placed) { results.push({ id, error: "no entity" }); continue; }
  await driver.press("w", 1400);
  const after = await page.evaluate((entityId: string) => {
    const d: any = (window as any).__gameDebug;
    const e = d.getEntity(entityId);
    const p = d.getPlayerPosition();
    const dx = p.x - e.position[0];
    const dz = p.z - e.position[2];
    return { end: p, distanceToTarget: Math.round(Math.hypot(dx, dz) * 1000) / 1000 };
  }, id);
  results.push({ ...placed, ...after });
}

const town = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  d.teleport({ locationId: "town_center" });
  return new Promise((resolve) => setTimeout(() => {
    const ev = d.getEntityViewStats();
    resolve({
      uniqueViews: ev.uniqueViews, animatedLastFrame: ev.animatedLastFrame,
      dressedCharacters: ev.dressedCharacters, dressedGroups: ev.dressedGroups,
      namedDrawCalls: ev.namedDrawCalls, otherDrawCalls: ev.otherDrawCalls,
      estimatedDrawCalls: ev.estimatedDrawCalls,
      missingAssets: ev.missingAssets,
    });
  }, 1200));
});

console.log(JSON.stringify({ walkInto: results, town }, null, 1));
await driver.close();
await server.close();
