import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GameDriver } from "./lib/driver.js";
import { argValue, prepareRun } from "./lib/paths.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

interface ViewportResult {
  viewport: { width: number; height: number };
  loadingScreenshot: string | null;
  spawnScreenshot: string;
  mapScreenshot: string;
  detailRequestsBeforeOpen: string[];
  detailRequestsAfterOpen: string[];
  mapBounds: { x: number; y: number; width: number; height: number } | null;
  bootScreenRemoved: boolean;
  errors: { console: string[]; page: string[]; requests: string[]; game: unknown[] };
}

interface VisualAcceptanceReport {
  passed: boolean;
  desktop: ViewportResult & {
    coldRegionScreenshot: string;
    coldHydration: { entityId: string; elapsedMs: number; bounds: unknown };
  };
  mobile: ViewportResult;
}

function detailRequests(requests: string[]): string[] {
  return requests.filter((url) => url.includes("world-map-detail-"));
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilReady(driver: GameDriver, timeoutMs: number): Promise<void> {
  const page = driver.page;
  if (!page) throw new Error("Game page is unavailable.");
  await page.waitForFunction(
    () => {
      const debug = window.__gameDebug as unknown as {
        ready(): boolean;
        getState(): { ready: boolean };
      } | undefined;
      return debug?.ready() === true && debug.getState().ready === true;
    },
    undefined,
    { timeout: timeoutMs },
  );
  await driver.wait(200);
}

async function captureViewport(
  server: RunningGameServer,
  runDir: string,
  label: "desktop" | "mobile",
  viewport: { width: number; height: number },
  reuseExisting: boolean,
): Promise<{ driver: GameDriver; result: ViewportResult; requests: string[] }> {
  const driver = new GameDriver(server, { viewport });
  const requests: string[] = [];
  await driver.launch();
  const page = driver.page;
  if (!page) throw new Error("Game page is unavailable.");
  page.on("request", (request) => requests.push(request.url()));

  await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector(".boot-status", { timeout: 20_000 });
  const alreadyReady = await page.evaluate(() => window.__gameDebug?.getState().ready === true);
  const loadingFile = path.join(runDir, "screenshots", `${label}-loading.png`);
  const loadingScreenshot = alreadyReady
    ? null
    : reuseExisting && await fileExists(loadingFile)
      ? loadingFile
      : await driver.screenshot(path.join(runDir, "screenshots"), `${label}-loading`);

  await waitUntilReady(driver, 180_000);
  const bootScreenRemoved = await page.locator("#boot-screen").count() === 0;
  const beforeOpen = detailRequests(requests);
  const spawnFile = path.join(runDir, "screenshots", `${label}-spawn.png`);
  const spawnScreenshot = reuseExisting && await fileExists(spawnFile)
    ? spawnFile
    : await driver.screenshot(path.join(runDir, "screenshots"), `${label}-spawn`);

  await driver.press("m");
  await page.locator("#panel-map:not([hidden])").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => {
    const debug = window.__gameDebug as unknown as {
      getPanels(): Array<{ id: string; open: boolean }>;
    } | undefined;
    const panels = debug?.getPanels();
    return panels?.some((panel) => panel.id === "map" && panel.open) === true;
  }, undefined, { timeout: 60_000 });
  // MapPanel writes this after WorldMapCanvas.render() has selected and requested a rendition.
  // ResourceTiming is populated only when an image finishes, which can take far longer than the
  // request itself on a contended software renderer and is the wrong signal for lazy loading.
  await page.waitForFunction(() =>
    document.querySelector<HTMLElement>(".map__figure")?.dataset["mapZoom"] !== undefined,
  undefined, { timeout: 60_000 });
  await driver.wait(250);
  const mapBounds = await page.locator("#panel-map").boundingBox();
  const mapScreenshot = await driver.screenshot(path.join(runDir, "screenshots"), `${label}-map`);
  const afterOpen = detailRequests(requests);
  const gameErrors = await driver.callDebug("getErrors") as unknown[];

  return {
    driver,
    requests,
    result: {
      viewport,
      loadingScreenshot,
      spawnScreenshot,
      mapScreenshot,
      detailRequestsBeforeOpen: beforeOpen,
      detailRequestsAfterOpen: afterOpen,
      mapBounds,
      bootScreenRemoved,
      errors: {
        console: driver.consoleErrors,
        page: driver.pageErrors,
        requests: driver.requestErrors,
        game: gameErrors,
      },
    },
  };
}

async function main(): Promise<void> {
  const runCandidate = argValue(process.argv.slice(2), "--run");
  if (!runCandidate) throw new Error("Usage: npx tsx tools/visual-acceptance.ts --run runs/<id>");
  const reuseExisting = process.argv.includes("--reuse-existing");
  const runDir = await prepareRun(runCandidate);
  const server = await startGameServer();
  let desktopDriver: GameDriver | null = null;
  let mobileDriver: GameDriver | null = null;

  try {
    const desktopCapture = await captureViewport(
      server,
      runDir,
      "desktop",
      { width: 1440, height: 900 },
      reuseExisting,
    );
    desktopDriver = desktopCapture.driver;
    await desktopDriver.press("Escape");

    const entities = await desktopDriver.callDebug("getEntities") as Array<{
      id: string;
      regionId: string;
      archetype: string;
    }>;
    const coldTarget = entities.find((entity) =>
      entity.regionId === "karrowmoor" && ["npc", "station", "enemy"].includes(entity.archetype));
    if (!coldTarget) throw new Error("No Karrowmoor visual hydration target exists.");
    const hydrationStarted = performance.now();
    const teleported = await desktopDriver.callDebug("teleport", [{ entityId: coldTarget.id }]);
    if (teleported !== true) throw new Error(`Could not teleport to ${coldTarget.id}.`);
    const desktopPage = desktopDriver.page;
    if (!desktopPage) throw new Error("Desktop page is unavailable.");
    await desktopPage.waitForFunction((entityId) => {
      const debug = window.__gameDebug as unknown as {
        getState(): { regionId: string };
        getDrawnBounds(id: string): unknown;
      } | undefined;
      return debug?.getState().regionId === "karrowmoor" && debug.getDrawnBounds(entityId) !== null;
    }, coldTarget.id, { timeout: 60_000 });
    const coldBounds = await desktopDriver.callDebug("getDrawnBounds", [coldTarget.id]);
    const coldHydration = {
      entityId: coldTarget.id,
      elapsedMs: Math.round((performance.now() - hydrationStarted) * 10) / 10,
      bounds: coldBounds,
    };
    const coldRegionScreenshot = await desktopDriver.screenshot(
      path.join(runDir, "screenshots"),
      "desktop-cold-region",
    );

    const mobileCapture = await captureViewport(
      server,
      runDir,
      "mobile",
      { width: 390, height: 844 },
      reuseExisting,
    );
    mobileDriver = mobileCapture.driver;

    const desktop = { ...desktopCapture.result, coldRegionScreenshot, coldHydration };
    const mobile = mobileCapture.result;
    const noErrors = [desktop.errors, mobile.errors].every((errors) =>
      errors.console.length + errors.page.length + errors.requests.length + errors.game.length === 0);
    const mapIsLazy = desktop.detailRequestsBeforeOpen.length === 0
      && mobile.detailRequestsBeforeOpen.length === 0
      && desktop.detailRequestsAfterOpen.length > 0
      && mobile.detailRequestsAfterOpen.length > 0;
    const mobileMapFits = mobile.mapBounds !== null
      && mobile.mapBounds.x >= -1
      && mobile.mapBounds.width <= mobile.viewport.width + 1;
    const hydrationIsReal = coldBounds !== null
      && !JSON.stringify(coldBounds).toLowerCase().includes("placeholder");
    const report: VisualAcceptanceReport = {
      passed: noErrors && mapIsLazy && mobileMapFits && hydrationIsReal
        && desktop.bootScreenRemoved && mobile.bootScreenRemoved,
      desktop,
      mobile,
    };
    await writeFile(
      path.join(runDir, "test-results", "visual-acceptance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    await mobileDriver?.close();
    await desktopDriver?.close();
    await server.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
