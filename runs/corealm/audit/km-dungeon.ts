/**
 * Does the Gravelmaw arena connect to the surface on the navmesh boot actually builds?
 * Same mesh set as boot: terrain + dungeon walkable + dungeon blockers + solid carves.
 */
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildDungeon, type DungeonSpec } from "../../../game/src/render/dungeon.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { Navigation, solidObstacleMeshes } from "../../../game/src/systems/navigation.js";
import { buildWorld } from "../../../game/src/world/regionBuilder.js";
import { REGIONS, allLocations } from "../../../game/src/content/regions.js";
import type { RegionId, Vec3 } from "../../../game/src/contracts.js";

interface ManifestAsset { id: string; size?: { x: number; y: number; z: number }; base?: { x: number; y: number; z: number } }
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((a) => [a.id, a]));

await Navigation.initLibrary();
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());

function dungeonSpec(): DungeonSpec | null {
  for (const region of REGIONS) {
    const d = region.dungeon;
    if (!d) continue;
    const base = scene.heightAt(region.id, d.entrance[0], d.entrance[1]);
    const chambers = d.chambers.map((c) => ({
      id: c.id, name: c.name, centre: [c.centre[0], c.centre[1]] as [number, number],
      radius: c.radius, floorY: base + c.floorOffset, lit: c.lit,
    }));
    const corridors = chambers.slice(0, -1).map((c, i) => {
      const next = chambers[i + 1]!;
      return { from: c.centre, to: next.centre, fromY: c.floorY, toY: next.floorY, width: 6 };
    });
    return { regionId: d.id, chambers, corridors, wallHeight: 13 };
  }
  return null;
}
const spec = dungeonSpec()!;
console.log("mouth terrain y", scene.heightAtXZ(46, -24).toFixed(2), "chamber floors", spec.chambers.map((c) => c.floorY.toFixed(2)).join(", "));
const dungeon = buildDungeon(spec, scene.materials);
console.log("dungeon walkable meshes", dungeon.walkable.length, "blockers", dungeon.blockers.length);

const heightAt = (r: RegionId, x: number, z: number): number => scene.heightAt(r, x, z);
const built = buildWorld(0x436f7265, heightAt, { heightAt, baseY: (i: string) => byId.get(i)?.base?.y ?? 0, assetSize: (i: string) => byId.get(i)?.size ?? null });
const carves = solidObstacleMeshes(built.solids);
const nav = new Navigation();
console.log("nav build", nav.build([...scene.getWalkableMeshes(), ...dungeon.walkable, ...dungeon.blockers, ...carves]));
nav.setRouteGraph(built.routeNodes, built.routeEdges);

const loc = (id: string): Vec3 => {
  const hit = allLocations().find((l) => l.location.id === id)!;
  const [x, z] = hit.location.position;
  const d = spec.chambers.find((c) => c.id === id);
  return [x, d ? d.floorY : scene.heightAtXZ(x, z), z];
};

for (const [a, b] of [
  ["gravelmaw_arena", "bracken_pit"], ["gravelmaw_arena", "gravelmaw_entrance"],
  ["gravelmaw_arena", "gravelmaw_chamber3"], ["gravelmaw_chamber3", "gravelmaw_chamber2"],
  ["gravelmaw_chamber2", "gravelmaw_chamber1"], ["gravelmaw_chamber1", "gravelmaw_entrance"],
  ["gravelmaw_entrance", "bracken_pit"], ["gravelmaw_entrance", "town_center"],
] as const) {
  const av = loc(a); const bv = loc(b);
  const snapA = nav.closestPoint(av); const snapB = nav.closestPoint(bv);
  console.log(`${a.padEnd(22)} -> ${b.padEnd(22)} connected=${nav.isConnected(av, bv)}`
    + `  snapA=${snapA ? snapA.map((v) => v.toFixed(1)).join(",") : "null"} (gap ${snapA ? Math.hypot(snapA[0] - av[0], snapA[1] - av[1], snapA[2] - av[2]).toFixed(2) : "-"})`
    + `  snapB=${snapB ? snapB.map((v) => v.toFixed(1)).join(",") : "null"} (gap ${snapB ? Math.hypot(snapB[0] - bv[0], snapB[1] - bv[1], snapB[2] - bv[2]).toFixed(2) : "-"})`);
}
