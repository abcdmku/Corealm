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

// ------------------------------------------------------------------ prefabs

/**
 * Assemble a prefab. Deterministic: the same `(prefab, footprint, seed)` always returns the same
 * ordered list, so a rebuild at the same world seed is byte-identical.
 */
export function buildPrefab(
  prefab: PrefabId,
  footprint: readonly [number, number],
  seed: number,
): PartPlacement[] {
  const width = Math.max(MODULE_METRES, footprint[0]);
  const depth = Math.max(MODULE_METRES, footprint[1]);
  const rng = new Rng(seed);

  switch (prefab) {
    case "cottage": return cottage(width, depth, rng);
    case "hall": return hall(width, depth, rng);
    case "tower": return tower(width, depth, rng);
    case "shed": return shed(width, depth, rng);
    case "quarry_hut": return quarryHut(width, depth, rng);
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
function cottage(width: number, depth: number, rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      let assetId = "wall_plaster_straight";
      if (isDoor) assetId = "wall_plaster_door";
      else if (rng.chance(0.45)) assetId = "wall_plaster_window";
      out.push(part(`w${s}_${index}`, assetId, onSide(side, count, index, 0, 0), side.yaw));
    }
  }

  corners(out, width, depth, "corner_wood", 0, 1, "c");

  const roof = roofFit(width, depth, 4, 6);
  out.push(loose("roof", "roof_tiles_4x6", 0, STOREY_METRES, 0, roof.rotationY, roof.scale));

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
    "door", "door_round_1",
    onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET),
    entry.yaw,
  ));

  return out;
}

/** Twelve by six timber-framed hall: the biggest thing in Coldbrace after the vault tower. */
function hall(width: number, depth: number, rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      let assetId = "wall_plaster_timber";
      if (isDoor) assetId = "wall_plaster_door";
      else if (index % 2 === (rng.chance(0.5) ? 0 : 1)) assetId = "wall_plaster_window";
      out.push(part(`w${s}_${index}`, assetId, onSide(side, count, index, 0, 0), side.yaw));
      // Trim only on the long faces: it hides the wall/ground seam where the player actually
      // walks, and paying for it on all four sides is 6 more instances for nothing.
      if (side.length >= Math.max(width, depth)) {
        out.push(part(`t${s}_${index}`, "wall_bottom_trim", onSide(side, count, index, 0, 0.01), side.yaw));
      }
    }
  }

  corners(out, width, depth, "corner_wood", 0, 1, "c");

  const roof = roofFit(width, depth, 6, 12);
  out.push(loose("roof", "roof_tiles_6x12", 0, STOREY_METRES, 0, roof.rotationY, roof.scale));
  out.push(loose("chimney", "chimney", width * 0.3, STOREY_METRES - 0.3, depth / 2 - 0.55, 0, 1.1));

  out.push(part(
    "door", "door_round_2",
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
function shed(width: number, depth: number, rng: Rng): PartPlacement[] {
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
        isDoor ? "wall_plaster_door" : "wall_plaster_straight",
        onSide(side, count, index, 0, 0),
        side.yaw,
      ));
    }
  }

  corners(out, width, depth, "corner_wood", 0, 1, "c");
  // A 4x6 roof at 0.8 gives a 6.06 x 4.41 bbox: eaves all round on a 4 x 4 shed, no gaps.
  out.push(loose("roof", "roof_tiles_4x6", 0, STOREY_METRES, 0, width >= depth ? Math.PI / 2 : 0, 0.8));
  out.push(part("door", "door_round_1", onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET), entry.yaw));
  out.push(loose("crate", "crate_village", width * 0.3, 0, -depth / 2 - 0.65, rng.float(0, Math.PI), 1));

  return out;
}

/** Five by four quarry crew hut: timber walls, a plank roof, props and a tool crate. */
function quarryHut(width: number, depth: number, rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      let assetId = "wall_plaster_timber";
      if (isDoor) assetId = "wall_plaster_door";
      else if (rng.chance(0.35)) assetId = "wall_plaster_window";
      out.push(part(`w${s}_${index}`, assetId, onSide(side, count, index, 0, 0), side.yaw));
    }
  }

  corners(out, width, depth, "corner_wood", 0, 1, "c");
  out.push(loose("roof", "roof_tiles_4x6", 0, STOREY_METRES, 0, width >= depth ? Math.PI / 2 : 0, 0.9));
  out.push(part("door", "door_round_1", onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET), entry.yaw));

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
function rootfallStump(): PartPlacement[] {
  return [
    loose("step_1", "stairs_exterior", 0, 0, 4.0, 0, 1.3),
    loose("step_2", "stairs_exterior", 0, 1.3, 2.9, 0, 1.3),
    loose("step_3", "stairs_exterior", 0, 2.6, 1.9, 0, 1.3),
    loose("shelf_1", "mushroom_bracket", -2.3, 2.0, 0.9, 0.8, 2.4),
    loose("shelf_2", "mushroom_bracket", 2.1, 2.9, -1.1, 2.4, 1.9),
    loose("vine", "vine_1", 1.7, 4.6, 1.5, 1.9, 1.5),
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
        for (const placement of buildPrefab(prefab, footprint, seed)) ids.add(placement.assetId);
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
