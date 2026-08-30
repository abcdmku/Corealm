import type { BuildingKit, PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";

/**
 * A compact timber trailhead around the `stairs_exterior` obstacle hero.
 *
 * The hero is authored at scale 1.4 by the obstacle definition. Its high end is local -Z, so the
 * landing lives at the back of the flight while local +Z stays open for the Rootfall approach.
 * These parts are scenery only: the landing fits inside the hero's 2.8 x 2.9 m envelope and the
 * rails never project beyond it. No part adds a second route or a bridge around the obstacle.
 */

const HERO_SCALE = 1.4;
const HERO_HALF_WIDTH = 1 * HERO_SCALE;
const STAIR_TOP_Y = 1 * HERO_SCALE;
const DECK_Z = -0.78;
const DECK_SCALE = 0.72;
const DECK_Y = STAIR_TOP_Y + 0.02;

const POST_X = HERO_HALF_WIDTH - 0.24;
const POST_Z = -1.04;
const POST_SCALE = 0.78;
const ROOF_LOG_BASE_Y = 3.8489;
const LINTEL_SCALE = 0.26;
const LINTEL_BOTTOM_Y = 2.28;

const BALCONY_BASE_Y = -0.1051;
const SIDE_RAIL_SCALE = 0.72;
const REAR_RAIL_SCALE = 1.04;
const REAR_RAIL_Z = -2.08;

function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function r4(value: number): number {
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
    dx: r3(dx),
    dy: r3(dy),
    dz: r3(dz),
    rotationY: r4(rotationY),
    scale: r4(scale),
  };
}

function deck(tag: string, dz = DECK_Z, scale = DECK_SCALE): PartPlacement {
  // `floor_wood` is a 2 cm slab. Its 1.44 m square at 0.72 scale ends just inside the stairs'
  // measured back edge, so it reads as a landing without becoming a second platform in the world.
  return placement(tag, "floor_wood", 0, DECK_Y, dz, 0, scale);
}

function post(tag: string, dx: number, dz = POST_Z): PartPlacement {
  // The trailhead stays timber even when the surrounding settlement kit is stone or plaster.
  return placement(tag, "corner_wood", dx, 0, dz, 0, POST_SCALE);
}

function lintel(tag: string, dz = POST_Z): PartPlacement {
  // `roof_log` runs along local Z and sits 3.8489 m above its pivot. A quarter turn makes a
  // 2.78 m beam across the 1.4-scale stairs, with only a small timber overhang beyond the posts.
  return placement(
    tag,
    "roof_log",
    0,
    LINTEL_BOTTOM_Y - ROOF_LOG_BASE_Y * LINTEL_SCALE,
    dz,
    Math.PI / 2,
    LINTEL_SCALE,
  );
}

function railY(scale: number): number {
  // Lift the balcony mesh's measured -0.1051 m base onto the raised landing, not the terrain.
  return DECK_Y - BALCONY_BASE_Y * scale;
}

function rearRail(tag: string): PartPlacement {
  // The mesh is 0.898..1.104 m along local +Z from its pivot; this puts it behind the landing at
  // the stair top while keeping its 2.08 m span between the two posts.
  return placement(tag, "balcony_straight", 0, railY(REAR_RAIL_SCALE), REAR_RAIL_Z, 0, REAR_RAIL_SCALE);
}

function sideRail(tag: string, side: -1 | 1): PartPlacement {
  // With +/- PI/2, the balcony's long local X axis follows the stair run. Its actual body remains
  // at x +/-1.15..1.29, alongside the landing, and leaves the centre of the approach open.
  const rotationY = side < 0 ? -Math.PI / 2 : Math.PI / 2;
  return placement(
    tag,
    "balcony_straight",
    side * 0.5,
    railY(SIDE_RAIL_SCALE),
    DECK_Z,
    rotationY,
    SIDE_RAIL_SCALE,
  );
}

function approachLamp(tag: string): PartPlacement {
  // `lamp_wall` projects along local +Z. It sits on the right timber cheek and points down the
  // Rootfall approach; one small lamp is enough to mark the climb without crowding the landing.
  return placement(tag, "lamp_wall", POST_X, 1.74, -0.92, 0, 0.42);
}

function approachBanner(tag: string): PartPlacement {
  // `banner_2` is a projecting bracket: its rail is local X = 0 and the cloth extends along local
  // +X. Anchor that rail one centimetre proud of variant B's right post face, then turn +X toward
  // the local +Z approach instead of laying the pennant along the lintel.
  return wallMountedBanner(
    tag,
    "banner_2",
    { dx: 1.12, dy: 2.48, dz: -0.896 },
    0,
    0.5,
  );
}

function approachRope(tag: string): PartPlacement {
  // A single coil is a low trail-repair cue on the left post; rotation zero preserves the +Z
  // approach orientation used by all attachments in this composition.
  return placement(tag, "rope_coil", -POST_X, 0.06, -0.92, 0, 0.64);
}

function variantA(): PartPlacement[] {
  return [
    deck("canopy_a_deck"),
    post("canopy_a_post_l", -POST_X),
    post("canopy_a_post_r", POST_X),
    lintel("canopy_a_lintel"),
    rearRail("canopy_a_rear_rail"),
    sideRail("canopy_a_side_l", -1),
    sideRail("canopy_a_side_r", 1),
    approachLamp("canopy_a_lamp"),
  ];
}

function variantB(): PartPlacement[] {
  return [
    deck("canopy_b_deck", -0.74, 0.68),
    post("canopy_b_post_l", -1.12, -1.0),
    post("canopy_b_post_r", 1.12, -1.0),
    lintel("canopy_b_lintel", -1.0),
    rearRail("canopy_b_rear_rail"),
    sideRail("canopy_b_side_l", -1),
    approachBanner("canopy_b_banner"),
  ];
}

function variantC(): PartPlacement[] {
  return [
    deck("canopy_c_deck", -0.82, 0.68),
    post("canopy_c_post_l", -1.14, -1.08),
    post("canopy_c_post_r", 1.14, -1.08),
    lintel("canopy_c_lintel", -1.08),
    sideRail("canopy_c_side_l", -1),
    sideRail("canopy_c_side_r", 1),
    approachRope("canopy_c_rope"),
  ];
}

/** Build one of three compact, deterministic timber trailheads around the stairs hero. */
export function buildCanopyWalkComposition(seed: number, _kit: BuildingKit): PartPlacement[] {
  switch ((seed >>> 0) % 3) {
    case 0: return variantA();
    case 1: return variantB();
    default: return variantC();
  }
}
