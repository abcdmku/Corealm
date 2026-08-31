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
import type { ItemId, QuestId, RecipeId, RegionId, SkillId, StationKind } from "../contracts.js";
import {
  COMPOSITION_IDS, KIT_IDS, MODULE_METRES, PREFAB_IDS, compositionPartAssetIds, isCompositionId,
  isKitId, isPrefabId, prefabPartAssetIds, type CompositionId, type KitId, type PrefabId,
} from "../render/buildings.js";
// The three settlements are data, and each one is a whole town's worth of it. They live in
// `content/settlements/` so three people can lay out three towns without touching the same file;
// the types, the region wiring and `validateRegions` stay here, which is the only thing all three
// share. Those files import `SettlementDef` back from here with `import type`, so the cycle is
// erased at compile time and there is no runtime import loop.
import { COLDBRACE } from "./settlements/coldbrace.js";
import { HIGHCAIRN } from "./settlements/highcairn.js";
import { ROOTFALL } from "./settlements/rootfall.js";
import { resourceDef } from "./resources.js";

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
  /** Canonical gatherable definition. Clusters own placement, not gameplay or presentation data. */
  resourceId: string;
  /** How many nodes to place. Positions come from a deterministic spiral plus seeded jitter. */
  count: number;
  centre: Spot;
  radius: number;
  /** The route-graph node a player banks against when working this cluster. */
  locationId: string;
}

/**
 * Re-exported rather than declared, because there were two of these and only one could be right.
 *
 * `render/buildings.ts` owns the union: it is the file that has to have a `buildPrefab` branch, a
 * `prefabHeight` and a `prefabCollision` for every member, so a name it does not know is a name
 * nothing can draw. This file used to declare its own copy, which was a strict subset — so the five
 * prefabs added for the settlement work (`forge`, `porch`, `arcade`, `market_row`, `well`) existed,
 * were dispatched by `world/regionBuilder.ts`, and could not be named by any settlement without a
 * type error. `CompositionId` was already imported from the same place; this makes the pair
 * consistent.
 */
export type { PrefabId };

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

/**
 * How close a thing has to be to whatever it says it is `attachedTo` before `validateRegions`
 * calls it a lie. Metres, measured to the *edge* of the attachment (a building's footprint
 * rectangle, a wall run's centreline, a prop's origin), not to its centre.
 *
 * 3 m is the diagnosis's number and it clears the layouts it was chosen for with a metre to spare.
 * Checked against the replacement layouts in
 * runs/corealm/diagnosis/settlement-layout-coldbrace-rootfall-hig.md using this exact metric: the
 * Coldbrace furnace and anvil and the Highcairn anvil measure 0.0 m (they stand inside their
 * forge's 6x5 footprint), the Rootfall smith's pitch measures 0.5 m, the Coldbrace bank counter
 * 1.4 m off the vault tower, and the worst case is the Coldbrace smith's cart in front of its
 * forge at 2.0 m.
 */
export const ATTACHMENT_MARGIN_METRES = 3;

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
  /**
   * The `BuildingDef.id`, `WallRunDef.id` or `PropDef.id` in the same settlement that this station
   * is part of: the forge it stands inside, the lean-to it stands under, the counter it stands
   * behind.
   *
   * This exists so that a claim can be checked. Measured today, all five Coldbrace stations stand
   * loose on grass — the Forge Shed's own door faces south while the furnace and anvil it serves
   * are 6 m away on its north side, and the fletching bench is a 68 cm drawer unit 6 m from
   * anything at all. Naming the structure lets `validateRegions`
   * assert the station is within `ATTACHMENT_MARGIN_METRES` of it, which is what stops the next
   * author dropping an anvil in a field. Optional, because nothing authored today attaches to
   * anything; once a settlement is re-laid out, everything in it should name its structure.
   */
  attachedTo?: string;
}

export interface BankDef {
  id: string;
  name: string;
  position: Spot;
  rotationY: number;
  assetId: string;
  /** See `StationDef.attachedTo`. The bank counter, porch or vault the chest belongs to. */
  attachedTo?: string;
}

export interface ShopDef {
  id: string;
  name: string;
  shopKind: "general" | "smith";
  position: Spot;
  rotationY: number;
  assetId: string;
  /** See `StationDef.attachedTo`. The arcade, market row or forge the pitch belongs to. */
  attachedTo?: string;
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

/**
 * A gap in a wall run: a gate, a postern, a collapsed span.
 *
 * `at` is metres along the run measured from `from`, at the CENTRE of the gap. `width` is the wall
 * cutout occupied by the whole gate structure, so `{ at: 26, width: 8 }` on a 52 m run leaves wall
 * from 0-22 m and 30-52 m. Author the opening's centre at the gatehouse's own position projected
 * onto the run, and its width at the gatehouse footprint's width, or the arch and the hole in the
 * wall will not line up.
 */
export interface WallOpeningDef {
  /** Metres along the run from `from`, at the centre of the gap. */
  at: number;
  /** Full wall cutout in metres. Rounds outward to whole 2 m modules; there is no half panel. */
  width: number;
}

/**
 * One straight run of town wall, from `from` to `to`, with gates cut out of it.
 *
 * WHY THIS TYPE EXISTS. There was no way to author a wall, only to author individual
 * `wall_segment` buildings with an 8 m footprint. Measured on the current data: Coldbrace has 44 m
 * of wall (four 8 m stubs plus two 6 m gatehouses) on a 212 m circuit — 79% open, largest single
 * gap 46 m, all four corners missing. Highcairn has 30 m of 139 m. Rootfall has none at all and no
 * gate. The stubs are worse than nothing: `getNavPath(144,-40 -> 144,-90)` detours to x = 149.5 to
 * walk around two free-standing panels in open moor. The player's complaint was, verbatim, "a
 * random gate without a wall". Four `WallRunDef`s close a whole circuit in four lines of data.
 *
 * INTENDED EMITTER SEMANTICS, for whoever writes it in `world/regionBuilder.ts`:
 *
 *   length   = spotDistance(from, to)
 *   count    = round(length / MODULE_METRES)      MODULE_METRES is 2, from render/buildings.ts;
 *                                                 author runs as whole multiples of 2 m
 *   module i = centre at (i + 0.5) / count along the run, i in [0, count)
 *   yaw      = atan2(-(to[1] - from[1]), to[0] - from[0])
 *
 * That yaw is the value that maps a part's LOCAL +X onto the run direction under the transform
 * `world = (dx*cos + dz*sin, -dx*sin + dz*cos)` that `regionBuilder.emitParts` applies — the same
 * convention `wallSegment()` in render/buildings.ts already lays its panels out in, which is why
 * `coldbrace_wall_w` at rotationY PI/2 runs north-south.
 *
 * Per kept module the emitter places the settlement kit's `wall` asset and one `wall_bottom_trim`
 * at the same XZ (`wallSegment` offsets the trim by dz 0.01 to stop it z-fighting the panel), and
 * pushes one `BuildingBox` 0.5 m thick along the run's normal and `prefabHeight`-tall — the same
 * 0.5 m the existing `prefabCollision("wall_segment")` uses, because the collider should be as
 * thick as the panel, not as deep as a footprint. `kit.corner` goes at both ends of the run, at
 * `from` and `to` exactly, so two runs meeting at a corner share a post instead of leaving a hole.
 *
 * A module is SKIPPED when its centre distance falls inside `[at - width/2, at + width/2]` of any
 * opening. Skipped modules emit no panel, no trim and no collision box, so the gatehouse standing
 * in the gap is the only thing there.
 *
 * The runs are authored per settlement and are not required to form a closed loop — a town on a
 * cliff edge (Highcairn's south side) may want one run standing on the lip and nothing behind it.
 */
export interface WallRunDef {
  id: string;
  name: string;
  from: Spot;
  to: Spot;
  /** Gates and posterns. Absent or empty means a solid run. */
  openings?: WallOpeningDef[];
}

/**
 * What a settlement paves in. Held as an asset id, and a union of the four floor meshes, because
 * two other systems read the choice: `audio/surface.ts` picks the footstep off it, and a settlement
 * author is genuinely choosing between cobble, brick and plank rather than between three numbers.
 *
 * No instance of these meshes is laid for paving any more. `app/worldSurface.ts` maps the id onto a
 * `PavingSurface` and the ground draws its own courses; see `PavingDef`.
 */
export type PavingAssetId = "floor_cobble" | "floor_brick" | "floor_wood" | "floor_wood_light";

/** An axis-aligned ground rectangle in world metres. */
export interface PavingRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * A paved area: a square, a street, a fork, a yard.
 *
 * WHY THIS TYPE EXISTS. Coldbrace's square is 7,238 m2 of ground with a measured relief of exactly
 * 0.0000 m — `settlementRadius()` flattens a disc and nothing then differentiates it from open
 * grass. There is no texture on the terrain material and the 46 m scatter-exclusion circle in
 * boot.ts forbids a single blade of grass, pebble or flower inside it, so the middle of every town
 * is a plain grey-green field with a bank chest standing alone in it.
 *
 * The rect is STAMPED, not tiled. It used to lay one 2 x 2 m slab per module at ground + 0.02, and
 * a flat slab on ground that is never quite flat floats at one corner, buries itself at the other,
 * and shows a mortar-width of terrain at every seam - which a player called out as tiles thrown on
 * a lawn. The paved surface is now the terrain's own vertex colour, splat weight and course
 * pattern, the same mechanism roads and waterlines use, so it follows the ground exactly, cannot
 * z-fight it, and costs no draw call at all.
 *
 * `kerb` rings the rect with `kerb_straight` (2.00 x 0.134 x 0.70 m, one per module edge, long
 * axis along the edge) and `kerb_corner` (0.70 x 0.13 x 0.70 m, one at each of the four corners).
 * Kerbs are dressing: no collision, or the player trips on a 13 cm lip walking into their own
 * town square.
 *
 * There is deliberately NO separate `square` field. The ground/terrain diagnosis asked for
 * `square?: { centre, radius, kind }` to stamp a cobble weight into the terrain splat; a union of
 * paving rects expresses that strictly better (it follows the streets, not just the plaza) and
 * `assetId` already carries the `kind`, so the splat stamp is driven off `paving` and a second
 * overlapping field would only be able to disagree with it.
 */
export interface PavingDef {
  id: string;
  rect: PavingRect;
  assetId: PavingAssetId;
  /** Ring the rect with `kerb_straight` plus `kerb_corner` at the corners. Never solid. */
  kerb?: boolean;
}

/**
 * One piece of set dressing: a barrel, a crate, a bench, a woodpile log, a wall lamp, a fence post.
 *
 * WHY THIS TYPE EXISTS. There was nowhere in the entire content layer to author a barrel.
 * `SettlementDef` had buildings, stations, a bank, shops and NPCs and nothing else, and
 * `render/buildings.ts` only emits props as fixed parts of a prefab or a landmark composition. So
 * the bank chest (drawn 1.28 x 0.76 m), the anvil (1.08 x 0.40 m), the furnace cauldron (0.99 x
 * 0.94 m) and both market pitches stand alone on open grass — that single missing array is the
 * whole reason. `table_large`, `bench`, `stool`, `chair`, `barrel`, `barrel_rack`, `barrel_apples`,
 * `crate_wood`, `crate_village`, `sack` and the `farm_crate_*` family all ship in the manifest and
 * are used by nothing.
 *
 * `dy` is metres above the resolved ground height, for the things that do not sit on it: a
 * `lamp_wall` at 2.4 m on a wall face, a `roof_log` laid flat in a woodpile at -1.00 (the log's
 * pivot is above its own axis). `scale` is a true metre multiplier in the same sense as
 * `PartPlacement.scale`. `solid` asks the root's boot wiring for a collider; leave it off for
 * anything the player should be able to walk over or through, which is most ground dressing.
 */
export interface PropDef {
  id: string;
  assetId: string;
  position: Spot;
  rotationY: number;
  scale?: number;
  /** Metres above the resolved ground height. Defaults to 0. */
  dy?: number;
  /** Give it a collider. Defaults to false: dressing you can walk through is better than a snag. */
  solid?: boolean;
}

/**
 * A rectangular flat pad instead of the default disc, in the settlement's own frame, centred on
 * `SettlementDef.centre` and rotated by `rotationY` about it.
 *
 * WHY THIS TYPE EXISTS. `worldSpec.settlementRadius()` sizes one circular pad from the furthest
 * thing the settlement places, and at Highcairn that disc spans the terrace 2 / terrace 3 boundary
 * at z = -76, where `KARROWMOOR.terraces` authors an 18 m riser. Measured: `getDrawnBounds` puts
 * `highcairn_wall_n#w0` and `highcairn_wall_s#w0` both at base y = 26.810 while standing 30 m
 * apart in z. The pad has flattened the single terrain feature the region is built around, and the
 * result reads on screen as a grey table with a hard arc cut into the hillside. A rectangle can be
 * kept wholly inside one terrace; a disc sized to reach the far corner of the town cannot.
 *
 * `halfX` / `halfZ` are half-extents in metres, so Highcairn's proposed 44 x 28 m pad is
 * `{ halfX: 22, halfZ: 14, rotationY: 0 }`. The existing blend width is unchanged and still
 * applies outside the rectangle.
 */
export interface PadShapeDef {
  halfX: number;
  halfZ: number;
  rotationY: number;
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
  /**
   * The town wall as runs rather than as free-standing panels. Optional so the current data keeps
   * typechecking while the emitter is written; a settlement with no `walls` is exactly what
   * Rootfall is today, which is the bug.
   */
  walls?: WallRunDef[];
  /** Paved ground. See `PavingDef`; this also feeds the terrain splat's cobble weight. */
  paving?: PavingDef[];
  /** Set dressing. See `PropDef`. */
  props?: PropDef[];
  /**
   * Override the circular flat pad with a rectangle. See `PadShapeDef`. Consumed by
   * `app/worldSpec.ts`, which is root-only.
   */
  padShape?: PadShapeDef;
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
  /** Regional architectural dressing around the semantic traversal anchor. */
  composition?: CompositionId;
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
      id: "bracken_pit_grithe", resourceId: "ore_grithe",
      count: 6, centre: [-160, 80], radius: 11,
      // No pack ships a mineable vein (asset-report gap 2). The rock meshes tagged `ore-node` are
      // single-material, so the render layer tints them per `view.materialTier`.
      // No `depletedAssetId`. A worked-out node keeps the silhouette the player walked up to:
      // the render layer derives the spent look from this same mesh (`buildSpentParts` in
      // render/entityViews.ts) by dropping the ore vein, cutting a tree back to its stump, or
      // cutting a crop back to stubble. Swapping in a smaller rock read as the seam vanishing, and
      // swapping a tree for `anvil_log` — which is an anvil sitting on a log — put a blacksmith's
      // anvil where every felled tree had been.
      locationId: "bracken_pit",
    },
    {
      id: "bracken_pit_stone", resourceId: "ore_marchstone",
      count: 2, centre: [-146, 88], radius: 5,
      locationId: "bracken_pit",
    },
    {
      id: "palewood_copse_trees", resourceId: "tree_palewood",
      count: 8, centre: [-334, -64], radius: 15,
      locationId: "palewood_copse",
    },
    {
      id: "redsill_spots", resourceId: "fish_silt_minnow",
      count: 4, centre: [-40, -60], radius: 9,
      // Fish schools render below the canonical solved water surface. The semantic entity remains
      // the surface interaction proxy, so cluster placement must stay inside the authored pond.
      locationId: "redsill_shallows",
    },
    {
      id: "marchfield_plots", resourceId: "plot_bittergrain",
      count: 6, centre: [-96, -22], radius: 7,
      // No soil-plot or scarecrow mesh (asset-report gap 5). The crop is the clickable thing; the
      // dirt quad and its fence border are render-layer geometry.
      locationId: "marchfield_farm",
    },
  ],

  settlement: COLDBRACE,

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
    {
      // On the March Road, 106 m north of the square at its nearest, between the Broken Milestone
      // and the Bracken Pit. The first thing a new character walks through, and by design the
      // cheapest: 4 health, passive at 4 m, one damage a swing.
      id: "bracken_fenmites", family: "fenmite", name: "Bracken Fenmite", tier: 1,
      count: 7, centre: [-152, 44], radius: 18,
      // enemy_bee is the only rig in the library that hovers. At 0.40 x the tier 1 silhouette 0.90
      // it draws 0.67 m tall against the Thornbound Husk's 1.36 m on the same mesh - far enough
      // apart in size that they do not read as the same animal.
      assetId: "enemy_bee", scale: 0.40,
      level: 3, maxHealth: 4, aggroRadius: 4, behaviour: "passive",
    },
    {
      // South of the Redsill Shallows, on the water the Fishing tutorial sends you to. Territorial,
      // 5 m aggro, off the road: at Melee 1 this fight is unwinnable (65.9 s, 32.8 damage against
      // 23 health) and the whole point is that it never starts it.
      id: "redsill_mudbacks", family: "mudback", name: "Redsill Mudback", tier: 1,
      count: 3, centre: [-56, -88], radius: 14,
      // Same crab as the Rill Skitterling 37 m west, at 1.05 against its 0.70: 1.43 m tall and
      // 2.40 m across, half again the Skitterling's footprint.
      assetId: "enemy_crab", scale: 1.05,
      level: 6, maxHealth: 16, aggroRadius: 5, behaviour: "territorial",
    },
    {
      // The west track between Coldbrace and the Open March camp - empty ground before this, and
      // the one stretch of Fallowmarch a player crosses without meeting anything. 77 m from the
      // square at its nearest, so it cannot become the closest enemy to town.
      id: "march_road_reavers", family: "reaver", name: "March Road Reaver", tier: 1,
      count: 3, centre: [-234, -24], radius: 16,
      // Humanoid, via the same body + parts path the NPCs use: `render/entityViews.ts` maps a
      // clothes-only outfit id onto `base_male` and layers a per-entity hair pick on top, which is
      // why three Reavers standing together are three different men rather than three copies.
      // 1.12 x 0.90 puts a 1.84 m raider next to a 1.82 m player.
      assetId: "outfit_male_peasant", scale: 1.12,
      level: 7, maxHealth: 9, aggroRadius: 14, behaviour: "aggressive",
    },
    {
      // The dead ground south of the Palewood Copse, 37 m from the woodcutting cluster - close
      // enough to be the reason you look up, territorial so it is not the reason you die.
      id: "palewood_hollows", family: "hollow", name: "Palewood Hollow", tier: 1,
      count: 4, centre: [-320, -98], radius: 16,
      // enemy_skull, which Karrowmoor uses for the Cairnwight at 0.80. At 0.85 x 0.90 this is
      // 1.14 m against the Cairnwight's 1.37 m, and 340 m of world plus two tier palettes apart.
      assetId: "enemy_skull", scale: 0.85,
      level: 8, maxHealth: 9, aggroRadius: 7, behaviour: "territorial",
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
      // Five metres off the three-way junction, facing the road back to Coldbrace. The compact
      // marker stays about 3.8 m from the nearest stamped lane centre, close enough to read as a
      // shoulder waypost without putting its post in the 3.2 m cart track.
      id: "west_track", name: "West Track Waypost", position: [-233, -64],
      assetId: "corner_wood", scale: 0.9, rotationY: 1.8,
      composition: "path_waypoint",
      blurb: "Three weathered arms: Coldbrace, Palewood, and the Open March.",
    },
    {
      id: "lone_dead_palewood", name: "The Lone Palewood", position: [-196, 24],
      assetId: "tree_dead_3", scale: 0.85,
      blurb: "One dead Palewood at the top of the rise. Every direction from here looks the same.",
    },
    {
      // Marchfield is a resource cluster rather than a settlement, so the farmstead has to enter
      // through the landmark composition hook. The empty crate is a quiet semantic anchor; the
      // composition supplies the barn, paddock fence, gate, and yard dressing around the plots.
      id: "marchfield_farmstead", name: "Marchfield Farmstead", position: [-96, -22],
      assetId: "farm_crate_empty", scale: 0.8, rotationY: 0,
      composition: "farm_yard",
      blurb: "A working yard around six bittergrain plots, with a barn backed into the old wall line.",
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
      id: "hollowcut_corven", resourceId: "ore_corven",
      count: 5, centre: [94, 145], radius: 9,
      locationId: "hollowcut_seam",
    },
    {
      id: "duskoak_stand_trees", resourceId: "tree_duskoak",
      count: 10, centre: [14, 166], radius: 20,
      // Was tree_twisted_1. That family carries the `Leaves_TwistedTree` texture, whose sampled
      // mean is rgb(105,79,84) — an autumn tree. Ten of them at the heart of the region is what
      // made Vellenwood read crimson, and the tier tint cannot fix it: tinting multiplies
      // `material.color` against the texture, so it can darken a red leaf but can never re-hue one.
      // tree_common_2 carries the green `Leaves_NormalTree` texture, and staying off the scatter
      // canopy's 3 and 5 keeps the choppable tree distinguishable from the dressing. Scale 1.15
      // holds the old-growth read that 0.55 on a larger source mesh was buying.
      locationId: "vellenwood_canopy",
    },
    {
      id: "blackwater_spots", resourceId: "fish_bramble_trout",
      count: 5, centre: [128, 84], radius: 12,
      locationId: "blackwater_pools",
    },
  ],

  settlement: ROOTFALL,

  obstacles: [
    {
      // Rootfall -> Duskoak Stand on foot has to skirt the standing water via Mire Skirt:
      // 66.0 + 50.2 = 116.2 m. Over the canopy: 26.9 to the first platform + 11.7 off the last
      // = 38.6 m + 4.0 s. Saves 77.6 m, and 27.7 s of walking becomes 13.2 s.
      id: "canopy_walk", name: "Canopy Walk", reqLevel: 6,
      position: [40, 138], exitPosition: [24, 172],
      durationMs: 4000, savesMeters: 78,
      // The straight line to Rootfall crosses its west wall, so face the stair down the actual
      // approach from the west gate at (44,124): obstacle -> gate is (+4,-14), bearing 2.86.
      // A stair hero reads as an actual climb start; the former balcony hero was a loose fence.
      assetId: "stairs_exterior", composition: "canopy_walk_entrance", scale: 1.4, rotationY: 2.86,
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
      // The entrance now stands outside the Hollowcut Postern instead of being pinched between
      // the forge, townhouse and gate. Through the roots: 31.6 + 8.2 = 39.8 m + 3.5 s, saving
      // about 145 m while giving the authored arch an unobstructed approach.
      id: "root_tunnel", name: "Root Tunnel", reqLevel: 8,
      position: [86, 138], exitPosition: [188, 154],
      durationMs: 3500, savesMeters: 145,
      // Local +Z faces west through the postern, the direction players actually approach from.
      assetId: "wall_arch", composition: "root_tunnel_entrance", scale: 1.2, rotationY: -Math.PI / 2,
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
    {
      // The mire skirt on the Marchgate road, 20 m from the Marchgate node itself - the first
      // thing a player crossing from Fallowmarch meets, and the passive family is why that is fair.
      //
      // Was [124, 96], 12 m off the Blackwater Pools node: measured in-game, that is inside the
      // drawn water disc, and seven fenmites spawned submerged with the player standing chest-deep
      // among them. The water surface is built by marching a shoreline outward from the fishing
      // cluster until the terrain rises through the plane, so its true radius is not knowable from
      // this file - the fix is distance, not arithmetic. This centre is 134 m from that pool.
      id: "mire_fenmites", family: "fenmite", name: "Mire Fenmite", tier: 5,
      count: 7, centre: [4, 134], radius: 12,
      // 0.45 x the tier 5 silhouette 1.075 = 0.90 m, against the Thornbound Husk's 1.36 m on the
      // same hovering rig 60 m north-east.
      assetId: "enemy_bee", scale: 0.45,
      level: 11, maxHealth: 12, aggroRadius: 5, behaviour: "passive",
    },
    {
      // Between the Gorge Ford and the Thornline camp, on the road that carries every trip to the
      // east gate. The most expensive ordinary fight in the region and the only one that starts
      // itself from 14 m, which is what makes the gorge road a decision.
      id: "gorge_reavers", family: "reaver", name: "Gorge Reaver", tier: 5,
      count: 3, centre: [214, 64], radius: 16,
      // The female ranger set, so a Gorge Reaver is hooded where the Fallowmarch Reaver is a
      // bare-headed peasant. 0.95 x 1.075 = 1.81 m on `base_female`'s 1.775 m frame.
      assetId: "outfit_female_ranger", scale: 0.95,
      level: 15, maxHealth: 26, aggroRadius: 14, behaviour: "aggressive",
    },
    {
      // The deep canopy north of the Duskoak stand. Territorial, and standing in the darkest fog
      // in the world (Vellenwood's fogStart is 55 m against Fallowmarch's 180).
      id: "canopy_hollows", family: "hollow", name: "Canopy Hollow", tier: 5,
      count: 4, centre: [30, 182], radius: 12,
      assetId: "enemy_skull", scale: 0.75,
      level: 17, maxHealth: 24, aggroRadius: 8, behaviour: "territorial",
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
      // The dry wedge between the east-west trail and the canopy branch. Both stamped lane
      // centrelines stay about four metres away, so the marker reads as the junction's shoulder
      // without blocking either route.
      id: "mire_skirt", name: "Mire Skirt Trailhead", position: [0, 124],
      assetId: "corner_wood", scale: 1.0, rotationY: Math.PI / 2,
      composition: "path_waypoint",
      blurb: "A moss-dark trail marker where the dry path skirts the standing water.",
    },
    {
      id: "thornline_stones", name: "The Thornline Stones", position: [206, 168],
      // Was `boulder_medium` at 1.1, which is one of the six untextured platformer rocks: a 5.3 m
      // smooth tan cone standing in the middle of four textured grey ones. `rock_medium_2` carries
      // TEXCOORD_0 and the shared Rocks atlas, so the hero belongs to its own ring.
      assetId: "rock_medium_2", scale: 1.35,
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
      id: "lower_quarry_kaldite", resourceId: "ore_kaldite",
      count: 5, centre: [60, -16], radius: 10,
      locationId: "karrowmoor_terraces",
    },
    {
      // Three nodes on purpose. Architecture R5: this seam genuinely runs dry above Mining 20,
      // which is what pushes a player back to the Lower Quarry or onto the Sunder Ledge circuit.
      id: "upper_karrow_kaldite", resourceId: "ore_kaldite",
      count: 3, centre: [194, -132], radius: 7,
      locationId: "upper_karrow_seam",
    },
    {
      id: "ridge_pines_trees", resourceId: "tree_cairnpine",
      count: 8, centre: [250, -96], radius: 18,
      locationId: "ridge_pines",
    },
    {
      id: "cairn_tarn_spots", resourceId: "fish_cragfin",
      count: 2, centre: [206, -88], radius: 8,
      locationId: "cairn_tarns",
    },
    {
      id: "far_tarn_spots", resourceId: "fish_cragfin",
      count: 2, centre: [284, -110], radius: 7,
      locationId: "far_tarn",
    },
    {
      id: "highcairn_plot_beds", resourceId: "plot_cairnleaf",
      count: 4, centre: [128, -58], radius: 6,
      locationId: "highcairn_plots",
    },
  ],

  settlement: HIGHCAIRN,

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
      // Same swap as `thornline_stones`: `boulder_medium` has no UVs and cannot be tinted or
      // textured at any tier. `rock_medium_3` at 1.5 is the same 5.1 m mass and reads as stone.
      assetId: "rock_medium_3", scale: 1.5,
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
    {
      // On the lower terrace, 30 m from the Karrowmoor terraces node and 30 m from the Gravelmaw
      // mouth, i.e. beside the road into the dungeon rather than across it. Territorial at 6 m: a
      // wall the player walks around until they bring a staff, not an ambush.
      id: "terrace_mudbacks", family: "mudback", name: "Terrace Mudback", tier: 10,
      count: 3, centre: [72, -44], radius: 14,
      // 1.15 x the tier 10 silhouette 1.151 = 2.00 m tall and 3.36 m across, the largest non-boss
      // thing in the world and 46% wider than the Scree Skitterling on the same crab rig.
      assetId: "enemy_crab", scale: 1.15,
      level: 22, maxHealth: 46, aggroRadius: 6, behaviour: "territorial",
    },
    {
      // 7.6 m off the ramp_three -> Upper Karrow Seam road, which is the tier 10 mining run the
      // DISTANCE LEDGER at the top of this file is built on. Anyone walking it is Mining 12 and
      // Melee 12 by construction, so this is the one place an aggressive tier 10 group can sit on a
      // road without being a wall across the region.
      //
      // Was [206, -30] on the moor road, which is wrong twice: measured in-game that spot is inside
      // a field of the large rock formations Karrowmoor scatters, so the Reavers were hidden inside
      // geometry; and it is the FIRST junction a tier 5 player reaches walking in from Vellenwood.
      id: "karrow_reavers", family: "reaver", name: "Karrow Reaver", tier: 10,
      count: 4, centre: [148, -128], radius: 12,
      // The male ranger set - hooded, and the same silhouette family as Ordrun four chambers down,
      // which is the intended read: the Quarrykeeper's crew, still on the moor. 0.90 x 1.151 =
      // 1.89 m, against Ordrun's 4.52 m.
      assetId: "outfit_male_ranger", scale: 0.90,
      level: 26, maxHealth: 40, aggroRadius: 14, behaviour: "aggressive",
    },
    {
      // The tarn road between Highcairn and the Ridge Pines, 20 m north of it. Placed clear of the
      // ridge_pines_trees cluster (34 m centre to centre against a combined 32 m of radius) so a
      // wolf cannot spawn inside a pine.
      id: "tarn_marchwolves", family: "marchwolf", name: "Tarn Marchwolf", tier: 10,
      count: 4, centre: [228, -70], radius: 14,
      // 0.85 x 1.151 = 1.61 m, against the tier 5 Marchwolf's 1.42 m on the same rig.
      assetId: "enemy_blob", scale: 0.85,
      level: 25, maxHealth: 30, aggroRadius: 12, behaviour: "aggressive",
    },
  ],

  landmarks: [
    {
      // North shoulder of the long Moor Road descent, 4.5 m from its centreline and outside the
      // Kaldite cluster. A slate post over a cairn foot now reads as part of the quarry arrival.
      id: "lower_quarry_waystone", name: "Lower Quarry Waystone", position: [76, -10],
      assetId: "corner_brick", scale: 0.85, rotationY: 1.5,
      composition: "path_waypoint",
      blurb: "A quarry cairn marking the split between Highcairn and the Gravelmaw road.",
    },
    {
      // Southwest shoulder of the upper-ramp junction. The actual route node remains at
      // (118,-138); this marker is offset far enough that its side cairns cannot pinch either leg.
      id: "karrow_ramp_three", name: "Third Ramp Waystone", position: [110, -146],
      assetId: "corner_brick", scale: 0.78, rotationY: Math.PI / 4,
      composition: "path_waypoint",
      blurb: "A low slate marker at the last sheltered turn before the upper moor.",
    },
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
      // The platformer boulder is an untextured truncated cone and remained visible through the
      // dressed ring. Use the same textured rock family as the composition so the semantic anchor
      // belongs to the cairn instead of reading as a placeholder at its centre.
      assetId: "rock_medium_2", scale: 1.8,
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
    // `wall_brick_door` is a real masonry arch module. At 3x it fits inside the dressed rock face;
    // the surrounding quarry composition carries the broader twelve-metre silhouette.
    // Round 1 drew it unrotated and unaccompanied, which is why it read as a wooden door frame on
    // open ground. It now faces the approach from the Lower Quarry (60,-16): atan2(14,8) = 1.05.
    entranceAssetId: "wall_brick_door",
    entranceRotationY: 1.05,
    entranceScale: 3,
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
        // The Lit Gallery is lit because somebody is keeping it lit. Two of them, at the chamber's
        // north edge - 5.7 m from its centre with a 5 m spawn radius, so both stay inside the 11 m
        // carved floor. Count 2 rather than 4: chamber one is the room every dungeon trip enters
        // through, and it already holds the four Cairnwights `long_cairn` stage 4 sends you for.
        id: "gravelmaw_ch1_reavers", family: "reaver", name: "Gravelmaw Reaver", tier: 10,
        count: 2, centre: [44, -36], radius: 5,
        assetId: "outfit_male_ranger", scale: 0.90,
        level: 26, maxHealth: 40, aggroRadius: 14, behaviour: "aggressive",
      },
      {
        id: "gravelmaw_ch2_skitterlings", family: "skitterling", name: "Scree Skitterling", tier: 10,
        count: 6, centre: [30, -58], radius: 9,
        assetId: "enemy_crab", scale: 0.75,
        level: 20, maxHealth: 78, aggroRadius: 8, behaviour: "aggressive",
      },
      {
        // In the fallen rock of The Collapse, beside the Scree Skitterlings on the same crab rig at
        // 1.15 against their 0.75 - the size difference is the whole visual argument, and the
        // 78-armour / 0-magicArmour split is the mechanical one. Territorial, so the room stays
        // navigable while the door puzzle is being worked out.
        id: "gravelmaw_ch2_mudbacks", family: "mudback", name: "Gravelmaw Mudback", tier: 10,
        count: 3, centre: [27, -54], radius: 4,
        assetId: "enemy_crab", scale: 1.15,
        level: 22, maxHealth: 46, aggroRadius: 6, behaviour: "territorial",
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
 * Shortest distance from `point` to the segment `a`->`b`, in metres, clamped at both ends.
 */
function distanceToSegment(point: Spot, a: Spot, b: Spot): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq === 0) return spotDistance(point, a);
  const along = ((point[0] - a[0]) * abx + (point[1] - a[1]) * abz) / lengthSq;
  const t = Math.min(1, Math.max(0, along));
  return spotDistance(point, [a[0] + abx * t, a[1] + abz * t]);
}

/**
 * Shortest distance from `point` to a building's footprint rectangle. Zero when the point is
 * inside the building, which is the normal answer for a station under a roof.
 *
 * The footprint is authored in the building's own frame, so the point is rotated into that frame
 * first. The forward transform `world/regionBuilder.ts` applies to every prefab part is
 * `world = (dx*cos + dz*sin, -dx*sin + dz*cos)`; that matrix is orthogonal, so its inverse is its
 * transpose and the local coordinates are `(wx*cos - wz*sin, wx*sin + wz*cos)`.
 */
function distanceToFootprint(point: Spot, building: BuildingDef): number {
  const cos = Math.cos(building.rotationY);
  const sin = Math.sin(building.rotationY);
  const wx = point[0] - building.position[0];
  const wz = point[1] - building.position[1];
  const dx = wx * cos - wz * sin;
  const dz = wx * sin + wz * cos;
  const overX = Math.max(0, Math.abs(dx) - building.footprint[0] / 2);
  const overZ = Math.max(0, Math.abs(dz) - building.footprint[1] / 2);
  return Math.hypot(overX, overZ);
}

/**
 * Content validation, for `content/validate.ts` to call at boot. Returns a list of problems rather
 * than throwing, so the root can surface all of them at once in `getErrors()`.
 *
 * It checks the things that silently produce a broken world: a road pointing at a location that
 * does not exist, an obstacle wired to a missing route node, a cluster outside its region bounds,
 * a palette that is not eight swatches, or a settlement placed outside its own region.
 *
 * It also checks the settlement dressing vocabulary, because every one of those is silent too: a
 * wall run whose gate opening falls off the end of the run leaves the wall solid where the gate
 * should be, a degenerate paving rect paves nothing at all, a prop naming a missing asset draws
 * nothing, and a station `attachedTo` a building 6 m away is the "anvil standing in a field"
 * failure the field was added to catch.
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
      if (obstacle.composition !== undefined && !isCompositionId(obstacle.composition)) {
        problems.push(
          `${region.id}: obstacle ${obstacle.id} names unknown composition ` +
          `"${String(obstacle.composition)}"`,
        );
      }
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

    // Wall runs. Both failure modes here are invisible: a run that leaves the region gets built on
    // terrain the region never generated, and a gate opening that falls outside the run's length
    // leaves the wall solid where the gatehouse stands, which is the current bug in reverse.
    const wallRuns = settlement.walls ?? [];
    for (const run of wallRuns) {
      if (seenIds.has(run.id)) problems.push(`duplicate wall run id ${run.id}`);
      seenIds.add(run.id);
      if (!inBounds(region.bounds, run.from) || !inBounds(region.bounds, run.to)) {
        problems.push(`${region.id}: wall run ${run.id} leaves the region bounds`);
      }
      const runLength = spotDistance(run.from, run.to);
      if (runLength < MODULE_METRES) {
        problems.push(
          `${region.id}: wall run ${run.id} is ${runLength.toFixed(2)} m long, ` +
          `shorter than one ${MODULE_METRES} m wall module`,
        );
      }
      for (const opening of run.openings ?? []) {
        if (!(opening.width > 0)) {
          problems.push(`${region.id}: wall run ${run.id} has an opening of width ${opening.width}`);
          continue;
        }
        const start = opening.at - opening.width / 2;
        const end = opening.at + opening.width / 2;
        if (start < 0 || end > runLength) {
          problems.push(
            `${region.id}: wall run ${run.id} has a ${opening.width} m opening centred at ` +
            `${opening.at} m, which falls outside the run's ${runLength.toFixed(2)} m length`,
          );
        }
      }
    }

    // Paving. A rect with min >= max stamps nothing and reports nothing, so the square is silently
    // still bare grass.
    for (const paving of settlement.paving ?? []) {
      if (seenIds.has(paving.id)) problems.push(`duplicate paving id ${paving.id}`);
      seenIds.add(paving.id);
      checkAsset(`${region.id}: paving ${paving.id}`, paving.assetId);
      const rect = paving.rect;
      if (!(rect.maxX > rect.minX) || !(rect.maxZ > rect.minZ)) {
        problems.push(
          `${region.id}: paving ${paving.id} is degenerate: ` +
          `x [${rect.minX}, ${rect.maxX}] z [${rect.minZ}, ${rect.maxZ}]`,
        );
      }
      if (!inBounds(region.bounds, [rect.minX, rect.minZ]) ||
          !inBounds(region.bounds, [rect.maxX, rect.maxZ])) {
        problems.push(`${region.id}: paving ${paving.id} leaves the region bounds`);
      }
    }

    for (const prop of settlement.props ?? []) {
      if (seenIds.has(prop.id)) problems.push(`duplicate prop id ${prop.id}`);
      seenIds.add(prop.id);
      checkAsset(`${region.id}: prop ${prop.id}`, prop.assetId);
      if (!inBounds(region.bounds, prop.position)) {
        problems.push(`${region.id}: prop ${prop.id} is outside the region bounds`);
      }
      if (prop.scale !== undefined && !(prop.scale > 0)) {
        problems.push(`${region.id}: prop ${prop.id} has scale ${prop.scale}`);
      }
    }

    const padShape = settlement.padShape;
    if (padShape && (!(padShape.halfX > 0) || !(padShape.halfZ > 0) ||
        !Number.isFinite(padShape.rotationY))) {
      problems.push(
        `${region.id}: settlement ${settlement.id} padShape must have positive half-extents and a ` +
        `finite rotation, got halfX ${padShape.halfX}, halfZ ${padShape.halfZ}, ` +
        `rotationY ${padShape.rotationY}`,
      );
    }

    // `attachedTo` is a claim, and this is the check that makes the claim worth authoring. The
    // distance is measured to the edge of the structure - a building's footprint rectangle, a wall
    // run's centreline, a prop's origin - so a station standing under a roof measures 0.
    const attachmentDistance = (point: Spot, targetId: string): number | undefined => {
      const building = settlement.buildings.find((candidate) => candidate.id === targetId);
      if (building) return distanceToFootprint(point, building);
      const run = wallRuns.find((candidate) => candidate.id === targetId);
      if (run) return distanceToSegment(point, run.from, run.to);
      const prop = (settlement.props ?? []).find((candidate) => candidate.id === targetId);
      if (prop) return spotDistance(point, prop.position);
      return undefined;
    };
    const checkAttachment = (
      what: string, id: string, position: Spot, attachedTo: string | undefined,
    ): void => {
      if (attachedTo === undefined) return;
      const distance = attachmentDistance(position, attachedTo);
      if (distance === undefined) {
        problems.push(
          `${region.id}: ${what} ${id} is attachedTo "${attachedTo}", which is not a building, ` +
          `wall run or prop in settlement ${settlement.id}`,
        );
        return;
      }
      if (distance > ATTACHMENT_MARGIN_METRES) {
        problems.push(
          `${region.id}: ${what} ${id} claims to be attachedTo ${attachedTo} but stands ` +
          `${distance.toFixed(1)} m from it (limit ${ATTACHMENT_MARGIN_METRES} m)`,
        );
      }
    };
    for (const station of settlement.stations) {
      checkAttachment("station", station.id, station.position, station.attachedTo);
    }
    for (const shop of settlement.shops) {
      checkAttachment("shop", shop.id, shop.position, shop.attachedTo);
    }
    checkAttachment("bank", settlement.bank.id, settlement.bank.position, settlement.bank.attachedTo);

    for (const shop of settlement.shops) checkAsset(`${region.id}: shop ${shop.id}`, shop.assetId);
    for (const station of settlement.stations) checkAsset(`${region.id}: station ${station.id}`, station.assetId);
    for (const npc of settlement.npcs) checkAsset(`${region.id}: npc ${npc.id}`, npc.assetId);
    checkAsset(`${region.id}: bank ${settlement.bank.id}`, settlement.bank.assetId);

    for (const cluster of region.clusters) {
      try {
        const resource = resourceDef(cluster.resourceId);
        for (const assetId of resource.presentation.availableAssetIds) {
          checkAsset(`${region.id}: cluster ${cluster.id}`, assetId);
        }
        if (resource.presentation.depletedAssetId) {
          checkAsset(`${region.id}: cluster ${cluster.id}`, resource.presentation.depletedAssetId);
        }
      } catch {
        problems.push(`${region.id}: cluster ${cluster.id} references missing resource ${cluster.resourceId}`);
      }
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
        if (obstacle.composition !== undefined && !isCompositionId(obstacle.composition)) {
          problems.push(
            `${dungeon.id}: obstacle ${obstacle.id} names unknown composition ` +
            `"${String(obstacle.composition)}"`,
          );
        }
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
