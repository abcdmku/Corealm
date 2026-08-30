import type { PartPlacement } from "../buildings.js";
import { inset, mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

type ShedSide = -1 | 1;

const ROOF_PLANK_DEPTH = 1.56;
const ROOF_PLANK_HALF_WIDTH = 2.258 / 2;
const LOG_PIVOT_DROP = 3.849;
const LOG_THICKNESS = 1.149;

/** Pick the side opposite the seeded front-door module for compact exterior storage. */
function serviceSide(base: readonly PartPlacement[]): ShedSide {
  const door = base.find((part) => part.tag === "door");
  return (door?.dx ?? 0) >= 0 ? -1 : 1;
}

/**
 * The classic shed leaves its crate on the -Z frontage without checking the random door slot.
 * Move it beside the opposite rear quarter instead. It still hugs the shell, while the entire
 * approach to the door remains clear and the closed shed body remains untouched.
 */
function stageBaseCrate(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  assetId: string,
): PartPlacement[] {
  const side = serviceSide(base);
  const swapped = mapAssets(base, (part) => part.tag === "crate" ? assetId : undefined);
  return swapped.map((part) => part.tag === "crate" ? {
    ...part,
    dx: side * (context.width / 2 + 0.36),
    dz: inset(context.depth * 0.25, context.depth / 2, 0.68),
    rotationY: side * Math.PI / 2,
  } : part);
}

/** Give the store's rear elevation a solid apron panel when the current kit supplies one. */
function featureRearWall(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  return mapAssets(base, (part) => (
    part.tag.startsWith("w0_") && part.assetId === context.kit.wall
      ? context.kit.wallFeature
      : undefined
  ));
}

function rearZ(context: StructureVariantContext, gap = 0.3): number {
  return context.depth / 2 + gap;
}

/** Match the fixed shed-roof transform so the plank lean stays below its existing eaves. */
function roofHalfDepth(context: StructureVariantContext): number {
  const scale = 0.8 * (4 / context.kit.roofSmallCovers[0]);
  const localDepth = context.width >= context.depth
    ? context.kit.roofSmallBox[0]
    : context.kit.roofSmallBox[1];
  return localDepth * scale / 2;
}

export const SHED_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "shed:tile-store",
    label: "Tiled Store",
    family: "workshop",
    prefab: "shed",
    detailBudget: 3,
    build: (context, base) => {
      const side = serviceSide(base);
      const shell = stageBaseCrate(context, featureRearWall(context, base), "crate_metal");
      return withDetails(
        shell,
        variantPart("tile_rack", "barrel_rack", -side * 0.92, 0, rearZ(context, 0.3)),
        variantPart("tile_sack", "sack", side * 0.42, 0, rearZ(context, 0.34), side * 0.35),
        variantPart("store_lamp", "lamp_wall", -side * 0.15, 1.72, context.depth / 2 + 0.08),
      );
    },
  },
  {
    id: "shed:plank-lean",
    label: "Braced Drying Lean",
    family: "workshop",
    prefab: "shed",
    detailBudget: 5,
    build: (context, base) => {
      const plankScale = 0.7;
      const plankX = ROOF_PLANK_HALF_WIDTH * plankScale;
      const plankZ = roofHalfDepth(context) - ROOF_PLANK_DEPTH * plankScale;
      const braceScale = 0.8;
      const braceDrop = -1.211 * braceScale;
      return withDetails(
        stageBaseCrate(context, base, "crate_wood"),
        variantPart("lean_roof_left", "roof_wood_plank", -plankX, 2.35, plankZ, 0, plankScale),
        variantPart("lean_roof_right", "roof_wood_plank", plankX, 2.35, plankZ, 0, plankScale),
        variantPart("drying_brace_left", "support_beam", -0.82, braceDrop, rearZ(context, 0.22), Math.PI / 2, braceScale),
        variantPart("drying_brace_right", "support_beam", 0.82, braceDrop, rearZ(context, 0.22), -Math.PI / 2, braceScale),
        variantPart("drying_rope", "rope_coil", 0, 0.04, rearZ(context, 0.48), 0.4, 0.9),
      );
    },
  },
  {
    id: "shed:woodpile",
    label: "Woodpile Shed",
    family: "workshop",
    prefab: "shed",
    detailBudget: 5,
    build: (context, base) => {
      const side = serviceSide(base);
      const scale = 0.24;
      const drop = -LOG_PIVOT_DROP * scale;
      const thick = LOG_THICKNESS * scale;
      const stackZ = rearZ(context, 0.32);
      return withDetails(
        stageBaseCrate(context, base, "crate_wood"),
        variantPart("log_lower_left", "roof_log", 0, drop, stackZ - thick, Math.PI / 2, scale),
        variantPart("log_lower_mid", "roof_log", 0, drop, stackZ, Math.PI / 2, scale),
        variantPart("log_lower_right", "roof_log", 0, drop, stackZ + thick, Math.PI / 2, scale),
        variantPart("log_upper", "roof_log", side * 0.1, drop + thick * 0.86, stackZ + thick / 2, Math.PI / 2, scale),
        variantPart("woodpile_rope", "rope_coil", side * 1.55, 0.04, rearZ(context, 0.38), side * 0.45, 0.9),
      );
    },
  },
  {
    id: "shed:tool-rack",
    label: "Tool Rack",
    family: "workshop",
    prefab: "shed",
    detailBudget: 4,
    build: (context, base) => {
      const side = serviceSide(base);
      return withDetails(
        stageBaseCrate(context, base, "crate_metal"),
        variantPart("tool_rack", "weapon_rack", -side * 0.72, 0, rearZ(context, 0.28)),
        variantPart("whetstone", "whetstone", side * 1.12, 0, rearZ(context, 0.48), side * 0.42, 0.92),
        variantPart("tool_bucket", "bucket_wood", -side * 1.55, 0.03, rearZ(context, 0.34), -side * 0.25),
        variantPart("work_lamp", "lamp_wall", side * 0.38, 1.72, context.depth / 2 + 0.08),
      );
    },
  },
  {
    id: "shed:vine-store",
    label: "Vine Store",
    family: "workshop",
    prefab: "shed",
    detailBudget: 4,
    build: (context, base) => {
      const side = serviceSide(base);
      return withDetails(
        stageBaseCrate(context, base, "crate_village"),
        variantPart("vine_left", "vine_1", -0.78, 1.65, context.depth / 2 + 0.08, 0, 0.75),
        variantPart("vine_right", "vine_1", 0.78, 1.65, context.depth / 2 + 0.08, 0, 0.75),
        variantPart("vine_barrel", "barrel", -side * 1.18, 0, rearZ(context, 0.34), -side * 0.2),
        variantPart("vine_sack", "sack", side * 0.82, 0, rearZ(context, 0.38), side * 0.5),
      );
    },
  },
  {
    id: "shed:farm-store",
    label: "Farm Store",
    family: "workshop",
    prefab: "shed",
    detailBudget: 6,
    build: (context, base) => {
      const side = serviceSide(base);
      const storesZ = rearZ(context, 0.32);
      return withDetails(
        stageBaseCrate(context, base, "crate_wood"),
        variantPart("apple_barrel", "barrel_apples", -side * 1.18, 0, storesZ, -side * 0.2),
        variantPart("apple_crate", "farm_crate_apple", side * 0.92, 0, storesZ, side * 0.18),
        variantPart("carrot_crate", "farm_crate_carrot", side * 0.1, 0, storesZ + 0.08, -side * 0.25),
        variantPart("empty_crate", "farm_crate_empty", side * 0.92, 0.26, storesZ, -side * 0.12),
        variantPart("farm_sack", "sack", -side * 0.42, 0, storesZ + 0.1, side * 0.42),
        variantPart("farm_bucket", "bucket_wood", -side * 1.65, 0.03, storesZ + 0.04, side * 0.2),
      );
    },
  },
];
