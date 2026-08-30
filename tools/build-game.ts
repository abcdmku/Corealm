import { build } from "vite";
import { gameRoot } from "./lib/paths.js";
import { assertGameInitialized } from "./lib/server.js";
import { generateWorldMap } from "./generate-world-map.js";
import { generateItemIcons } from "./generate-item-icons.js";

await assertGameInitialized();
await generateItemIcons();
await generateWorldMap();
await build({ root: gameRoot, base: process.env.GAME_BASE ?? "/" });
