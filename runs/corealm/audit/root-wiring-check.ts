import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch();
await driver.open();
const page = (driver as any).page;

const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  const g = d.checkGrounding();
  const surface = (g.entries ?? []).filter((r: any) => !/gravelmaw|ordrun|chimney_climb/.test(r.id));
  const nav = d.getNavigationState();
  const scene = d.getSceneStats();
  const ev = d.getEntityViewStats();
  return {
    grounding: {
      considered: g.considered, measured: g.measured, worst: g.worst,
      overTolerance: g.overTolerance,
      worstSurface: surface.slice(0, 8).map((r: any) => ({ id: r.id, gap: r.gap })),
    },
    nav: { status: nav.status, polyCount: nav.polyCount ?? nav.polygons ?? null, error: nav.error ?? null },
    scene: { totalObjects: scene.totalObjects, drawCalls: scene.drawCalls ?? null },
    entityViews: {
      uniqueViews: ev.uniqueViews, animatedLastFrame: ev.animatedLastFrame,
      estimatedDrawCalls: ev.estimatedDrawCalls, instancedMeshes: ev.instancedMeshes,
      dressedCharacters: ev.dressedCharacters ?? null,
    },
    scatter: (() => { const s = d.getScatterStats(); return s?.available === false ? s : { available: true, regions: (s.regions ?? s)?.length ?? "n/a" }; })(),
    // Can the player walk through the bank chest any more?
    walkThrough: (() => {
      d.teleport({ locationId: "bank_interior" });
      const before = d.getPlayerPosition();
      return { before };
    })(),
    errors: d.getErrors(),
  };
});
console.log(JSON.stringify(out, null, 1));
await driver.close();
await server.close();
