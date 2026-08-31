import { describe, expect, it } from "vitest";
import type {
  FeatureLabStructureKit,
  FeatureLabStructureSelection,
  Vec3,
} from "../game/src/contracts.js";
import {
  DEFAULT_FEATURE_LAB_STRUCTURE_SELECTION,
  assembleFeatureLabStructure,
  sanitizeFeatureLabStructureSelection,
  type FeatureLabStructureAssembly,
} from "../game/src/featureLab/structures.js";
import {
  BUILDING_KITS,
  STOREY_METRES,
  buildComposition,
  buildPrefab,
  buildWallRun,
  prefabCollision,
  wallRunCollision,
  type PartPlacement,
} from "../game/src/render/buildings.js";
import {
  structureCollisionFromAsset,
  structureCollisionFromCompositionParts,
} from "../game/src/world/regionBuilder.js";

const OWNER_ID = "feature-lab:structure";

describe("feature-lab structure selection", () => {
  it("uses a frozen production-friendly cottage default", () => {
    expect(DEFAULT_FEATURE_LAB_STRUCTURE_SELECTION).toEqual({
      kind: "prefab",
      id: "cottage",
      kit: "plaster",
      width: 6,
      depth: 4,
      seed: 0,
    });
    expect(Object.isFrozen(DEFAULT_FEATURE_LAB_STRUCTURE_SELECTION)).toBe(true);

    const absent = sanitizeFeatureLabStructureSelection(undefined);
    expect(absent).toEqual(DEFAULT_FEATURE_LAB_STRUCTURE_SELECTION);
    expect(absent).not.toBe(DEFAULT_FEATURE_LAB_STRUCTURE_SELECTION);
    expect(sanitizeFeatureLabStructureSelection(null)).toEqual(absent);
  });

  it("sanitizes invalid browser data without mutating it", () => {
    const invalid = {
      kind: "not-a-kind",
      id: "missing",
      kit: "not-a-kit",
      width: Number.NaN,
      depth: Number.POSITIVE_INFINITY,
      seed: Number.NEGATIVE_INFINITY,
    } as unknown as Partial<FeatureLabStructureSelection>;
    const original = { ...invalid };

    expect(sanitizeFeatureLabStructureSelection(invalid)).toEqual({
      kind: "prefab",
      id: "cottage",
      kit: "plaster",
      width: 6,
      depth: 4,
      seed: 0,
    });
    expect(invalid).toEqual(original);
  });

  it("uses per-kind fallbacks and clamps numeric controls", () => {
    expect(sanitizeFeatureLabStructureSelection({
      kind: "prefab",
      id: "hall",
    })).toEqual({
      kind: "prefab",
      id: "hall",
      kit: "plaster",
      width: 12,
      depth: 6,
      seed: 0,
    });

    expect(sanitizeFeatureLabStructureSelection({
      kind: "composition",
      id: "missing",
      kit: "timber",
      width: 1.2,
      depth: 30.7,
      seed: 4.9,
    })).toEqual({
      kind: "composition",
      id: "region_gate",
      kit: "timber",
      width: 2,
      depth: 30,
      seed: 4,
    });

    expect(sanitizeFeatureLabStructureSelection({
      kind: "wall-run",
      id: "ignored",
      kit: "stone",
      seed: 0x1_0000_0000,
    })).toEqual({
      kind: "wall-run",
      id: "wall_run",
      kit: "stone",
      width: 18,
      depth: 4,
      seed: 0xffff_ffff,
    });
  });

  it("snaps odd and undersized wall runs to supported two-metre modules", () => {
    const cases = [
      { width: 7, depth: 7, expectedWidth: 8, expectedDepth: 4 },
      { width: 1, depth: 1, expectedWidth: 6, expectedDepth: 2 },
    ] as const;

    for (const probe of cases) {
      const selection = sanitizeFeatureLabStructureSelection({
        kind: "wall-run",
        id: "wall_run",
        kit: "plaster",
        width: probe.width,
        depth: probe.depth,
        seed: 0,
      });
      expect(selection.width).toBe(probe.expectedWidth);
      expect(selection.depth).toBe(probe.expectedDepth);
      expect(selection.width % 2).toBe(0);
      expect(selection.depth % 2).toBe(0);
      expect(selection.depth).toBeLessThanOrEqual(selection.width - 4);

      const assembly = assembleFeatureLabStructure(selection, [0, 0, 0]);
      expect(assembly.entities.some((entity) => entity.id.startsWith(`${OWNER_ID}#w`))).toBe(true);
      expect(assembly.buildings.length).toBeGreaterThan(0);
      expect(assembly.solids.length).toBeGreaterThan(0);
    }
  });
});

describe("feature-lab structure assembly", () => {
  it("builds a dormant production altar inside the imported ruins with five mineable Essence nodes", () => {
    const selection: FeatureLabStructureSelection = {
      kind: "composition",
      id: "essence_altar_ruins",
      kit: "plaster",
      width: 6,
      depth: 4,
      seed: 0,
    };
    const assembly = assembleFeatureLabStructure(selection, [0, 0, 0]);
    const altar = assembly.entities.find((entity) => entity.id === OWNER_ID);
    const ruins = assembly.entities.find((entity) => entity.view?.assetId === "altar_ruins_site");
    const nodes = assembly.entities.filter((entity) => entity.meta?.essenceCache === true);

    expect(altar).toMatchObject({
      archetype: "station",
      name: "Air Essence Altar",
      state: "dormant",
      interactions: ["inspect", "awaken"],
      station: {
        kind: "essence_altar",
        recipeIds: ["craft_air_wand", "craft_air_staff"],
      },
      view: { assetId: "altar_ruins_altar", scale: 1 },
      meta: { essenceAltar: true, essenceElement: "wind" },
    });
    expect(ruins).toMatchObject({
      state: "dormant",
      view: { assetId: "altar_ruins_site", scale: 1 },
      meta: {
        essenceAltarRuins: true,
        essenceAltarId: OWNER_ID,
        essenceElement: "wind",
      },
    });
    expect(nodes).toHaveLength(5);
    for (const node of nodes) {
      expect(node).toMatchObject({
        archetype: "ore",
        state: "available",
        interactions: ["inspect", "mine"],
        resource: { itemId: "air_essence" },
        view: { assetId: "rocks_free_essence_node" },
      });
      expect(Math.hypot(node.position[0], node.position[2])).toBeCloseTo(12, 2);
    }
  });

  it("dispatches prefabs through production parts and collision", () => {
    const selection: FeatureLabStructureSelection = {
      kind: "prefab",
      id: "gatehouse",
      kit: "stone",
      width: 8,
      depth: 4,
      seed: 3,
    };
    const origin: Vec3 = [10, 2, -5];
    const parts = buildPrefab("gatehouse", [8, 4], 3, "stone");
    const collision = prefabCollision("gatehouse", [8, 4]);
    const assembly = assembleFeatureLabStructure(selection, origin);

    expectAssemblyToUseParts(assembly, parts, origin);
    expect(assembly.buildings).toHaveLength(collision.length);
    expect(assembly.solids).toHaveLength(collision.length);
    expect(collision.length).toBeGreaterThan(0);

    for (const [index, box] of collision.entries()) {
      const building = assembly.buildings[index]!;
      const solid = assembly.solids[index]!;
      expect(building.id).toBe(`${OWNER_ID}#${box.tag}`);
      expect(building.position).toEqual([
        round2(origin[0] + box.dx),
        round2(origin[1] + box.height / 2),
        round2(origin[2] + box.dz),
      ]);
      expect(building.regionId).toBe("karrowmoor");
      expect(solid.id).toBe(building.id);
      expect(solid.position).toEqual([
        round2(origin[0] + box.dx),
        origin[1],
        round2(origin[2] + box.dz),
      ]);
    }
  });

  it("prepends the measured composition hero and uses production collision", () => {
    const selection: FeatureLabStructureSelection = {
      kind: "composition",
      id: "great_cairn",
      kit: "timber",
      width: 6,
      depth: 4,
      seed: 7,
    };
    const origin: Vec3 = [-4, 1.25, 9];
    const parts = buildComposition("great_cairn", 7, "timber");
    const measurements = {
      assetSize: () => ({ x: 2, y: 2.5, z: 1 }),
      assetCenterXZ: () => ({ x: 0.2, z: -0.1 }),
      baseY: () => -0.5,
    };
    const expectedParts = structureCollisionFromCompositionParts(
      "great_cairn",
      parts,
      { origin, rotationY: 0, ownerId: OWNER_ID },
      measurements,
    );
    const heroPosition: Vec3 = [origin[0], round2(origin[1] + 0.5 * 1.8), origin[2]];
    const expectedHero = structureCollisionFromAsset(
      OWNER_ID,
      heroPosition,
      "rock_medium_2",
      1.8,
      0,
      true,
      measurements,
    );
    const assembly = assembleFeatureLabStructure(selection, origin, measurements);

    expect(expectedHero).not.toBeNull();
    expectAssemblyToUseParts(assembly, parts, origin, {
      entityOffset: 1,
      extraAssetIds: ["rock_medium_2"],
    });
    expect(assembly.entities[0]).toMatchObject({
      id: OWNER_ID,
      archetype: "landmark",
      regionId: "vellenwood",
      position: heroPosition,
      interactions: [],
      view: {
        assetId: "rock_medium_2",
        scale: 1.8,
        rotationY: 0,
        labelHeight: 3.4,
      },
      meta: {
        scenery: true,
        featureLab: true,
        compositionHero: true,
        structureKind: "composition",
        structureId: "great_cairn",
      },
    });
    expect(assembly.buildings).toEqual([]);
    expect(assembly.solids).toEqual([expectedHero, ...expectedParts]);
    expect(assembly.solids.length).toBeGreaterThan(0);
  });

  it("dispatches a centered wall run with production openings and collision", () => {
    const selection: FeatureLabStructureSelection = {
      kind: "wall-run",
      id: "wall_run",
      kit: "plaster",
      width: 18,
      depth: 4,
      seed: 2,
    };
    const origin: Vec3 = [10, 3, -7];
    const opening = [{ at: selection.width / 2, width: selection.depth }];
    const parts = buildWallRun(selection.width, opening, BUILDING_KITS.plaster, selection.seed);
    const collision = wallRunCollision(selection.width, opening);
    const localOrigin: Vec3 = [origin[0] - selection.width / 2, origin[1], origin[2]];
    const assembly = assembleFeatureLabStructure(selection, origin);

    expectAssemblyToUseParts(assembly, parts, localOrigin);
    expect(assembly.buildings).toHaveLength(collision.length);
    expect(assembly.solids).toHaveLength(collision.length);
    expect(collision.length).toBeGreaterThan(0);

    const leftEnd = assembly.entities.find((entity) => entity.id === `${OWNER_ID}#p0`);
    const rightEnd = assembly.entities.find((entity) => entity.id === `${OWNER_ID}#p1`);
    expect(leftEnd?.position[0]).toBe(origin[0] - selection.width / 2);
    expect(rightEnd?.position[0]).toBe(origin[0] + selection.width / 2);
    expect(assembly.focus).toEqual([origin[0], round2(origin[1] + STOREY_METRES / 2), origin[2]]);

    const collisionCentre = assembly.solids.reduce((sum, solid) => sum + solid.position[0], 0)
      / assembly.solids.length;
    expect(collisionCentre).toBeCloseTo(origin[0], 8);
  });

  it("keeps entity ids stable and maps every kit to its production region palette", () => {
    const contexts: readonly [FeatureLabStructureKit, string][] = [
      ["plaster", "fallowmarch"],
      ["timber", "vellenwood"],
      ["stone", "karrowmoor"],
    ];
    const base: Omit<FeatureLabStructureSelection, "kit"> = {
      kind: "prefab",
      id: "cottage",
      width: 6,
      depth: 4,
      seed: 5,
    };

    for (const [kit, regionId] of contexts) {
      const selection = { ...base, kit };
      const first = assembleFeatureLabStructure(selection, [0, 0, 0]);
      const second = assembleFeatureLabStructure(selection, [0, 0, 0]);
      const ids = first.entities.map((entity) => entity.id);

      expect(ids).toEqual(second.entities.map((entity) => entity.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => id.startsWith(`${OWNER_ID}#`))).toBe(true);
      expect(first.entities.every((entity) => entity.regionId === regionId)).toBe(true);
      expect(first.buildings.every((building) => building.regionId === regionId)).toBe(true);
    }
  });
});

function expectAssemblyToUseParts(
  assembly: FeatureLabStructureAssembly,
  parts: readonly PartPlacement[],
  origin: Vec3,
  options: { entityOffset?: number; extraAssetIds?: readonly string[] } = {},
): void {
  const entityOffset = options.entityOffset ?? 0;
  const partEntities = assembly.entities.slice(entityOffset);
  expect(assembly.entities).toHaveLength(parts.length + entityOffset);
  expect(partEntities.map((entity) => entity.id)).toEqual(
    parts.map((part) => `${OWNER_ID}#${part.tag}`),
  );
  expect(assembly.assetIds).toEqual([...new Set([
    ...parts.map((part) => part.assetId),
    ...(options.extraAssetIds ?? []),
  ])].sort());

  for (const [index, part] of parts.entries()) {
    const entity = partEntities[index]!;
    expect(entity.archetype).toBe("landmark");
    expect(entity.interactions).toEqual([]);
    expect(entity.position).toEqual([
      round2(origin[0] + part.dx),
      round2(origin[1] + part.dy),
      round2(origin[2] + part.dz),
    ]);
    expect(entity.view).toMatchObject({
      assetId: part.assetId,
      scale: round4(part.scale),
      rotationY: round4(part.rotationY),
      labelHeight: 2,
    });
    expect(entity.view?.scaleAxes).toEqual(part.scaleAxes?.map(round4));
    expect(entity.meta).toMatchObject({
      scenery: true,
      featureLab: true,
      structureKind: assembly.selection.kind,
      structureId: assembly.selection.id,
    });
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
