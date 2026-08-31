import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { buildStructureNavigationSources } from "../game/src/render/structureNavigation.js";

function altarRuins(): SemanticEntity {
  return {
    id: "test_ruins",
    archetype: "landmark",
    name: "Test Altar Ruins",
    tier: 1,
    regionId: "fallowmarch",
    position: [10, 2, -4],
    state: "dormant",
    interactions: ["inspect"],
    view: { assetId: "altar_ruins_site", scale: 2, rotationY: Math.PI / 2 },
    meta: { essenceAltarRuins: true },
  };
}

describe("imported structure navigation", () => {
  it("uses exact ruin architecture while leaving step-over rubble out", async () => {
    const source = new THREE.Group();
    for (const name of ["Platform_circle_09", "Wall_round_1_57", "Rubble_1_10"]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      mesh.name = name;
      source.add(mesh);
    }
    const assets = {
      load: async () => source,
      instance: () => source.clone(true),
    };

    const result = await buildStructureNavigationSources(assets, [altarRuins()]);

    expect(result.roots).toHaveLength(1);
    expect(result.meshes.map((mesh) => mesh.name)).toEqual([
      "Platform_circle_09",
      "Wall_round_1_57",
    ]);
    expect(result.roots[0]!.position.toArray()).toEqual([10, 2, -4]);
    expect(result.roots[0]!.scale.toArray()).toEqual([2, 2, 2]);
    expect(result.meshes.every((mesh) => mesh.userData["structureNavigation"] === "test_ruins")).toBe(true);
  });

  it("does not load imported geometry when no altar ruin is present", async () => {
    let loaded = false;
    const result = await buildStructureNavigationSources({
      load: async () => {
        loaded = true;
        return new THREE.Group();
      },
      instance: () => new THREE.Group(),
    }, []);

    expect(loaded).toBe(false);
    expect(result).toEqual({ roots: [], meshes: [] });
  });
});
