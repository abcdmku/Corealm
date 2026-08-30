import type { BuildingKit, PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";

/**
 * A small, reusable surround for the `wall_arch` portal entity.
 *
 * The portal is deliberately not emitted here: the world owns the hero mesh and its interaction
 * state. These parts are the gate's wings, returns, crowns, and a little dressing around it.
 * They are authored in the same local frame as the building prefabs: +X is right, +Y is up, and
 * +Z points toward the approaching road.
 */

const STOREY_METRES = 3.123;
const WALL_WIDTH = 2;

/** The wing spacing leaves 3.4 m between the inner edges of the two 2 m wall panels. */
const WING_X = 2.7;
const RETURN_X = WING_X + WALL_WIDTH / 2;
const RETURN_Z = -0.85;
/** `roof_tower` starts at y = -0.572; this seats its scaled base on a 3.123 m wing. */
const TOWER_CROWN_Y = 3.3175;
const TOWER_CROWN_SCALE = 0.34;

const BANNER_1_BASE_Y = -1.549;
const BANNER_2_BASE_Y = -1.234;
const TORCH_BASE_Y = -0.278;
const WALL_PLASTER_STRAIGHT_BASE_Y = -0.002;
const POST_GROUND_LIFT = 0.01;
/** Door leaves use a left-jamb pivot; this centres their one-metre body in a wall-door aperture. */
const DOOR_LEAF_OFFSET = -0.55;

type GateVariant = 0 | 1 | 2;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function placement(
  tag: string,
  assetId: string,
  dx: number,
  dy: number,
  dz: number,
  rotationY = 0,
  scale = 1,
): PartPlacement {
  return {
    tag,
    assetId,
    dx: round3(dx),
    dy: round3(dy),
    dz: round3(dz),
    rotationY: round4(rotationY),
    scale: round4(scale),
  };
}

/** Mixes the seed with the vernacular id, without sharing a mutable RNG with the world builder. */
function variantFor(seed: number, kit: BuildingKit): GateVariant {
  let value = Math.trunc(Number.isFinite(seed) ? seed : 0) >>> 0;
  for (let index = 0; index < kit.id.length; index += 1) {
    value ^= kit.id.charCodeAt(index);
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  value = (value ^ (value >>> 16)) >>> 0;
  value = Math.imul(value, 2_246_822_519) >>> 0;
  value = (value ^ (value >>> 13)) >>> 0;
  return (value % 3) as GateVariant;
}

function postScale(kit: BuildingKit): number {
  return STOREY_METRES / kit.cornerHeight;
}

function wallY(assetId: string): number {
  return assetId === "wall_plaster_straight" ? -WALL_PLASTER_STRAIGHT_BASE_Y + 0.001 : 0;
}

/** Ground-aligns the two elevated props using their measured manifest pivots. */
function bannerY(assetId: "banner_1" | "banner_2", scale: number): number {
  const baseY = assetId === "banner_1" ? BANNER_1_BASE_Y : BANNER_2_BASE_Y;
  return -baseY * scale + 0.02;
}

function torchY(scale: number): number {
  // Torches sit high enough to read beside the arch, while their lower bracket remains above the
  // floor rather than being left at the raw origin (the torch's measured base is -0.278 m).
  return -TORCH_BASE_Y * scale + 0.78;
}

function addTowerCrowns(out: PartPlacement[]): void {
  // At 0.34 scale the cap is 2.50 m high and its y = -0.572 base offset lands on the 3.123 m
  // wing head. Matching caps leave the corridor open while their ridges reach about 5.626 m.
  out.push(placement("crown_left", "roof_tower", -WING_X, TOWER_CROWN_Y, 0, 0, TOWER_CROWN_SCALE));
  out.push(placement("crown_right", "roof_tower", WING_X, TOWER_CROWN_Y, 0, 0, TOWER_CROWN_SCALE));
}

function addBanners(
  out: PartPlacement[],
  assetId: "banner_1" | "banner_2",
  scale: number,
  single: boolean,
): void {
  const y = bannerY(assetId, scale);
  // The gate's outer corner posts are the mounting supports. These banners are projecting
  // standards, so their rail sits on the post and the cloth runs out toward the approach. Do not
  // shift either anchor by the cloth width: that would put a perpendicular banner along the wall.
  const leftX = -RETURN_X;
  const rightX = RETURN_X;
  const supportZ = 0.18;
  if (single) {
    out.push(wallMountedBanner(
      "banner_right", assetId, { dx: rightX, dy: y, dz: supportZ }, 0, scale,
    ));
    return;
  }
  out.push(wallMountedBanner(
    "banner_left", assetId, { dx: leftX, dy: y, dz: supportZ }, 0, scale,
  ));
  out.push(wallMountedBanner(
    "banner_right", assetId, { dx: rightX, dy: y, dz: supportZ }, 0, scale,
  ));
}

function addTorches(out: PartPlacement[], scale: number, single: boolean): void {
  const y = torchY(scale);
  if (single) {
    out.push(placement("torch_right", "torch", WING_X + 0.05, y, 0.19, 0, scale));
    return;
  }
  // The torch is a wall-side accent, never a central obstacle. Both heads look down the +Z road.
  out.push(placement("torch_left", "torch", -WING_X - 0.05, y, 0.19, 0, scale));
  out.push(placement("torch_right", "torch", WING_X + 0.05, y, 0.19, 0, scale));
}

/**
 * Builds one of three deterministic regional gate treatments for the supplied settlement kit.
 *
 * Variant 0 is a pair of standards, variant 1 is a torch-watch, and variant 2 adds a side wicket
 * and a single standard when the part budget allows. Timber kits receive their frame overlay on
 * the front wings; the side wicket leaves one overlay off so the total stays within ten parts.
 */
export function buildRegionGateComposition(seed: number, kit: BuildingKit): PartPlacement[] {
  const variant = variantFor(seed, kit);
  const out: PartPlacement[] = [];
  const timberFrame = kit.frame;
  const bannerAsset: "banner_1" | "banner_2" = kit.id === "timber" ? "banner_2" : "banner_1";
  const bannerScale = kit.id === "timber" ? 0.88 : 0.82;
  const torchScale = kit.id === "stone" ? 1.18 : 1.12;
  const sideWicket = variant === 2;

  // The front wings deliberately sit outside the 3.2 m corridor requirement and outside the
  // wall_arch hero's 1.4x outer jambs. A feature wall on variant 1 adds the kit's richer apron
  // without changing the envelope or closing the road.
  const wingAsset = variant === 1 ? kit.wallFeature : kit.wall;
  const leftWingAsset = sideWicket ? kit.wallDoor : wingAsset;
  out.push(placement("wing_left", leftWingAsset, -WING_X, wallY(leftWingAsset), 0));
  out.push(placement("wing_right", wingAsset, WING_X, wallY(wingAsset), 0));
  addTowerCrowns(out);

  // One module of each shallow return turns the wings back toward the settlement. They are outside
  // the arch's silhouette, so the hero remains the first thing read from the approach.
  out.push(placement("return_left", kit.wall, -RETURN_X, wallY(kit.wall), RETURN_Z, Math.PI / 2));
  out.push(placement("return_right", kit.wall, RETURN_X, wallY(kit.wall), RETURN_Z, -Math.PI / 2));

  // A centimetre of lift clears the measured sub-centimetre post pivot offset in every kit while
  // keeping the foot visually planted at the gate threshold.
  const postY = POST_GROUND_LIFT;
  const postRotationLeft = -Math.PI / 4;
  const postRotationRight = Math.PI / 4;
  out.push(placement("corner_left", kit.corner, -RETURN_X, postY, 0.12, postRotationLeft, postScale(kit)));
  out.push(placement("corner_right", kit.corner, RETURN_X, postY, 0.12, postRotationRight, postScale(kit)));

  // Half-timbered kits keep the solid wall body and put the open-frame asset proud of it. Stone and
  // plaster kits have no frame overlay, so their corner posts remain visible as the vernacular cue.
  if (timberFrame !== null) {
    if (!sideWicket) out.push(placement("frame_left", timberFrame, -WING_X, wallY(timberFrame), 0.02));
    out.push(placement("frame_right", timberFrame, WING_X, wallY(timberFrame), 0.02));
  }

  if (sideWicket) {
    // A side wicket is beyond the portal's inner face, never across the road. The kit door is kept
    // on the same +Z elevation as the wallDoor panel and remains ground-safe at its authored pivot.
    out.push(placement("wicket_leaf", kit.door, -WING_X + DOOR_LEAF_OFFSET, 0.02, 0.21));
  }

  const detailBudget = 10 - out.length;
  if (detailBudget <= 0) return out;

  if (variant === 0) {
    addBanners(out, bannerAsset, bannerScale, detailBudget < 2);
  } else if (variant === 1) {
    addTorches(out, torchScale, detailBudget < 2);
  } else {
    // Variant 2's wicket already signals a staffed crossing; a single standard keeps the facade
    // readable without crowding the arch or exceeding the two-detail budget.
    addBanners(out, bannerAsset, bannerScale, true);
  }

  return out;
}
