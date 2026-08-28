import { startGameServer } from "./lib/server.js";

const server = await startGameServer({ port: 4173, strictPort: true, logLevel: "info" });
console.log(`Game available at ${server.url}`);

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise<void>(() => undefined);
