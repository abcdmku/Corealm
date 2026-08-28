/**
 * Offline measurement of `buildWorld` for the world-builder pass. Not part of the game build:
 * `runs/` is outside tsconfig's include list.
 */
import { readFileSync } from "node:fs";
import { buildWorld, type AssetSize } from "../../../game/src/world/regionBuilder.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { REGIONS } from "../../../game/src/content/regions.js";

interface ManifestAsset {
  id: string;
  size: { x: number; y: number; z: number };
  base?: { x: number; y: number; z: number };
}

const manifest = JSON.parse(
  readFileSync("game/public/assets/manifest.json", "utf8"),
) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
const baseY = (id: string): number => byId.get(id)?.base?.y ?? 0;
const assetSize = (id: string): AssetSize | null => byId.get(id)?.size ?? null;

const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const heightAt = (_regionId: string, x: number, z: number): number => scene.heightAtXZ(x, z);

const seed = 1;
const before = buildWorld(seed, heightAt);
const after = buildWorld(seed, heightAt, { heightAt, baseY, assetSize });

const surface = new Set(REGIONS.map((region) => region.id as string));

function gapReport(label: string, world: ReturnType<typeof buildWorld>): void {
  let worst = 0;
  let worstId = "";
  let over = 0;
  let considered = 0;
  for (const entity of world.entities) {
    if (!entity.view) continue;
    if (!surface.has(entity.regionId)) continue;
    if (entity.meta?.scenery === true) continue;
    const asset = byId.get(entity.view.assetId);
    if (!asset?.base) continue;
    const tiered = ["ore", "tree", "fishing_spot", "farm_plot", "enemy", "boss"]
      .includes(entity.archetype);
    const silhouette = tiered ? 0.9 + 0.5 * (Math.log(Math.min(99, Math.max(1, entity.view.materialTier ?? entity.tier))) / Math.log(99)) : 1;
    const scale = (entity.view.scale ?? 1) * silhouette;
    const drawnMinY = entity.position[1] + asset.base.y * scale;
    const ground = heightAt(entity.regionId, entity.position[0], entity.position[2]);
    const gap = drawnMinY - ground;
    considered += 1;
    if (Math.abs(gap) > Math.abs(worst)) { worst = gap; worstId = entity.id; }
    if (Math.abs(gap) > 0.05) over += 1;
  }
  console.log(`${label}: considered ${considered}, overTolerance(|gap|>0.05) ${over}, worst ${worst.toFixed(3)} (${worstId})`);
}

gapReport("BEFORE (no ports)", before);
gapReport("AFTER  (ports)   ", after);

const check = (id: string): void => {
  const b = before.entities.find((entity) => entity.id === id);
  const a = after.entities.find((entity) => entity.id === id);
  if (!a || !b) { console.log(`  ${id}: MISSING`); return; }
  console.log(`  ${id}: y ${b.position[1].toFixed(3)} -> ${a.position[1].toFixed(3)}`);
};
console.log("reference entities:");
for (const id of ["fallen_duskoak", "coldbrace_fletching", "marchfield_plots_1", "highcairn_plot_beds_1", "gravelmaw_ch1_marker"]) check(id);

console.log(`entities ${before.entities.length} -> ${after.entities.length}`);
console.log(`buildings ${before.buildings.length} -> ${after.buildings.length}`);
console.log(`solids ${before.solids.length} -> ${after.solids.length}`);

const byKind = new Map<string, number>();
for (const solid of after.solids) {
  const key = solid.kind;
  byKind.set(key, (byKind.get(key) ?? 0) + 1);
}
console.log("solids by kind:", [...byKind].map(([k, v]) => `${k} ${v}`).join(", "));

// Which volumes hit the interaction-reach cap?
const capped: string[] = [];
for (const solid of after.solids) {
  const reach = solid.kind === "box"
    ? Math.hypot(solid.size[0] / 2, solid.size[2] / 2)
    : solid.radius;
  if (reach > 1.39 && reach < 1.41) capped.push(`${solid.id} ${reach.toFixed(2)}`);
}
console.log(`capped at reach 1.4: ${capped.length}`);
for (const row of capped.slice(0, 20)) console.log("   ", row);

// Ground normals.
let tilted = 0;
for (const entity of after.entities) if (entity.view?.groundNormal) tilted += 1;
console.log(`entities carrying groundNormal: ${tilted}`);

// NPC dressing.
const npc = after.entities.find((entity) => entity.archetype === "npc");
console.log("npc sample:", npc?.id, npc?.view?.assetId, JSON.stringify(npc?.view?.partAssetIds));
const missingParts = new Set<string>();
for (const entity of after.entities) {
  for (const part of entity.view?.partAssetIds ?? []) if (!byId.has(part)) missingParts.add(part);
  if (entity.view && !byId.has(entity.view.assetId)) missingParts.add(entity.view.assetId);
}
console.log("asset ids not in manifest:", [...missingParts].join(", ") || "none");

// Determinism: same seed twice, byte-identical.
const a2 = buildWorld(seed, heightAt, { heightAt, baseY, assetSize });
console.log("deterministic:", JSON.stringify(a2) === JSON.stringify(after));

// Draw-call groups added by the plot beds.
const groups = new Map<string, number>();
for (const entity of after.entities) {
  if (!entity.view) continue;
  const tier = entity.view.materialTier ?? entity.tier;
  const key = `${entity.view.assetId}|${entity.view.depletedAssetId ?? "-"}|${tier}|${entity.archetype}|${entity.view.clipFraction ?? 0}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
const beforeGroups = new Set<string>();
for (const entity of before.entities) {
  if (!entity.view) continue;
  const tier = entity.view.materialTier ?? entity.tier;
  beforeGroups.add(`${entity.view.assetId}|${entity.view.depletedAssetId ?? "-"}|${tier}|${entity.archetype}|${entity.view.clipFraction ?? 0}`);
}
const newGroups = [...groups.keys()].filter((key) => !beforeGroups.has(key));
console.log(`instanced groups ${beforeGroups.size} -> ${groups.size}; new: ${newGroups.join(" , ")}`);

// Slope distribution under the entities that could carry a normal.
const slopeBuckets = [0, 0, 0, 0];
let eligible = 0;
for (const entity of after.entities) {
  if (!["ore", "tree", "fishing_spot", "obstacle", "landmark"].includes(entity.archetype)) continue;
  if (entity.meta?.scenery === true) continue;
  if (!surface.has(entity.regionId)) continue;
  eligible += 1;
  const [x, , z] = entity.position;
  const dhdx = (heightAt(entity.regionId, x + 1, z) - heightAt(entity.regionId, x - 1, z)) / 2;
  const dhdz = (heightAt(entity.regionId, x, z + 1) - heightAt(entity.regionId, x, z - 1)) / 2;
  const slope = Math.hypot(dhdx, dhdz);
  if (slope < 0.0349) slopeBuckets[0] += 1;
  else if (slope < 0.176) slopeBuckets[1] += 1;
  else if (slope < 0.364) slopeBuckets[2] += 1;
  else slopeBuckets[3] += 1;
}
console.log(`tilt-eligible ${eligible}; <2deg ${slopeBuckets[0]}, 2-10deg ${slopeBuckets[1]}, 10-20deg ${slopeBuckets[2]}, >20deg ${slopeBuckets[3]}`);

// Plot-bed instanced groups.
const bedGroups = new Set<string>();
let bedEntities = 0;
for (const entity of after.entities) {
  if (typeof entity.id === "string" && (entity.id.includes("#bed") || entity.id.includes("#rail"))) {
    bedEntities += 1;
    bedGroups.add(`${entity.view!.assetId}|tier${entity.view!.materialTier}`);
  }
}
console.log(`plot bed entities ${bedEntities} in groups: ${[...bedGroups].join(", ")}`);

// Solid volume owners by archetype prefix.
const owners = new Map<string, number>();
const ids = new Map(after.entities.map((e) => [e.id, e.archetype]));
for (const solid of after.solids) {
  owners.set(ids.get(solid.id) ?? "part/derived", (owners.get(ids.get(solid.id) ?? "part/derived") ?? 0) + 1);
}
console.log("solids by owning archetype:", [...owners].map(([k, v]) => `${k} ${v}`).join(", "));
