import type { PartPlacement } from "../buildings.js";
import { wallMountedBanner, type BannerAssetId } from "../bannerPlacement.js";
import { inset, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

/**
 * The porch shell's back wall is the local +Z-facing facade.  `wallMountedBanner` anchors the
 * rail on that face and turns the projecting banner a quarter-turn into the covered walk.  Keep
 * the measured 1 cm stand-off here so retained base banners and optional heralds share one mount.
 */
const PORCH_BACK_WALL_OFFSET = 0.103;

interface PorchFrame {
  readonly bays: number;
  readonly span: number;
  readonly backZ: number;
  readonly frontZ: number;
  readonly postX: number;
  readonly windowX: number;
  /** Centre of the bay that receives the single shuttered window. */
  readonly windowBayX: number;
  readonly windowBayIndex: number;
}

function frameFor(context: StructureVariantContext): PorchFrame {
  const bays = Math.min(3, Math.max(2, Math.round(context.width / 2)));
  const span = bays * 2;
  // A two-bay porch has no geometric middle bay. Keep the window wholly in the right-hand bay;
  // on a three-bay porch this resolves to the actual middle bay.
  const windowBayIndex = Math.floor(bays / 2);
  return {
    bays,
    span,
    backZ: -context.depth / 2,
    frontZ: -context.depth / 2 + 2,
    postX: inset(span / 2 - 0.2, span / 2, 0.18),
    windowX: inset(Math.min(1.15, span * 0.23), span / 2, 0.7),
    windowBayX: (windowBayIndex + 0.5) * 2 - span / 2,
    windowBayIndex,
  };
}

function bayCentre(frame: PorchFrame, index: number): number {
  return (index + 0.5) * 2 - frame.span / 2;
}

/** Resolve a facade detail's X coordinate to the exact two-metre bay it belongs to. */
function bayIndexAt(frame: PorchFrame, x: number): number {
  return Math.max(0, Math.min(frame.bays - 1, Math.floor((x + frame.span / 2) / 2)));
}

function pairedWindowBays(frame: PorchFrame): readonly number[] {
  return [...new Set([-frame.windowX, frame.windowX].map((x) => bayIndexAt(frame, x)))].sort(
    (left, right) => left - right,
  );
}

function omit(base: readonly PartPlacement[], ...tags: readonly string[]): PartPlacement[] {
  const removed = new Set(tags);
  return base.filter((part) => !removed.has(part.tag));
}

function movePart(
  base: readonly PartPlacement[],
  tag: string,
  at: Partial<Pick<PartPlacement, "dx" | "dy" | "dz" | "rotationY" | "scale">>,
): PartPlacement[] {
  return base.map((part) => part.tag === tag ? { ...part, ...at } : part);
}

function backWallBanner(
  frame: PorchFrame,
  tag: string,
  assetId: BannerAssetId,
  dx: number,
  dy: number,
  scale: number,
): PartPlacement {
  return wallMountedBanner(
    tag,
    assetId,
    { dx, dy, dz: frame.backZ + PORCH_BACK_WALL_OFFSET },
    0,
    scale,
  );
}

function bannerAssetForKit(context: StructureVariantContext): BannerAssetId {
  // Keep the porch's heraldry aligned with the regional gate treatment: timber uses its blue
  // pennant, while plaster and stone use the red standard. A paired treatment always reuses this
  // one choice for both rails.
  return context.kitId === "timber" ? "banner_2" : "banner_1";
}

/** Re-seat any retained base banner after a recipe remaps its asset, keeping the rail contract. */
function remountBaseBanner(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  assetOverride?: BannerAssetId,
): PartPlacement[] {
  const frame = frameFor(context);
  return base.map((part) => {
    if (part.tag !== "banner") return part;
    const assetId = assetOverride
      ?? (part.assetId === "banner_2" ? "banner_2" : "banner_1");
    return backWallBanner(frame, part.tag, assetId, part.dx, part.dy, part.scale);
  });
}

function frontBraces(frame: PorchFrame, prefix = "brace"): readonly PartPlacement[] {
  return [-1, 1].map((side, index) => variantPart(
    `${prefix}_${index}`,
    "support_beam",
    frame.postX * side,
    1.62,
    frame.frontZ - 0.55,
    Math.PI,
    0.48,
  ));
}

function rearBraces(frame: PorchFrame): readonly PartPlacement[] {
  return [-1, 1].map((side, index) => variantPart(
    `rear_brace_${index}`,
    "support_beam",
    frame.postX * side,
    1.62,
    frame.backZ + 0.08,
    0,
    0.48,
  ));
}

/**
 * Make the shuttered bay a real opening in the exact base bay it occupies.
 *
 * Plaster and timber use `overhang_plaster`, whose single mesh combines the roof and a solid wall.
 * There is no way to cut only its wall portion from this recipe, so the selected `o` tag becomes
 * the kit's apertured wall and its old trim tag carries the available slab canopy. The slab is
 * lowered so its top aligns with the neighbouring plaster canopy. Stone already has separate wall,
 * trim and canopy tags, so only its selected wall tag changes and the original canopy is untouched.
 */
function convertWindowBays(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  frame: PorchFrame,
  selectedBayIndices: readonly number[],
): PartPlacement[] {
  const selected = new Set(selectedBayIndices);
  return base.map((part) => {
    const match = /^b(\d+)_(w|o|t)$/.exec(part.tag);
    if (match === null || !selected.has(Number(match[1]))) return part;

    if ((match[2] === "w" && part.assetId === context.kit.wall)
      || (match[2] === "o" && part.assetId === "overhang_plaster")) {
      return { ...part, assetId: context.kit.wallWindow };
    }

    if (match[2] === "t" && part.assetId === "wall_bottom_trim" && context.kitId !== "stone") {
      // overhang_brick's top is 0.058 m below its pivot. 3.086 puts that top at 3.028 m,
      // matching overhang_plaster while retaining the original bay's two-metre canopy reach.
      return {
        ...part,
        assetId: "overhang_brick",
        dy: 3.086,
        dz: frame.backZ + 1,
      };
    }

    return part;
  });
}

function shutteredBayBase(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  frame: PorchFrame,
): PartPlacement[] {
  return convertWindowBays(context, base, frame, [frame.windowBayIndex]);
}

function shutteredBayWindows(frame: PorchFrame): readonly PartPlacement[] {
  return [
    // Keep the glass/frame explicit so catalog invariant repair never has to synthesize a backing.
    variantPart(
      "centre_window",
      "window_wide",
      frame.windowBayX,
      0,
      frame.backZ + 0.035,
      0,
      0.82,
    ),
    variantPart(
      "centre_shutters",
      "window_shutters",
      frame.windowBayX,
      0,
      frame.backZ + 0.045,
      0,
      0.82,
    ),
  ];
}

export const PORCH_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "porch:braced-lantern",
    label: "Braced lantern porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 2,
    build: (context, base) => {
      const frame = frameFor(context);
      const bannered = remountBaseBanner(context, base, "banner_2");
      const lit = movePart(bannered, "lamp", { dx: 0, dz: frame.backZ + 0.35, scale: 1.1 });
      return withDetails(lit, ...frontBraces(frame));
    },
  },
  {
    id: "porch:shuttered-bay",
    label: "Shuttered bay porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 3,
    build: (context, base) => {
      const frame = frameFor(context);
      const converted = remountBaseBanner(context, shutteredBayBase(context, base, frame));
      const lit = movePart(converted, "lamp", { dx: -frame.windowX - 0.55, dz: frame.backZ + 0.38 });
      return withDetails(
        lit,
        ...shutteredBayWindows(frame),
      );
    },
  },
  {
    id: "porch:paired-windows",
    label: "Paired-window porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 2,
    build: (context, base) => {
      const frame = frameFor(context);
      const plain = omit(base, "banner");
      const windowBays = pairedWindowBays(frame);
      const windowXs = windowBays.map((index) => bayCentre(frame, index));
      const converted = convertWindowBays(context, plain, frame, windowBays);
      return withDetails(
        movePart(converted, "lamp", { dx: 0, dz: frame.backZ + 0.4, scale: 1.05 }),
        variantPart("window_l", "window_thin", windowXs[0]!, 0, frame.backZ + 0.035, 0, 0.9),
        variantPart("window_r", "window_thin", windowXs[1]!, 0, frame.backZ + 0.035, 0, 0.9),
      );
    },
  },
  {
    id: "porch:heralded",
    label: "Heralded porch",
    family: "open_air",
    prefab: "porch",
    // A matched pair reads as civic heraldry, so keep it off cookhouses and ordinary shop porches.
    fits: (context) => context.width >= 8,
    detailBudget: 4,
    build: (context, base) => {
      const frame = frameFor(context);
      const heraldAsset = bannerAssetForKit(context);
      const unbannered = omit(base, "banner");
      const lit = movePart(unbannered, "lamp", { dx: 0, dz: frame.backZ + 0.42, scale: 1.08 });
      return withDetails(
        lit,
        // The rail is the wall anchor. Both standards project into the +Z covered walk, so neither
        // uses the old cloth-width compensation that placed a banner span along the facade.
        backWallBanner(frame, "v_banner_l", heraldAsset, -frame.postX, 2.42, 0.9),
        backWallBanner(frame, "v_banner_r", heraldAsset, frame.postX, 2.42, 0.9),
        ...frontBraces(frame, "herald_brace"),
      );
    },
  },
  {
    id: "porch:watch-window",
    label: "Watch-window porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 4,
    build: (context, base) => {
      const frame = frameFor(context);
      const plain = omit(base, "banner");
      const converted = convertWindowBays(context, plain, frame, [frame.windowBayIndex]);
      const lit = movePart(converted, "lamp", { dx: -frame.postX + 0.55, dz: frame.backZ + 0.38 });
      return withDetails(
        lit,
        variantPart(
          "watch_glass",
          "window_thin",
          frame.windowBayX,
          0,
          frame.backZ + 0.035,
          0,
          0.94,
        ),
        variantPart(
          "watch_shutters",
          "window_shutters",
          frame.windowBayX,
          0,
          frame.backZ + 0.055,
          0,
          0.82,
        ),
        ...rearBraces(frame),
      );
    },
  },
  {
    id: "porch:austere",
    label: "Austere porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 0,
    build: (_context, base) => omit(base, "lamp", "banner"),
  },
];
