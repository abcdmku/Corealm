/** Fast real-Chromium gate for the isolated realtime structure authoring loop. */
import { chromium, type Page } from "playwright";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

interface StructureSelection {
  kind: "prefab" | "composition" | "wall-run";
  id: string;
  kit: string;
  width: number;
  depth: number;
  seed: number;
}

interface StructurePreviewState {
  ready: boolean;
  revision: number;
  frames: number;
  partCount: number;
  assetCount: number;
  buildMs: number;
  variant: string | null;
  selection: StructureSelection;
  errors: string[];
}

interface StructurePreviewApi {
  getState(): StructurePreviewState;
  setSelection(patch: Partial<StructureSelection>): Promise<StructurePreviewState>;
}

const TOTAL_BUDGET_MS = 45_000;
const COLD_BUDGET_MS = 20_000;
const REBUILD_BUDGET_MS = 5_000;
const started = performance.now();
const clearDeadline = installTestDeadline("structure preview browser gate", TOTAL_BUDGET_MS);
const server = await startGameServer({ logLevel: "error" });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 });
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(String(error)));

function stateInPage(): StructurePreviewState {
  const api = Reflect.get(window, "__structurePreview") as StructurePreviewApi | undefined;
  if (!api) throw new Error("window.__structurePreview is unavailable");
  return api.getState();
}

async function readState(target: Page): Promise<StructurePreviewState> {
  return target.evaluate(stateInPage);
}

async function rebuild(
  target: Page,
  beforeRevision: number,
  patch: Partial<StructureSelection>,
): Promise<{ state: StructurePreviewState; wallMs: number }> {
  const operationStarted = performance.now();
  await target.evaluate(async (value) => {
    const api = Reflect.get(window, "__structurePreview") as StructurePreviewApi | undefined;
    if (!api) throw new Error("window.__structurePreview is unavailable");
    await api.setSelection(value);
  }, patch);
  await target.waitForFunction((revision) => {
    const api = Reflect.get(window, "__structurePreview") as StructurePreviewApi | undefined;
    const state = api?.getState();
    return state?.ready === true && state.revision > revision;
  }, beforeRevision, { timeout: REBUILD_BUDGET_MS });
  return { state: await readState(target), wallMs: performance.now() - operationStarted };
}

let lastState: StructurePreviewState | null = null;
try {
  const coldStarted = performance.now();
  await page.goto(`${server.url}/structure-preview.html?mode=structures&id=cottage&kit=plaster&width=6&depth=4&seed=0`, {
    waitUntil: "load",
    timeout: COLD_BUDGET_MS,
  });
  await page.waitForFunction(() => {
    const api = Reflect.get(window, "__structurePreview") as StructurePreviewApi | undefined;
    const state = api?.getState();
    return state?.ready === true && state.selection.id === "cottage" && state.frames > 2;
  }, undefined, { timeout: COLD_BUDGET_MS });
  const cottage = await readState(page);
  const coldMs = performance.now() - coldStarted;

  const gatehouse = await rebuild(page, cottage.revision, {
    kind: "prefab", id: "gatehouse", kit: "stone", width: 8, depth: 4, seed: 3,
  });
  const composition = await rebuild(page, gatehouse.state.revision, {
    kind: "composition", id: "region_gate", kit: "timber", seed: 4,
  });
  const wallRun = await rebuild(page, composition.state.revision, {
    kind: "wall-run", id: "wall_run", kit: "timber", width: 18, depth: 4, seed: 2,
  });
  lastState = wallRun.state;

  const framesBefore = wallRun.state.frames;
  await page.waitForTimeout(120);
  const live = await readState(page);
  const canvas = await page.locator("#structure-viewport").evaluate((node) => {
    const value = node as HTMLCanvasElement;
    return { width: value.width, height: value.height, webgl: Boolean(value.getContext("webgl2")) };
  });
  const actorRoute = await page.locator('#lab-mode option[value="actors"]').count();

  const rows = [cottage, gatehouse.state, composition.state, wallRun.state];
  const rebuilds = [gatehouse.wallMs, composition.wallMs, wallRun.wallMs];
  const checks = {
    isolatedStructureRuntime: typeof (await page.evaluate(() => Reflect.get(window, "__featureLab"))) === "undefined",
    productionStructuresBuilt: rows.every((state) => state.ready && state.partCount > 0 && state.assetCount > 0),
    allAuthoringKinds: gatehouse.state.selection.kind === "prefab"
      && composition.state.selection.kind === "composition"
      && wallRun.state.selection.kind === "wall-run",
    revisionsAdvance: gatehouse.state.revision > cottage.revision
      && composition.state.revision > gatehouse.state.revision
      && wallRun.state.revision > composition.state.revision,
    realtimeLoop: live.frames > framesBefore,
    rendererActive: canvas.webgl && canvas.width > 0 && canvas.height > 0,
    actorRouteAdvertised: actorRoute === 1,
    latencyBudgets: coldMs <= COLD_BUDGET_MS && rebuilds.every((duration) => duration <= REBUILD_BUDGET_MS),
    noErrors: rows.flatMap((state) => state.errors).length === 0
      && consoleErrors.length === 0
      && pageErrors.length === 0,
  };
  const passed = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({
    passed,
    elapsedMs: Math.round(performance.now() - started),
    timings: {
      coldMs: Math.round(coldMs),
      rebuildMs: rebuilds.map(Math.round),
      internalBuildMs: rows.map((state) => Math.round(state.buildMs)),
    },
    checks,
    evidence: rows.map((state) => ({
      kind: state.selection.kind,
      id: state.selection.id,
      revision: state.revision,
      parts: state.partCount,
      assets: state.assetCount,
    })),
    errors: { console: consoleErrors, page: pageErrors },
  }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (cause) {
  lastState = await readState(page).catch(() => null);
  console.error(JSON.stringify({
    passed: false,
    elapsedMs: Math.round(performance.now() - started),
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
