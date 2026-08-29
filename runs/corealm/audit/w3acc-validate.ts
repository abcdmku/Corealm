import { validateRegions, REGIONS } from "../../../game/src/content/regions.js";

const problems = validateRegions();
console.log(`regions: ${REGIONS.length}`);
console.log(`validateRegions() problems: ${problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
console.log(JSON.stringify(problems));
