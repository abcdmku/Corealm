import * as THREE from "three";
import { readFileSync } from "node:fs";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { Navigation, solidObstacleMeshes } from "../../../game/src/systems/navigation.js";
import { buildWorld } from "../../../game/src/world/regionBuilder.js";
import type { RegionId, Vec3 } from "../../../game/src/contracts.js";

interface A { id: string; size?: { x: number; y: number; z: number }; base?: { x: number; y: number; z: number } }
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: A[] };
const byId = new Map(manifest.assets.map((a) => [a.id, a]));
await Navigation.initLibrary();
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const heightAt = (r: RegionId, x: number, z: number): number => scene.heightAt(r, x, z);
const built = buildWorld(0x436f7265, heightAt, { heightAt, baseY: (i: string) => byId.get(i)?.base?.y ?? 0, assetSize: (i: string) => byId.get(i)?.size ?? null });
const nav = new Navigation();
nav.build([...scene.getWalkableMeshes(), ...solidObstacleMeshes(built.solids)]);
const from: Vec3 = [60, scene.heightAtXZ(60, -16), -16];
for (const [x, z] of [[200, -30], [50, -90], [198, -30], [202, -30], [200, -34], [200, -26], [50, -86], [54, -90], [46, -90], [50, -94]] as const) {
  const y = scene.heightAtXZ(x, z);
  const to: Vec3 = [x, y, z];
  const near = built.solids.filter((s) => Math.hypot(s.position[0] - x, s.position[2] - z) < 14)
    .map((s) => `${s.id}@${Math.hypot(s.position[0] - x, s.position[2] - z).toFixed(1)}m`);
  console.log(`(${x},${z}) y=${y.toFixed(2)} slope=${scene.slopeAt(x, z).toFixed(2)} connected=${nav.isConnected(from, to)} snap=${JSON.stringify(nav.closestPoint(to))} solids<14m: ${near.slice(0, 6).join(", ") || "none"}`);
}
