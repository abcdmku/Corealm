import type { BuildingKit, PartPlacement } from "../buildings.js";

/**
 * Set dressing for the Gravelmaw's surface portal.
 *
 * The portal entity owns the `wall_brick_door` hero and the renderer supplies its recessed black
 * backdrop. This module builds a broken quarry face over and around it: the inner 3.4 m stays
 * open from local +Z (the approach), while forward masonry and the high crown hide the hero's
 * timber-looking outer panel. All coordinates are authored in that frame, in metres, before the
 * caller's entrance yaw is applied.
 *
 * The surface drops away toward +Z. Lower rock courses are therefore deliberately sunk rather
 * than lifted to the mouth's origin height. The front lip is centred near z 4 and its rotated
 * bounds stop below z 6; even its largest textured rock remains inside the tested terrace bounds
 * and has a buried foot on the downhill ground. `rock_medium_*` are the textured Stylized Nature
 * stones; the untextured `cliff_*` and `boulder_*` assets are intentionally not used here.
 */

interface RockSpec {
  readonly tag: string;
  readonly assetId: "rock_medium_1" | "rock_medium_2" | "rock_medium_3";
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly rotationY: number;
  readonly scale: number;
}

interface MouthVariant {
  readonly rocks: readonly RockSpec[];
  readonly torchScale: number;
  readonly torchY: number;
  readonly thresholdScale: number;
  readonly thresholdZ: number;
  readonly pathZ: number;
}

const MOUTH_VARIANTS: readonly MouthVariant[] = [
  {
    // A broad, even jaw with a three-stone lintel. The side courses sit behind the brick piers so
    // their silhouettes read as a cut quarry face instead of boulders clipping through masonry.
    rocks: [
      { tag: "jaw_l", assetId: "rock_medium_3", dx: -4.7, dy: -0.58, dz: -1.82, rotationY: 0.45, scale: 0.9 },
      { tag: "jaw_r", assetId: "rock_medium_1", dx: 4.7, dy: -0.58, dz: -1.82, rotationY: -0.7, scale: 0.9 },
      // Shoulders bed INTO the jaws below them. Authored 0.18-0.24 m higher, every one of them
      // was a boulder hanging in the air over the jaw it is supposed to be resting on.
      { tag: "shoulder_l", assetId: "rock_medium_1", dx: -4.75, dy: 1.32, dz: -1.9, rotationY: 1.1, scale: 0.82 },
      { tag: "shoulder_r", assetId: "rock_medium_3", dx: 4.75, dy: 1.4, dz: -1.9, rotationY: 2.0, scale: 0.78 },
      { tag: "crown_l", assetId: "rock_medium_1", dx: -3.2, dy: 7.1, dz: -0.45, rotationY: 0.08, scale: 0.98 },
      { tag: "crown_c", assetId: "rock_medium_2", dx: 0, dy: 7.45, dz: -0.5, rotationY: 1.55, scale: 1.0 },
      { tag: "crown_r", assetId: "rock_medium_3", dx: 3.2, dy: 7.1, dz: -0.45, rotationY: 0.12, scale: 0.92 },
      { tag: "rear_l", assetId: "rock_medium_2", dx: -5.8, dy: -0.72, dz: -3.0, rotationY: 0.7, scale: 0.72 },
      { tag: "rear_r", assetId: "rock_medium_1", dx: 5.8, dy: -0.74, dz: -3.0, rotationY: 2.4, scale: 0.72 },
      { tag: "lip_l", assetId: "rock_medium_2", dx: -4.35, dy: -1.08, dz: 3.9, rotationY: 0.4, scale: 0.72 },
      { tag: "lip_r", assetId: "rock_medium_1", dx: 4.35, dy: -1.08, dz: 3.9, rotationY: 2.6, scale: 0.7 },
    ],
    torchScale: 2.16,
    torchY: 0.4,
    thresholdScale: 2.2,
    thresholdZ: 0.58,
    pathZ: 2.55,
  },
  {
    // A slightly collapsed right shoulder: asymmetry gives the rocky mouth a broken profile while
    // the centre crown still lands on the same deliberate masonry span.
    rocks: [
      { tag: "jaw_l", assetId: "rock_medium_1", dx: -4.75, dy: -0.62, dz: -1.85, rotationY: -0.3, scale: 0.9 },
      { tag: "jaw_r", assetId: "rock_medium_3", dx: 4.82, dy: -0.56, dz: -1.9, rotationY: 1.3, scale: 0.84 },
      { tag: "shoulder_l", assetId: "rock_medium_3", dx: -4.7, dy: 1.26, dz: -1.98, rotationY: 1.95, scale: 0.76 },
      { tag: "shoulder_r", assetId: "rock_medium_2", dx: 4.92, dy: 1.04, dz: -1.92, rotationY: 0.3, scale: 0.86 },
      { tag: "crown_l", assetId: "rock_medium_2", dx: -3.15, dy: 7.08, dz: -0.4, rotationY: 1.6, scale: 0.92 },
      { tag: "crown_c", assetId: "rock_medium_1", dx: 0.02, dy: 7.6, dz: -0.46, rotationY: 0.05, scale: 0.9 },
      { tag: "crown_r", assetId: "rock_medium_3", dx: 3.25, dy: 7.08, dz: -0.4, rotationY: 0.08, scale: 0.86 },
      { tag: "rear_l", assetId: "rock_medium_3", dx: -5.75, dy: -0.7, dz: -3.08, rotationY: 0.6, scale: 0.68 },
      { tag: "rear_r", assetId: "rock_medium_2", dx: 5.9, dy: -0.66, dz: -3.08, rotationY: 2.3, scale: 0.75 },
      { tag: "lip_l", assetId: "rock_medium_3", dx: -4.3, dy: -1.08, dz: 3.85, rotationY: 1.5, scale: 0.68 },
      { tag: "lip_r", assetId: "rock_medium_2", dx: 4.3, dy: -1.1, dz: 3.85, rotationY: 2.85, scale: 0.74 },
    ],
    torchScale: 2.24,
    torchY: 0.43,
    thresholdScale: 2.24,
    thresholdZ: 0.62,
    pathZ: 2.48,
  },
  {
    // A taller, more deliberate crown. The raised centre stone makes a readable apex over the
    // portal; every grounded piece remains behind the piers or outside the 3.4 m walk channel.
    rocks: [
      { tag: "jaw_l", assetId: "rock_medium_2", dx: -4.75, dy: -0.55, dz: -1.88, rotationY: 2.3, scale: 0.92 },
      { tag: "jaw_r", assetId: "rock_medium_1", dx: 4.72, dy: -0.62, dz: -1.86, rotationY: -1, scale: 0.9 },
      { tag: "shoulder_l", assetId: "rock_medium_1", dx: -4.72, dy: 1.3, dz: -1.96, rotationY: 0.8, scale: 0.82 },
      { tag: "shoulder_r", assetId: "rock_medium_3", dx: 4.78, dy: 1.18, dz: -1.92, rotationY: 1.9, scale: 0.78 },
      { tag: "crown_l", assetId: "rock_medium_3", dx: -3.25, dy: 7.08, dz: -0.42, rotationY: 0.08, scale: 0.88 },
      { tag: "crown_c", assetId: "rock_medium_2", dx: 0, dy: 7.78, dz: -0.48, rotationY: 0.02, scale: 1.0 },
      { tag: "crown_r", assetId: "rock_medium_1", dx: 3.25, dy: 7.08, dz: -0.42, rotationY: 0.08, scale: 0.9 },
      { tag: "rear_l", assetId: "rock_medium_3", dx: -5.78, dy: -0.68, dz: -3.05, rotationY: 1.55, scale: 0.68 },
      { tag: "rear_r", assetId: "rock_medium_1", dx: 5.82, dy: -0.7, dz: -3.05, rotationY: -0.2, scale: 0.74 },
      { tag: "lip_l", assetId: "rock_medium_1", dx: -4.35, dy: -1.06, dz: 3.9, rotationY: 2.4, scale: 0.7 },
      { tag: "lip_r", assetId: "rock_medium_3", dx: 4.35, dy: -1.08, dz: 3.9, rotationY: 0.45, scale: 0.68 },
    ],
    torchScale: 2.2,
    torchY: 0.42,
    thresholdScale: 2.18,
    thresholdZ: 0.56,
    pathZ: 2.62,
  },
  {
    // The most fractured profile: a lower left cap and a heavier right shoulder keep it distinct
    // while the brick piers remain the clean transition back to the masonry hero.
    rocks: [
      { tag: "jaw_l", assetId: "rock_medium_3", dx: -4.78, dy: -0.62, dz: -1.9, rotationY: -0.8, scale: 0.86 },
      { tag: "jaw_r", assetId: "rock_medium_2", dx: 4.8, dy: -0.58, dz: -1.88, rotationY: 1.7, scale: 0.9 },
      { tag: "shoulder_l", assetId: "rock_medium_2", dx: -4.78, dy: 1.12, dz: -1.96, rotationY: 2.4, scale: 0.82 },
      { tag: "shoulder_r", assetId: "rock_medium_3", dx: 4.82, dy: 1.36, dz: -1.94, rotationY: 0.9, scale: 0.8 },
      { tag: "crown_l", assetId: "rock_medium_1", dx: -3.25, dy: 7.08, dz: -0.42, rotationY: 0.06, scale: 0.9 },
      { tag: "crown_c", assetId: "rock_medium_3", dx: 0, dy: 7.45, dz: -0.48, rotationY: 0.06, scale: 0.92 },
      { tag: "crown_r", assetId: "rock_medium_2", dx: 3.25, dy: 7.08, dz: -0.42, rotationY: 0.06, scale: 0.9 },
      { tag: "rear_l", assetId: "rock_medium_1", dx: -5.8, dy: -0.7, dz: -3.08, rotationY: 1.0, scale: 0.7 },
      { tag: "rear_r", assetId: "rock_medium_2", dx: 5.86, dy: -0.66, dz: -3.08, rotationY: 2.1, scale: 0.76 },
      { tag: "lip_l", assetId: "rock_medium_2", dx: -4.36, dy: -1.1, dz: 3.9, rotationY: 0.3, scale: 0.7 },
      { tag: "lip_r", assetId: "rock_medium_1", dx: 4.36, dy: -1.06, dz: 3.9, rotationY: 1.9, scale: 0.72 },
    ],
    torchScale: 2.12,
    torchY: 0.38,
    thresholdScale: 2.26,
    thresholdZ: 0.6,
    pathZ: 2.52,
  },
] as const;

/**
 * Beds a `floor_brick` paving tile into the ground with its face just proud of it.
 *
 * `floor_brick` is a 0.020 m slab about a base at -0.010, so at 2.2 it is 44 mm thick. Both of
 * these tiles were authored at a flat `dy -0.035`, which put their TOP at -0.013 and -0.018: they
 * were submitted to the renderer, batched, and drew nothing at all because the whole tile was
 * under the ground plane.
 */
const PAVING_PROUD_METRES = 0.012;
const FLOOR_BRICK_TOP = 0.01;

function pavingY(scale: number): number {
  return PAVING_PROUD_METRES - FLOOR_BRICK_TOP * scale;
}

function placement(
  tag: string,
  assetId: string,
  dx: number,
  dy: number,
  dz: number,
  rotationY: number,
  scale: number,
): PartPlacement {
  return { tag, assetId, dx, dy, dz, rotationY, scale };
}

/**
 * Build one deterministic mouth dressing. The four recipes stay at seventeen parts: two brick
 * piers, a low kerb threshold, one brick approach tile, two upright torches, and eleven textured
 * rocks. Their measured source cost remains comfortably below the composition budget even when a
 * variant uses the high-density `rock_medium_3` in every quarry-facing position.
 */
export function buildGravelmawMouthComposition(seed: number, kit: BuildingKit): PartPlacement[] {
  const variant = MOUTH_VARIANTS[(seed >>> 0) % MOUTH_VARIANTS.length]!;
  const out: PartPlacement[] = [];

  // `gatePier` is the kit's stone gate masonry (wall_brick_straight in all current kits). These
  // two short piers frame the hero's thin panel, with a measured front face at z +0.093. Their
  // inner edges remain more than 2 m from centre, leaving the required 3.4 m walk channel between
  // them; the quarry rocks sit farther back so the transition reads as layered construction.
  out.push(placement("masonry_l", kit.gatePier, -3.12, -0.04, 0.14, 0, 1.04));
  out.push(placement("masonry_r", kit.gatePier, 3.12, -0.04, 0.14, 0, 1.04));

  // The kerb is a readable stone threshold rather than a wall across the opening. The floor tile
  // sits farther down the approach and is low enough to remain walkable, keeping the black centre
  // visible between the two piers.
  out.push(placement("threshold", "kerb_straight", 0, -0.035, variant.thresholdZ, 0, variant.thresholdScale));
  out.push(placement("approach_stone", "floor_brick", 0, pavingY(2.2), variant.pathZ, 0, 2.2));

  // A bracket torch mounts ON the pier, not in front of it. `torch`'s measured base.y is -0.278,
  // so a raw `variant.torchY` of 0.38-0.43 buried the foot 0.2 m at these scales, and dz 0.96 left
  // the mounting plate 0.82 m out in the open air in front of the pier's brick plane at z 0.140.
  // The pivot correction is the same one `rootTunnel.ts:torch` and `regionGate.ts:torchY` use.
  const brazierY = 0.278 * variant.torchScale + 0.38;
  out.push(placement("brazier_l", "torch", -3.35, brazierY, 0.1, 0, variant.torchScale));
  out.push(placement("brazier_r", "torch", 3.35, brazierY, 0.1, 0, variant.torchScale));

  for (const rock of variant.rocks) {
    out.push(placement(
      rock.tag,
      rock.assetId,
      rock.dx,
      rock.dy,
      rock.dz,
      rock.rotationY,
      rock.scale,
    ));
  }
  return out;
}

interface ExitVariant {
  readonly rocks: readonly RockSpec[];
  readonly torchScale: number;
  readonly torchY: number;
  readonly torchX: number;
  readonly torchZ: number;
  readonly thresholdScale: number;
  readonly thresholdZ: number;
}

/**
 * Small interior-side recipes for the reciprocal portal in chamber one.
 *
 * `gravelmaw_exit_portal` is another `wall_brick_door` hero, facing local +Z back toward the surface
 * mouth. The chamber floor is level at this point, so these rocks use only a shallow burial and
 * the torch pivots use the same measured `base.y = -0.278` correction as the surface mouth. Four
 * rocks, two brick piers, a floor-brick threshold and two torches are enough to make the exit read
 * as a cut stone opening without narrowing the three-metre approach from the chamber centre.
 */
const EXIT_VARIANTS: readonly ExitVariant[] = [
  {
    rocks: [
      { tag: "exit_jaw_l", assetId: "rock_medium_1", dx: -3.1, dy: -0.46, dz: -0.12, rotationY: 0.25, scale: 0.68 },
      { tag: "exit_jaw_r", assetId: "rock_medium_2", dx: 3.1, dy: -0.5, dz: -0.08, rotationY: -0.35, scale: 0.7 },
      { tag: "exit_cap_l", assetId: "rock_medium_3", dx: -3.1, dy: 2.02, dz: -0.82, rotationY: 0.2, scale: 0.65 },
      { tag: "exit_cap_r", assetId: "rock_medium_1", dx: 3.1, dy: 2.14, dz: -0.94, rotationY: -0.25, scale: 0.68 },
    ],
    torchScale: 1.62,
    torchY: 0.4,
    torchX: 2.55,
    torchZ: 0.76,
    thresholdScale: 1.7,
    thresholdZ: 0.52,
  },
  {
    rocks: [
      { tag: "exit_jaw_l", assetId: "rock_medium_2", dx: -3.1, dy: -0.5, dz: -0.18, rotationY: -0.2, scale: 0.7 },
      { tag: "exit_jaw_r", assetId: "rock_medium_3", dx: 3.1, dy: -0.48, dz: -0.02, rotationY: 0.4, scale: 0.62 },
      { tag: "exit_cap_l", assetId: "rock_medium_1", dx: -3.1, dy: 2.12, dz: -0.72, rotationY: -0.35, scale: 0.68 },
      { tag: "exit_cap_r", assetId: "rock_medium_2", dx: 3.1, dy: 1.98, dz: -1.02, rotationY: 0.25, scale: 0.66 },
    ],
    torchScale: 1.68,
    torchY: 0.42,
    torchX: 2.58,
    torchZ: 0.7,
    thresholdScale: 1.74,
    thresholdZ: 0.56,
  },
  {
    rocks: [
      { tag: "exit_jaw_l", assetId: "rock_medium_3", dx: -3.1, dy: -0.44, dz: -0.08, rotationY: 0.45, scale: 0.6 },
      { tag: "exit_jaw_r", assetId: "rock_medium_1", dx: 3.1, dy: -0.52, dz: -0.14, rotationY: -0.3, scale: 0.68 },
      { tag: "exit_cap_l", assetId: "rock_medium_2", dx: -3.1, dy: 2.06, dz: -0.9, rotationY: 0.35, scale: 0.7 },
      { tag: "exit_cap_r", assetId: "rock_medium_3", dx: 3.1, dy: 2.0, dz: -0.98, rotationY: -0.3, scale: 0.64 },
    ],
    torchScale: 1.64,
    torchY: 0.39,
    torchX: 2.52,
    torchZ: 0.82,
    thresholdScale: 1.72,
    thresholdZ: 0.5,
  },
] as const;

/** Build the compact chamber-side dressing for the Gravelmaw's exit portal. */
export function buildGravelmawExitComposition(seed: number, kit: BuildingKit): PartPlacement[] {
  const variant = EXIT_VARIANTS[(seed >>> 0) % EXIT_VARIANTS.length]!;
  const out: PartPlacement[] = [
    // The brick gate piers frame the separate `wall_brick_door` hero and leave its clear opening
    // untouched. At dx +-3.35 and scale 1.05 their inner edges landed at 2.30 m against a hero
    // whose panel reaches 2.20 m, so each pier stood off the portal behind a full-height 0.10 m
    // slot of daylight. +-3.15 laps them 0.10 m into the hero instead.
    placement("exit_pier_l", kit.gatePier, -3.15, -0.04, -0.18, 0, 1.05),
    placement("exit_pier_r", kit.gatePier, 3.15, -0.04, -0.18, 0, 1.05),

    // A single floor-brick tile reads as the threshold and remains floor, not a blocker across the
    // portal. The tile is centred on the +Z approach so the arch is still visible over it.
    placement("exit_floor_threshold", "floor_brick", 0, pavingY(variant.thresholdScale), variant.thresholdZ, 0, variant.thresholdScale),

    // `torch` is vertical at rotationY 0; its feet sit slightly below the chamber floor while the
    // flames flank the arch. No wall lamps or cage stand-ins are needed for this interior view.
    placement("exit_brazier_l", "torch", -variant.torchX, variant.torchY, variant.torchZ, 0, variant.torchScale),
    placement("exit_brazier_r", "torch", variant.torchX, variant.torchY, variant.torchZ, 0, variant.torchScale),
  ];

  for (const rock of variant.rocks) {
    out.push(placement(
      rock.tag,
      rock.assetId,
      rock.dx,
      rock.dy,
      rock.dz,
      rock.rotationY,
      rock.scale,
    ));
  }
  return out;
}
