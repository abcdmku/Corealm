import type { PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";
import { inset, mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const STOREY_METRES = 3.123;

function halfWidth(context: StructureVariantContext): number {
  return context.width / 2;
}

function halfDepth(context: StructureVariantContext): number {
  return context.depth / 2;
}

/** Three fixed bays keep the 6x6 tower's course on its existing two-metre module rhythm. */
function courseOffsets(halfExtent: number): readonly number[] {
  const reach = inset(2, halfExtent, 0.75);
  return [-reach, 0, reach];
}

function upperCourse(context: StructureVariantContext, tag: string): PartPlacement[] {
  const xOffsets = courseOffsets(halfWidth(context));
  const zOffsets = courseOffsets(halfDepth(context));
  const southReach = inset(2.06, halfWidth(context), 0.94);
  const northZ = halfDepth(context) + 0.01;
  const southZ = -halfDepth(context) - 0.01;
  const eastX = halfWidth(context) + 0.01;
  const westX = -halfWidth(context) - 0.01;
  const y = STOREY_METRES + 0.027;

  return [
    ...xOffsets.map((dx, index) => variantPart(`${tag}_north_${index}`, "wall_bottom_trim", dx, y, northZ)),
    // The hero vault frame occupies the centre entry bay up to 3.83 m. Leave that bay open and
    // nudge the two side pieces outward so the course terminates cleanly beside it.
    variantPart(`${tag}_south_l`, "wall_bottom_trim", -southReach, y, southZ, Math.PI),
    variantPart(`${tag}_south_r`, "wall_bottom_trim", southReach, y, southZ, Math.PI),
    ...zOffsets.map((dz, index) => variantPart(`${tag}_east_${index}`, "wall_bottom_trim", eastX, y, dz, Math.PI / 2)),
    ...zOffsets.map((dz, index) => variantPart(`${tag}_west_${index}`, "wall_bottom_trim", westX, y, dz, -Math.PI / 2)),
  ];
}

const TOWER_SIDE_LABELS = ["north", "east", "south", "west"] as const;
const UPPER_WALL_TAG = /^w1_[0-3]_\d+$/;
const UPPER_INSERT_TAG = /^g1_[0-3]_\d+$/;
const WINDOW_INSERT_OUT = 0.03;
const SHUTTER_OUT = 0.07;
const SHUTTER_SCALE = 0.85;

function fitsShutteredSpire(context: StructureVariantContext): boolean {
  return Math.abs(context.width - 6) < 0.01 && Math.abs(context.depth - 6) < 0.01;
}

function fitsBanneredVault(context: StructureVariantContext): boolean {
  return context.width >= 6 && context.depth >= 6;
}

function isWindowInsert(part: PartPlacement): boolean {
  return part.assetId === "window_wide" || part.assetId === "window_thin";
}

function upperWallTag(insertTag: string): string {
  return `w${insertTag.slice(1)}`;
}

function insertTag(wallTag: string): string {
  return `g${wallTag.slice(1)}`;
}

function upperSideLabel(wallTag: string): string {
  const side = Number(/^w1_([0-3])_/.exec(wallTag)?.[1]);
  return TOWER_SIDE_LABELS[side] ?? "bay";
}

/** Find real upper apertures before falling back to the authored 6 x 6 centre bays. */
function shutterTargets(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const walls = base.filter((part) => UPPER_WALL_TAG.test(part.tag));
  const byTag = new Map(walls.map((part) => [part.tag, part]));
  const targets: PartPlacement[] = [];
  const seen = new Set<string>();
  const add = (wall: PartPlacement | undefined): void => {
    if (wall !== undefined && !seen.has(wall.tag)) {
      seen.add(wall.tag);
      targets.push(wall);
    }
  };

  // A g1_* insert is the strongest evidence that the matching w1_* slot is an aperture, even
  // when a caller supplied a solid wall replacement. Normal tower output has exactly these two.
  for (const part of base) {
    if (UPPER_INSERT_TAG.test(part.tag) && isWindowInsert(part)) {
      add(byTag.get(upperWallTag(part.tag)));
    }
  }
  for (const wall of walls) {
    if (wall.assetId === context.kit.wallWindow) add(wall);
  }

  // The 6 x 6 tower's authored fallback is side 2 (entry) and side 1 (east), centre bay on each.
  // This branch only repairs a malformed/solid base; it never invents a placement in another bay.
  for (const tag of ["w1_2_1", "w1_1_1"]) add(byTag.get(tag));
  return targets.slice(0, 2);
}

function facadePart(
  tag: string,
  assetId: string,
  wall: PartPlacement,
  out: number,
  scale: number,
): PartPlacement {
  const yaw = wall.rotationY;
  return variantPart(
    tag,
    assetId,
    wall.dx + Math.sin(yaw) * out,
    wall.dy,
    wall.dz + Math.cos(yaw) * out,
    yaw,
    scale,
  );
}

function exactWindowInsert(
  tag: string,
  wall: PartPlacement,
  assetId: "window_wide" | "window_thin",
  scale: number,
): PartPlacement {
  // Existing g1_* tags are part of the stable prefab output; preserve that tag while refreshing
  // the transform. A missing insert is added separately with a v_* tag below.
  return {
    ...facadePart(tag, assetId, wall, WINDOW_INSERT_OUT, scale),
    tag,
  };
}

function shutteredSpire(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const targets = shutterTargets(context, base);
  if (targets.length === 0) return [...base];

  const targetWalls = new Map(targets.map((wall) => [wall.tag, wall]));
  const targetInsertTags = new Set(targets.map((wall) => insertTag(wall.tag)));
  const targetFrameTags = new Set(targets.map((wall) => `f${wall.tag.slice(1)}`));
  const existingInsertTags = new Set(
    base.filter((part) => targetInsertTags.has(part.tag)).map((part) => part.tag),
  );

  const elevation = base
    .filter((part) => !targetFrameTags.has(part.tag))
    .map((part) => {
      const wall = targetWalls.get(part.tag);
      if (wall !== undefined) return { ...part, assetId: context.kit.wallWindow };

      const insertWall = UPPER_INSERT_TAG.test(part.tag)
        ? targetWalls.get(upperWallTag(part.tag))
        : undefined;
      if (insertWall !== undefined) {
        const assetId: "window_wide" | "window_thin" = part.assetId === "window_thin"
          ? "window_thin"
          : "window_wide";
        return exactWindowInsert(part.tag, insertWall, assetId, part.scale);
      }
      return part;
    });

  const details: PartPlacement[] = [];
  for (const wall of targets) {
    const windowTag = insertTag(wall.tag);
    if (!existingInsertTags.has(windowTag)) {
      details.push(variantPart(
        `spire_window_${upperSideLabel(wall.tag)}`,
        "window_wide",
        wall.dx + Math.sin(wall.rotationY) * WINDOW_INSERT_OUT,
        wall.dy,
        wall.dz + Math.cos(wall.rotationY) * WINDOW_INSERT_OUT,
        wall.rotationY,
      ));
    }
    details.push(facadePart(
      `spire_shutter_${upperSideLabel(wall.tag)}`,
      "window_shutters",
      wall,
      SHUTTER_OUT,
      SHUTTER_SCALE,
    ));
  }
  return withDetails(elevation, ...details);
}

export const TOWER_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "tower:austere",
    label: "Austere civic tower",
    family: "civic",
    prefab: "tower",
    detailBudget: 0,
    build: (context, base) => mapAssets(
      // Glass inserts are seeded dressing rather than shell pieces. Closing their matching window
      // panels makes the tower severe without changing a wall, corner, entry, lamp, or spire tag.
      // Tower glass tags are `g<storey>_<side>_<bay>`. Match that grammar precisely so future
      // stable shell tags such as `gable*` can never be removed by this dressing recipe.
      base.filter((part) => !/^g[01]_[0-3]_\d+$/.test(part.tag)),
      (part) => (
        part.tag.startsWith("w") && part.assetId === context.kit.wallWindow
          ? context.kit.wall
          : undefined
      ),
    ),
  },
  {
    id: "tower:vault-bannered",
    label: "Bannered vault tower",
    family: "civic",
    prefab: "tower",
    // Coldbrace already gives its vault entrance one aligned ceremonial pair. Limiting this side
    // treatment to the stone vernacular prevents three independent banner layers on one tower.
    kits: ["stone"],
    fits: fitsBanneredVault,
    detailBudget: 13,
    build: (context, base) => withDetails(
      base,
      ...upperCourse(context, "vault_course"),
      // These are projecting standards, not wall-flat signs. The shared helper turns the banner's
      // local bracket so its rail is on the facade and its cloth points away from the side wall.
      // Keep them in the outer bays so the ceremonial south entry remains unobstructed.
      wallMountedBanner(
        "v_vault_banner_east", "banner_1",
        { dx: halfWidth(context) + 0.103, dy: 4.75, dz: 0.725 },
        Math.PI / 2,
        0.9,
      ),
      wallMountedBanner(
        "v_vault_banner_west", "banner_1",
        { dx: -halfWidth(context) - 0.103, dy: 4.75, dz: -0.725 },
        3 * Math.PI / 2,
        0.9,
      ),
    ),
  },
  {
    id: "tower:watch-lit",
    label: "Lit watch tower",
    family: "civic",
    prefab: "tower",
    detailBudget: 4,
    build: (context, base) => {
      const x = inset(2, halfWidth(context), 0.4);
      // Grilles go on the tower's ACTUAL upper apertures, which is what `shutterTargets` already
      // resolves for the shuttered recipe. They used to be pinned to the centre of the +Z and +X
      // faces, and `ringWindows` does not put an aperture in the middle of a face: on the shipped
      // 4 x 4 Highcairn watch tower both grilles landed on blank masonry while the two real
      // openings a metre away were left bare.
      const targets = shutterTargets(context, base);
      const grilles = targets.map((wall, index) => (
        facadePart(`watch_grille_${index}`, "fence_metal_ornate", wall, 0.19, 0.6)
      ));
      return withDetails(
        base,
        ...grilles,
        // 0.07 m of stand-off, not -0.07: the sign buried each shield 0.16 m into the brick and
        // left only its central boss showing.
        variantPart("watch_shield_l", "shield", -x, 2.3, -halfDepth(context) - 0.07, Math.PI, 1.3),
        variantPart("watch_shield_r", "shield", x, 2.3, -halfDepth(context) - 0.07, Math.PI, 1.3),
      );
    },
  },
  {
    id: "tower:upper-gallery",
    label: "Upper gallery tower",
    family: "civic",
    prefab: "tower",
    detailBudget: 8,
    build: (context, base) => {
      const northZ = halfDepth(context) + 0.04;
      const southZ = -halfDepth(context) - 0.04;
      const eastX = halfWidth(context) + 0.04;
      const westX = -halfWidth(context) - 0.04;
      const guardNorthZ = halfDepth(context) + 0.108;
      const guardSouthZ = -halfDepth(context) - 0.108;
      const guardEastX = halfWidth(context) + 0.108;
      const guardWestX = -halfWidth(context) - 0.108;
      return withDetails(
        base,
        // Four shallow balconettes sit above the hero entry frame. There is deliberately no deck,
        // access route, or collision change: these are elevated facade dressings only.
        variantPart("gallery_sill_north", "wall_bottom_trim", 0, 4, northZ),
        variantPart("gallery_guard_north", "fence_wood_extension", 0, 4.15, guardNorthZ),
        variantPart("gallery_sill_south", "wall_bottom_trim", 0, 4, southZ, Math.PI),
        variantPart("gallery_guard_south", "fence_wood_extension", 0, 4.15, guardSouthZ, Math.PI),
        variantPart("gallery_sill_east", "wall_bottom_trim", eastX, 4, 0, Math.PI / 2),
        variantPart("gallery_guard_east", "fence_wood_extension", guardEastX, 4.15, 0, Math.PI / 2),
        variantPart("gallery_sill_west", "wall_bottom_trim", westX, 4, 0, -Math.PI / 2),
        variantPart("gallery_guard_west", "fence_wood_extension", guardWestX, 4.15, 0, -Math.PI / 2),
      );
    },
  },
  {
    id: "tower:shuttered-spire",
    label: "Shuttered spire tower",
    family: "civic",
    prefab: "tower",
    // Canonical tower output already carries two g1_* inserts; the extra headroom covers the
    // defensive solid-slot repair below without making an incomplete aperture look valid.
    detailBudget: 4,
    fits: fitsShutteredSpire,
    build: shutteredSpire,
  },
  {
    id: "tower:ivy-old",
    label: "Old ivy tower",
    family: "civic",
    prefab: "tower",
    detailBudget: 5,
    build: (context, base) => {
      const x = halfWidth(context);
      const z = halfDepth(context);
      return withDetails(
        base,
        // Ivy grows ON the wall, so every offset is OUTWARD from the face. The signs were
        // inverted - `-z + 0.02` is 0.02 m INSIDE the -Z face - which buried all five vines in
        // the masonry and left an "ivy-covered" tower with no ivy on it. `foundationGreenery`
        // in buildings.ts uses the same 0.1 m stand-off.
        variantPart("ivy_front_low", "vine_1", inset(-1.8, x, 0.8), 2.13, -z - 0.1, Math.PI, 0.9),
        variantPart("ivy_front_high", "vine_1", inset(1.45, x, 0.8), 4.55, -z - 0.1, Math.PI, 0.78),
        variantPart("ivy_west", "vine_1", -x - 0.1, 2.45, inset(1.35, z, 0.8), -Math.PI / 2, 0.82),
        variantPart("ivy_north", "vine_1", inset(-1.45, x, 0.8), 4.9, z + 0.1, 0, 0.7),
        variantPart("ivy_east", "vine_1", x + 0.1, 3.5, inset(-1.4, z, 0.8), Math.PI / 2, 0.75),
      );
    },
  },
];
