import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Logger, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";
import { analyzeAnimationUsage } from "../tools/analyze-animation-usage.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ASSET_ROOT = new URL("../game/public/assets/", import.meta.url);
const ANIMATION_LIBRARY_IDS = ["animation_library_1", "animation_library_2"] as const;
const MAX_RAW_ANIMATION_BYTES = 3_370_000;

interface AnimationManifestEntry {
  id: string;
  file: string;
  category: string;
  bytes: number;
  animations: string[];
}

interface AssetManifest {
  assets: AnimationManifestEntry[];
}

async function readAnimationManifestEntries(): Promise<AnimationManifestEntry[]> {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", ASSET_ROOT), "utf8")) as AssetManifest;
  return manifest.assets.filter((entry) => entry.category === "animation");
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

let reportPromise: ReturnType<typeof analyzeAnimationUsage> | undefined;

function readAnimationUsageReport(): ReturnType<typeof analyzeAnimationUsage> {
  reportPromise ??= analyzeAnimationUsage(REPO_ROOT);
  return reportPromise;
}

describe("runtime animation budget", () => {
  it("resolves and classifies every runtime clip requirement", async () => {
    const report = await readAnimationUsageReport();

    expect(report.schemaVersion).toBe(1);
    expect(report.missingClips, "runtime clip references missing from the built libraries").toEqual([]);
    expect(
      report.unresolvedDynamicReferences,
      "dynamic clip expressions without an explicit analyzer resolution",
    ).toEqual([]);
    expect(report.manifestGlbMismatches, "the analyzer found stale manifest animation metadata").toEqual([]);

    const available = sorted(report.availableClips);
    const referenced = report.references.map((reference) => reference.clip);
    const unused = report.unusedClips;

    expect(new Set(available).size, "duplicate names in availableClips").toBe(available.length);
    expect(new Set(referenced).size, "a runtime clip must have one classification row").toBe(referenced.length);
    expect(new Set(unused).size, "duplicate names in unusedClips").toBe(unused.length);
    expect(
      sorted([...referenced, ...unused]),
      "every available clip must be classified exactly once as referenced or unused",
    ).toEqual(available);

    const availableSet = new Set(available);
    for (const reference of report.references) {
      expect(reference.sources.length, `${reference.clip} has no runtime source`).toBeGreaterThan(0);
      expect(availableSet.has(reference.clip), `${reference.clip} is referenced but unavailable`).toBe(true);
      expect(["direct", "mirrored"], `${reference.clip} has an unknown requirement kind`).toContain(reference.kind);
    }

    const mirrored = report.references.filter((reference) => reference.kind === "mirrored");
    expect(mirrored.length, "the runtime mirror requirements disappeared from the usage report").toBeGreaterThan(0);
    for (const reference of mirrored) {
      expect(reference.sourceClip, `${reference.clip} has no mirror source`).toBeTruthy();
      expect(reference.sourceClip, `${reference.clip} mirrors itself`).not.toBe(reference.clip);
      expect(
        availableSet.has(reference.sourceClip ?? ""),
        `${reference.clip} derives from unavailable source ${reference.sourceClip ?? "<missing>"}`,
      ).toBe(true);
    }

    for (const mirror of report.mirrors) {
      expect(mirror.generated, `${mirror.clip} cannot be generated because ${mirror.sourceClip} is unavailable`).toBe(true);
      expect(availableSet.has(mirror.sourceClip), `${mirror.clip} has an unclassified source clip`).toBe(true);
      expect(availableSet.has(mirror.clip), `${mirror.clip} is generated but absent from availableClips`).toBe(true);
    }

    for (const usage of report.assetClipUsage) {
      expect(
        sorted([...usage.referencedClips, ...usage.unusedClips]),
        `${usage.assetId} has an available asset-owned clip without a classification`,
      ).toEqual(sorted(usage.availableClips));
      for (const motion of usage.motions) {
        expect(
          motion.clips.every((clip) => usage.availableClips.includes(clip)),
          `${usage.assetId} motion ${motion.motion} selects an unavailable clip`,
        ).toBe(true);
      }
    }
  }, 30_000);

  it("keeps the analyzer, manifest, and two non-empty GLBs in exact agreement", async () => {
    const [report, manifestEntries] = await Promise.all([
      readAnimationUsageReport(),
      readAnimationManifestEntries(),
    ]);
    const entriesById = new Map(manifestEntries.map((entry) => [entry.id, entry]));

    expect(sorted(entriesById.keys())).toEqual(sorted(ANIMATION_LIBRARY_IDS));
    expect(sorted(report.libraries.map((library) => library.assetId))).toEqual(sorted(ANIMATION_LIBRARY_IDS));

    const io = new NodeIO()
      .registerExtensions(KHRONOS_EXTENSIONS)
      .setLogger(new Logger(Logger.Verbosity.ERROR));
    let combinedBytes = 0;

    for (const libraryId of ANIMATION_LIBRARY_IDS) {
      const entry = entriesById.get(libraryId);
      const library = report.libraries.find((candidate) => candidate.assetId === libraryId);
      expect(entry, `${libraryId} is absent from the asset manifest`).toBeDefined();
      expect(library, `${libraryId} is absent from the analyzer output`).toBeDefined();
      if (!entry || !library) continue;

      expect(library.file).toBe(entry.file);
      expect(library.bytes).toBe(entry.bytes);
      expect(library.clips).toEqual(entry.animations);
      expect(new Set(entry.animations).size, `${libraryId} contains duplicate clip names`).toBe(entry.animations.length);

      const bytes = await readFile(new URL(entry.file, ASSET_ROOT));
      combinedBytes += bytes.byteLength;
      expect(bytes.byteLength, `${entry.file} is empty`).toBeGreaterThan(12);
      expect(bytes.subarray(0, 4).toString("ascii"), `${entry.file} has no GLB header`).toBe("glTF");
      expect(bytes.readUInt32LE(4), `${entry.file} uses an unsupported GLB version`).toBe(2);
      expect(bytes.readUInt32LE(8), `${entry.file} has a corrupt declared length`).toBe(bytes.byteLength);
      expect(entry.bytes, `${entry.file} byte count drifted from the manifest`).toBe(bytes.byteLength);

      const document = await io.readBinary(new Uint8Array(bytes));
      const animations = document.getRoot().listAnimations();
      const glbClipNames = animations.map((animation) => animation.getName());
      expect(glbClipNames.length, `${entry.file} contains no animation clips`).toBeGreaterThan(0);
      expect(glbClipNames, `${entry.file} clip list drifted from the manifest`).toEqual(entry.animations);
      for (const animation of animations) {
        expect(animation.getName().trim(), `${entry.file} contains an unnamed clip`).not.toBe("");
        expect(
          animation.listChannels().length,
          `${entry.file} clip ${animation.getName()} has no animation channels`,
        ).toBeGreaterThan(0);
      }
    }

    expect(combinedBytes, "combined raw animation GLB payload").toBeLessThanOrEqual(MAX_RAW_ANIMATION_BYTES);
  }, 30_000);
});
