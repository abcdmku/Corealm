/**
 * Miniboss and rare-weapon asset provenance, per the Phase 2 amendment.
 *
 * The Monster02 rig ships as four GLBs built by named-take selection out of ONE all-animation
 * FBX; this pins the contract that made that pipeline change worth having — exactly the six
 * canonical clips, no take leakage, measured stride fields — plus the ledger rows the amendment
 * requires for the three Unity Asset Store packages.
 */
import { describe, expect, it } from "vitest";
import MANIFEST from "../game/public/assets/manifest.json";

interface ManifestAsset {
  id: string;
  file: string;
  pack: string;
  animations?: string[];
  size: { x: number; y: number; z: number };
  sha256?: string;
  impliedWalkMps?: number;
  walkClipSeconds?: number;
  impliedRunMps?: number;
  runClipSeconds?: number;
}

interface ManifestPack {
  id: string;
  author?: string;
  license?: string;
  source?: string;
}

const assets = (MANIFEST as { assets: ManifestAsset[] }).assets;
const packs = (MANIFEST as { packs: ManifestPack[] }).packs;

const MINIBOSS_IDS = [
  "miniboss_galeskin", "miniboss_mossbound", "miniboss_tideworn", "miniboss_cinderwake",
] as const;

const CANONICAL_CLIPS = ["Idle", "Walk", "Run", "Attack", "Hit", "Death"];

describe("miniboss rig assets", () => {
  it("ships all four texture variants with exactly the six canonical clips", () => {
    for (const id of MINIBOSS_IDS) {
      const asset = assets.find((row) => row.id === id);
      expect(asset, id).toBeDefined();
      // Sorted comparison: order is presentation, the SET is the renderer's contract. Extra takes
      // (Shoot, Stunned, Idle_v02) leaking through the selector would show up here.
      expect([...(asset!.animations ?? [])].sort(), id).toEqual([...CANONICAL_CLIPS].sort());
      expect(asset!.pack, id).toBe("pixelius-fantasy-monster-02");
      expect(asset!.sha256, `${id} sha256`).toMatch(/^[0-9a-fA-F]{64}$/);
      // The rig is a two-metre biped; a unit mistake (cm vs m) fails loudly here.
      expect(asset!.size.y, id).toBeGreaterThan(1.5);
      expect(asset!.size.y, id).toBeLessThan(3);
      // Stride measurements exist, and the authored enemy speeds in content/enemies.ts lean on
      // them: walk 0.82 m/s implied, run above the authored 2.0 m/s pursuit.
      expect(asset!.impliedWalkMps, id).toBeGreaterThan(0.3);
      expect(asset!.walkClipSeconds, id).toBeGreaterThan(0);
      expect(asset!.impliedRunMps, id).toBeGreaterThanOrEqual(2.0);
    }
  });
});

describe("rare weapon assets", () => {
  it("ships the shared sword and staff geometry unanimated at real-world size", () => {
    const sword = assets.find((row) => row.id === "miniboss_sword");
    const staff = assets.find((row) => row.id === "miniboss_staff");
    expect(sword).toBeDefined();
    expect(staff).toBeDefined();
    expect(sword!.animations ?? []).toEqual([]);
    expect(staff!.animations ?? []).toEqual([]);
    // +Y along the shaft, sane hand-weapon sizes.
    expect(sword!.size.y).toBeGreaterThan(1.0);
    expect(sword!.size.y).toBeLessThan(1.5);
    expect(staff!.size.y).toBeGreaterThan(1.5);
    expect(staff!.size.y).toBeLessThan(2.0);
    expect(sword!.pack).toBe("blink-free-low-poly-swords");
    expect(staff!.pack).toBe("blink-free-stylized-weapons");
  });
});

describe("package provenance", () => {
  it("registers the three Unity Asset Store packages under the standard EULA framing", () => {
    for (const packId of [
      "pixelius-fantasy-monster-02", "blink-free-low-poly-swords", "blink-free-stylized-weapons",
    ]) {
      const pack = packs.find((row) => row.id === packId);
      expect(pack, packId).toBeDefined();
      expect(pack!.license, packId).toMatch(/Standard Unity Asset Store EULA/);
      expect(pack!.source, packId).toMatch(/^https:/);
    }
  });
});
