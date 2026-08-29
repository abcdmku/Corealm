/**
 * Does `moveTo` actually reach the three targets the red gate lines walk to?
 *
 * The first pass of this used `getNavPath` with `entity.position.x`, and `SemanticEntity.position`
 * is a `Vec3` ARRAY - every probe came back null and looked like a world-wide nav failure. This one
 * calls the same `corealm_move_to` the gate calls, from a known start, and reads the error code.
 *
 *   npx tsx runs/corealm/audit/w3acc-reach.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

const TARGETS = [
  "npc_smith_harrow", "npc_cairnkeeper_ode", "npc_watcher_hale", "npc_quarrymaster_vess",
  "gravelmaw_mouth_portal", "great_cairn_stones",
];
const STARTS = ["spawn", "town_center", "rootfall_hamlet", "karrowmoor_terraces", "highcairn_outpost"];

const vite = await createServer({
  root: gameRoot, logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
const server = { url: `http://127.0.0.1:${address.port}`, close: async (): Promise<void> => { await vite.close(); } };

const driver = new GameDriver(server, { viewport: { width: 800, height: 600 } });
const rows: Record<string, unknown>[] = [];
try {
  await driver.launch();
  await driver.open();

  // Where the targets actually are, and what region the game thinks they are in.
  const where: Record<string, unknown> = {};
  for (const id of TARGETS) {
    const entity = await driver.callDebug("getEntity", [id]) as
      { id: string; position: number[]; regionId: string } | null;
    where[id] = entity ? { position: entity.position, regionId: entity.regionId } : null;
  }

  for (const start of STARTS) {
    const teleported = await driver.callDebug("teleport", [{ locationId: start }]);
    await driver.wait(400);
    const player = await driver.callDebug("getPlayer") as Record<string, unknown>;
    for (const id of TARGETS) {
      const result = await driver.callDebug("callTool", ["corealm_move_to", { entityId: id }]) as
        Record<string, unknown>;
      await driver.callDebug("callTool", ["corealm_stop", {}]);
      rows.push({
        start, teleported, from: player.position, region: player.regionId, target: id,
        error: result.error ?? null, message: result.message ?? null,
        pathLength: result.pathLength ?? null,
      });
    }
  }
  await fs.writeFile(path.join("runs", "corealm", "_w3acc-reach.json"),
    JSON.stringify({ where, rows }, null, 1), "utf8");
  for (const row of rows) {
    console.log(`${String(row.start).padEnd(20)} -> ${String(row.target).padEnd(26)} ${row.error ?? "OK path=" + row.pathLength}`);
  }
  console.log(JSON.stringify(where, null, 1));
} finally {
  await driver.close();
  await server.close();
}
