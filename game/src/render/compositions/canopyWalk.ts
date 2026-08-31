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

/**
 * The flight, measured off `stairs_exterior.glb` rather than off its bounding box.
 *
 * The asset is two primitives. `MI_RockTrim` is the flight itself: four treads climbing toward
 * local -Z, topping out at local y 0.818 over z -1.074..-0.641, x +-0.900. `MI_Brick` is a 2 x 2 m
 * pad at local y 0 with a parapet along its back edge (z = -1.000) that rises to local y 1.000 -
 * and that parapet, not any walkable surface, is where the manifest's 1.204 m bbox height comes
 * from. `regionBuilder.place()` only corrects Y, seating the pivot at `-base.y * scale` = 0.2856.
 *
 * So in composition-local metres the landing is a 0.607 m deep shelf at y 1.431, spanning
 * z -1.504..-0.897 and x +-1.26, with a 0.18 m brick kerb behind it.
 *
 * `STAIR_TOP_Y` used to be `1 * HERO_SCALE`, an assumed 1 m rise. It happened to land within
 * 11 mm of the real tread, so the landing was not floating - but the deck, both rails and the lamp
 * were all sized from `DECK_SCALE`, which made them 1.44 m deep against a 0.607 m tread. Two
 * thirds of the landing and most of both side rails therefore hung out over the steps below.
 */
const TREAD_TOP_LOCAL_Y = 0.818;
const TREAD_BACK_LOCAL_Z = -1.074;
const TREAD_FRONT_LOCAL_Z = -0.641;
const TREAD_HALF_WIDTH_LOCAL_X = 0.9;
const HERO_BASE_Y = -0.204;

const HERO_HALF_WIDTH = 1 * HERO_SCALE;
const STAIR_TOP_Y = (TREAD_TOP_LOCAL_Y - HERO_BASE_Y) * HERO_SCALE;
const TREAD_BACK_Z = TREAD_BACK_LOCAL_Z * HERO_SCALE;
const TREAD_FRONT_Z = TREAD_FRONT_LOCAL_Z * HERO_SCALE;
const TREAD_HALF_WIDTH = TREAD_HALF_WIDTH_LOCAL_X * HERO_SCALE;

/** Everything that stands on the landing is centred on the tread and sized to it. */
const DECK_Z = (TREAD_BACK_Z + TREAD_FRONT_Z) / 2;
const DECK_HALF_DEPTH = (TREAD_FRONT_Z - TREAD_BACK_Z) / 2;
const DECK_HALF_WIDTH = TREAD_HALF_WIDTH;
/** `floor_wood` is a 2 cm slab about its mid-plane, so this rests its underside on the tread. */
const DECK_Y = STAIR_TOP_Y + 0.01;

const POST_X = HERO_HALF_WIDTH - 0.24;
const POST_Z = -1.04;
const ROOF_LOG_BASE_Y = 3.8489;
const LINTEL_SCALE = 0.26;
/**
 * The gantry has to clear the landing, not the ground.
 *
 * The posts stand on the pad and are two thirds buried in the flight, so their old 2.34 m height
 * left a beam 0.85 m above the 1.431 m landing: a trailhead you cannot walk under. The beam is
 * now a normal doorway height above the landing and the posts are scaled to reach it.
 */
const LINTEL_HEADROOM_METRES = 2.1;
const LINTEL_BOTTOM_Y = STAIR_TOP_Y + LINTEL_HEADROOM_METRES;
const CORNER_WOOD_HEIGHT = 3;
const POST_SCALE = (LINTEL_BOTTOM_Y + 0.12) / CORNER_WOOD_HEIGHT;

const BALCONY_BASE_Y = -0.1051;
/**
 * Rails keep a balustrade's height and take their run from the landing.
 *
 * `balcony_straight` is 2.000 x 1.230 x 0.206 with its body at local z 0.898..1.104. Scaling it
 * uniformly to fit the 0.607 m tread would leave a 0.37 m railing, so the uniform scale sets the
 * height and `scaleAxes[0]` sets the run.
 */
const SIDE_RAIL_SCALE = 0.72;
const REAR_RAIL_SCALE = 1.04;
const BALCONY_LENGTH = 2;
const BALCONY_BODY_FAR_Z = 1.104;
/** Puts the rear rail's outer face against the hero's brick parapet at the back of the landing. */
const REAR_RAIL_Z = TREAD_BACK_Z - BALCONY_BODY_FAR_Z * REAR_RAIL_SCALE;

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

function deck(tag: string, dz = DECK_Z, halfDepth = DECK_HALF_DEPTH): PartPlacement {
  // `floor_wood` is a 2 m, 2 cm-thick slab about its own mid-plane, so a per-axis scale is the
  // half-extent in metres. Sized to the tread it plants the landing on real geometry instead of
  // cantilevering two thirds of itself out over the steps.
  return {
    ...placement(tag, "floor_wood", 0, DECK_Y, dz, 0, 1),
    scaleAxes: [r4(DECK_HALF_WIDTH), 1, r4(halfDepth)],
  };
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
  // Across the back of the landing against the hero's brick parapet, run out to the landing's own
  // half-width so the balustrade closes the edge instead of stopping 0.26 m short at each end.
  return {
    ...placement(tag, "balcony_straight", 0, railY(REAR_RAIL_SCALE), REAR_RAIL_Z, 0, REAR_RAIL_SCALE),
    scaleAxes: [r4(DECK_HALF_WIDTH / (REAR_RAIL_SCALE * BALCONY_LENGTH / 2)), 1, 1],
  };
}

function sideRail(tag: string, side: -1 | 1): PartPlacement {
  // A quarter turn puts the balustrade's run along Z, so `scaleAxes[0]` is what has to match the
  // tread depth. Left at the uniform 0.72 the rail ran 1.44 m down a 0.607 m landing: half of it
  // buried in the stringer and the front half hanging 0.40 m over the steps.
  const rotationY = side < 0 ? -Math.PI / 2 : Math.PI / 2;
  return {
    ...placement(
      tag,
      "balcony_straight",
      side * (TREAD_HALF_WIDTH - BALCONY_BODY_FAR_Z * SIDE_RAIL_SCALE),
      railY(SIDE_RAIL_SCALE),
      DECK_Z,
      rotationY,
      SIDE_RAIL_SCALE,
    ),
    scaleAxes: [r4(DECK_HALF_DEPTH / (SIDE_RAIL_SCALE * BALCONY_LENGTH / 2)), 1, 1],
  };
}

function approachLamp(tag: string): PartPlacement {
  // `lamp_wall` projects along local +Z. It sits on the right timber cheek and points down the
  // Rootfall approach; one small lamp is enough to mark the climb without crowding the landing.
  return placement(tag, "lamp_wall", POST_X, STAIR_TOP_Y + 0.31, -0.92, 0, 0.42);
}

function approachBanner(tag: string): PartPlacement {
  // `banner_2` is a projecting bracket: its rail is local X = 0 and the cloth extends along local
  // +X. Anchor that rail one centimetre proud of variant B's right post face, then turn +X toward
  // the local +Z approach instead of laying the pennant along the lintel.
  return wallMountedBanner(
    tag,
    "banner_2",
    // The rail top has to land on the post it is bolted to, not 0.545 m above its head.
    { dx: 1.12, dy: POST_SCALE * CORNER_WOOD_HEIGHT - 0.85, dz: -0.896 },
    0,
    0.5,
  );
}

function approachRope(tag: string): PartPlacement {
  // A single coil is a low trail-repair cue on the left post; rotation zero preserves the +Z
  // approach orientation used by all attachments in this composition.
  // Clear of the hero: the stairs reach x +-1.4 and z -1.51..1.40, so a coil at -POST_X (-1.16)
  // and dz -0.92 was emitted entirely inside the stone and could never be seen.
  return placement(tag, "rope_coil", -(HERO_HALF_WIDTH + 0.22), 0.017, -0.92, 0, 0.64);
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
    deck("canopy_b_deck"),
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
    deck("canopy_c_deck"),
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
