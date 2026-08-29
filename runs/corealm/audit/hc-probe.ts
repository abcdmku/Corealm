/** Highcairn authoring probe: where the plot beds and the crane parts actually land. */
import { readFileSync } from "node:fs";
import { buildWorld, type AssetSize } from "../../../game/src/world/regionBuilder.js";

interface ManifestAsset { id: string; size: { x: number; y: number; z: number }; base?: { y: number } }
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((a) => [a.id, a]));
const heightAt = (): number => 0;
const world = buildWorld(1, heightAt, {
  heightAt,
  baseY: (id: string): number => byId.get(id)?.base?.y ?? 0,
  assetSize: (id: string): AssetSize | null => byId.get(id)?.size ?? null,
});

const hc = world.entities.filter((e) => e.id.startsWith("highcairn_"));
for (const e of hc) {
  if (/plot|crane/.test(e.id)) {
    console.log(e.id.padEnd(34), e.position.map((v) => v.toFixed(2)).join(", "));
  }
}
console.log("--- plot spread from (128,-58)");
for (const e of hc) {
  if (/^highcairn_plot_beds_\d$/.test(e.id)) {
    console.log(e.id, "d =", Math.hypot(e.position[0] - 128, e.position[2] + 58).toFixed(2));
  }
}
