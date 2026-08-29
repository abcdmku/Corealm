import { build } from "vite";
import { gameRoot } from "./lib/paths.js";
import { assertGameInitialized } from "./lib/server.js";
import { generateWorldMap } from "./generate-world-map.js";

await assertGameInitialized();
await generateWorldMap();
await build({ root: gameRoot });
