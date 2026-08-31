import type { AssetLoadStats } from "../render/assets.js";

/**
 * Formats asset work without pretending a growing request list is a fixed total.
 *
 * Before a batch is fully scheduled, only the completed and active counts are knowable. Once the
 * caller freezes `target`, the denominator stays fixed for the lifetime of that batch.
 */
export function formatBootAssetProgress(stats: AssetLoadStats, target: number | null): string {
  if (stats.total <= 0) return "";

  const failed = stats.failed > 0 ? `, ${stats.failed} failed` : "";
  if (target !== null && target > 0) {
    return ` · assets ${Math.min(stats.loaded, target)}/${target} ready${failed}`;
  }

  const active = stats.queued + stats.inflight;
  if (stats.loaded === 0 && active === 0 && stats.failed === 0) return "";
  return ` · ${stats.loaded} assets ready${active > 0 ? `, ${active} loading` : ""}${failed}`;
}
