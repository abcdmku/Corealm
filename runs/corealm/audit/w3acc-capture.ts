/**
 * Acceptance capture for the world-polish wave, in ONE browser session.
 *
 * Captures all 18 shot presets as `w3-<shotId>` and, in the same page, measures the things the
 * acceptance judgement has to be able to cite: per-pose draw calls and triangles, whether every
 * named NPC and location has a walkable path from the player's spawn, and the grounding report.
 *
 * One session because a previous wave left ~10 GB of orphaned Chromium behind. HMR and the file
 * watcher are off so a concurrent edit cannot reload the page mid-capture.
 *
 *   npx tsx runs/corealm/audit/w3acc-capture.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

const SHOTS = [
  "spawn", "town_entrance", "town_center", "bank", "bracken_pit", "palewood_copse",
  "redsill_shallows", "marchfield_farm", "rootfall", "vellenwood_canopy", "hollowcut_seam",
  "karrowmoor_terraces", "highcairn", "upper_karrow_seam", "sunder_ledge", "gravelmaw_entrance",
  "great_cairn", "march_road",
];

/** Everything the three red gate lines walk to, plus the Karrowmoor spine. */
const REACH_ENTITIES = [
  "npc_cairnkeeper_ode", "npc_watcher_hale", "npc_smith_harrow",
  "gravelmaw_mouth_portal",
];
const REACH_LOCATIONS = [
  "spawn", "town_center", "bracken_pit", "palewood_copse", "redsill_shallows", "marchfield_farm",
  "rootfall_hamlet", "hollowcut_seam", "vellenwood_canopy",
  "karrowmoor_terraces", "highcairn_outpost", "upper_karrow_seam", "karrow_ramp_two",
  "gravelmaw_entrance", "great_cairn", "north_milestone",
];

const vite = await createServer({
  root: gameRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
const server = { url: `http://127.0.0.1:${address.port}`, close: async (): Promise<void> => { await vite.close(); } };

const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
const report: Record<string, unknown> = {};
try {
  await driver.launch();
  await driver.open();
  const out = path.join("runs", "corealm", "screenshots");

  // ---- reachability, before anything moves the player.
  const player = await driver.callDebug("getPlayerPosition") as { x: number; y: number; z: number };
  const from = [player.x, player.y, player.z];
  const reach: Record<string, unknown>[] = [];
  for (const id of REACH_ENTITIES) {
    const entity = await driver.callDebug("getEntity", [id]) as { position?: { x: number; y: number; z: number } } | null;
    if (!entity?.position) { reach.push({ target: id, kind: "entity", found: false }); continue; }
    const to = [entity.position.x, entity.position.y, entity.position.z];
    const navPath = await driver.callDebug("getNavPath", [from, to]) as unknown[] | null;
    reach.push({ target: id, kind: "entity", found: true, points: navPath ? navPath.length : 0, walkable: navPath !== null });
  }
  for (const id of REACH_LOCATIONS) {
    const route = await driver.callDebug("planRoute", ["spawn", id, 20]);
    reach.push({ target: id, kind: "location", route });
  }
  report.reachability = reach;

  // ---- the harness surface, unchanged shape.
  report.grounding = await driver.callDebug("checkGrounding");
  report.entityViewStats = await driver.callDebug("getEntityViewStats");
  report.buildingFooting = await driver.callDebug("checkBuildingFooting");

  // ---- the eighteen poses.
  const poses: Record<string, unknown>[] = [];
  for (const shot of SHOTS) {
    const ok = await driver.callDebug("setCameraPreset", [shot]);
    await driver.wait(900);
    await driver.screenshot(out, `w3-${shot}`);
    const metrics = await driver.callDebug("getMetrics") as Record<string, number>;
    poses.push({ shot, ok, drawCalls: metrics.drawCalls, triangles: metrics.triangles, fps: metrics.fps });
    console.log(`w3-${shot}  dc=${metrics.drawCalls} tris=${metrics.triangles}`);
  }
  report.poses = poses;
  report.errors = await driver.callDebug("getErrors");
} finally {
  await driver.close();
  await server.close();
}
await fs.writeFile(path.join("runs", "corealm", "_w3acc.json"), JSON.stringify(report, null, 1), "utf8");
console.log("wrote runs/corealm/_w3acc.json");
