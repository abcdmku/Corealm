import path from "node:path";
import { pathToFileURL } from "node:url";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";

export async function captureScreenshot(runCandidate: string, name: string, preset?: string): Promise<string> {
  const runDir = await prepareRun(runCandidate);
  const server = await startGameServer();
  const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
  try {
    await driver.launch();
    await driver.open();
    if (preset) {
      await driver.callDebug("setCameraPreset", [preset]);
      await driver.wait(250);
    }
    return await driver.screenshot(path.join(runDir, "screenshots"), name);
  } finally {
    await driver.close();
    await server.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runCandidate = argValue(args, "--run");
  if (!runCandidate) throw new Error("Usage: npm run screenshot -- --run runs/<id> [--name checkpoint]");
  const file = await captureScreenshot(
    runCandidate,
    argValue(args, "--name") ?? "current",
    argValue(args, "--preset"),
  );
  console.log(file);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("screenshot capture");
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
