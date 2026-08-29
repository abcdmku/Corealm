/** Worker key ev2. Why do the five worst grounding rows sink? Tilt, slope, footprint, clip. */
import { GameDriver } from "../../../tools/lib/driver.js";
import { startFrozenServer } from "./ev2-server.js";

const IDS = [
  "scree_slide", "hollowcut_corven_5", "lower_quarry_kaldite_5", "fallen_duskoak",
  "bracken_pit_grithe_6", "bracken_pit_stone_2", "cairn_tarn_spots_2",
  "duskoak_stand_trees_9", "ridge_pines_trees_6", "blackwater_spots_2",
  "thornbound_elders_ridge_1",
];

interface Ent {
  id: string; archetype: string; position: number[];
  view?: { assetId: string; scale?: number; rotationY?: number; clipFraction?: number;
    groundNormal?: number[]; tiltStrength?: number; materialTier?: number };
  tier: number;
}

const server = await startFrozenServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 600 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);
  const all = (await driver.callDebug("listEntities")) as Ent[];
  for (const id of IDS) {
    const e = all.find((x) => x.id === id);
    if (!e) { console.log(id, "NOT FOUND"); continue; }
    const [x = 0, , z = 0] = e.position;
    const h = (dx: number, dz: number) => driver.callDebug("groundHeight", [x + dx, z + dz]) as Promise<number>;
    const [h0, hxp, hxm, hzp, hzm] = await Promise.all([h(0, 0), h(1, 0), h(-1, 0), h(0, 1), h(0, -1)]);
    const gx = (hxp - hxm) / 2;
    const gz = (hzp - hzm) / 2;
    const slopeDeg = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
    const b = (await driver.callDebug("getDrawnBounds", [id])) as
      { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number }; meshes: number; path: string } | null;
    if (!b) { console.log(id, "no bounds"); continue; }
    const halfX = (b.max.x - b.min.x) / 2;
    const halfZ = (b.max.z - b.min.z) / 2;
    const halfR = Math.hypot(halfX, halfZ) / Math.SQRT2;
    const n = e.view?.groundNormal;
    const normalDeg = n ? (Math.acos(Math.min(1, Math.max(-1, n[1] ?? 1))) * 180) / Math.PI : 0;
    console.log(JSON.stringify({
      id, arche: e.archetype, asset: e.view?.assetId, scale: e.view?.scale, clip: e.view?.clipFraction,
      tilt: e.view?.tiltStrength, normalDeg: +normalDeg.toFixed(2), slopeDeg: +slopeDeg.toFixed(2),
      halfX: +halfX.toFixed(3), halfZ: +halfZ.toFixed(3),
      posY: +(e.position[1] ?? 0).toFixed(3), groundY: +h0.toFixed(3),
      drawnMinY: +b.min.y.toFixed(3), gap: +(b.min.y - h0).toFixed(3),
      boxH: +(b.max.y - b.min.y).toFixed(3), path: b.path, meshes: b.meshes,
      predictedTiltDrop: +(halfR * Math.sin((normalDeg * Math.PI) / 180)).toFixed(3),
      groundDropAtEdge: +(halfR * Math.tan((slopeDeg * Math.PI) / 180)).toFixed(3),
    }));
  }
} finally {
  await driver.close();
  await server.close();
}
