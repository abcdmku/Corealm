import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 400, height: 300 } });
try {
  await driver.launch();
  await driver.open();
  const a = await driver.page!.evaluate("(function(arg){ return { got: arg, hook: typeof window.__probeRenderer }; })", { pts: [[1, 2]] });
  console.log("A", JSON.stringify(a));
} finally { await driver.close(); await server.close(); }
