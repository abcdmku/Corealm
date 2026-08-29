/**
 * One browser session: seven poses captured, plus the three numbers this wave has to report.
 *
 * Batched into a single launch on purpose. Every `npm run screenshot` starts its own Chromium and
 * its own Vite server, and seven of those is seven servers; a previous wave left ~10 GB of orphaned
 * browsers behind doing exactly that. HMR and the file watcher are off for the same reason
 * w4-shots.ts turns them off: other agents are writing render/ while this runs.
 *
 * What it reports beyond the images:
 *  - per-pose drawCalls / triangles straight off `getMetrics`, so the screenshots and the budget
 *    numbers come from the same frame;
 *  - `getEntityViewStats().estimatedDrawCalls` against the renderer's own count at the same pose,
 *    which is the "one of these is lying" question;
 *  - `checkGrounding()`, and then a SECOND grounding pass over the worst rows that samples the
 *    terrain across each entity's drawn FOOTPRINT rather than only under its centre.
 *
 *   npx tsx runs/corealm/audit/dcb-shots.ts <prefix> [shotId ...]
 */
import path from "node:path";
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

const args = process.argv.slice(2);
const prefix = args[0] ?? "dc";
const shots = args.length > 1 ? args.slice(1)
  : ["town_entrance", "town_center", "bank", "spawn", "rootfall", "highcairn", "palewood_copse"];

const vite = await createServer({
  root: gameRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
const server = { url: `http://127.0.0.1:${address.port}`, close: async (): Promise<void> => { await vite.close(); } };

interface PageLike {
  evaluate<T>(fn: (arg: never) => T, arg?: unknown): Promise<T>;
}

const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  const page = (driver as unknown as { page: PageLike }).page;
  const out = path.join("runs", "corealm", "screenshots");

  const rows: Record<string, unknown>[] = [];
  for (const shot of shots) {
    await driver.callDebug("setCameraPreset", [shot]);
    await driver.wait(800);
    await driver.screenshot(out, `${prefix}-${shot}`);
    const row = await page.evaluate(() => {
      const debug = (window as unknown as { __gameDebug: {
        getMetrics(): Record<string, number>;
        getEntityViewStats(): Record<string, number>;
      } }).__gameDebug;
      const metrics = debug.getMetrics();
      const stats = debug.getEntityViewStats();
      return {
        rendererCalls: metrics.drawCalls ?? 0,
        triangles: metrics.triangles ?? 0,
        programs: metrics.programs ?? 0,
        evEstimate: stats.estimatedDrawCalls ?? 0,
        evBatches: stats.batches ?? 0,
        evDrawnBatches: stats.drawnBatches ?? 0,
        evParts: stats.instancedMeshes ?? 0,
        evGroups: stats.groups ?? 0,
        evUnique: stats.uniqueViews ?? 0,
        evUniqueMeshCalls: stats.uniqueDrawCalls ?? 0,
        evAnimated: stats.animatedLastFrame ?? 0,
      };
    });
    rows.push({ shot, ...row });
    console.log(`captured ${prefix}-${shot} ${JSON.stringify(row)}`);
  }

  const grounding = await page.evaluate(() => {
    const debug = (window as unknown as { __gameDebug: {
      checkGrounding(): { considered: number; measured: number; notDrawn: number; worst: number;
        overTolerance: number; entries: { id: string; archetype: string; assetId: string;
          drawnMinY: number; groundY: number; gap: number }[] };
      getDrawnBounds(id: string): { min: { x: number; y: number; z: number };
        max: { x: number; y: number; z: number } } | null;
      groundHeight(x: number, z: number): number;
      listEntities(): { id: string; position: [number, number, number] }[];
    } }).__gameDebug;
    const report = debug.checkGrounding();
    const positions = new Map(debug.listEntities().map((e) => [e.id, e.position]));

    // Second pass: the terrain UNDER THE WHOLE FOOTPRINT, not only under the centre. A bedded rock
    // on a slope has its downhill corner below the centre height by construction, so the centre
    // sample cannot tell "sunk" from "correctly seated on a hill".
    const footprint = report.entries.slice(0, 12).map((row) => {
      const bounds = debug.getDrawnBounds(row.id);
      const centre = positions.get(row.id);
      if (!bounds || !centre) return { id: row.id, gap: row.gap, footprintGap: null };
      let lowest = Infinity;
      let highest = -Infinity;
      const steps = 6;
      for (let i = 0; i <= steps; i += 1) {
        for (let j = 0; j <= steps; j += 1) {
          const x = bounds.min.x + ((bounds.max.x - bounds.min.x) * i) / steps;
          const z = bounds.min.z + ((bounds.max.z - bounds.min.z) * j) / steps;
          const h = debug.groundHeight(x, z);
          if (h < lowest) lowest = h;
          if (h > highest) highest = h;
        }
      }
      return {
        id: row.id,
        archetype: row.archetype,
        assetId: row.assetId,
        gap: row.gap,
        centreGroundY: row.groundY,
        drawnMinY: row.drawnMinY,
        footprintMinGroundY: Math.round(lowest * 1000) / 1000,
        footprintRelief: Math.round((highest - lowest) * 1000) / 1000,
        footprintGap: Math.round((row.drawnMinY - lowest) * 1000) / 1000,
        widthX: Math.round((bounds.max.x - bounds.min.x) * 1000) / 1000,
        widthZ: Math.round((bounds.max.z - bounds.min.z) * 1000) / 1000,
      };
    });

    return {
      considered: report.considered,
      measured: report.measured,
      notDrawn: report.notDrawn,
      worst: report.worst,
      overTolerance: report.overTolerance,
      worstRows: report.entries.slice(0, 12),
      footprint,
    };
  });

  const scatter = await page.evaluate(() => {
    const debug = (window as unknown as { __gameDebug: { getScatterStats(): unknown } }).__gameDebug;
    return debug.getScatterStats();
  });

  console.log(JSON.stringify({ prefix, rows, grounding, scatter }, null, 1));
} finally {
  await driver.close();
  await server.close();
}
