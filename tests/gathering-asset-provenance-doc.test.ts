import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import type { AssetManifest } from "../game/src/render/assets.js";
import { gatheringAssetProvenanceDoc, resourceGuideLifecycle } from "../tools/gen-docs.js";

async function liveManifest(): Promise<AssetManifest> {
  return JSON.parse(
    await readFile(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8"),
  ) as AssetManifest;
}

describe("generated gathering asset provenance", () => {
  it("uses crop lifecycles instead of node respawn formulas for farm plots", () => {
    expect(resourceGuideLifecycle("plot_bittergrain")).toEqual({
      xpEach: 10,
      perNode: "3-6 per harvest",
      recovery: "240 s wall-clock growth",
    });
    expect(resourceGuideLifecycle("plot_cairnleaf")).toEqual({
      xpEach: 35,
      perNode: "2-5 per harvest",
      recovery: "900 s wall-clock growth",
    });
    expect(resourceGuideLifecycle("ore_grithe").recovery).toBe("21 s respawn");
  });

  it("matches the checked-in report and ignores the manifest build timestamp", async () => {
    const manifest = await liveManifest();
    const generated = gatheringAssetProvenanceDoc(manifest);
    const checkedIn = await readFile(
      new URL("../docs/asset-provenance-gathering.md", import.meta.url),
      "utf8",
    );

    expect(generated).toBe(checkedIn.replace(/\r\n/g, "\n"));
    expect(gatheringAssetProvenanceDoc({ ...manifest, generatedAt: "different-build" })).toBe(generated);
    expect(generated.endsWith("\n")).toBe(true);
    expect(generated.endsWith("\n\n")).toBe(false);
  });

  it("records every canonical resource and campfire asset with complete CC0 pack metadata", async () => {
    const manifest = await liveManifest();
    const generated = gatheringAssetProvenanceDoc(manifest);

    for (const definition of GATHERING_PRODUCTION_TIERS) {
      for (const resource of definition.resourceDefs) {
        for (const assetId of resource.presentation.availableAssetIds) {
          expect(generated).toContain(`\`${assetId}\``);
        }
        if (resource.presentation.depletedAssetId) {
          expect(generated).toContain(`\`${resource.presentation.depletedAssetId}\``);
        }
      }
      expect(generated).toContain(`\`${definition.campfire.visualLogAssetId}\``);
    }

    for (const pack of manifest.packs) {
      expect(pack.license).toBe("CC0-1.0");
      expect(pack.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(generated).toContain(`\`${pack.id}\``);
      expect(generated).toContain(`(${pack.source})`);
      expect(generated).toContain(`\`${pack.archiveSha256}\``);
    }
  });

  it("rejects missing foundation assets and incomplete pack provenance", async () => {
    const manifest = await liveManifest();
    expect(() => gatheringAssetProvenanceDoc({
      ...manifest,
      assets: manifest.assets.filter((asset) => asset.id !== "fish_minnow"),
    })).toThrow("missing manifest asset fish_minnow");

    expect(() => gatheringAssetProvenanceDoc({
      ...manifest,
      packs: manifest.packs.map((pack, index) => index === 0 ? { ...pack, license: "Unknown" } : pack),
    })).toThrow("expected CC0-1.0");
  });
});
