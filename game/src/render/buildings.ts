/**
 * Prefab assembly: a prefab name plus a footprint, out comes an ordered list of part placements.
 *
 * The Medieval Village MegaKit ships **no prebuilt house** (asset-report, gap 4). It is a strictly
 * modular kit on a **2 m grid with a 3.123 m storey**, measured off the real GLBs rather than
 * assumed:
 *
 *   wall_*            2.000 x 3.123 x 0.406, pivot centred in X, on the floor in Y, outward face
 *                     at z = +0.093 with the panel body running back to z = -0.314
 *   corner_wood       0.210 x 3.000 x 0.240, pivot centred, on the floor
 *   corner_brick      0.531 x 3.016 x 0.576, pivot near the inner corner
 *   wall_bottom_trim  2.000 x 0.238 x 0.432, straddles y = 0
 *   roof_tiles_4x6    covers a 4 (X) x 6 (Z) building; bbox 5.513 x 4.234 x 7.572, eaves included
 *   roof_tiles_6x12   covers a 6 (X) x 12 (Z) building; bbox 8.250 x 5.672 x 13.658
 *   roof_tower        bbox 5.651 x 7.361 x 5.427, base at y = -0.572
 *   chimney           0.946 x 3.178 x 1.000, on the floor
 *   door_round_1/2    pivot on the LEFT jamb (x = 0 .. 1.07), so a centred door needs dx -= 0.55
 *   roof_log          pivot 3.85 m BELOW the beam; the beam runs along local Z, +-5.35
 *   support_beam      a horizontal beam at y 1.709 with a knee brace and a stub foot at z -0.118,
 *                     pivot 1.21 m BELOW the beam - a bracket, not a post
 *   overhang_plaster  2.000 x 3.028 x 2.200; a whole wall panel whose canopy reaches z +2.0
 *   overhang_brick    2.000 x 0.266 x 2.022; a bare slab, no wall, pivot 0.324 above its underside
 *   wall_arch         2.000 x 3.000 x 0.064, clear opening only 1.44 m wide - 72% of the panel at
 *                     every scale, which is why it cannot frame a 4 m gate (see `gatehouse`)
 *   roof_wood_plank   2.258 x 1.560 mono-pitch, high at its own z 0, low at z 1.56
 *   kerb_straight     2.000 x 0.134 x 0.700, body entirely on the +Z side of the pivot
 *
 * Nothing in here invents an asset id. Every id below appears in game/public/assets/manifest.json
 * and was measured with @gltf-transform/core, not guessed. `prefabPartAssetIds()` and
 * `compositionPartAssetIds()` are the lists `content/regions.ts` validates against a real manifest.
 *
 * This module emits **data**, never meshes. A part is (assetId, local offset, local yaw, scale);
 * the world layer turns each into a `SemanticEntity.view` and the existing `render/entityViews.ts`
 * instancing path batches hundreds of wall segments into a handful of draw calls. Adding Three.js
 * here would defeat that, so this file imports nothing from Three.
 *
 * Local frame convention, shared by every prefab and composition:
 *   +X right, +Y up, +Z **forward, out of the building's front face**.
 *   The caller rotates the whole list by the authored `rotationY` and translates it to the
 *   building's ground position, so a prefab is authored once facing +Z and reused at any bearing.
 */
import { Rng } from "../core/rng.js";

// ------------------------------------------------------------------ constants

/** The kit's horizontal module. Snap to this or pieces do not meet. */
export const MODULE_METRES = 2;

/** Measured wall height. Stack storeys on this exactly. */
export const STOREY_METRES = 3.123;

/** Where a wall's outward face sits relative to its pivot. */
const WALL_FACE = 0.093;

/** Measured panel thickness: a wall runs from z = +WALL_FACE back to z = WALL_FACE - 0.406. */
const WALL_THICKNESS = 0.406;

/** `door_round_*` pivot on their left jamb; this centres them in a 2 m module. */
const DOOR_LEAF_OFFSET = -0.55;

/**
 * Clear width of a gate passage, in metres. Was an inline `2` in two places.
 *
 * Measured: the world is 700 m across, so `navigation.ts` picks the 0.45 m large-world cell, and
 * `NAV_CONFIG.walkableRadius` erodes the navmesh by one cell per side. At the old walkableRadius 2
 * that was 0.90 m per side, which left a 2 m arch with 0.20 m of walkable floor - less than one
 * cell, so Recast dropped it entirely and `getNavPath` detoured 4-5 m around all three gates in the
 * game, including the one the player spawns in front of. At walkableRadius 1 the erosion is 0.45 m
 * per side, so this 4 m gap leaves a 3.10 m corridor against a 0.35 m PLAYER_RADIUS.
 *
 * `gateGeometry()` is the single place that turns this into pier positions, and both `gatehouse()`
 * and `prefabCollision("gatehouse")` call it, so the drawn gap and the collided gap are the same
 * number by construction. A gatehouse needs an [8,3] footprint to reach it; at [6,3] there is only
 * room for one 2 m pier per side and a 2 m gap.
 */
export const GATE_GAP_METRES = 4;

/**
 * How far a tiled roof overhangs the footprint it covers, per side, at the scale `roofFit` returns.
 *
 * Measured off `roof_tiles_4x6`: the asset's bbox is 5.513 x 7.572 for a nominal 4 x 6 building, so
 * the eaves are (5.513 - 4) / 2 = 0.757 m in X and (7.572 - 6) / 2 = 0.786 m in Z, and they are
 * part of the mesh rather than something the fit adds. That is why Coldbrace houses 5 and 6, placed
 * corner to corner with gapX = gapZ = 0.00, interpenetrate over 1.57 x 1.51 m of tile: two roofs
 * each reaching 0.79 m past their own walls. Author neighbouring buildings at least
 * `footprint + 2 * ROOF_EAVE_METRES` apart, and round up.
 */
export const ROOF_EAVE_METRES = 0.79;

/**
 * How far a covered bay's canopy reaches out from the wall it hangs on.
 *
 * Measured on both kit overhangs so `porch`, `arcade` and `bank_counter` can put a post under the
 * front edge without knowing which kit they are in: `overhang_plaster`'s canopy runs from z +0.2 to
 * z +2.0, and `overhang_brick`'s slab spans z -1.022 to +1.000 about its pivot. Placed as
 * `coveredBay` places them, both stop at 2.0 m.
 */
const CANOPY_DEPTH_METRES = 2;

// ------------------------------------------------------------------- types

/**
 * One placed piece of a prefab. Offsets are metres in the prefab's local frame, before the
 * building's own rotation and translation. `scale` is a true metre multiplier: 1 means the asset's
 * authored size. The caller is responsible for cancelling any global silhouette scaling.
 */
export interface PartPlacement {
  /** Unique within one prefab instance. Becomes the entity id suffix, so it must be stable. */
  readonly tag: string;
  readonly assetId: string;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  /** Added to the parent's rotation. */
  readonly rotationY: number;
  readonly scale: number;
}

/**
 * Every prefab the authored data may name.
 *
 * This union used to live in `content/regions.ts` and be imported here, which meant the render
 * layer could not add a building type without the content layer being edited in the same change.
 * It is defined here now because this is the file that knows how to assemble one; `content` keeps
 * its own `PrefabId` for `BuildingDef.prefab` and every value it can hold is a member of this one,
 * which the compiler checks at `buildPrefab`'s call site in `world/regionBuilder.ts`.
 *
 * The last five are the open structures. The diagnosis measured why they exist rather than real
 * interiors: a 6x4 cottage's interior erodes to 4.7 m² of navmesh, which is enough floor, but its
 * 2 m doorway erodes to 0.20 m, so Recast leaves that floor as an island the player can never path
 * to. `forge`, `porch`, `arcade`, `market_row` and `well` are all walkable at the current nav
 * config precisely because none of them has a doorway to pinch shut.
 */
export type PrefabId =
  | "cottage" | "hall" | "tower" | "stall" | "wall_segment"
  | "gatehouse" | "shed" | "ruin" | "quarry_hut"
  | "forge" | "porch" | "arcade" | "market_row" | "well";

export const PREFAB_IDS: readonly PrefabId[] = [
  "cottage", "hall", "tower", "stall", "wall_segment", "gatehouse", "shed", "ruin", "quarry_hut",
  "forge", "porch", "arcade", "market_row", "well",
] as const;

export function isPrefabId(value: string): value is PrefabId {
  return (PREFAB_IDS as readonly string[]).includes(value);
}

/**
 * A hand-authored set-dressing group for a landmark, a region gate, or the dungeon mouth.
 *
 * Finding 8 of the round-1 critique: a landmark drawn as one stand-in prop gives the player no
 * silhouette to navigate by. Each id here is a small composition of real parts around the
 * landmark's own hero mesh.
 */
export type CompositionId =
  | "vault_door"
  | "milestone"
  | "highcairn_crane"
  | "gravelmaw_mouth"
  | "great_cairn"
  | "standing_stones"
  | "rootfall_stump"
  | "region_gate"
  | "bank_counter"
  | "forge_yard"
  | "market_pitch"
  | "wood_pile"
  | "garden";

export const COMPOSITION_IDS: readonly CompositionId[] = [
  "vault_door", "milestone", "highcairn_crane", "gravelmaw_mouth",
  "great_cairn", "standing_stones", "rootfall_stump", "region_gate",
  "bank_counter", "forge_yard", "market_pitch", "wood_pile", "garden",
] as const;

export function isCompositionId(value: string): value is CompositionId {
  return (COMPOSITION_IDS as readonly string[]).includes(value);
}

// ------------------------------------------------------------------ helpers

/**
 * Deterministic 32-bit hash of an entity id. Prefab variation is seeded from the building's own id
 * rather than from the shared `"world"` RNG stream, so adding a building cannot shift the node
 * jitter or enemy placement of anything built before it. Same seed in, same wall layout out.
 */
export function variantSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** How many 2 m modules a side of the given length takes. Never zero. */
function moduleCount(length: number): number {
  return Math.max(1, Math.round(length / MODULE_METRES));
}

interface Side {
  /** Outward yaw: 0 = +Z, PI/2 = +X, PI = -Z, -PI/2 = -X. */
  yaw: number;
  /** Distance from the footprint centre to this face. */
  half: number;
  /** Run of the face, in metres. */
  length: number;
}

/** North, east, south, west, in that fixed order. Index 2 is always the entry face. */
function ringSides(width: number, depth: number): Side[] {
  return [
    { yaw: 0, half: depth / 2, length: width },
    { yaw: Math.PI / 2, half: width / 2, length: depth },
    { yaw: Math.PI, half: depth / 2, length: width },
    { yaw: -Math.PI / 2, half: width / 2, length: depth },
  ];
}

/**
 * Position of module `index` of `count` on a side, pushed `out` metres beyond the face and lifted
 * to `y`. `along` shifts within the module (a door leaf, a lamp beside it).
 */
function onSide(
  side: Side,
  count: number,
  index: number,
  y: number,
  out: number,
  along = 0,
): { dx: number; dy: number; dz: number } {
  const spacing = side.length / count;
  const offset = (index + 0.5) * spacing - side.length / 2 + along;
  const outX = Math.sin(side.yaw);
  const outZ = Math.cos(side.yaw);
  // The wall's local +X after a yaw rotation.
  const alongX = Math.cos(side.yaw);
  const alongZ = -Math.sin(side.yaw);
  return {
    dx: outX * (side.half + out) + alongX * offset,
    dy: y,
    dz: outZ * (side.half + out) + alongZ * offset,
  };
}

function part(
  tag: string,
  assetId: string,
  at: { dx: number; dy: number; dz: number },
  rotationY: number,
  scale = 1,
): PartPlacement {
  return { tag, assetId, dx: r3(at.dx), dy: r3(at.dy), dz: r3(at.dz), rotationY: r4(rotationY), scale: r4(scale) };
}

function loose(tag: string, assetId: string, dx: number, dy: number, dz: number, rotationY = 0, scale = 1): PartPlacement {
  return { tag, assetId, dx: r3(dx), dy: r3(dy), dz: r3(dz), rotationY: r4(rotationY), scale: r4(scale) };
}

function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The plinth course under one wall module.
 *
 * WHY EVERY WALL GETS ONE NOW. In runs/corealm/screenshots/baseline-town_entrance.png every panel
 * meets the grass on a straight cut, so the cottages read as slabs standing on the ground instead
 * of buildings coming out of it - and `checkBuildingFooting()` reports worst = 0 for all 36
 * buildings, so the pads are right and the missing thing is geometry, not height. `wall_bottom_trim`
 * is the kit's own answer: 2.000 x 0.238 x 0.432 straddling y = 0 from -0.117 to +0.121, and it
 * was used on exactly one face of exactly one prefab (`hall`). It is offset 0.01 m out from the
 * panel face so the two coplanar surfaces do not z-fight.
 *
 * Cost: one instance per module, and one draw call per (region, tier) that did not already draw
 * the asset - measured at +2 across the whole game, because Coldbrace's hall already had it.
 */
function trimUnder(
  out: PartPlacement[], tag: string, side: Side, count: number, index: number,
): void {
  out.push(part(tag, "wall_bottom_trim", onSide(side, count, index, 0, 0.01), side.yaw));
}

/** Corner posts at the four footprint corners, each turned to face its diagonal. */
function corners(
  out: PartPlacement[],
  width: number,
  depth: number,
  assetId: string,
  y: number,
  scale: number,
  tagPrefix: string,
): void {
  const signs: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [index, sign] of signs.entries()) {
    const sx = sign[0];
    const sz = sign[1];
    out.push(loose(
      `${tagPrefix}${index}`, assetId,
      (width / 2) * sx, y, (depth / 2) * sz,
      Math.atan2(sx, sz), scale,
    ));
  }
}

/**
 * Uniform scale for a tiled roof over `width` x `depth`, given the building size the roof asset is
 * authored to cover. The asset's ridge runs along its local Z, so a building wider than it is deep
 * takes a quarter turn.
 *
 * Checked against finding 11 ("houses 5 and 6 have interpenetrating roofs"): this does NOT
 * over-scale them. A 6x4 cottage in the plaster kit returns exactly 1.0, and the 1.57 x 1.51 m of
 * overlapping tile comes from `ROOF_EAVE_METRES` - the asset carries 0.76-0.79 m of eaves in its
 * own bbox - plus a layout that placed the two footprints corner to corner with zero gap. The fix
 * is spacing, in the settlement data, not scale here.
 *
 * What IS worth knowing before authoring a footprint: because the scale is uniform and takes the
 * larger of the two ratios, a plan squarer than the asset's own 4:6 over-runs on the long side. A
 * 6x5 forge in the plaster kit scales to 1.25 to cover its 5 m width and therefore draws a roof
 * 7.5 m long over a 6 m building. Author open structures nearer the asset's aspect, or accept the
 * extra 0.75 m per end as deep eaves.
 */
function roofFit(
  width: number,
  depth: number,
  coversShort: number,
  coversLong: number,
): { scale: number; rotationY: number } {
  const long = Math.max(width, depth);
  const short = Math.min(width, depth);
  const scale = Math.max(short / coversShort, long / coversLong);
  return { scale, rotationY: width >= depth ? Math.PI / 2 : 0 };
}

// -------------------------------------------------------------- building kits

/**
 * The vernacular of one region: which wall family, which corner post, which roof, what a house is
 * made of.
 *
 * Phase 1 built every settlement out of one kit. Highcairn is a tier-10 quarry town forty metres
 * up a slate terrace and Coldbrace is a tier-1 farming village on a river plain, and they were the
 * same eight cottages with the same plaster panels under the same orange pantiles; only the ground
 * colour told them apart. Nine more regions on top of that would have multiplied the problem by
 * nine, which is why the Phase 1 report put this before Phase 2 rather than in it.
 *
 * What the free kit actually gives us, measured rather than hoped for: two complete wall families
 * (plaster and brick), two corner posts, and three tiled roofs at two different pitches
 * (`roof_tiles_4x6` is 4.234 / 5.513 = 0.77; the 6-wide roofs are 5.672 / 8.250 = 0.69). It does
 * NOT ship a second roof covering — `roof_wood_plank` is a single 2.3 m board and
 * `roof_gable_brick` is a gable END, not a roof. So a kit differs in wall family, corner, roof
 * pitch, roof trim, and eaves; the tile texture itself is shared and re-coloured by the material
 * layer, which is the only thing the tint rule permits.
 */
export interface BuildingKit {
  id: KitId;
  wall: string;
  wallWindow: string;
  wallDoor: string;
  /** The richer wall used on halls and civic buildings. */
  wallFeature: string;
  corner: string;
  door: string;
  /** The 4x6-class roof, for cottages, sheds and huts. */
  roofSmall: string;
  /** Metres the small roof covers, short side then long. */
  roofSmallCovers: readonly [number, number];
  /**
   * Metres from the small roof's placement height to its ridge, at scale 1.
   *
   * Measured, not derived: these roofs pivot above their own eaves, so the bbox height is not the
   * distance from where the part is placed to where its ridge is. `roof_tiles_4x6` is 4.234 tall
   * and pivots 0.52 above its base, giving 3.71; `roof_tiles_6x8` is 5.672 and pivots 0.70,
   * giving 4.97. Anything that has to sit ON the ridge — a log, a finial — needs this number.
   */
  roofSmallApex: number;
  /** The long roof, for halls. */
  roofLarge: string;
  roofLargeCovers: readonly [number, number];
  /** Trim laid along the ridge line. Empty when the kit has none. */
  ridge: string | null;
  /** A dormer or gable end that changes the roofline. Empty when the kit has none. */
  roofFeature: string | null;
}

export type KitId = "plaster" | "timber" | "stone";

export const BUILDING_KITS: Record<KitId, BuildingKit> = {
  // Coldbrace. Lime-washed plaster over a timber frame, fired pantiles, a steep pitch to shed rain
  // off the river plain. The oldest and plainest of the three.
  plaster: {
    id: "plaster",
    wall: "wall_plaster_straight",
    wallWindow: "wall_plaster_window",
    wallDoor: "wall_plaster_door",
    wallFeature: "wall_plaster_timber",
    corner: "corner_wood",
    door: "door_round_1",
    roofSmall: "roof_tiles_4x6",
    roofSmallCovers: [4, 6],
    roofSmallApex: 3.71,
    roofLarge: "roof_tiles_6x12",
    roofLargeCovers: [6, 12],
    ridge: null,
    roofFeature: null,
  },
  // Rootfall. A logging town: every wall is exposed frame, every corner is a post, and the roofs
  // carry a felled log along the ridge because that is what the town has to spare. Dormers break
  // the roofline, which is what makes Rootfall read as a different place from the ridge above it.
  timber: {
    id: "timber",
    wall: "wall_plaster_timber",
    wallWindow: "wall_plaster_window",
    wallDoor: "wall_plaster_door",
    wallFeature: "wall_plaster_timber",
    corner: "corner_wood",
    door: "door_round_2",
    roofSmall: "roof_tiles_4x6",
    roofSmallCovers: [4, 6],
    roofSmallApex: 3.71,
    roofLarge: "roof_tiles_6x12",
    roofLargeCovers: [6, 12],
    ridge: "roof_log",
    roofFeature: "roof_dormer",
  },
  // Highcairn. Built out of the quarry it works: brick and cut stone to the eaves, brick corner
  // piers, and the shallower 6-wide roof, which reads as a lower, heavier building even at the
  // distance the whole terrace is seen from.
  stone: {
    id: "stone",
    wall: "wall_brick_straight",
    wallWindow: "wall_brick_window",
    wallDoor: "wall_brick_door",
    wallFeature: "wall_brick_window",
    corner: "corner_brick",
    door: "door_flat_1",
    roofSmall: "roof_tiles_6x8",
    roofSmallCovers: [6, 8],
    roofSmallApex: 4.97,
    roofLarge: "roof_tiles_6x12",
    roofLargeCovers: [6, 12],
    ridge: null,
    roofFeature: "roof_gable_brick",
  },
};

export const KIT_IDS: readonly KitId[] = ["plaster", "timber", "stone"] as const;

export function isKitId(value: string): value is KitId {
  return (KIT_IDS as readonly string[]).includes(value);
}

// ------------------------------------------------------------------ prefabs

/**
 * Assemble a prefab. Deterministic: the same `(prefab, footprint, seed, kit)` always returns the
 * same ordered list, so a rebuild at the same world seed is byte-identical.
 */
export function buildPrefab(
  prefab: PrefabId,
  footprint: readonly [number, number],
  seed: number,
  kitId: KitId = "plaster",
): PartPlacement[] {
  const width = Math.max(MODULE_METRES, footprint[0]);
  const depth = Math.max(MODULE_METRES, footprint[1]);
  const rng = new Rng(seed);
  const kit = BUILDING_KITS[kitId];

  switch (prefab) {
    case "cottage": return cottage(width, depth, rng, kit);
    case "hall": return hall(width, depth, rng, kit);
    case "tower": return tower(width, depth, rng, kit);
    case "shed": return shed(width, depth, rng, kit);
    case "quarry_hut": return quarryHut(width, depth, rng, kit);
    case "gatehouse": return gatehouse(width, depth, kit);
    case "wall_segment": return wallSegment(width, kit);
    case "stall": return stall(rng);
    case "ruin": return ruin(width, depth, rng, kit);
    case "forge": return forge(width, depth, rng, kit);
    case "porch": return porch(width, depth, kit);
    case "arcade": return arcade(width, depth, kit);
    case "market_row": return marketRow(width, depth, rng);
    case "well": return well(kit);
  }
}

/** Solid height in metres, for the collision box the root builds from the same footprint. */
export function prefabHeight(prefab: PrefabId): number {
  switch (prefab) {
    case "tower": return 2 * STOREY_METRES + 6.8;
    case "hall": return STOREY_METRES + 4.9;
    case "cottage": return STOREY_METRES + 3.7;
    case "quarry_hut": return STOREY_METRES + 3.2;
    case "shed": return STOREY_METRES + 2.8;
    case "gatehouse": return 2 * STOREY_METRES;
    case "wall_segment": return STOREY_METRES;
    case "ruin": return STOREY_METRES;
    case "stall": return 2.7;
    case "forge": return STOREY_METRES + 3.0;
    // The porch and the arcade are roofs you walk under; the number is the height of the thing that
    // is actually solid, which for both is the back wall, not the canopy over your head.
    case "porch": return STOREY_METRES;
    case "arcade": return STOREY_METRES;
    case "market_row": return 2.7;
    // A wellhead is a curb 1 m high. Its roof clears 3.2 m and is deliberately not solid.
    case "well": return 1;
  }
}

/**
 * Six by four, one storey, tiled roof, chimney on the eave slope. Windows and the door module move
 * with the seed so eight cottages on one street are not eight copies of the same elevation.
 */
function cottage(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      let assetId = kit.wall;
      if (isDoor) assetId = kit.wallDoor;
      else if (rng.chance(0.45)) assetId = kit.wallWindow;
      out.push(part(`w${s}_${index}`, assetId, onSide(side, count, index, 0, 0), side.yaw));
      trimUnder(out, `t${s}_${index}`, side, count, index);
    }
  }

  corners(out, width, depth, kit.corner, 0, 1, "c");

  const roof = roofFit(width, depth, kit.roofSmallCovers[0], kit.roofSmallCovers[1]);
  out.push(loose("roof", kit.roofSmall, 0, STOREY_METRES, 0, roof.rotationY, roof.scale));
  addRoofline(out, width, depth, roof, kit);

  // On the eave slope, a quarter of the way in from the gable, so it clears the tiles and still
  // reads against the sky rather than hiding behind the ridge.
  out.push(loose(
    "chimney", "chimney",
    (width >= depth ? width : depth) * 0.26 * (rng.chance(0.5) ? 1 : -1),
    STOREY_METRES - 0.3,
    (width >= depth ? depth : width) / 2 - 0.55,
    0, 1,
  ));

  out.push(part(
    "door", kit.door,
    onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET),
    entry.yaw,
  ));

  return out;
}

/**
 * The thing that makes a roof belong to a region rather than to a kit-bash.
 *
 * The library ships one tiled covering at two pitches and nothing else — `roof_wood_plank` is a
 * single 2.3 m board and `roof_gable_brick` is a gable END — so the ROOFLINE is where a settlement
 * gets its silhouette. Rootfall lays a felled log along the ridge and breaks the slope with a
 * dormer; Highcairn closes the gable ends in brick; Coldbrace does neither. Seen from the hillside
 * above, that is the difference between "a village" and "this village".
 */
function addRoofline(
  out: PartPlacement[],
  width: number,
  depth: number,
  roof: { scale: number; rotationY: number },
  kit: BuildingKit,
): void {
  // `roofFit` rotates the roof by PI/2 when the building is wider than it is deep, so the ridge
  // runs along local Z exactly when it did not rotate.
  const alongZ = roof.rotationY === 0;
  const ridgeLength = alongZ ? depth : width;
  const ridgeY = STOREY_METRES + kit.roofSmallApex * roof.scale;

  if (kit.ridge === "roof_log") {
    // roof_log's pivot is 3.85 m below the beam, and the beam runs along local Z for +-5.35 m, so
    // the log is scaled to the ridge it lies on and then dropped by its own pivot. Getting the
    // apex wrong buries it in the tiles and pushes its ends out through the eaves, which is
    // exactly how it looked before `roofSmallApex` was measured rather than guessed at.
    const logScale = Math.min(1, ridgeLength / 10.7);
    out.push(loose(
      "ridge", kit.ridge,
      // Bedded 0.2 m INTO the tiles: a ridge log is laid on the roof, not balanced on top of it.
      0, ridgeY - 3.85 * logScale - 0.2, 0,
      alongZ ? 0 : Math.PI / 2, logScale,
    ));
  }

  if (kit.roofFeature === "roof_dormer") {
    // Halfway up the eave slope, opposite the chimney: a window looking out of the roof.
    const outward = (alongZ ? width : depth) / 2 - 0.5;
    out.push(loose(
      "dormer", "roof_dormer",
      alongZ ? -outward : 0,
      STOREY_METRES + 0.55,
      alongZ ? 0 : -outward,
      alongZ ? -Math.PI / 2 : Math.PI,
      1,
    ));
  }

  if (kit.roofFeature === "roof_gable_brick") {
    // 6.694 x 4.516 x 1.129: a gable end. One at each end of the ridge closes the roof in stone,
    // which is what a town that owns a quarry would actually build.
    const gableScale = ((alongZ ? width : depth) / 6.694) * 1.08;
    for (const [index, sign] of [-1, 1].entries()) {
      out.push(loose(
        `gable${index}`, "roof_gable_brick",
        alongZ ? 0 : (ridgeLength / 2) * sign,
        STOREY_METRES - 0.1,
        alongZ ? (ridgeLength / 2) * sign : 0,
        alongZ ? 0 : Math.PI / 2,
        gableScale,
      ));
    }
  }
}

/** Twelve by six timber-framed hall: the biggest thing in Coldbrace after the vault tower. */
function hall(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      let assetId = kit.wallFeature;
      if (isDoor) assetId = kit.wallDoor;
      else if (index % 2 === (rng.chance(0.5) ? 0 : 1)) assetId = kit.wallWindow;
      out.push(part(`w${s}_${index}`, assetId, onSide(side, count, index, 0, 0), side.yaw));
      // Was long faces only, on the theory that the gable ends are not where the player walks.
      // Wrong on the measurement: the hall is 12 x 6 in the middle of an open square, so both
      // gable ends are seen from 8 m away, and the four modules saved were four modules of
      // untrimmed wall next to trimmed wall on the same building.
      trimUnder(out, `t${s}_${index}`, side, count, index);
    }
  }

  corners(out, width, depth, kit.corner, 0, 1, "c");

  const roof = roofFit(width, depth, kit.roofLargeCovers[0], kit.roofLargeCovers[1]);
  out.push(loose("roof", kit.roofLarge, 0, STOREY_METRES, 0, roof.rotationY, roof.scale));
  out.push(loose("chimney", "chimney", width * 0.3, STOREY_METRES - 0.3, depth / 2 - 0.55, 0, 1.1));

  out.push(part(
    "door", kit.door,
    onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET),
    entry.yaw,
  ));
  // banner_1 hangs from its pivot (y -1.549 .. +0.844) with the cloth to its right (x 0 .. 1.612).
  out.push(part("banner_l", "banner_1", onSide(entry, entryCount, doorIndex, 2.6, 0.12, -2.4), entry.yaw));
  out.push(part("banner_r", "banner_1", onSide(entry, entryCount, doorIndex, 2.6, 0.12, 1.6), entry.yaw));
  out.push(part("lamp_l", "lamp_wall", onSide(entry, entryCount, doorIndex, 1.3, 0.08, -1.2), entry.yaw, 1.1));
  out.push(part("lamp_r", "lamp_wall", onSide(entry, entryCount, doorIndex, 1.3, 0.08, 1.2), entry.yaw, 1.1));

  return out;
}

/**
 * Two storeys under a spire. "Visible from 300 m, which is the entire point of it" - 6.25 m of wall
 * plus a 7.9 m roof puts the finial at about 14 m, the tallest thing in Fallowmarch.
 *
 * It used to hardcode `wall_brick_straight` and `corner_brick` regardless of kit, which is why
 * Coldbrace's lime-plaster village had a brick vault tower in the middle of it. Same fix as
 * `wallSegment`, `gatehouse` and `ruin`.
 */
function tower(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  for (let storey = 0; storey < 2; storey += 1) {
    const y = storey * STOREY_METRES;
    for (const [s, side] of sides.entries()) {
      const count = moduleCount(side.length);
      for (let index = 0; index < count; index += 1) {
        const isDoor = storey === 0 && s === 2 && index === doorIndex;
        let assetId = kit.wall;
        if (isDoor) assetId = kit.wallDoor;
        else if (storey === 1 && index === Math.floor(count / 2)) assetId = kit.wallWindow;
        else if (storey === 0 && rng.chance(0.25)) assetId = kit.wallWindow;
        out.push(part(`w${storey}_${s}_${index}`, assetId, onSide(side, count, index, y, 0), side.yaw));
        if (storey === 0) trimUnder(out, `t${s}_${index}`, side, count, index);
      }
    }
    corners(out, width, depth, kit.corner, y, 1, `c${storey}_`);
  }

  // roof_tower's bbox is 5.651 across; oversize it slightly so the eaves clear the walls.
  out.push(loose("spire", "roof_tower", 0, 2 * STOREY_METRES, 0, 0, (Math.max(width, depth) + 0.6) / 5.651));

  out.push(part(
    "door", kit.door,
    onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET),
    entry.yaw,
  ));
  out.push(part("lamp_l", "lamp_wall", onSide(entry, entryCount, doorIndex, 2.1, 0.08, -1.3), entry.yaw, 1.2));
  out.push(part("lamp_r", "lamp_wall", onSide(entry, entryCount, doorIndex, 2.1, 0.08, 1.3), entry.yaw, 1.2));

  return out;
}

/** Four by four store shed. Plain walls, plank roof, a crate against the back wall. */
function shed(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = rng.int(0, Math.max(0, entryCount - 1));

  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      out.push(part(
        `w${s}_${index}`,
        isDoor ? kit.wallDoor : kit.wall,
        onSide(side, count, index, 0, 0),
        side.yaw,
      ));
      trimUnder(out, `t${s}_${index}`, side, count, index);
    }
  }

  corners(out, width, depth, kit.corner, 0, 1, "c");
  // The small roof at 0.8 of the footprint it covers leaves eaves all round a 4 x 4 shed with no
  // gaps. The ratio is against the kit's own coverage, so the stone kit's wider roof does not
  // swallow the shed it sits on.
  const shedScale = 0.8 * (4 / kit.roofSmallCovers[0]);
  out.push(loose("roof", kit.roofSmall, 0, STOREY_METRES, 0, width >= depth ? Math.PI / 2 : 0, shedScale));
  out.push(part("door", kit.door, onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET), entry.yaw));
  out.push(loose("crate", "crate_village", width * 0.3, 0, -depth / 2 - 0.65, rng.float(0, Math.PI), 1));

  return out;
}

/** Five by four quarry crew hut: timber walls, a plank roof, props and a tool crate. */
function quarryHut(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      let assetId = kit.wallFeature;
      if (isDoor) assetId = kit.wallDoor;
      else if (rng.chance(0.35)) assetId = kit.wallWindow;
      out.push(part(`w${s}_${index}`, assetId, onSide(side, count, index, 0, 0), side.yaw));
      trimUnder(out, `t${s}_${index}`, side, count, index);
    }
  }

  corners(out, width, depth, kit.corner, 0, 1, "c");
  const hutRoof = roofFit(width, depth, kit.roofSmallCovers[0], kit.roofSmallCovers[1]);
  out.push(loose("roof", kit.roofSmall, 0, STOREY_METRES, 0, hutRoof.rotationY, hutRoof.scale * 0.98));
  addRoofline(out, width, depth, hutRoof, kit);
  out.push(part("door", kit.door, onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET), entry.yaw));

  // support_beam's pivot is 1.211 m under the post, so it has to be dropped to stand on the ground.
  out.push(loose("prop_l", "support_beam", -width / 2 - 0.35, -1.211 * 1.3, depth * 0.2, Math.PI / 2, 1.3));
  out.push(loose("prop_r", "support_beam", width / 2 + 0.35, -1.211 * 1.3, -depth * 0.2, -Math.PI / 2, 1.3));
  out.push(loose("crate", "crate_metal", -width * 0.25, 0, -depth / 2 - 0.6, rng.float(0, Math.PI), 1.2));

  return out;
}

/**
 * How a gatehouse of a given footprint width divides into two piers and the gap between them.
 *
 * The one place the gate's clear width is decided. `gatehouse()` draws to it and
 * `prefabCollision("gatehouse")` collides to it, so the hole you can see and the hole you can walk
 * through are the same hole - which they were not: the drawn arch was 4 m wide and the collision
 * gap was 2 m, and after navmesh erosion the walkable part of it was 0.20 m.
 *
 * Piers are always whole unscaled 2 m modules. Scaling a wall panel to make a pier fit would scale
 * its height too (a 1 m pier is a 1.56 m wall), so the gap absorbs the remainder instead and the
 * floor is one module per side. `width - 2 * pierWidth` is therefore never narrower than
 * GATE_GAP_METRES once the footprint is 8 m or more, and at 6 m it is 2 m, which is the widest a
 * 6 m gatehouse can be.
 */
function gateGeometry(width: number): { pierWidth: number; gap: number } {
  // Snapped to the module grid, then floored at 6 m: below that there is no room for two piers and
  // a passage at all, and off-grid the head course would need a fractional panel. Both callers
  // clamp identically, so an off-grid footprint still gets collision that matches its geometry.
  const usable = Math.max(3 * MODULE_METRES, MODULE_METRES * Math.round(width / MODULE_METRES));
  const roomFor = Math.max(1, Math.floor((usable - MODULE_METRES) / (2 * MODULE_METRES)));
  const wanted = Math.floor((usable - GATE_GAP_METRES) / (2 * MODULE_METRES));
  const pierWidth = Math.max(1, Math.min(roomFor, wanted)) * MODULE_METRES;
  return { pierWidth, gap: usable - 2 * pierWidth };
}

/**
 * A walled gate: two piers two storeys high, with the upper storey carried across the gap so there
 * is a chamber over the road instead of a hole in the skyline.
 *
 * WHY THE `wall_arch` PANEL IS GONE. It was the obvious thing to span the gap with and it is the
 * reason the gate never worked. Measured off the GLB: the panel is 2.000 x 3.000 x 0.064 with solid
 * jambs from |x| = 0.72 outwards, so its clear opening is 1.44 m of a 2 m panel - 72%, fixed, at
 * every scale. To show a 4 m opening it has to be 5.56 m wide and therefore 8.33 m tall, which is
 * 2.1 m above a two-storey gatehouse; scaled to fit the height instead it shows a 3.0 m opening in
 * front of a 4 m gap, so the player's shoulder passes through the jamb. There is no scale at which
 * the arch's opening, the pier gap and the collision box agree. A kit head course over an open gap
 * makes all three exactly GATE_GAP_METRES, and it threads the kit, which the brick arch never did.
 */
function gatehouse(width: number, depth: number, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const { pierWidth, gap } = gateGeometry(width);
  const usable = gap + 2 * pierWidth;
  const pierModules = Math.round(pierWidth / MODULE_METRES);
  const faceZ = depth / 2;
  // A wall panel's outward face is WALL_FACE past its pivot, so trim placed 0.01 further out sits
  // on the face rather than inside it; `outward` carries the flip for the -Z elevation.
  const faces: readonly (readonly [string, number, number])[] = [["f", faceZ, 0], ["b", -faceZ, Math.PI]];

  for (let storey = 0; storey < 2; storey += 1) {
    const y = storey * STOREY_METRES;
    for (const [name, z, yaw] of faces) {
      const outward = Math.sign(z);
      for (const [index, sx] of [-1, 1].entries()) {
        for (let m = 0; m < pierModules; m += 1) {
          const x = sx * (usable / 2 - (m + 0.5) * MODULE_METRES);
          out.push(loose(`p${name}${storey}_${index}_${m}`, kit.wall, x, y, z, yaw));
          if (storey === 0) {
            out.push(loose(`q${name}${index}_${m}`, "wall_bottom_trim", x, 0, z + outward * 0.01, yaw));
          }
        }
      }
      // The head: the upper storey carried across the gap. Clear headroom under it is one full
      // storey, 3.123 m, against a 1.8 m player.
      if (storey === 1) {
        // `gateGeometry` snaps the width to the module grid, so the gap is a whole number of
        // modules and every head panel is unscaled.
        const headModules = Math.max(1, Math.round(gap / MODULE_METRES));
        for (let m = 0; m < headModules; m += 1) {
          const x = (m + 0.5) * MODULE_METRES - gap / 2;
          const mid = m === Math.floor(headModules / 2);
          out.push(loose(`h${name}_${m}`, mid ? kit.wallWindow : kit.wall, x, y, z, yaw));
        }
      }
    }
    corners(out, usable, depth, kit.corner, y, 1, `c${storey}_`);
  }

  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(`lamp${index}`, "lamp_wall", (gap / 2 + 0.45) * sx, 2.3, faceZ + 0.12, 0, 1.2));
    // banner_1 hangs from its pivot (y -1.549 .. +0.844) with the cloth to its right, so the left
    // one is offset by its own 1.61 m width to hang symmetrically about the gate.
    out.push(loose(
      `banner${index}`, "banner_1",
      sx < 0 ? -gap / 4 - 1.61 : gap / 4, STOREY_METRES + 2.0, faceZ + 0.14, 0, 1.05,
    ));
  }

  return out;
}

/**
 * A straight run of town wall with a corner post at each end and trim along the base.
 *
 * Kept for the authored `wall_segment` buildings that predate `buildWallRun`. New settlements
 * should author a `WallRunDef` instead - four of these is 32 m of wall on a 212 m circuit, which is
 * the measured state of Coldbrace and the reason the player called it "a random gate without a
 * wall".
 */
function wallSegment(width: number, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const count = moduleCount(width);
  const spacing = width / count;
  for (let index = 0; index < count; index += 1) {
    const x = (index + 0.5) * spacing - width / 2;
    out.push(loose(`w${index}`, kit.wall, x, 0, 0, 0));
    out.push(loose(`t${index}`, "wall_bottom_trim", x, 0, 0.01, 0));
  }
  out.push(loose("end_l", kit.corner, -width / 2, 0, 0, -Math.PI / 4));
  out.push(loose("end_r", kit.corner, width / 2, 0, 0, Math.PI / 4));
  return out;
}

/** A market pitch. No authored settlement uses it yet; kept so the prefab table is total. */
function stall(rng: Rng): PartPlacement[] {
  return [
    loose("stall", "market_stall", 0, 0, 0, 0, 1),
    loose("crate", "crate_wood", -1.1, 0, -0.7, rng.float(0, Math.PI), 1),
    loose("barrel", "barrel", 1.1, 0, -0.6, rng.float(0, Math.PI), 1),
    loose("sack", "sack", 0.9, 0, 0.5, rng.float(0, Math.PI), 1),
  ];
}

/** A collapsed shell: two standing walls, a fallen corner, rubble and vines. */
function ruin(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const count = moduleCount(width);
  const spacing = width / count;
  for (let index = 0; index < count; index += 1) {
    const x = (index + 0.5) * spacing - width / 2;
    const lean = rng.float(-0.05, 0.05);
    out.push(loose(`w${index}`, kit.wall, x, 0, depth / 2, lean));
    // A ruin needs its footing more than anything else does: without it the standing panels read as
    // props dropped on grass rather than the last two walls of something that was built here. Same
    // lean as the panel above it, or the plinth shears away from the wall it is under.
    out.push(loose(`t${index}`, "wall_bottom_trim", x, 0, depth / 2 + 0.01, lean));
  }
  out.push(loose("side", kit.wall, -width / 2, 0, 0, -Math.PI / 2));
  out.push(loose("post", kit.corner, width / 2, 0, depth / 2, Math.PI / 4));
  out.push(loose("rub1", "rubble_brick_1", rng.float(-1.5, 1.5), 0, rng.float(-2, 0), rng.float(0, Math.PI), 2.4));
  out.push(loose("rub2", "rubble_brick_2", rng.float(-1.5, 1.5), 0, rng.float(-2, 0), rng.float(0, Math.PI), 2.2));
  out.push(loose("vine", "vine_1", -width / 2 + 0.2, 3.0, 0.4, -Math.PI / 2, 1.3));
  return out;
}

// ----------------------------------------------------------- open structures

/**
 * One 2 m bay of roof you can walk under, hung on a back wall at `backZ` and reaching
 * CANOPY_DEPTH_METRES out along +Z.
 *
 * The two kit overhangs are NOT the same shape, and the difference is the whole reason this helper
 * exists. Measured off the GLBs:
 *   overhang_plaster  2.000 x 3.028 x 2.200, base (-1, 0, -0.2) - a FULL wall panel standing from
 *                     y 0 to 3.028, whose canopy runs from z +0.2 to z +2.0 at y 2.68..3.03. One
 *                     part is a whole bay.
 *   overhang_brick    2.000 x 0.266 x 2.022, base (-1, -0.324, -1.022) - a bare slab with no wall
 *                     under it, hanging 0.324 m below its own pivot and spanning z -1.022..+1.000.
 *                     It needs a `kit.wall` behind it or there is nothing holding it up.
 * So plaster and timber take one part per bay and stone takes three. Both stop at z = backZ + 2.0,
 * which is where the callers put their posts.
 */
function coveredBay(
  out: PartPlacement[], tag: string, kit: BuildingKit, dx: number, backZ: number,
): void {
  if (kit.id === "stone") {
    out.push(loose(`${tag}w`, kit.wall, dx, 0, backZ, 0));
    out.push(loose(`${tag}t`, "wall_bottom_trim", dx, 0, backZ + 0.01, 0));
    // + 0.324 puts the slab's underside on the wall head at 3.123 rather than through it.
    out.push(loose(`${tag}o`, "overhang_brick", dx, STOREY_METRES + 0.324, backZ + 1, 0));
    return;
  }
  out.push(loose(`${tag}o`, "overhang_plaster", dx, 0, backZ, 0));
  out.push(loose(`${tag}t`, "wall_bottom_trim", dx, 0, backZ + 0.01, 0));
}

/** How many whole 2 m bays a covered structure of this width gets, at least `low`, at most `high`. */
function bayCount(width: number, low: number, high: number): number {
  return clamp(Math.round(width / MODULE_METRES), low, high);
}

/**
 * A working forge: walls on three sides, the fourth face wide open, and the anvil standing in the
 * mouth of it.
 *
 * This is the prefab that answers "a random bank chest and anvil just tossed in the middle of
 * town". Measured nearest building surface to the Coldbrace anvil today: 8.56 m of open grass. The
 * open face is LOCAL +Z, so a settlement author points it at the square with the same `rotationY`
 * they would use to point a cottage door at it, and there is no doorway to erode: the mouth is
 * `width - 1.2` m wide, which at a 6 m footprint leaves 4.8 m of opening and a 3.9 x 3.5 m navmesh
 * island connected to the square, instead of the 0.20 m a real door would have left.
 */
function forge(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);

  // Sides 1, 2, 3 only. Side 0 is +Z and stays open.
  for (const s of [1, 2, 3]) {
    const side = sides[s]!;
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const back = s === 2 && index === Math.floor(count / 2);
      const assetId = back || rng.chance(0.3) ? kit.wallWindow : kit.wall;
      out.push(part(`w${s}_${index}`, assetId, onSide(side, count, index, 0, 0), side.yaw));
      trimUnder(out, `t${s}_${index}`, side, count, index);
    }
  }

  corners(out, width, depth, kit.corner, 0, 1, "c");

  const roof = roofFit(width, depth, kit.roofSmallCovers[0], kit.roofSmallCovers[1]);
  out.push(loose("roof", kit.roofSmall, 0, STOREY_METRES, 0, roof.rotationY, roof.scale));
  addRoofline(out, width, depth, roof, kit);

  // support_beam is a horizontal beam at y 1.709 (at scale 1) with a knee brace and a stub foot at
  // its own z = -0.118; dropping it by 1.211 puts that foot on the ground. Two of them run back
  // from the mouth along each side wall, which is what stops the open face reading as a missing
  // wall. Scaled off the depth so the beam always ends inside the building.
  const strut = clamp(depth / 3, 1.2, 1.9);
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(
      `strut${index}`, "support_beam",
      (width / 2 - 0.3) * sx, -1.211 * strut, depth / 2 - 0.2, Math.PI, strut,
    ));
  }

  // On the back wall, facing out of the mouth: the only light source inside the structure.
  out.push(loose("lamp", "lamp_wall", -width * 0.22, 2.15, -depth / 2 + 0.4, 0, 1.15));

  return out;
}

/**
 * A roof on two posts and nothing else you can walk into. Two or three covered bays over a back
 * wall, a lamp and a banner.
 *
 * The canopy always projects exactly CANOPY_DEPTH_METRES from the footprint's back edge, so author
 * porch footprints 2.2-3.0 m deep; anything deeper leaves uncovered ground inside its own
 * exclusion rectangle. The bays snap to whole 2 m modules, so a [4,3] porch is two bays and a
 * [6,3] is three regardless of the exact authored width.
 */
function porch(width: number, depth: number, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const bays = bayCount(width, 2, 3);
  const span = bays * MODULE_METRES;
  const backZ = -depth / 2;
  const frontZ = backZ + CANOPY_DEPTH_METRES;

  for (let index = 0; index < bays; index += 1) {
    coveredBay(out, `b${index}_`, kit, (index + 0.5) * MODULE_METRES - span / 2, backZ);
  }
  // corner_wood is 3.000 tall and corner_brick 3.016, and both canopies soffit at 2.68 or higher,
  // so an unscaled post reaches the front edge in every kit.
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(`post${index}`, kit.corner, (span / 2 - 0.12) * sx, 0, frontZ - 0.12, Math.atan2(sx, 1)));
  }
  out.push(loose("lamp", "lamp_wall", -span / 2 + 0.7, 2.1, backZ + 0.35, 0, 1.15));
  out.push(loose("banner", "banner_1", span / 2 - 1.75, 2.4, backZ + 0.32, 0, 1.05));

  return out;
}

/** A covered market row: n bays of canopy over one back wall, on a colonnade. */
function arcade(width: number, depth: number, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const bays = bayCount(width, 2, 8);
  const span = bays * MODULE_METRES;
  const backZ = -depth / 2;
  const frontZ = backZ + CANOPY_DEPTH_METRES;

  for (let index = 0; index < bays; index += 1) {
    coveredBay(out, `b${index}_`, kit, (index + 0.5) * MODULE_METRES - span / 2, backZ);
  }
  // A post at every bay joint, not just the ends: the colonnade is the silhouette, and the posts
  // are the only thing that tells you at 40 m that the row is roofed rather than walled.
  for (let index = 0; index <= bays; index += 1) {
    const x = index * MODULE_METRES - span / 2;
    out.push(loose(`post${index}`, kit.corner, x, 0, frontZ - 0.12, 0));
  }
  out.push(loose("end_l", kit.corner, -span / 2, 0, backZ, -Math.PI / 4));
  out.push(loose("end_r", kit.corner, span / 2, 0, backZ, Math.PI / 4));
  out.push(loose("lamp_l", "lamp_wall", -span / 2 + 1, 2.1, backZ + 0.35, 0, 1.15));
  out.push(loose("lamp_r", "lamp_wall", span / 2 - 1, 2.1, backZ + 0.35, 0, 1.15));

  return out;
}

/**
 * A row of market pitches with goods stacked between them and a kerb along the customer side.
 *
 * Pitches sit on ~3 m centres, which is `market_stall`'s 1.845 m body plus room to stand between
 * two of them.
 */
function marketRow(width: number, depth: number, rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const pitches = Math.max(1, Math.round(width / 3));
  const spacing = width / pitches;
  const backZ = -depth / 2 + 0.55;

  for (let index = 0; index < pitches; index += 1) {
    const x = (index + 0.5) * spacing - width / 2;
    out.push(loose(`stall${index}`, "market_stall", x, 0, backZ, 0));
    if (index === pitches - 1) continue;
    // Goods go on the joint between two pitches, never in front of one, or they block the counter
    // the shop's interaction is anchored to.
    const bx = (index + 1) * spacing - width / 2;
    const pick = rng.int(0, 2);
    const first = pick === 0 ? "crate_wood" : pick === 1 ? "barrel" : "sack";
    const second = pick === 0 ? "sack" : "crate_wood";
    out.push(loose(`goods${index}a`, first, bx - 0.25, 0, backZ + 0.15, rng.float(0, Math.PI)));
    out.push(loose(`goods${index}b`, second, bx + 0.45, 0, backZ + 0.75, rng.float(0, Math.PI)));
  }

  const kerbs = Math.max(1, Math.round(width / MODULE_METRES));
  const kerbSpacing = width / kerbs;
  for (let index = 0; index < kerbs; index += 1) {
    // kerb_straight is 2.000 x 0.134 x 0.700 with its body entirely on the +Z side of its pivot.
    out.push(loose(
      `kerb${index}`, "kerb_straight",
      (index + 0.5) * kerbSpacing - width / 2, 0, depth / 2 - 0.7, 0, kerbSpacing / MODULE_METRES,
    ));
  }

  return out;
}

/**
 * A wellhead. There is no well asset in the library, so it is composed: a 1.4 m curb of kit corner
 * posts and trim, two beams across it, a plank roof, a bucket and a coil of chain.
 *
 * Sizes are all measured. `wall_bottom_trim` is 2.000 long, so at 0.7 it is exactly the 1.4 m ring
 * and four of them close it. `support_beam` puts its beam at 1.709 x scale, so 1.4 lands it at
 * 2.39 m, which is the roof line. `roof_wood_plank` is a mono-pitch 2.258 x 1.560 that is high at
 * its own z = 0 and low at z = 1.56, so two of them back to back at the same point make a gable
 * with the ridge over the shaft. The corner posts are scaled to 0.78 (2.34 m) so they stop under
 * the eaves instead of coming through the roof.
 */
function well(kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const ring = 0.7;

  const signs: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [index, sign] of signs.entries()) {
    out.push(loose(
      `post${index}`, kit.corner,
      ring * sign[0], 0, ring * sign[1], Math.atan2(sign[0], sign[1]), 0.78,
    ));
  }
  const curb: readonly (readonly [number, number, number])[] = [
    [0, ring, 0], [ring, 0, Math.PI / 2], [0, -ring, Math.PI], [-ring, 0, -Math.PI / 2],
  ];
  for (const [index, [cx, cz, yaw]] of curb.entries()) {
    out.push(loose(`curb${index}`, "wall_bottom_trim", cx, 0, cz, yaw, ring));
  }

  const beam = 1.4;
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(`beam${index}`, "support_beam", ring * sx, -1.211 * beam, -beam, 0, beam));
  }
  // The two halves overlap 0.03 m past the ridge rather than meeting on it: two coincident faces at
  // z = 0 would z-fight along the whole ridge line.
  out.push(loose("roof_f", "roof_wood_plank", 0, 2.4, -0.03, 0, 0.75));
  out.push(loose("roof_b", "roof_wood_plank", 0, 2.4, 0.03, Math.PI, 0.75));
  // The curb's top is 0.117 x 0.7 = 0.082 m, so the bucket stands on it rather than in the air.
  out.push(loose("bucket", "bucket_wood", 0.1, 0.08, 0.62, 0.6));
  out.push(loose("chain", "chain_coil", -0.62, 0, -0.62, 1.2, 0.95));

  return out;
}

// --------------------------------------------------------------- wall runs

/**
 * A straight run of town wall along LOCAL +X, from dx = 0 to dx = `length` at dz = 0, with gates
 * cut out of it.
 *
 * WHY THIS EXISTS. Measured on the shipped data: Coldbrace has 44 m of wall on a 212 m circuit
 * (79% open, largest single gap 46 m), Highcairn 30 m of 139 m, Rootfall none at all, and all four
 * corners are open in both. The stubs are net-negative - `getNavPath(144,-40 -> 144,-90)` detours
 * to x = 149.5 to walk around two free-standing panels in open moor. There was no way to author a
 * wall, only to author individual `wall_segment` buildings with an 8 m footprint.
 *
 * `openings` are `{ at, width }` in metres along the run, `at` at the CENTRE of the gap, matching
 * `WallOpeningDef` in content/regions.ts. A module is skipped when its 2 m span overlaps an
 * opening, so an opening rounds OUTWARD to whole modules and a gatehouse never has half a wall
 * panel standing in its arch.
 *
 * Every built module gets a `wall_bottom_trim` under it, which is the point of the asset and the
 * reason it was in the manifest unused: without it a 50 m run is 25 panels stuck upright in grass.
 * Every opening gets a `kit.corner` jamb on both sides - a 4 m hole with raw module ends reads as
 * damage, not as a gate - and both ends of the run get one so two runs meeting at a corner share a
 * post instead of leaving a hole.
 *
 * The panel choice is seeded so a long run is not one texture repeated: roughly one module in five
 * is `kit.wallWindow`, and every fourth module carries a second course of trim as a string course
 * at 1.55 m. Both are drawn from the run's own `variantSeed`, so adding a run cannot shift
 * anything else's randomness.
 */
export function buildWallRun(
  length: number,
  openings: readonly { at: number; width: number }[],
  kit: BuildingKit,
  seed: number,
): PartPlacement[] {
  const out: PartPlacement[] = [];
  const modules = wallRunModules(length, openings);
  const rng = new Rng(seed);

  for (const [index, module] of modules.entries()) {
    const centre = (module.from + module.to) / 2;
    const scale = (module.to - module.from) / MODULE_METRES;
    const assetId = rng.chance(0.2) ? kit.wallWindow : kit.wall;
    out.push(loose(`w${index}`, assetId, centre, 0, 0, 0, scale));
    out.push(loose(`t${index}`, "wall_bottom_trim", centre, 0, 0.01, 0, scale));
    // A string course two thirds up. Cheap (one more instance of an asset the run already draws)
    // and it is what stops a long wall reading as one flat panel repeated.
    if (index % 4 === 3) out.push(loose(`s${index}`, "wall_bottom_trim", centre, 1.55, 0.02, 0, scale));
  }

  // Jambs at both sides of every opening and posts at both ends of the run, in run order so the
  // tags are stable.
  const posts = new Set<number>();
  for (const span of mergeSpans(modules)) {
    posts.add(r3(span.from));
    posts.add(r3(span.to));
  }
  for (const [postIndex, x] of [...posts].sort((a, b) => a - b).entries()) {
    out.push(loose(`p${postIndex}`, kit.corner, x, 0, 0, Math.PI / 4));
  }

  return out;
}

/**
 * Collision for the same run in the same local frame: one thin box per built span, so a 26-module
 * wall with one gate is two boxes rather than 26.
 *
 * 0.5 m thick, matching `prefabCollision("wall_segment")`, because the collider should be as thick
 * as the 0.406 m panel and not as deep as a footprint. `dx` is the span's CENTRE measured from the
 * run's start, which is the same origin `buildWallRun` uses - unlike the prefab boxes, whose frame
 * is centred on the footprint.
 */
export function wallRunCollision(
  length: number,
  openings: readonly { at: number; width: number }[],
): PrefabBox[] {
  return mergeSpans(wallRunModules(length, openings)).map((span, index) => ({
    tag: `run${index}`,
    dx: r3((span.from + span.to) / 2),
    dz: 0,
    sizeX: r3(span.to - span.from),
    sizeZ: 0.5,
    height: STOREY_METRES,
  }));
}

interface Span { from: number; to: number }

/**
 * The modules of a run that actually get built: the run divided into `round(length / 2)` equal
 * modules, minus every module whose span overlaps an opening.
 *
 * One function so `buildWallRun` and `wallRunCollision` cannot disagree about where the wall is,
 * which is the gatehouse's drawn-4-collided-2 bug one scale up. The spacing is `length / count`
 * rather than a flat 2 m so a run always starts at exactly 0 and ends at exactly `length`; author
 * runs in whole 2 m multiples and the two are the same number.
 */
function wallRunModules(
  length: number,
  openings: readonly { at: number; width: number }[],
): Span[] {
  const count = Math.max(1, Math.round(length / MODULE_METRES));
  const spacing = length / count;
  const built: Span[] = [];
  for (let index = 0; index < count; index += 1) {
    const from = index * spacing;
    const to = from + spacing;
    const cut = openings.some((opening) => (
      from < opening.at + opening.width / 2 - 1e-6 && to > opening.at - opening.width / 2 + 1e-6
    ));
    if (!cut) built.push({ from, to });
  }
  return built;
}

/** Contiguous modules merged, so each gate costs one box and one pair of jambs rather than n. */
function mergeSpans(modules: readonly Span[]): Span[] {
  const spans: Span[] = [];
  for (const module of modules) {
    const last = spans[spans.length - 1];
    if (last !== undefined && Math.abs(last.to - module.from) < 1e-6) last.to = module.to;
    else spans.push({ from: module.from, to: module.to });
  }
  return spans;
}

// ------------------------------------------------------------- compositions

/**
 * Set dressing around a landmark's own hero mesh. The landmark entity keeps its `view`, so it is
 * still one clickable, inspectable, highlightable thing; these parts give it a silhouette.
 */
export function buildComposition(
  id: CompositionId,
  seed: number,
  // Optional and last, so the existing two-argument call in `world/regionBuilder.ts` keeps
  // compiling. Only the three settlement compositions read it; the landmarks are region furniture
  // and belong to the rock they stand on, not to the town's vernacular.
  kitId: KitId = "plaster",
): PartPlacement[] {
  const rng = new Rng(seed);
  const kit = BUILDING_KITS[kitId];
  switch (id) {
    case "vault_door": return vaultDoor();
    case "milestone": return milestone();
    case "highcairn_crane": return highcairnCrane();
    case "gravelmaw_mouth": return gravelmawMouth();
    case "great_cairn": return greatCairn();
    case "standing_stones": return standingStones(rng);
    case "rootfall_stump": return rootfallStump();
    case "region_gate": return regionGate();
    case "bank_counter": return bankCounter(kit);
    case "forge_yard": return forgeYard(rng);
    case "market_pitch": return marketPitch(rng);
    case "wood_pile": return woodPile();
    case "garden": return garden(rng);
  }
}

/** The vault tower's door: two braziers, two company banners, a kerbed approach. */
function vaultDoor(): PartPlacement[] {
  return [
    loose("torch_l", "torch", -1.5, 1.9, 0.4, 0, 2.6),
    loose("torch_r", "torch", 1.5, 1.9, 0.4, 0, 2.6),
    loose("banner_l", "banner_1", -2.9, 3.3, 0.25, 0, 1.1),
    loose("banner_r", "banner_1", 1.3, 3.3, 0.25, 0, 1.1),
    loose("kerb_l", "kerb_straight", -1.9, 0, 1.9, Math.PI / 2),
    loose("kerb_r", "kerb_straight", 1.9, 0, 1.9, Math.PI / 2),
  ];
}

/** A snapped March Company marker: the broken-off top on the ground beside it, and the road kerb. */
function milestone(): PartPlacement[] {
  return [
    loose("top", "corner_brick", 1.1, 0, 0.35, 0.95, 0.75),
    loose("rub1", "rubble_brick_1", -0.75, 0, 0.55, 0.6, 2.6),
    loose("rub2", "rubble_brick_2", 0.45, 0, -0.85, 2.3, 2.3),
    loose("stone", "rock_medium_1", -1.9, 0, -0.7, 1.2, 0.45),
    loose("kerb_l", "kerb_straight", -2.6, 0, 0.4, Math.PI / 2),
    loose("kerb_r", "kerb_straight", 2.6, 0, 0.4, Math.PI / 2),
  ];
}

/**
 * The Highcairn crane. The landmark's hero is a 9.6 m mast; this hangs a jib off it and leaves the
 * rope on the drum, which is what the blurb says and what the round-1 `support_beam` at 3x could
 * not say (that asset's pivot is 1.2 m under the post, so it floated).
 */
function highcairnCrane(): PartPlacement[] {
  return [
    // roof_log's pivot sits 3.85 m below the beam and the beam runs along local Z.
    loose("jib", "roof_log", 0, 8.4 - 3.85 * 0.85, 3.0, 0, 0.85),
    loose("brace_l", "support_beam", -1.3, -1.211 * 1.6, 0.4, Math.PI / 2, 1.6),
    loose("brace_r", "support_beam", 1.3, -1.211 * 1.6, 0.4, -Math.PI / 2, 1.6),
    loose("drum", "chain_coil", 1.4, 0.05, 2.6, 0.4, 2.2),
    loose("rope", "rope_coil", -0.4, 0.05, 5.4, 1.1, 2.4),
    loose("crate", "crate_metal", -2.4, 0, 1.4, 0.7, 1.3),
    loose("barrel", "barrel", 2.5, 0, 0.8, 0, 1.2),
  ];
}

/**
 * The Gravelmaw. PRD: "a twelve-metre black wound in grey stone, visible from anywhere on terrace
 * one". The 12 m comes from the portal's own `wall_arch` at 4x (8 m wide, 12 m tall); this builds
 * the stone around it - two jaws, two shoulders, a brow of rock behind and above the opening, spoil
 * at the lip, and a brazier on each side. There is no black material available (every tier palette
 * lerps toward a light metal colour), so the darkness is geometry and shadow rather than paint.
 *
 * Local +Z faces the approach from the Lower Quarry.
 */
function gravelmawMouth(): PartPlacement[] {
  return [
    loose("jaw_l", "cliff_tall", -6.6, 0, 1.0, 0.42, 2.6),
    loose("jaw_r", "cliff_tall", 6.6, 0, 1.0, -0.95, 2.6),
    loose("shoulder_l", "cliff_step_1", -12.5, 0, 5.5, 0.65, 1.7),
    loose("shoulder_r", "cliff_step_1", 12.5, 0, 5.5, -0.6, 1.7),
    loose("brow", "cliff_step_2", 0, 6.0, -9.0, 0, 2.0),
    loose("spoil_l", "boulder_medium", -9.2, 0, 8.4, 0.8, 1.4),
    loose("spoil_r", "boulder_medium", 10.1, 0, 9.6, 2.2, 1.1),
    loose("rock_l", "rock_medium_2", -4.6, 0, 5.6, 1.5, 1.8),
    loose("rock_r", "rock_medium_3", 4.9, 0, 6.1, 2.9, 1.6),
    loose("brazier_l", "torch", -4.7, 1.7, 0.6, 0, 3.4),
    loose("brazier_r", "torch", 4.7, 1.7, 0.6, 0, 3.4),
  ];
}

/** Wide, not tall: "head height and forty paces round", with a stack of slate on the crown. */
function greatCairn(): PartPlacement[] {
  return [
    loose("flank_l", "boulder_medium", -4.2, 0, 2.2, 0.7, 1.0),
    loose("flank_r", "boulder_medium", 3.9, 0, -2.1, 2.1, 0.85),
    loose("crown_1", "rock_medium_1", 0.4, 4.3, 0.2, 1.4, 1.4),
    loose("crown_2", "rock_medium_3", -0.9, 4.6, -1.2, 2.7, 1.0),
    loose("skirt", "rock_medium_2", 5.6, 0, 2.6, 0.3, 0.9),
  ];
}

/** Four uprights in a ring around the hero boulder. The edge the Thornbound will not cross. */
function standingStones(rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + 0.4;
    out.push(loose(
      `stone${index}`, "cliff_tall",
      Math.cos(angle) * 6.4, 0, Math.sin(angle) * 6.4,
      rng.float(0, Math.PI * 2), rng.float(0.62, 0.85),
    ));
  }
  out.push(loose("low_1", "rock_medium_2", 2.6, 0, 3.4, 1.1, 1.0));
  out.push(loose("low_2", "rock_medium_1", -3.1, 0, -2.8, 2.5, 0.8));
  return out;
}

/** Somebody has cut steps into the north face of it. */
/**
 * The Rootfall Stump: steps cut into the north face, brackets on the flanks, one vine.
 *
 * Sized against the hero mesh it actually stands on, which is `tree_twisted_2` clipped to its
 * lowest quarter at 2x: roughly 3.7 m across and 3.7 m tall. The round-3 numbers were authored
 * against a five-times-scale `anvil_log` and left every part of this composition hanging in space
 * once the hero mesh changed — steps climbing to 4 m up a 3.7 m stump, brackets 2.3 m clear of a
 * face that is only 1.85 m from the centre.
 *
 * `stairs_exterior` is 2.0 x 1.204 x 2.078 with its pivot on the floor, so each flight rises
 * 1.204 m and reaches 2.078 m back: three of them climb 3.6 m, which is the top.
 */
function rootfallStump(): PartPlacement[] {
  return [
    loose("step_1", "stairs_exterior", 0, 0, 3.6, 0, 1.0),
    loose("step_2", "stairs_exterior", 0, 1.2, 1.9, 0, 1.0),
    loose("step_3", "stairs_exterior", 0, 2.4, 0.2, 0, 1.0),
    // Brackets grow ON the trunk: 1.7 m out from the axis puts their inner edge against the bark.
    loose("shelf_1", "mushroom_bracket", -1.7, 1.5, 0.5, 0.8, 1.6),
    loose("shelf_2", "mushroom_bracket", 1.6, 2.4, -0.7, 2.4, 1.3),
    // The vine hangs from the cut face, so its top is at the top and it falls 2.6 m down the side.
    loose("vine", "vine_1", 1.5, 1.1, 1.0, 1.9, 1.0),
  ];
}

/** A region gate: the arch flanked by two stretches of wall, lit both sides. */
function regionGate(): PartPlacement[] {
  return [
    // The gate's own `wall_arch` draws at 1.4x, so it is 2.8 m across: the flanking walls sit at
    // +-2.8 to land flush against it with no gap on the kit's grid.
    loose("wall_l", "wall_brick_straight", -2.8, 0, 0, 0, 1.4),
    loose("wall_r", "wall_brick_straight", 2.8, 0, 0, 0, 1.4),
    loose("post_l", "corner_brick", -4.2, 0, 0, -Math.PI / 4, 1.4),
    loose("post_r", "corner_brick", 4.2, 0, 0, Math.PI / 4, 1.4),
    loose("lamp_l", "lamp_wall", -1.6, 2.5, 0.14, 0, 1.3),
    loose("lamp_r", "lamp_wall", 1.6, 2.5, 0.14, 0, 1.3),
  ];
}

// ------------------------------------------------- settlement compositions

/**
 * The thing that turns a chest on grass into a bank: two covered bays, a counter across the front,
 * two lamps, a banner and a kerb.
 *
 * Measured on the shipped data, this is the whole of finding 4. `chest_wood` draws 1.28 x 0.76 m
 * and the nearest building surface to the Coldbrace bank is 5.0 m of open grass; at Rootfall it is
 * 10.0 m. Local +Z faces the customer, so the composition is authored at the chest's own position
 * with the same rotation the chest has, and the counter lands between the player and the chest.
 * `porch` is the walk-under roof; this is the furniture under it.
 */
function bankCounter(kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const backZ = -1.2;
  for (const [index, sx] of [-1, 1].entries()) {
    coveredBay(out, `b${index}_`, kit, sx * (MODULE_METRES / 2), backZ);
  }
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(`post${index}`, kit.corner, 1.9 * sx, 0, backZ + CANOPY_DEPTH_METRES - 0.12, Math.atan2(sx, 1)));
  }
  // table_large is 2.848 x 0.813 x 1.097 with its pivot centred, so this sits it across the bay
  // mouth with 1.5 m of standing room behind it and the chest behind that.
  out.push(loose("counter", "table_large", 0, 0, -0.15, 0, 1));
  out.push(loose("lamp_l", "lamp_wall", -1.5, 2.1, backZ + 0.32, 0, 1.15));
  out.push(loose("lamp_r", "lamp_wall", 1.5, 2.1, backZ + 0.32, 0, 1.15));
  out.push(loose("banner", "banner_1", -0.8, 2.55, backZ + 0.3, 0, 1.05));
  out.push(loose("kerb_l", "kerb_straight", -1, 0, 1.05, 0));
  out.push(loose("kerb_r", "kerb_straight", 1, 0, 1.05, 0));
  return out;
}

/** The yard in front of a `forge`'s open face: what a smith leaves outside. Local +Z is the mouth. */
function forgeYard(rng: Rng): PartPlacement[] {
  return [
    loose("whetstone", "whetstone", -1.9, 0, 0.9, rng.float(0.3, 0.9)),
    loose("rack", "weapon_rack", 2.0, 0, 0.4, -Math.PI / 2),
    loose("barrel_l", "barrel", -2.3, 0, 2.0, rng.float(0, Math.PI)),
    loose("barrel_r", "barrel", 2.4, 0, 1.9, rng.float(0, Math.PI)),
    loose("dummy", "training_dummy", 0.4, 0, 3.1, rng.float(0.2, 0.7)),
    loose("sack", "sack", -1.4, 0, 2.3, rng.float(0, Math.PI)),
  ];
}

/**
 * Goods around one market pitch. The stall itself is the shop entity's own `view`, so this is only
 * what stands around it; emitting a second `market_stall` here would double-draw the hero mesh.
 */
function marketPitch(rng: Rng): PartPlacement[] {
  return [
    loose("crate_1", "crate_wood", -1.35, 0, -0.5, rng.float(0, Math.PI)),
    // crate_wood is 0.931 tall and its pivot is 0.052 below its base, so 0.88 stacks flush.
    loose("crate_2", "crate_wood", -1.28, 0.88, -0.46, rng.float(0, Math.PI), 0.92),
    loose("barrel", "barrel", 1.3, 0, -0.55, rng.float(0, Math.PI)),
    loose("apples", "barrel_apples", 1.45, 0, 0.55, rng.float(0, Math.PI)),
    loose("sack_l", "sack", -1.5, 0, 0.65, rng.float(0, Math.PI)),
    loose("sack_r", "sack", 0.95, 0, 0.9, rng.float(0, Math.PI)),
    loose("carrots", "farm_crate_carrot", 0.15, 0, 0.95, rng.float(0, Math.PI)),
  ];
}

/**
 * Four logs stacked against a gable.
 *
 * `roof_log` pivots 3.849 m BELOW the log and the log runs along its local Z for 10.696 m, so at
 * 0.26 it is a 2.78 m log 0.30 m thick and dy -1.00 lays it on the ground. Turned a quarter so the
 * stack runs along local X and the pile builds up in Z and Y.
 */
function woodPile(): PartPlacement[] {
  const scale = 0.26;
  const drop = -1.211 + 0.211;
  const thick = 1.149 * scale;
  return [
    loose("log_1", "roof_log", 0, drop, -thick, Math.PI / 2, scale),
    loose("log_2", "roof_log", 0, drop, 0, Math.PI / 2, scale),
    loose("log_3", "roof_log", 0, drop, thick, Math.PI / 2, scale),
    loose("log_4", "roof_log", 0.1, drop + thick * 0.86, thick / 2, Math.PI / 2, scale),
  ];
}

/**
 * A fenced kitchen garden: an L of `fence_wood_single` (2.064 m modules), two farm crates and a
 * clump of flowers. Local origin is the inside corner of the L.
 */
function garden(rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const module = 2.064;
  for (let index = 0; index < 3; index += 1) {
    out.push(loose(`fx${index}`, "fence_wood_single", (index - 1) * module, 0, -2.4, 0));
  }
  for (let index = 0; index < 2; index += 1) {
    // A part's rotationY turns its local +X toward (cos, -sin), so PI/2 lays the run along -Z.
    out.push(loose(`fz${index}`, "fence_wood_single", 2 * module, 0, -2.4 + (index + 0.5) * module, Math.PI / 2));
  }
  out.push(loose("crate_1", "farm_crate_carrot", -1.2, 0, -1.2, rng.float(0, Math.PI)));
  out.push(loose("crate_2", "farm_crate_apple", -0.4, 0, -0.5, rng.float(0, Math.PI)));
  out.push(loose("flowers", "flower_a_group", 1.4, 0, -1.1, rng.float(0, Math.PI * 2), 0.9));
  return out;
}

// -------------------------------------------------------------- collision

/**
 * Solid volume of a prefab, in its local frame. One box per solid mass, so a gatehouse is two piers
 * with a walkable gap between them rather than one block across the road.
 *
 * The world layer turns these into world-space boxes on `BuiltWorld.buildings`; the root turns
 * those into physics colliders and navmesh obstacles. Nothing here touches either - this file only
 * knows how big the thing it drew is.
 */
export interface PrefabBox {
  readonly tag: string;
  /** Centre of the box in the prefab's local XZ frame. */
  readonly dx: number;
  readonly dz: number;
  /** Full extents in metres. */
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly height: number;
}

export function prefabCollision(prefab: PrefabId, footprint: readonly [number, number]): PrefabBox[] {
  const width = Math.max(MODULE_METRES, footprint[0]);
  const depth = Math.max(MODULE_METRES, footprint[1]);
  const height = prefabHeight(prefab);

  if (prefab === "gatehouse") {
    // Two piers, GATE_GAP_METRES apart, from the same `gateGeometry` the arch is drawn to. This is
    // finding 1: the piers used to be `(width - 2) / 2` wide whatever the drawn geometry did, so
    // the gate the player saw was 4 m and the gate the navmesh saw was 2 m, of which 0.20 m
    // survived erosion and all three arches were impassable.
    const { pierWidth } = gateGeometry(width);
    const usable = Math.max(3 * MODULE_METRES, MODULE_METRES * Math.round(width / MODULE_METRES));
    return [
      { tag: "pier_l", dx: -(usable - pierWidth) / 2, dz: 0, sizeX: pierWidth, sizeZ: depth, height },
      { tag: "pier_r", dx: (usable - pierWidth) / 2, dz: 0, sizeX: pierWidth, sizeZ: depth, height },
    ];
  }
  if (prefab === "wall_segment") {
    // The wall run is only as thick as the panel, not as deep as the authored footprint.
    return [{ tag: "wall", dx: 0, dz: 0, sizeX: width, sizeZ: 0.5, height }];
  }
  if (prefab === "stall") {
    return [{ tag: "stall", dx: 0, dz: 0, sizeX: width, sizeZ: depth * 0.6, height }];
  }
  if (prefab === "forge") {
    // Three walls and an open mouth. 0.6 m thick, which is the 0.406 m panel plus the corner posts
    // at its ends, and NOTHING across +Z - that is the entire point of the prefab: the player walks
    // in and stands at the anvil instead of interacting with it through a wall from 8.56 m away.
    const t = 0.6;
    return [
      { tag: "back", dx: 0, dz: -(depth - t) / 2, sizeX: width, sizeZ: t, height },
      { tag: "left", dx: -(width - t) / 2, dz: t / 2, sizeX: t, sizeZ: depth - t, height },
      { tag: "right", dx: (width - t) / 2, dz: t / 2, sizeX: t, sizeZ: depth - t, height },
    ];
  }
  if (prefab === "porch") {
    // The roof is walk-under, so only the two posts and the back wall are solid. The diagnosis asks
    // for the posts alone; the back wall is here because `coveredBay` draws a real wall panel in
    // every kit and leaving it out would let the player walk through a wall they can see, which is
    // the class of bug this whole pass exists to remove.
    const bays = bayCount(width, 2, 3);
    const span = bays * MODULE_METRES;
    const front = -depth / 2 + CANOPY_DEPTH_METRES - 0.12;
    return [
      // The panel draws from the face plane out to WALL_FACE and back to WALL_FACE - 0.406, so the
      // box sits on the panel rather than straddling the footprint edge.
      { tag: "back", dx: 0, dz: r3(-depth / 2 + WALL_THICKNESS / 2 - WALL_FACE), sizeX: span, sizeZ: WALL_THICKNESS, height },
      { tag: "post_l", dx: -(span / 2 - 0.12), dz: front, sizeX: 0.4, sizeZ: 0.4, height: 3 },
      { tag: "post_r", dx: span / 2 - 0.12, dz: front, sizeX: 0.4, sizeZ: 0.4, height: 3 },
    ];
  }
  if (prefab === "arcade") {
    // Back wall only. The colonnade posts are 0.21 m across and standing between two of them is the
    // whole idea of an arcade, so they are deliberately not colliders.
    const span = bayCount(width, 2, 8) * MODULE_METRES;
    return [{
      tag: "back", dx: 0, dz: r3(-depth / 2 + WALL_THICKNESS / 2 - WALL_FACE),
      sizeX: span, sizeZ: WALL_THICKNESS, height,
    }];
  }
  if (prefab === "market_row") {
    // One thin counter per pitch, so the player walks between the stalls rather than around the row.
    const pitches = Math.max(1, Math.round(width / 3));
    const spacing = width / pitches;
    return Array.from({ length: pitches }, (_unused, index) => ({
      tag: `pitch${index}`,
      dx: r3((index + 0.5) * spacing - width / 2),
      dz: r3(-depth / 2 + 0.55),
      sizeX: 1.9,
      sizeZ: 0.7,
      height,
    }));
  }
  if (prefab === "well") {
    // 1.6 x 1.6 around a 1.4 m curb, 1 m high. Half-diagonal 1.13 m, comfortably inside
    // INTERACT_RANGE 2.4 m, so a well can still be the target of moveTo({ entityId }).
    return [{ tag: "curb", dx: 0, dz: 0, sizeX: 1.6, sizeZ: 1.6, height }];
  }
  return [{ tag: "body", dx: 0, dz: 0, sizeX: width, sizeZ: depth, height }];
}

// -------------------------------------------------------------- validation

/**
 * Every manifest asset id any prefab can emit. `content/regions.ts` checks this against a real
 * manifest so a typo here is a boot-time content error, not a silently invisible building.
 */
export function prefabPartAssetIds(): string[] {
  const ids = new Set<string>();
  // Footprints that exercise every branch: an odd side, an even side, a one-module side, the [8,3]
  // gatehouse that GATE_GAP_METRES is sized for, the [6,5] forge and [6,3] arcade from the
  // replacement layouts, a two-bay [4,3] porch, a three-pitch market row and a minimum well.
  const probes: readonly (readonly [number, number])[] = [
    [6, 4], [12, 6], [5, 4], [4, 4], [8, 1], [3, 2],
    [8, 3], [6, 3], [6, 5], [4, 3], [9, 3], [2, 2], [10, 4], [16, 3],
  ];
  for (const prefab of PREFAB_IDS) {
    for (const footprint of probes) {
      // Several seeds, because window and door choices are seeded.
      for (const seed of [1, 7, 13, 29, 101, 977]) {
        // Every kit, or a wall family that only Highcairn uses is never checked against the
        // manifest and ships as a missing mesh in one region.
        for (const kit of KIT_IDS) {
          for (const placement of buildPrefab(prefab, footprint, seed, kit)) ids.add(placement.assetId);
        }
      }
    }
  }
  // Wall runs are not prefabs but they emit into the same manifest, and their asset choice is
  // seeded, so probe them here too rather than leave a whole town's perimeter unchecked. The
  // lengths cover a run with no opening, a run whose openings cut it into three, and a run short
  // enough that every module is cut.
  const runs: readonly (readonly [number, readonly { at: number; width: number }[]])[] = [
    [52, []],
    [52, [{ at: 26, width: 8 }]],
    [34, [{ at: 8, width: 4 }, { at: 26, width: 6 }]],
    [6, [{ at: 3, width: 8 }]],
  ];
  for (const [length, openings] of runs) {
    for (const seed of [1, 7, 13, 29, 101, 977]) {
      for (const kit of KIT_IDS) {
        for (const placement of buildWallRun(length, openings, BUILDING_KITS[kit], seed)) {
          ids.add(placement.assetId);
        }
      }
    }
  }
  return [...ids].sort();
}

/** Every manifest asset id any landmark or settlement composition can emit. */
export function compositionPartAssetIds(): string[] {
  const ids = new Set<string>();
  for (const id of COMPOSITION_IDS) {
    for (const seed of [1, 7, 13, 29, 101, 977]) {
      // Every kit: `bank_counter` picks its overhang and its posts out of the kit, so probing one
      // would leave `overhang_brick` unchecked and Highcairn's bank would ship as a missing mesh.
      for (const kit of KIT_IDS) {
        for (const placement of buildComposition(id, seed, kit)) ids.add(placement.assetId);
      }
    }
  }
  return [...ids].sort();
}
