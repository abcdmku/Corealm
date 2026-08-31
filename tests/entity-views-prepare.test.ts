import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { SemanticEntity } from "../game/src/contracts.js";
import type { AssetRegistry } from "../game/src/render/assets.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import type { MaterialLibrary } from "../game/src/render/materials.js";

function entity(id: string, assetId: string): SemanticEntity {
  return {
    id,
    archetype: "ore",
    name: id,
    tier: 1,
    regionId: "fallowmarch",
    position: [0, 0, 0],
    state: "available",
    interactions: [],
    view: { assetId },
  };
}

describe("EntityViews.prepare", () => {
  it("does not report an earlier missing asset for a later valid batch", async () => {
    const available = new Set(["valid-asset"]);
    const load = vi.fn(async (id: string) => {
      if (!available.has(id)) throw new Error(`Missing ${id}`);
      return new THREE.Group();
    });
    const assets = {
      entry: (id: string) => available.has(id) ? { id } : undefined,
      isLoaded: () => false,
      load,
    } as unknown as AssetRegistry;
    const views = new EntityViews(
      { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() },
      assets,
      {} as MaterialLibrary,
    );

    const missingBatch = await views.prepare([entity("broken", "missing-asset")]);
    const validBatch = await views.prepare([entity("valid", "valid-asset")]);

    expect(missingBatch).toEqual({ loaded: 0, missing: ["missing-asset"] });
    expect(validBatch).toEqual({ loaded: 1, missing: [] });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("valid-asset", {
      priority: "visible-spawn",
      primary: true,
    });
  });
});
