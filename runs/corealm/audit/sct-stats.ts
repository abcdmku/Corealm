import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import fs from "node:fs";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch();
await driver.open();
const page = (driver as any).page;

const out = await page.evaluate(() => {
  const d: any = (window as any).__gameDebug;
  return {
    scatter: d.getScatterStats(),
    scene: d.getSceneStats(),
    errors: d.getErrors(),
  };
});

const label = process.argv[2] ?? "baseline";
fs.writeFileSync(`runs/corealm/audit/sct-stats-${label}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.scatter, null, 1));
console.log("scene", JSON.stringify(out.scene));
console.log("errors", JSON.stringify(out.errors).slice(0, 600));
await driver.close();
await server.close();
