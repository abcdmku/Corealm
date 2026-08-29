/** Worker key ev2. Baseline: draw-call estimate vs renderer truth, per pose, plus grounding. */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startFrozenServer } from "./ev2-server.js";

const POSES = ["spawn", "town_center", "bank", "rootfall", "highcairn", "bracken_pit", "gravelmaw_entrance"];

const server = await startFrozenServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);

  const scene = (await driver.callDebug("getSceneStats")) as { totalObjects: number; counts: Record<string, number> };
  console.log("sceneTotalObjects", scene.totalObjects);
  let instanced = 0;
  for (const [name, n] of Object.entries(scene.counts)) if (name.startsWith("entity-")) instanced += n;
  console.log("entityInstancedMeshNames", instanced);

  const ground = (await driver.callDebug("checkGrounding")) as {
    considered: number; measured: number; notDrawn: number; worst: number; overTolerance: number;
    entries: { id: string; archetype: string; assetId: string; drawnMinY: number; groundY: number; gap: number }[];
  };
  console.log("grounding", JSON.stringify({
    considered: ground.considered, measured: ground.measured, notDrawn: ground.notDrawn,
    worst: ground.worst, overTolerance: ground.overTolerance,
  }));
  for (const row of ground.entries) console.log("  gap", row.gap.toFixed(3), row.archetype, row.id, row.assetId);

  for (const pose of POSES) {
    await driver.callDebug("setCameraPreset", [pose]);
    await driver.wait(1400);
    const metrics = (await driver.callDebug("getMetrics")) as Record<string, number>;
    const views = (await driver.callDebug("getEntityViewStats")) as Record<string, number>;
    console.log(pose,
      "rendererCalls", metrics.drawCalls,
      "tris", metrics.triangles,
      "| est", views.estimatedDrawCalls,
      "instMeshes", views.instancedMeshes,
      "uniq", views.uniqueViews,
      "anim", views.animatedLastFrame,
      "dressed", views.dressedCharacters,
      "named", views.namedDrawCalls,
      "other", views.otherDrawCalls,
      "moving", views.movingViews);
  }
  console.log("errors", JSON.stringify(await driver.callDebug("getErrors")));
} finally {
  await driver.close();
  await server.close();
}
