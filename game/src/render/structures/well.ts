import type { PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";
import { inset, mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantRecipe } from "./types.js";

interface WellStyle {
  readonly bucket?: "bucket_wood" | "bucket_metal";
  readonly rigging?: "chain_coil" | "rope_coil";
  readonly roof?: boolean;
  readonly chain?: boolean;
}

const HALF_FOOTPRINT = 1;
const CURB_LINE = inset(0.68, HALF_FOOTPRINT, 0.25);
const FLOWER_EDGE = inset(0.82, HALF_FOOTPRINT, 0.12);

/** Keep the fixed curb and post placements, but use the slender post mesh in every regional kit. */
function dressWell(base: readonly PartPlacement[], style: WellStyle = {}): PartPlacement[] {
  const kept = base.filter((part) => (
    (style.roof !== false || !part.tag.startsWith("roof_"))
    && (style.chain !== false || part.tag !== "chain")
  ));

  return mapAssets(kept, (part) => {
    if (part.tag.startsWith("post")) return "corner_wood";
    if (part.tag === "bucket") return style.bucket;
    if (part.tag === "chain") return style.rigging;
    return undefined;
  });
}

export const WELL_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "well:timber-gable",
    label: "Timber Gable Well",
    family: "civic",
    prefab: "well",
    detailBudget: 1,
    build: (_context, base) => withDetails(
      dressWell(base, { rigging: "rope_coil" }),
      // roof_log is pivoted well below its mesh; this seats the cap inside the existing ridge height.
      variantPart("ridge_cap", "roof_log", 0, 2.529, 0, Math.PI / 2, 0.13),
    ),
  },
  {
    id: "well:open-winch",
    label: "Tiled Winch Well",
    family: "civic",
    prefab: "well",
    detailBudget: 2,
    build: (_context, base) => withDetails(
      // The two dark plank slopes read as an upright rack from Coldbrace's square camera. Replace
      // them with the kit's smallest complete tiled roof, scaled to the same measured envelope.
      dressWell(base, { bucket: "bucket_metal", rigging: "rope_coil", roof: false }),
      variantPart("tiled_canopy", "roof_tiles_4x6", 0, 2.18, 0, 0, 0.3),
      variantPart("winch_axle", "roof_log", 0, 1.07, 0, Math.PI / 2, 0.13),
    ),
  },
  {
    id: "well:stone-cap",
    label: "Stone-Capped Well",
    family: "civic",
    prefab: "well",
    detailBudget: 1,
    build: (_context, base) => withDetails(
      dressWell(base, { bucket: "bucket_metal" }),
      // A raised paper-thin apron reads as masonry without adding a new ground obstruction.
      variantPart("cobble_apron", "floor_cobble", 0, 0.012, 0, 0, 0.88),
    ),
  },
  {
    id: "well:flower",
    label: "Flower-Ring Well",
    family: "civic",
    prefab: "well",
    detailBudget: 4,
    build: (_context, base) => withDetails(
      dressWell(base, { rigging: "rope_coil" }),
      variantPart("flower_w", "flower_a_single", -FLOWER_EDGE, 0.012, 0.18, 0.3, 0.18),
      variantPart("flower_e", "flower_b_single", FLOWER_EDGE, 0.012, -0.16, 2.4, 0.17),
      variantPart("flower_s", "flower_a_group", 0.14, 0.012, FLOWER_EDGE, 1.2, 0.14),
      variantPart("flower_n", "flower_b_group", -0.12, 0.012, -FLOWER_EDGE, 2.8, 0.13),
    ),
  },
  {
    id: "well:lantern",
    label: "Lantern Well",
    family: "civic",
    prefab: "well",
    detailBudget: 1,
    build: (_context, base) => withDetails(
      dressWell(base, { bucket: "bucket_metal" }),
      // The bracket projects inward above the curb, leaving the approach clear on every side.
      variantPart("lantern", "lamp_wall", -CURB_LINE, 1.12, -CURB_LINE, 0, 0.45),
    ),
  },
  {
    id: "well:shrine",
    label: "Wayside Shrine Well",
    family: "civic",
    prefab: "well",
    detailBudget: 5,
    build: (_context, base) => withDetails(
      dressWell(base, { chain: false }),
      // banner_2 is a projecting bracket, not a wall-flat pennant. Mount its rail to the
      // south-west corner post's outward face; the helper turns local +X toward local -Z.
      wallMountedBanner(
        "v_shrine_banner",
        "banner_2",
        { dx: -0.7, dy: 1.98, dz: -0.8 },
        Math.PI,
        0.34,
      ),
      variantPart("offering_books", "book_stack", -0.35, 0.09, -CURB_LINE, 0.2, 0.75),
      variantPart("offering_coins", "coin_pile", -0.08, 0.09, -CURB_LINE, -0.3, 0.9),
      variantPart("offering_vial", "potion_1", 0.18, 0.09, -CURB_LINE, 0.4, 0.9),
      variantPart("votive", "candle_stand", 0.48, 0.09, -CURB_LINE, 0, 0.25),
    ),
  },
];
