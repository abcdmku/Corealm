/**
 * Offline structural acceptance for the world-polish round.
 *
 * This deliberately does not boot Vite or Chromium. It exercises the authored prefab/composition
 * builders, the real terrain/water geometry, the grass card emitter, and a deterministic world
 * build with the same injected measurements used by boot.
 *
 *   npx tsx runs/corealm/audit/polish-structural.ts
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { REGIONS, type RegionDef, type SettlementDef, type Spot } from "../../../game/src/content/regions.js";
import {
  BUILDING_KITS,
  GATE_GAP_METRES,
  MODULE_METRES,
  STOREY_METRES,
  buildPrefab,
  buildWallRun,
  prefabCollision,
  variantSeed,
  type KitId,
  type PartPlacement,
  type PrefabId,
} from "../../../game/src/render/buildings.js";
import { WorldScene, type RoadStamp } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { waterBasinForCluster } from "../../../game/src/world/waterBodies.js";
import { DEFAULT_SCATTER } from "../../../game/src/world/scatter.js";
import { buildWorld } from "../../../game/src/world/regionBuilder.js";

interface ManifestAsset {
  id: string;
  file: string;
  size: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
  centre?: { x: number; y: number; z: number };
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface CheckResult {
  section: string;
  ok: boolean;
  detail: string;
}

const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as {
  assets: ManifestAsset[];
};
const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
const scatterSource = readFileSync("game/src/world/scatter.ts", "utf8");
const sceneSource = readFileSync("game/src/render/scene.ts", "utf8");
const builderSource = readFileSync("game/src/world/regionBuilder.ts", "utf8");
const bootSource = readFileSync("game/src/app/boot.ts", "utf8");
const worldSurfaceSource = readFileSync("game/src/app/worldSurface.ts", "utf8");
const results: CheckResult[] = [];

function check(section: string, ok: boolean, detail: string): void {
  results.push({ section, ok, detail });
}

function near(a: number, b: number, tolerance = 1e-6): boolean {
  return Math.abs(a - b) <= tolerance;
}

function functionBody(source: string, name: string): string | null {
  const start = source.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

function drawnBox(part: PartPlacement): Box | null {
  const asset = byId.get(part.assetId);
  if (!asset) return null;
  const scale = part.scale;
  const low = {
    x: asset.base.x * scale,
    y: asset.base.y * scale,
    z: asset.base.z * scale,
  };
  const high = {
    x: low.x + asset.size.x * scale,
    y: low.y + asset.size.y * scale,
    z: low.z + asset.size.z * scale,
  };
  const cos = Math.cos(part.rotationY);
  const sin = Math.sin(part.rotationY);
  const box: Box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: low.y + part.dy,
    maxY: high.y + part.dy,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (const x of [low.x, high.x]) {
    for (const z of [low.z, high.z]) {
      const worldX = part.dx + x * cos + z * sin;
      const worldZ = part.dz - x * sin + z * cos;
      box.minX = Math.min(box.minX, worldX);
      box.maxX = Math.max(box.maxX, worldX);
      box.minZ = Math.min(box.minZ, worldZ);
      box.maxZ = Math.max(box.maxZ, worldZ);
    }
  }
  return box;
}

function distanceToSegment(point: Spot, from: Spot, to: Spot): { distance: number; at: number; length: number } {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  if (length <= 1e-9) return { distance: Math.hypot(point[0] - from[0], point[1] - from[1]), at: 0, length };
  const unitX = dx / length;
  const unitZ = dz / length;
  const at = (point[0] - from[0]) * unitX + (point[1] - from[1]) * unitZ;
  const clamped = Math.max(0, Math.min(length, at));
  return {
    distance: Math.hypot(point[0] - (from[0] + unitX * clamped), point[1] - (from[1] + unitZ * clamped)),
    at,
    length,
  };
}

function angleDifferenceModuloPi(a: number, b: number): number {
  let difference = Math.abs(a - b) % Math.PI;
  if (difference > Math.PI / 2) difference = Math.PI - difference;
  return difference;
}

// ---------------------------------------------------------------- grass cards and density

const grassIds = [
  "grass_common_short",
  "grass_common_tall",
  "grass_wispy_short",
  "grass_wispy_tall",
] as const;
const grassSet = new Set<string>(grassIds);
for (const id of grassIds) {
  check("grass-routing", scatterSource.includes(`\"${id}\"`), `${id} is in the generated-card registry`);
  const manifestAsset = byId.get(id);
  check("grass-routing", Boolean(manifestAsset?.file.endsWith(".glb")), `${id} remains a measured manifest source`);
}
check(
  "grass-routing",
  /assets\.loadMany\(species\.filter\(\(entry\)\s*=>\s*!isGrassSprite\(entry\.assetId\)\)/.test(scatterSource),
  "the GLB preload explicitly filters generated grass-card species",
);
check(
  "grass-routing",
  /scene\.scatterGrassSprites\(/.test(scatterSource) && /assetId:\s*\"grass-sprite\"/.test(scatterSource),
  "accepted grass placements route to scatterGrassSprites rather than scatterInstanced",
);

const cardScene = new WorldScene(new THREE.Scene());
const cardMeshes = cardScene.scatterGrassSprites([{
  position: [0, 0, 0],
  rotationY: 0,
  width: 1,
  height: 1,
  colour: 0x65a24a,
}], "audit-grass-card");
const card = cardMeshes[0];
if (!card) {
  check("grass-geometry", false, "one placement did not emit an InstancedMesh");
} else {
  const position = card.geometry.getAttribute("position") as THREE.BufferAttribute;
  const ys = Array.from({ length: position.count }, (_unused, index) => position.getY(index));
  const material = Array.isArray(card.material) ? card.material[0] : card.material;
  check("grass-geometry", position.count === 8, `crossed card has ${position.count} vertices, expected 8`);
  check("grass-geometry", card.geometry.getIndex()?.count === 12, `crossed card has ${card.geometry.getIndex()?.count ?? 0} indices, expected 12`);
  check("grass-geometry", near(Math.min(...ys), 0), `card is rooted at y=${Math.min(...ys).toFixed(3)}`);
  check("grass-geometry", near(Math.max(...ys), 1), `unit card reaches y=${Math.max(...ys).toFixed(3)}`);
  check("grass-geometry", material?.name === "grass-sprite", `material is ${material?.name || "unnamed"}`);
  check("grass-geometry", card.castShadow === false, "grass cards do not multiply density through a shadow pass");
}

for (const region of REGIONS.filter((entry) => entry.id !== "gravelmaw")) {
  const spec = DEFAULT_SCATTER[region.id];
  const dense = spec.layers.filter((layer) => ["groundcover", "carpet", "bladecarpet"].includes(layer.id));
  const cap = dense.reduce((sum, layer) => sum + layer.maxCount, 0);
  const blades = spec.layers.find((layer) => layer.id === "bladecarpet");
  const bladeSpecies = blades?.species ?? (blades?.assetIds ?? []).map((assetId) => ({ assetId }));
  check("grass-density", dense.length === 3, `${region.id} authors groundcover, carpet, and bladecarpet`);
  check("grass-density", cap >= 90_000, `${region.id} dense-cover cap is ${cap.toLocaleString()} instances`);
  check("grass-density", (blades?.maxCount ?? 0) >= 65_000, `${region.id} bladecarpet cap is ${(blades?.maxCount ?? 0).toLocaleString()}`);
  check("grass-density", (blades?.spacing ?? Infinity) <= 0.95, `${region.id} bladecarpet spacing is ${blades?.spacing ?? "missing"} m`);
  check(
    "grass-density",
    bladeSpecies.length > 0 && bladeSpecies.every((species) => grassSet.has(species.assetId)),
    `${region.id} bladecarpet is generated-card grass only`,
  );
}

// -------------------------------------------------------------- building shells

// The forge is an authored three-sided smithy whose open +Z workshop mouth connects to its yard.
const ringPrefabs = new Set<PrefabId>(["cottage", "hall", "tower", "shed", "quarry_hut", "farmstead"]);
const authoredBuildings = REGIONS.flatMap((region) => (region.settlement?.buildings ?? []).map((building) => ({
  region,
  settlement: region.settlement!,
  building,
})));
const uniqueBuildingPlans = new Map<string, typeof authoredBuildings[number]>();
for (const row of authoredBuildings) {
  const key = `${row.settlement.kit}/${row.building.prefab}/${row.building.footprint.join("x")}`;
  uniqueBuildingPlans.set(key, row);
}

for (const [plan, row] of uniqueBuildingPlans) {
  if (!ringPrefabs.has(row.building.prefab)) continue;
  const parts = buildPrefab(
    row.building.prefab,
    row.building.footprint,
    variantSeed(row.building.id),
    row.settlement.kit,
  );
  const kit = BUILDING_KITS[row.settlement.kit];
  const cornerWidth = byId.get(kit.corner)?.size.x ?? 0;
  const sides = new Map<string, { length: number; spans: [number, number][] }>();
  for (const part of parts) {
    const isPanel = part.assetId.startsWith("wall_") && !part.assetId.includes("trim") && part.assetId !== kit.frame;
    const cardinal = Math.abs(part.rotationY % (Math.PI / 2)) < 1e-3;
    const isStud = part.assetId === kit.corner && cardinal && part.dy < STOREY_METRES;
    if (!isPanel && !isStud) continue;
    const yaw = Math.round(part.rotationY / (Math.PI / 2)) * (Math.PI / 2);
    const alongX = Math.abs(Math.cos(yaw)) > 0.5;
    const side = sides.get(yaw.toFixed(3)) ?? {
      length: alongX ? row.building.footprint[0] : row.building.footprint[1],
      spans: [],
    };
    const centre = alongX ? part.dx : part.dz;
    const half = ((isPanel ? MODULE_METRES : cornerWidth) * part.scale) / 2;
    side.spans.push([centre - half, centre + half]);
    sides.set(yaw.toFixed(3), side);
  }
  let worstJointGap = 0;
  for (const side of sides.values()) {
    const merged: [number, number][] = [];
    for (const span of [...side.spans].sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    for (let index = 1; index < merged.length; index += 1) {
      worstJointGap = Math.max(worstJointGap, merged[index]![0] - merged[index - 1]![1]);
    }
  }
  check("building-shell", sides.size >= 4, `${plan} emits four wall sides`);
  check("building-shell", worstJointGap <= 0.01, `${plan} worst authored module gap is ${worstJointGap.toFixed(3)} m`);

  const roof = parts.find((part) => part.assetId.startsWith("roof_tiles") || part.assetId === "roof_tower");
  if (!roof || roof.assetId === "roof_tower") continue;
  const roofBox = drawnBox(roof);
  if (!roofBox) {
    check("building-shell", false, `${plan} roof asset is absent from the manifest`);
    continue;
  }
  const alongZ = roofBox.maxZ - roofBox.minZ > roofBox.maxX - roofBox.minX;
  const acrossHalf = (alongZ ? roofBox.maxX - roofBox.minX : roofBox.maxZ - roofBox.minZ) / 2;
  const eaveY = roofBox.minY;
  const apexY = roofBox.maxY;
  const roofHalfAt = (y: number): number => Math.max(0, acrossHalf * (apexY - y) / (apexY - eaveY));
  const gables = parts.filter((part) => part.assetId === "roof_gable_brick");
  const gableHalfAt = (y: number): number => {
    let best = 0;
    for (const gable of gables) {
      // Gables are fitted independently across and vertically. A uniform-scale
      // approximation reports a false opening on long, shallow hall roofs.
      const acrossScale = gable.scaleAxes?.[0] ?? 1;
      const heightScale = gable.scaleAxes?.[1] ?? 1;
      const height = 4.384 * gable.scale * heightScale;
      const apex = gable.dy + height;
      if (y > apex) continue;
      best = Math.max(best, 3.35 * gable.scale * acrossScale * (apex - y) / height);
    }
    return best;
  };
  let openArea = 0;
  const steps = 500;
  for (let index = 0; index < steps; index += 1) {
    const y = STOREY_METRES + ((index + 0.5) / steps) * (apexY - STOREY_METRES);
    openArea += 2 * Math.max(0, roofHalfAt(y) - gableHalfAt(y)) * ((apexY - STOREY_METRES) / steps);
  }
  const gableSpan = alongZ ? row.building.footprint[0] : row.building.footprint[1];
  check("building-shell", gables.length >= 2, `${plan} has ${gables.length} solid gable infills`);
  check("building-shell", openArea < 0.10, `${plan} open gable area is ${openArea.toFixed(3)} m2 per end`);
  check("building-shell", eaveY <= STOREY_METRES + 0.01, `${plan} eave meets the wall head within ${(eaveY - STOREY_METRES).toFixed(3)} m`);
  check("building-shell", roofHalfAt(STOREY_METRES) >= gableSpan / 2 - 0.12, `${plan} roof covers its wall-head span`);
}

// -------------------------------------------------------------------- gates

const usedGateWidths = new Set<number>();
for (const row of authoredBuildings) if (row.building.prefab === "gatehouse") usedGateWidths.add(row.building.footprint[0]);
for (const width of usedGateWidths) {
  for (const kitId of Object.keys(BUILDING_KITS) as KitId[]) {
    const parts = buildPrefab("gatehouse", [width, 3], 7, kitId);
    const collision = prefabCollision("gatehouse", [width, 3]);
    const left = collision.find((box) => box.tag === "pier_l");
    const right = collision.find((box) => box.tag === "pier_r");
    if (!left || !right) {
      check("gate-clearance", false, `${kitId}/${width} m gate lacks two pier colliders`);
      continue;
    }
    const collisionGap = (right.dx - right.sizeX / 2) - (left.dx + left.sizeX / 2);
    let innerLeft = -Infinity;
    let innerRight = Infinity;
    for (const part of parts) {
      const box = drawnBox(part);
      if (!box || box.minY > STOREY_METRES - 0.2) continue;
      if (box.maxX <= 0) innerLeft = Math.max(innerLeft, box.maxX);
      if (box.minX >= 0) innerRight = Math.min(innerRight, box.minX);
    }
    const visibleGap = innerRight - innerLeft;
    const blockers = parts.filter((part) => {
      const box = drawnBox(part);
      return Boolean(box && box.minY < STOREY_METRES - 0.2 && box.maxX > innerLeft + 0.1 && box.minX < innerRight - 0.1);
    });
    const head = parts.filter((part) => part.tag.startsWith("hf_"));
    const headBoxes = head.map(drawnBox).filter((box): box is Box => box !== null);
    const headMin = headBoxes.reduce((value, box) => Math.min(value, box.minX), Infinity);
    const headMax = headBoxes.reduce((value, box) => Math.max(value, box.maxX), -Infinity);
    check("gate-clearance", collisionGap >= GATE_GAP_METRES - 0.01, `${kitId}/${width} m collision clearance is ${collisionGap.toFixed(3)} m`);
    check("gate-clearance", Math.abs(visibleGap - collisionGap) <= 0.10, `${kitId}/${width} m visible ${visibleGap.toFixed(3)} m vs collision ${collisionGap.toFixed(3)} m`);
    check("gate-clearance", blockers.length === 0, `${kitId}/${width} m passage blockers: ${blockers.map((part) => part.tag).join(", ") || "none"}`);
    check("gate-clearance", head.length > 0 && headMax - headMin >= visibleGap - 0.01, `${kitId}/${width} m head course spans ${(headMax - headMin).toFixed(3)} m`);
  }
}

for (const region of REGIONS) {
  const settlement = region.settlement;
  if (!settlement) continue;
  const gates = settlement.buildings.filter((building) => building.prefab === "gatehouse");
  for (const gate of gates) {
    const matches: string[] = [];
    for (const wall of settlement.walls ?? []) {
      const projection = distanceToSegment(gate.position, wall.from, wall.to);
      if (projection.distance > 0.08) continue;
      const yaw = Math.atan2(-(wall.to[1] - wall.from[1]), wall.to[0] - wall.from[0]);
      for (const opening of wall.openings ?? []) {
        if (Math.abs(opening.at - projection.at) <= 0.02 && Math.abs(opening.width - gate.footprint[0]) <= 0.01) {
          check("gate-control", angleDifferenceModuloPi(gate.rotationY, yaw) <= 0.01, `${gate.id} rotation follows ${wall.id}`);
          matches.push(`${wall.id}@${opening.at}/${opening.width}`);
        }
      }
    }
    check("gate-control", matches.length === 1, `${gate.id} has ${matches.length} exact wall opening match: ${matches.join(", ") || "none"}`);
  }
}

function roadControlGates(region: RegionDef): { roads: RoadStamp[]; gateIds: Set<string> } {
  const roads: RoadStamp[] = [];
  const gateIds = new Set<string>();
  const locations = new Map(region.locations.map((location) => [location.id, location]));
  for (const road of region.roads) {
    const from = locations.get(road.from);
    const to = locations.get(road.to);
    if (!from || !to) continue;
    const waypoints: Spot[] = [from.position];
    const settlement = region.settlement;
    const gates = settlement?.buildings.filter((building) => building.prefab === "gatehouse") ?? [];
    if (settlement && gates.length > 0) {
      const centreDistance = (point: Spot): number => Math.hypot(point[0] - settlement.centre[0], point[1] - settlement.centre[1]);
      const perimeter = Math.max(...gates.map((gate) => centreDistance(gate.position)));
      const fromInside = centreDistance(from.position) < perimeter - 1;
      const toInside = centreDistance(to.position) < perimeter - 1;
      if (fromInside !== toInside) {
        const chosen = gates.reduce((best, candidate) => {
          const routeLength = (entry: typeof candidate): number =>
            Math.hypot(entry.position[0] - from.position[0], entry.position[1] - from.position[1]) +
            Math.hypot(to.position[0] - entry.position[0], to.position[1] - entry.position[1]);
          return routeLength(candidate) < routeLength(best) ? candidate : best;
        });
        gateIds.add(chosen.id);
        waypoints.push(chosen.position);
      }
    }
    waypoints.push(to.position);
    const points: [number, number, number][] = [];
    for (let segment = 0; segment < waypoints.length - 1; segment += 1) {
      const a = waypoints[segment]!;
      const b = waypoints[segment + 1]!;
      const count = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6));
      for (let step = 0; step < count; step += 1) {
        const t = step / count;
        points.push([a[0] + (b[0] - a[0]) * t, 0, a[1] + (b[1] - a[1]) * t]);
      }
    }
    const final = waypoints[waypoints.length - 1]!;
    points.push([final[0], 0, final[1]]);
    roads.push({ points, width: 3.2 });
  }
  return { roads, gateIds };
}

const allRoads: RoadStamp[] = [];
for (const region of REGIONS) {
  const controls = roadControlGates(region);
  allRoads.push(...controls.roads);
  const settlement = region.settlement;
  if (settlement) {
    for (const gate of settlement.buildings.filter((building) => building.prefab === "gatehouse")) {
      check("gate-control", controls.gateIds.has(gate.id), `${gate.id} is an exact control on at least one authored road`);
    }
  }
}
check(
  "gate-control",
  /waypoints\.push\(gate\.position\)/.test(worldSurfaceSource),
  "the shared gameplay/map surface builder injects the selected settlement gate as a road waypoint",
);

// ---------------------------------------------------- road/resource solids and blockers

const terrainScene = new WorldScene(new THREE.Scene());
terrainScene.buildWorld(buildWorldTerrainSpec());
terrainScene.setGroundStamps({ roads: allRoads, seed: 0x5eedc0de });
const resolvedRoads = terrainScene.getRoadPolylines();
const roadDistance = (x: number, z: number): number => {
  let best = Infinity;
  for (const line of resolvedRoads) {
    for (let index = 0; index < line.length - 1; index += 1) {
      const a = line[index]!;
      const b = line[index + 1]!;
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / lengthSq));
      best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t)));
    }
  }
  return best;
};
const heightAt = (regionId: Parameters<WorldScene["heightAt"]>[0], x: number, z: number): number =>
  terrainScene.heightAt(regionId, x, z);
const built = buildWorld(0x5eedc0de, heightAt, {
  heightAt,
  baseY: (assetId) => byId.get(assetId)?.base.y ?? 0,
  assetSize: (assetId) => byId.get(assetId)?.size ?? null,
  assetCenterXZ: (assetId) => {
    const asset = byId.get(assetId);
    return asset ? {
      x: asset.centre?.x ?? asset.base.x + asset.size.x / 2,
      z: asset.centre?.z ?? asset.base.z + asset.size.z / 2,
    } : null;
  },
  roadDistance,
});
const entityById = new Map(built.entities.map((entity) => [entity.id, entity]));
const solidIds = new Set(built.solids.map((solid) => solid.id));
const resources = built.entities.filter((entity) => (entity.archetype === "tree" || entity.archetype === "ore") && solidIds.has(entity.id));
for (const entity of resources) {
  const clearance = roadDistance(entity.position[0], entity.position[2]);
  check("resource-clearance", clearance >= 3.4 - 0.01, `${entity.id} centre clears the resolved road by ${clearance.toFixed(2)} m`);
}
check("resource-clearance", resources.length >= 20, `${resources.length} solid tree/ore nodes were measured against resolved roads`);
check("resource-clearance", /roadDistance\(spot\[0\],\s*spot\[1\]\)\s*<\s*3\.4/.test(builderSource), "resource placement retries against the 3.4 m clearance contract");
check("resource-clearance", /roadDistance,\s*\n?\s*};/.test(bootSource), "boot supplies resolved-road distance to buildWorld");

const nonBlockingAsset = /^(?:banner|chain|flower|kerb|lamp|mushroom|rope|rubble|sack|stairs_|torch|vine)/;
const decorativeSolids = built.solids.flatMap((solid) => {
  if (!solid.id.includes("#")) return [];
  const assetId = entityById.get(solid.id)?.view?.assetId ?? "";
  return nonBlockingAsset.test(assetId) ? [`${solid.id}:${assetId}`] : [];
});
check("composition-blockers", decorativeSolids.length === 0, `decorative composition solids: ${decorativeSolids.join(", ") || "none"}`);

const ownerComposition = new Map<string, string>();
for (const region of REGIONS) {
  for (const landmark of region.landmarks) if (landmark.composition) ownerComposition.set(landmark.id, landmark.composition);
  for (const gate of region.gates) if (gate.composition) ownerComposition.set(gate.id, gate.composition);
  if (region.dungeon?.entranceComposition) ownerComposition.set("gravelmaw_mouth_portal", region.dungeon.entranceComposition);
}
const neverBlocking = new Set(["milestone", "rootfall_stump", "vault_door", "highcairn_crane"]);
for (const [ownerId, composition] of ownerComposition) {
  if (!neverBlocking.has(composition)) continue;
  const blockers = built.solids.filter((solid) => solid.id.startsWith(`${ownerId}#`));
  check("composition-blockers", blockers.length === 0, `${ownerId}/${composition} emits ${blockers.length} composition blockers`);
}
const compositionBody = functionBody(builderSource, "emitComposition") ?? "";
check(
  "composition-blockers",
  compositionBody.includes("compositionPartBlocks(composition, part, size)"),
  "emitComposition filters each candidate before pushAssetSolid",
);

// ----------------------------------------------------------- no tier compensation

const emitPartsBody = functionBody(builderSource, "emitParts");
const trueScaleBody = functionBody(builderSource, "trueScale");
check("tier-scale", emitPartsBody !== null, "emitParts is observable in regionBuilder.ts");
check(
  "tier-scale",
  emitPartsBody !== null && !emitPartsBody.includes("tierSilhouetteScale") && !emitPartsBody.includes("compensation"),
  "building/composition parts retain their authored scale with no tier compensation",
);
check("tier-scale", trueScaleBody !== null, "trueScale is observable in regionBuilder.ts");
check(
  "tier-scale",
  trueScaleBody !== null && !trueScaleBody.includes("tierSilhouetteScale") && !/\/\s*tier/.test(trueScaleBody),
  "landmarks, portals, and dungeon architecture do not divide authored scale by tier",
);
for (const row of authoredBuildings) {
  const expected = buildPrefab(row.building.prefab, row.building.footprint, variantSeed(row.building.id), row.settlement.kit);
  for (const part of expected) {
    const entity = entityById.get(`${row.building.id}#${part.tag}`);
    check(
      "tier-scale",
      near(entity?.view?.scale ?? NaN, part.scale, 0.0001),
      `${row.region.id}/${row.building.id}#${part.tag} scale ${entity?.view?.scale ?? "missing"} equals authored ${part.scale}`,
    );
  }
}

// --------------------------------------------------------- water basin closure

for (const region of REGIONS) {
  for (const cluster of region.clusters) {
    if (cluster.archetype !== "fishing_spot") continue;
    const basin = waterBasinForCluster(cluster);
    const floor = terrainScene.heightAt(region.id, basin.x, basin.z);
    const level = floor + basin.depth * basin.fillFraction;
    const mesh = terrainScene.buildWater({
      minX: basin.x - basin.crestRadius,
      maxX: basin.x + basin.crestRadius,
      minZ: basin.z - basin.crestRadius,
      maxZ: basin.z + basin.crestRadius,
    }, level, region.id);
    check("water-basin", mesh !== null, `${basin.id} emitted a water mesh`);
    const waterMaterial = mesh
      ? (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)
      : null;
    check("water-basin", waterMaterial?.side === THREE.FrontSide, `${basin.id} water material is FrontSide`);
    const snapshot = terrainScene.getWaterBodies().find((body) => body.id === basin.id);
    check("water-basin", snapshot?.closed === true, `${basin.id} closed contour: ${snapshot?.error ?? "yes"}`);
    check("water-basin", (snapshot?.contour.length ?? 0) >= 32, `${basin.id} contour has ${snapshot?.contour.length ?? 0} solved spokes`);
    check("water-basin", near(basin.depth, 0.9, 0.001), `${basin.id} authored basin depression is ${basin.depth.toFixed(3)} m`);
    check("water-basin", near(snapshot?.depth ?? NaN, 0.495, 0.02), `${basin.id} centre water depth is ${(snapshot?.depth ?? 0).toFixed(3)} m`);
    let worstCrestShortfall = 0;
    let worstContourShortfall = 0;
    for (let step = 0; step < 96; step += 1) {
      const angle = (step / 96) * Math.PI * 2;
      const crest = terrainScene.meshHeightAt(
        basin.x + Math.cos(angle) * basin.crestRadius,
        basin.z + Math.sin(angle) * basin.crestRadius,
      );
      worstCrestShortfall = Math.max(worstCrestShortfall, level + basin.freeboard - crest);
    }
    for (const point of snapshot?.contour ?? []) {
      worstContourShortfall = Math.max(worstContourShortfall, level - terrainScene.meshHeightAt(point[0], point[1]));
    }
    check("water-basin", worstCrestShortfall <= 0.08, `${basin.id} worst dry-crest shortfall is ${worstCrestShortfall.toFixed(3)} m`);
    check("water-basin", worstContourShortfall <= 0.01, `${basin.id} contour is on dry ground within ${worstContourShortfall.toFixed(3)} m`);
  }
}
const waterBodies = terrainScene.getWaterBodies();
check("water-basin", waterBodies.length === 4, `${waterBodies.length} authored water-body snapshots are exposed`);
check("water-basin", waterBodies.filter((body) => !body.closed).length === 0, `${waterBodies.filter((body) => !body.closed).length} water bodies have open spokes`);

// --------------------------------------------------------------------- report

const failed = results.filter((result) => !result.ok);
const sections = [...new Set(results.map((result) => result.section))];
console.log("World polish structural acceptance");
for (const section of sections) {
  const rows = results.filter((result) => result.section === section);
  const failures = rows.filter((result) => !result.ok);
  console.log(`${failures.length === 0 ? "PASS" : "FAIL"} ${section}: ${rows.length - failures.length}/${rows.length}`);
  for (const failure of failures) console.log(`  ! ${failure.detail}`);
}
console.log(`${failed.length === 0 ? "PASS" : "FAIL"}: ${results.length - failed.length}/${results.length} checks`);
process.exitCode = failed.length === 0 ? 0 : 1;
