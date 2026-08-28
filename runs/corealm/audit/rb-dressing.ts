/**
 * Exercises the wall / paving / prop emitters, which no settlement authors yet.
 *
 * They ship dormant on purpose - the three settlement authors write the data in the next wave -
 * so this is the only thing that proves the code runs. It mutates the imported `REGIONS` data in
 * memory, which no game code does and no game code may.
 */
import { readFileSync } from "node:fs";
import { buildWorld, type AssetSize } from "../../../game/src/world/regionBuilder.js";
import { REGIONS, type RegionDef } from "../../../game/src/content/regions.js";

interface ManifestAsset { id: string; size: { x: number; y: number; z: number }; base?: { y: number } }
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));

const heightAt = (): number => 0;
const ports = {
  heightAt,
  baseY: (id: string): number => byId.get(id)?.base?.y ?? 0,
  assetSize: (id: string): AssetSize | null => byId.get(id)?.size ?? null,
};

const before = buildWorld(1, heightAt, ports);

// A 52 m north wall with an 8 m gate at its midpoint, a 20 x 16 m kerbed square, and one barrel.
const coldbrace = (REGIONS[0] as RegionDef).settlement as unknown as Record<string, unknown>;
coldbrace.walls = [
  { id: "cb_wall_n", name: "North Wall", from: [-186, -108], to: [-134, -108], openings: [{ at: 26, width: 8 }] },
];
coldbrace.paving = [
  { id: "cb_square", rect: { minX: -170, minZ: -88, maxX: -150, maxZ: -72 }, assetId: "floor_cobble", kerb: true },
];
coldbrace.props = [
  { id: "cb_barrel", assetId: "barrel", position: [-158, -78], rotationY: 0.4, solid: true },
];

const after = buildWorld(1, heightAt, ports);

const added = after.entities.filter((entity) =>
  !before.entities.some((old) => old.id === entity.id));
const byPrefix = new Map<string, number>();
for (const entity of added) {
  const prefix = String(entity.id).split("#")[0]!;
  byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
}
console.log(`entities ${before.entities.length} -> ${after.entities.length} (+${added.length})`);
console.log("added by owner:", [...byPrefix].map(([k, v]) => `${k} ${v}`).join(", "));

const assetCounts = new Map<string, number>();
for (const entity of added) {
  const id = entity.view!.assetId;
  assetCounts.set(id, (assetCounts.get(id) ?? 0) + 1);
}
console.log("added by asset:", [...assetCounts].map(([k, v]) => `${k} ${v}`).join(", "));
console.log(`instanced groups added (assetId x tier): ${assetCounts.size}`);

const addedSolids = after.solids.filter((solid) =>
  !before.solids.some((old) => old.id === solid.id));
console.log(`solids ${before.solids.length} -> ${after.solids.length} (+${addedSolids.length})`);
for (const solid of addedSolids) {
  console.log("   ", solid.kind, solid.id, JSON.stringify(solid.position),
    solid.kind === "box" ? JSON.stringify(solid.size) : solid.radius, solid.kind === "box" ? solid.rotationY.toFixed(3) : "");
}

// Every added asset id must be in the manifest, or the wall is invisible.
const missing = [...assetCounts.keys()].filter((id) => !byId.has(id));
console.log("missing from manifest:", missing.join(", ") || "none");

// Determinism.
console.log("deterministic:", JSON.stringify(buildWorld(1, heightAt, ports)) === JSON.stringify(after));
