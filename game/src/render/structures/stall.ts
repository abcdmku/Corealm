import type { PartPlacement } from "../buildings.js";
import { inset, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const CLASSIC_GOODS = new Set(["crate_wood", "barrel", "sack"]);

/** Stall recipes are composed for the classic 3 x 2 m market pitch. */
function fitsStall(context: StructureVariantContext): boolean {
  return context.width >= 3 && context.width <= 3.5 && context.depth <= 2.5;
}

/** Remove the classic loose pile before placing one deliberate, non-overlapping cluster. */
function bareStall(base: readonly PartPlacement[]): PartPlacement[] {
  return base.filter((part) => !CLASSIC_GOODS.has(part.assetId));
}

function clusterX(context: StructureVariantContext): number {
  return inset(context.width / 2 - 0.28, context.width / 2, 0.02);
}

function clusterZ(context: StructureVariantContext, value: number): number {
  // Stall collision is 60% of the footprint depth, centred on the origin.
  return inset(value, context.depth * 0.3, 0.01);
}

export const STALL_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "stall:produce",
    label: "Produce stall",
    family: "open_air",
    prefab: "stall",
    detailBudget: 3,
    fits: fitsStall,
    build: (context, base) => withDetails(
      bareStall(base),
      variantPart("produce_apples_l", "farm_crate_apple", clusterX(context), 0.01, clusterZ(context, -0.42), 0, 0.6),
      variantPart("produce_carrots", "farm_crate_carrot", clusterX(context), 0.01, clusterZ(context, 0), 0, 0.6),
      variantPart("produce_apples_r", "farm_crate_apple", clusterX(context), 0.01, clusterZ(context, 0.34), 0, 0.6),
    ),
  },
  {
    id: "stall:barrels",
    label: "Cooper's stall",
    family: "open_air",
    prefab: "stall",
    detailBudget: 3,
    fits: fitsStall,
    build: (context, base) => withDetails(
      bareStall(base),
      variantPart("barrel_l", "barrel", clusterX(context), 0, clusterZ(context, -0.39), 0, 0.55),
      variantPart("barrel_apples", "barrel_apples", clusterX(context), 0, clusterZ(context, 0), 0, 0.55),
      variantPart("barrel_r", "barrel", clusterX(context), 0, clusterZ(context, 0.39), 0, 0.55),
    ),
  },
  {
    id: "stall:sacks",
    label: "Grain stall",
    family: "open_air",
    prefab: "stall",
    detailBudget: 3,
    fits: fitsStall,
    build: (context, base) => withDetails(
      bareStall(base),
      variantPart("sack_l", "sack", clusterX(context), 0, clusterZ(context, -0.4), 0, 0.62),
      variantPart("sack_c", "sack", clusterX(context), 0, clusterZ(context, 0), 0, 0.62),
      variantPart("sack_r", "sack", clusterX(context), 0, clusterZ(context, 0.36), 0, 0.62),
    ),
  },
  {
    id: "stall:smith",
    label: "Smith's stall",
    family: "open_air",
    prefab: "stall",
    detailBudget: 3,
    fits: fitsStall,
    build: (context, base) => withDetails(
      bareStall(base),
      variantPart("smith_anvil", "anvil", clusterX(context), 0, clusterZ(context, -0.35), 0, 0.45),
      variantPart("smith_crate", "crate_metal", clusterX(context), 0, clusterZ(context, 0.13), 0, 0.48),
      variantPart("smith_bucket", "bucket_metal", clusterX(context), 0.42, clusterZ(context, 0.13), 0, 0.65),
    ),
  },
  {
    id: "stall:general",
    label: "General goods stall",
    family: "open_air",
    prefab: "stall",
    detailBudget: 3,
    fits: fitsStall,
    build: (context, base) => withDetails(
      bareStall(base),
      variantPart("general_crate", "crate_wood", clusterX(context), 0.024, clusterZ(context, -0.35), 0, 0.45),
      variantPart("general_barrel", "barrel", clusterX(context), 0, clusterZ(context, 0.1), 0, 0.52),
      variantPart("general_sack", "sack", clusterX(context), 0, clusterZ(context, 0.42), 0, 0.55),
    ),
  },
  {
    id: "stall:sparse",
    label: "Sparse trader's stall",
    family: "open_air",
    prefab: "stall",
    detailBudget: 2,
    fits: fitsStall,
    build: (context, base) => withDetails(
      bareStall(base),
      variantPart("sparse_crate", "crate_village", clusterX(context), 0, clusterZ(context, -0.3), 0, 0.45),
      variantPart("sparse_rope", "rope_coil", clusterX(context), 0.014, clusterZ(context, 0.3), 0, 0.52),
    ),
  },
];
