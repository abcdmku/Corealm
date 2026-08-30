/** Real-browser acceptance check for the guide camera and synchronous WebGL frame path. */
import { pathToFileURL } from "node:url";
import { installTestDeadline } from "./lib/deadline.js";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";

interface Position {
  x: number;
  y: number;
  z: number;
}

function moved(before: Position, after: Position): boolean {
  return Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) > 0.01;
}

async function main(): Promise<void> {
  const server = await startGameServer();
  const driver = new GameDriver(server, { viewport: { width: 960, height: 540 } });
  try {
    await driver.launch();
    await driver.open(120_000);
    const before = await driver.callDebug("getPlayerPosition") as Position;

    await driver.callDebug("setCaptureMode", [true]);
    if (await driver.callDebug("focusEntity", ["npc_smith_harrow"]) !== true) {
      throw new Error("The documentation camera could not focus an NPC.");
    }
    const atNpc = await driver.callDebug("getPlayerPosition") as Position;
    if (!moved(before, atNpc)) throw new Error("Focusing an NPC did not change semantic player position.");

    const frame = await driver.callDebug("captureDocumentationFrame") as string;
    if (!frame.startsWith("data:image/png;base64,") || frame.length < 10_000) {
      throw new Error("The running game did not return a populated PNG frame.");
    }

    if (await driver.callDebug("focusLocation", ["great_cairn"]) !== true) {
      throw new Error("The documentation camera could not focus a location.");
    }
    const atLocation = await driver.callDebug("getPlayerPosition") as Position;
    if (!moved(atNpc, atLocation)) throw new Error("Focusing a location did not change semantic player position.");

    const errors = await driver.callDebug("getErrors") as unknown[];
    if (errors.length > 0 || driver.consoleErrors.length || driver.pageErrors.length || driver.requestErrors.length) {
      throw new Error("The game reported an error during documentation camera acceptance.");
    }
    console.log("Documentation camera moved through semantic state and returned a live WebGL frame.");
  } finally {
    await driver.callDebug("setCaptureMode", [false]).catch(() => undefined);
    await driver.close();
    await server.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("documentation camera smoke test");
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
