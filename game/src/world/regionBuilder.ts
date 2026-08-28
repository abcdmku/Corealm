/**
 * Region data in, semantic entities and a route graph out.
 *
 * Deterministic from a seed: same seed, byte-identical output. That is not a nicety - the harness
 * calls `__gameDebug.reset({ seed })` before every acceptance check and diffs the resulting state,
 * so a single unseeded `Math.random()` in here would make every test flap. Everything random goes
 * through the `"world"` stream of `core/rng.ts`, consumed in a fixed order:
 *
 *   regions in REGIONS order
 *     -> clusters in declaration order
 *       -> nodes 0..count-1: placement jitter, then the yield roll
 *     -> enemy groups in declaration order
 *       -> members 0..count-1: placement jitter
 *   -> the dungeon, last
 *
 * Adding a cluster to the end of a region therefore shifts nothing before it. Adding one in the
 * middle reshuffles that region's later rolls, which is fine but worth knowing.
 *
 * The root supplies `heightAt`, so terrain stays owned by exactly one layer and no entity can end
 * up floating because two files disagreed about the ground.
 */
import type {
  EntityId, InteractionId, RegionId, SemanticEntity, SkillId, Vec3,
} from "../contracts.js";
import { RngStreams, type Rng } from "../core/rng.js";
import { content } from "../content/index.js";
import { enemyIdFor } from "../content/enemies.js";
import {
  REGIONS, WALK_SPEED_MPS,
  type BuildingDef, type DungeonDef, type EnemyGroupDef, type LocationDef, type ObstacleDef,
  type PrefabId, type RegionDef, type ResourceClusterDef, type Spot,
} from "../content/regions.js";
import {
  buildComposition, buildPrefab, prefabCollision, variantSeed,
  type CompositionId, type PartPlacement,
} from "../render/buildings.js";
import { tierSilhouetteScale } from "../render/materials.js";
import type { KnownLocation } from "./entities.js";

// ------------------------------------------------------------------ formulas

/**
 * PRD 2.6 with the root's correction R3 (tier 1 floor is 8, not 9):
 *   8-15 at tier 1, 8-15 at tier 5, 8-14 at tier 10.
 */
export function yieldRange(tier: number): readonly [number, number] {
  return [
    Math.max(4, Math.round(8.5 - 0.052 * tier)),
    Math.max(8, Math.round(15 - 0.052 * tier)),
  ];
}

/** PRD 2.6: 21 s at tier 1, 32 s at tier 5, 43 s at tier 10. */
export function respawnSeconds(tier: number): number {
  return Math.round(18 + 3.2 * Math.pow(tier, 0.9));
}

export function rollYield(rng: Rng, tier: number): number {
  const [min, max] = yieldRange(tier);
  return rng.int(min, max);
}

// -------------------------------------------------------------- route graph

export interface RouteNodeOut {
  id: string;
  name: string;
  position: Vec3;
  regionId: string;
}

export interface RouteEdgeOut {
  from: string;
  to: string;
  /** Seconds. */
  cost: number;
  kind: "walk" | "shortcut";
  obstacleId?: string;
  reqLevel?: number;
}

/**
 * A solid mass a building occupies, in world space. Emitted so the root can make settlements solid
 * without re-deriving where the walls went.
 *
 * TODO(integration, root): buildings are drawn but not yet solid. The navmesh is built from
 * `scene.getWalkableMeshes()` at boot step 9, before any of this exists, so a path currently runs
 * straight through a wall and `Physics` has only the terrain heightfield. Two things close it:
 * add a box collider per entry here after `physics.addHeightfield(...)`, and mark the same boxes
 * unwalkable before `nav.build(...)` (or carve them as Recast convex-volume obstacles afterwards).
 * `rotationY` is about the box centre; `halfExtents` is [x, y, z] in the building's own frame.
 */
export interface BuildingBox {
  id: string;
  buildingId: string;
  name: string;
  regionId: RegionId;
  prefab: PrefabId;
  /** Centre of the box: ground height at the building origin plus half its height. */
  position: Vec3;
  halfExtents: readonly [number, number, number];
  rotationY: number;
}

export interface BuiltWorld {
  entities: SemanticEntity[];
  routeNodes: RouteNodeOut[];
  routeEdges: RouteEdgeOut[];
  /** Named places for `EntityStore.registerLocations`, so `scope: "known"` has something to say. */
  knownLocations: KnownLocation[];
  /** Collision volumes for the assembled buildings. See `BuildingBox`. */
  buildings: BuildingBox[];
}

export type HeightAt = (regionId: RegionId, x: number, z: number) => number;

// ------------------------------------------------------------------- build

export function buildWorld(seed: number, heightAt: HeightAt): BuiltWorld {
  const rng = new RngStreams(seed).get("world");

  const entities: SemanticEntity[] = [];
  const routeNodes: RouteNodeOut[] = [];
  const knownLocations: KnownLocation[] = [];
  const edges: RouteEdgeOut[] = [];
  const buildings: BuildingBox[] = [];

  /** locationId -> resolved world position, so edge costs use the same Y the player walks on. */
  const nodePositions = new Map<string, Vec3>();
  /** locationId -> the entity that stands there, if any. Lets `scope: "known"` report live state. */
  const locationEntity = new Map<string, EntityId>();

  const addLocation = (regionId: RegionId, location: LocationDef, position: Vec3): void => {
    nodePositions.set(location.id, position);
    knownLocations.push({ id: location.id, name: location.name, regionId, position });
    if (location.routeNode) {
      routeNodes.push({ id: location.id, name: location.name, position, regionId });
    }
  };

  // -- pass 1: locations, so every edge in pass 3 has both endpoints resolved.
  for (const region of REGIONS) {
    for (const location of region.locations) {
      addLocation(region.id, location, spotToVec3(location.position, heightAt, region.id));
    }
    const dungeon = region.dungeon;
    if (dungeon) {
      const floorBase = heightAt(region.id, dungeon.entrance[0], dungeon.entrance[1]);
      for (const location of dungeon.locations) {
        const chamber = dungeon.chambers.find((entry) => entry.id === location.id);
        const y = floorBase + (chamber?.floorOffset ?? 0);
        addLocation(dungeon.id, location, [location.position[0], y, location.position[1]]);
      }
    }
  }

  // -- pass 2: entities.
  for (const region of REGIONS) {
    buildRegionEntities(region, rng, heightAt, entities, locationEntity, buildings);
  }
  for (const region of REGIONS) {
    const dungeon = region.dungeon;
    if (dungeon) buildDungeonEntities(region, dungeon, rng, heightAt, entities, locationEntity);
  }

  // -- pass 3: edges.
  const seenEdges = new Set<string>();
  const pushEdge = (edge: RouteEdgeOut): void => {
    const key = `${edge.from}>${edge.to}>${edge.kind}>${edge.obstacleId ?? ""}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push(edge);
  };

  for (const region of REGIONS) {
    // Roads inside a region. Bidirectional: the moor is steep but nothing here is one-way except
    // the Scree Slide, which is an obstacle, not a road.
    for (const road of region.roads) {
      const from = nodePositions.get(road.from);
      const to = nodePositions.get(road.to);
      if (!from || !to) continue;
      const metres = road.meters ?? distance3(from, to);
      const cost = round2(metres / WALK_SPEED_MPS);
      pushEdge({ from: road.from, to: road.to, cost, kind: "walk" });
      pushEdge({ from: road.to, to: road.from, cost, kind: "walk" });
    }

    // Region borders. Both sides declare the crossing; the dedupe above collapses it to one pair.
    for (const link of region.adjacency) {
      const cost = round2(link.meters / WALK_SPEED_MPS);
      pushEdge({ from: link.fromLocationId, to: link.toLocationId, cost, kind: "walk" });
      pushEdge({ from: link.toLocationId, to: link.fromLocationId, cost, kind: "walk" });
    }

    for (const obstacle of region.obstacles) {
      pushShortcutEdges(obstacle, nodePositions, pushEdge);
    }

    const dungeon = region.dungeon;
    if (!dungeon) continue;
    for (const road of dungeon.roads) {
      const from = nodePositions.get(road.from);
      const to = nodePositions.get(road.to);
      if (!from || !to) continue;
      const metres = road.meters ?? distance3(from, to);
      const cost = round2(metres / WALK_SPEED_MPS);
      pushEdge({ from: road.from, to: road.to, cost, kind: "walk" });
      pushEdge({ from: road.to, to: road.from, cost, kind: "walk" });
    }
    for (const obstacle of dungeon.obstacles) {
      pushShortcutEdges(obstacle, nodePositions, pushEdge);
    }
  }

  // Attach entity ids to the locations that have one, so a "known" bank reports its live state
  // rather than a generic landmark row.
  for (const location of knownLocations) {
    const entityId = locationEntity.get(location.id);
    if (entityId) location.entityId = entityId;
  }

  return { entities, routeNodes, routeEdges: edges, knownLocations, buildings };
}

/**
 * Shortcut cost = walk to the entrance + the traversal + walk off the far end.
 *
 * The brief states "walk time to entrance + durationMs/1000". That is exactly this when the far
 * node sits on the exit; generalising it stops the walk off the top of Sunder Ledge from being
 * free, which would overstate the flip by about two seconds a trip.
 */
function pushShortcutEdges(
  obstacle: ObstacleDef,
  nodePositions: Map<string, Vec3>,
  pushEdge: (edge: RouteEdgeOut) => void,
): void {
  const from = nodePositions.get(obstacle.fromLocationId);
  const to = nodePositions.get(obstacle.toLocationId);
  if (!from || !to) return;

  const entrance: Spot = obstacle.position;
  const exit: Spot = obstacle.exitPosition;
  const approach = distanceXZSpot([from[0], from[2]], entrance);
  const departure = distanceXZSpot(exit, [to[0], to[2]]);
  const cost = round2((approach + departure) / WALK_SPEED_MPS + obstacle.durationMs / 1000);

  pushEdge({
    from: obstacle.fromLocationId, to: obstacle.toLocationId,
    cost, kind: "shortcut", obstacleId: obstacle.id, reqLevel: obstacle.reqLevel,
  });
  // A slide you cannot climb back up gets one edge. Everything else works both ways, and the
  // reverse walk is symmetric because the entrance and exit swap roles.
  if (!obstacle.oneWay) {
    pushEdge({
      from: obstacle.toLocationId, to: obstacle.fromLocationId,
      cost, kind: "shortcut", obstacleId: obstacle.id, reqLevel: obstacle.reqLevel,
    });
  }
}

// -------------------------------------------------------- entity construction

function buildRegionEntities(
  region: RegionDef,
  rng: Rng,
  heightAt: HeightAt,
  out: SemanticEntity[],
  locationEntity: Map<string, EntityId>,
  buildings: BuildingBox[],
): void {
  const place = (spot: Spot): Vec3 => spotToVec3(spot, heightAt, region.id);

  for (const cluster of region.clusters) {
    buildCluster(region.id, cluster, rng, place, out);
  }

  const settlement = region.settlement;

  // Buildings. Round-1 critique finding 1: `settlement.buildings` was authored and never read, so
  // 37 buildings across three settlements rendered as nothing at all. Each one is now assembled by
  // `render/buildings.ts` into 2 m modules and emitted as one instanced part per piece: the render
  // path already batches by (assetId, tier), so a whole street of cottages is a dozen draw calls.
  for (const building of settlement.buildings) {
    const origin = place(building.position);
    const seed = variantSeed(building.id);
    emitParts(
      buildPrefab(building.prefab, building.footprint, seed),
      origin, building.rotationY, region.id, region.tier,
      building.id, building.name,
      { buildingId: building.id, prefab: building.prefab, settlementId: settlement.id, scenery: true },
      out,
    );
    for (const box of prefabCollision(building.prefab, building.footprint)) {
      const cos = Math.cos(building.rotationY);
      const sin = Math.sin(building.rotationY);
      buildings.push({
        id: `${building.id}#${box.tag}`,
        buildingId: building.id,
        name: building.name,
        regionId: region.id,
        prefab: building.prefab,
        position: [
          round2(origin[0] + box.dx * cos + box.dz * sin),
          round2(origin[1] + box.height / 2),
          round2(origin[2] - box.dx * sin + box.dz * cos),
        ],
        halfExtents: [round2(box.sizeX / 2), round2(box.height / 2), round2(box.sizeZ / 2)],
        rotationY: building.rotationY,
      });
    }
  }

  out.push({
    id: settlement.bank.id,
    archetype: "bank",
    name: settlement.bank.name,
    tier: region.tier,
    regionId: region.id,
    position: place(settlement.bank.position),
    state: "open",
    interactions: ["inspect", "bank"],
    view: {
      assetId: settlement.bank.assetId,
      rotationY: settlement.bank.rotationY,
      labelHeight: 1.4,
    },
    meta: { settlementId: settlement.id },
  });
  locationEntity.set(bankLocationId(region), settlement.bank.id);

  for (const shop of settlement.shops) {
    out.push({
      id: shop.id,
      archetype: "shop",
      name: shop.name,
      tier: region.tier,
      regionId: region.id,
      position: place(shop.position),
      state: "open",
      interactions: ["inspect", "trade"],
      view: { assetId: shop.assetId, rotationY: shop.rotationY, labelHeight: 3 },
      meta: { shopKind: shop.shopKind, settlementId: settlement.id },
    });
  }

  for (const station of settlement.stations) {
    out.push({
      id: station.id,
      archetype: "station",
      name: station.name,
      tier: region.tier,
      regionId: region.id,
      position: place(station.position),
      state: "idle",
      interactions: ["inspect", "produce"],
      station: { skill: station.skill, recipeIds: station.recipeIds },
      view: {
        assetId: station.assetId,
        rotationY: station.rotationY,
        scale: station.scale,
        labelHeight: 1.6,
      },
      meta: { stationKind: station.kind, settlementId: settlement.id },
    });
  }

  for (const npc of settlement.npcs) {
    out.push({
      id: npc.id,
      archetype: "npc",
      name: npc.name,
      tier: region.tier,
      regionId: region.id,
      position: place(npc.position),
      state: "idle",
      interactions: ["inspect", "talk"],
      npc: { dialogueRootId: npc.dialogueRootId, questIds: npc.questIds },
      view: { assetId: npc.assetId, rotationY: npc.facingRad, labelHeight: 2.2 },
      meta: { settlementId: settlement.id },
    });
  }

  for (const obstacle of region.obstacles) {
    out.push(buildObstacle(region.id, region.tier, obstacle, place, place));
  }

  for (const group of region.enemyGroups) {
    buildEnemyGroup(region.id, group, rng, place, out);
  }

  for (const landmark of region.landmarks) {
    const origin = place(landmark.position);
    out.push({
      id: landmark.id,
      archetype: "landmark",
      name: landmark.name,
      tier: region.tier,
      regionId: region.id,
      position: origin,
      state: "present",
      interactions: ["inspect"],
      view: {
        assetId: landmark.assetId,
        scale: trueScale(landmark.scale, region.tier),
        rotationY: landmark.rotationY,
        labelHeight: 4,
      },
      meta: { blurb: landmark.blurb },
    });
    locationEntity.set(landmark.id, landmark.id);
    // Finding 8: a landmark drawn as one stand-in prop is not a silhouette. The hero mesh above is
    // still the clickable, inspectable entity; these parts are what the player navigates by.
    emitComposition(
      landmark.composition, origin, landmark.rotationY ?? 0, region.id, region.tier,
      landmark.id, landmark.name, { blurb: landmark.blurb, scenery: true }, out,
    );
  }

  for (const gate of region.gates) {
    const origin = place(gate.position);
    out.push({
      id: gate.id,
      archetype: "portal",
      name: gate.name,
      tier: region.tier,
      regionId: region.id,
      position: origin,
      state: "open",
      interactions: ["inspect", "enter"],
      view: {
        assetId: gate.assetId,
        rotationY: gate.rotationY,
        scale: trueScale(1.4, region.tier),
        labelHeight: 3.4,
      },
      meta: { toRegionId: gate.toRegionId, toLocationId: gate.toLocationId },
    });
    locationEntity.set(gate.id, gate.id);
    emitComposition(
      gate.composition, origin, gate.rotationY ?? 0, region.id, region.tier,
      gate.id, gate.name, { toRegionId: gate.toRegionId, scenery: true }, out,
    );
  }
}

/**
 * Turns a prefab or composition part list into semantic entities.
 *
 * Two details are load-bearing:
 *
 *  - Every part of one building shares the origin's ground height. Buildings are level; following
 *    the terrain per part would shear a 12 m hall. Settlement pads are flattened for exactly this
 *    (`app/worldSpec.ts` puts a 34 m flat spot under each settlement centre).
 *  - `render/entityViews.ts` multiplies `view.scale` by `tierSilhouetteScale(materialTier)`, which
 *    is 0.92 at tier 1. Left alone, every 2 m wall module would draw 1.84 m wide and the kit would
 *    not meet on its own grid, so the scale written here cancels it exactly. Importing the real
 *    function rather than mirroring the constant means it cannot drift.
 */
function emitParts(
  parts: readonly PartPlacement[],
  origin: Vec3,
  rotationY: number,
  regionId: RegionId,
  tier: number,
  ownerId: string,
  name: string,
  meta: Record<string, string | number | boolean>,
  out: SemanticEntity[],
): void {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  const compensation = 1 / tierSilhouetteScale(tier);

  for (const part of parts) {
    out.push({
      id: `${ownerId}#${part.tag}`,
      archetype: "landmark",
      name,
      tier,
      regionId,
      position: [
        round2(origin[0] + part.dx * cos + part.dz * sin),
        round2(origin[1] + part.dy),
        round2(origin[2] - part.dx * sin + part.dz * cos),
      ],
      state: "present",
      // Deliberately empty. Scenery is drawn, hovered and walked to, never interacted with, and an
      // empty list keeps `observe({ interaction: ... })` clean.
      interactions: [],
      view: {
        assetId: part.assetId,
        scale: round4(part.scale * compensation),
        rotationY: round4(rotationY + part.rotationY),
        materialTier: tier,
        labelHeight: 2,
      },
      meta,
    });
  }
}

function emitComposition(
  composition: CompositionId | undefined,
  origin: Vec3,
  rotationY: number,
  regionId: RegionId,
  tier: number,
  ownerId: string,
  name: string,
  meta: Record<string, string | number | boolean>,
  out: SemanticEntity[],
): void {
  if (!composition) return;
  emitParts(
    buildComposition(composition, variantSeed(ownerId)),
    origin, rotationY, regionId, tier, ownerId, name, meta, out,
  );
}

function buildDungeonEntities(
  region: RegionDef,
  dungeon: DungeonDef,
  rng: Rng,
  heightAt: HeightAt,
  out: SemanticEntity[],
  locationEntity: Map<string, EntityId>,
): void {
  // The dungeon has no terrain of its own - it is carved interior geometry. Everything inside is
  // measured off the surface height at the mouth, which is the one point both layers agree on.
  const floorBase = heightAt(region.id, dungeon.entrance[0], dungeon.entrance[1]);
  const placeAt = (spot: Spot, offset: number): Vec3 => [spot[0], floorBase + offset, spot[1]];

  // The mouth itself lives in Karrowmoor: the player walks up to it on the surface and enters.
  const mouth: Vec3 = [dungeon.entrance[0], floorBase, dungeon.entrance[1]];
  const mouthRotation = dungeon.entranceRotationY ?? 0;
  out.push({
    id: "gravelmaw_mouth_portal",
    archetype: "portal",
    name: dungeon.name,
    tier: dungeon.tier,
    regionId: region.id,
    position: mouth,
    state: "open",
    interactions: ["inspect", "enter"],
    view: {
      assetId: dungeon.entranceAssetId,
      // 8 m x 12 m exactly, because the PRD's "twelve-metre wound" is a number the composition
      // around it is measured against.
      scale: trueScale(dungeon.entranceScale ?? 4, region.tier),
      rotationY: mouthRotation,
      labelHeight: 6,
    },
    meta: { toRegionId: dungeon.id, toLocationId: "gravelmaw_chamber1" },
  });
  locationEntity.set("gravelmaw_entrance", "gravelmaw_mouth_portal");

  // Finding 8: the twelve-metre wound was a lone wooden door frame on open ground. The cliffs, the
  // brow of rock above it and the two braziers are what make it read as a hole in a quarry face.
  // Region tier, not dungeon tier, because these parts stand on Karrowmoor's surface.
  emitComposition(
    dungeon.entranceComposition, mouth, mouthRotation, region.id, region.tier,
    "gravelmaw_mouth_portal", dungeon.name, { scenery: true, dungeonId: dungeon.id }, out,
  );

  for (const chamber of dungeon.chambers) {
    // The marker is a brazier, so it sits against the chamber's north wall rather than dead
    // centre - the centre is where the boss and the loot go.
    const markerSpot: Spot = [chamber.centre[0], chamber.centre[1] + chamber.radius * 0.7];
    out.push({
      id: `${chamber.id}_marker`,
      archetype: "landmark",
      name: chamber.name,
      tier: dungeon.tier,
      regionId: dungeon.id,
      position: placeAt(markerSpot, chamber.floorOffset),
      state: chamber.lit ? "lit" : "dark",
      interactions: ["inspect"],
      // No dungeon kit shipped in glTF (asset-report gap 8); the village brick set carries it,
      // and `torch` is the brazier stand-in that marks a chamber centre.
      view: { assetId: "torch", scale: 1.6, labelHeight: 2.4 },
      meta: { radius: chamber.radius, lit: chamber.lit },
    });
    locationEntity.set(chamber.id, `${chamber.id}_marker`);
  }

  for (const door of dungeon.doors) {
    out.push({
      id: door.id,
      archetype: "door",
      name: door.name,
      tier: dungeon.tier,
      regionId: dungeon.id,
      position: placeAt(door.position, door.floorOffset),
      state: door.state,
      interactions: ["inspect", "open"],
      view: { assetId: door.assetId, scale: 2.2, labelHeight: 2.6 },
      meta: { lockedReason: door.lockedReason },
    });
  }

  for (const obstacle of dungeon.obstacles) {
    const chamberOffset = (spot: Spot): Vec3 => {
      const chamber = nearestChamberOffset(dungeon, spot);
      return placeAt(spot, chamber);
    };
    out.push(buildObstacle(dungeon.id, dungeon.tier, obstacle, chamberOffset, chamberOffset));
  }

  for (const group of dungeon.enemyGroups) {
    const chamberPlace = (spot: Spot): Vec3 => placeAt(spot, nearestChamberOffset(dungeon, spot));
    buildEnemyGroup(dungeon.id, group, rng, chamberPlace, out);
  }
}

/** Floor offset of the chamber a point sits in, so an entity inside chamber 3 lands on its floor. */
function nearestChamberOffset(dungeon: DungeonDef, spot: Spot): number {
  let best = 0;
  let bestDistance = Infinity;
  for (const chamber of dungeon.chambers) {
    const d = distanceXZSpot(chamber.centre, spot);
    if (d < bestDistance) {
      bestDistance = d;
      best = chamber.floorOffset;
    }
  }
  return best;
}

function buildCluster(
  regionId: RegionId,
  cluster: ResourceClusterDef,
  rng: Rng,
  place: (spot: Spot) => Vec3,
  out: SemanticEntity[],
): void {
  const respawn = respawnSeconds(cluster.tier);
  const interaction = gatherInteraction(cluster.archetype);

  for (let index = 0; index < cluster.count; index += 1) {
    const spot = spiralSpot(cluster.centre, cluster.radius, index, cluster.count, rng);
    const position = place(spot);
    const id = `${cluster.id}_${index + 1}`;

    if (cluster.archetype === "farm_plot") {
      // Plots are not gather nodes: their lifecycle lives in `state.farming` and advances off the
      // wall clock so a crop planted before a reload keeps growing (PRD 2.9). No `resource` block.
      out.push({
        id,
        archetype: "farm_plot",
        name: cluster.name,
        tier: cluster.tier,
        regionId,
        position,
        state: "empty",
        requirements: { farming: cluster.reqLevel },
        interactions: ["inspect", "rake", "plant", "harvest"],
        view: {
          assetId: cluster.assetId,
          depletedAssetId: cluster.depletedAssetId,
          scale: cluster.scale,
          rotationY: round2(rng.float(0, Math.PI * 2)),
          materialTier: cluster.tier,
          labelHeight: 1.2,
        },
        meta: { plotId: id, cropItemId: cluster.itemId, clusterId: cluster.id, locationId: cluster.locationId },
      });
      continue;
    }

    const maxYields = rollYield(rng, cluster.tier);
    const requirements: Partial<Record<SkillId, number>> = {};
    requirements[cluster.skill] = cluster.reqLevel;

    out.push({
      id,
      archetype: cluster.archetype,
      name: cluster.name,
      tier: cluster.tier,
      regionId,
      position,
      state: "available",
      requirements,
      interactions: ["inspect", interaction],
      resource: {
        remaining: maxYields,
        maxYields,
        respawnSeconds: respawn,
        itemId: cluster.itemId,
      },
      view: {
        assetId: cluster.assetId,
        depletedAssetId: cluster.depletedAssetId,
        scale: cluster.scale,
        rotationY: round2(rng.float(0, Math.PI * 2)),
        // Ore has no dedicated mesh, so tier is carried entirely by the material tint. Trees and
        // fishing spots set it too, so `render/materials.ts` has one rule and no special cases.
        materialTier: cluster.tier,
        labelHeight: labelHeightFor(cluster.archetype),
      },
      meta: { clusterId: cluster.id, locationId: cluster.locationId, skill: cluster.skill },
    });
  }
}

function buildEnemyGroup(
  regionId: RegionId,
  group: EnemyGroupDef,
  rng: Rng,
  place: (spot: Spot) => Vec3,
  out: SemanticEntity[],
): void {
  // One lookup per group. `content/enemies.ts` publishes alias rows keyed by group id and by
  // family, so either spelling resolves.
  const enemyBlock = content.enemy(group.id) ?? content.enemy(enemyIdFor(group.family, group.tier));

  for (let index = 0; index < group.count; index += 1) {
    const spot = group.radius <= 0
      ? group.centre
      : spiralSpot(group.centre, group.radius, index, group.count, rng);
    const position = place(spot);
    out.push({
      id: group.count === 1 ? group.id : `${group.id}_${index + 1}`,
      archetype: group.boss ? "boss" : "enemy",
      name: group.name,
      tier: group.tier,
      regionId,
      position,
      state: "alive",
      interactions: ["inspect", "attack", "cast"],
      // Stats come from `content/enemies.ts`, which solves them backwards from the PRD's
      // time-to-kill rows. `regions.ts` carried its own maxHealth as a placement hint from before
      // that table existed; where the two disagree the derived block wins, or the balance work is
      // silently discarded. A Rill Skitterling read 18 HP here against the content table's 6.
      combat: {
        health: enemyBlock?.maxHealth ?? group.maxHealth,
        maxHealth: enemyBlock?.maxHealth ?? group.maxHealth,
        level: group.level,
        aggroRadius: enemyBlock?.aggroRadius ?? group.aggroRadius,
      },
      view: {
        assetId: group.assetId,
        scale: group.scale,
        rotationY: round2(rng.float(0, Math.PI * 2)),
        materialTier: group.tier,
        labelHeight: group.boss ? 3.4 : 2.2,
      },
      meta: {
        family: group.family,
        groupId: group.id,
        behaviour: group.behaviour,
        spawnX: round2(position[0]),
        spawnZ: round2(position[2]),
      },
    });
  }
}

function buildObstacle(
  regionId: RegionId,
  tier: number,
  obstacle: ObstacleDef,
  placeEntrance: (spot: Spot) => Vec3,
  placeExit: (spot: Spot) => Vec3,
): SemanticEntity {
  return {
    id: obstacle.id,
    archetype: "obstacle",
    name: obstacle.name,
    tier,
    regionId,
    position: placeEntrance(obstacle.position),
    state: "available",
    requirements: { agility: obstacle.reqLevel },
    interactions: ["inspect", obstacle.interaction],
    obstacle: {
      reqLevel: obstacle.reqLevel,
      exitPosition: placeExit(obstacle.exitPosition),
      durationMs: obstacle.durationMs,
      savesMeters: obstacle.savesMeters,
    },
    view: {
      assetId: obstacle.assetId,
      scale: obstacle.scale,
      rotationY: obstacle.rotationY,
      labelHeight: 2.6,
    },
    meta: {
      fromLocationId: obstacle.fromLocationId,
      toLocationId: obstacle.toLocationId,
      oneWay: obstacle.oneWay === true,
    },
  };
}

// ------------------------------------------------------------------ helpers

function gatherInteraction(archetype: ResourceClusterDef["archetype"]): InteractionId {
  switch (archetype) {
    case "ore": return "mine";
    case "tree": return "chop";
    case "fishing_spot": return "fish";
    default: return "harvest";
  }
}

function labelHeightFor(archetype: ResourceClusterDef["archetype"]): number {
  switch (archetype) {
    case "tree": return 6.5;
    case "ore": return 2.6;
    default: return 1.4;
  }
}

/**
 * Golden-angle spiral plus a small seeded wobble. Two properties matter: nodes never stack on top
 * of each other (which a pure random scatter does often enough to look broken at 5 nodes), and the
 * layout is reproducible from the seed.
 */
function spiralSpot(centre: Spot, radius: number, index: number, count: number, rng: Rng): Spot {
  const goldenAngle = 2.399963229728653;
  const angle = index * goldenAngle + rng.float(-0.22, 0.22);
  const spread = Math.sqrt((index + 0.5) / Math.max(1, count));
  const distance = radius * spread * rng.float(0.82, 1.0);
  return [
    round2(centre[0] + Math.cos(angle) * distance),
    round2(centre[1] + Math.sin(angle) * distance),
  ];
}

function spotToVec3(spot: Spot, heightAt: HeightAt, regionId: RegionId): Vec3 {
  return [spot[0], round2(heightAt(regionId, spot[0], spot[1])), spot[1]];
}

function distance3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distanceXZSpot(a: Spot, b: Spot): number {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return Math.sqrt(dx * dx + dz * dz);
}

/** Two decimals everywhere, so the built world serialises identically across runs. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Four decimals for scales and rotations, where two would visibly shift a 2 m module. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * `render/entityViews.ts` multiplies every `view.scale` by `tierSilhouetteScale(materialTier)`.
 * That rule exists to make an ore tier readable at 12 m; it has no business resizing architecture,
 * and it breaks the modular kit outright - the same 2 m wall would be 1.8 m in Fallowmarch and
 * 2.3 m in Karrowmoor, so nothing would meet and no composition would line up with the mesh it is
 * built around.
 *
 * Landmarks, gates, the dungeon mouth and every assembled building therefore cancel it, and their
 * authored `scale` means true metres. Resource nodes and enemies keep the tier rule.
 */
function trueScale(authored: number | undefined, tier: number): number {
  return round4((authored ?? 1) / tierSilhouetteScale(tier));
}

/** The bank's route node id differs per settlement; this keeps the mapping in one place. */
function bankLocationId(region: RegionDef): string {
  switch (region.id) {
    case "fallowmarch": return "bank_interior";
    case "vellenwood": return "rootfall_bank";
    default: return "highcairn_bank";
  }
}
