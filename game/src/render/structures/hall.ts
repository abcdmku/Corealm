import type { PartPlacement } from "../buildings.js";
import { inset, mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const FRONT_YAW = Math.PI;
const GUILD_SHUTTER_SCALE = 0.86;
const GUILD_SHUTTER_PROUD = 0.05;

/** Base details that a recipe may safely restyle or omit without touching the hall shell. */
const FOUNDATION_DETAIL = /^(?:foundation_plant_|foundation_vine$)/;

function withoutTags(
  base: readonly PartPlacement[],
  reject: (part: PartPlacement) => boolean,
): PartPlacement[] {
  return base.filter((part) => !reject(part));
}

function frontDoorWall(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement | undefined {
  return base.find((part) => part.tag.startsWith("w2_") && part.assetId === context.kit.wallDoor);
}

function entryFrame(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  tag: string,
): PartPlacement | undefined {
  const wall = frontDoorWall(context, base);
  if (wall === undefined) return undefined;
  return variantPart(tag, "door_frame_round", wall.dx, 0, wall.dz - 0.04, FRONT_YAW);
}

function companyHall(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const dressed = mapAssets(base, (part) => (
    part.tag === "banner_l" || part.tag === "banner_r" ? "banner_2" : undefined
  ));
  const wall = frontDoorWall(context, dressed);
  const frame = entryFrame(context, dressed, "company_entry_frame");
  const details: PartPlacement[] = [];
  if (frame !== undefined) details.push(frame);
  if (wall !== undefined) {
    details.push(variantPart(
      "company_shield", "shield", wall.dx, 2.72, wall.dz - 0.14, FRONT_YAW, 1.08,
    ));
  }
  return withDetails(dressed, ...details);
}

function councilGallery(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const clean = withoutTags(base, (part) => part.tag === "banner_l" || part.tag === "banner_r");
  const wall = frontDoorWall(context, clean);
  const bayCount = Math.max(2, Math.min(3, Math.round(context.width / 4)));
  const span = bayCount * 2;
  const centre = inset(wall?.dx ?? 0, context.width / 2, span / 2 + 0.2);
  const details: PartPlacement[] = [];

  // A shallow applied gallery: the rail sits against the facade rather than adding a walkable deck.
  for (let index = 0; index < bayCount; index += 1) {
    const x = centre + (index + 0.5) * 2 - span / 2;
    details.push(variantPart(
      `gallery_sill_${index}`, "wall_bottom_trim",
      x, 1.7, -context.depth / 2 - 0.03, FRONT_YAW,
    ));
    // balcony_straight's mesh lies about 0.9 m along local +Z from its pivot. This inset leaves the
    // rail just proud of the -Z wall instead of floating a metre in front of it.
    details.push(variantPart(
      `gallery_rail_${index}`, "balcony_straight",
      x, 1.82, -context.depth / 2 + 0.9, FRONT_YAW,
    ));
  }
  return withDetails(clean, ...details);
}

function shutteredGuild(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  // Keep the apertured wall and its glass insert in the base facade. Shutters are a separate
  // overlay, placed from the insert's transform and nudged outward along the entry normal.
  const mapped = mapAssets(base, (part) => (
    part.tag === "banner_l" || part.tag === "banner_r" ? "banner_2" : undefined
  ));
  const shutters = base
    .filter((part) => part.tag.startsWith("g2_") && part.assetId === "window_wide")
    .map((window, index) => variantPart(
      `guild_shutter_${index}`,
      "window_shutters",
      window.dx + Math.sin(window.rotationY) * GUILD_SHUTTER_PROUD,
      window.dy,
      window.dz + Math.cos(window.rotationY) * GUILD_SHUTTER_PROUD,
      window.rotationY,
      GUILD_SHUTTER_SCALE,
    ));
  const wall = frontDoorWall(context, mapped);
  return wall === undefined
    ? withDetails(mapped, ...shutters)
    : withDetails(mapped, ...shutters, variantPart(
      "guild_shield", "shield", wall.dx, 2.76, wall.dz - 0.14, FRONT_YAW,
    ));
}

function twinHearth(
  _context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const clean = withoutTags(base, (part) => part.tag === "dormer");
  const chimney = clean.find((part) => part.tag === "chimney");
  if (chimney === undefined) return clean;
  return withDetails(clean, variantPart(
    "chimney_second", chimney.assetId,
    -chimney.dx, chimney.dy, chimney.dz, chimney.rotationY, chimney.scale,
  ));
}

function dormeredLongroof(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const clean = withoutTags(base, (part) => part.tag === "dormer");
  const roof = clean.find((part) => part.tag === "roof");
  if (roof === undefined) return clean;

  const ridgeAlongX = Math.abs(Math.sin(roof.rotationY)) > 0.5;
  const count = (ridgeAlongX ? context.width : context.depth) >= 10 ? 3 : 2;
  const details: PartPlacement[] = [];
  // roof_dormer's facade extends 1.9 m along its local +X. Keep that reach inside the measured eave.
  const reach = 1.9;
  if (ridgeAlongX) {
    const roofSpanZ = context.kit.roofLargeBox[0] * roof.scale;
    const z = -roofSpanZ / 2 + reach + 0.05;
    for (let index = 0; index < count; index += 1) {
      const rawX = ((index + 1) / (count + 1) - 0.5) * context.width;
      const x = inset(rawX, context.width / 2, 1.2);
      details.push(variantPart(
        `longroof_dormer_${index}`, "roof_dormer",
        x, roof.dy + 0.55, z, Math.PI / 2,
      ));
    }
  } else {
    const roofSpanX = context.kit.roofLargeBox[0] * roof.scale;
    const x = -roofSpanX / 2 + reach + 0.05;
    for (let index = 0; index < count; index += 1) {
      const rawZ = ((index + 1) / (count + 1) - 0.5) * context.depth;
      const z = inset(rawZ, context.depth / 2, 1.2);
      details.push(variantPart(
        `longroof_dormer_${index}`, "roof_dormer",
        x, roof.dy + 0.55, z, Math.PI,
      ));
    }
  }
  return withDetails(clean, ...details);
}

function storehall(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const frontWindowSuffixes = new Set(
    base.filter((part) => part.tag.startsWith("g2_") && part.assetId === "window_wide")
      .map((part) => part.tag.slice(1)),
  );
  const solidFront = mapAssets(base, (part) => (
    part.tag.startsWith("w2_") && frontWindowSuffixes.has(part.tag.slice(1))
      ? context.kit.wallFeature
      : undefined
  ));
  const clean = withoutTags(solidFront, (part) => (
    (part.tag.startsWith("g2_") && frontWindowSuffixes.has(part.tag.slice(1)))
    || part.tag === "banner_l"
    || part.tag === "banner_r"
    || part.tag === "lamp_r"
    || part.tag === "chimney"
    || part.tag === "dormer"
    || FOUNDATION_DETAIL.test(part.tag)
  ));
  const details: PartPlacement[] = [];

  // A mid-wall string course turns the closed entry elevation into a storehouse facade.
  const courseCount = Math.max(2, Math.min(8, Math.round(context.width / 2)));
  const courseSpacing = context.width / courseCount;
  for (let index = 0; index < courseCount; index += 1) {
    details.push(variantPart(
      `store_course_${index}`, "wall_bottom_trim",
      (index + 0.5) * courseSpacing - context.width / 2,
      1.55, -context.depth / 2 - 0.03, FRONT_YAW, courseSpacing / 2,
    ));
  }

  // Timber kits need a few frames restored over window modules that this recipe closes. Alternate
  // them to keep the elevation readable without spending a part on every bay.
  if (context.kit.frame !== null) {
    const closedWalls = clean.filter((part) => (
      part.tag.startsWith("w2_") && frontWindowSuffixes.has(part.tag.slice(1))
    )).slice(0, 4);
    for (const [index, wall] of closedWalls.entries()) {
      details.push(variantPart(
        `store_frame_${index}`, context.kit.frame,
        wall.dx + Math.sin(wall.rotationY) * 0.02,
        wall.dy,
        wall.dz + Math.cos(wall.rotationY) * 0.02,
        wall.rotationY,
        wall.scale,
      ));
    }
  }
  const frame = entryFrame(context, clean, "store_entry_frame");
  if (frame !== undefined) details.push(frame);
  return withDetails(clean, ...details);
}

export const HALL_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "hall:company",
    label: "Company Hall",
    family: "civic",
    prefab: "hall",
    detailBudget: 2,
    build: companyHall,
  },
  {
    id: "hall:council-gallery",
    label: "Council Gallery",
    family: "civic",
    prefab: "hall",
    detailBudget: 6,
    build: councilGallery,
  },
  {
    id: "hall:shuttered-guild",
    label: "Shuttered Guildhall",
    family: "civic",
    prefab: "hall",
    detailBudget: 5,
    build: shutteredGuild,
  },
  {
    id: "hall:twin-hearth",
    label: "Twin-Hearth Hall",
    family: "civic",
    prefab: "hall",
    detailBudget: 1,
    build: twinHearth,
  },
  {
    id: "hall:dormered-longroof",
    label: "Dormered Longroof",
    family: "civic",
    prefab: "hall",
    detailBudget: 3,
    build: dormeredLongroof,
  },
  {
    id: "hall:storehall",
    label: "Storehall",
    family: "civic",
    prefab: "hall",
    detailBudget: 13,
    build: storehall,
  },
] as const;
