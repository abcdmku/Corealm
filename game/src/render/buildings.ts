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
 *   support_beam      pivot 1.21 m BELOW the post
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
import type { PrefabId } from "../content/regions.js";

// ------------------------------------------------------------------ constants

/** The kit's horizontal module. Snap to this or pieces do not meet. */
export const MODULE_METRES = 2;

/** Measured wall height. Stack storeys on this exactly. */
export const STOREY_METRES = 3.123;

/** Where a wall's outward face sits relative to its pivot. */
const WALL_FACE = 0.093;

/** `door_round_*` pivot on their left jamb; this centres them in a 2 m module. */
const DOOR_LEAF_OFFSET = -0.55;

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

/** Every prefab the authored data may name. Mirrors `PrefabId` in `content/regions.ts`. */
export const PREFAB_IDS: readonly PrefabId[] = [
  "cottage", "hall", "tower", "stall", "wall_segment", "gatehouse", "shed", "ruin", "quarry_hut",
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
  | "region_gate";

export const COMPOSITION_IDS: readonly CompositionId[] = [
  "vault_door", "milestone", "highcairn_crane", "gravelmaw_mouth",
  "great_cairn", "standing_stones", "rootfall_stump", "region_gate",
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
    case "tower": return tower(width, depth, rng);
    case "shed": return shed(width, depth, rng, kit);
    case "quarry_hut": return quarryHut(width, depth, rng, kit);
    case "gatehouse": return gatehouse(width, depth);
    case "wall_segment": return wallSegment(width);
    case "stall": return stall(rng);
    case "ruin": return ruin(width, depth, rng);
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
      // Trim only on the long faces: it hides the wall/ground seam where the player actually
      // walks, and paying for it on all four sides is 6 more instances for nothing.
      if (side.length >= Math.max(width, depth)) {
        out.push(part(`t${s}_${index}`, "wall_bottom_trim", onSide(side, count, index, 0, 0.01), side.yaw));
      }
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
 * Two storeys of brick under a spire. "Visible from 300 m, which is the entire point of it" -
 * 6.25 m of wall plus a 7.9 m roof puts the finial at about 14 m, the tallest thing in Fallowmarch.
 */
function tower(width: number, depth: number, rng: Rng): PartPlacement[] {
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
        let assetId = "wall_brick_straight";
        if (isDoor) assetId = "wall_brick_door";
        else if (storey === 1 && index === Math.floor(count / 2)) assetId = "wall_brick_window";
        else if (storey === 0 && rng.chance(0.25)) assetId = "wall_brick_window";
        out.push(part(`w${storey}_${s}_${index}`, assetId, onSide(side, count, index, y, 0), side.yaw));
      }
    }
    corners(out, width, depth, "corner_brick", y, 1, `c${storey}_`);
  }

  // roof_tower's bbox is 5.651 across; oversize it slightly so the eaves clear the walls.
  out.push(loose("spire", "roof_tower", 0, 2 * STOREY_METRES, 0, 0, (Math.max(width, depth) + 0.6) / 5.651));

  out.push(part(
    "door", "door_round_1",
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

/** A walled gate: two brick piers two storeys high with an arch on each face between them. */
function gatehouse(width: number, depth: number): PartPlacement[] {
  const out: PartPlacement[] = [];
  const pierX = width / 2 - 1;
  const faceZ = depth / 2;

  for (let storey = 0; storey < 2; storey += 1) {
    const y = storey * STOREY_METRES;
    for (const [index, sx] of [-1, 1].entries()) {
      out.push(loose(`pf${storey}_${index}`, "wall_brick_straight", pierX * sx, y, faceZ, 0));
      out.push(loose(`pb${storey}_${index}`, "wall_brick_straight", pierX * sx, y, -faceZ, Math.PI));
    }
  }
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(`post${index}`, "corner_brick", (width / 2) * sx, 0, faceZ, Math.atan2(sx, 1)));
    out.push(loose(`postb${index}`, "corner_brick", (width / 2) * sx, STOREY_METRES, -faceZ, Math.atan2(sx, -1)));
    out.push(loose(`lamp${index}`, "lamp_wall", (pierX - 0.7) * sx, 2.3, faceZ + 0.12, 0, 1.2));
  }

  // wall_arch is 2 x 3 and nearly flat, so it scales cleanly into the 2 m gap between the piers.
  const archScale = (width - 2 * 1) / 2;
  out.push(loose("arch_f", "wall_arch", 0, 0, faceZ, 0, archScale));
  out.push(loose("arch_b", "wall_arch", 0, 0, -faceZ, Math.PI, archScale));
  out.push(loose("banner", "banner_1", -0.8, STOREY_METRES + 2.4, faceZ + 0.14, 0, 1.1));

  return out;
}

/** A straight run of town wall with a corner post at each end and trim along the base. */
function wallSegment(width: number): PartPlacement[] {
  const out: PartPlacement[] = [];
  const count = moduleCount(width);
  const spacing = width / count;
  for (let index = 0; index < count; index += 1) {
    const x = (index + 0.5) * spacing - width / 2;
    out.push(loose(`w${index}`, "wall_brick_straight", x, 0, 0, 0));
    out.push(loose(`t${index}`, "wall_bottom_trim", x, 0, 0.01, 0));
  }
  out.push(loose("end_l", "corner_brick", -width / 2, 0, 0, -Math.PI / 4));
  out.push(loose("end_r", "corner_brick", width / 2, 0, 0, Math.PI / 4));
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
function ruin(width: number, depth: number, rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const count = moduleCount(width);
  const spacing = width / count;
  for (let index = 0; index < count; index += 1) {
    const x = (index + 0.5) * spacing - width / 2;
    out.push(loose(`w${index}`, "wall_brick_straight", x, 0, depth / 2, rng.float(-0.05, 0.05)));
  }
  out.push(loose("side", "wall_brick_straight", -width / 2, 0, 0, -Math.PI / 2));
  out.push(loose("post", "corner_brick", width / 2, 0, depth / 2, Math.PI / 4));
  out.push(loose("rub1", "rubble_brick_1", rng.float(-1.5, 1.5), 0, rng.float(-2, 0), rng.float(0, Math.PI), 2.4));
  out.push(loose("rub2", "rubble_brick_2", rng.float(-1.5, 1.5), 0, rng.float(-2, 0), rng.float(0, Math.PI), 2.2));
  out.push(loose("vine", "vine_1", -width / 2 + 0.2, 3.0, 0.4, -Math.PI / 2, 1.3));
  return out;
}

// ------------------------------------------------------------- compositions

/**
 * Set dressing around a landmark's own hero mesh. The landmark entity keeps its `view`, so it is
 * still one clickable, inspectable, highlightable thing; these parts give it a silhouette.
 */
export function buildComposition(id: CompositionId, seed: number): PartPlacement[] {
  const rng = new Rng(seed);
  switch (id) {
    case "vault_door": return vaultDoor();
    case "milestone": return milestone();
    case "highcairn_crane": return highcairnCrane();
    case "gravelmaw_mouth": return gravelmawMouth();
    case "great_cairn": return greatCairn();
    case "standing_stones": return standingStones(rng);
    case "rootfall_stump": return rootfallStump();
    case "region_gate": return regionGate();
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
    // Two piers. The 2 m gap in the middle is the gate; blocking it would wall the town shut.
    const pier = (width - 2) / 2;
    return [
      { tag: "pier_l", dx: -(width - pier) / 2, dz: 0, sizeX: pier, sizeZ: depth, height },
      { tag: "pier_r", dx: (width - pier) / 2, dz: 0, sizeX: pier, sizeZ: depth, height },
    ];
  }
  if (prefab === "wall_segment") {
    // The wall run is only as thick as the panel, not as deep as the authored footprint.
    return [{ tag: "wall", dx: 0, dz: 0, sizeX: width, sizeZ: 0.5, height }];
  }
  if (prefab === "stall") {
    return [{ tag: "stall", dx: 0, dz: 0, sizeX: width, sizeZ: depth * 0.6, height }];
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
  // Footprints that exercise every branch: an odd side, an even side, and a one-module side.
  const probes: readonly (readonly [number, number])[] = [[6, 4], [12, 6], [5, 4], [4, 4], [8, 1], [3, 2]];
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
  return [...ids].sort();
}

/** Every manifest asset id any landmark composition can emit. */
export function compositionPartAssetIds(): string[] {
  const ids = new Set<string>();
  for (const id of COMPOSITION_IDS) {
    for (const seed of [1, 7, 13]) {
      for (const placement of buildComposition(id, seed)) ids.add(placement.assetId);
    }
  }
  return [...ids].sort();
}
