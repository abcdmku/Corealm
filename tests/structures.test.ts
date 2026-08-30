import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUILDING_KITS,
  COMPOSITION_IDS,
  KIT_IDS,
  PREFAB_IDS,
  buildComposition,
  buildPrefab,
  buildWallRun,
  compositionPartAssetIds,
  prefabCollision,
  prefabPartAssetIds,
  wallRunCollision,
  type PartPlacement,
} from "../game/src/render/buildings.js";
import {
  STRUCTURE_VARIANTS,
  selectedStructureVariantId,
  structureVariantCount,
} from "../game/src/render/structures/catalog.js";

interface ManifestRow { id: string }

const manifest = JSON.parse(
  readFileSync(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8"),
) as { assets: ManifestRow[] };
const manifestIds = new Set(manifest.assets.map((asset) => asset.id));

// These footprints exercise the odd/even, compact, gate, forge, arcade, porch, market and well
// branches. Sequential seeds then enumerate every recipe compatible with each probe.
const FOOTPRINTS = [
  [6, 4], [6, 6], [12, 6], [5, 4], [4, 4], [8, 1], [3, 2], [8, 3],
  [8, 4], [6, 3], [6, 5], [4, 3], [9, 3], [2, 2], [10, 4], [16, 3],
] as const;

function placementProblems(owner: string, parts: readonly PartPlacement[]): string[] {
  const problems: string[] = [];
  const tags = new Set<string>();
  if (parts.length === 0) problems.push(`${owner}: emitted no parts`);
  for (const part of parts) {
    if (tags.has(part.tag)) problems.push(`${owner}: duplicate tag ${part.tag}`);
    tags.add(part.tag);
    if (!manifestIds.has(part.assetId)) problems.push(`${owner}: missing manifest asset ${part.assetId}`);
    if (![part.dx, part.dy, part.dz, part.rotationY, part.scale].every(Number.isFinite) || part.scale <= 0) {
      problems.push(`${owner}: invalid transform for ${part.tag}`);
    }
    if (part.scaleAxes?.some((axis) => !Number.isFinite(axis) || axis <= 0)) {
      problems.push(`${owner}: invalid axis scale for ${part.tag}`);
    }
  }
  return problems;
}

function collisionProblems(owner: string, boxes: readonly {
  tag: string; dx: number; dz: number; sizeX: number; sizeZ: number; height: number;
}[]): string[] {
  return boxes.flatMap((box) => (
    [box.dx, box.dz, box.sizeX, box.sizeZ, box.height].every(Number.isFinite)
      && box.sizeX > 0 && box.sizeZ > 0 && box.height > 0
      ? []
      : [`${owner}: invalid collision box ${box.tag}`]
  ));
}

describe("isolated structure constructors", () => {
  it("builds every registered prefab recipe with valid assets and collision", () => {
    const visited = new Set<string>();
    const problems: string[] = [];

    for (const prefab of PREFAB_IDS) {
      for (const footprint of FOOTPRINTS) {
        problems.push(...collisionProblems(
          `${prefab}[${footprint.join("x")}]`,
          prefabCollision(prefab, footprint),
        ));
        for (const kitId of KIT_IDS) {
          const kit = BUILDING_KITS[kitId];
          const count = structureVariantCount(prefab, footprint, kit);
          const seeds = count === 0 ? [0] : Array.from({ length: count }, (_, index) => index);
          for (const seed of seeds) {
            const variant = selectedStructureVariantId(prefab, footprint, seed, kit);
            if (variant) visited.add(variant);
            problems.push(...placementProblems(
              `${prefab}[${footprint.join("x")}] kit=${kitId} seed=${seed}`,
              buildPrefab(prefab, footprint, seed, kitId),
            ));
          }
        }
      }
    }

    expect(problems).toEqual([]);
    expect([...visited].sort()).toEqual(STRUCTURE_VARIANTS.map((variant) => variant.id).sort());
  });

  it("builds every composition and wall-run branch without loading the game", () => {
    const problems: string[] = [];
    for (const id of COMPOSITION_IDS) {
      for (const kit of KIT_IDS) {
        for (const seed of [0, 1, 7, 29, 977]) {
          problems.push(...placementProblems(
            `composition=${id} kit=${kit} seed=${seed}`,
            buildComposition(id, seed, kit),
          ));
        }
      }
    }

    const runs = [
      { length: 52, openings: [] },
      { length: 52, openings: [{ at: 26, width: 8 }] },
      { length: 34, openings: [{ at: 8, width: 4 }, { at: 26, width: 6 }] },
      { length: 6, openings: [{ at: 3, width: 8 }] },
    ] as const;
    for (const kitId of KIT_IDS) {
      const kit = BUILDING_KITS[kitId];
      for (const run of runs) {
        problems.push(...collisionProblems(
          `wall length=${run.length} kit=${kitId}`,
          wallRunCollision(run.length, run.openings),
        ));
        for (const seed of [0, 1, 2, 7, 29, 977]) {
          problems.push(...placementProblems(
            `wall length=${run.length} kit=${kitId} seed=${seed}`,
            buildWallRun(run.length, run.openings, kit, seed),
          ));
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps every declared structure asset in the real manifest", () => {
    const missing = [...prefabPartAssetIds(), ...compositionPartAssetIds()]
      .filter((assetId) => !manifestIds.has(assetId));
    expect(missing).toEqual([]);
  });
});
