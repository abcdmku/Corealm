/** Scratch: run the content layer's own manifest check over the widened prefab/composition lists. */
import { readFileSync } from "node:fs";
import { validateRegions } from "../../../game/src/content/regions.js";

const manifest = JSON.parse(
  readFileSync("game/public/assets/manifest.json", "utf8"),
) as { assets: { id: string }[] };
const ids = new Set(manifest.assets.map((a) => a.id));
const issues = validateRegions(ids);
console.log(`validateRegions issues: ${issues.length}`);
for (const issue of issues) console.log(` - ${issue}`);
process.exitCode = issues.length === 0 ? 0 : 1;
