/**
 * Scratch: the measured cost of adding `wall_bottom_trim` to every wall module.
 *
 * Draw calls are one per (assetId, materialTier) instanced group, and every settlement is one tier,
 * so the question is only "which regions did not already draw this asset" - which is what decides
 * whether the +1 lands on the 349-draw-call Highcairn pose.
 */
import { REGIONS } from "../../../game/src/content/regions.js";
import { buildPrefab, variantSeed } from "../../../game/src/render/buildings.js";

let totalParts = 0;
let totalTrims = 0;
for (const region of REGIONS) {
  const assets = new Set<string>();
  let parts = 0;
  let trims = 0;
  let oldTrims = 0;
  for (const building of region.settlement.buildings) {
    const list = buildPrefab(
      building.prefab, building.footprint, variantSeed(building.id), region.settlement.kit,
    );
    for (const part of list) {
      assets.add(part.assetId);
      parts += 1;
      if (part.assetId !== "wall_bottom_trim") continue;
      trims += 1;
      // Before this pass only `hall` (long faces) and `wall_segment` emitted the trim.
      if (building.prefab === "wall_segment") oldTrims += 1;
      else if (building.prefab === "hall") oldTrims += 1;
    }
  }
  totalParts += parts;
  totalTrims += trims;
  console.log(
    `${region.id.padEnd(14)} tier ${String(region.tier).padStart(2)}  `
    + `${region.settlement.buildings.length} buildings, ${parts} parts, `
    + `${assets.size} distinct assets, wall_bottom_trim ${oldTrims} -> ${trims} instances `
    + `(${oldTrims > 0 ? "group already drawn, +0 draw calls" : "NEW group, +1 draw call"})`,
  );
}
console.log(`\ntotal building parts ${totalParts}, of which ${totalTrims} are trim`);
