import type { PartPlacement } from "../buildings.js";

function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Create an optional recipe part. The prefix separates additions from stable base-prefab tags. */
export function variantPart(
  tag: string,
  assetId: string,
  dx: number,
  dy: number,
  dz: number,
  rotationY = 0,
  scale = 1,
): PartPlacement {
  return {
    tag: tag.startsWith("v_") ? tag : `v_${tag}`,
    assetId,
    dx: r3(dx),
    dy: r3(dy),
    dz: r3(dz),
    rotationY: r4(rotationY),
    scale: r4(scale),
  };
}

/** Append optional details without mutating the base generator's stable output. */
export function withDetails(
  base: readonly PartPlacement[],
  ...details: readonly PartPlacement[]
): PartPlacement[] {
  return [...base, ...details];
}

/** Replace asset choices while preserving placement and entity tags. */
export function mapAssets(
  base: readonly PartPlacement[],
  select: (part: PartPlacement) => string | undefined,
): PartPlacement[] {
  return base.map((part) => {
    const assetId = select(part);
    return assetId === undefined || assetId === part.assetId ? part : { ...part, assetId };
  });
}

/** Keep a detail inside the structure's current rectangular envelope. */
export function inset(value: number, halfExtent: number, margin = 0.25): number {
  const limit = Math.max(0, halfExtent - margin);
  return Math.max(-limit, Math.min(limit, value));
}
