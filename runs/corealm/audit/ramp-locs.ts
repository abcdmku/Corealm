import { REGIONS } from "../../../game/src/content/regions.js";
for (const r of REGIONS) console.log(r.id, "::", r.locations.map((l) => l.id + "@" + l.position.join(",")).join(" | "));
