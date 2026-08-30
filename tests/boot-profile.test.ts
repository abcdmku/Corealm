import { describe, expect, it } from "vitest";
import {
  FEATURE_LAB_BOOT_PROFILE,
  GAME_BOOT_PROFILE,
  bootProfileFor,
} from "../game/src/app/bootProfile.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";

describe("boot profiles", () => {
  it("keeps the game profile on the canonical production builders", () => {
    expect(GAME_BOOT_PROFILE.kind).toBe("game");
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

  it("builds one cheap, flat Fallowmarch terrain chunk for the feature lab", () => {
    const terrain = FEATURE_LAB_BOOT_PROFILE.terrain();

    expect(terrain.bounds).toEqual({ minX: -32, maxX: 32, minZ: -24, maxZ: 24 });
    expect(terrain.chunkSize).toBe(64);
    expect(terrain.metresPerQuad).toBe(2);
    expect(terrain.regions).toEqual([{
      regionId: "fallowmarch",
      rect: terrain.bounds,
      seed: 0,
      character: "plains",
      baseHeight: 0,
      amplitude: 0,
    }]);
    expect(FEATURE_LAB_BOOT_PROFILE.spawn).toEqual({
      regionId: "fallowmarch",
      x: 0,
      z: 0,
      facingRad: 0,
    });
    expect(FEATURE_LAB_BOOT_PROFILE).toMatchObject({
      persistent: false,
      worldSurface: false,
      dungeon: false,
      scatter: false,
      validateWorldRefs: false,
      fullWarmup: false,
    });
  });

  it("returns a fresh, completely empty semantic world", () => {
    const heightAt = () => 0;
    const first = FEATURE_LAB_BOOT_PROFILE.buildSemanticWorld(1, heightAt);
    const second = FEATURE_LAB_BOOT_PROFILE.buildSemanticWorld(1, heightAt);

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

  it("selects the real-engine lab only for the actors route", () => {
    expect(bootProfileFor("?mode=actors")).toBe(FEATURE_LAB_BOOT_PROFILE);
    expect(bootProfileFor(new URLSearchParams("mode=actors"))).toBe(FEATURE_LAB_BOOT_PROFILE);
    expect(bootProfileFor({ search: "?mode=structures" })).toBe(GAME_BOOT_PROFILE);
    expect(bootProfileFor("")).toBe(GAME_BOOT_PROFILE);
  });
});
