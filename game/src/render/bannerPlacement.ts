import type { PartPlacement } from "./buildings.js";

export type BannerAssetId = "banner_1" | "banner_2";

export interface BannerWallAnchor {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
}

function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Place one of the kit's projecting wall banners against an explicitly authored facade anchor.
 *
 * Both banner meshes have their mounting rail at local X = 0, with the bracket and cloth extending
 * along local +X. The asset must therefore turn a quarter turn from the facade so local +X follows
 * the wall's outward normal. Drawing it at `outwardYaw` makes it lie flat on the wall and leaves the
 * mounting rail unsupported, which was the repeated town-banner bug this helper exists to prevent.
 */
export function wallMountedBanner(
  tag: string,
  assetId: BannerAssetId,
  anchor: BannerWallAnchor,
  outwardYaw: number,
  scale = 1,
): PartPlacement {
  return {
    tag,
    assetId,
    dx: r3(anchor.dx),
    dy: r3(anchor.dy),
    dz: r3(anchor.dz),
    rotationY: r4(outwardYaw - Math.PI / 2),
    scale: r4(scale),
  };
}
