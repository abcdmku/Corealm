import { describe, expect, it } from "vitest";
import {
  BUILDING_LAB_BOOT_PROFILE,
  COMBAT_LAB_BOOT_PROFILE,
  FEATURE_LAB_BOOT_PROFILE,
  GAME_BOOT_PROFILE,
  bootProfileFor,
} from "../game/src/app/bootProfile.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";

describe("boot profiles", () => {
  it("keeps the game profile on the canonical production builders", () => {
    expect(GAME_BOOT_PROFILE.kind).toBe("game");
    expect(GAME_BOOT_PROFILE.labMode).toBeNull();
    expect(GAME_BOOT_PROFILE.terrain).toBe(buildWorldTerrainSpec);
    expect(GAME_BOOT_PROFILE.buildSemanticWorld).toBe(buildWorld);
    expect(GAME_BOOT_PROFILE.spawn.regionId).toBe("fallowmarch");
    expect(GAME_BOOT_PROFILE).toMatchObject({
      persistent: true,
      worldSurface: true,
      dungeon: true,
      scatter: true,
      validateWorldRefs: true,
      fullWarmup: true,
    });
  });

  it("shares one production Fallowmarch yard across both workbenches", () => {
    const terrain = COMBAT_LAB_BOOT_PROFILE.terrain();
    const secondTerrain = BUILDING_LAB_BOOT_PROFILE.terrain();

    expect(COMBAT_LAB_BOOT_PROFILE).not.toBe(BUILDING_LAB_BOOT_PROFILE);
    expect(COMBAT_LAB_BOOT_PROFILE.terrain).toBe(BUILDING_LAB_BOOT_PROFILE.terrain);
    expect(COMBAT_LAB_BOOT_PROFILE.buildSemanticWorld)
      .toBe(BUILDING_LAB_BOOT_PROFILE.buildSemanticWorld);
    expect(FEATURE_LAB_BOOT_PROFILE).toBe(COMBAT_LAB_BOOT_PROFILE);
    expect(terrain).not.toBe(secondTerrain);
    expect(secondTerrain).toEqual(terrain);

    expect(terrain.bounds).toEqual({ minX: -128, maxX: 128, minZ: -128, maxZ: 128 });
    expect(terrain.chunkSize).toBe(64);
    expect(terrain.metresPerQuad).toBe(2);
    expect(terrain.regions).toEqual([{
      regionId: "fallowmarch",
      rect: terrain.bounds,
      seed: 0x0f411,
      character: "plains",
      baseHeight: 0,
      amplitude: 3,
    }]);
    expect(terrain.flats).toEqual([{
      x: 0,
      z: 0,
      radius: 48,
      blend: 24,
      halfExtents: [48, 48],
    }]);
    expect(COMBAT_LAB_BOOT_PROFILE.spawn).toEqual({
      regionId: "fallowmarch",
      x: 0,
      z: 0,
      facingRad: 0,
    });
    for (const [profile, mode] of [
      [COMBAT_LAB_BOOT_PROFILE, "combat"],
      [BUILDING_LAB_BOOT_PROFILE, "building"],
    ] as const) {
      expect(profile).toMatchObject({
        kind: "feature-lab",
        labMode: mode,
        persistent: false,
        worldSurface: false,
        dungeon: false,
        scatter: false,
        validateWorldRefs: false,
        fullWarmup: false,
      });
      expect(profile.spawn).toBe(COMBAT_LAB_BOOT_PROFILE.spawn);
    }
  });

  it("returns a fresh, completely empty semantic world", () => {
    const heightAt = () => 0;
    const first = COMBAT_LAB_BOOT_PROFILE.buildSemanticWorld(1, heightAt);
    const second = BUILDING_LAB_BOOT_PROFILE.buildSemanticWorld(1, heightAt);

    expect(first).toEqual({
      entities: [],
      routeNodes: [],
      routeEdges: [],
      knownLocations: [],
      buildings: [],
      solids: [],
    });
    expect(second).not.toBe(first);
    expect(second.entities).not.toBe(first.entities);
  });

  it("routes current and legacy lab URLs to their shared-yard workbench", () => {
    expect(bootProfileFor("?mode=combat")).toBe(COMBAT_LAB_BOOT_PROFILE);
    expect(bootProfileFor("?mode=actors")).toBe(COMBAT_LAB_BOOT_PROFILE);
    expect(bootProfileFor(new URLSearchParams("mode=building"))).toBe(BUILDING_LAB_BOOT_PROFILE);
    expect(bootProfileFor({ search: "?mode=structures" })).toBe(BUILDING_LAB_BOOT_PROFILE);
    expect(bootProfileFor("?mode=unknown")).toBe(GAME_BOOT_PROFILE);
    expect(bootProfileFor("")).toBe(GAME_BOOT_PROFILE);
  });
});
