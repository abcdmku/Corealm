/**
 * Offline proof that the route graph now crosses the Gravelmaw portals in both directions.
 *
 * Same mesh set as boot: terrain + dungeon walkable + dungeon blockers + solid carves. Prints the
 * portal edges the builder emitted, then the plan `moveTo`'s fallback would run from the arena.
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
const dungeon = buildDungeon(spec, scene.materials);
const heightAt = (r: RegionId, x: number, z: number): number => scene.heightAt(r, x, z);
const built = buildWorld(0x436f7265, heightAt, {
  heightAt,
  baseY: (i: string) => byId.get(i)?.base?.y ?? 0,
  assetSize: (i: string) => byId.get(i)?.size ?? null,
});
const carves = solidObstacleMeshes(built.solids);
const nav = new Navigation();
nav.build([...scene.getWalkableMeshes(), ...dungeon.walkable, ...dungeon.blockers, ...carves]);
nav.setRouteGraph(built.routeNodes, built.routeEdges);

console.log("--- portal edges");
for (const edge of built.routeEdges.filter((e) => e.kind === "portal")) {
  console.log(`  ${edge.from.padEnd(20)} -> ${edge.to.padEnd(20)} cost ${edge.cost}s`
    + ` via ${edge.portalId} entrance ${edge.entrance?.map((v) => v.toFixed(1)).join(",")}`
    + ` exit ${edge.exit?.map((v) => v.toFixed(1)).join(",")}`);
}
console.log("--- walk edges still claiming the mouth is a road");
console.log("  ", built.routeEdges.filter((e) => e.kind === "walk"
  && (e.from === "gravelmaw_entrance" || e.to === "gravelmaw_entrance")
  && (e.from.startsWith("gravelmaw_chamber") || e.to.startsWith("gravelmaw_chamber"))).length);

const loc = (id: string): Vec3 => {
  const hit = allLocations().find((l) => l.location.id === id)!;
  const [x, z] = hit.location.position;
  const d = spec.chambers.find((c) => c.id === id);
  return [x, d ? d.floorY : scene.heightAtXZ(x, z), z];
};

const entity = (id: string): Vec3 => built.entities.find((e) => e.id === id)!.position;

for (const agility of [1, 20]) {
  console.log(`--- planRouteVia from gravelmaw_arena at Agility ${agility}`);
  for (const target of ["bracken_pit", "town_center", "gravelmaw_entrance"]) {
    const plan = nav.planRouteVia(loc("gravelmaw_arena"), { locationId: target }, agility);
    if (!plan) { console.log(`  -> ${target}: NO PLAN`); continue; }
    console.log(`  -> ${target}: ${plan.cost}s, ${plan.legs.length} legs`);
    for (const leg of plan.legs) {
      console.log(`       ${leg.kind.padEnd(8)} ${leg.fromId.padEnd(24)} -> ${leg.toId.padEnd(24)}`
        + ` ${leg.cost.toFixed(1)}s${leg.toRegionId ? ` region=${leg.toRegionId}` : ""}`);
    }
  }
  const byEntity = nav.planRouteVia(
    loc("gravelmaw_arena"),
    { position: entity("bracken_pit_grithe_1"), id: "bracken_pit_grithe_1" },
    agility,
  );
  console.log(`  -> entity bracken_pit_grithe_1: ${byEntity ? `${byEntity.cost}s, ${byEntity.legs.length} legs, last=${byEntity.legs[byEntity.legs.length - 1]!.toId}` : "NO PLAN"}`);
}

console.log("--- the reverse: surface to the boss floor");
const inward = nav.planRouteVia(loc("town_center"), { locationId: "gravelmaw_arena" }, 20);
console.log(inward ? `  ${inward.cost}s, ${inward.legs.length} legs, kinds ${inward.legs.map((l) => l.kind).join(">")}` : "  NO PLAN");

console.log("--- shortcut edge endpoints, and how far they snap onto the mesh");
for (const edge of built.routeEdges.filter((e) => e.kind === "shortcut")) {
  const gap = (p?: Vec3): string => {
    if (!p) return "node";
    const snap = nav.closestPoint(p);
    return snap ? Math.hypot(snap[0] - p[0], snap[1] - p[1], snap[2] - p[2]).toFixed(2) : "OFF-MESH";
  };
  console.log(`  ${edge.from.padEnd(20)} -> ${edge.to.padEnd(20)} req ${edge.reqLevel} ${edge.durationMs}ms`
    + ` entranceGap ${gap(edge.entrance)} exitGap ${gap(edge.exit)}`);
}

console.log("--- portal endpoints on the mesh");
for (const edge of built.routeEdges.filter((e) => e.kind === "portal")) {
  const gap = (p?: Vec3): string => {
    if (!p) return "node";
    const snap = nav.closestPoint(p);
    return snap ? Math.hypot(snap[0] - p[0], snap[1] - p[1], snap[2] - p[2]).toFixed(2) : "OFF-MESH";
  };
  console.log(`  ${edge.portalId?.padEnd(24)} entranceGap ${gap(edge.entrance)} exitGap ${gap(edge.exit)}`);
}
console.log("--- legs actually produced for the outward crossing (Agility 20)");
const out20 = nav.planRouteVia(loc("gravelmaw_arena"), { locationId: "bracken_pit" }, 20);
for (const leg of out20?.legs ?? []) {
  console.log(`  ${leg.kind.padEnd(8)} ${leg.fromId.padEnd(26)} -> ${leg.toId.padEnd(26)} ${leg.cost.toFixed(1)}s`);
}

console.log("--- route nodes by 3-D distance from the arena, and whether the mesh reaches them");
const arena = loc("gravelmaw_arena");
const ranked = built.routeNodes
  .map((n) => ({ n, gap: Math.hypot(n.position[0] - arena[0], n.position[1] - arena[1], n.position[2] - arena[2]) }))
  .sort((a, b) => a.gap - b.gap)
  .slice(0, 8);
for (const [i, r] of ranked.entries()) {
  const metres = nav.pathDistance(arena, r.n.position);
  const plan1 = nav.planRoute(r.n.id, "bracken_pit", 1);
  console.log(`  ${i + 1}. ${r.n.id.padEnd(22)} gap ${r.gap.toFixed(1)}m walk ${metres === null ? "UNREACHABLE" : metres.toFixed(1) + "m"}`
    + `  planRoute->bracken_pit@ag1 ${plan1 ? plan1.cost + "s" : "none"}`);
}
