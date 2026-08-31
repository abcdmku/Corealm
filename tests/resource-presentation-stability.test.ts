import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REGIONS, type ResourceClusterDef } from "../game/src/content/regions.js";
import { variantSeed } from "../game/src/render/buildings.js";
import { buildWorld, type BuiltWorld } from "../game/src/world/regionBuilder.js";

const SEED = 12_345;
const FLAT_GROUND = (): number => 0;

function resourceEntities(world: BuiltWorld) {
  return world.entities.filter((entity) => entity.resource || entity.archetype === "farm_plot");
}

function expectedRotation(entityId: string): number {
  const unit = variantSeed(`${entityId}:rotation`) / 0x1_0000_0000;
  return Math.round(unit * Math.PI * 2 * 100) / 100;
}

function rotations(world: BuiltWorld, ids: ReadonlySet<string>): Map<string, number | undefined> {
  return new Map(resourceEntities(world)
    .filter((entity) => ids.has(entity.id))
    .map((entity) => [entity.id, entity.view?.rotationY]));
}

function placementAndYieldFingerprint(world: BuiltWorld): string {
  const rows = resourceEntities(world).map((entity) => ({
    id: entity.id,
    position: entity.position,
    maxYields: entity.resource?.maxYields ?? null,
  }));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

describe("resource presentation stability", () => {
  it("derives gathering and farm-plot rotation from stable node ids", () => {
    const baseline = buildWorld(SEED, FLAT_GROUND);
    const baselineEntities = resourceEntities(baseline);
    const baselineIds = new Set(baselineEntities.map((entity) => entity.id));

    expect(baselineEntities.some((entity) => entity.resource)).toBe(true);
    expect(baselineEntities.some((entity) => entity.archetype === "farm_plot")).toBe(true);
    for (const entity of baselineEntities) {
      expect(entity.view?.rotationY, entity.id).toBe(expectedRotation(entity.id));
    }

    const region = REGIONS.find((candidate) => candidate.id === "fallowmarch");
    expect(region).toBeDefined();
    const originalClusters = [...region!.clusters];
    const source = originalClusters[0]!;
    const extra = (id: string, centre: readonly [number, number]): ResourceClusterDef => ({
      ...source,
      id,
      centre,
      count: 1,
      radius: 1,
    });

    try {
      region!.clusters.splice(
        0,
        region!.clusters.length,
        extra("test_resource_prefix", [-210, 110]),
        ...originalClusters,
        extra("test_resource_suffix", [-205, 105]),
      );
      const withSurroundingClusters = buildWorld(SEED, FLAT_GROUND);

      expect(rotations(withSurroundingClusters, baselineIds)).toEqual(rotations(baseline, baselineIds));
      expect(resourceEntities(withSurroundingClusters)
        .filter((entity) => baselineIds.has(entity.id))
        .map((entity) => entity.position))
        .not.toEqual(baselineEntities.map((entity) => entity.position));
    } finally {
      region!.clusters.splice(0, region!.clusters.length, ...originalClusters);
    }
  });

  it("keeps the authored placement and yield stream aligned", () => {
    expect(placementAndYieldFingerprint(buildWorld(SEED, FLAT_GROUND))).toBe(
      "ebbb4c93951598bef734027c52b687f760c72214ed65ec26926abbc1f1eedc78",
    );
  });
});
