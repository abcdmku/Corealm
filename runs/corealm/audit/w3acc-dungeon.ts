/**
 * Why are the three red gate lines red?
 *
 * `w3acc-reach.ts` showed every one of their targets IS walkable from Coldbrace, Rootfall,
 * Karrowmoor and Highcairn, so the Karrowmoor-terrain diagnosis does not explain them. The gate's
 * boss block ends with `dbg.teleport({ locationId: "gravelmaw_arena" })` and never leaves, so this
 * asks the obvious next question: from inside the dungeon, what can `moveTo` still reach?
 *
 *   npx tsx runs/corealm/audit/w3acc-dungeon.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

const vite = await createServer({
  root: gameRoot, logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
const server = { url: `http://127.0.0.1:${address.port}`, close: async (): Promise<void> => { await vite.close(); } };

const driver = new GameDriver(server, { viewport: { width: 800, height: 600 } });
const out: Record<string, unknown> = {};
try {
  await driver.launch();
  await driver.open();

  await driver.callDebug("teleport", [{ locationId: "gravelmaw_arena" }]);
  await driver.wait(600);
  const state = await driver.callDebug("getState") as Record<string, unknown>;
  out.regionAfterTeleport = state.regionId;

  const probes: Record<string, unknown>[] = [];
  for (const target of [
    { locationId: "bracken_pit" }, { locationId: "town_center" },
    { entityId: "npc_cairnkeeper_ode" }, { entityId: "npc_smith_harrow" },
    { locationId: "gravelmaw_chamber2" }, { locationId: "gravelmaw_entrance" },
  ]) {
    const result = await driver.callDebug("callTool", ["corealm_move_to", target]) as Record<string, unknown>;
    await driver.callDebug("callTool", ["corealm_stop", {}]);
    probes.push({ target, error: result.error ?? null, pathLength: result.pathLength ?? null });
  }
  out.fromArena = probes;

  // And the same probes once the player is back outside, to show it is the region and not the
  // targets.
  await driver.callDebug("teleport", [{ locationId: "gravelmaw_entrance" }]);
  await driver.wait(600);
  const outside = await driver.callDebug("getState") as Record<string, unknown>;
  out.regionOutside = outside.regionId;
  const after: Record<string, unknown>[] = [];
  for (const target of [{ locationId: "bracken_pit" }, { entityId: "npc_cairnkeeper_ode" }]) {
    const result = await driver.callDebug("callTool", ["corealm_move_to", target]) as Record<string, unknown>;
    await driver.callDebug("callTool", ["corealm_stop", {}]);
    after.push({ target, error: result.error ?? null, pathLength: result.pathLength ?? null });
  }
  out.fromEntrance = after;
  console.log(JSON.stringify(out, null, 1));
} finally {
  await driver.close();
  await server.close();
}
await fs.writeFile(path.join("runs", "corealm", "_w3acc-dungeon.json"), JSON.stringify(out, null, 1), "utf8");
