import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { GameDriver, type RuntimeSnapshot } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun, repoRoot, resolveInside, safeName } from "./lib/paths.js";

type MouseButton = "left" | "right" | "middle";

type PlayAction =
  | { key: string; holdMs?: number; label?: string }
  | { click: [number, number]; button?: MouseButton; label?: string }
  | { drag: [number, number, number, number]; button?: MouseButton; label?: string }
  | { mouse: [number, number]; label?: string }
  | { waitMs: number; label?: string }
  | { debug: string; args?: unknown[]; label?: string }
  | { inspect: string; label?: string }
  | { screenshot: string; label?: string }
  | { reset: true; label?: string }
  | { reload: true; label?: string };

interface PlayScenario {
  name: string;
  actions: PlayAction[];
}

export interface PlayStep {
  index: number;
  action: PlayAction;
  before: RuntimeSnapshot;
  after: RuntimeSnapshot;
  changed: boolean;
  result?: unknown;
  screenshot?: string;
  error?: string;
}

export interface PlayReport {
  scenario: string;
  startedAt: string;
  initial: RuntimeSnapshot | null;
  actions: PlayStep[];
  final: RuntimeSnapshot | null;
  errors: { console: string[]; page: string[]; requests: string[] };
  screenshots: string[];
  passed: boolean;
}

const MAX_ACTIONS = 50;
const MAX_WAIT_MS = 10_000;

export async function runPlayScenario(runCandidate: string, scenarioCandidate: string): Promise<PlayReport> {
  const runDir = await prepareRun(runCandidate);
  const scenarioPath = resolveInside(repoRoot, scenarioCandidate);
  const scenario = validateScenario(JSON.parse(await readFile(scenarioPath, "utf8")) as unknown);
  const server = await startGameServer();
  const driver = new GameDriver(server);
  const report: PlayReport = {
    scenario: scenario.name,
    startedAt: new Date().toISOString(),
    initial: null,
    actions: [],
    final: null,
    errors: { console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors },
    screenshots: [],
    passed: false,
  };

  try {
    await driver.launch();
    await driver.open(120_000);
    report.initial = await driver.snapshot();

    for (let index = 0; index < scenario.actions.length; index += 1) {
      const action = scenario.actions[index]!;
      const before = await driver.snapshot();
      const step: PlayStep = { index: index + 1, action, before, after: before, changed: false };
      try {
        if ("key" in action) await driver.press(action.key, boundedWait(action.holdMs ?? 0));
        else if ("click" in action) await driver.click(...action.click, action.button);
        else if ("drag" in action) await driver.drag(...action.drag, action.button);
        else if ("mouse" in action) await driver.moveMouse(...action.mouse);
        else if ("waitMs" in action) await driver.wait(boundedWait(action.waitMs));
        else if ("debug" in action) step.result = await driver.callDebug(action.debug, action.args ?? []);
        else if ("inspect" in action) step.result = await driver.callDebug(action.inspect);
        else if ("screenshot" in action) {
          step.screenshot = await driver.screenshot(path.join(runDir, "screenshots"), action.screenshot);
          report.screenshots.push(step.screenshot);
        } else if ("reset" in action) await driver.reset();
        else if ("reload" in action) await driver.reload();
        if (!("waitMs" in action)) await driver.wait(120);
      } catch (error) {
        step.error = error instanceof Error ? error.message : String(error);
      }
      step.after = await driver.snapshot();
      step.changed = semanticFingerprint(step.before) !== semanticFingerprint(step.after);
      report.actions.push(step);
    }

    report.final = await driver.snapshot();
    report.passed = report.actions.every((step) => !step.error) && driver.consoleErrors.length === 0 && driver.pageErrors.length === 0;
  } finally {
    await driver.close();
    await server.close();
  }

  const output = path.join(runDir, "test-results", `play-${safeName(scenario.name)}.json`);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function boundedWait(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_WAIT_MS) {
    throw new Error(`Action duration must be between 0 and ${MAX_WAIT_MS} ms`);
  }
  return value;
}

function validateScenario(input: unknown): PlayScenario {
  if (!input || typeof input !== "object") throw new Error("Scenario must be an object");
  const value = input as Partial<PlayScenario>;
  if (typeof value.name !== "string" || value.name.length === 0) throw new Error("Scenario needs a name");
  if (!Array.isArray(value.actions) || value.actions.length === 0 || value.actions.length > MAX_ACTIONS) {
    throw new Error(`Scenario needs 1 to ${MAX_ACTIONS} actions`);
  }
  return value as PlayScenario;
}

function semanticFingerprint(snapshot: RuntimeSnapshot): string {
  const state = structuredClone(snapshot.state) as Record<string, unknown> | null;
  if (state && typeof state === "object") {
    delete state.clock;
    delete state.renderer;
  }
  return JSON.stringify({
    state,
    playerPosition: snapshot.playerPosition,
    camera: snapshot.camera,
    entities: snapshot.entities,
    currentActivity: snapshot.currentActivity,
    objectives: snapshot.objectives,
    navigation: snapshot.navigation,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runCandidate = argValue(args, "--run");
  const scenarioCandidate = argValue(args, "--scenario");
  if (!runCandidate || !scenarioCandidate) {
    throw new Error("Usage: npm run play -- --run runs/<id> --scenario <file>");
  }
  const report = await runPlayScenario(
    runCandidate,
    scenarioCandidate,
  );
  console.log(JSON.stringify({
    scenario: report.scenario,
    passed: report.passed,
    actions: report.actions.map((step) => ({
      index: step.index,
      label: step.action.label,
      changed: step.changed,
      error: step.error,
      screenshot: step.screenshot,
    })),
    errors: report.errors,
    screenshots: report.screenshots,
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
