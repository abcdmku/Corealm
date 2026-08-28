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
 * Walls, paving, props and every solid volume emitted here draw ZERO numbers from that stream -
 * they are pure functions of the authored data plus `variantSeed(id)`, which is an FNV hash of the
 * id. That is deliberate: it means the whole settlement-dressing feature could be added in the
 * middle of the build without reshuffling a single later roll, and the seeded world diffed clean.
 *
 * The root supplies `heightAt`, so terrain stays owned by exactly one layer and no entity can end
 * up floating because two files disagreed about the ground. It also supplies `baseY` and
 * `assetSize` through `WorldPorts` for the same reason: the manifest is render-layer data and
 * `world/` must not import `render/assets.ts`, so the measurement arrives as a port.
 */
import type {
  Archetype, EntityId, InteractionId, RegionId, SemanticEntity, SkillId, SolidVolume, Vec3,
} from "../contracts.js";
import { INTERACT_RANGE } from "../app/config.js";
import { RngStreams, type Rng } from "../core/rng.js";
import { content } from "../content/index.js";
import { enemyIdFor } from "../content/enemies.js";
import { QUESTS } from "../content/quests.js";
import {
  REGIONS, WALK_SPEED_MPS,
  type BuildingDef, type DungeonDef, type EnemyGroupDef, type LocationDef, type ObstacleDef,
  type PavingDef, type PrefabId, type PropDef, type RegionDef, type ResourceClusterDef,
  type SettlementDef, type Spot, type WallRunDef,
} from "../content/regions.js";
import {
  BUILDING_KITS, GATE_GAP_METRES, MODULE_METRES,
  buildComposition, buildPrefab, buildWallRun, prefabCollision, variantSeed, wallRunCollision,
  type BuildingKit, type CompositionId, type PartPlacement,
} from "../render/buildings.js";
import { tierSilhouetteScale } from "../core/math.js";
import type { KnownLocation } from "./entities.js";

// ------------------------------------------------------------------ formulas

/** Outfit pieces, in draw order. Measured contents of each part GLB, not a guess. */
const PEASANT_PART_SLOTS = ["chest", "legs", "boots", "gloves"] as const;
const RANGER_PART_SLOTS = ["chest", "legs", "boots", "gloves", "hood", "pauldron"] as const;

/**
 * Dresses an NPC: body stays the body, clothes arrive as layered parts.
 *
 * The comment this replaces claimed the Modular Outfits pack ships "complete full-body variants on
 * the same 65-bone skeleton". Both halves are false, and believing them made every NPC in the game
 * headless. Measured by structural dump of the GLBs: `outfit_male_peasant.glb` holds exactly four
 * meshes (Male_Peasant_Arms, _Body, _Feet, _Legs), tops out at y = 1.559 against `base_male`'s
 * 1.810, and carries no Head, Eyes or Eyebrows — 25.1 cm of missing head, and you could see the
 * town wall through the neck (runs/corealm/screenshots/RIG-npc-crop.png). The library also holds
 * FOUR distinct 65-joint rigs, not one, grouped by the sha1 of each file's inverseBindMatrices.
 *
 * So `view.assetId` keeps whatever body `regions.ts` authored — that is the file with the face —
 * and the outfit is returned as `view.partAssetIds` for `render/skinning.ts` to rebind onto the
 * body's own bones. The ranger/peasant choice is byte-for-byte the one this function already made,
 * so no NPC changes clothes.
 */
function outfitPartsFor(npcId: string, baseAssetId: string): string[] {
  const sex = baseAssetId.includes("female") ? "female" : "male";
  const outdoors = /ranger|trapper|woodward|watcher|quarrier|forema|pitmaster/.test(npcId);
  const kind = outdoors ? "ranger" : "peasant";
  const slots = outdoors ? RANGER_PART_SLOTS : PEASANT_PART_SLOTS;
  return slots.map((slot) => `outfit_${sex}_${kind}_${slot}`);
}

/** Every quest a given NPC hands out, derived from the quest table rather than duplicated. */
function questIdsForNpc(npcId: string): string[] {
  return QUESTS.filter((quest) => quest.giverNpcId === npcId).map((quest) => quest.id);
}

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
 * A solid mass a building occupies, in world space.
 *
 * Superseded by `BuiltWorld.solids`, which covers every solid thing in the world rather than only
 * the 36 authored buildings, and which measures its base off the ground instead of its centre.
 * This shape stays exactly as it is because `app/boot.ts` steps 8b and 9 still read it; the two
 * lists describe the same 39 building boxes, so wiring `solids` means dropping this one, not
 * merging them.
 *
 * Buildings HAVE been solid since round 4 — a TODO here claimed otherwise until Phase 2, which is
 * why the next reader kept looking for the missing wiring. `rotationY` is about the box centre;
 * `halfExtents` is [x, y, z] in the building's own frame.
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
  /**
   * Every volume the player must not walk into, in the frozen `SolidVolume` shape.
   *
   * Measured before this existed: the whole world had 40 colliders (one terrain heightfield plus
   * 39 building boxes) against 892 semantic entities, so the player walked through the bank chest,
   * the anvil, both market stalls, a resource tree and an ore rock. This list is a superset of
   * `buildings` — it repeats those 39 as boxes with a base-relative `y` — so a consumer takes one
   * or the other, never both.
   */
  solids: SolidVolume[];
}

export type HeightAt = (regionId: RegionId, x: number, z: number) => number;

/** The manifest bbox of one asset, in metres. Mirrors `AssetRegistry.assetSize`'s return. */
export interface AssetSize {
  x: number;
  y: number;
  z: number;
}

/**
 * Measurements the world layer needs and is not allowed to go and read for itself.
 *
 * `world/` must not import `render/assets.ts` (R6: render is a view of state, not a dependency of
 * it), and the manifest lives there. Everything here is therefore injected by `app/boot.ts` in the
 * same way `heightAt` already is. All of it is OPTIONAL: with no ports at all this function
 * reproduces Phase 1's placement exactly, which is what keeps `boot.ts` compiling unchanged while
 * the wiring pass lands.
 */
export interface WorldPorts {
  heightAt: (regionId: RegionId, x: number, z: number) => number;
  /** Manifest bbox min.y for an asset, so nothing is placed by its origin. `AssetRegistry.baseY`. */
  baseY?: (assetId: string) => number;
  /**
   * Manifest bbox extents, so a solid volume is the size of the mesh it wraps.
   * `AssetRegistry.assetSize`. Without it no per-entity solid can be sized and only the building
   * boxes (whose size comes from the authored footprint) are emitted.
   */
  assetSize?: (assetId: string) => AssetSize | null;
}

// ------------------------------------------------------------------- build

/**
 * `heightAt` stays the second positional parameter, and `ports.heightAt` is ignored in favour of
 * it: the frozen `WorldPorts` shape requires the field, but `boot.ts` already passes the closure
 * positionally and two sources for one number is how layers end up disagreeing about the ground.
 */
export function buildWorld(seed: number, heightAt: HeightAt, ports?: WorldPorts): BuiltWorld {
  const rng = new RngStreams(seed).get("world");

  const entities: SemanticEntity[] = [];
  const routeNodes: RouteNodeOut[] = [];
  const knownLocations: KnownLocation[] = [];
  const edges: RouteEdgeOut[] = [];
  const buildings: BuildingBox[] = [];
  const solids: SolidVolume[] = [];
  const ctx: BuildContext = {
    heightAt,
    baseY: ports?.baseY ?? (() => 0),
    assetSize: ports?.assetSize ?? (() => null),
    out: entities,
    buildings,
    solids,
    locationEntity: new Map<string, EntityId>(),
  };

  /** locationId -> resolved world position, so edge costs use the same Y the player walks on. */
  const nodePositions = new Map<string, Vec3>();
  /** locationId -> the entity that stands there, if any. Lets `scope: "known"` report live state. */
  const locationEntity = ctx.locationEntity;

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
    buildRegionEntities(region, rng, ctx);
  }
  for (const region of REGIONS) {
    const dungeon = region.dungeon;
    if (dungeon) buildDungeonEntities(region, dungeon, rng, ctx);
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

  return { entities, routeNodes, routeEdges: edges, knownLocations, buildings, solids };
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

// -------------------------------------------------- grounding and placement

/**
 * Everything one build of the world writes into, plus the measurements it is allowed to ask for.
 *
 * Passed by reference rather than returned because a region emits into five lists at once and
 * threading five out-params through eight functions is how the last two got forgotten.
 */
interface BuildContext {
  readonly heightAt: HeightAt;
  /** Falls back to 0 with no port, which reproduces Phase 1's origin-at-ground placement exactly. */
  readonly baseY: (assetId: string) => number;
  /** Falls back to null with no port, which emits no per-entity solids at all. */
  readonly assetSize: (assetId: string) => AssetSize | null;
  readonly out: SemanticEntity[];
  readonly buildings: BuildingBox[];
  readonly solids: SolidVolume[];
  readonly locationEntity: Map<string, EntityId>;
}

/** Resolves a 2-D authored spot to a world position with the asset's bbox floor on the ground. */
type Placer = (spot: Spot, assetId: string, scale: number) => Vec3;

/**
 * Archetypes `render/entityViews.ts` applies `tierSilhouetteScale` to. Mirrors its own
 * `TIERED_ARCHETYPES` set.
 *
 * Mirrored rather than imported because it is a render-layer look decision, and mirrored at all
 * because grounding is only correct against the scale the entity is actually DRAWN at: the visible
 * gap is `base.y x drawnScale`, verified to 3 decimals across 159 surface entities. Get this set
 * wrong for one archetype and that archetype floats by 10-15% of its own base offset, because
 * `tierSilhouetteScale` runs 0.90 at tier 1 to 1.15 at tier 10.
 */
const TIERED_ARCHETYPES = new Set<Archetype>([
  "ore", "tree", "fishing_spot", "farm_plot", "enemy", "boss",
]);

/** The scale an entity is drawn at, which is not always the scale written into `view.scale`. */
function drawnScale(archetype: Archetype, viewScale: number | undefined, tier: number): number {
  const silhouette = TIERED_ARCHETYPES.has(archetype) ? tierSilhouetteScale(tier) : 1;
  return (viewScale ?? 1) * silhouette;
}

/**
 * Puts the asset's own bounding-box floor on the terrain instead of its origin.
 *
 * The defect this replaces: `spotToVec3` returned `heightAt(...)` flat, so every entity in the
 * world floated or sank by exactly `glbBBoxMinY x drawnScale`. Measured across 159 surface
 * entities: ore median -0.274 m, tree median -0.254 m, all 10 farm plots fully underground, the
 * Fallen Duskoak (`roof_log`, `base.y` +3.849, scale 1.5) hovering 5.774 m, and the Coldbrace
 * fletching bench (`workbench_drawers`, `base.y` +0.884, scale 1.6) hovering 1.411 m at chest
 * height. 119 of 213 manifest assets have |base.y| over 2 cm.
 *
 * NOT used for prefab or composition parts. Those are authored in the asset's own frame and
 * already measure correct - `wall_bottom_trim`'s -0.117 m sink is the trim doing its job, and
 * `wood_pile`'s `roof_log` dy cancels that asset's own +3.849 pivot on purpose.
 */
function placeOnGround(
  ctx: BuildContext,
  regionId: RegionId,
  spot: Spot,
  assetId: string,
  scale: number,
): Vec3 {
  const y = ctx.heightAt(regionId, spot[0], spot[1]) - ctx.baseY(assetId) * scale;
  return [spot[0], round2(y), spot[1]];
}

/** Metres either side of the sample point for the terrain central difference. */
const NORMAL_SAMPLE_METRES = 1;
/** tan(20 deg). Past this a tree lies down the hill, which reads worse than one standing plumb. */
const MAX_TILT_TAN = 0.36397;
/** tan(2 deg). Below this the gradient is mesh interpolation noise, so no normal is emitted. */
const MIN_TILT_TAN = 0.03492;

/**
 * Unit terrain normal from a central difference on the same `heightAt` port that places the
 * entity, clamped to 20 degrees off vertical.
 *
 * Sampled at +-1 m, half the 2 m lattice the terrain mesh is tessellated from, so it measures the
 * facet the entity actually stands on rather than a sub-facet slope that does not exist.
 *
 * Returns undefined on ground flatter than 2 degrees. Not an optimisation: measured over the 76
 * tilt-eligible entities against the terrain field as it stands, 37 are on ground under 2 degrees,
 * 21 on 2-10, 11 on 10-20 and 7 over 20, so half the field would otherwise carry a no-op normal
 * into every seeded state diff the harness takes. (The split moves when `render/scene.ts` re-cuts
 * the field; the 2-degree floor is what makes it not matter.)
 */
function groundNormalAt(
  heightAt: HeightAt,
  regionId: RegionId,
  x: number,
  z: number,
): readonly [number, number, number] | undefined {
  const e = NORMAL_SAMPLE_METRES;
  const dhdx = (heightAt(regionId, x + e, z) - heightAt(regionId, x - e, z)) / (2 * e);
  const dhdz = (heightAt(regionId, x, z + e) - heightAt(regionId, x, z - e)) / (2 * e);
  const slope = Math.hypot(dhdx, dhdz);
  if (!Number.isFinite(slope) || slope < MIN_TILT_TAN) return undefined;
  const limit = slope > MAX_TILT_TAN ? MAX_TILT_TAN / slope : 1;
  const nx = -dhdx * limit;
  const nz = -dhdz * limit;
  const length = Math.hypot(nx, 1, nz);
  return [round4(nx / length), round4(1 / length), round4(nz / length)];
}

/**
 * How much of the terrain normal each archetype takes, 0..1.
 *
 * A look decision with a measurement behind it: 34 of 159 surface entities stand on ground steeper
 * than 10 degrees, worst case `lower_quarry_kaldite_3` - a 5.3 m ore rock on a 48.9-degree slope
 * with 3.02 m of daylight under one edge. A rock wants to bed into the hill almost fully; a 7 m
 * tree does not, because a leaning tree reads as a felled tree. Buildings, NPCs and enemies are
 * absent on purpose: buildings are level by construction (that is what the flat pads are for) and
 * anything that moves gets its orientation from `systems/`, not from where it spawned.
 */
const TILT_STRENGTH: Partial<Record<Archetype, number>> = {
  ore: 0.85,
  tree: 0.12,
  fishing_spot: 1,
  obstacle: 0.5,
  landmark: 0.25,
};

/** Writes a normal onto an already-built entity without disturbing the rest of its view. */
function tiltView(
  entity: SemanticEntity,
  normal: readonly [number, number, number] | undefined,
  strength: number | undefined,
): void {
  if (!normal || !entity.view) return;
  entity.view = { ...entity.view, groundNormal: normal, tiltStrength: strength };
}

// ------------------------------------------------------------------ solids

/**
 * Largest half-diagonal (box) or radius (cylinder) a solid may have and still leave its own entity
 * reachable.
 *
 * `gameApi.interact` measures the gap to the entity's CENTRE against `INTERACT_RANGE` = 2.4 m, so
 * everything between the centre and the nearest place the player can stand comes out of that
 * 2.4 m: the navmesh carve (`NAV_CONFIG.walkableRadius` is 1 VOXEL, 0.45 m at the world's
 * large-world cell size), `PLAYER_RADIUS` 0.35 m, and the arrival tolerance. `APPROACH_CLEARANCE`
 * budgets 1 m for all three, which leaves 1.4 m.
 *
 * Seven gate-check lines depend on that reach, which is why this is a hard cap applied to every
 * volume wrapping something interactive rather than a warning.
 */
const APPROACH_CLEARANCE_METRES = 1;
const SOLID_REACH_METRES = Math.max(0.4, INTERACT_RANGE - APPROACH_CLEARANCE_METRES);

/**
 * Smallest footprint worth a collider, in m2.
 *
 * Below this the volume costs more than it buys: a `torch` is 0.223 x 0.388 = 0.086 m2, a banner
 * less, and a player who cannot walk past a torch in a 3 m dungeon corridor is worse off than one
 * who walks through it. A kit wall panel at 2.000 x 0.406 = 0.81 m2 clears it five times over.
 */
const SOLID_MIN_FOOTPRINT_AREA = 0.15;

/** Composition parts nearer than this to their owner's origin are where the hero mesh already is. */
const COMPOSITION_CLEARANCE_METRES = 1;

/**
 * Fraction of a tree's mean CANOPY radius used as its collider radius.
 *
 * Chosen, not measured: the manifest carries the whole-mesh bbox and nothing that isolates a
 * trunk. 0.18 puts `tree_common_1` (4.311 x 4.578 m of leaves) on a 0.40 m radius, which is
 * trunk-sized. See `pushClusterSolid` for why the canopy radius itself is unusable.
 */
const TREE_TRUNK_FRACTION = 0.18;

/** Paving and plot beds sit 2 cm proud of the ground; the assets are 2 cm thick slabs. */
const PAVING_LIFT_METRES = 0.02;

/**
 * The empty-plot bed. Both assets shipped in the manifest and were used by nothing.
 * `floor_brick` is exactly 2.00 x 0.02 x 2.00 m (one module); `fence_wood_single` is 2.064 m long,
 * so the rails overlap their neighbours by 3 cm at the corners rather than leaving a gap.
 */
const PLOT_BED_ASSET = "floor_brick";
const PLOT_RAIL_ASSET = "fence_wood_single";

/** Building collision, in both the legacy `BuildingBox` shape and the frozen `SolidVolume` one. */
function emitBuildingCollision(
  ctx: BuildContext,
  building: BuildingDef,
  origin: Vec3,
  regionId: RegionId,
): void {
  const cos = Math.cos(building.rotationY);
  const sin = Math.sin(building.rotationY);
  for (const box of prefabCollision(building.prefab, building.footprint)) {
    const x = round2(origin[0] + box.dx * cos + box.dz * sin);
    const z = round2(origin[2] - box.dx * sin + box.dz * cos);
    ctx.buildings.push({
      id: `${building.id}#${box.tag}`,
      buildingId: building.id,
      name: building.name,
      regionId,
      prefab: building.prefab,
      position: [x, round2(origin[1] + box.height / 2), z],
      halfExtents: [round2(box.sizeX / 2), round2(box.height / 2), round2(box.sizeZ / 2)],
      rotationY: building.rotationY,
    });
    // Uncapped, and it must stay that way: a building carries no interaction of its own, and a
    // 12 m hall clipped to a 2.8 m box is a hall the player walks into.
    ctx.solids.push({
      kind: "box",
      id: `${building.id}#${box.tag}`,
      position: [x, origin[1], z],
      size: [round2(box.sizeX), round2(box.height), round2(box.sizeZ)],
      rotationY: round4(building.rotationY),
    });
  }
}

/**
 * A box volume the size of the asset's own manifest bbox.
 *
 * The box is centred on the entity's XZ, which assumes the mesh is centred on its own origin in XZ
 * as well. Measured on the assets this is used for, that holds to a few centimetres
 * (`chest_wood` base.x -0.638 of a 1.276 m width, `anvil` -0.479 of 1.082); the exceptions are
 * `market_stall_cart` (-2.107 of 3.021) and `workbench_drawers`, and neither is worth a second
 * port to correct for. `position.y` is the BASE, per `SolidVolume`.
 */
function pushAssetSolid(
  ctx: BuildContext,
  id: string,
  position: Vec3,
  assetId: string,
  scale: number,
  rotationY: number,
  capped: boolean,
): void {
  const size = ctx.assetSize(assetId);
  if (!size) return;
  let sizeX = size.x * scale;
  let sizeZ = size.z * scale;
  if (sizeX * sizeZ < SOLID_MIN_FOOTPRINT_AREA) return;
  if (capped) {
    const factor = capFactor(Math.hypot(sizeX / 2, sizeZ / 2));
    sizeX *= factor;
    sizeZ *= factor;
  }
  ctx.solids.push({
    kind: "box",
    id,
    position,
    size: [round2(sizeX), round2(Math.max(0.3, size.y * scale)), round2(sizeZ)],
    rotationY: round4(rotationY),
  });
}

/**
 * A gate is two piers with a hole between them, so it gets two piers and a hole.
 *
 * A single box across an arch seals the region border, which is the one thing a gate must never
 * do. When the arch is narrower than `GATE_GAP_METRES` there is no pier left to build and the gate
 * stays open: `wall_arch` is 2.00 m wide and draws at 2.8 m against a 4 m gap, so all three
 * region gates in the game correctly get no volume at all and the composition around them - the
 * wall pieces either side - is what stops the player walking round the arch.
 */
function pushGateSolids(
  ctx: BuildContext,
  id: string,
  position: Vec3,
  assetId: string,
  scale: number,
  rotationY: number,
): void {
  const size = ctx.assetSize(assetId);
  if (!size) return;
  const width = size.x * scale;
  const pier = (width - GATE_GAP_METRES) / 2;
  if (pier <= 0.2) return;
  const depth = Math.max(0.4, size.z * scale);
  const height = Math.max(0.3, size.y * scale);
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  for (const side of [-1, 1] as const) {
    const dx = side * (width - pier) / 2;
    ctx.solids.push({
      kind: "box",
      id: `${id}#pier_${side < 0 ? "l" : "r"}`,
      position: [round2(position[0] + dx * cos), position[1], round2(position[2] - dx * sin)],
      size: [round2(pier), round2(height), round2(depth)],
      rotationY: round4(rotationY),
    });
  }
}

/**
 * A cylinder for a resource node, because rocks and trees are round and a box would leave corners
 * of invisible air the player bounces off.
 *
 * Trees are collided as their TRUNK, not their canopy. `tree_common_1`'s manifest footprint is
 * 4.31 x 4.58 m, nearly all of it leaves; a 2.22 m radius from that would push the nearest
 * standable point past `INTERACT_RANGE` = 2.4 m from the trunk and make the tree unchoppable, on
 * top of reading as a 4 m disc of invisible air. `TREE_TRUNK_FRACTION` takes it to 0.40 m.
 *
 * Fishing spots and farm plots get nothing: the player stands in them.
 */
function pushClusterSolid(
  ctx: BuildContext,
  id: string,
  position: Vec3,
  cluster: ResourceClusterDef,
  scale: number,
): void {
  if (cluster.archetype !== "tree" && cluster.archetype !== "ore") return;
  const size = ctx.assetSize(cluster.assetId);
  if (!size) return;
  const footprintRadius = (size.x + size.z) * 0.25 * scale;
  const radius = cluster.archetype === "tree"
    ? Math.min(0.9, Math.max(0.3, footprintRadius * TREE_TRUNK_FRACTION))
    : Math.max(0.35, footprintRadius * 0.8);
  if (radius < 0.2) return;
  ctx.solids.push({
    kind: "cylinder",
    id,
    position,
    radius: round2(Math.min(radius, SOLID_REACH_METRES)),
    height: round2(Math.max(0.3, size.y * scale)),
  });
}

/** 1 when the volume already fits inside the interaction reach, otherwise the shrink that makes it. */
function capFactor(halfDiagonal: number): number {
  return halfDiagonal <= SOLID_REACH_METRES ? 1 : SOLID_REACH_METRES / halfDiagonal;
}

// -------------------------------------------------------- entity construction

function buildRegionEntities(region: RegionDef, rng: Rng, ctx: BuildContext): void {
  const regionId = region.id;
  const tier = region.tier;
  /** Terrain height only. For a building origin, a route point, or a shortcut's exit. */
  const ground = (spot: Spot): Vec3 => spotToVec3(spot, ctx.heightAt, regionId);
  /** Terrain height with the asset's own bbox floor put on it. See `placeOnGround`. */
  const place: Placer = (spot, assetId, scale) =>
    placeOnGround(ctx, regionId, spot, assetId, scale);
  const normal = (spot: Spot): readonly [number, number, number] | undefined =>
    groundNormalAt(ctx.heightAt, regionId, spot[0], spot[1]);

  for (const cluster of region.clusters) {
    buildCluster(regionId, cluster, rng, place, normal, ctx);
  }

  const settlement = region.settlement;
  const kit = BUILDING_KITS[settlement.kit];

  // Buildings. Round-1 critique finding 1: `settlement.buildings` was authored and never read, so
  // 37 buildings across three settlements rendered as nothing at all. Each one is now assembled by
  // `render/buildings.ts` into 2 m modules and emitted as one instanced part per piece: the render
  // path already batches by (assetId, tier), so a whole street of cottages is a dozen draw calls.
  for (const building of settlement.buildings) {
    const origin = ground(building.position);
    const seed = variantSeed(building.id);
    emitParts(
      buildPrefab(building.prefab, building.footprint, seed, settlement.kit),
      origin, building.rotationY, regionId, tier,
      building.id, building.name,
      { buildingId: building.id, prefab: building.prefab, settlementId: settlement.id, scenery: true },
      ctx.out,
    );
    emitBuildingCollision(ctx, building, origin, regionId);
  }

  // Walls, paving and props. All three are new content vocabulary (`content/regions.ts`) and no
  // settlement authors any of it yet, so all three loops are no-ops on today's data - which is
  // exactly what makes them safe to land a wave ahead of the layouts they exist for.
  for (const run of settlement.walls ?? []) {
    emitWallRun(ctx, regionId, tier, settlement, run, kit, ground);
  }
  for (const paving of settlement.paving ?? []) {
    emitPaving(ctx, regionId, tier, settlement, paving);
  }
  for (const prop of settlement.props ?? []) {
    emitProp(ctx, regionId, tier, settlement, prop, place);
  }

  const bankScale = drawnScale("bank", undefined, tier);
  const bankPosition = place(settlement.bank.position, settlement.bank.assetId, bankScale);
  ctx.out.push({
    id: settlement.bank.id,
    archetype: "bank",
    name: settlement.bank.name,
    tier,
    regionId,
    position: bankPosition,
    state: "open",
    interactions: ["inspect", "bank"],
    view: {
      assetId: settlement.bank.assetId,
      rotationY: settlement.bank.rotationY,
      labelHeight: 1.4,
    },
    meta: { settlementId: settlement.id },
  });
  pushAssetSolid(ctx, settlement.bank.id, bankPosition, settlement.bank.assetId, bankScale,
    settlement.bank.rotationY, true);
  ctx.locationEntity.set(bankLocationId(region), settlement.bank.id);

  for (const shop of settlement.shops) {
    const scale = drawnScale("shop", undefined, tier);
    const position = place(shop.position, shop.assetId, scale);
    ctx.out.push({
      id: shop.id,
      archetype: "shop",
      name: shop.name,
      tier,
      regionId,
      position,
      state: "open",
      interactions: ["inspect", "trade"],
      view: { assetId: shop.assetId, rotationY: shop.rotationY, labelHeight: 3 },
      meta: { shopKind: shop.shopKind, settlementId: settlement.id },
    });
    pushAssetSolid(ctx, shop.id, position, shop.assetId, scale, shop.rotationY, true);
  }

  for (const station of settlement.stations) {
    const scale = drawnScale("station", station.scale, tier);
    const position = place(station.position, station.assetId, scale);
    ctx.out.push({
      id: station.id,
      archetype: "station",
      name: station.name,
      tier,
      regionId,
      position,
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
    pushAssetSolid(ctx, station.id, position, station.assetId, scale, station.rotationY, true);
  }

  for (const npc of settlement.npcs) {
    ctx.out.push({
      id: npc.id,
      archetype: "npc",
      name: npc.name,
      tier,
      regionId,
      // NPCs move, so `systems/` handles them as circles. No solid volume here on purpose.
      position: place(npc.position, npc.assetId, drawnScale("npc", undefined, tier)),
      state: "idle",
      interactions: ["inspect", "talk"],
      // `regions.ts` authors questIds as [] because the quest table did not exist when the NPC
      // stands were placed. Backfilling here keeps one source of truth (the quests) and closes a
      // real discoverability hole: an agent looking for quest givers reads `npc.questIds`.
      npc: {
        dialogueRootId: npc.dialogueRootId,
        questIds: npc.questIds.length > 0 ? npc.questIds : questIdsForNpc(npc.id),
      },
      view: {
        assetId: npc.assetId,
        partAssetIds: outfitPartsFor(npc.id, npc.assetId),
        rotationY: npc.facingRad,
        labelHeight: 2.2,
      },
      meta: { settlementId: settlement.id },
    });
  }

  for (const obstacle of region.obstacles) {
    const scale = drawnScale("obstacle", obstacle.scale, tier);
    const entity = buildObstacle(
      regionId, tier, obstacle,
      (spot) => place(spot, obstacle.assetId, scale),
      ground,
    );
    tiltView(entity, normal(obstacle.position), TILT_STRENGTH.obstacle);
    ctx.out.push(entity);
    pushAssetSolid(ctx, obstacle.id, entity.position, obstacle.assetId, scale,
      obstacle.rotationY ?? 0, true);
  }

  for (const group of region.enemyGroups) {
    buildEnemyGroup(regionId, group, rng, place, ctx.out);
  }

  for (const landmark of region.landmarks) {
    // The composition is authored around the terrain point, in the hero asset's own frame; only
    // the hero mesh moves when its bbox floor is put on the ground.
    const origin = ground(landmark.position);
    const scale = drawnScale("landmark", trueScale(landmark.scale, tier), tier);
    const position = place(landmark.position, landmark.assetId, scale);
    ctx.out.push({
      id: landmark.id,
      archetype: "landmark",
      name: landmark.name,
      tier,
      regionId,
      position,
      state: "present",
      interactions: ["inspect"],
      view: {
        assetId: landmark.assetId,
        scale: trueScale(landmark.scale, tier),
        rotationY: landmark.rotationY,
        clipFraction: landmark.clipFraction,
        labelHeight: 4,
        groundNormal: normal(landmark.position),
        tiltStrength: TILT_STRENGTH.landmark,
      },
      meta: { blurb: landmark.blurb },
    });
    // A landmark clipped to a fraction of its own height is a stump, not a mass; sizing a collider
    // off the uncut bbox would wall off a 7 m circle around a 2 m stub.
    if (landmark.clipFraction === undefined) {
      pushAssetSolid(ctx, landmark.id, position, landmark.assetId, scale, landmark.rotationY ?? 0, true);
    }
    ctx.locationEntity.set(landmark.id, landmark.id);
    // Finding 8: a landmark drawn as one stand-in prop is not a silhouette. The hero mesh above is
    // still the clickable, inspectable entity; these parts are what the player navigates by.
    emitComposition(
      landmark.composition, origin, landmark.rotationY ?? 0, regionId, tier,
      landmark.id, landmark.name, { blurb: landmark.blurb, scenery: true }, ctx.out, ctx,
    );
  }

  for (const gate of region.gates) {
    const origin = ground(gate.position);
    const scale = drawnScale("portal", trueScale(1.4, tier), tier);
    const position = place(gate.position, gate.assetId, scale);
    ctx.out.push({
      id: gate.id,
      archetype: "portal",
      name: gate.name,
      tier,
      regionId,
      position,
      state: "open",
      interactions: ["inspect", "enter"],
      view: {
        assetId: gate.assetId,
        rotationY: gate.rotationY,
        scale: trueScale(1.4, tier),
        labelHeight: 3.4,
      },
      meta: { toRegionId: gate.toRegionId, toLocationId: gate.toLocationId },
    });
    pushGateSolids(ctx, gate.id, position, gate.assetId, scale, gate.rotationY ?? 0);
    ctx.locationEntity.set(gate.id, gate.id);
    emitComposition(
      gate.composition, origin, gate.rotationY ?? 0, regionId, tier,
      gate.id, gate.name, { toRegionId: gate.toRegionId, scenery: true }, ctx.out, ctx,
    );
  }
}

// ------------------------------------------------------- settlement dressing

/**
 * One straight run of town wall.
 *
 * Measured on the Phase 1 data, which had no way to author this at all: Coldbrace stood 44 m of
 * wall on a 212 m circuit (79% open, largest single gap 46 m, all four corners missing), Highcairn
 * 30 m of 139 m, and Rootfall none. The player's words were "a random gate without a wall".
 *
 * `yaw` is the value that maps a part's LOCAL +X onto the run direction under the transform
 * `emitParts` applies, which is why it negates the z delta. The origin is the ground at `from`, so
 * a run crossing a slope stays level for the same reason a building does - a sheared wall reads
 * far worse than one standing on a plinth.
 */
function emitWallRun(
  ctx: BuildContext,
  regionId: RegionId,
  tier: number,
  settlement: SettlementDef,
  run: WallRunDef,
  kit: BuildingKit,
  ground: (spot: Spot) => Vec3,
): void {
  const length = distanceXZSpot(run.from, run.to);
  if (length < MODULE_METRES) return;
  const yaw = Math.atan2(-(run.to[1] - run.from[1]), run.to[0] - run.from[0]);
  const origin = ground(run.from);
  const openings = run.openings ?? [];

  emitParts(
    buildWallRun(length, openings, kit, variantSeed(run.id)),
    origin, yaw, regionId, tier, run.id, run.name,
    { settlementId: settlement.id, wallRunId: run.id, scenery: true },
    ctx.out,
  );

  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (const box of wallRunCollision(length, openings)) {
    ctx.solids.push({
      kind: "box",
      id: `${run.id}#${box.tag}`,
      position: [
        round2(origin[0] + box.dx * cos + box.dz * sin),
        origin[1],
        round2(origin[2] - box.dx * sin + box.dz * cos),
      ],
      size: [round2(box.sizeX), round2(box.height), round2(box.sizeZ)],
      rotationY: round4(yaw),
    });
  }
}

/**
 * Tiles a paving rect on the same 2 m module grid the buildings stand on.
 *
 * The four legal assets all measure exactly 2.00 x 0.02 x 2.00 m with the origin at the slab's
 * centre (manifest `base.y` -0.01), so a tile placed at ground + 0.02 stands 1 cm proud and needs
 * no per-asset correction - which is why this is the one placement in the file that does NOT go
 * through `placeOnGround`.
 *
 * Only whole tiles that fit inside the rect are laid, so a 20 x 16 m square is exactly 80 tiles.
 * Cost is one instanced group per (assetId, tier): a whole square is one draw call, and the kerb
 * adds two more.
 */
function emitPaving(
  ctx: BuildContext,
  regionId: RegionId,
  tier: number,
  settlement: SettlementDef,
  paving: PavingDef,
): void {
  const { minX, minZ, maxX, maxZ } = paving.rect;
  if (!(maxX > minX) || !(maxZ > minZ)) return;
  const meta = { settlementId: settlement.id, pavingId: paving.id, scenery: true };
  const half = MODULE_METRES / 2;
  // Tile centres sit on the half-module lattice anchored at the world origin, so two rects that
  // meet do not produce a seam of half tiles.
  const firstX = Math.ceil((minX - half) / MODULE_METRES) * MODULE_METRES + half;
  const firstZ = Math.ceil((minZ - half) / MODULE_METRES) * MODULE_METRES + half;
  let index = 0;
  for (let cz = firstZ; cz + half <= maxZ + 1e-6; cz += MODULE_METRES) {
    for (let cx = firstX; cx + half <= maxX + 1e-6; cx += MODULE_METRES) {
      ctx.out.push(sceneryEntity(
        `${paving.id}#t${index}`, paving.id, tier, regionId,
        [round2(cx), round2(ctx.heightAt(regionId, cx, cz) + PAVING_LIFT_METRES), round2(cz)],
        paving.assetId, 1, 0, 0.3, meta,
      ));
      index += 1;
    }
  }
  if (!paving.kerb) return;

  // Kerbs ring the rect on the OUTSIDE: `kerb_straight` is 2.00 x 0.134 x 0.70 with its origin
  // centred on the long axis at the near z edge, so a rotation of 0 lays it along +x with its
  // 0.70 m depth pointing to +z. No collision - the player must not trip on a 13 cm lip walking
  // into their own town square.
  let kerbIndex = 0;
  const kerb = (x: number, z: number, rotationY: number, assetId: string): void => {
    ctx.out.push(sceneryEntity(
      `${paving.id}#k${kerbIndex}`, paving.id, tier, regionId,
      [round2(x), round2(ctx.heightAt(regionId, x, z) + PAVING_LIFT_METRES), round2(z)],
      assetId, 1, round4(rotationY), 0.4, meta,
    ));
    kerbIndex += 1;
  };
  for (let cx = firstX; cx + half <= maxX + 1e-6; cx += MODULE_METRES) {
    kerb(cx, maxZ, 0, "kerb_straight");
    kerb(cx, minZ, Math.PI, "kerb_straight");
  }
  for (let cz = firstZ; cz + half <= maxZ + 1e-6; cz += MODULE_METRES) {
    kerb(maxX, cz, Math.PI / 2, "kerb_straight");
    kerb(minX, cz, -Math.PI / 2, "kerb_straight");
  }
  kerb(maxX, maxZ, 0, "kerb_corner");
  kerb(maxX, minZ, Math.PI / 2, "kerb_corner");
  kerb(minX, minZ, Math.PI, "kerb_corner");
  kerb(minX, maxZ, -Math.PI / 2, "kerb_corner");
}

/**
 * One piece of set dressing.
 *
 * `dy` is an offset on top of BASE-ALIGNED ground, not on top of the raw terrain: a `dy` of 0 puts
 * the asset's own bbox floor on the ground whatever its origin is, so a wall lamp is authored at
 * its mounting height and nothing needs to know that `roof_log`'s pivot sits 3.85 m under its own
 * axis. That differs from the note on `PropDef`, which was written before `base.y` existed.
 */
function emitProp(
  ctx: BuildContext,
  regionId: RegionId,
  tier: number,
  settlement: SettlementDef,
  prop: PropDef,
  place: Placer,
): void {
  const scale = prop.scale ?? 1;
  const grounded = place(prop.position, prop.assetId, scale);
  const position: Vec3 = [grounded[0], round2(grounded[1] + (prop.dy ?? 0)), grounded[2]];
  ctx.out.push(sceneryEntity(
    prop.id, prop.id, tier, regionId, position, prop.assetId, scale, prop.rotationY, 1,
    { settlementId: settlement.id, propId: prop.id, scenery: true },
  ));
  // Uncapped: dressing carries no interaction of its own, so nothing depends on reaching its
  // centre. A prop big enough to block the station it stands next to is an authoring error, and
  // `validateRegions`' attachment check is the right place to catch that.
  if (prop.solid) pushAssetSolid(ctx, prop.id, position, prop.assetId, scale, prop.rotationY, false);
}

/** A drawn, hovered, never-interacted entity: paving, kerbs, props, plot beds. */
function sceneryEntity(
  id: string,
  name: string,
  tier: number,
  regionId: RegionId,
  position: Vec3,
  assetId: string,
  scale: number,
  rotationY: number,
  labelHeight: number,
  meta: Record<string, string | number | boolean>,
): SemanticEntity {
  return {
    id,
    archetype: "landmark",
    name,
    tier,
    regionId,
    position,
    state: "present",
    interactions: [],
    view: { assetId, scale: round4(scale), rotationY: round4(rotationY), materialTier: tier, labelHeight },
    meta,
  };
}


/**
 * Turns a prefab or composition part list into semantic entities.
 *
 * Two details are load-bearing:
 *
 *  - Every part of one building shares the origin's ground height. Buildings are level; following
 *    the terrain per part would shear a 12 m hall. Settlement pads are flattened for exactly this
 *    (`app/worldSpec.ts` puts a 34 m flat spot under each settlement centre).
 *  - `compensation` cancels a silhouette scale that `render/entityViews.ts` NO LONGER APPLIES to
 *    these parts, and the comment that used to sit here got both halves of that wrong.
 *
 *    What is actually true, read off entityViews.ts:460: `silhouette = TIERED_ARCHETYPES.has(
 *    archetype) ? tierSilhouetteScale(tier) : 1`, and `TIERED_ARCHETYPES` is
 *    {ore, tree, fishing_spot, farm_plot, enemy, boss}. Every part emitted here is archetype
 *    "landmark", so its silhouette factor is 1 and there is nothing to cancel. The old comment
 *    also mis-stated the constant: `tierSilhouetteScale(1)` is 0.90, not 0.92 (materials.ts:75,
 *    `0.9 + 0.5 * log(tier)/log(99)`; 1.0751 at tier 5, 1.1505 at tier 10).
 *
 *    Net effect today: a 2 m kit module is drawn 2.22 m wide at Coldbrace and 1.74 m at Highcairn.
 *    Removing `compensation` is the correct fix and is deliberately NOT done in this change - it
 *    resizes all 36 buildings at once, and `render/buildings.ts` is being re-cut in the same wave,
 *    so the two must not move together or neither can be attributed. Flagged for the root.
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

/**
 * A landmark's or gate's surrounding parts, plus a solid volume for the ones with real mass.
 *
 * Buildings get their collision from `prefabCollision`, which knows where the doorway is.
 * Compositions have no such function, so mass is inferred from each part's own manifest footprint:
 * anything under `SOLID_MIN_FOOTPRINT_AREA` (a torch is 0.086 m2, a banner less) is dressing and
 * stays walk-through, and anything within `COMPOSITION_CLEARANCE_METRES` of the origin is skipped
 * because that is where the hero mesh and its own volume already are.
 *
 * A part is only reach-capped when its full volume could actually foul the owner's approach ring -
 * `distance - halfDiagonal < INTERACT_RANGE`. That matters: the Gravelmaw mouth's `cliff_step_2`
 * brow has a 9.99 m half-diagonal, and capping it to 1.40 m unconditionally would leave a 20 m
 * cliff face the player walks straight through to protect a reach that a cliff 12 m away was never
 * going to block.
 */
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
  ctx?: BuildContext,
): void {
  if (!composition) return;
  const parts = buildComposition(composition, variantSeed(ownerId));
  emitParts(parts, origin, rotationY, regionId, tier, ownerId, name, meta, out);
  if (!ctx) return;

  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  const compensation = 1 / tierSilhouetteScale(tier);
  for (const part of parts) {
    if (Math.hypot(part.dx, part.dz) < COMPOSITION_CLEARANCE_METRES) continue;
    const position: Vec3 = [
      round2(origin[0] + part.dx * cos + part.dz * sin),
      round2(origin[1] + part.dy),
      round2(origin[2] - part.dx * sin + part.dz * cos),
    ];
    const scale = part.scale * compensation;
    const size = ctx.assetSize(part.assetId);
    const halfDiagonal = size ? Math.hypot(size.x * scale / 2, size.z * scale / 2) : 0;
    const capped = Math.hypot(part.dx, part.dz) - halfDiagonal < INTERACT_RANGE;
    pushAssetSolid(
      ctx, `${ownerId}#${part.tag}`, position, part.assetId, scale,
      rotationY + part.rotationY, capped,
    );
  }
}

function buildDungeonEntities(
  region: RegionDef,
  dungeon: DungeonDef,
  rng: Rng,
  ctx: BuildContext,
): void {
  // The dungeon has no terrain of its own - it is carved interior geometry. Everything inside is
  // measured off the surface height at the mouth, which is the one point both layers agree on.
  const floorBase = ctx.heightAt(region.id, dungeon.entrance[0], dungeon.entrance[1]);
  const out = ctx.out;
  const placeAt = (spot: Spot, offset: number): Vec3 => [spot[0], floorBase + offset, spot[1]];
  /**
   * Interior placement with the asset's own bbox floor on the chamber floor. `torch` alone has
   * `base.y` -0.2776, which at its authored scale 1.6 buried every chamber brazier 0.44 m.
   */
  const placeOn = (spot: Spot, offset: number, assetId: string, scale: number): Vec3 =>
    [spot[0], round2(floorBase + offset - ctx.baseY(assetId) * scale), spot[1]];

  // The mouth itself lives in Karrowmoor: the player walks up to it on the surface and enters.
  const mouth: Vec3 = [dungeon.entrance[0], floorBase, dungeon.entrance[1]];
  const mouthRotation = dungeon.entranceRotationY ?? 0;
  const mouthScale = trueScale(dungeon.entranceScale ?? 4, region.tier);
  out.push({
    id: "gravelmaw_mouth_portal",
    archetype: "portal",
    name: dungeon.name,
    tier: dungeon.tier,
    regionId: region.id,
    position: placeOn(dungeon.entrance, 0, dungeon.entranceAssetId, mouthScale),
    state: "open",
    interactions: ["inspect", "enter"],
    view: {
      assetId: dungeon.entranceAssetId,
      // 8 m x 12 m exactly, because the PRD's "twelve-metre wound" is a number the composition
      // around it is measured against.
      scale: mouthScale,
      rotationY: mouthRotation,
      labelHeight: 6,
    },
    meta: { toRegionId: dungeon.id, toLocationId: "gravelmaw_chamber1" },
  });
  ctx.locationEntity.set("gravelmaw_entrance", "gravelmaw_mouth_portal");

  // Finding 8: the twelve-metre wound was a lone wooden door frame on open ground. The cliffs, the
  // brow of rock above it and the two braziers are what make it read as a hole in a quarry face.
  // Region tier, not dungeon tier, because these parts stand on Karrowmoor's surface.
  //
  // The composition keeps the raw terrain origin the mouth was authored against; only the hero
  // mesh moved when its bbox floor was put on the ground. No volume for the mouth itself - it is
  // a hole, and a box across it would seal the entrance to the dungeon.
  emitComposition(
    dungeon.entranceComposition, mouth, mouthRotation, region.id, region.tier,
    "gravelmaw_mouth_portal", dungeon.name, { scenery: true, dungeonId: dungeon.id }, out, ctx,
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
      position: placeOn(markerSpot, chamber.floorOffset, "torch", 1.6),
      state: chamber.lit ? "lit" : "dark",
      interactions: ["inspect"],
      // No dungeon kit shipped in glTF (asset-report gap 8); the village brick set carries it,
      // and `torch` is the brazier stand-in that marks a chamber centre.
      view: { assetId: "torch", scale: 1.6, labelHeight: 2.4 },
      meta: { radius: chamber.radius, lit: chamber.lit },
    });
    ctx.locationEntity.set(chamber.id, `${chamber.id}_marker`);
  }

  for (const door of dungeon.doors) {
    out.push({
      id: door.id,
      archetype: "door",
      name: door.name,
      tier: dungeon.tier,
      regionId: dungeon.id,
      position: placeOn(door.position, door.floorOffset, door.assetId, 2.2),
      state: door.state,
      interactions: ["inspect", "open"],
      view: { assetId: door.assetId, scale: 2.2, labelHeight: 2.6 },
      meta: { lockedReason: door.lockedReason },
    });
  }

  for (const obstacle of dungeon.obstacles) {
    const scale = drawnScale("obstacle", obstacle.scale, dungeon.tier);
    out.push(buildObstacle(
      dungeon.id, dungeon.tier, obstacle,
      (spot) => placeOn(spot, nearestChamberOffset(dungeon, spot), obstacle.assetId, scale),
      (spot) => placeAt(spot, nearestChamberOffset(dungeon, spot)),
    ));
  }

  for (const group of dungeon.enemyGroups) {
    const chamberPlace: Placer = (spot, assetId, scale) =>
      placeOn(spot, nearestChamberOffset(dungeon, spot), assetId, scale);
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
  place: Placer,
  normal: (spot: Spot) => readonly [number, number, number] | undefined,
  ctx: BuildContext,
): void {
  const respawn = respawnSeconds(cluster.tier);
  const interaction = gatherInteraction(cluster.archetype);
  const scale = drawnScale(cluster.archetype, cluster.scale, cluster.tier);
  const out = ctx.out;

  for (let index = 0; index < cluster.count; index += 1) {
    const spot = spiralSpot(cluster.centre, cluster.radius, index, cluster.count, rng);
    const position = place(spot, cluster.assetId, scale);
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
      emitPlotBed(ctx, regionId, cluster, id, spot);
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
        groundNormal: normal(spot),
        tiltStrength: TILT_STRENGTH[cluster.archetype],
      },
      meta: { clusterId: cluster.id, locationId: cluster.locationId, skill: cluster.skill },
    });
    pushClusterSolid(ctx, id, position, cluster, scale);
  }
}

/**
 * A tilled bed under a farm plot, so an unplanted plot is a thing on the ground rather than
 * nothing at all.
 *
 * All 10 plots in the game were 100% invisible. They spawn `state: "empty"`, `entityViews`'
 * `SPENT_STATES` counts that as spent, and the spent build for `farm_plot` clips `crop_carrot` to
 * its bottom `CROP_STUBBLE_FRACTION` = 0.3 - which for that GLB is entirely below its own origin
 * (`base.y` -0.2378 of a 0.566 m mesh, so the bottom 42% is taproot). Measured before the fix:
 * `getDrawnBounds("marchfield_plots_1")` max.y -2.017 against a ground of -1.940, i.e. the TOP of
 * the drawn mesh 7.7 cm underground; Highcairn 9.9 cm. Marchfield Farm was an empty green field.
 *
 * Two things fix it and both are here. Base-aligned placement lifts the stubble to 0..0.137 m
 * above ground on its own, and this bed gives the empty state a silhouette: one `floor_brick`
 * module (exactly 2.00 x 0.02 x 2.00 m, origin centred, so it needs no base correction) with four
 * `fence_wood_single` panels (2.064 x 0.838 m, `base.y` -0.028) around it. Both assets ship in the
 * manifest and were used by nothing.
 *
 * Cost is 5 entities per plot, 50 world-wide, in 2 instanced groups per settlement tier.
 */
function emitPlotBed(
  ctx: BuildContext,
  regionId: RegionId,
  cluster: ResourceClusterDef,
  plotId: string,
  spot: Spot,
): void {
  const meta = { plotId, clusterId: cluster.id, scenery: true };
  const ground = ctx.heightAt(regionId, spot[0], spot[1]);
  ctx.out.push(sceneryEntity(
    `${plotId}#bed`, cluster.name, cluster.tier, regionId,
    [round2(spot[0]), round2(ground + PAVING_LIFT_METRES), round2(spot[1])],
    PLOT_BED_ASSET, 1, 0, 0.3, meta,
  ));
  // The four rails sit on the module edge, long axis along it, facing out.
  const half = MODULE_METRES / 2;
  const rails: readonly (readonly [number, number, number])[] = [
    [0, half, 0], [0, -half, Math.PI], [half, 0, Math.PI / 2], [-half, 0, -Math.PI / 2],
  ];
  for (let index = 0; index < rails.length; index += 1) {
    const rail = rails[index]!;
    const x = spot[0] + rail[0];
    const z = spot[1] + rail[1];
    ctx.out.push(sceneryEntity(
      `${plotId}#rail${index}`, cluster.name, cluster.tier, regionId,
      [round2(x), round2(ctx.heightAt(regionId, x, z) - ctx.baseY(PLOT_RAIL_ASSET)), round2(z)],
      PLOT_RAIL_ASSET, 1, rail[2], 0.9, meta,
    ));
  }
}

function buildEnemyGroup(
  regionId: RegionId,
  group: EnemyGroupDef,
  rng: Rng,
  place: Placer,
  out: SemanticEntity[],
): void {
  // One lookup per group. `content/enemies.ts` publishes alias rows keyed by group id and by
  // family, so either spelling resolves.
  const enemyBlock = content.enemy(group.id) ?? content.enemy(enemyIdFor(group.family, group.tier));
  const archetype: Archetype = group.boss ? "boss" : "enemy";
  // A boss should not be the same size as the things guarding it. 1.6x on top of the authored
  // scale is the difference between "another enemy" and "the thing in the room".
  const viewScale = group.boss ? group.scale * 1.6 : group.scale;
  const scale = drawnScale(archetype, viewScale, group.tier);

  for (let index = 0; index < group.count; index += 1) {
    const spot = group.radius <= 0
      ? group.centre
      : spiralSpot(group.centre, group.radius, index, group.count, rng);
    const position = place(spot, group.assetId, scale);
    out.push({
      id: group.count === 1 ? group.id : `${group.id}_${index + 1}`,
      archetype,
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
      // No `groundNormal` and no solid volume: enemies walk, and a normal sampled once at spawn
      // would be a lie the moment they moved. `systems/` owns both for anything that moves.
      view: {
        assetId: group.assetId,
        scale: viewScale,
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
