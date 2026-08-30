import type { PartPlacement } from "../buildings.js";
import { inset, mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const YARD_TAGS = new Set([
  "lamp",
  "wagon",
  "crate",
  "crate_apple",
  "crate_carrot",
  "sack_l",
  "sack_r",
  "barrel",
  "fence0",
  "fence1",
]);

const DORMER_FRONT_REACH = 1.9;
const DORMER_EAVE_MARGIN = 0.08;

function curatedBase(
  base: readonly PartPlacement[],
  keep: readonly string[],
): PartPlacement[] {
  const keptTags = new Set(keep);
  return base.filter((part) => !YARD_TAGS.has(part.tag) || keptTags.has(part.tag));
}

function front(context: StructureVariantContext): number {
  return -context.depth / 2;
}

function loadX(context: StructureVariantContext): number {
  return inset(context.width * 0.3, context.width / 2, 0.65);
}

function yardX(context: StructureVariantContext, value: number): number {
  return inset(value, context.width / 2 + 2.064, 0.12);
}

function yardZ(context: StructureVariantContext, value: number): number {
  return inset(value, context.depth / 2 + 3.375, 0.12);
}

function largeRoofScale(context: StructureVariantContext): number {
  const short = Math.min(context.width, context.depth);
  const long = Math.max(context.width, context.depth);
  return Math.max(
    short / context.kit.roofLargeCovers[0],
    long / context.kit.roofLargeCovers[1],
  );
}

function largeRoofAcrossHalf(context: StructureVariantContext): number {
  return context.kit.roofLargeBox[0] * largeRoofScale(context) / 2;
}

function hasTwinDoors(context: StructureVariantContext): boolean {
  const modules = Math.max(1, Math.round(context.width / 2));
  return modules >= 4 && modules % 2 === 0;
}

function loftDormer(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement {
  const ridgeAlongZ = context.depth > context.width;
  const outward = largeRoofAcrossHalf(context) - DORMER_FRONT_REACH - DORMER_EAVE_MARGIN;
  const roofY = base.find((part) => part.tag === "roof")?.dy ?? 3.123;
  return variantPart(
    "loft_dormer",
    "roof_dormer",
    ridgeAlongZ ? -outward : 0,
    roofY + 0.55,
    ridgeAlongZ ? 0 : -outward,
    ridgeAlongZ ? Math.PI : Math.PI / 2,
  );
}

export const FARMSTEAD_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "farmstead:cart-barn",
    label: "Cart barn",
    family: "workshop",
    prefab: "farmstead",
    detailBudget: 4,
    build: (context, base) => {
      const yardFront = front(context);
      const load = loadX(context);
      return withDetails(
        curatedBase(base, ["lamp", "wagon", "fence0", "fence1"]),
        variantPart("cart_empty_crate_a", "farm_crate_empty", yardX(context, load), 0, yardZ(context, yardFront - 0.9), 0.08),
        variantPart("cart_empty_crate_b", "farm_crate_empty", yardX(context, load + 0.78), 0, yardZ(context, yardFront - 1.25), -0.12),
        variantPart("cart_bucket", "bucket_wood", yardX(context, load - 0.68), 0, yardZ(context, yardFront - 1.25), -0.2),
        variantPart("cart_sack", "sack", yardX(context, load + 0.15), 0, yardZ(context, yardFront - 1.7), 0.35, 0.9),
      );
    },
  },
  {
    id: "farmstead:apple-barn",
    label: "Apple barn",
    family: "workshop",
    prefab: "farmstead",
    detailBudget: 4,
    build: (context, base) => {
      const yardFront = front(context);
      const load = loadX(context);
      const themed = mapAssets(
        curatedBase(base, ["lamp", "crate_apple", "barrel", "fence0", "fence1"]),
        (part) => part.tag === "barrel" ? "barrel_apples" : undefined,
      );
      return withDetails(
        themed,
        variantPart("apple_crate_a", "farm_crate_apple", yardX(context, load - 0.72), 0, yardZ(context, yardFront - 1.25), 0.06),
        variantPart("apple_crate_b", "farm_crate_apple", yardX(context, load + 0.08), 0, yardZ(context, yardFront - 1.82), -0.09),
        variantPart("apple_barrel", "barrel_apples", yardX(context, -context.width / 2 + 1.25), 0, yardZ(context, yardFront - 1.5), -0.08),
        variantPart("apple_bucket", "bucket_wood", yardX(context, load - 1.1), 0, yardZ(context, yardFront - 1.85), 0.2),
      );
    },
  },
  {
    id: "farmstead:fenced",
    label: "Fenced barn",
    family: "workshop",
    prefab: "farmstead",
    detailBudget: 4,
    build: (context, base) => {
      const yardFront = front(context);
      const railX = context.width / 2 + 2;
      return withDetails(
        curatedBase(base, ["lamp", "barrel", "fence0", "fence1"]),
        variantPart("fence_return_l_a", "fence_wood_extension", yardX(context, -railX), -0.1, yardZ(context, yardFront - 0.61), Math.PI / 2),
        variantPart("fence_return_l_b", "fence_wood_single", yardX(context, -railX), -0.1, yardZ(context, yardFront - 2.3), Math.PI / 2),
        variantPart("fence_return_r_a", "fence_wood_single", yardX(context, railX), -0.1, yardZ(context, yardFront - 0.61), Math.PI / 2),
        variantPart("fence_return_r_b", "fence_wood_extension", yardX(context, railX), -0.1, yardZ(context, yardFront - 2.3), Math.PI / 2),
      );
    },
  },
  {
    id: "farmstead:twin-door",
    label: "Twin-door barn",
    family: "workshop",
    prefab: "farmstead",
    detailBudget: 4,
    fits: hasTwinDoors,
    build: (context, base) => {
      const yardFront = front(context);
      const side = inset(context.width * 0.32, context.width / 2, 0.7);
      return withDetails(
        curatedBase(base, ["lamp", "fence0", "fence1"]),
        variantPart("twin_crate_l", "farm_crate_empty", yardX(context, -side), 0, yardZ(context, yardFront - 0.85), 0.08),
        variantPart("twin_crate_r", "farm_crate_empty", yardX(context, side), 0, yardZ(context, yardFront - 0.85), -0.08),
        variantPart("twin_sack_l", "sack", yardX(context, -side + 0.25), 0, yardZ(context, yardFront - 1.45), -0.3, 0.85),
        variantPart("twin_sack_r", "sack", yardX(context, side - 0.25), 0, yardZ(context, yardFront - 1.45), 0.3, 0.85),
      );
    },
  },
  {
    id: "farmstead:loft-dormer",
    label: "Loft dormer",
    family: "workshop",
    prefab: "farmstead",
    detailBudget: 4,
    fits: (context) => largeRoofAcrossHalf(context) >= DORMER_FRONT_REACH + DORMER_EAVE_MARGIN,
    build: (context, base) => {
      const yardFront = front(context);
      const load = loadX(context);
      const shell = curatedBase(base, ["lamp", "fence0", "fence1"])
        .filter((part) => part.tag !== "dormer");
      return withDetails(
        shell,
        loftDormer(context, base),
        variantPart("loft_empty_crate", "farm_crate_empty", yardX(context, load), 0, yardZ(context, yardFront - 0.95), 0.1),
        variantPart("loft_sack", "sack", yardX(context, load + 0.65), 0, yardZ(context, yardFront - 1.2), -0.25, 0.85),
        variantPart("loft_bucket", "bucket_wood", yardX(context, load - 0.55), 0, yardZ(context, yardFront - 1.3), 0.15),
      );
    },
  },
  {
    id: "farmstead:workyard",
    label: "Workyard barn",
    family: "workshop",
    prefab: "farmstead",
    detailBudget: 6,
    build: (context, base) => {
      const yardFront = front(context);
      const workX = Math.max(1.2, context.width / 2 - 0.7);
      return withDetails(
        curatedBase(base, ["lamp", "fence0", "fence1"]),
        variantPart("work_bench", "workbench", yardX(context, workX), 0, yardZ(context, yardFront - 0.85), 0),
        variantPart("work_empty_crate_a", "farm_crate_empty", yardX(context, workX - 1.45), 0, yardZ(context, yardFront - 1.45), 0.12),
        variantPart("work_empty_crate_b", "farm_crate_empty", yardX(context, workX + 1.4), 0, yardZ(context, yardFront - 1.65), -0.1),
        variantPart("work_bucket", "bucket_metal", yardX(context, workX - 0.55), 0, yardZ(context, yardFront - 1.85), -0.2),
        variantPart("work_barrel", "barrel", yardX(context, -context.width / 2 + 0.75), 0, yardZ(context, yardFront - 0.85), 0.08),
        variantPart("work_sack", "sack", yardX(context, workX + 0.3), 0, yardZ(context, yardFront - 2.05), 0.35, 0.9),
      );
    },
  },
];
