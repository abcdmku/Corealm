import { build } from "vite";
import { gameRoot } from "./lib/paths.js";
import { assertGameInitialized } from "./lib/server.js";

await assertGameInitialized();
await build({ root: gameRoot, base: process.env.GAME_BASE ?? "/" });
