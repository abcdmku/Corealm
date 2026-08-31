import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { RegionId, SemanticEntity, Vec3 } from "../game/src/contracts.js";
import type { AssetEntry } from "../game/src/render/assets.js";
import { EntityActiveSet } from "../game/src/render/entityActiveSet.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import { MaterialLibrary } from "../game/src/render/materials.js";

function entity(
  id: string,
  regionId: RegionId,
  position: Vec3,
  assetId: string | null = `${id}-asset`,
): SemanticEntity {
  return {
    id,
    archetype: "landmark",
    name: id,
    tier: 1,
    regionId,
    position,
    state: "active",
    interactions: ["inspect"],
    view: assetId ? { assetId } : undefined,
    meta: { authored: true },
  };
}

function ids(entities: readonly SemanticEntity[]): string[] {
  return entities.map((candidate) => candidate.id);
}

class FakeEntityAssets {
  private readonly entries = new Map<string, AssetEntry>();
  private readonly sources = new Map<string, THREE.Group>();
  private readonly loaded = new Set<string>();
  private readonly failFirst = new Set<string>();
  readonly attempts = new Map<string, number>();

  constructor(ids: readonly string[], failFirst: readonly string[] = []) {
    for (const id of ids) {
      this.entries.set(id, {
        id,
        file: `${id}.glb`,
        pack: "test-pack",
        category: "prop",
        is: "test-prop",
        tags: ["test"],
        bytes: 100,
        size: { x: 1, y: 1, z: 1 },
        animations: [],
        materials: [],
      });
      const source = new THREE.Group();
      source.add(new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ name: `material:${id}` }),
      ));
      this.sources.set(id, source);
    }
    for (const id of failFirst) this.failFirst.add(id);
  }

  entry(id: string): AssetEntry | undefined {
    return this.entries.get(id);
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  async load(id: string): Promise<THREE.Group> {
    const attempt = (this.attempts.get(id) ?? 0) + 1;
    this.attempts.set(id, attempt);
    if (this.failFirst.has(id) && attempt === 1) throw new Error(`temporary failure: ${id}`);
    const source = this.sources.get(id);
    if (!source) throw new Error(`Unknown test asset: ${id}`);
    this.loaded.add(id);
    return source;
  }

  instance(id: string): THREE.Group {
    const source = this.sources.get(id);
    if (!source || !this.loaded.has(id)) throw new Error(`Asset not loaded: ${id}`);
    return source.clone(true);
  }

  clip(): undefined {
    return undefined;
  }

  clipOf(): undefined {
    return undefined;
  }

  dispose(): void {
    for (const source of this.sources.values()) {
      source.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) material.dispose();
      });
    }
  }
}

function entityViews(assets: FakeEntityAssets): {
  views: EntityViews;
  materials: MaterialLibrary;
} {
  const scene = {
    entityGroup: new THREE.Group(),
    overlayGroup: new THREE.Group(),
  };
  const materials = new MaterialLibrary();
  return {
    views: new EntityViews(scene as never, assets as never, materials),
    materials,
  };
}

describe("EntityActiveSet", () => {
  it("selects visual rows by space across semantic borders without mutating the store snapshot", () => {
    const semantic = [
      entity("cold-far", "karrowmoor", [210, 0, 0]),
      entity("seam-east", "vellenwood", [8, 0, 0]),
      entity("semantic-only", "fallowmarch", [0, 0, 0], null),
      entity("seam-west", "fallowmarch", [-7, 0, 0]),
    ];
    const before = structuredClone(semantic);
    const active = new EntityActiveSet({ cellSize: 16, radius: 20 });

    active.replace(semantic);
    active.setArea([0, 0, 0], 20);

    expect(ids(active.selected())).toEqual(["seam-east", "seam-west"]);
    expect(active.stats()).toMatchObject({ tracked: 4, eligible: 3, selected: 2 });
    expect(active.selected()[0]).toBe(semantic[1]);
    expect(semantic).toEqual(before);
  });

  it("is load-order independent and swaps the visual selection on cold-region travel", () => {
    const semantic = [
      entity("warm-b", "fallowmarch", [5, 0, 1]),
      entity("cold-b", "karrowmoor", [205, 0, -2]),
      entity("warm-a", "fallowmarch", [-4, 0, 0]),
      entity("cold-a", "karrowmoor", [197, 0, 3]),
    ];
    const forward = new EntityActiveSet({ cellSize: 24 });
    const reverse = new EntityActiveSet({ cellSize: 24 });
    forward.replace(semantic);
    reverse.replace([...semantic].reverse());

    forward.setArea([0, 0, 0], 18);
    reverse.setArea([0, 0, 0], 18);
    expect(ids(forward.selected())).toEqual(["warm-a", "warm-b"]);
    expect(ids(reverse.selected())).toEqual(ids(forward.selected()));

    forward.setPosition([200, 0, 0]);
    reverse.setPosition([200, 0, 0]);
    expect(ids(forward.selected())).toEqual(["cold-a", "cold-b"]);
    expect(ids(reverse.selected())).toEqual(ids(forward.selected()));
    expect(ids(forward.forRegion("fallowmarch"))).toEqual(["warm-a", "warm-b"]);
    expect(ids(forward.forRegion("karrowmoor"))).toEqual(["cold-a", "cold-b"]);
  });

  it("supports full-island residency and a pinned capture subject", () => {
    const active = new EntityActiveSet({ radius: 5 });
    active.replace([
      entity("near", "fallowmarch", [0, 0, 0]),
      entity("far", "gravelmaw", [400, 0, 400]),
    ]);
    active.setArea([0, 0, 0], 5);
    expect(ids(active.selected())).toEqual(["near"]);

    active.pin("far");
    expect(ids(active.selected())).toEqual(["far", "near"]);

    active.pin(null);
    active.setFullResidency(true);
    expect(ids(active.selected())).toEqual(["far", "near"]);
    expect(active.stats()).toMatchObject({ selected: 2, fullResidency: true });
  });

  it("keeps static structures in a wider ring without retaining distant actors", () => {
    const nearActor = { ...entity("near-actor", "fallowmarch", [10, 0, 0]), archetype: "npc" as const };
    const farActor = { ...entity("far-actor", "fallowmarch", [90, 0, 0]), archetype: "npc" as const };
    const farStructure = entity("far-structure", "fallowmarch", [90, 0, 0]);
    const outsideStructure = entity("outside-structure", "fallowmarch", [130, 0, 0]);
    const active = new EntityActiveSet({ cellSize: 16 });

    active.replace([outsideStructure, farActor, nearActor, farStructure]);
    active.setArea([0, 0, 0], 20, 110);

    expect(ids(active.selected())).toEqual(["far-structure", "near-actor"]);
    expect(active.stats()).toMatchObject({
      radius: 20,
      structureRadius: 110,
      selected: 2,
    });

    active.setDynamicRadius(100);
    expect(ids(active.selected())).toEqual(["far-actor", "far-structure", "near-actor"]);

    active.setStructureRadius(70);
    expect(ids(active.selected())).toEqual(["far-actor", "near-actor"]);
  });
});

describe("EntityViews streaming", () => {
  it("hydrates structures through their draw-distance ring while actors use the smaller radius", async () => {
    const structure = entity("structure", "fallowmarch", [100, 0, 0], "structure-asset");
    const actor = {
      ...entity("actor", "fallowmarch", [100, 0, 0], "actor-asset"),
      archetype: "npc" as const,
    };
    const assets = new FakeEntityAssets(["structure-asset", "actor-asset"]);
    const { views, materials } = entityViews(assets);

    await views.prepare([structure, actor]);
    views.updateActiveArea([0, 0, 0], 30, 120);
    views.sync([structure, actor]);

    expect(views.residencyStats()).toMatchObject({
      radius: 30,
      structureRadius: 120,
      selected: 1,
      resident: 1,
      residentIds: ["structure"],
    });

    views.updateActivePosition([75, 0, 0]);
    expect(views.residencyStats()).toMatchObject({
      selected: 2,
      resident: 2,
      residentIds: ["actor", "structure"],
    });

    views.dispose();
    materials.dispose();
    assets.dispose();
  });

  it("preloads a cold region without creating records, then hydrates it on travel", async () => {
    const semantic = [
      entity("warm", "fallowmarch", [0, 0, 0], "warm-asset"),
      entity("cold", "karrowmoor", [220, 0, 0], "cold-asset"),
    ];
    const before = structuredClone(semantic);
    const assets = new FakeEntityAssets(["warm-asset", "cold-asset"]);
    const { views, materials } = entityViews(assets);

    views.updateActiveArea([0, 0, 0], 30);
    views.sync(semantic);
    const warm = await views.retryHydration();
    expect(warm).toMatchObject({
      tracked: 2,
      selected: 1,
      resident: 1,
      residentIds: ["warm"],
    });

    const preload = await views.preloadRegion("karrowmoor");
    expect(preload).toMatchObject({
      regionId: "karrowmoor",
      entities: 1,
      assets: 1,
      loaded: 1,
      residency: { selected: 1, resident: 1, residentIds: ["warm"] },
    });
    expect(assets.isLoaded("cold-asset")).toBe(true);

    views.updateActivePosition([220, 0, 0]);
    const cold = await views.retryHydration();
    expect(cold).toMatchObject({
      tracked: 2,
      selected: 1,
      resident: 1,
      pending: 0,
      missing: 0,
      failed: 0,
      residentIds: ["cold"],
    });
    expect(semantic).toEqual(before);

    views.dispose();
    materials.dispose();
    assets.dispose();
  });

  it("keeps a transient failure pending and replaces it with the real visual on retry", async () => {
    const assets = new FakeEntityAssets(["cold-asset"], ["cold-asset"]);
    const { views, materials } = entityViews(assets);
    const coldEntity = entity("cold", "karrowmoor", [220, 0, 0], "cold-asset");

    views.updateActiveArea([220, 0, 0], 30);
    views.sync([coldEntity]);
    const failed = await views.retryHydration();
    expect(failed).toMatchObject({
      selected: 1,
      resident: 0,
      pending: 1,
      missing: 0,
      failed: 1,
      pendingIds: ["cold"],
      failedIds: ["cold"],
      failedAssets: ["cold-asset"],
    });

    const recovered = await views.retryHydration();
    expect(recovered).toMatchObject({
      selected: 1,
      resident: 1,
      pending: 0,
      missing: 0,
      failed: 0,
      residentIds: ["cold"],
      failedAssets: [],
    });
    expect(assets.attempts.get("cold-asset")).toBe(2);

    views.dispose();
    materials.dispose();
    assets.dispose();
  });
});
