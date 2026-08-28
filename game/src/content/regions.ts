/**
 * The three Phase 1 regions, as pure data.
 *
 * Nothing here imports Three.js, reads the store, or computes terrain. This file is the authored
 * truth for *where things are and what they mean*; `world/regionBuilder.ts` turns it into
 * `SemanticEntity` objects, and the render layer draws those by reading `view.assetId`.
 *
 * Sources: runs/corealm/PRD.md section 4 (names, lore, feature lists), section 2.6 (node numbers),
 * section 2.8 (the route-optimisation flip), and runs/corealm/architecture.md correction R2
 * (Agility obstacles are route-graph edges, not navmesh off-mesh links).
 *
 * ---------------------------------------------------------------------------------------------
 * COORDINATE SYSTEM
 * ---------------------------------------------------------------------------------------------
 * One connected world. X grows east, Z grows north, Y is up. All units are metres.
 * The three surface regions tile a single 700 x 400 m rectangle with no overlap and no gaps:
 *
 *        z=+200  +-------------------+-------------------------------+
 *                |                   |                               |
 *                |                   |          VELLENWOOD           |
 *                |                   |     x [-20,350] z [10,200]    |
 *                |    FALLOWMARCH    |                               |
 *        z=+10   |  x [-350,-20]     +-------------------------------+
 *                |  z [-200,200]     |                               |
 *                |                   |          KARROWMOOR           |
 *                |                   |    x [-20,350] z [-200,10]    |
 *        z=-200  +-------------------+-------------------------------+
 *              x=-350             x=-20                          x=350
 *
 * Fallowmarch is middle-west, Vellenwood north-east of it, Karrowmoor east and south-east and
 * considerably higher. The regions share terrain edges, so the navmesh is continuous: a path from
 * the Coldbrace bank to the Upper Karrow seam crosses two borders and runs ~360 m in a straight
 * line, which is what acceptance check B3 measures (it expects 380-460 m once the Karrowmoor
 * terraces force the walk to switch back).
 *
 * PRD section 4 sizes the regions at 420/380/460 m square, which is 1.3 km of world. The root
 * fixed Phase 1 at 700 x 400 m, so lateral feature spacing is compressed where it had to be
 * (mainly east-west inside Fallowmarch) and preserved where it mattered. Every distance a game
 * rule depends on is preserved exactly and stated in the DISTANCE LEDGER below.
 *
 * ---------------------------------------------------------------------------------------------
 * DISTANCE LEDGER - the route-optimisation flip (PRD 2.8)
 * ---------------------------------------------------------------------------------------------
 * This is a product pillar, not decoration: a tier 5 seam next to its bank must out-XP a tier 10
 * seam that is far from its bank, until an Agility shortcut reverses it. The numbers below are
 * measured off the coordinates in this file, not copied from the PRD.
 *
 *   Hollowcut Seam (tier 5) -> Rootfall bank chest
 *     (94,145) -> (60,128)                                   = 38.0 m
 *
 *   Upper Karrow Seam (tier 10) -> Highcairn bank, by road
 *     (194,-132) -> ramp_three (118,-138)                    =  76.2 m
 *     ramp_three -> ramp_two    (100,-80)                    =  60.7 m
 *     ramp_two   -> highcairn_bank (150,-70)                 =  51.0 m
 *                                                      total = 187.9 m
 *
 *   Upper Karrow Seam -> Highcairn bank, via SUNDER LEDGE (Agility 10)
 *     highcairn_bank (150,-70) -> ledge entrance (170,-74)   =  20.4 m
 *     ledge exit (176,-114)    -> seam (194,-132)            =  25.5 m
 *                                        total walking       =  45.9 m + a 6.0 s climb
 *
 * Working the PRD 2.5 gathering model at Mining 12, no tool, 28-slot load, 6 s of banking per
 * trip, 4.2 m/s, 1.8 s gather tick:
 *
 *   successChance = 0.30 + 0.016 * (level - reqLevel)
 *   tier  5 @ 12: 0.412 -> 4.369 s/yield -> 28 yields = 122.3 s;
 *                 travel 2*38.0/4.2 = 18.1 s; bank 6 s; total 146.4 s; 28*24 XP = 16,524 XP/hr
 *   tier 10 @ 12: 0.332 -> 5.422 s/yield -> 28 yields = 151.8 s;
 *                 travel 2*187.9/4.2 = 89.5 s; bank 6 s; total 247.3 s; 28*35 XP = 14,266 XP/hr
 *   tier 10 via ledge: travel 2*(45.9/4.2 + 6.0) = 33.9 s; total 191.7 s     = 18,412 XP/hr
 *
 *   Before Agility 10:  tier 5 beats tier 10 by 15.8%.
 *   After  Agility 10:  tier 10 beats tier 5 by 11.4%.
 *
 * That reproduces the PRD's stated "about 16% then about 12%" reversal to within a fraction of a
 * point, and it is a property of the coordinates in this file, so it cannot drift without someone
 * moving a seam. Every other obstacle's `savesMeters` is likewise measured, not asserted; where
 * the PRD quoted a figure its own 420 m regions could not geometrically produce, the measured
 * value is used and the discrepancy is noted at the obstacle.
 */
import type { ItemId, QuestId, RecipeId, RegionId, SkillId } from "../contracts.js";
import {
  COMPOSITION_IDS, KIT_IDS, PREFAB_IDS, compositionPartAssetIds, isCompositionId, isKitId,
  isPrefabId, prefabPartAssetIds, type CompositionId, type KitId,
} from "../render/buildings.js";

// ------------------------------------------------------------------ primitives

/**
 * An authored ground position: `[x, z]` in metres. Y is deliberately absent.
 *
 * The world layer does not own terrain. `buildWorld` is handed a `heightAt(regionId, x, z)` by the
 * root and resolves every Spot to a `Vec3` at build time, so an entity can never end up floating
 * because two files disagreed about where the ground was.
 */
export type Spot = readonly [number, number];

export interface RegionBounds {
  min: Spot;
  max: Spot;
}

export type StationKind = "furnace" | "anvil" | "range" | "crafting_table" | "fletching_bench";

export type LocationKind =
  | "settlement" | "bank" | "seam" | "grove" | "water" | "farm"
  | "gate" | "landmark" | "camp" | "junction" | "dungeon";

/**
 * A named place. Every location with `routeNode: true` becomes a node in the route graph that
 * `Navigation.planRoute` runs Dijkstra over, and an id an agent can pass to
 * `moveTo({ locationId })`. Ids match the PRD's screenshot pose names where one exists.
 */
export interface LocationDef {
  id: string;
  name: string;
  position: Spot;
  kind: LocationKind;
  routeNode: boolean;
  /** One line for the Locations journal and for `searchDocs`. */
  blurb?: string;
}

/** A walkable link between two locations in the same region. Cost is derived from the positions. */
export interface RoadDef {
  from: string;
  to: string;
  /** Overrides the straight-line cost when the authored road is longer than the crow flies. */
  meters?: number;
}

export interface ResourceClusterDef {
  id: string;
  name: string;
  archetype: "ore" | "tree" | "fishing_spot" | "farm_plot";
  skill: SkillId;
  tier: number;
  reqLevel: number;
  itemId: ItemId;
  /** How many nodes to place. Positions come from a deterministic spiral plus seeded jitter. */
  count: number;
  centre: Spot;
  radius: number;
  assetId: string;
  /**
   * A different mesh for the worked-out state. Optional, and usually absent: the render layer
   * derives "spent" from the live mesh so a node never changes silhouette when it runs dry.
   * Author one only when the spent state is genuinely a different object.
   */
  depletedAssetId?: string;
  scale?: number;
  /** The route-graph node a player banks against when working this cluster. */
  locationId: string;
}

export type PrefabId =
  | "cottage" | "hall" | "tower" | "stall" | "wall_segment"
  | "gatehouse" | "shed" | "ruin" | "quarry_hut";

/**
 * Buildings are composed, not loaded: the Medieval Village kit ships no prebuilt house, only a 2 m
 * modular grid (asset-report, "No prebuilt house or cottage"). A placement names a prefab and a
 * pose; `render/buildings.ts` turns that into an ordered list of part placements on the kit's 2 m /
 * 3.123 m grid, and `world/regionBuilder.ts` emits one instanced entity per part.
 */
export interface BuildingDef {
  id: string;
  name: string;
  prefab: PrefabId;
  position: Spot;
  rotationY: number;
  /** Footprint in metres, used for scatter exclusion and collision boxes. */
  footprint: readonly [number, number];
}

export interface StationDef {
  id: string;
  name: string;
  kind: StationKind;
  skill: SkillId;
  position: Spot;
  rotationY: number;
  assetId: string;
  scale?: number;
  /** Filled in by round 3's `content/recipes.ts`. Empty here on purpose. */
  recipeIds: RecipeId[];
}

export interface BankDef {
  id: string;
  name: string;
  position: Spot;
  rotationY: number;
  assetId: string;
}

export interface ShopDef {
  id: string;
  name: string;
  shopKind: "general" | "smith";
  position: Spot;
  rotationY: number;
  assetId: string;
}

export interface NpcStandDef {
  id: string;
  name: string;
  position: Spot;
  facingRad: number;
  assetId: string;
  /** Round 5 (`content/dialogue.ts`) owns the tree behind this id. */
  dialogueRootId: string;
  questIds: QuestId[];
}

export interface SettlementDef {
  id: string;
  name: string;
  /**
   * Which building vernacular this settlement is made of. See `BUILDING_KITS` in
   * render/buildings.ts: wall family, corner post, roof pitch and roofline. Phase 1 shipped every
   * settlement on one kit, so tier 1 and tier 10 were the same eight cottages in different grass.
   */
  kit: KitId;
  centre: Spot;
  respawnPointId: string;
  buildings: BuildingDef[];
  stations: StationDef[];
  bank: BankDef;
  shops: ShopDef[];
  npcs: NpcStandDef[];
}

/**
 * An Agility shortcut. Per architecture R2 these are semantic entities plus a route-graph edge, so
 * the flip in PRD 2.8 is a property of data rather than of Detour's off-mesh internals.
 *
 * `fromLocationId` / `toLocationId` are the route nodes the shortcut edge connects. Its cost is
 * `(dist(from, position) + dist(exitPosition, to)) / 4.2 + durationMs / 1000` - the brief's
 * "walk time to entrance plus duration", generalised so the walk off the far end is not free.
 */
export interface ObstacleDef {
  id: string;
  name: string;
  reqLevel: number;
  position: Spot;
  exitPosition: Spot;
  durationMs: number;
  /** Measured: the walking route this replaces, minus the walking the shortcut still costs. */
  savesMeters: number;
  assetId: string;
  scale?: number;
  rotationY?: number;
  fromLocationId: string;
  toLocationId: string;
  /** A slide you cannot climb back up. Emits one route edge instead of two. */
  oneWay?: boolean;
  interaction: "climb" | "vault" | "enter";
}

/**
 * A patrol group. `family` is the key round 4's `content/enemies.ts` looks up; the stats here are
 * provisional so round 1 can spawn something with a health bar and an aggro radius, and they are
 * superseded (not merged) when the real enemy table lands.
 */
export interface EnemyGroupDef {
  id: string;
  family: string;
  name: string;
  tier: number;
  count: number;
  centre: Spot;
  radius: number;
  assetId: string;
  /** Platformer-pack enemies are 1.4-2.9 m; asset-report says ~0.7x next to a 1.82 m player. */
  scale: number;
  level: number;
  maxHealth: number;
  aggroRadius: number;
  behaviour: "passive" | "aggressive" | "territorial";
  boss?: boolean;
}

export interface LandmarkDef {
  id: string;
  name: string;
  position: Spot;
  assetId: string;
  scale?: number;
  rotationY?: number;
  /** Draw only the lowest fraction of the mesh. See `SemanticEntity.view.clipFraction`. */
  clipFraction?: number;
  blurb: string;
  /**
   * Set dressing built around the hero mesh by `render/buildings.ts`. Round-1 critique finding 8:
   * one stand-in prop gives the player nothing to navigate by, so the landmarks that matter carry
   * a small authored composition instead.
   */
  composition?: CompositionId;
}

/** A region gate. Two of these, one per side, make a crossing. */
export interface GateDef {
  id: string;
  name: string;
  position: Spot;
  assetId: string;
  toRegionId: RegionId;
  /** The location id on the far side. */
  toLocationId: string;
  rotationY?: number;
  composition?: CompositionId;
}

export interface RegionAdjacencyDef {
  toRegionId: RegionId;
  fromLocationId: string;
  toLocationId: string;
  /** Walking metres between the two gate nodes. */
  meters: number;
}

/** A stepped plateau. Karrowmoor's defining feature; the terrain generator reads these. */
export interface TerraceDef {
  index: number;
  /** Inclusive z band. */
  minZ: number;
  maxZ: number;
  /** Plateau height above the region's base height, before noise. */
  height: number;
}

export interface DungeonChamberDef {
  id: string;
  name: string;
  centre: Spot;
  radius: number;
  /** Floor height relative to the terrain at the dungeon entrance. Chambers descend. */
  floorOffset: number;
  lit: boolean;
}

export interface DungeonDoorDef {
  id: string;
  name: string;
  position: Spot;
  floorOffset: number;
  assetId: string;
  state: string;
  /** Plain text shown when the door refuses. */
  lockedReason: string;
}

/**
 * The Gravelmaw hangs off Karrowmoor rather than standing as a fourth `RegionDef`, because the
 * root's boot sequence builds terrain and a navmesh per region and the dungeon has neither - it is
 * carved interior geometry under the quarry face. Its entities still carry
 * `regionId: "gravelmaw"`, so `observe({ regionId: "gravelmaw" })` and the save format behave
 * exactly as the contract says.
 */
export interface DungeonDef {
  id: RegionId;
  name: string;
  tier: number;
  /** Surface position of the mouth, in the parent region. */
  entrance: Spot;
  entranceAssetId: string;
  /** Bearing the mouth opens toward, radians, 0 = +z. The composition is laid out around it. */
  entranceRotationY?: number;
  entranceScale?: number;
  /** Cliff, brow and brazier composition built around the mouth by `render/buildings.ts`. */
  entranceComposition?: CompositionId;
  palette: string[];
  chambers: DungeonChamberDef[];
  doors: DungeonDoorDef[];
  obstacles: ObstacleDef[];
  enemyGroups: EnemyGroupDef[];
  locations: LocationDef[];
  roads: RoadDef[];
}

export interface RegionDef {
  id: RegionId;
  name: string;
  tier: number;
  /** One paragraph, condensed from PRD section 4. Feeds `searchDocs` and the Locations panel. */
  lore: string;
  bounds: RegionBounds;
  /** Terrain noise seed. Independent of the world seed so terrain is stable across saves. */
  terrainSeed: number;
  /** Metres of elevation range across the region, per PRD section 4. */
  terrainAmplitude: number;
  /** Height of the region's floor above world zero, before noise and terraces. */
  baseHeight: number;
  terraces?: TerraceDef[];
  /** Exactly 8 swatches. `render/materials.ts` locks the region palette off these. */
  groundPalette: string[];
  /** Fog start in metres. Vellenwood's canopy is why this is per-region. */
  fogStart: number;
  spawnPoint: Spot;
  /**
   * Which way the player faces at frame 0, radians, in the same convention as `NpcStandDef.facingRad`
   * and `debug/shots.ts`: **0 looks toward +z (north), increasing clockwise seen from above**, so
   * `facing = atan2(targetX - x, targetZ - z)`.
   *
   * Round-1 critique finding 2: Fallowmarch spawns at z = -118 and Coldbrace Square is at z = -80,
   * i.e. *behind* a camera left at its hardcoded initial yaw. The camera sits opposite the facing,
   * so the root's boot sequence wants `camera.setPose(spawnFacingRad + Math.PI, ...)` alongside
   * `scene.syncPlayer(spawn, spawnFacingRad, true)` - exactly the relationship
   * `__gameDebug.focusCamera` already uses for named shots.
   */
  spawnFacingRad: number;
  respawnPointId: string;
  locations: LocationDef[];
  roads: RoadDef[];
  clusters: ResourceClusterDef[];
  settlement: SettlementDef;
  obstacles: ObstacleDef[];
  enemyGroups: EnemyGroupDef[];
  landmarks: LandmarkDef[];
  gates: GateDef[];
  adjacency: RegionAdjacencyDef[];
  dungeon?: DungeonDef;
}

/** Movement speed the route graph costs walking edges at. Mirrors `app/config.ts` PLAYER_SPEED. */
export const WALK_SPEED_MPS = 4.2;

export const WORLD_BOUNDS: RegionBounds = { min: [-350, -200], max: [350, 200] };

// =============================================================== FALLOWMARCH

/**
 * Tier 1 frontier plains. Coldbrace sits centre-south with the March Road running north to the
 * Bracken Pit and on to the region gate.
 *
 * Feature spacing from the town square at (-160,-80), against PRD section 4:
 *   Bracken Pit      (-160,  80)  160 m north      (PRD: 160 m north)   exact
 *   Redsill Shallows ( -40, -60)  121.7 m east     (PRD: 120 m east)    exact
 *   Marchfield       ( -96, -22)   86.4 m NE       (PRD:  90 m NE)      close
 *   Palewood Copse   (-334, -64)  174.7 m west     (PRD: 190 m west)    compressed to fit x
 */
const FALLOWMARCH: RegionDef = {
  id: "fallowmarch",
  name: "Fallowmarch",
  tier: 1,
  lore:
    "The last surveyed land before the maps stop being useful. Two generations ago the March " +
    "Company drove a road north, planted a bank vault at the end of it, walled a town around the " +
    "vault, and then stopped answering letters. What is left is Coldbrace: two hundred people " +
    "pulling soft grey Grithe out of a shallow pit and pretending the wind off the northern moor " +
    "does not sound like anything.",
  bounds: { min: [-350, -200], max: [-20, 200] },
  terrainSeed: 0x0f411,
  terrainAmplitude: 14,
  baseHeight: 0,
  // Bleached grass greens, weathered grey-brown timber, one warm copper-orange accent on the roofs.
  groundPalette: ["#8f9468", "#a7a97c", "#6f7a4e", "#5c6242", "#8a7f6a", "#6d5f4c", "#c07a3c", "#d8d2c0"],
  fogStart: 180,
  // Just outside the south gate, facing the town. Screen centre lands on the road, which the
  // harness needs: smoke check `inputChangesState` clicks (640,360) then holds W.
  spawnPoint: [-160, -118],
  // Coldbrace South Gate is (-160,-108), dead north of spawn; the vault tower door is (-168,-94.5),
  // 0.51 rad west of it. -0.14 rad splits them: the gatehouse sits just right of screen centre and
  // the tower rises just left of it, both inside a 55-degree horizontal FOV at 10-25 m.
  spawnFacingRad: -0.14,
  respawnPointId: "coldbrace",

  locations: [
    { id: "spawn", name: "March Road End", position: [-160, -118], kind: "junction", routeNode: true,
      blurb: "Where the March Company road gives out, a stone throw south of Coldbrace." },
    { id: "town_entrance", name: "Coldbrace South Gate", position: [-160, -108], kind: "gate", routeNode: true,
      blurb: "The south gate of Coldbrace. The only one the carters use." },
    { id: "town_center", name: "Coldbrace Square", position: [-160, -80], kind: "settlement", routeNode: true,
      blurb: "The town square, built around the March Company vault." },
    { id: "bank_interior", name: "Coldbrace Bank", position: [-160, -88], kind: "bank", routeNode: true,
      blurb: "The March Company vault counter. Twelve windows, one very deep store." },
    { id: "coldbrace_east_gate", name: "Coldbrace East Gate", position: [-134, -80], kind: "gate", routeNode: true,
      blurb: "The gate the pit road leaves by." },
    { id: "north_milestone", name: "The Broken Milestone", position: [-108, -8], kind: "landmark", routeNode: true,
      blurb: "A snapped March Company marker where the pit road bends around the rise." },
    { id: "bracken_pit", name: "Bracken Pit", position: [-160, 80], kind: "seam", routeNode: true,
      blurb: "A shallow Grithe pit 160 m north of Coldbrace. Six seams and two stone faces." },
    { id: "palewood_copse", name: "Palewood Copse", position: [-334, -64], kind: "grove", routeNode: true,
      blurb: "Eight Palewood on the western track. The only shade on the plain." },
    { id: "redsill_shallows", name: "Redsill Shallows", position: [-40, -60], kind: "water", routeNode: true,
      blurb: "Where Corven Brook runs thin over red silt. Minnow water." },
    { id: "corven_ford", name: "Corven Ford", position: [-72, -146], kind: "junction", routeNode: true,
      blurb: "The only cart crossing of Corven Brook, well south of the shallows." },
    { id: "marchfield_farm", name: "Marchfield", position: [-96, -22], kind: "farm", routeNode: true,
      blurb: "Six plots inside the old wall line. Bittergrain, mostly." },
    { id: "west_track", name: "West Track", position: [-230, -60], kind: "junction", routeNode: true,
      blurb: "Where the copse track leaves the town road." },
    { id: "open_march_camp", name: "The Open March", position: [-250, 30], kind: "camp", routeNode: true,
      blurb: "Open tussock. Skitterlings in the wet, wolf pups on the rise." },
    { id: "fallowmarch_north_gate", name: "North Gate", position: [-26, 118], kind: "gate", routeNode: true,
      blurb: "The top of the March Road, and the way into Vellenwood." },
  ],

  // Road legs. Straight-line cost between the two nodes unless `meters` overrides.
  roads: [
    { from: "spawn", to: "town_entrance" },
    { from: "town_entrance", to: "town_center" },
    { from: "town_center", to: "bank_interior" },
    { from: "town_center", to: "coldbrace_east_gate" },
    { from: "coldbrace_east_gate", to: "north_milestone" },
    { from: "coldbrace_east_gate", to: "marchfield_farm" },
    { from: "north_milestone", to: "marchfield_farm" },
    { from: "north_milestone", to: "bracken_pit" },
    { from: "bracken_pit", to: "fallowmarch_north_gate" },
    { from: "town_entrance", to: "corven_ford" },
    { from: "corven_ford", to: "redsill_shallows" },
    { from: "town_center", to: "west_track" },
    { from: "west_track", to: "palewood_copse" },
    { from: "west_track", to: "open_march_camp" },
    { from: "open_march_camp", to: "bracken_pit" },
  ],

  clusters: [
    {
      id: "bracken_pit_grithe", name: "Grithe Seam", archetype: "ore",
      skill: "mining", tier: 1, reqLevel: 1, itemId: "grithe_ore",
      count: 6, centre: [-160, 80], radius: 11,
      // No pack ships a mineable vein (asset-report gap 2). The rock meshes tagged `ore-node` are
      // single-material, so the render layer tints them per `view.materialTier`.
      // No `depletedAssetId`. A worked-out node keeps the silhouette the player walked up to:
      // the render layer derives the spent look from this same mesh (`buildSpentParts` in
      // render/entityViews.ts) by dropping the ore vein, cutting a tree back to its stump, or
      // cutting a crop back to stubble. Swapping in a smaller rock read as the seam vanishing, and
      // swapping a tree for `anvil_log` — which is an anvil sitting on a log — put a blacksmith's
      // anvil where every felled tree had been.
      assetId: "rock_medium_1",
      locationId: "bracken_pit",
    },
    {
      id: "bracken_pit_stone", name: "Marchstone Face", archetype: "ore",
      skill: "mining", tier: 1, reqLevel: 1, itemId: "march_stone",
      count: 2, centre: [-146, 88], radius: 5,
      assetId: "rock_medium_3",
      locationId: "bracken_pit",
    },
    {
      id: "palewood_copse_trees", name: "Palewood", archetype: "tree",
      skill: "woodcutting", tier: 1, reqLevel: 1, itemId: "palewood_log",
      count: 8, centre: [-334, -64], radius: 15,
      assetId: "tree_common_1", scale: 0.9,
      locationId: "palewood_copse",
    },
    {
      id: "redsill_spots", name: "Redsill Shallow", archetype: "fishing_spot",
      skill: "fishing", tier: 1, reqLevel: 1, itemId: "silt_minnow",
      count: 4, centre: [-40, -60], radius: 9,
      // There is no fish, boat, or rod mesh (asset-report gap 3). A coil of rope on the bank is
      // the interaction marker; the water itself is a shader plane owned by the render layer.
      assetId: "rope_coil", depletedAssetId: "rope_coil", scale: 1.2,
      locationId: "redsill_shallows",
    },
    {
      id: "marchfield_plots", name: "Marchfield Plot", archetype: "farm_plot",
      skill: "farming", tier: 1, reqLevel: 1, itemId: "bittergrain",
      count: 6, centre: [-96, -22], radius: 7,
      // No soil-plot or scarecrow mesh (asset-report gap 5). The crop is the clickable thing; the
      // dirt quad and its fence border are render-layer geometry.
      assetId: "crop_carrot",
      locationId: "marchfield_farm",
    },
  ],

  settlement: {
    id: "coldbrace",
    name: "Coldbrace",
    // Lime-washed plaster, fired pantiles, a steep pitch. A river-plain farming village.
    kit: "plaster",
    centre: [-160, -80],
    respawnPointId: "coldbrace",
    buildings: [
      { id: "coldbrace_hall", name: "March Company Hall", prefab: "hall", position: [-160, -60], rotationY: Math.PI, footprint: [12, 6] },
      { id: "coldbrace_vault", name: "The Vault Tower", prefab: "tower", position: [-168, -90], rotationY: 0, footprint: [6, 6] },
      { id: "coldbrace_house_1", name: "Carter's House", prefab: "cottage", position: [-182, -104], rotationY: 0, footprint: [6, 4] },
      { id: "coldbrace_house_2", name: "Pitmaster's House", prefab: "cottage", position: [-172, -104], rotationY: 0, footprint: [6, 4] },
      { id: "coldbrace_house_3", name: "Weaver's House", prefab: "cottage", position: [-146, -104], rotationY: 0, footprint: [6, 4] },
      { id: "coldbrace_house_4", name: "Drover's House", prefab: "cottage", position: [-136, -104], rotationY: 0, footprint: [6, 4] },
      { id: "coldbrace_house_5", name: "Warden's House", prefab: "cottage", position: [-182, -64], rotationY: Math.PI, footprint: [6, 4] },
      { id: "coldbrace_house_6", name: "Rope House", prefab: "cottage", position: [-176, -68], rotationY: Math.PI, footprint: [6, 4] },
      { id: "coldbrace_house_7", name: "Old Surveyor's House", prefab: "cottage", position: [-144, -68], rotationY: Math.PI, footprint: [6, 4] },
      { id: "coldbrace_house_8", name: "Empty House", prefab: "cottage", position: [-136, -64], rotationY: Math.PI, footprint: [6, 4] },
      { id: "coldbrace_forge_shed", name: "Forge Shed", prefab: "shed", position: [-152, -98], rotationY: 0, footprint: [4, 4] },
      { id: "coldbrace_gate_south", name: "South Gatehouse", prefab: "gatehouse", position: [-160, -108], rotationY: 0, footprint: [6, 3] },
      { id: "coldbrace_gate_east", name: "East Gatehouse", prefab: "gatehouse", position: [-134, -80], rotationY: Math.PI / 2, footprint: [6, 3] },
      { id: "coldbrace_wall_w", name: "West Wall", prefab: "wall_segment", position: [-186, -84], rotationY: Math.PI / 2, footprint: [8, 1] },
      { id: "coldbrace_wall_n", name: "North Wall", prefab: "wall_segment", position: [-160, -54], rotationY: 0, footprint: [8, 1] },
      { id: "coldbrace_wall_e", name: "East Wall", prefab: "wall_segment", position: [-134, -96], rotationY: Math.PI / 2, footprint: [8, 1] },
      { id: "coldbrace_wall_s", name: "South Wall", prefab: "wall_segment", position: [-176, -108], rotationY: 0, footprint: [8, 1] },
    ],
    stations: [
      // No furnace or forge mesh exists (asset-report gap 11); a cauldron plus the anvil and a
      // torch reads as a forge at gameplay distance.
      { id: "coldbrace_furnace", name: "Coldbrace Furnace", kind: "furnace", skill: "smithing", position: [-150, -94], rotationY: 0, assetId: "cauldron", recipeIds: [] },
      { id: "coldbrace_anvil", name: "Coldbrace Anvil", kind: "anvil", skill: "smithing", position: [-154, -94], rotationY: 0, assetId: "anvil", recipeIds: [] },
      { id: "coldbrace_range", name: "Coldbrace Cooking Range", kind: "range", skill: "cooking", position: [-166, -94], rotationY: 0, assetId: "cooking_pot", scale: 1.6, recipeIds: [] },
      { id: "coldbrace_crafting", name: "Coldbrace Crafting Table", kind: "crafting_table", skill: "crafting", position: [-172, -92], rotationY: 0, assetId: "workbench", recipeIds: [] },
      { id: "coldbrace_fletching", name: "Coldbrace Fletching Bench", kind: "fletching_bench", skill: "fletching", position: [-177, -92], rotationY: 0, assetId: "workbench_drawers", scale: 1.6, recipeIds: [] },
    ],
    bank: { id: "coldbrace_bank", name: "Coldbrace Bank", position: [-160, -88], rotationY: 0, assetId: "chest_wood" },
    shops: [
      { id: "coldbrace_general", name: "Coldbrace General Supplies", shopKind: "general", position: [-176, -80], rotationY: Math.PI / 2, assetId: "market_stall" },
      { id: "coldbrace_smith", name: "Harrow's Metal", shopKind: "smith", position: [-144, -80], rotationY: -Math.PI / 2, assetId: "market_stall_cart" },
    ],
    npcs: [
      { id: "npc_warden_ilse", name: "Warden Ilse", position: [-160, -74], facingRad: Math.PI, assetId: "base_female", dialogueRootId: "ilse_root", questIds: [] },
      { id: "npc_pitmaster_dorn", name: "Pitmaster Dorn", position: [-166, -86], facingRad: Math.PI / 2, assetId: "base_male", dialogueRootId: "dorn_root", questIds: [] },
      { id: "npc_smith_harrow", name: "Harrow the Smith", position: [-146, -84], facingRad: -Math.PI / 2, assetId: "base_male", dialogueRootId: "harrow_root", questIds: [] },
      { id: "npc_ranger_syb", name: "Ranger Syb", position: [-178, -74], facingRad: 0, assetId: "base_female", dialogueRootId: "syb_root", questIds: [] },
      { id: "npc_carter_bel", name: "Carter Bel", position: [-158, -102], facingRad: 0, assetId: "base_male", dialogueRootId: "bel_root", questIds: [] },
    ],
  },

  obstacles: [
    {
      // Bank -> Redsill by road runs down to Corven Ford and back up: 115.0 + 91.8 = 206.8 m.
      // Over the planks: 100.4 m to the entrance + 40.5 m off the far bank = 140.9 m + 2.0 s.
      // Saves 65.9 m. PRD 2.8 quoted 205 -> 130; the 205 reproduces, the 130 does not fit a
      // brook this far east, so the measured 141 is used.
      id: "brookvault_planks", name: "Brookvault Planks", reqLevel: 1,
      position: [-78, -30], exitPosition: [-62, -26],
      durationMs: 2000, savesMeters: 66,
      assetId: "floor_wood", scale: 1.6, rotationY: 0.25,
      fromLocationId: "bank_interior", toLocationId: "redsill_shallows",
      interaction: "vault",
    },
    {
      // Bank -> Bracken Pit by road leaves through the east gate and bends at the milestone:
      // 27.2 + 76.5 + 102.2 = 205.9 m. Over the north wall: 32.0 + 130.0 = 162.0 m + 2.5 s.
      // Saves 43.9 m. PRD quoted 178 -> 118, but the pit is 160 m north of a town square that
      // contains the bank, so 118 m of walking is geometrically impossible. Measured values used.
      id: "wall_vault", name: "Wall Vault", reqLevel: 3,
      position: [-160, -56], exitPosition: [-160, -50],
      durationMs: 2500, savesMeters: 44,
      assetId: "wall_plaster_straight", scale: 1,
      fromLocationId: "bank_interior", toLocationId: "bracken_pit",
      interaction: "vault",
    },
  ],

  enemyGroups: [
    {
      id: "rill_skitterlings", family: "skitterling", name: "Rill Skitterling", tier: 1,
      count: 6, centre: [-88, -70], radius: 20,
      assetId: "enemy_crab", scale: 0.7,
      level: 2, maxHealth: 18, aggroRadius: 6, behaviour: "passive",
    },
    {
      id: "marchwolf_pups", family: "marchwolf", name: "Marchwolf Pup", tier: 1,
      count: 4, centre: [-250, 30], radius: 26,
      assetId: "enemy_blob", scale: 0.75,
      level: 4, maxHealth: 26, aggroRadius: 8, behaviour: "aggressive",
    },
  ],

  landmarks: [
    {
      // Round-1 critique finding 8: this was a bare `roof_tower` cone standing on the grass - the
      // "floating red cone" in r1-town-center. The tower's mass now comes from the `coldbrace_vault`
      // building (prefab `tower`, two brick storeys under the spire) at (-168,-90), and the landmark
      // moved 3.3 m south onto its doorway - a hero mesh that belongs at ground level, facing the
      // south gate the player spawns at.
      id: "march_vault_tower", name: "March Company Vault Tower", position: [-168, -93.3],
      assetId: "door_frame_round", scale: 1.5, rotationY: Math.PI,
      composition: "vault_door",
      blurb: "The tallest thing on the plain. Visible from 300 m, which is the entire point of it.",
    },
    {
      id: "broken_milestone", name: "The Broken North Milestone", position: [-108, -8],
      // No sign or milestone mesh exists (asset-report gap 11). A short brick wall reads as a
      // snapped stone marker; the composition puts the broken-off top on the ground beside it and
      // kerbs the road, so it reads as a marker rather than a random piece of wall.
      assetId: "wall_brick_straight", scale: 0.7, rotationY: 0.4,
      composition: "milestone",
      blurb: "Snapped off at the knee. Whatever it counted down to, nobody here has been there.",
    },
    {
      id: "lone_dead_palewood", name: "The Lone Palewood", position: [-196, 24],
      assetId: "tree_dead_3", scale: 0.85,
      blurb: "One dead Palewood at the top of the rise. Every direction from here looks the same.",
    },
  ],

  gates: [
    {
      id: "fallowmarch_north_gate", name: "North Gate", position: [-26, 118],
      assetId: "wall_arch", toRegionId: "vellenwood", toLocationId: "vellenwood_marchgate",
      rotationY: Math.PI / 2, composition: "region_gate",
    },
  ],

  adjacency: [
    { toRegionId: "vellenwood", fromLocationId: "fallowmarch_north_gate", toLocationId: "vellenwood_marchgate", meters: 14.6 },
  ],
};

// =============================================================== VELLENWOOD

/**
 * Tier 5 deep woodland. The gorge runs north-west to south-east from (110,200) to (250,20); every
 * feature is placed on a known side of it, which is what gives the three Agility shortcuts here
 * something real to shorten. Rootfall, the Duskoak Stand, and Blackwater Pools are west of the
 * gorge; the Thornline is east, reachable on foot only by the ford at (230,44) or the head at
 * (104,192).
 */
const VELLENWOOD: RegionDef = {
  id: "vellenwood",
  name: "Vellenwood",
  tier: 5,
  lore:
    "Within two hundred metres of the gate the sky closes. The Duskoak here are old enough that " +
    "the March Company surveyors marked them as terrain rather than trees. Rootfall is the only " +
    "settlement: nine buildings and a bank chest built on and around a stump so large the stump " +
    "is the town square. The people there will tell you which paths are safe. They will not tell " +
    "you why the Thornbound only move at the edges of the clearings.",
  bounds: { min: [-20, 10], max: [350, 200] },
  terrainSeed: 0x5e11d,
  terrainAmplitude: 26,
  baseHeight: 4,
  // Deep desaturated greens, bark browns pushed purple, a hard value break for shafted light.
  groundPalette: ["#3c5340", "#2b3a2e", "#4f6b4a", "#5c4a55", "#3a2f38", "#6f7f52", "#8fa26a", "#1d241f"],
  fogStart: 55,
  spawnPoint: [-12, 122],
  // Marchgate looks east down the track to Rootfall (60,120): atan2(72, -2) = 1.60 rad.
  spawnFacingRad: 1.6,
  respawnPointId: "rootfall",

  locations: [
    { id: "vellenwood_marchgate", name: "Marchgate", position: [-12, 122], kind: "gate", routeNode: true,
      blurb: "Vellenwood's gate onto the March Road. Named for the direction, not the compass." },
    { id: "rootfall_hamlet", name: "Rootfall", position: [60, 120], kind: "settlement", routeNode: true,
      blurb: "Nine buildings around a Duskoak stump the size of a square." },
    { id: "rootfall_bank", name: "Rootfall Bank Chest", position: [60, 128], kind: "bank", routeNode: true,
      blurb: "One chest, set into the stump. Thirty-eight metres from the Hollowcut Seam." },
    { id: "hollowcut_seam", name: "Hollowcut Seam", position: [94, 145], kind: "seam", routeNode: true,
      blurb: "Five Corven seams, 38 m from the bank chest. The best XP in the game until Agility 10." },
    { id: "vellenwood_canopy", name: "Duskoak Stand", position: [14, 166], kind: "grove", routeNode: true,
      blurb: "Ten Duskoak. The canopy closes hard enough here that pathing is the puzzle." },
    { id: "mire_skirt", name: "Mire Skirt", position: [-6, 120], kind: "junction", routeNode: true,
      blurb: "The long dry way around the standing water below the stand." },
    { id: "blackwater_pools", name: "Blackwater Pools", position: [128, 84], kind: "water", routeNode: true,
      blurb: "Five pools, deeper than they look. Bramble trout." },
    { id: "gorge_ford", name: "Gorge Ford", position: [230, 44], kind: "junction", routeNode: true,
      blurb: "The southern crossing of the gorge. Slow, wet, and the only way across without Agility." },
    { id: "gorge_head", name: "Gorge Head", position: [104, 192], kind: "junction", routeNode: true,
      blurb: "Where the gorge peters out against the northern ridge." },
    { id: "thornline_camp", name: "The Thornline", position: [196, 152], kind: "camp", routeNode: true,
      blurb: "The edge the Thornbound keep to. They do not enter the clearings and nobody says why." },
    { id: "vellenwood_east_gate", name: "Cairn Gate", position: [250, 24], kind: "gate", routeNode: true,
      blurb: "The east gate. On a clear day you can see the Karrowmoor ridge from it." },
  ],

  roads: [
    { from: "vellenwood_marchgate", to: "rootfall_hamlet" },
    { from: "rootfall_hamlet", to: "rootfall_bank" },
    { from: "rootfall_bank", to: "hollowcut_seam" },
    { from: "rootfall_hamlet", to: "mire_skirt" },
    { from: "mire_skirt", to: "vellenwood_canopy" },
    { from: "rootfall_hamlet", to: "blackwater_pools" },
    { from: "blackwater_pools", to: "gorge_ford" },
    { from: "gorge_ford", to: "thornline_camp" },
    { from: "gorge_ford", to: "vellenwood_east_gate" },
    { from: "rootfall_hamlet", to: "gorge_head" },
    { from: "gorge_head", to: "thornline_camp" },
    { from: "thornline_camp", to: "vellenwood_east_gate" },
  ],

  clusters: [
    {
      id: "hollowcut_corven", name: "Corven Seam", archetype: "ore",
      skill: "mining", tier: 5, reqLevel: 5, itemId: "corven_ore",
      count: 5, centre: [94, 145], radius: 9,
      assetId: "rock_medium_2",
      locationId: "hollowcut_seam",
    },
    {
      id: "duskoak_stand_trees", name: "Duskoak", archetype: "tree",
      skill: "woodcutting", tier: 5, reqLevel: 5, itemId: "duskoak_log",
      count: 10, centre: [14, 166], radius: 20,
      // Was tree_twisted_1. That family carries the `Leaves_TwistedTree` texture, whose sampled
      // mean is rgb(105,79,84) — an autumn tree. Ten of them at the heart of the region is what
      // made Vellenwood read crimson, and the tier tint cannot fix it: tinting multiplies
      // `material.color` against the texture, so it can darken a red leaf but can never re-hue one.
      // tree_common_2 carries the green `Leaves_NormalTree` texture, and staying off the scatter
      // canopy's 3 and 5 keeps the choppable tree distinguishable from the dressing. Scale 1.15
      // holds the old-growth read that 0.55 on a larger source mesh was buying.
      assetId: "tree_common_2", scale: 1.15,
      locationId: "vellenwood_canopy",
    },
    {
      id: "blackwater_spots", name: "Blackwater Pool", archetype: "fishing_spot",
      skill: "fishing", tier: 5, reqLevel: 5, itemId: "bramble_trout",
      count: 5, centre: [128, 84], radius: 12,
      assetId: "rope_coil", depletedAssetId: "rope_coil", scale: 1.2,
      locationId: "blackwater_pools",
    },
  ],

  settlement: {
    id: "rootfall",
    name: "Rootfall",
    // Exposed frame, a felled log along every ridge, dormers in the roof. A logging town.
    kit: "timber",
    centre: [60, 120],
    respawnPointId: "rootfall",
    buildings: [
      { id: "rootfall_house_1", name: "Stumpside House", prefab: "cottage", position: [46, 132], rotationY: -Math.PI / 2, footprint: [6, 4] },
      { id: "rootfall_house_2", name: "Woodward's House", prefab: "cottage", position: [46, 118], rotationY: -Math.PI / 2, footprint: [6, 4] },
      { id: "rootfall_house_3", name: "Trapper's House", prefab: "cottage", position: [48, 108], rotationY: 0, footprint: [6, 4] },
      { id: "rootfall_house_4", name: "Cook House", prefab: "cottage", position: [60, 106], rotationY: 0, footprint: [6, 4] },
      { id: "rootfall_house_5", name: "Root House", prefab: "cottage", position: [72, 108], rotationY: 0, footprint: [6, 4] },
      { id: "rootfall_house_6", name: "Seamer's House", prefab: "cottage", position: [74, 118], rotationY: Math.PI / 2, footprint: [6, 4] },
      // Pulled 5 m south of its round-1 spot: assembled, its 6x4 footprint swallowed the Root
      // Tunnel entrance at (76,134), whose 155 m saving is measured from that exact coordinate.
      { id: "rootfall_house_7", name: "Warden's House", prefab: "cottage", position: [74, 127], rotationY: Math.PI / 2, footprint: [6, 4] },
      { id: "rootfall_house_8", name: "North House", prefab: "cottage", position: [62, 140], rotationY: Math.PI, footprint: [6, 4] },
      { id: "rootfall_shed", name: "Drying Shed", prefab: "shed", position: [50, 140], rotationY: Math.PI, footprint: [4, 4] },
    ],
    stations: [
      { id: "rootfall_range", name: "Rootfall Cooking Range", kind: "range", skill: "cooking", position: [54, 112], rotationY: 0, assetId: "cooking_pot", scale: 1.6, recipeIds: [] },
      { id: "rootfall_anvil", name: "Rootfall Anvil", kind: "anvil", skill: "smithing", position: [68, 112], rotationY: 0, assetId: "anvil", recipeIds: [] },
    ],
    bank: { id: "rootfall_bank_chest", name: "Rootfall Bank Chest", position: [60, 128], rotationY: Math.PI, assetId: "chest_wood" },
    shops: [
      { id: "rootfall_general", name: "Rootfall Trade Post", shopKind: "general", position: [52, 126], rotationY: Math.PI / 2, assetId: "market_stall" },
    ],
    npcs: [
      { id: "npc_woodward_ansel", name: "Woodward Ansel", position: [56, 122], facingRad: Math.PI / 2, assetId: "base_male", dialogueRootId: "ansel_root", questIds: [] },
      { id: "npc_seamer_juno", name: "Seamer Juno", position: [64, 126], facingRad: -Math.PI / 2, assetId: "base_female", dialogueRootId: "juno_root", questIds: [] },
      { id: "npc_trapper_mott", name: "Trapper Mott", position: [66, 116], facingRad: Math.PI, assetId: "base_male", dialogueRootId: "mott_root", questIds: [] },
    ],
  },

  obstacles: [
    {
      // Rootfall -> Duskoak Stand on foot has to skirt the standing water via Mire Skirt:
      // 66.0 + 50.2 = 116.2 m. Over the canopy: 26.9 to the first platform + 11.7 off the last
      // = 38.6 m + 4.0 s. Saves 77.6 m, and 27.7 s of walking becomes 13.2 s.
      id: "canopy_walk", name: "Canopy Walk", reqLevel: 6,
      position: [40, 138], exitPosition: [24, 172],
      durationMs: 4000, savesMeters: 78,
      assetId: "balcony_straight", scale: 1.4,
      fromLocationId: "rootfall_hamlet", toLocationId: "vellenwood_canopy",
      interaction: "climb",
    },
    {
      // Blackwater Pools -> Thornline on foot goes right round to the ford: 109.6 + 113.2 =
      // 222.8 m. Over the fallen tree: 52.0 + 56.1 = 108.1 m + 3.0 s. Saves 114.7 m.
      // PRD quoted 85 m; that assumed a 380 m region. Measured value used.
      id: "fallen_duskoak", name: "The Fallen Duskoak", reqLevel: 5,
      position: [176, 104], exitPosition: [200, 96],
      durationMs: 3000, savesMeters: 115,
      // `roof_log` is a 10.7 m timber beam - the only asset in the library shaped like a felled
      // trunk lying across a gap. The tree meshes cannot be laid flat: `view` has rotationY only.
      assetId: "roof_log", scale: 1.5, rotationY: -0.32,
      fromLocationId: "blackwater_pools", toLocationId: "thornline_camp",
      interaction: "climb",
    },
    {
      // Rootfall -> Thornline on foot goes round the gorge head: 84.4 + 100.3 = 184.7 m.
      // Through the roots: 21.3 + 8.2 = 29.5 m + 3.5 s. Saves 155.2 m. PRD quoted 110 m.
      id: "root_tunnel", name: "Root Tunnel", reqLevel: 8,
      position: [76, 134], exitPosition: [188, 154],
      durationMs: 3500, savesMeters: 155,
      assetId: "wall_arch", scale: 1.2, rotationY: 0.6,
      fromLocationId: "rootfall_hamlet", toLocationId: "thornline_camp",
      interaction: "enter",
    },
  ],

  enemyGroups: [
    {
      id: "thornbound_husks", family: "thornbound", name: "Thornbound Husk", tier: 5,
      count: 5, centre: [196, 152], radius: 22,
      // The fantasy kits ship no non-humanoid monsters (asset-report gap 1). enemy_bee is the
      // only rig that hovers, which is the read a drifting husk wants.
      assetId: "enemy_bee", scale: 0.65,
      level: 14, maxHealth: 58, aggroRadius: 9, behaviour: "territorial",
    },
    {
      id: "bramble_skitterlings", family: "skitterling", name: "Bramble Skitterling", tier: 5,
      count: 5, centre: [150, 128], radius: 20,
      assetId: "enemy_crab", scale: 0.72,
      level: 10, maxHealth: 42, aggroRadius: 7, behaviour: "aggressive",
    },
    {
      id: "marchwolves_deepwood", family: "marchwolf", name: "Marchwolf", tier: 5,
      count: 4, centre: [40, 162], radius: 24,
      assetId: "enemy_blob", scale: 0.8,
      level: 12, maxHealth: 50, aggroRadius: 10, behaviour: "aggressive",
    },
  ],

  landmarks: [
    {
      id: "rootfall_stump", name: "The Rootfall Stump", position: [60, 120],
      // A real Duskoak, cut off just above the flare of its roots. The library ships no stump, and
      // the round-3 stand-in was `anvil_log` — an anvil that happens to sit on a log — drawn at
      // five times scale, so Rootfall's town square was a giant anvil. `clipFraction` keeps the
      // lowest quarter of the same twisted oak that stands split on the ridge above the town.
      assetId: "tree_twisted_2", scale: 2.0, clipFraction: 0.24,
      composition: "rootfall_stump",
      blurb: "The stump is the square. Somebody has cut steps into the north face of it.",
    },
    {
      id: "split_duskoak", name: "The Split Duskoak", position: [170, 112],
      assetId: "tree_twisted_2", scale: 0.8, rotationY: 1.1,
      blurb: "Split top to root by something, a long time ago. It is still alive on one side.",
    },
    {
      id: "thornline_stones", name: "The Thornline Stones", position: [206, 168],
      assetId: "boulder_medium", scale: 1.1,
      composition: "standing_stones",
      blurb: "Standing stones at the clearing edge. The Thornbound will not cross them.",
    },
  ],

  gates: [
    { id: "vellenwood_marchgate", name: "Marchgate", position: [-12, 122], assetId: "wall_arch", toRegionId: "fallowmarch", toLocationId: "fallowmarch_north_gate", rotationY: Math.PI / 2, composition: "region_gate" },
    { id: "vellenwood_east_gate", name: "Cairn Gate", position: [250, 24], assetId: "wall_arch", toRegionId: "karrowmoor", toLocationId: "karrowmoor_north_gate", rotationY: 0, composition: "region_gate" },
  ],

  adjacency: [
    { toRegionId: "fallowmarch", fromLocationId: "vellenwood_marchgate", toLocationId: "fallowmarch_north_gate", meters: 14.6 },
    { toRegionId: "karrowmoor", fromLocationId: "vellenwood_east_gate", toLocationId: "karrowmoor_north_gate", meters: 22.8 },
  ],
};

// =============================================================== KARROWMOOR

/**
 * Tier 10 stone highlands. Four terraces climbing southward, 62 m of elevation across them.
 * The terrace bands are what make the road from Highcairn to the Upper Karrow Seam 188 m long
 * while the straight line is only 61 m - which is the whole reason Sunder Ledge is worth 10
 * Agility levels. See the DISTANCE LEDGER at the top of this file.
 */
const KARROWMOOR: RegionDef = {
  id: "karrowmoor",
  name: "Karrowmoor",
  tier: 10,
  lore:
    "Fallowmarch tilted sixty degrees with the soil taken away. The moor climbs in terraces of " +
    "grey slate and every flat surface on it is covered in cairns nobody in Highcairn built and " +
    "nobody in Highcairn will move. The outpost is a quarry camp with a wall, kept alive by " +
    "Kaldite and by the fact that the crew stopped digging six months ago. What they hit was the " +
    "Gravelmaw. They have a rota for who watches the entrance. They have never discussed sealing it.",
  bounds: { min: [-20, -200], max: [350, 10] },
  terrainSeed: 0x0ca770,
  terrainAmplitude: 62,
  baseHeight: 8,
  terraces: [
    { index: 1, minZ: -40, maxZ: 10, height: 0 },
    { index: 2, minZ: -76, maxZ: -40, height: 18 },
    { index: 3, minZ: -112, maxZ: -76, height: 36 },
    { index: 4, minZ: -200, maxZ: -112, height: 54 },
  ],
  // Cold blue-grey slate, lichen green-yellow, one warm firelight per camp.
  groundPalette: ["#6b7480", "#525a66", "#7d8791", "#8e9a86", "#a8b06a", "#3e444d", "#c8813c", "#d3d8dd"],
  fogStart: 140,
  spawnPoint: [256, 4],
  // Moorgate looks WSW down the quarry road to the Moor Road Bend (170,-6): atan2(-86,-10) = -1.69.
  spawnFacingRad: -1.69,
  respawnPointId: "highcairn",

  locations: [
    { id: "karrowmoor_north_gate", name: "Moorgate", position: [256, 4], kind: "gate", routeNode: true,
      blurb: "Where the Vellenwood road tips over onto the first terrace." },
    { id: "moor_road_bend", name: "Moor Road Bend", position: [170, -6], kind: "junction", routeNode: true,
      blurb: "The quarry road forks here: down to the Lower Quarry, or up to Highcairn." },
    { id: "karrowmoor_terraces", name: "Lower Quarry", position: [60, -16], kind: "seam", routeNode: true,
      blurb: "Terrace one. Five Kaldite faces, and the hole the crew stopped digging." },
    { id: "gravelmaw_entrance", name: "The Gravelmaw", position: [46, -24], kind: "dungeon", routeNode: true,
      blurb: "A twelve-metre black wound in grey stone. Visible from anywhere on terrace one." },
    { id: "highcairn_outpost", name: "Highcairn", position: [144, -66], kind: "settlement", routeNode: true,
      blurb: "Terrace two. A quarry camp with a wall around it and a crane it no longer uses." },
    { id: "highcairn_bank", name: "Highcairn Bank", position: [150, -70], kind: "bank", routeNode: true,
      blurb: "One counter. 188 m from the Upper Karrow Seam by road, 46 m over Sunder Ledge." },
    { id: "highcairn_plots", name: "Highcairn Plots", position: [128, -58], kind: "farm", routeNode: true,
      blurb: "Four plots in the lee of the wall. Cairnleaf takes fifteen minutes to come up." },
    { id: "karrow_ramp_two", name: "Second Ramp", position: [100, -80], kind: "junction", routeNode: true,
      blurb: "The slate ramp from terrace two to terrace three." },
    { id: "karrow_ramp_three", name: "Third Ramp", position: [118, -138], kind: "junction", routeNode: true,
      blurb: "The long ramp onto terrace four. Everything above here is exposed." },
    { id: "upper_karrow_seam", name: "Upper Karrow Seam", position: [194, -132], kind: "seam", routeNode: true,
      blurb: "Three Kaldite faces on terrace four. A small seam - it genuinely runs dry above Mining 20." },
    { id: "great_cairn", name: "The Great Cairn", position: [140, -176], kind: "landmark", routeNode: true,
      blurb: "The largest cairn on the moor. Nobody will say who is under it." },
    { id: "cairn_tarns", name: "Cairn Tarns", position: [206, -88], kind: "water", routeNode: true,
      blurb: "Two black tarns on the terrace two lip. Cragfin in both." },
    { id: "ridge_pines", name: "Ridge Pines", position: [250, -96], kind: "grove", routeNode: true,
      blurb: "Eight Cairnpine on terrace three, all bent the same way." },
    { id: "far_tarn", name: "Far Tarn", position: [284, -110], kind: "water", routeNode: true,
      blurb: "Across the terrace three gap. Two more tarns, and nobody fishing them." },
    { id: "tarn_track", name: "Tarn Track", position: [300, -80], kind: "junction", routeNode: true,
      blurb: "The long way round the terrace three gap." },
  ],

  roads: [
    { from: "karrowmoor_north_gate", to: "moor_road_bend" },
    { from: "moor_road_bend", to: "karrowmoor_terraces" },
    { from: "karrowmoor_terraces", to: "gravelmaw_entrance" },
    { from: "moor_road_bend", to: "highcairn_outpost" },
    { from: "karrowmoor_terraces", to: "highcairn_outpost" },
    { from: "highcairn_outpost", to: "highcairn_bank" },
    { from: "highcairn_outpost", to: "highcairn_plots" },
    { from: "highcairn_bank", to: "karrow_ramp_two" },
    { from: "karrow_ramp_two", to: "karrow_ramp_three" },
    { from: "karrow_ramp_three", to: "upper_karrow_seam" },
    { from: "karrow_ramp_three", to: "great_cairn" },
    { from: "highcairn_outpost", to: "cairn_tarns" },
    { from: "cairn_tarns", to: "ridge_pines" },
    { from: "ridge_pines", to: "tarn_track" },
    { from: "tarn_track", to: "far_tarn" },
  ],

  clusters: [
    {
      id: "lower_quarry_kaldite", name: "Kaldite Face", archetype: "ore",
      skill: "mining", tier: 10, reqLevel: 10, itemId: "kaldite_ore",
      count: 5, centre: [60, -16], radius: 10,
      assetId: "rock_medium_3",
      locationId: "karrowmoor_terraces",
    },
    {
      // Three nodes on purpose. Architecture R5: this seam genuinely runs dry above Mining 20,
      // which is what pushes a player back to the Lower Quarry or onto the Sunder Ledge circuit.
      id: "upper_karrow_kaldite", name: "Upper Kaldite Face", archetype: "ore",
      skill: "mining", tier: 10, reqLevel: 10, itemId: "kaldite_ore",
      count: 3, centre: [194, -132], radius: 7,
      assetId: "rock_medium_1",
      locationId: "upper_karrow_seam",
    },
    {
      id: "ridge_pines_trees", name: "Cairnpine", archetype: "tree",
      skill: "woodcutting", tier: 10, reqLevel: 10, itemId: "cairnpine_log",
      count: 8, centre: [250, -96], radius: 18,
      assetId: "tree_pine_2", scale: 0.95,
      locationId: "ridge_pines",
    },
    {
      id: "cairn_tarn_spots", name: "Cairn Tarn", archetype: "fishing_spot",
      skill: "fishing", tier: 10, reqLevel: 10, itemId: "cragfin",
      count: 2, centre: [206, -88], radius: 8,
      assetId: "rope_coil", depletedAssetId: "rope_coil", scale: 1.2,
      locationId: "cairn_tarns",
    },
    {
      id: "far_tarn_spots", name: "Far Tarn", archetype: "fishing_spot",
      skill: "fishing", tier: 10, reqLevel: 10, itemId: "cragfin",
      count: 2, centre: [284, -110], radius: 7,
      assetId: "rope_coil", depletedAssetId: "rope_coil", scale: 1.2,
      locationId: "far_tarn",
    },
    {
      id: "highcairn_plot_beds", name: "Highcairn Plot", archetype: "farm_plot",
      skill: "farming", tier: 10, reqLevel: 10, itemId: "cairnleaf",
      count: 4, centre: [128, -58], radius: 6,
      assetId: "crop_carrot",
      locationId: "highcairn_plots",
    },
  ],

  settlement: {
    id: "highcairn",
    name: "Highcairn",
    // Brick and cut stone to the eaves, brick piers, gable ends closed in stone, and the shallower
    // six-wide roof. A town built out of the quarry it works.
    kit: "stone",
    centre: [144, -66],
    respawnPointId: "highcairn",
    buildings: [
      { id: "highcairn_hut_1", name: "Crew Hut", prefab: "quarry_hut", position: [132, -58], rotationY: 0, footprint: [5, 4] },
      // Moved 4 m west and 2 m south of its round-1 spot: with the hut actually assembled, its 5x4
      // footprint enclosed the Highcairn furnace at (136,-72).
      { id: "highcairn_hut_2", name: "Foreman's Hut", prefab: "quarry_hut", position: [130, -74], rotationY: 0, footprint: [5, 4] },
      { id: "highcairn_hut_3", name: "Store Hut", prefab: "quarry_hut", position: [146, -56], rotationY: Math.PI, footprint: [5, 4] },
      { id: "highcairn_hut_4", name: "Watch Hut", prefab: "quarry_hut", position: [156, -68], rotationY: Math.PI / 2, footprint: [5, 4] },
      { id: "highcairn_hut_5", name: "Tool Hut", prefab: "quarry_hut", position: [142, -78], rotationY: 0, footprint: [5, 4] },
      { id: "highcairn_hut_6", name: "Long Hut", prefab: "quarry_hut", position: [126, -66], rotationY: -Math.PI / 2, footprint: [5, 4] },
      { id: "highcairn_gate", name: "Highcairn Gate", prefab: "gatehouse", position: [160, -58], rotationY: Math.PI / 2, footprint: [6, 3] },
      { id: "highcairn_wall_n", name: "North Wall", prefab: "wall_segment", position: [144, -52], rotationY: 0, footprint: [8, 1] },
      { id: "highcairn_wall_s", name: "South Wall", prefab: "wall_segment", position: [144, -82], rotationY: 0, footprint: [8, 1] },
      { id: "highcairn_wall_w", name: "West Wall", prefab: "wall_segment", position: [122, -68], rotationY: Math.PI / 2, footprint: [8, 1] },
    ],
    stations: [
      { id: "highcairn_furnace", name: "Highcairn Furnace", kind: "furnace", skill: "smithing", position: [136, -72], rotationY: 0, assetId: "cauldron", recipeIds: [] },
      { id: "highcairn_anvil", name: "Highcairn Anvil", kind: "anvil", skill: "smithing", position: [140, -72], rotationY: 0, assetId: "anvil", recipeIds: [] },
      { id: "highcairn_range", name: "Highcairn Cooking Range", kind: "range", skill: "cooking", position: [148, -76], rotationY: 0, assetId: "cooking_pot", scale: 1.6, recipeIds: [] },
    ],
    bank: { id: "highcairn_bank_counter", name: "Highcairn Bank", position: [150, -70], rotationY: Math.PI, assetId: "chest_wood" },
    shops: [
      { id: "highcairn_general", name: "Highcairn Camp Store", shopKind: "general", position: [138, -62], rotationY: Math.PI / 2, assetId: "market_stall" },
      { id: "highcairn_smith", name: "Quarry Smith", shopKind: "smith", position: [152, -60], rotationY: -Math.PI / 2, assetId: "market_stall_cart" },
    ],
    npcs: [
      { id: "npc_foreman_arden", name: "Foreman Arden", position: [144, -60], facingRad: Math.PI, assetId: "base_male", dialogueRootId: "arden_root", questIds: [] },
      { id: "npc_quarrier_vess", name: "Quarrier Vess", position: [148, -66], facingRad: -Math.PI / 2, assetId: "base_female", dialogueRootId: "vess_root", questIds: [] },
      { id: "npc_cairnkeeper_ode", name: "Cairnkeeper Ode", position: [138, -68], facingRad: Math.PI / 2, assetId: "base_female", dialogueRootId: "ode_root", questIds: [] },
      { id: "npc_watcher_hale", name: "Watcher Hale", position: [152, -74], facingRad: 0, assetId: "base_male", dialogueRootId: "hale_root", questIds: [] },
    ],
  },

  obstacles: [
    {
      // THE FLIP. Road: 51.0 + 60.7 + 76.2 = 187.9 m. Ledge: 20.4 + 25.5 = 45.9 m + 6.0 s.
      // Saves 142.0 m. See the DISTANCE LEDGER at the top of this file for the XP/hr arithmetic.
      id: "sunder_ledge", name: "Sunder Ledge", reqLevel: 10,
      position: [170, -74], exitPosition: [176, -114],
      durationMs: 6000, savesMeters: 142,
      // The Stylized Nature kit tops out at a 3.2 m rock; the platformer pack's cliff steps are
      // the only 5-7 m stone in the library (asset-report gap 9). Tinted to the slate palette.
      assetId: "cliff_step_2", scale: 1.2, rotationY: 0.4,
      fromLocationId: "highcairn_bank", toLocationId: "upper_karrow_seam",
      interaction: "climb",
    },
    {
      // One-way, downhill. Walking the same trip is great_cairn -> ramp three -> ramp two ->
      // bank -> outpost -> quarry = 260.6 m; the slide is 44.4 + 48.7 = 93.1 m + 3.2 s.
      id: "scree_slide", name: "Scree Slide", reqLevel: 12,
      position: [96, -170], exitPosition: [108, -24],
      durationMs: 3200, savesMeters: 168,
      assetId: "cliff_step_3", scale: 1.3,
      fromLocationId: "great_cairn", toLocationId: "karrowmoor_terraces",
      oneWay: true,
      interaction: "climb",
    },
    {
      // Opens the second tarn pair as a fishing circuit. Round the gap: 52.5 + 34.0 = 86.5 m.
      // Across it: 8.9 + 14.4 = 23.3 m + 3.0 s. Saves 63.2 m.
      id: "cairn_leap", name: "Cairn Leap", reqLevel: 14,
      position: [246, -104], exitPosition: [272, -118],
      durationMs: 3000, savesMeters: 63,
      assetId: "boulder_medium", scale: 1.1,
      fromLocationId: "ridge_pines", toLocationId: "far_tarn",
      interaction: "vault",
    },
  ],

  enemyGroups: [
    {
      id: "cairnwights_fields", family: "cairnwight", name: "Cairnwight", tier: 10,
      count: 5, centre: [100, -110], radius: 26,
      assetId: "enemy_skull", scale: 0.8,
      level: 24, maxHealth: 96, aggroRadius: 10, behaviour: "aggressive",
    },
    {
      id: "scree_skitterlings", family: "skitterling", name: "Scree Skitterling", tier: 10,
      count: 6, centre: [170, -160], radius: 24,
      assetId: "enemy_crab", scale: 0.75,
      level: 20, maxHealth: 78, aggroRadius: 8, behaviour: "aggressive",
    },
    {
      id: "thornbound_elders_ridge", family: "thornbound", name: "Thornbound Elder", tier: 10,
      count: 3, centre: [268, -140], radius: 18,
      assetId: "enemy_bee", scale: 0.7,
      level: 28, maxHealth: 120, aggroRadius: 11, behaviour: "territorial",
    },
  ],

  landmarks: [
    {
      id: "highcairn_crane", name: "The Highcairn Crane", position: [156, -64],
      // No crane mesh. Round 1 used `support_beam` at 3x, which floats: that asset's pivot is
      // 1.211 m BELOW the post, so a 3x copy started 3.6 m in the air. `corner_wood` is the only
      // asset in the library that is a plain vertical post standing on its own origin - at 3.2x it
      // is a 9.6 m mast, and the composition hangs a 9 m jib and the drum off it.
      assetId: "corner_wood", scale: 3.2, rotationY: 0.3,
      composition: "highcairn_crane",
      blurb: "It has not turned in six months. The rope is still on the drum.",
    },
    {
      id: "great_cairn_stone", name: "The Great Cairn", position: [140, -176],
      assetId: "boulder_large", scale: 1.3,
      composition: "great_cairn",
      blurb: "Head height and forty paces round. It was already old when the quarry opened.",
    },
    // The Gravelmaw mouth is a PRD landmark but it is not listed here: it is already the dungeon
    // portal entity, at the same position with the same mesh. Two entities stacked on one spot
    // would be two draw calls and two highlight rings for one thing the player sees.
  ],

  gates: [
    { id: "karrowmoor_north_gate", name: "Moorgate", position: [256, 4], assetId: "wall_arch", toRegionId: "vellenwood", toLocationId: "vellenwood_east_gate", rotationY: 0, composition: "region_gate" },
  ],

  adjacency: [
    { toRegionId: "vellenwood", fromLocationId: "karrowmoor_north_gate", toLocationId: "vellenwood_east_gate", meters: 22.8 },
  ],

  dungeon: {
    id: "gravelmaw",
    name: "The Gravelmaw",
    tier: 10,
    entrance: [46, -24],
    // `wall_arch` is 2 x 3 m, so 4x is the PRD's "twelve-metre black wound": 8 m wide, 12 m tall.
    // Round 1 drew it unrotated and unaccompanied, which is why it read as a wooden door frame on
    // open ground. It now faces the approach from the Lower Quarry (60,-16): atan2(14,8) = 1.05.
    entranceAssetId: "wall_arch",
    entranceRotationY: 1.05,
    entranceScale: 4,
    entranceComposition: "gravelmaw_mouth",
    palette: ["#3a3f47", "#2a2e35", "#4a505a", "#5a6250", "#1b1e23", "#7a6a52", "#c86a2a", "#8f97a1"],
    chambers: [
      { id: "gravelmaw_chamber1", name: "The Lit Gallery", centre: [40, -40], radius: 11, floorOffset: -2, lit: true },
      { id: "gravelmaw_chamber2", name: "The Collapse", centre: [30, -58], radius: 12, floorOffset: -6, lit: false },
      { id: "gravelmaw_chamber3", name: "The Cairn Hall", centre: [22, -76], radius: 12, floorOffset: -10, lit: false },
      { id: "gravelmaw_arena", name: "The Quarrykeeper's Floor", centre: [10, -96], radius: 12, floorOffset: -12, lit: true },
    ],
    doors: [
      {
        id: "gravelmaw_stone_door", name: "The Three-Lever Door", position: [26, -68], floorOffset: -8,
        // `cage` is the library's portcullis stand-in (asset-report gap 8).
        assetId: "cage", state: "locked",
        lockedReason: "Three stone levers hold it. The Long Cairn's fifth stage describes them.",
      },
      {
        id: "ordrun_gate", name: "The Quarrykeeper's Gate", position: [14, -88], floorOffset: -11,
        assetId: "cage", state: "sealed",
        lockedReason: "Sealed until The Long Cairn is complete.",
      },
    ],
    obstacles: [
      {
        // This one is not about distance. Chamber 2 to chamber 3 is only 19.7 m on foot, but that
        // walk goes through the three-lever door, so below Agility 14 it is not a walk at all -
        // it is a puzzle. The chimney is 8.9 + 4.0 = 12.9 m of scramble plus 3.8 s, saving 6.8 m
        // and the whole lever sequence. It is the only route-graph edge between the two chambers,
        // on purpose; round 5 adds a conditional walk edge when the door is opened.
        id: "chimney_climb", name: "Chimney Climb", reqLevel: 14,
        position: [34, -66], exitPosition: [22, -80],
        durationMs: 3800, savesMeters: 7,
        assetId: "stairs_stone", scale: 1.1, rotationY: Math.PI,
        fromLocationId: "gravelmaw_chamber2", toLocationId: "gravelmaw_chamber3",
        interaction: "climb",
      },
    ],
    enemyGroups: [
      {
        id: "gravelmaw_ch1_wights", family: "cairnwight", name: "Cairnwight", tier: 10,
        count: 4, centre: [40, -40], radius: 8,
        assetId: "enemy_skull", scale: 0.8,
        level: 24, maxHealth: 96, aggroRadius: 9, behaviour: "aggressive",
      },
      {
        id: "gravelmaw_ch2_skitterlings", family: "skitterling", name: "Scree Skitterling", tier: 10,
        count: 6, centre: [30, -58], radius: 9,
        assetId: "enemy_crab", scale: 0.75,
        level: 20, maxHealth: 78, aggroRadius: 8, behaviour: "aggressive",
      },
      {
        id: "gravelmaw_ch3_elders", family: "thornbound", name: "Thornbound Elder", tier: 10,
        count: 2, centre: [22, -76], radius: 7,
        assetId: "enemy_bee", scale: 0.7,
        level: 28, maxHealth: 120, aggroRadius: 11, behaviour: "territorial",
      },
      {
        // Ordrun. Two phases, 24 m leash, ground slam from 55% health. Round 4 owns the fight;
        // this is the spawn and the silhouette. 1.6x on a 1.5 m skull is a 2.4 m stone thing.
        id: "ordrun", family: "quarrykeeper", name: "Ordrun the Quarrykeeper", tier: 10,
        count: 1, centre: [10, -96], radius: 0,
        // Was enemy_skull, which renders as a featureless pale egg — no silhouette, no read at
        // any distance, and nothing that says "quarrykeeper". The asset report's recommended
        // substitute for the missing boss mesh is a humanoid given a stone treatment and scale;
        // the tier 10 palette does the stone, and being the only man-shaped thing in a room of
        // crabs and skulls does the rest.
        assetId: "outfit_male_ranger", scale: 1.35,
        level: 20, maxHealth: 200, aggroRadius: 24, behaviour: "territorial", boss: true,
      },
    ],
    locations: [
      { id: "gravelmaw_chamber1", name: "The Lit Gallery", position: [40, -40], kind: "dungeon", routeNode: true,
        blurb: "Chamber one. Someone has kept the torches burning, which is worse than if they had not." },
      { id: "gravelmaw_chamber2", name: "The Collapse", position: [30, -58], kind: "dungeon", routeNode: true,
        blurb: "Chamber two. Dark, fallen in, and a stone door with three levers." },
      { id: "gravelmaw_chamber3", name: "The Cairn Hall", position: [22, -76], kind: "dungeon", routeNode: true,
        blurb: "Chamber three. Cairns, indoors, arranged since the crew left." },
      { id: "gravelmaw_arena", name: "The Quarrykeeper's Floor", position: [10, -96], kind: "dungeon", routeNode: true,
        blurb: "A twenty-four metre circle of swept stone." },
    ],
    roads: [
      { from: "gravelmaw_entrance", to: "gravelmaw_chamber1" },
      { from: "gravelmaw_chamber1", to: "gravelmaw_chamber2" },
      // No walk edge from chamber 2 to chamber 3: the three-lever door stands in it. The Chimney
      // Climb is the only route-graph link until round 5 opens the door.
      { from: "gravelmaw_chamber3", to: "gravelmaw_arena" },
    ],
  },
};

// ------------------------------------------------------------------- exports

/** The three surface regions, in a fixed order. `buildWorld` iterates this to stay deterministic. */
export const REGIONS: readonly RegionDef[] = [FALLOWMARCH, VELLENWOOD, KARROWMOOR];

export const STARTING_REGION: RegionId = "fallowmarch";

export function getRegion(id: RegionId): RegionDef | undefined {
  for (const region of REGIONS) if (region.id === id) return region;
  return undefined;
}

/** Every location across every region, including the dungeon's. Order is stable. */
export function allLocations(): { regionId: RegionId; location: LocationDef }[] {
  const out: { regionId: RegionId; location: LocationDef }[] = [];
  for (const region of REGIONS) {
    for (const location of region.locations) out.push({ regionId: region.id, location });
    const dungeon = region.dungeon;
    if (dungeon) {
      for (const location of dungeon.locations) out.push({ regionId: dungeon.id, location });
    }
  }
  return out;
}

export function findLocation(id: string): { regionId: RegionId; location: LocationDef } | undefined {
  for (const entry of allLocations()) if (entry.location.id === id) return entry;
  return undefined;
}

/** Horizontal distance between two authored ground positions. */
export function spotDistance(a: Spot, b: Spot): number {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Content validation, for `content/validate.ts` to call at boot. Returns a list of problems rather
 * than throwing, so the root can surface all of them at once in `getErrors()`.
 *
 * It checks the things that silently produce a broken world: a road pointing at a location that
 * does not exist, an obstacle wired to a missing route node, a cluster outside its region bounds,
 * a palette that is not eight swatches, or a settlement placed outside its own region.
 *
 * Pass `knownAssetIds` (`new Set(assetRegistry.ids())` once the manifest has loaded) and it also
 * checks every asset id the content names, including every part id the prefabs and landmark
 * compositions in `render/buildings.ts` can emit. Round-1 critique finding 1 was 37 buildings that
 * rendered as nothing; a prefab that names an asset the manifest does not have would fail the same
 * way, silently, so it is checked here rather than discovered in a screenshot.
 */
export function validateRegions(knownAssetIds?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  const checkAsset = (where: string, assetId: string | undefined): void => {
    if (!assetId || !knownAssetIds) return;
    if (!knownAssetIds.has(assetId)) problems.push(`${where}: unknown asset "${assetId}"`);
  };

  if (knownAssetIds) {
    for (const assetId of prefabPartAssetIds()) checkAsset("prefabs", assetId);
    for (const assetId of compositionPartAssetIds()) checkAsset("landmark compositions", assetId);
  }

  const inBounds = (bounds: RegionBounds, spot: Spot): boolean =>
    spot[0] >= bounds.min[0] && spot[0] <= bounds.max[0] &&
    spot[1] >= bounds.min[1] && spot[1] <= bounds.max[1];

  for (const region of REGIONS) {
    if (region.groundPalette.length !== 8) {
      problems.push(`${region.id}: groundPalette has ${region.groundPalette.length} swatches, expected 8`);
    }
    if (!inBounds(region.bounds, region.spawnPoint)) {
      problems.push(`${region.id}: spawnPoint is outside the region bounds`);
    }

    const locationIds = new Set(region.locations.map((location) => location.id));
    for (const location of region.locations) {
      if (seenIds.has(location.id)) problems.push(`duplicate location id ${location.id}`);
      seenIds.add(location.id);
      if (!inBounds(region.bounds, location.position)) {
        problems.push(`${region.id}: location ${location.id} is outside the region bounds`);
      }
    }

    for (const road of region.roads) {
      if (!locationIds.has(road.from)) problems.push(`${region.id}: road from unknown location ${road.from}`);
      if (!locationIds.has(road.to)) problems.push(`${region.id}: road to unknown location ${road.to}`);
    }

    for (const cluster of region.clusters) {
      if (cluster.count < 1) problems.push(`${region.id}: cluster ${cluster.id} has no nodes`);
      if (!locationIds.has(cluster.locationId)) {
        problems.push(`${region.id}: cluster ${cluster.id} references unknown location ${cluster.locationId}`);
      }
      if (!inBounds(region.bounds, cluster.centre)) {
        problems.push(`${region.id}: cluster ${cluster.id} is outside the region bounds`);
      }
    }

    for (const obstacle of region.obstacles) {
      if (!locationIds.has(obstacle.fromLocationId)) {
        problems.push(`${region.id}: obstacle ${obstacle.id} starts at unknown location ${obstacle.fromLocationId}`);
      }
      if (!locationIds.has(obstacle.toLocationId)) {
        problems.push(`${region.id}: obstacle ${obstacle.id} ends at unknown location ${obstacle.toLocationId}`);
      }
      if (obstacle.durationMs <= 0) problems.push(`${region.id}: obstacle ${obstacle.id} has no duration`);
    }

    for (const gate of region.gates) {
      if (!locationIds.has(gate.id)) {
        problems.push(`${region.id}: gate ${gate.id} has no matching route node`);
      }
    }

    for (const adjacency of region.adjacency) {
      const target = getRegion(adjacency.toRegionId);
      if (!target) {
        problems.push(`${region.id}: adjacency points at unknown region ${adjacency.toRegionId}`);
        continue;
      }
      if (!target.locations.some((location) => location.id === adjacency.toLocationId)) {
        problems.push(`${region.id}: adjacency points at unknown location ${adjacency.toLocationId}`);
      }
    }

    if (!inBounds(region.bounds, region.settlement.centre)) {
      problems.push(`${region.id}: settlement ${region.settlement.id} is outside the region bounds`);
    }

    // Buildings. An unknown prefab, a zero footprint, or a building outside its own region all
    // produce a settlement that is invisible or in the wrong place, and all three are silent.
    const settlement = region.settlement;
    if (!isKitId(settlement.kit)) {
      problems.push(
        `${region.id}: settlement ${settlement.id} names unknown building kit ` +
        `"${String(settlement.kit)}" (known: ${KIT_IDS.join(", ")})`,
      );
    }
    for (const building of settlement.buildings) {
      if (seenIds.has(building.id)) problems.push(`duplicate building id ${building.id}`);
      seenIds.add(building.id);
      if (!isPrefabId(building.prefab)) {
        problems.push(
          `${region.id}: building ${building.id} names unknown prefab "${String(building.prefab)}" ` +
          `(known: ${PREFAB_IDS.join(", ")})`,
        );
      }
      if (building.footprint[0] <= 0 || building.footprint[1] <= 0) {
        problems.push(`${region.id}: building ${building.id} has a zero footprint`);
      }
      if (!inBounds(region.bounds, building.position)) {
        problems.push(`${region.id}: building ${building.id} is outside the region bounds`);
      }
    }

    for (const shop of settlement.shops) checkAsset(`${region.id}: shop ${shop.id}`, shop.assetId);
    for (const station of settlement.stations) checkAsset(`${region.id}: station ${station.id}`, station.assetId);
    for (const npc of settlement.npcs) checkAsset(`${region.id}: npc ${npc.id}`, npc.assetId);
    checkAsset(`${region.id}: bank ${settlement.bank.id}`, settlement.bank.assetId);

    for (const cluster of region.clusters) {
      checkAsset(`${region.id}: cluster ${cluster.id}`, cluster.assetId);
      if (cluster.depletedAssetId) checkAsset(`${region.id}: cluster ${cluster.id}`, cluster.depletedAssetId);
    }
    for (const group of region.enemyGroups) checkAsset(`${region.id}: enemies ${group.id}`, group.assetId);
    for (const obstacle of region.obstacles) checkAsset(`${region.id}: obstacle ${obstacle.id}`, obstacle.assetId);

    for (const landmark of region.landmarks) {
      checkAsset(`${region.id}: landmark ${landmark.id}`, landmark.assetId);
      if (landmark.composition !== undefined && !isCompositionId(landmark.composition)) {
        problems.push(
          `${region.id}: landmark ${landmark.id} names unknown composition ` +
          `"${String(landmark.composition)}" (known: ${COMPOSITION_IDS.join(", ")})`,
        );
      }
    }
    for (const gate of region.gates) {
      checkAsset(`${region.id}: gate ${gate.id}`, gate.assetId);
      if (gate.composition !== undefined && !isCompositionId(gate.composition)) {
        problems.push(`${region.id}: gate ${gate.id} names unknown composition "${String(gate.composition)}"`);
      }
    }

    const dungeon = region.dungeon;
    if (dungeon) {
      const dungeonIds = new Set([
        ...dungeon.locations.map((location) => location.id),
        ...region.locations.map((location) => location.id),
      ]);
      for (const road of dungeon.roads) {
        if (!dungeonIds.has(road.from)) problems.push(`${dungeon.id}: road from unknown location ${road.from}`);
        if (!dungeonIds.has(road.to)) problems.push(`${dungeon.id}: road to unknown location ${road.to}`);
      }
      for (const obstacle of dungeon.obstacles) {
        if (!dungeonIds.has(obstacle.fromLocationId) || !dungeonIds.has(obstacle.toLocationId)) {
          problems.push(`${dungeon.id}: obstacle ${obstacle.id} is wired to a location that does not exist`);
        }
        checkAsset(`${dungeon.id}: obstacle ${obstacle.id}`, obstacle.assetId);
      }
      checkAsset(`${dungeon.id}: entrance`, dungeon.entranceAssetId);
      if (dungeon.entranceComposition !== undefined && !isCompositionId(dungeon.entranceComposition)) {
        problems.push(`${dungeon.id}: entrance names unknown composition "${String(dungeon.entranceComposition)}"`);
      }
      for (const door of dungeon.doors) checkAsset(`${dungeon.id}: door ${door.id}`, door.assetId);
      for (const group of dungeon.enemyGroups) checkAsset(`${dungeon.id}: enemies ${group.id}`, group.assetId);
    }
  }

  return problems;
}
