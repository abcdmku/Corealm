/**
 * Worker key ev2. A vite server with HMR and file watching OFF.
 *
 * Eight agents are editing game/src at the same time; with the shared `startGameServer` a save in
 * someone else's file navigates the page mid-measurement ("Execution context was destroyed").
 * The module graph is read once at request time, so a run is a snapshot of the tree at launch.
 */
import { createServer, type ViteDevServer } from "vite";
import { gameRoot } from "../../../tools/lib/paths.js";

export async function startFrozenServer(): Promise<{ url: string; close(): Promise<void> }> {
  const vite: ViteDevServer = await createServer({
    root: gameRoot,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      watch: null,
    },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === "string") { await vite.close(); throw new Error("no port"); }
  return { url: `http://127.0.0.1:${address.port}`, close: async () => vite.close() };
}
