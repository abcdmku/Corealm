import type { PartPlacement } from "../buildings.js";
import { inset, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const MAX_FRAME_OVERLAYS = 8;

/** Wall panels that can safely carry a facade overlay without changing the wall's solid mass. */
function solidPanels(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const halfWidth = context.width / 2;
  return base.filter((part) => (
    /^w\d+$/.test(part.tag)
    && part.assetId === context.kit.wall
    // The overlay is a two-metre panel, so its scaled half-width is `part.scale`.
    && Math.abs(part.dx) + Math.abs(part.scale) <= halfWidth + 0.001
  ));
}

function alreadyFramed(base: readonly PartPlacement[], panel: PartPlacement): boolean {
  return base.some((part) => part.tag === `f${panel.tag.slice(1)}`);
}

function closestToCentre(parts: readonly PartPlacement[]): PartPlacement | undefined {
  return parts.reduce<PartPlacement | undefined>((closest, part) => (
    closest === undefined || Math.abs(part.dx) < Math.abs(closest.dx) ? part : closest
  ), undefined);
}

export const WALL_SEGMENT_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "wall_segment:plain",
    label: "Plain Wall",
    family: "fortification",
    prefab: "wall_segment",
    detailBudget: 0,
    build: (_context, base) => withDetails(base),
  },
  {
    id: "wall_segment:framed",
    label: "Timber-Framed Wall",
    family: "fortification",
    prefab: "wall_segment",
    kits: ["timber"],
    detailBudget: MAX_FRAME_OVERLAYS,
    build: (context, base) => {
      const details = solidPanels(context, base)
        .filter((panel) => !alreadyFramed(base, panel))
        .slice(0, MAX_FRAME_OVERLAYS)
        .map((panel) => variantPart(
          `frame_${panel.tag}`,
          "wall_plaster_timber",
          panel.dx,
          panel.dy,
          panel.dz + 0.02,
          panel.rotationY,
          panel.scale,
        ));
      return withDetails(base, ...details);
    },
  },
  {
    id: "wall_segment:repaired",
    label: "Field-Repaired Wall",
    family: "fortification",
    prefab: "wall_segment",
    detailBudget: 3,
    build: (context, base) => {
      const panel = closestToCentre(solidPanels(context, base));
      if (panel === undefined) return withDetails(base);

      const halfWidth = context.width / 2;
      const patchX = inset(panel.dx, halfWidth, 0.8);
      return withDetails(
        base,
        // A shallow run of boards over a solid panel reads as a repair without adding wall mass.
        variantPart("repair_slats", "fence_wood_single", patchX, 0.9, 0.13, 0, 0.72),
        variantPart(
          "repair_rubble_l", "rubble_brick_1",
          inset(-context.width * 0.22, halfWidth, 0.3), 0.14, 0.06, 0.35, 1.25,
        ),
        variantPart(
          "repair_rubble_r", "rubble_brick_2",
          inset(context.width * 0.22, halfWidth, 0.3), 0.13, 0.06, 2.25, 1.15,
        ),
      );
    },
  },
  {
    id: "wall_segment:lit",
    label: "Lantern Wall",
    family: "fortification",
    prefab: "wall_segment",
    detailBudget: 1,
    build: (context, base) => withDetails(
      base,
      variantPart(
        "lamp",
        "lamp_wall",
        inset(context.width * 0.18, context.width / 2, 0.25),
        1.7,
        0.14,
        0,
        0.9,
      ),
    ),
  },
];
