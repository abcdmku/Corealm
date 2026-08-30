import type { PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";
import { inset, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const BASE_GOODS_TAG = /^goods\d+[ab]$/;
const STALL_TAG = /^stall\d+$/;
const MIN_SAFE_PITCH_SPACING = 2.7;
const MAX_DETAILS = 10;
// `market_stall`'s front uprights are centred at x +/-0.845 and z +0.35 in the
// prefab frame.  The festival banner is a projecting bracket: its rail sits on
// the left upright and its local +X is turned toward the customer (+Z), rather
// than treating the cloth width as frontage across the stall.
const STALL_UPRIGHT_X = 0.845;
const STALL_CUSTOMER_Z = 0.35;

interface GapSlot {
  readonly x: number;
  readonly z: number;
}

interface PacketChoice {
  readonly assetId: string;
  readonly scale: number;
  readonly dy?: number;
  readonly rotationY?: number;
  readonly zNudge?: number;
}

function cleanBase(base: readonly PartPlacement[]): PartPlacement[] {
  return base.filter((part) => !BASE_GOODS_TAG.test(part.tag));
}

function orderedStalls(base: readonly PartPlacement[]): PartPlacement[] {
  return base
    .filter((part) => STALL_TAG.test(part.tag))
    .sort((left, right) => left.dx - right.dx);
}

function gapSlots(context: StructureVariantContext, base: readonly PartPlacement[]): GapSlot[] {
  const stalls = orderedStalls(base);
  const slots: GapSlot[] = [];
  for (let index = 0; index + 1 < stalls.length; index += 1) {
    const left = stalls[index]!;
    const right = stalls[index + 1]!;
    if (right.dx - left.dx < MIN_SAFE_PITCH_SPACING) continue;
    slots.push({
      x: inset((left.dx + right.dx) / 2, context.width / 2, 0.55),
      z: inset((left.dz + right.dz) / 2 + 0.68, context.depth / 2, 0.48),
    });
  }
  return slots;
}

function evenlyLimited<T>(values: readonly T[], limit: number): T[] {
  if (values.length <= limit) return [...values];
  if (limit <= 1) return values.length === 0 ? [] : [values[Math.floor(values.length / 2)]!];
  return Array.from({ length: limit }, (_unused, index) => (
    values[Math.round(index * (values.length - 1) / (limit - 1))]!
  ));
}

function hasSafeGap(context: StructureVariantContext): boolean {
  const pitches = Math.max(1, Math.round(context.width / 3));
  return pitches > 1 && context.width / pitches >= MIN_SAFE_PITCH_SPACING;
}

function goodsVariant(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  choices: readonly PacketChoice[],
  detailLimit = MAX_DETAILS,
): PartPlacement[] {
  const details = evenlyLimited(gapSlots(context, base), detailLimit).map((slot, index) => {
    const choice = choices[(index + context.seed) % choices.length]!;
    return variantPart(
      `packet_${index}`,
      choice.assetId,
      slot.x,
      choice.dy ?? 0,
      inset(slot.z + (choice.zNudge ?? 0), context.depth / 2, 0.48),
      choice.rotationY ?? (index % 2 === 0 ? -0.08 : 0.08),
      choice.scale,
    );
  });
  return withDetails(cleanBase(base), ...details);
}

const PRODUCE: readonly PacketChoice[] = [
  { assetId: "farm_crate_carrot", scale: 0.9, dy: 0.016, rotationY: 0.04 },
  { assetId: "farm_crate_apple", scale: 0.95, dy: 0.016, rotationY: -0.05 },
  { assetId: "barrel_apples", scale: 0.82, rotationY: 0 },
];

const BARRELS: readonly PacketChoice[] = [
  { assetId: "barrel_rack", scale: 0.58, dy: 0.006, rotationY: 0 },
  { assetId: "barrel", scale: 0.82, rotationY: 0.12, zNudge: 0.03 },
];

const SACKS: readonly PacketChoice[] = [
  { assetId: "sack", scale: 0.92, rotationY: -0.16 },
  { assetId: "sack", scale: 0.82, rotationY: 0.2, zNudge: 0.06 },
  { assetId: "sack_large", scale: 1.35, rotationY: 0.08 },
];

const SMITH_GOODS: readonly PacketChoice[] = [
  { assetId: "anvil", scale: 0.68, rotationY: 0 },
  { assetId: "crate_metal", scale: 0.82, rotationY: 0.05 },
  { assetId: "whetstone", scale: 0.64, rotationY: -0.04 },
];

const GENERAL_GOODS: readonly PacketChoice[] = [
  { assetId: "crate_wood", scale: 0.78, dy: 0.052, rotationY: -0.06 },
  { assetId: "crate_village", scale: 0.66, rotationY: 0.04 },
  { assetId: "barrel", scale: 0.78, rotationY: 0 },
  { assetId: "sack", scale: 0.86, rotationY: 0.14 },
];

const FESTIVAL_GOODS: readonly PacketChoice[] = [
  { assetId: "flower_a_group", scale: 0.42, dy: 0.035, rotationY: 0 },
  { assetId: "farm_crate_apple", scale: 0.9, dy: 0.016, rotationY: -0.05 },
  { assetId: "barrel_apples", scale: 0.78, rotationY: 0.08 },
];

function festival(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const withGoods = goodsVariant(context, base, FESTIVAL_GOODS, MAX_DETAILS - 1);
  const stalls = orderedStalls(base);
  const centre = stalls[Math.floor(stalls.length / 2)];
  if (!centre) return withGoods;
  const scale = 0.55;
  const banner = wallMountedBanner(
    "v_festival_banner",
    "banner_1",
    {
      dx: centre.dx - STALL_UPRIGHT_X,
      dy: 2.1,
      dz: centre.dz + STALL_CUSTOMER_Z,
    },
    0,
    scale,
  );
  return withDetails(withGoods, banner);
}

export const MARKET_ROW_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "market_row:produce",
    label: "Produce row",
    family: "open_air",
    prefab: "market_row",
    detailBudget: MAX_DETAILS,
    fits: hasSafeGap,
    build: (context, base) => goodsVariant(context, base, PRODUCE),
  },
  {
    id: "market_row:barrels",
    label: "Cask merchants",
    family: "open_air",
    prefab: "market_row",
    detailBudget: MAX_DETAILS,
    fits: hasSafeGap,
    build: (context, base) => goodsVariant(context, base, BARRELS),
  },
  {
    id: "market_row:sacks",
    label: "Dry-goods row",
    family: "open_air",
    prefab: "market_row",
    detailBudget: MAX_DETAILS,
    fits: hasSafeGap,
    build: (context, base) => goodsVariant(context, base, SACKS),
  },
  {
    id: "market_row:smith",
    label: "Smiths' row",
    family: "open_air",
    prefab: "market_row",
    detailBudget: MAX_DETAILS,
    fits: hasSafeGap,
    build: (context, base) => goodsVariant(context, base, SMITH_GOODS),
  },
  {
    id: "market_row:general",
    label: "General market",
    family: "open_air",
    prefab: "market_row",
    detailBudget: MAX_DETAILS,
    fits: hasSafeGap,
    build: (context, base) => goodsVariant(context, base, GENERAL_GOODS),
  },
  {
    id: "market_row:festival",
    label: "Festival market",
    family: "open_air",
    prefab: "market_row",
    detailBudget: MAX_DETAILS,
    fits: hasSafeGap,
    build: festival,
  },
];
