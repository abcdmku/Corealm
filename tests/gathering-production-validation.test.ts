import { describe, expect, it } from "vitest";
import type { ItemDef, ItemId, StationKind } from "../game/src/contracts.js";
import type {
  GatheringProductionTierDef,
  RecipeDef,
  ResourceDef,
} from "../game/src/content/index.js";
import {
  validateGatheringProduction,
  type GatheringProductionValidationInput,
} from "../game/src/content/validateGatheringProduction.js";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { RESOURCES } from "../game/src/content/resources.js";
import {
  ITEM_ICON_APPEARANCE_IDS,
  itemIconAppearance,
} from "../game/src/render/itemIconAppearances.js";
import { ALL_PROCEDURAL_GEAR_ASSETS } from "../game/src/render/proceduralGear.js";
import RUNTIME_ASSET_MANIFEST from "../game/public/assets/manifest.json";

const ITEM_IDS = {
  ore: "ore", flux: "flux", gem: "gem", bar: "bar",
  log: "log", shaft: "shaft", handle: "handle", hide: "hide",
  rawFish: "raw_fish", cookedFish: "cooked_fish", burntFish: "burnt_fish",
  dagger: "dagger", sword: "sword", helm: "helm", body: "body", legs: "legs",
  boots: "boots", gloves: "gloves", pickaxe: "pickaxe", hatchet: "hatchet",
  staff: "staff", wand: "wand", rod: "rod", shield: "shield",
  meleeRing: "melee_ring", meleePendant: "melee_pendant",
  magicRing: "magic_ring", magicCharm: "magic_charm",
  hood: "hood", robe: "robe", magicLegs: "magic_legs", magicBoots: "magic_boots",
  wraps: "wraps",
} as const satisfies GatheringProductionTierDef["items"];

const HASH = "0".repeat(64);
const MAGIC_IDS = {
  essence: "air_essence",
  orb: "air_orb",
  staff: "air_staff",
  wand: "air_wand",
} as const;

function item(id: ItemId, tier = 1): ItemDef {
  return {
    id,
    name: id,
    tier,
    description: id,
    stackable: true,
    value: 1,
    category: "component",
  };
}

function presentation() {
  return {
    availableAssetIds: ["active_asset"],
    depletedAssetId: "depleted_asset",
    targetWorldSize: 1,
    materialTier: 1,
  } as const;
}

function makeFixture(): GatheringProductionValidationInput {
  const tierBase: Omit<GatheringProductionTierDef, "resourceDefs"> = {
    tier: 1,
    reqLevel: 1,
    metalName: "Metal",
    woodName: "Wood",
    resources: {
      mining: ["ore_resource"],
      fishing: "fish_resource",
      woodcutting: "tree_resource",
    },
    items: ITEM_IDS,
    magic: { element: "wind", ...MAGIC_IDS },
    smelting: { orePerBar: 1, fluxPerBar: 1 },
    campfire: {
      logItemId: ITEM_IDS.log,
      tier: 1,
      buildTimeMs: 3_000,
      lifetimeMs: 72_000,
      buildXp: { fletching: 2, crafting: 2 },
      visualLogAssetId: "log_asset",
    },
  };

  const resources: ResourceDef[] = [
    {
      id: "ore_resource", name: "Ore", archetype: "ore", skill: "mining",
      tier: 1, reqLevel: 1, itemId: ITEM_IDS.ore,
      bonus: [{ itemId: ITEM_IDS.gem, chance: 0.06 }], presentation: presentation(),
    },
    {
      id: "fish_resource", name: "Fish", archetype: "fishing_spot", skill: "fishing",
      tier: 1, reqLevel: 1, itemId: ITEM_IDS.rawFish, presentation: presentation(),
    },
    {
      id: "tree_resource", name: "Tree", archetype: "tree", skill: "woodcutting",
      tier: 1, reqLevel: 1, itemId: ITEM_IDS.log, presentation: presentation(),
    },
  ];
  const tier: GatheringProductionTierDef = { ...tierBase, resourceDefs: resources };

  const skillForKind = {
    smelt: "smithing",
    smith: "smithing",
    cook: "cooking",
    craft: "crafting",
    fletch: "fletching",
  } as const satisfies Readonly<Record<RecipeDef["kind"], RecipeDef["skill"]>>;
  const q = (itemId: ItemId, quantity = 1) => ({ itemId, quantity });
  const row = (
    id: string,
    kind: RecipeDef["kind"],
    stations: RecipeDef["stations"],
    inputs: RecipeDef["inputs"],
    outputItemId: ItemId,
    outputQuantity = 1,
    burntItemId?: ItemId,
  ): RecipeDef => {
    const base: RecipeDef = {
      id,
      name: id,
      kind,
      skill: skillForKind[kind],
      reqLevel: tier.tier,
      tier: tier.tier,
      stations,
      inputs,
      output: q(outputItemId, outputQuantity),
      durationMs: 1_800,
      xp: 1,
    };
    return burntItemId === undefined ? base : { ...base, burntItemId };
  };
  const smith = (outputItemId: ItemId, inputs: RecipeDef["inputs"]) =>
    row(`smith_${outputItemId}`, "smith", ["anvil"], inputs, outputItemId);
  const craft = (outputItemId: ItemId, inputs: RecipeDef["inputs"], id?: string) =>
    row(id ?? `craft_${outputItemId}`, "craft", ["crafting_table"], inputs, outputItemId);
  const fletch = (
    outputItemId: ItemId,
    inputs: RecipeDef["inputs"],
    outputQuantity = 1,
  ) => row(
    `fletch_${outputItemId}`,
    "fletch",
    ["fletching_bench"],
    inputs,
    outputItemId,
    outputQuantity,
  );

  // Keep cooking first because the mutation tests below use it as their representative recipe.
  const recipes: RecipeDef[] = [
    row(
      `cook_${ITEM_IDS.cookedFish}`,
      "cook",
      ["range", "campfire"],
      [q(ITEM_IDS.rawFish)],
      ITEM_IDS.cookedFish,
      1,
      ITEM_IDS.burntFish,
    ),
    row(
      `smelt_${ITEM_IDS.bar}`,
      "smelt",
      ["furnace"],
      [q(ITEM_IDS.ore), q(ITEM_IDS.flux)],
      ITEM_IDS.bar,
    ),
    smith(ITEM_IDS.dagger, [q(ITEM_IDS.bar), q(ITEM_IDS.handle)]),
    smith(ITEM_IDS.sword, [q(ITEM_IDS.bar, 2), q(ITEM_IDS.handle)]),
    smith(ITEM_IDS.helm, [q(ITEM_IDS.bar)]),
    smith(ITEM_IDS.body, [q(ITEM_IDS.bar)]),
    smith(ITEM_IDS.legs, [q(ITEM_IDS.bar)]),
    smith(ITEM_IDS.boots, [q(ITEM_IDS.bar)]),
    smith(ITEM_IDS.gloves, [q(ITEM_IDS.bar)]),
    smith(ITEM_IDS.pickaxe, [q(ITEM_IDS.bar, 2), q(ITEM_IDS.handle)]),
    smith(ITEM_IDS.hatchet, [q(ITEM_IDS.bar, 2), q(ITEM_IDS.handle)]),
    craft(MAGIC_IDS.wand, [q(ITEM_IDS.wand), q(MAGIC_IDS.orb)]),
    craft(MAGIC_IDS.staff, [q(ITEM_IDS.staff), q(MAGIC_IDS.orb)]),
    craft(ITEM_IDS.meleeRing, [q(ITEM_IDS.bar), q(ITEM_IDS.gem)]),
    craft(ITEM_IDS.meleePendant, [q(ITEM_IDS.bar), q(ITEM_IDS.gem)]),
    craft(ITEM_IDS.magicRing, [q(ITEM_IDS.bar), q(ITEM_IDS.gem)]),
    craft(ITEM_IDS.magicCharm, [q(ITEM_IDS.gem)]),
    craft(ITEM_IDS.robe, [q(ITEM_IDS.hide)]),
    craft(ITEM_IDS.magicLegs, [q(ITEM_IDS.hide)]),
    craft(ITEM_IDS.hood, [q(ITEM_IDS.hide)]),
    craft(ITEM_IDS.magicBoots, [q(ITEM_IDS.hide)]),
    craft(ITEM_IDS.wraps, [q(ITEM_IDS.hide)]),
    fletch(ITEM_IDS.shaft, [q(ITEM_IDS.log)], 4),
    fletch(ITEM_IDS.handle, [q(ITEM_IDS.log)], 2),
    fletch(ITEM_IDS.staff, [q(ITEM_IDS.shaft, 3)]),
    fletch(ITEM_IDS.wand, [q(ITEM_IDS.shaft, 2)]),
    fletch(ITEM_IDS.shield, [q(ITEM_IDS.log, 2), q(ITEM_IDS.bar)]),
    fletch(ITEM_IDS.rod, [q(ITEM_IDS.shaft, 2), q(ITEM_IDS.hide)]),
  ];

  const items = [...new Set([...Object.values(ITEM_IDS), ...Object.values(MAGIC_IDS)])].map((id) => item(id));
  const itemAppearances = items.map(({ id }) => ({
    itemId: id,
    parts: [{ kind: "primitive" }],
  }));
  const assets = ["active_asset", "depleted_asset", "log_asset"].map((id) => ({
    id,
    pack: "cc0-pack",
  }));

  return {
    tiers: [tier],
    resources,
    recipes,
    items,
    knownManifestAssetIds: new Set(assets.map(({ id }) => id)),
    assetManifest: {
      packs: [{
        id: "cc0-pack",
        source: "https://example.com/cc0-pack.zip",
        license: "CC0-1.0",
        archiveSha256: HASH,
      }],
      assets,
    },
    clusters: [{ id: "cluster", resourceId: "ore_resource" }],
    stations: [{ id: "range", kind: "range", recipeIds: ["cook_cooked_fish"] }],
    itemAppearances,
  };
}

function messages(input: GatheringProductionValidationInput): string {
  return validateGatheringProduction(input).join("\n");
}

function makeCanonicalInput(): GatheringProductionValidationInput {
  return {
    tiers: GATHERING_PRODUCTION_TIERS,
    resources: RESOURCES,
    recipes: RECIPES,
    items: ALL_ITEMS,
    knownManifestAssetIds: new Set([
      ...RUNTIME_ASSET_MANIFEST.assets.map((asset) => asset.id),
      ...ALL_PROCEDURAL_GEAR_ASSETS.map((asset) => asset.assetId),
    ]),
    assetManifest: RUNTIME_ASSET_MANIFEST,
    itemAppearances: ITEM_ICON_APPEARANCE_IDS.map(itemIconAppearance),
  };
}

describe("gathering and production boot validation", () => {
  it("accepts the current canonical tiers and licensed free-asset manifest", () => {
    expect(validateGatheringProduction(makeCanonicalInput())).toEqual([]);
    expect(RUNTIME_ASSET_MANIFEST.packs.length).toBeGreaterThanOrEqual(10);
  });

  it("accepts a complete 28-recipe tier foundation", () => {
    expect(validateGatheringProduction(makeFixture())).toEqual([]);
  });

  it("rejects a one-recipe tier as an incomplete canonical matrix", () => {
    const fixture = makeCanonicalInput();
    expect(messages({ ...fixture, recipes: [fixture.recipes[0]!] }))
      .toContain("gathering tier 1 has 1 recipes; expected the complete 30-recipe matrix");
  });

  it("rejects one missing recipe family", () => {
    const fixture = makeFixture();
    expect(messages({
      ...fixture,
      recipes: fixture.recipes.filter((recipe) => recipe.id !== `fletch_${ITEM_IDS.wand}`),
    })).toContain('gathering tier 1 is missing canonical recipe family "wand" (fletch_wand)');
  });

  it("rejects duplicate table ids", () => {
    const fixture = makeFixture();
    expect(messages({ ...fixture, items: [...fixture.items, fixture.items[0]!] }))
      .toContain('items has duplicate id "ore"');
    expect(messages({ ...fixture, resources: [...fixture.resources, fixture.resources[0]!] }))
      .toContain('resources has duplicate id "ore_resource"');
    expect(messages({ ...fixture, recipes: [...fixture.recipes, fixture.recipes[0]!] }))
      .toContain('recipes has duplicate id "cook_cooked_fish"');
    expect(messages({ ...fixture, tiers: [...fixture.tiers, fixture.tiers[0]!] }))
      .toContain('gathering tiers has duplicate id "1"');
  });

  it("rejects missing cluster, resource, item, and recipe references", () => {
    const fixture = makeFixture();
    expect(messages({
      ...fixture,
      clusters: [{ id: "cluster", resourceId: "missing_resource" }],
    })).toContain('resource cluster cluster references unknown resource "missing_resource"');

    const tier = fixture.tiers[0]!;
    expect(messages({
      ...fixture,
      tiers: [{
        ...tier,
        resources: { ...tier.resources, fishing: "missing_resource" },
      }],
    })).toContain('fishing references unknown resource "missing_resource"');

    const recipe = fixture.recipes[0]!;
    expect(messages({
      ...fixture,
      recipes: [{
        ...recipe,
        inputs: [{ itemId: "missing_item", quantity: 1 }],
      }],
    })).toContain('recipe cook_cooked_fish input references unknown item "missing_item"');

    expect(messages({
      ...fixture,
      stations: [{ id: "range", kind: "range", recipeIds: ["missing_recipe"] }],
    })).toContain('station range references unknown recipe "missing_recipe"');
  });

  it("rejects missing, invalid, and incompatible station kinds", () => {
    const fixture = makeFixture();
    const recipe = fixture.recipes[0]!;
    expect(messages({ ...fixture, recipes: [{ ...recipe, stations: [] }] }))
      .toContain("recipe cook_cooked_fish has no accepted station kind");
    expect(messages({
      ...fixture,
      recipes: [{ ...recipe, stations: ["kiln" as StationKind] }],
    })).toContain('recipe cook_cooked_fish references invalid station kind "kiln"');
    expect(messages({
      ...fixture,
      stations: [{ id: "range", kind: "campfire", recipeIds: ["cook_cooked_fish"] }],
      recipes: [{ ...recipe, stations: ["range"] }],
    })).toContain("which does not accept campfire");
  });

  it("rejects non-positive or fractional recipe quantities", () => {
    const fixture = makeFixture();
    const recipe = fixture.recipes[0]!;
    expect(messages({
      ...fixture,
      recipes: [{
        ...recipe,
        inputs: [{ ...recipe.inputs[0]!, quantity: 0 }],
        output: { ...recipe.output, quantity: 1.5 },
      }],
    })).toContain("recipe cook_cooked_fish input raw_fish quantity must be a positive integer");
    expect(messages({
      ...fixture,
      recipes: [{ ...recipe, output: { ...recipe.output, quantity: 1.5 } }],
    })).toContain("recipe cook_cooked_fish output cooked_fish quantity must be a positive integer");
  });

  it("rejects invalid recipe durations and XP", () => {
    const fixture = makeFixture();
    const recipe = fixture.recipes[0]!;
    for (const durationMs of [0, Number.POSITIVE_INFINITY]) {
      expect(messages({
        ...fixture,
        recipes: [{ ...recipe, durationMs }],
      })).toContain("recipe cook_cooked_fish durationMs must be finite and greater than zero");
    }
    for (const xp of [-1, Number.POSITIVE_INFINITY]) {
      expect(messages({
        ...fixture,
        recipes: [{ ...recipe, xp }],
      })).toContain("recipe cook_cooked_fish XP must be finite and non-negative");
    }
  });

  it("rejects invalid resource bonus probabilities", () => {
    const fixture = makeFixture();
    const ore = fixture.resources[0]!;
    for (const chance of [0, 1.01, Number.NaN]) {
      expect(messages({
        ...fixture,
        resources: [{
          ...ore,
          bonus: [{ itemId: ITEM_IDS.gem, chance }],
        }, ...fixture.resources.slice(1)],
      })).toContain("resource ore_resource bonus gem chance must be greater than zero and at most one");
    }
  });

  it("rejects recipe kinds paired with the wrong skill or station", () => {
    const fixture = makeFixture();
    const recipe = fixture.recipes[0]!;
    expect(messages({
      ...fixture,
      recipes: [{ ...recipe, skill: "smithing" }],
    })).toContain("recipe cook_cooked_fish kind cook uses skill smithing; expected cooking");
    expect(messages({
      ...fixture,
      recipes: [{ ...recipe, kind: "smelt", skill: "smithing", stations: ["anvil"] }],
    })).toContain("recipe cook_cooked_fish kind smelt must use furnace");
    expect(messages({
      ...fixture,
      recipes: [{ ...recipe, kind: "toString" as RecipeDef["kind"] }],
    })).toContain('recipe cook_cooked_fish has invalid kind "toString"');
  });

  it("rejects resources that do not yield their tier's canonical items", () => {
    const fixture = makeFixture();
    const tier = fixture.tiers[0]!;
    const ore = fixture.resources[0]!;
    const fish = fixture.resources[1]!;
    const tree = fixture.resources[2]!;

    expect(messages({
      ...fixture,
      resources: [{ ...ore, itemId: ITEM_IDS.flux }, fish, tree],
    })).toContain("expected canonical ore item ore");
    expect(messages({
      ...fixture,
      resources: [{ ...ore, bonus: [{ itemId: ITEM_IDS.hide, chance: 0.1 }] }, fish, tree],
    })).toContain('must have exactly one canonical gem bonus "gem"');
    expect(messages({
      ...fixture,
      resources: [ore, { ...fish, itemId: ITEM_IDS.cookedFish }, tree],
    })).toContain("expected canonical rawFish item raw_fish");
    expect(messages({
      ...fixture,
      resources: [ore, fish, { ...tree, itemId: ITEM_IDS.shaft }],
    })).toContain("expected canonical log item log");
    expect(messages({
      ...fixture,
      resources: [ore, fish, {
        ...tree,
        bonus: [{ itemId: ITEM_IDS.gem, chance: 0.1 }],
      }],
    })).toContain("woodcutting resource tree_resource cannot have a non-canonical bonus item");

    const fluxResource: ResourceDef = {
      ...ore,
      id: "flux_resource",
      itemId: ITEM_IDS.ore,
    };
    expect(messages({
      ...fixture,
      tiers: [{
        ...tier,
        resources: { ...tier.resources, mining: ["ore_resource", "flux_resource"] },
      }],
      resources: [...fixture.resources, fluxResource],
    })).toContain("expected canonical flux item flux");
  });

  it("rejects missing available, missing tree-stump, and unknown presentation assets", () => {
    const fixture = makeFixture();
    const [resource, ...rest] = fixture.resources;
    expect(resource).toBeDefined();
    expect(messages({
      ...fixture,
      resources: [{
        ...resource!,
        presentation: { ...resource!.presentation, availableAssetIds: [] },
      }, ...rest],
    })).toContain("resource ore_resource has no available assets");

    const tree = fixture.resources.find((candidate) => candidate.archetype === "tree")!;
    expect(messages({
      ...fixture,
      resources: fixture.resources.map((candidate) => candidate.id === tree.id
        ? { ...tree, presentation: { ...tree.presentation, depletedAssetId: undefined } }
        : candidate),
    })).toContain("resource tree_resource has no authored depleted asset");

    expect(messages({
      ...fixture,
      resources: [{
        ...resource!,
        presentation: { ...resource!.presentation, availableAssetIds: ["missing_asset"] },
      }, ...rest],
    })).toContain('references unknown manifest asset "missing_asset"');
  });

  it("rejects missing or dangling item icon appearances", () => {
    const fixture = makeFixture();
    expect(messages({
      ...fixture,
      itemAppearances: fixture.itemAppearances.filter((row) => row.itemId !== ITEM_IDS.ore),
    })).toContain("item ore has no icon appearance");

    expect(messages({
      ...fixture,
      itemAppearances: fixture.itemAppearances.map((row) => row.itemId === ITEM_IDS.ore
        ? { ...row, parts: [] }
        : row),
    })).toContain("item ore has an empty icon appearance");

    expect(messages({
      ...fixture,
      itemAppearances: fixture.itemAppearances.map((row) => row.itemId === ITEM_IDS.ore
        ? { ...row, parts: [{ kind: "asset", assetId: "missing_icon_asset" }] }
        : row),
    })).toContain('item ore icon appearance references unknown manifest asset "missing_icon_asset"');
  });

  it("rejects tier mismatches", () => {
    const fixture = makeFixture();
    const [resource, ...rest] = fixture.resources;
    expect(messages({
      ...fixture,
      resources: [{ ...resource!, tier: 5 }, ...rest],
    })).toContain("resource ore_resource has tier 5; expected 1");

    const tier = fixture.tiers[0]!;
    expect(messages({
      ...fixture,
      tiers: [{ ...tier, campfire: { ...tier.campfire, tier: 5 } }],
    })).toContain("gathering tier 1 campfire has tier 5; expected 1");

    expect(messages({
      ...fixture,
      items: fixture.items.map((row) => row.id === ITEM_IDS.wand ? { ...row, tier: 5 } : row),
    })).toContain("gathering tier 1 item wand has tier 5; expected 1");
  });

  it("rejects incomplete or unsupported foundation provenance", () => {
    const fixture = makeFixture();
    const pack = fixture.assetManifest.packs[0]!;
    expect(messages({
      ...fixture,
      assetManifest: {
        ...fixture.assetManifest,
        packs: [{ ...pack, source: "local-cache.zip" }],
      },
    })).toContain("has no reproducible HTTP(S) source");
    expect(messages({
      ...fixture,
      assetManifest: {
        ...fixture.assetManifest,
        packs: [{ ...pack, license: "Standard-EULA" }],
      },
    })).toContain('has unsupported license "Standard-EULA"');
    expect(messages({
      ...fixture,
      assetManifest: {
        ...fixture.assetManifest,
        packs: [{ ...pack, archiveSha256: "ABC" }],
      },
    })).toContain("has no valid lowercase archive SHA-256");
  });

  it("rejects an unsupported pack used only by an item icon", () => {
    const fixture = makeFixture();
    const iconAssetId = "equipment_icon_asset";
    const iconPack = {
      id: "equipment-pack",
      source: "https://example.com/equipment-pack.zip",
      license: "Standard-EULA",
      archiveSha256: HASH,
    };
    expect(messages({
      ...fixture,
      knownManifestAssetIds: new Set([...fixture.knownManifestAssetIds, iconAssetId]),
      assetManifest: {
        packs: [...fixture.assetManifest.packs, iconPack],
        assets: [...fixture.assetManifest.assets, { id: iconAssetId, pack: iconPack.id }],
      },
      itemAppearances: fixture.itemAppearances.map((appearance) =>
        appearance.itemId === ITEM_IDS.wand
          ? { itemId: appearance.itemId, parts: [{ kind: "asset", assetId: iconAssetId }] }
          : appearance),
    })).toContain('manifest pack equipment-pack has unsupported license "Standard-EULA"');
  });
});
