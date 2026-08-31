import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { FAST_TEST_SETTINGS, GameDriver, type RuntimeSnapshot } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";

export interface SmokeReport {
  passed: boolean;
  checks: Record<string, boolean>;
  initial: RuntimeSnapshot | null;
  afterInput: RuntimeSnapshot | null;
  afterReset: RuntimeSnapshot | null;
  errors: { console: string[]; page: string[]; requests: string[] };
  durationMs: number;
}

const REQUIRED_METHODS = [
  "getState",
  "getPlayer",
  "getPlayerPosition",
  "getCamera",
  "getEntities",
  "getCurrentActivity",
  "getObjectives",
  "getNavigationState",
  "reset",
] as const;

export async function runSmokeTest(runCandidate: string): Promise<SmokeReport> {
  const started = Date.now();
  const runDir = await prepareRun(runCandidate);
  const server = await startGameServer();
  const driver = new GameDriver(server, {
    // The smoke gate proves renderer startup and gameplay state transitions, not visual quality.
    // Keep software-rendered CI fast enough to remain a useful per-change check.
    settings: FAST_TEST_SETTINGS,
  });
  const report: SmokeReport = {
    passed: false,
    checks: {},
    initial: null,
    afterInput: null,
    afterReset: null,
    errors: { console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors },
    durationMs: 0,
  };

  try {
    await driver.launch();
    // Cold SwiftShader boots vary substantially across hosted and local runners.
    await driver.open(120_000);
    report.initial = await driver.snapshot();

    const browserFacts = await driver.page!.evaluate((methods) => {
      const api = window.__gameDebug as unknown as Record<string, unknown> | undefined;
      const canvas = document.querySelector("canvas");
      return {
        readyState: document.readyState,
        canvas: canvas instanceof HTMLCanvasElement,
        webgl: canvas instanceof HTMLCanvasElement && Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl")),
        methods: Object.fromEntries(methods.map((name) => [name, typeof api?.[name] === "function"])),
      };
    }, REQUIRED_METHODS);

    report.checks.pageLoads = browserFacts.readyState === "complete";
    report.checks.rendererInitializes = browserFacts.canvas && browserFacts.webgl;
    report.checks.debugApiExists = REQUIRED_METHODS.every((method) => browserFacts.methods[method]);
    report.checks.playerFinite = finiteValue(report.initial.player) && finiteValue(report.initial.playerPosition);
    report.checks.cameraFinite = finiteValue(report.initial.camera);
    report.checks.navigationReady = navigationReady(report.initial.navigation);

    await driver.click(640, 360);
    await driver.press("w", 700);
    await driver.wait(120);
    report.afterInput = await driver.snapshot();
    report.checks.inputChangesState = moved(report.initial.playerPosition, report.afterInput.playerPosition);

    await driver.reset();
    report.afterReset = await driver.snapshot();
    report.checks.resetWorks = samePosition(report.initial.playerPosition, report.afterReset.playerPosition)
      && JSON.stringify(report.initial.objectives) === JSON.stringify(report.afterReset.objectives);
    report.checks.noFatalErrors = driver.consoleErrors.length === 0
      && driver.pageErrors.length === 0
      && driver.requestErrors.length === 0;
    report.passed = Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.errors.page.push(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    await driver.close();
    await server.close();
    report.durationMs = Date.now() - started;
  }

  await writeFile(path.join(runDir, "test-results", "smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function finiteValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteValue);
  if (value && typeof value === "object") return Object.values(value).every(finiteValue);
  return true;
}

function point(value: unknown): { x: number; y: number; z: number } | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  return typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number"
    ? { x: p.x, y: p.y, z: p.z }
    : null;
}

function moved(before: unknown, after: unknown): boolean {
  const a = point(before);
  const b = point(after);
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.z - b.z) > 0.1;
}

function samePosition(before: unknown, after: unknown): boolean {
  const a = point(before);
  const b = point(after);
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.05;
}

function navigationReady(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>).status === "ready";
}

async function main(): Promise<void> {
  const runCandidate = argValue(process.argv.slice(2), "--run");
  if (!runCandidate) throw new Error("Usage: npm run smoke -- --run runs/<id>");
  const report = await runSmokeTest(runCandidate);
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, errors: report.errors }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("smoke test");
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
