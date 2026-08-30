import type { BuildingKit, PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";

/**
 * A border crossing: two masonry piers under slate caps, the `wall_arch` portal spanning between
 * them, and a stretch of wall running off each side.
 *
 * The portal is deliberately not emitted here: the world owns the hero mesh and its interaction
 * state. These parts are the gate's piers, wings, crowns and dressing around it. They are authored
 * in the same local frame as the building prefabs: +X is right, +Y is up, and +Z points toward the
 * approaching road.
 *
 * WHY THIS WAS REBUILT. The first version was two free-standing 2 m wall panels at x = +-2.7 with a
 * `roof_tower` cap balanced on each, a shallow return behind, and a pair of banners at +-3.7. Three
 * things were wrong with it and all three are visible from the road:
 *
 *   1. THE PIERS WERE CARDS. A wall panel is 0.406 m thick and the cap is 1.92 x 1.85 m, so each
 *      "tower" was a spire overhanging a 0.4 m sliver by 0.7 m front and back. From any oblique
 *      angle - which is every angle, because the camera orbits - the gate read as two flats with
 *      hats on. Each pier is now a closed 2 x 2 m box of four panels with a post at each corner,
 *      which is exactly the plan the 0.34 cap was already sized for.
 *   2. THE ARCH DID NOT MEET ANYTHING. `wall_arch` draws at 1.4x, so it is 2.8 m across and its
 *      jambs stand at |x| = 1.4; the wings stood at |x| = 1.7. That left a 0.3 m slot of daylight
 *      up each side of a 4.2 m arch, with the arch's own jamb hanging in it. The piers' road faces
 *      are now at |x| = 1.35, so each jamb is buried 0.05 m into masonry and the passage is the
 *      arch's opening rather than the arch plus two slots.
 *   3. THE BANNERS HUNG ON AIR. They anchored at the return's outer corner, 0.35 m clear of any
 *      surface. They mount on the pier's road-facing shoulder now.
 */

const STOREY_METRES = 3.123;
/** Where a wall panel's outward face sits relative to its pivot, measured on the GLBs. */
const WALL_FACE = 0.093;

/**
 * Plan of one pier, in metres from the gate centre line.
 *
 * `PIER_INNER` is 0.05 m inside the drawn arch's jamb (`wall_arch` at 1.4x reaches |x| = 1.4), so
 * the timber arch dies into masonry instead of standing in a gap. That leaves a 2.70 m passage:
 * against the world's 0.45 m navmesh erosion per side and a 0.35 m player radius, 1.80 m of
 * walkable floor down the middle of a portal the player only has to reach, never fight in.
 */
const PIER_INNER = 1.35;
const PIER_WIDTH = 2;
const PIER_OUTER = PIER_INNER + PIER_WIDTH;
const PIER_CENTRE = PIER_INNER + PIER_WIDTH / 2;
const PIER_HALF_DEPTH = 1;

/** One module of wall running off each pier, plus its end post. */
const WING_CENTRE = PIER_OUTER + 1;
const WING_END = PIER_OUTER + 2;

/** `roof_tower` starts at y = -0.572; at 0.34 this seats its base on a 3.123 m pier head. */
const TOWER_CROWN_Y = 3.3175;
const TOWER_CROWN_SCALE = 0.34;

const BANNER_1_BASE_Y = -1.549;
const BANNER_2_BASE_Y = -1.234;
const TORCH_BASE_Y = -0.278;
const WALL_PLASTER_STRAIGHT_BASE_Y = -0.002;
const POST_GROUND_LIFT = 0.01;
/** Door leaves use a left-jamb pivot; this centres their one-metre body in a wall-door aperture. */
const DOOR_LEAF_OFFSET = -0.55;
/** `kerb_straight` is 2.000 x 0.134 x 0.700 with its body entirely on the +Z side of its pivot. */
const COPING_DEPTH = 0.7;

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

/**
 * One closed masonry pier: four panels round a 2 x 2 m plan, a post at each corner, a plinth on the
 * three faces anyone walks past, and the slate cap.
 *
 * `side` is -1 for the left pier and +1 for the right. Every face is placed by its OUTWARD surface
 * and then pulled back by `WALL_FACE`, so the pier's drawn envelope is exactly the plan above and
 * the cap lands on it rather than over air.
 */
function addPier(out: PartPlacement[], kit: BuildingKit, side: -1 | 1, faceAsset: string): void {
  const name = side < 0 ? "l" : "r";
  const centre = side * PIER_CENTRE;
  const y = wallY(faceAsset);
  const trimY = wallY("wall_bottom_trim");

  // Road elevation and settlement elevation. These two carry the vernacular; the returns are plain.
  out.push(placement(`pier_${name}_front`, faceAsset, centre, y, PIER_HALF_DEPTH - WALL_FACE, 0));
  out.push(placement(`pier_${name}_back`, faceAsset, centre, y, -(PIER_HALF_DEPTH - WALL_FACE), Math.PI));
  // The two returns close the box. Local +Z is a panel's outward normal, so the yaw that turns it
  // onto +X is +PI/2 and onto -X is -PI/2.
  out.push(placement(
    `pier_${name}_outer`, kit.wall, side * (PIER_OUTER - WALL_FACE), wallY(kit.wall), 0, side * Math.PI / 2,
  ));
  out.push(placement(
    `pier_${name}_inner`, kit.wall, side * (PIER_INNER + WALL_FACE), wallY(kit.wall), 0, -side * Math.PI / 2,
  ));

  // A post on each plan corner, turned to face its diagonal, which is what stops four panels
  // meeting in mid-air from reading as four panels.
  for (const [index, corner] of ([[PIER_INNER, 1], [PIER_OUTER, 1], [PIER_OUTER, -1], [PIER_INNER, -1]] as const).entries()) {
    out.push(placement(
      `pier_${name}_post${index}`, kit.corner,
      side * corner[0], POST_GROUND_LIFT, corner[1] * PIER_HALF_DEPTH,
      Math.atan2(side * corner[0], corner[1]), postScale(kit),
    ));
  }

  // Plinth on the road face, the settlement face and the outer return. The inner return faces into
  // the passage under the arch and is the one course the player never sees a footing line on.
  out.push(placement(`pier_${name}_trim_f`, "wall_bottom_trim", centre, trimY, PIER_HALF_DEPTH - WALL_FACE + 0.01, 0));
  out.push(placement(`pier_${name}_trim_b`, "wall_bottom_trim", centre, trimY, -(PIER_HALF_DEPTH - WALL_FACE + 0.01), Math.PI));
  out.push(placement(
    `pier_${name}_trim_o`, "wall_bottom_trim",
    side * (PIER_OUTER - WALL_FACE + 0.01), trimY, 0, side * Math.PI / 2,
  ));

  out.push(placement(`crown_${name}`, "roof_tower", centre, TOWER_CROWN_Y, 0, 0, TOWER_CROWN_SCALE));
}

/**
 * One module of wall running outboard of each pier, capped like a town wall.
 *
 * The gate has to say "there is a border here", and two piers on their own say "there is a gate
 * here". `kerb_straight` along the head is the same coping `buildWallRun` uses, so a region gate
 * and a settlement wall are visibly the same construction.
 */
function addWing(out: PartPlacement[], kit: BuildingKit, side: -1 | 1, asset: string): void {
  const name = side < 0 ? "l" : "r";
  out.push(placement(`wing_${name}`, asset, side * WING_CENTRE, wallY(asset), 0, 0));
  out.push(placement(`wing_${name}_trim`, "wall_bottom_trim", side * WING_CENTRE, 0, 0.01, 0));
  out.push(placement(
    `wing_${name}_coping`, "kerb_straight",
    side * WING_CENTRE, STOREY_METRES - 0.134, -0.11 - COPING_DEPTH / 2, 0,
  ));
  out.push(placement(
    `wing_${name}_end`, kit.corner, side * WING_END, POST_GROUND_LIFT, 0, side * Math.PI / 4, postScale(kit),
  ));
}

function addBanners(
  out: PartPlacement[],
  assetId: "banner_1" | "banner_2",
  scale: number,
  single: boolean,
): void {
  const y = bannerY(assetId, scale);
  // The banners hang on the piers' road elevation, a third of the way in from the passage, with
  // their rail on the masonry and the cloth running out over the approach. Do not shift either
  // anchor by the cloth width: that would put a perpendicular banner along the wall.
  const dz = PIER_HALF_DEPTH + 0.02;
  if (!single) {
    out.push(wallMountedBanner("banner_left", assetId, { dx: -PIER_CENTRE, dy: y, dz }, 0, scale));
  }
  out.push(wallMountedBanner("banner_right", assetId, { dx: PIER_CENTRE, dy: y, dz }, 0, scale));
}

function addTorches(out: PartPlacement[], scale: number, single: boolean): void {
  const y = torchY(scale);
  // On the passage jambs, where a gate watch would actually want light. Both heads look down the
  // +Z road and neither is in the corridor: the bracket is 0.11 m wide against a 2.70 m gap.
  const dx = PIER_INNER + 0.12;
  const dz = PIER_HALF_DEPTH - 0.25;
  if (!single) out.push(placement("torch_left", "torch", -dx, y, dz, 0, scale));
  out.push(placement("torch_right", "torch", dx, y, dz, 0, scale));
}

/**
 * Builds one of three deterministic regional gate treatments for the supplied settlement kit.
 *
 * Variant 0 is a pair of standards, variant 1 is a torch-watch, and variant 2 puts a wicket door in
 * the left wing under a single standard. Timber kits receive their frame overlay on the two pier
 * road elevations, which is where a player standing under the arch is looking.
 */
export function buildRegionGateComposition(seed: number, kit: BuildingKit): PartPlacement[] {
  const variant = variantFor(seed, kit);
  const out: PartPlacement[] = [];
  const bannerAsset: "banner_1" | "banner_2" = kit.id === "timber" ? "banner_2" : "banner_1";
  const bannerScale = kit.id === "timber" ? 0.88 : 0.82;
  const torchScale = kit.id === "stone" ? 1.18 : 1.12;
  const sideWicket = variant === 2;

  // Variant 1 puts the kit's richer apron on the road elevations. The envelope never changes: a
  // gate is a fixed piece of infrastructure and the variation is what is hung on it.
  const faceAsset = variant === 1 ? kit.wallFeature : kit.wall;
  addPier(out, kit, -1, faceAsset);
  addPier(out, kit, 1, faceAsset);

  addWing(out, kit, -1, sideWicket ? kit.wallDoor : kit.wall);
  addWing(out, kit, 1, kit.wall);

  // Two more ribs behind the hero arch, so the crossing is a PASSAGE and not a card.
  //
  // `wall_arch` is 2.000 x 3.000 x 0.064 and the world draws it at 1.4x, which is 0.09 m of timber
  // spanning a 2 m deep gate. Head on it reads fine; from the road shoulder - which is where the
  // player walks up to it - it is a cardboard cutout between two solid piers, and that mismatch is
  // more obvious now the piers have mass than it was when they were cards too. Three ribs on the
  // same 1.4x the world uses turn it into an arched opening two metres deep. Their jambs land
  // 0.05 m inside the pier faces, so the passage is masonry, timber, masonry all the way through.
  for (const [index, dz] of [-0.58, 0.52].entries()) {
    out.push(placement(`arch_rib_${index}`, "wall_arch", 0, 0, dz, 0, 1.4));
  }

  // Half-timbered kits keep the solid panel and put the open-frame asset 0.02 m proud of it. Stone
  // and plaster kits have no frame overlay, so their corner posts remain the vernacular cue.
  if (kit.frame !== null) {
    for (const [name, side] of [["l", -1], ["r", 1]] as const) {
      out.push(placement(
        `pier_${name}_frame`, kit.frame,
        side * PIER_CENTRE, wallY(kit.frame), PIER_HALF_DEPTH - WALL_FACE + 0.02, 0,
      ));
    }
  }

  if (sideWicket) {
    // The wicket is in the left wing, beyond the pier and never across the road.
    out.push(placement("wicket_leaf", kit.door, -WING_CENTRE + DOOR_LEAF_OFFSET, 0.02, 0.13));
  }

  if (variant === 1) addTorches(out, torchScale, false);
  else addBanners(out, bannerAsset, bannerScale, sideWicket);

  return out;
}
