import type { PartPlacement } from "../buildings.js";
import { inset, mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

type RuinCondition = "broken_junction" | "open_end" | "split_front" | "broken_return";
type RuinMood = "dry" | "overgrown";
type RubbleAsset =
  | "rubble_brick_1"
  | "rubble_brick_2"
  | "rubble_brick_3"
  | "rubble_brick_4";

interface RuinOptions {
  readonly id: `ruin:${string}`;
  readonly label: string;
  readonly condition: RuinCondition;
  readonly mood: RuinMood;
  readonly rubble: readonly [RubbleAsset, RubbleAsset];
  readonly prop: string;
  readonly propScale: number;
  readonly vase: boolean;
}

interface GroundAnchor {
  readonly dx: number;
  readonly dz: number;
}

interface WallAnchor {
  readonly wallTag: string;
  /** Offset along the wall's local +X, in metres. */
  readonly along: number;
}

interface RuinAnchors {
  readonly debris: readonly [GroundAnchor, GroundAnchor, GroundAnchor, GroundAnchor];
  readonly root: GroundAnchor;
  readonly vine: WallAnchor;
}

function frontWalls(base: readonly PartPlacement[]): PartPlacement[] {
  return base
    .filter((part) => /^w\d+$/.test(part.tag))
    .sort((left, right) => Number(left.tag.slice(1)) - Number(right.tag.slice(1)));
}

/**
 * Change which existing panels read as the breach. Placements stay untouched because ruin
 * collision is shared by every recipe; an asset swap can change the silhouette without moving the
 * shell away from that invariant mass.
 */
function remapShell(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  options: RuinOptions,
): PartPlacement[] {
  const front = frontWalls(base);
  const first = front[0]?.tag;
  const middle = front[Math.floor(front.length / 2)]?.tag;
  const last = front[front.length - 1]?.tag;
  const facade = new Map<string, string>();
  // The dungeon arch prop is made entirely of MI_WoodTrim. It turns Highcairn's brick ruin into a
  // wooden facade, so a kit window keeps the aperture and material family together instead.
  const opening = context.kit.wallWindow;

  if (options.condition === "broken_junction") {
    if (first !== undefined) facade.set(first, opening);
    facade.set("side", context.kit.wallWindow);
  } else if (options.condition === "open_end") {
    // A minimum-width ruin has one front module, so do not let the breach assignment silently
    // overwrite its door assignment. It is more legible to keep that lone bay as the opening.
    if (first !== undefined && first !== last) facade.set(first, context.kit.wallDoor);
    if (last !== undefined) facade.set(last, opening);
  } else if (options.condition === "split_front") {
    if (first !== undefined && first === last) {
      facade.set(first, opening);
    } else {
      if (first !== undefined) facade.set(first, context.kit.wallWindow);
      if (last !== undefined) facade.set(last, context.kit.wallWindow);
      if (middle !== undefined) facade.set(middle, opening);
    }
  } else {
    facade.set("side", opening);
    if (middle !== undefined) facade.set(middle, context.kit.wallDoor);
  }

  return mapAssets(base, (part) => {
    const facadeAsset = facade.get(part.tag);
    if (facadeAsset !== undefined) return facadeAsset;
    if (part.tag === "rub1") return options.rubble[0];
    if (part.tag === "rub2") return options.rubble[1];
    if (part.tag === "vine") return options.mood === "overgrown" ? "vine_2" : "vine_1";
    return undefined;
  });
}

function anchorsFor(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  condition: RuinCondition,
): RuinAnchors {
  const halfWidth = context.width / 2;
  const halfDepth = context.depth / 2;
  const x = (value: number): number => inset(value, halfWidth, 0.35);
  const z = (value: number): number => inset(value, halfDepth, 0.35);
  const left = -halfWidth + 0.48;
  const right = halfWidth - 0.48;
  const front = halfDepth - 0.48;
  const frontTags = frontWalls(base).map((part) => part.tag);
  const first = frontTags[0] ?? "w0";
  const middle = frontTags[Math.floor(frontTags.length / 2)] ?? first;
  const last = frontTags[frontTags.length - 1] ?? first;

  if (condition === "broken_junction") {
    return {
      debris: [
        { dx: x(left + 0.12), dz: z(front - 0.12) },
        { dx: x(left + 0.85), dz: z(front - 0.72) },
        { dx: x(left + 0.4), dz: z(front - 1.18) },
        { dx: x(left + 1.25), dz: z(front - 0.22) },
      ],
      root: { dx: x(left + 0.92), dz: z(front - 0.58) },
      vine: { wallTag: first, along: 0.38 },
    };
  }

  if (condition === "open_end") {
    return {
      debris: [
        { dx: x(right - 0.12), dz: z(front - 0.12) },
        { dx: x(right - 0.85), dz: z(front - 0.72) },
        { dx: x(right - 0.4), dz: z(front - 1.18) },
        { dx: x(right - 1.25), dz: z(front - 0.22) },
      ],
      root: { dx: x(right - 0.92), dz: z(front - 0.58) },
      vine: { wallTag: last, along: -0.38 },
    };
  }

  if (condition === "split_front") {
    return {
      debris: [
        { dx: x(-0.62), dz: z(front - 0.12) },
        { dx: x(0.62), dz: z(front - 0.22) },
        { dx: x(1.08), dz: z(front - 0.9) },
        { dx: x(-1.12), dz: z(front - 0.78) },
      ],
      root: { dx: x(-0.62), dz: z(front - 1.16) },
      vine: { wallTag: middle, along: -0.88 },
    };
  }

  return {
    debris: [
      { dx: x(left + 0.12), dz: z(-0.62) },
      { dx: x(left + 0.22), dz: z(0.62) },
      { dx: x(left + 0.92), dz: z(-1.05) },
      { dx: x(left + 0.82), dz: z(1.02) },
    ],
    root: { dx: x(left + 1.16), dz: z(0.62) },
    vine: { wallTag: "side", along: -0.72 },
  };
}

function wallAttachment(
  base: readonly PartPlacement[],
  anchor: WallAnchor,
  assetId: string,
  out: number,
  dy: number,
  scale: number,
): PartPlacement {
  const wall = base.find((part) => part.tag === anchor.wallTag);
  if (wall === undefined) throw new Error(`Ruin variant cannot find wall tag ${anchor.wallTag}`);
  const yaw = wall.rotationY;
  return variantPart(
    "ground_vine",
    assetId,
    wall.dx + Math.sin(yaw) * out + Math.cos(yaw) * anchor.along,
    wall.dy + dy,
    wall.dz + Math.cos(yaw) * out - Math.sin(yaw) * anchor.along,
    yaw,
    scale,
  );
}

function groundLift(assetId: string, scale: number): number {
  // The two low props whose pivots sit below y=0 otherwise sink into the ruin floor.
  if (assetId === "rope_coil") return 0.027 * scale;
  if (assetId === "cooking_pot") return 0.023 * scale;
  return 0;
}

function rubbleLift(scale: number): number {
  // All four rubble bricks have a roughly 0.11 m negative y bound at scale 1.
  return 0.12 * scale;
}

function optionalDetails(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  options: RuinOptions,
): PartPlacement[] {
  const anchors = anchorsFor(context, base, options.condition);
  const turn = ((context.seed >>> 5) % 16) * (Math.PI / 8);
  const details: PartPlacement[] = [
    variantPart(
      "chips_a", options.rubble[1], anchors.debris[0].dx, rubbleLift(1.45), anchors.debris[0].dz,
      turn, 1.45,
    ),
    variantPart(
      "chips_b", options.rubble[0], anchors.debris[1].dx, rubbleLift(1.1), anchors.debris[1].dz,
      turn + 1.1, 1.1,
    ),
    variantPart(
      "relic", options.prop, anchors.debris[2].dx, groundLift(options.prop, options.propScale),
      anchors.debris[2].dz, turn + 2.2, options.propScale,
    ),
  ];

  if (options.vase) {
    details.push(variantPart(
      "pottery", "rubble_vase",
      anchors.debris[3].dx, 0.006, anchors.debris[3].dz, turn + 0.55, 0.82,
    ));
  }

  if (options.mood === "overgrown") {
    const vineScale = 0.74;
    // vine_2 is the fuller overgrown silhouette. Its local -Z reaches 1.024 m into the wall, so
    // the attachment is pushed out by 0.86 m to put that back edge on the surviving panel rather
    // than burying half the leaves in it. Its -1.955 m y bound is lifted to the ground.
    details.push(wallAttachment(
      base, anchors.vine, "vine_2", 0.86, 1.955 * vineScale, vineScale,
    ));
    details.push(variantPart(
      "root_rubble", options.rubble[1],
      anchors.root.dx, rubbleLift(0.9), anchors.root.dz, turn + 1.7, 0.9,
    ));
  }

  return details;
}

function ruinRecipe(options: RuinOptions): StructureVariantRecipe {
  return {
    id: options.id,
    label: options.label,
    family: "ruin",
    prefab: "ruin",
    detailBudget: 3 + (options.vase ? 1 : 0) + (options.mood === "overgrown" ? 2 : 0),
    build: (context, base) => withDetails(
      remapShell(context, base, options),
      ...optionalDetails(context, base, options),
    ),
  };
}

export const RUIN_VARIANTS: readonly StructureVariantRecipe[] = [
  ruinRecipe({
    id: "ruin:broken-junction-dry",
    label: "Dry Broken Junction",
    condition: "broken_junction",
    mood: "dry",
    rubble: ["rubble_brick_1", "rubble_brick_4"],
    prop: "chain_coil",
    propScale: 0.68,
    vase: true,
  }),
  ruinRecipe({
    id: "ruin:broken-junction-overgrown",
    label: "Overgrown Broken Junction",
    condition: "broken_junction",
    mood: "overgrown",
    rubble: ["rubble_brick_3", "rubble_brick_2"],
    prop: "sack_large",
    propScale: 1.35,
    vase: false,
  }),
  ruinRecipe({
    id: "ruin:open-end-dry",
    label: "Dry Open End",
    condition: "open_end",
    mood: "dry",
    rubble: ["rubble_brick_2", "rubble_brick_3"],
    prop: "bucket_wood",
    propScale: 0.86,
    vase: false,
  }),
  ruinRecipe({
    id: "ruin:open-end-overgrown",
    label: "Overgrown Open End",
    condition: "open_end",
    mood: "overgrown",
    rubble: ["rubble_brick_4", "rubble_brick_1"],
    prop: "rope_coil",
    propScale: 0.72,
    vase: true,
  }),
  ruinRecipe({
    id: "ruin:split-front-dry",
    label: "Dry Split Front",
    condition: "split_front",
    mood: "dry",
    rubble: ["rubble_brick_3", "rubble_brick_1"],
    prop: "cooking_pot",
    propScale: 0.82,
    vase: true,
  }),
  ruinRecipe({
    id: "ruin:split-front-overgrown",
    label: "Overgrown Split Front",
    condition: "split_front",
    mood: "overgrown",
    rubble: ["rubble_brick_2", "rubble_brick_4"],
    prop: "sack_large",
    propScale: 1.5,
    vase: false,
  }),
  ruinRecipe({
    id: "ruin:broken-return-dry",
    label: "Dry Broken Return",
    condition: "broken_return",
    mood: "dry",
    rubble: ["rubble_brick_4", "rubble_brick_2"],
    prop: "chain_coil",
    propScale: 0.64,
    vase: false,
  }),
  ruinRecipe({
    id: "ruin:broken-return-overgrown",
    label: "Overgrown Broken Return",
    condition: "broken_return",
    mood: "overgrown",
    rubble: ["rubble_brick_1", "rubble_brick_3"],
    prop: "bucket_wood",
    propScale: 0.82,
    vase: true,
  }),
];
