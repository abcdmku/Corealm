/** Compatibility gate for the retired standalone structure preview URL. */
import { chromium } from "playwright";
import type { FeatureLabCatalog, FeatureLabState } from "../game/src/contracts.js";
import { installTestDeadline } from "./lib/deadline.js";
import { startGameServer } from "./lib/server.js";

const TOTAL_BUDGET_MS = 45_000;
const READY_BUDGET_MS = 20_000;
const started = performance.now();
const clearDeadline = installTestDeadline("building lab compatibility gate", TOTAL_BUDGET_MS);
const server = await startGameServer({ logLevel: "error" });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));

const expectedSelection = {
  kind: "prefab",
  id: "gatehouse",
  kit: "stone",
  width: 8,
  depth: 4,
  seed: 3,
} as const;
const legacyUrl = new URL("/structure-preview.html", server.url);
legacyUrl.search = new URLSearchParams({
  mode: "structures",
  kind: expectedSelection.kind,
  id: expectedSelection.id,
  kit: expectedSelection.kit,
  width: String(expectedSelection.width),
  depth: String(expectedSelection.depth),
  seed: String(expectedSelection.seed),
}).toString();

let lastState: FeatureLabState | null = null;
try {
  await page.goto(legacyUrl.href, {
    waitUntil: "domcontentloaded",
    timeout: READY_BUDGET_MS,
  });
  await page.waitForURL((url) => (
    url.pathname.endsWith("/index.html") && url.searchParams.get("mode") === "building"
  ), { timeout: READY_BUDGET_MS });
  await page.waitForFunction((selection) => {
    const api = window.__featureLab;
    const state = api?.getState();
    return state?.ready === true
      && state.engine === "corealm-production"
      && state.world === "fallowmarch-yard"
      && state.mode === "building"
      && state.structure.ready === true
      && state.structure.selection.kind === selection.kind
      && state.structure.selection.id === selection.id
      && state.structure.selection.kit === selection.kit
      && state.structure.selection.width === selection.width
      && state.structure.selection.depth === selection.depth
      && state.structure.selection.seed === selection.seed;
  }, expectedSelection, { timeout: READY_BUDGET_MS });

  const evidence = await page.evaluate(() => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable after the legacy redirect");
    const debug = Reflect.get(window, "__gameDebug") as {
      getState?: () => { ready?: boolean; navStatus?: string };
    } | undefined;
    const canvas = document.getElementById("viewport");
    return {
      state: api.getState(),
      catalog: api.getCatalog(),
      debugState: debug?.getState?.() ?? null,
      canvas: canvas instanceof HTMLCanvasElement
        ? {
          width: canvas.width,
          height: canvas.height,
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight,
        }
        : null,
      legacyApiPresent: Reflect.has(window, "__structurePreview"),
      bodyProfile: document.body.dataset["bootProfile"] ?? null,
    };
  });
  lastState = evidence.state;

  const finalUrl = new URL(page.url());
  const queryPreserved = Object.entries(expectedSelection).every(([key, value]) => (
    finalUrl.searchParams.get(key) === String(value)
  ));
  const structure = evidence.state.structure;
  const checks = {
    legacyRouteRedirects: finalUrl.pathname.endsWith("/index.html")
      && finalUrl.searchParams.get("mode") === "building",
    selectionQueryPreserved: queryPreserved,
    productionLabBooted: evidence.state.ready
      && evidence.state.engine === "corealm-production"
      && evidence.bodyProfile === "feature-lab",
    sharedWorldSelected: evidence.state.world === "fallowmarch-yard"
      && evidence.state.mode === "building",
    requestedStructureSelected: sameSelection(structure.selection, expectedSelection),
    productionStructureReady: structure.ready
      && structure.revision > 0
      && structure.partCount > 0
      && structure.assetCount > 0
      && structure.collisionCount > 0
      && structure.bounds !== null,
    structureCatalogAvailable: hasStructureCatalog(evidence.catalog),
    productionCanvasActive: evidence.canvas !== null
      && evidence.canvas.width > 0
      && evidence.canvas.height > 0
      && evidence.canvas.clientWidth > 0
      && evidence.canvas.clientHeight > 0,
    productionDebugReady: evidence.debugState?.ready === true
      && evidence.debugState.navStatus === "ready",
    legacyRuntimeRetired: !evidence.legacyApiPresent,
    noErrors: evidence.state.errors.length === 0
      && consoleErrors.length === 0
      && pageErrors.length === 0,
    under45Seconds: performance.now() - started < TOTAL_BUDGET_MS,
  };
  const passed = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({
    passed,
    elapsedMs: Math.round(performance.now() - started),
    legacyUrl: legacyUrl.href,
    finalUrl: finalUrl.href,
    checks,
    evidence: {
      world: evidence.state.world,
      mode: evidence.state.mode,
      walkingEnabled: evidence.state.walkingEnabled,
      structure,
      canvas: evidence.canvas,
      debugState: evidence.debugState,
    },
    errors: {
      lab: evidence.state.errors,
      console: consoleErrors,
      page: pageErrors,
    },
  }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (cause) {
  lastState = await page.evaluate(() => window.__featureLab?.getState() ?? null).catch(() => lastState);
  console.error(JSON.stringify({
    passed: false,
    elapsedMs: Math.round(performance.now() - started),
    legacyUrl: legacyUrl.href,
    finalUrl: page.url(),
    failure: cause instanceof Error ? cause.stack ?? cause.message : String(cause),
    lastState,
    errors: { console: consoleErrors, page: pageErrors },
  }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => undefined);
  await server.close().catch(() => undefined);
  clearDeadline();
}

function sameSelection(
  actual: FeatureLabState["structure"]["selection"],
  expected: typeof expectedSelection,
): boolean {
  return actual.kind === expected.kind
    && actual.id === expected.id
    && actual.kit === expected.kit
    && actual.width === expected.width
    && actual.depth === expected.depth
    && actual.seed === expected.seed;
}

function hasStructureCatalog(catalog: FeatureLabCatalog): boolean {
  return catalog.structures.prefabs.some((row) => row.id === expectedSelection.id)
    && catalog.structures.compositions.length > 0
    && catalog.structures.kits.some((row) => row.id === expectedSelection.kit);
}
