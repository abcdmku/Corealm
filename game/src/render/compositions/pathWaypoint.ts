import type { BuildingKit, PartPlacement } from "../buildings.js";

/**
 * Small route-side dressing for a waypoint hero. The hero stays at the composition origin and the
 * authored landmark sits well off the road shoulder, so each recipe can form one compact readable
 * object instead of stretching two disconnected props across the lane.
 *
 * The regional kit fixes the visual family. Plaster uses a March Company sign and kerb marker,
 * timber uses a forest trail marker, and stone uses a quarry cairn. The seed only chooses one of
 * three micro-arrangements inside that regional language.
 */

type MicroVariant = 0 | 1 | 2;

const MICRO_VARIANTS: readonly MicroVariant[] = [0, 1, 2];

const ROCK_BASE_Y: Readonly<Record<"rock_medium_1" | "rock_medium_2" | "rock_medium_3", number>> = {
  rock_medium_1: -0.271,
  rock_medium_2: -0.051,
  rock_medium_3: -0.316,
};

// Both banner meshes are authored with their visible face on local +Z and their cloth extending
// along local +X from the pivot. Keep the face yaw fixed so the cloth is never turned edge-on or
// backwards; a left-hand banner is moved one cloth width left instead.
const BANNER_CLOTH_WIDTH = 1.613;
const WAYPOINT_ARM_SCALE = 0.18;
const WAYPOINT_ARM_BASE_Y = 3.8489;
/** Highest point of the measured upper metal rail cap in each banner mesh. */
const BANNER_RAIL_TOP_Y: Readonly<Record<"banner_1" | "banner_2", number>> = {
  banner_1: 0.8435,
  banner_2: 0.8435,
};

function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Seats a hanging banner's upper rail against the shared roof-log cross-arm. */
function bannerDyForArm(
  assetId: "banner_1" | "banner_2",
  armPivotY: number,
  scale: number,
): number {
  const armUndersideY = armPivotY + WAYPOINT_ARM_BASE_Y * WAYPOINT_ARM_SCALE;
  return r3(armUndersideY - BANNER_RAIL_TOP_Y[assetId] * scale);
}

function integerSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) : 0;
}

function part(
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

function bannerPivotX(side: -1 | 1, anchorX: number, scale: number): number {
  return side > 0 ? anchorX : anchorX - BANNER_CLOTH_WIDTH * scale;
}

/** A small stable hash gives seeds with the same variant a little authored variation too. */
function sample(seed: number, salt: number): number {
  let value = (integerSeed(seed) >>> 0) ^ Math.imul(salt, 0x9e3779b9);
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function microVariantFor(seed: number): MicroVariant {
  const index = ((integerSeed(seed) % MICRO_VARIANTS.length) + MICRO_VARIANTS.length)
    % MICRO_VARIANTS.length;
  return MICRO_VARIANTS[index]!;
}

/** 0 is balanced, 1 leans left, and 2 leans right. The family itself still comes from the kit. */
function buildMarchMarker(seed: number, kit: BuildingKit, micro: MicroVariant): PartPlacement[] {
  const side = micro === 1 ? -1 : 1;
  const companionX = side * (1.02 + sample(seed, 11) * 0.08);
  const bannerAsset = micro === 2 ? "banner_2" : "banner_1";
  const bannerScale = bannerAsset === "banner_2" ? 0.56 : 0.5;
  const bannerAnchorX = side * 0.08;
  const armPivotY = 1.26;
  return [
    // The landmark hero is the other upright. This companion, arm, cloth and stone shoe assemble
    // around it as one company waypost rather than two miniature wall sections.
    part("wp_march_post", kit.corner, companionX, 0, 0.08, 0, 0.74),
    part("wp_march_arm", "roof_log", companionX / 2, armPivotY, 0.07, Math.PI / 2, WAYPOINT_ARM_SCALE),
    part(
      "wp_march_cloth",
      bannerAsset,
      bannerPivotX(side, bannerAnchorX, bannerScale),
      bannerDyForArm(bannerAsset, armPivotY, bannerScale),
      0.11,
      0,
      bannerScale,
    ),
    part("wp_march_foot", "kerb_straight", companionX / 2, 0, 0.32, 0, 0.64),
    part("wp_march_roadstone", "path_rock_small_2", companionX + side * 0.2, 0.02, 0.7, 0, 0.72),
  ];
}

function buildForestMarker(seed: number, kit: BuildingKit, micro: MicroVariant): PartPlacement[] {
  const side = micro === 2 ? -1 : 1;
  const companionX = side * (1 + sample(seed, 21) * 0.1);
  const bannerAsset = micro === 1 ? "banner_1" : "banner_2";
  const bannerScale = bannerAsset === "banner_1" ? 0.48 : 0.54;
  const bannerAnchorX = side * 0.07;
  const armPivotY = 1.25;
  return [
    part("wp_forest_stake", kit.corner, companionX, 0, 0.06, 0, 0.72),
    part("wp_forest_arm", "roof_log", companionX / 2, armPivotY, 0.05, Math.PI / 2, WAYPOINT_ARM_SCALE),
    part(
      "wp_forest_cloth",
      bannerAsset,
      bannerPivotX(side, bannerAnchorX, bannerScale),
      bannerDyForArm(bannerAsset, armPivotY, bannerScale),
      0.1,
      0,
      bannerScale,
    ),
    // A second low rail and a rope coil make the marker look repaired by travellers, while keeping
    // both props within the same one-metre assembly.
    part("wp_forest_low_rail", "roof_log", companionX / 2, 0.02, 0.08, Math.PI / 2, 0.14),
    part("wp_forest_rope", "rope_coil", companionX, 0.04, 0.42, 0, 0.62),
  ];
}

function buildQuarryCairn(seed: number, micro: MicroVariant): PartPlacement[] {
  // The three layouts swap the rock faces, move the high cap, and move the single torch with the
  // emphasis. That keeps every stone-region waypoint in the same quarry language without cloning
  // one cairn silhouette.
  const layout = ([
    {
      lowerLeft: "rock_medium_1", lowerRight: "rock_medium_2",
      upperLeft: "rock_medium_3", upperRight: "rock_medium_1",
      footLeft: "path_rock_small_2", footRight: "path_rock_small_2",
    },
    {
      lowerLeft: "rock_medium_3", lowerRight: "rock_medium_1",
      upperLeft: "rock_medium_1", upperRight: "rock_medium_2",
      footLeft: "path_rock_small_1", footRight: "path_rock_small_2",
    },
    {
      lowerLeft: "rock_medium_2", lowerRight: "rock_medium_3",
      upperLeft: "rock_medium_2", upperRight: "rock_medium_1",
      footLeft: "path_rock_small_2", footRight: "path_rock_small_1",
    },
  ] as const)[micro]!;
  const leftZ = 0.18 + sample(seed, 35) * 0.12;
  const rightZ = 0.18 + sample(seed, 36) * 0.12;
  const leftYaw = (sample(seed, 37) - 0.5) * 0.38;
  const rightYaw = (sample(seed, 38) - 0.5) * 0.38;
  const leftFootX = micro === 1 ? -0.78 : -0.68;
  const rightFootX = micro === 2 ? 0.78 : 0.68;
  const torchLeft = micro === 1;
  const groundedRock = (
    tag: string,
    assetId: keyof typeof ROCK_BASE_Y,
    dx: number,
    dz: number,
    yaw: number,
    scale: number,
  ): PartPlacement => part(
    tag, assetId, dx,
    -ROCK_BASE_Y[assetId] * scale - 0.02,
    dz, yaw, scale,
  );
  return [
    // The landmark hero is the tall slate waystone. These grounded shoulders make one cairn foot,
    // and the small pennant gives the vertical post a clear face from the road.
    // 1.05 and 0.6, not 0.92 and 0.28. At 0.28 these rocks were 0.23-0.25 m clear of the
    // waystone they are supposed to foot, and at r = 0.95 from the origin they fell inside
    // `regionBuilder`'s 1 m composition clearance and were dropped from collision entirely.
    groundedRock("wp_quarry_base_l", layout.lowerLeft, -1.05, leftZ, leftYaw, 0.6),
    groundedRock("wp_quarry_base_r", layout.lowerRight, 1.05, rightZ, rightYaw, 0.6),
    // banner_2's mounting upright is local X = 0 and its projection rail runs along local +X.
    // Keep it at the hero's right/front (+X) corner with yaw 0: local +X projects out from the
    // hero's +X side, so this is a deliberate side mount rather than a cloth panel laid across
    // the front of the stone.
    part("wp_quarry_pennant", "banner_2", 0.18, 2.08, 0.38, 0, 0.5),
    part("wp_quarry_foot_l", layout.footLeft, leftFootX, 0, 0.82, leftYaw * 0.5, 0.7),
    part("wp_quarry_foot_r", layout.footRight, rightFootX, 0, 0.82, rightYaw * 0.5, 0.7),
    // One low torch gives the quarry reading a reason to exist after dusk. It is the only light.
    // Clear of the cairn foot: at +-1.25 the torch was inside the shoulder boulder with only
    // its flame tip showing.
    part("wp_quarry_torch", "torch", torchLeft ? -1.85 : 1.85, 0.24, 0.42, 0, 0.78),
  ];
}

/**
 * Build a route marker in the kit's regional visual language. Seeds select one of three
 * left/right and asset-choice micro-arrangements, but never switch a plaster town into a forest
 * marker or a quarry settlement into a March sign.
 */
export function buildPathWaypointComposition(seed: number, kit: BuildingKit): PartPlacement[] {
  const micro = microVariantFor(seed);
  switch (kit.id) {
    case "plaster":
      return buildMarchMarker(seed, kit, micro);
    case "timber":
      return buildForestMarker(seed, kit, micro);
    case "stone":
      return buildQuarryCairn(seed, micro);
  }
}
