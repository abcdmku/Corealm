import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  WorldScene,
  type GroundStamps,
  type WorldTerrainSpec,
} from "../game/src/render/scene.js";
import { prepareWorldSurface } from "../game/src/app/worldSurface.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";

const SMALL_WORLD: WorldTerrainSpec = {
  bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
  chunkSize: 8,
  metresPerQuad: 2,
  blendMetres: 2,
  regions: [{
    regionId: "fallowmarch",
    rect: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
    seed: 0x51_7f_ac,
    character: "plains",
    baseHeight: 3,
    amplitude: 9,
  }],
};

const STAMPS: GroundStamps = {
  seed: 1337,
  roads: [{
    points: [[-3, 0, -2], [0, 0, 1], [3, 0, 2]],
    width: 3.2,
  }],
  paving: [{
    centre: [0, 0],
    halfExtents: [1.5, 1],
    rotationY: 0.25,
    surface: "stone",
    kerb: true,
  }],
  water: [],
};

function buildPreparedScene(): WorldScene {
  const scene = new WorldScene(new THREE.Scene());
  scene.buildWorld(SMALL_WORLD, (prepared) => {
    expect(prepared).toBe(scene);
    expect(prepared.getWalkableMeshes()).toHaveLength(0);
    prepared.setGroundStamps(STAMPS);
  });
  return scene;
}

describe("prepared world startup", () => {
  it("solves the authored roads and water before the first terrain pass", () => {
    const scene = new WorldScene(new THREE.Scene());
    let summary: ReturnType<typeof prepareWorldSurface> | undefined;

    scene.buildWorld(buildWorldTerrainSpec(), (prepared) => {
      summary = prepareWorldSurface(prepared, 1337);
      expect(prepared.getWalkableMeshes()).toHaveLength(0);
    });

    expect(summary).toEqual({ roadCount: 45, pavingCount: 18, waterCount: 4 });
    expect(scene.getRoadPolylines()).toHaveLength(summary!.roadCount);
    expect(scene.getWaterBodies()).toHaveLength(summary!.waterCount);
    expect(scene.getWaterBodies().every((water) => water.closed)).toBe(true);
    expect(scene.getTerrainBuildStats()).toEqual({
      chunkBuildCount: 28,
      restampPassCount: 0,
      restampedVertexCount: 0,
    });

    const heightSamples = [
      [-230, -40, 4.9014363],
      [-120, 0, 2.7265694],
      [-5, 0, 2.1418357],
      [110, 0, 4.1572809],
      [225, -100, 42.2732258],
      [-40, -60, -3.0902672],
    ] as const;
    for (const [x, z, expected] of heightSamples) {
      expect(scene.meshHeightAt(x, z)).toBeCloseTo(expected, 4);
    }

    scene.clear();
  });

  it("establishes stamps before building and shading each chunk once", () => {
    const scene = buildPreparedScene();

    expect(scene.getWalkableMeshes()).toHaveLength(1);
    expect(scene.getTerrainBuildStats()).toEqual({
      chunkBuildCount: 1,
      restampPassCount: 0,
      restampedVertexCount: 0,
    });
    expect(scene.getRoadPolylines()).not.toHaveLength(0);

    scene.clear();
  });

  it("derives the physics heightfield from the same interpolated lattice as the visible mesh", () => {
    const scene = buildPreparedScene();
    const samples = scene.heightfieldSamples(1);
    const bounds = SMALL_WORLD.bounds;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;

    for (let col = 0; col <= samples.ncols; col += 1) {
      const x = bounds.minX + (col / samples.ncols) * width;
      for (let row = 0; row <= samples.nrows; row += 1) {
        const z = bounds.minZ + (row / samples.nrows) * depth;
        const physicsHeight = samples.heights[col * (samples.nrows + 1) + row];
        expect(physicsHeight).toBeCloseTo(scene.meshHeightAt(x, z), 6);
      }
    }

    const [walkable] = scene.getWalkableMeshes();
    const positions = walkable!.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const x = walkable!.position.x + positions.getX(index);
      const z = walkable!.position.z + positions.getZ(index);
      expect(positions.getY(index)).toBeCloseTo(scene.meshHeightAt(x, z), 6);
    }

    scene.clear();
  });

  it("keeps the solved road lines and heightfield deterministic", () => {
    const first = buildPreparedScene();
    const second = buildPreparedScene();

    expect(second.getRoadPolylines()).toEqual(first.getRoadPolylines());
    expect([...second.heightfieldSamples(1).heights]).toEqual([...first.heightfieldSamples(1).heights]);

    first.clear();
    second.clear();
  });

  it("retains measurable late-stamp compatibility without using it on the prepared path", () => {
    const scene = new WorldScene(new THREE.Scene());
    scene.buildWorld(SMALL_WORLD);
    const before = scene.getTerrainBuildStats();

    scene.setGroundStamps(STAMPS);
    const after = scene.getTerrainBuildStats();

    expect(before.restampPassCount).toBe(0);
    expect(after.restampPassCount).toBe(1);
    expect(after.restampedVertexCount).toBeGreaterThan(0);
    expect(after.chunkBuildCount).toBe(before.chunkBuildCount);

    scene.clear();
  });
});
