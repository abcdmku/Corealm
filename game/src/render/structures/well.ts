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
/**
 * Top of the wellhead curb, mirroring `WELL_CURB_SHOW` in render/buildings.ts.
 *
 * The curb used to be a 0.167 m trim ring, so "on the curb" and "on the ground" were the same
 * height and every offering, flower and coin in these recipes was authored at y ~= 0.01. The curb
 * is 0.55 m of masonry now: anything authored inside the 0.70 m ring at ground level is at the
 * bottom of the shaft, where nobody can see it.
 */
const CURB_TOP = 0.55;

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
      // 0.30 drew a 1.65 m tile over posts standing 1.56 m apart with 0.08 m caps, so both front
      // posts came through the roof by 0.14 m. At 0.38 the tile plane crosses the post line 0.24 m
      // above the placement height, which clears the caps by 0.06 m. The base already carries the
      // windlass drum; a second `roof_log` here drew two axles in the same 0.15 m of space.
      variantPart("tiled_canopy", "roof_tiles_4x6", 0, 2.1, 0, 0, 0.38),
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
      // Laid along the south coping, not on the floor of the shaft.
      variantPart("offering_books", "book_stack", -0.35, CURB_TOP, -CURB_LINE, 0.2, 0.75),
      variantPart("offering_coins", "coin_pile", -0.08, CURB_TOP, -CURB_LINE, -0.3, 0.9),
      variantPart("offering_vial", "potion_1", 0.18, CURB_TOP, -CURB_LINE, 0.4, 0.9),
      variantPart("votive", "candle_stand", 0.48, CURB_TOP, -CURB_LINE, 0, 0.25),
    ),
  },
];
