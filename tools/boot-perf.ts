/**
 * Cold production-boot recorder.
 *
 * This is a measurement tool, not a Wave 0 gate. It records the proposed budgets and whether the
 * current sample meets them, but budget misses do not set a failing exit code.
 *
 * Usage:
 *   npx tsx tools/boot-perf.ts --run runs/<id> [--boots 5] [--timeout-ms 120000] [--base /Corealm/]
 *
 * Build first with `npm run build`. Every sample launches a fresh Chromium process and blocks
 * service workers, so neither the HTTP cache nor a previous worker can make a later boot warm.
 */
import path from "node:path";
import { access, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page, type Request } from "playwright";
import { preview, type PreviewServer } from "vite";
import { assertGameInitialized, type RunningGameServer } from "./lib/server.js";
import { argValue, gameRoot, prepareRun } from "./lib/paths.js";
import type {} from "./lib/debug-api.js";

const DEFAULT_BOOTS = 5;
const DEFAULT_TIMEOUT_MS = 120_000;
const ATTRIBUTION_GAP_MS = 2_000;
const OUTPUT_NAME = "boot-performance.json";
const MODEL_PATTERN = /\.(?:glb|gltf)(?:$|[?#])/i;
const ASSET_PATTERN = /(?:\.(?:avif|bin|css|glb|gltf|gif|jpe?g|json|ktx2?|mp3|ogg|png|svg|wasm|webm|webp|woff2?)(?:$|[?#]))|(?:\/assets\/)/i;

const CHROMIUM_ARGS = [
  "--enable-unsafe-swiftshader",
  "--enable-precise-memory-info",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--no-first-run",
  "--mute-audio",
];

const REQUIRED_TIMELINE_SPANS = [
  { id: "javascript-evaluation", patterns: [/javascript.*evaluat/, /js.*evaluat/] },
  { id: "wasm-initialization", patterns: [/wasm.*init/, /physics.*init.*library/, /navigation.*init.*library/] },
  { id: "manifest-loading", patterns: [/manifest.*load/] },
  { id: "animation-loading", patterns: [/animation.*load/] },
  { id: "terrain-build", patterns: [/terrain.*build/] },
  { id: "terrain-restamp", patterns: [/terrain.*restamp/, /restamp.*terrain/] },
  { id: "navigation-build-or-import", patterns: [/navigation.*(?:build|import)/, /navmesh.*(?:build|import)/] },
  { id: "scatter-candidates", patterns: [/scatter.*candidate/] },
  { id: "scatter-mesh-construction", patterns: [/scatter.*mesh/] },
  { id: "entity-preload", patterns: [/entit.*preload/] },
  { id: "gltf-parse", patterns: [/gltf.*parse/] },
  { id: "first-entity-sync", patterns: [/first.*entit.*sync/, /entit.*first.*sync/] },
  { id: "player-construction", patterns: [/player.*construct/] },
  { id: "ui-construction", patterns: [/(?:^|\.)ui.*construct/, /user.*interface.*construct/] },
  { id: "shader-compilation", patterns: [/shader.*compil/, /shader.*warm/] },
  { id: "boot-screen-removal", patterns: [/boot.*screen.*remov/] },
  { id: "first-rendered-frame", patterns: [/first.*render.*frame/, /boot.*frame.*first/] },
] as const;

/** Installed before application code. Kept as source text to avoid build-tool helper injection. */
const PAGE_RECORDER_SOURCE = String.raw`(() => {
  const harness = {
    schemaVersion: 1,
    installedAtMs: performance.now(),
    firstHarnessAnimationFrameAtMs: null,
    firstPlayableAtMs: null,
    bootScreenRemovedAtMs: null,
    bootScreenSeen: false,
    longTasks: [],
    longTaskObserver: null,
  };

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        harness.longTasks.push({
          name: entry.name,
          startMs: entry.startTime,
          durationMs: entry.duration,
          endMs: entry.startTime + entry.duration,
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    harness.longTaskObserver = observer;
  } catch {
    // Long Task timing is Chromium-only. The report calls out an unavailable observer.
  }

  function sampleFrame(now) {
    if (harness.firstHarnessAnimationFrameAtMs === null) harness.firstHarnessAnimationFrameAtMs = now;
    const bootScreen = document.getElementById("boot-screen");
    if (bootScreen) harness.bootScreenSeen = true;
    else if (harness.bootScreenSeen && harness.bootScreenRemovedAtMs === null) {
      harness.bootScreenRemovedAtMs = performance.now();
    }

    try {
      if (harness.firstPlayableAtMs === null && window.__gameDebug?.getState?.().ready === true) {
        harness.firstPlayableAtMs = performance.now();
      }
    } catch {
      // A debug method throwing during replacement should not break the recorder.
    }
    requestAnimationFrame(sampleFrame);
  }
  requestAnimationFrame(sampleFrame);
  window.__corealmBootPerfHarness = harness;
})();`;

interface HarnessLongTask {
  name: string;
  startMs: number;
  durationMs: number;
  endMs: number;
}

export interface BootResourceRecord {
  name: string;
  initiatorType: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  deliveryType?: string;
  nextHopProtocol?: string;
  responseStatus?: number;
  preReady: boolean;
  detail?: unknown;
}

export interface BootSpanRecord {
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  detail?: unknown;
}

interface TimelineGap {
  startMs: number;
  endMs: number;
  durationMs: number;
}

interface RequestRecord {
  name: string;
  method: string;
  resourceType: string;
  startEpochMs: number | null;
  startMs: number | null;
  status: number | null;
  contentLength: number | null;
  failed: string | null;
  preReady: boolean;
}

export interface BootRunReport {
  run: number;
  startedAt: string;
  durationMs: number;
  ready: boolean;
  firstPlayableMs: number | null;
  firstPlayableSource: "telemetry" | "harness" | "runner" | "unavailable";
  bootScreenRemovedAtMs: number | null;
  navigation: Record<string, unknown> | null;
  paints: Array<{ name: string; startMs: number; durationMs: number }>;
  milestones: BootSpanRecord[];
  marks: Array<{ name: string; atMs: number; detail?: unknown }>;
  telemetry: {
    available: boolean;
    schemaVersion: unknown;
    sessionId: unknown;
    snapshot: unknown;
    attribution: unknown;
    instrumentationOverheadMs: number | null;
    instrumentationOperations: number | null;
    activeSpanCount: number;
  };
  attribution: {
    coveredMs: number;
    unattributedMs: number | null;
    coverageRatio: number | null;
    gaps: TimelineGap[];
    unexplainedMultiSecondGaps: TimelineGap[];
    missingRequiredSpans: string[];
    issues: string[];
    complete: boolean;
  };
  longTasks: HarnessLongTask[];
  approximateTbtMs: number;
  longestTaskMs: number;
  resources: BootResourceRecord[];
  browserResources: BootResourceRecord[];
  requests: RequestRecord[];
  preReadyRequests: RequestRecord[];
  totals: {
    resourceRequests: number;
    preReadyRequests: number;
    preReadyAssetRequests: number;
    preReadyModelRequests: number;
    transferBytes: number;
    preReadyTransferBytes: number;
    modelTransferBytes: number;
    javascriptTransferBytes: number;
    wasmTransferBytes: number;
  };
  metrics: {
    heapMB: number | null;
    drawCalls: number | null;
    triangles: number | null;
    programs: number | null;
    raw: Record<string, number>;
  };
  errors: {
    console: string[];
    page: string[];
    requests: string[];
    game: unknown[];
    runner: string[];
  };
}

interface SummaryMetric {
  samples: number;
  median: number | null;
  worst: number | null;
}

interface BudgetResult {
  id: string;
  label: string;
  aggregation: "median" | "worst";
  unit: "ms" | "bytes" | "requests";
  limit: number;
  observed: number | null;
  met: boolean | null;
}

export interface BootPerfReport {
  schemaVersion: 1;
  kind: "corealm-production-boot-performance";
  startedAt: string;
  finishedAt: string;
  production: { base: string; url: string; distIndex: string };
  configuration: {
    requestedBoots: number;
    timeoutMs: number;
    coldBrowserPerRun: true;
    serviceWorkers: "block";
    viewport: { width: number; height: number };
  };
  runs: BootRunReport[];
  summary: {
    completedBoots: number;
    readyBoots: number;
    firstPlayableMs: SummaryMetric;
    approximateTbtMs: SummaryMetric;
    longestTaskMs: SummaryMetric;
    preReadyRequests: SummaryMetric;
    preReadyModelRequests: SummaryMetric;
    transferBytes: SummaryMetric;
    errorCount: number;
    milestoneDurations: Record<string, SummaryMetric>;
  };
  budgets: {
    enforced: false;
    note: string;
    results: BudgetResult[];
  };
}

interface PageCapture {
  nowMs: number;
  timeOrigin: number;
  ready: boolean;
  readyDetectedAtMs: number | null;
  bootScreenRemovedAtMs: number | null;
  longTaskObserverAvailable: boolean;
  longTasks: HarnessLongTask[];
  resources: BootResourceRecord[];
  navigation: Record<string, unknown> | null;
  paints: Array<{ name: string; startMs: number; durationMs: number }>;
  metrics: Record<string, number>;
  gameErrors: unknown[];
  telemetrySnapshot: unknown;
  telemetryAttribution: unknown;
}

declare global {
  interface Window {
    __corealmBootPerfHarness?: {
      firstPlayableAtMs: number | null;
      bootScreenRemovedAtMs: number | null;
      longTasks: HarnessLongTask[];
      longTaskObserver: PerformanceObserver | null;
    };
    __corealmBootTelemetry?: {
      snapshot?: () => unknown | Promise<unknown>;
      getAttribution?: (options?: unknown) => unknown | Promise<unknown>;
    };
  }
}

export async function runBootPerformance(
  runCandidate: string,
  bootCount = DEFAULT_BOOTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  requestedBase?: string,
): Promise<BootPerfReport> {
  validatePositiveInteger(bootCount, "--boots");
  validatePositiveInteger(timeoutMs, "--timeout-ms");

  const startedAt = new Date().toISOString();
  const runDir = await prepareRun(runCandidate);
  const { server, base, distIndex } = await startProductionServer(requestedBase);
  const report: BootPerfReport = {
    schemaVersion: 1,
    kind: "corealm-production-boot-performance",
    startedAt,
    finishedAt: startedAt,
    production: { base, url: server.url, distIndex },
    configuration: {
      requestedBoots: bootCount,
      timeoutMs,
      coldBrowserPerRun: true,
      serviceWorkers: "block",
      viewport: { width: 1440, height: 900 },
    },
    runs: [],
    summary: emptySummary(),
    budgets: { enforced: false, note: "Wave 0 records budget misses but does not fail on them.", results: [] },
  };

  try {
    for (let run = 1; run <= bootCount; run += 1) {
      report.runs.push(await measureColdBoot(server.url, run, timeoutMs, report.configuration.viewport));
    }
  } finally {
    await server.close();
  }

  report.finishedAt = new Date().toISOString();
  report.summary = summarize(report.runs);
  report.budgets.results = budgetResults(report.summary);
  await writeFile(path.join(runDir, "test-results", OUTPUT_NAME), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function measureColdBoot(
  url: string,
  run: number,
  timeoutMs: number,
  viewport: { width: number; height: number },
): Promise<BootRunReport> {
  const wallStarted = Date.now();
  const errors: BootRunReport["errors"] = { console: [], page: [], requests: [], game: [], runner: [] };
  const requestRecords: RequestRecord[] = [];
  const requestsByObject = new WeakMap<Request, RequestRecord>();
  let browser: Browser | undefined;
  let page: Page | undefined;
  let runnerReadyAtMs: number | null = null;
  let capture: PageCapture | null = null;

  try {
    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: "block" });
    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") pushLimited(errors.console, message.text());
    });
    page.on("pageerror", (error) => pushLimited(errors.page, error.stack ?? error.message));
    page.on("request", (request) => {
      const startEpochMs = finiteOrNull(request.timing().startTime);
      const entry: RequestRecord = {
        name: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        startEpochMs,
        startMs: null,
        status: null,
        contentLength: null,
        failed: null,
        preReady: false,
      };
      requestRecords.push(entry);
      requestsByObject.set(request, entry);
    });
    page.on("response", (response) => {
      const request = response.request();
      const entry = requestsByObject.get(request);
      if (!entry) return;
      entry.startEpochMs = finiteOrNull(request.timing().startTime) ?? entry.startEpochMs;
      entry.status = response.status();
      const length = Number(response.headers()["content-length"]);
      entry.contentLength = Number.isFinite(length) && length >= 0 ? length : null;
      if (response.status() >= 400) pushLimited(errors.requests, `${response.status()} ${response.url()}`);
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "request failed";
      const entry = requestsByObject.get(request);
      if (entry) entry.failed = failure;
      pushLimited(errors.requests, `${request.method()} ${request.url()}: ${failure}`);
    });

    await page.addInitScript({ content: PAGE_RECORDER_SOURCE });
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    try {
      await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: timeoutMs });
      runnerReadyAtMs = await page.evaluate(() => performance.now());
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    } catch (error) {
      pushLimited(errors.runner, `Ready wait failed: ${describeError(error)}`);
    }
    capture = await capturePage(page);
  } catch (error) {
    pushLimited(errors.runner, describeError(error));
    if (page && !page.isClosed()) {
      capture = await capturePage(page).catch((captureError: unknown) => {
        pushLimited(errors.runner, `Page capture failed: ${describeError(captureError)}`);
        return null;
      });
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const telemetryRecord = asRecord(capture?.telemetrySnapshot);
  const telemetryFirstPlayable = numberAt(telemetryRecord, "firstPlayableMs");
  const harnessFirstPlayable = capture?.readyDetectedAtMs ?? null;
  const firstPlayableMs = telemetryFirstPlayable ?? harnessFirstPlayable ?? runnerReadyAtMs;
  const firstPlayableSource: BootRunReport["firstPlayableSource"] = telemetryFirstPlayable !== null
    ? "telemetry"
    : harnessFirstPlayable !== null
      ? "harness"
      : runnerReadyAtMs !== null
        ? "runner"
        : "unavailable";

  const browserResources = capture?.resources ?? [];
  const telemetryResources = normalizeResources(telemetryRecord?.["resources"], firstPlayableMs);
  const resources = telemetryResources.length > 0 ? telemetryResources : browserResources.map((resource) => ({
    ...resource,
    preReady: firstPlayableMs !== null && resource.startMs <= firstPlayableMs,
  }));
  const spans = normalizeSpans(telemetryRecord?.["spans"]);
  const performanceMeasures = normalizeSpans(performanceMeasureValue(capture?.navigation));
  const milestones = spans.length > 0 ? spans : performanceMeasures;
  const marks = normalizeMarks(telemetryRecord?.["marks"]);
  const activeSpanCount = countPreReadyActiveSpans(telemetryRecord?.["activeSpans"], firstPlayableMs);

  for (const request of requestRecords) {
    request.startMs = capture
      ? relativeRequestStartMs(request.startEpochMs, capture.timeOrigin)
      : null;
    request.preReady = firstPlayableMs !== null && request.startMs !== null && request.startMs <= firstPlayableMs;
  }

  const longTasks = clipLongTasksBeforePlay(capture?.longTasks ?? [], firstPlayableMs);
  const approximateTbtMs = round(longTasks.reduce((sum, task) => sum + Math.max(0, task.durationMs - 50), 0));
  const longestTaskMs = round(longTasks.reduce((worst, task) => Math.max(worst, task.durationMs), 0));
  const telemetryAvailable = telemetryRecord !== null;
  const instrumentationOverheadMs = numberAt(telemetryRecord, "instrumentationOverheadMs");
  const instrumentationOperations = numberAt(telemetryRecord, "instrumentationOperations");
  const attribution = timelineAttribution(
    milestones,
    firstPlayableMs,
    telemetryAvailable,
    activeSpanCount,
    instrumentationOverheadMs,
    capture?.longTaskObserverAvailable ?? false,
  );
  errors.game = arrayValue(capture?.gameErrors);

  const preReadyRequests = requestRecords.filter((request) => request.preReady);
  const preReadyResources = resources.filter((resource) => resource.preReady);
  const rawMetrics = capture?.metrics ?? {};
  return {
    run,
    startedAt: new Date(wallStarted).toISOString(),
    durationMs: Date.now() - wallStarted,
    ready: capture?.ready === true,
    firstPlayableMs: roundedOrNull(firstPlayableMs),
    firstPlayableSource,
    bootScreenRemovedAtMs: roundedOrNull(
      numberAt(telemetryRecord, "bootScreenRemovedMs") ?? capture?.bootScreenRemovedAtMs ?? null,
    ),
    navigation: capture?.navigation ?? null,
    paints: capture?.paints ?? [],
    milestones,
    marks,
    telemetry: {
      available: telemetryAvailable,
      schemaVersion: telemetryRecord?.["schemaVersion"] ?? null,
      sessionId: telemetryRecord?.["sessionId"] ?? null,
      snapshot: capture?.telemetrySnapshot ?? null,
      attribution: capture?.telemetryAttribution ?? telemetryRecord?.["attribution"] ?? null,
      instrumentationOverheadMs,
      instrumentationOperations,
      activeSpanCount,
    },
    attribution,
    longTasks,
    approximateTbtMs,
    longestTaskMs,
    resources,
    browserResources,
    requests: requestRecords,
    preReadyRequests,
    totals: {
      resourceRequests: resources.length,
      preReadyRequests: preReadyResources.length,
      preReadyAssetRequests: preReadyResources.filter((resource) => ASSET_PATTERN.test(resource.name)).length,
      preReadyModelRequests: preReadyResources.filter((resource) => MODEL_PATTERN.test(resource.name)).length,
      transferBytes: sumTransfer(resources),
      preReadyTransferBytes: sumTransfer(preReadyResources),
      modelTransferBytes: sumTransfer(resources.filter((resource) => MODEL_PATTERN.test(resource.name))),
      javascriptTransferBytes: sumTransfer(resources.filter((resource) => /\.m?js(?:$|[?#])/i.test(resource.name))),
      wasmTransferBytes: sumTransfer(resources.filter((resource) => /\.wasm(?:$|[?#])/i.test(resource.name))),
    },
    metrics: {
      heapMB: metric(rawMetrics, "heapMB"),
      drawCalls: metric(rawMetrics, "drawCalls"),
      triangles: metric(rawMetrics, "triangles"),
      programs: metric(rawMetrics, "programs"),
      raw: rawMetrics,
    },
    errors,
  };
}

async function capturePage(page: Page): Promise<PageCapture> {
  return await page.evaluate(async () => {
    const harness = window.__corealmBootPerfHarness;
    const pendingLongTasks = harness?.longTaskObserver?.takeRecords() ?? [];
    for (const entry of pendingLongTasks) {
      harness?.longTasks.push({
        name: entry.name,
        startMs: entry.startTime,
        durationMs: entry.duration,
        endMs: entry.startTime + entry.duration,
      });
    }

    const telemetry = window.__corealmBootTelemetry;
    let telemetrySnapshot: unknown = null;
    let telemetryAttribution: unknown = null;
    try {
      telemetrySnapshot = typeof telemetry?.snapshot === "function" ? await telemetry.snapshot() : null;
      telemetryAttribution = typeof telemetry?.getAttribution === "function" ? await telemetry.getAttribution() : null;
    } catch {
      // A malformed optional telemetry API is reported as missing by timeline attribution.
    }

    const debug = window.__gameDebug as unknown as {
      getState?: () => { ready?: boolean };
      getMetrics?: () => Record<string, number>;
      getErrors?: () => unknown[];
    } | undefined;
    let ready = false;
    let metrics: Record<string, number> = {};
    let gameErrors: unknown[] = [];
    try { ready = debug?.getState?.().ready === true; } catch { /* recorded by pageerror when thrown globally */ }
    try { metrics = debug?.getMetrics?.() ?? {}; } catch { /* optional during an incomplete boot */ }
    try { gameErrors = debug?.getErrors?.() ?? []; } catch { /* optional during an incomplete boot */ }

    const resources = performance.getEntriesByType("resource").map((value) => {
      const entry = value as PerformanceResourceTiming & { deliveryType?: string; responseStatus?: number };
      return {
        name: entry.name,
        initiatorType: entry.initiatorType,
        startMs: entry.startTime,
        endMs: entry.responseEnd,
        durationMs: entry.duration,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        deliveryType: entry.deliveryType,
        nextHopProtocol: entry.nextHopProtocol,
        responseStatus: entry.responseStatus,
        preReady: harness?.firstPlayableAtMs !== null
          && harness?.firstPlayableAtMs !== undefined
          && entry.startTime <= harness.firstPlayableAtMs,
      };
    });
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const navigation = nav ? nav.toJSON() as Record<string, unknown> : null;
    if (navigation) {
      navigation.__performanceMeasures = performance.getEntriesByType("measure").map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
        duration: entry.duration,
      }));
    }
    const paints = performance.getEntriesByType("paint").map((entry) => ({
      name: entry.name,
      startMs: entry.startTime,
      durationMs: entry.duration,
    }));
    return {
      nowMs: performance.now(),
      timeOrigin: performance.timeOrigin,
      ready,
      readyDetectedAtMs: harness?.firstPlayableAtMs ?? null,
      bootScreenRemovedAtMs: harness?.bootScreenRemovedAtMs ?? null,
      longTaskObserverAvailable: harness?.longTaskObserver !== null && harness?.longTaskObserver !== undefined,
      longTasks: harness?.longTasks ?? [],
      resources,
      navigation,
      paints,
      metrics,
      gameErrors,
      telemetrySnapshot,
      telemetryAttribution,
    };
  });
}

function timelineAttribution(
  spans: BootSpanRecord[],
  firstPlayableMs: number | null,
  telemetryAvailable: boolean,
  activeSpanCount: number,
  instrumentationOverheadMs: number | null,
  longTaskObserverAvailable: boolean,
): BootRunReport["attribution"] {
  const end = firstPlayableMs;
  const intervals = end === null
    ? []
    : spans
      .map((span) => ({ startMs: Math.max(0, span.startMs), endMs: Math.min(end, span.endMs) }))
      .filter((span) => span.endMs > span.startMs)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.startMs > previous.endMs) merged.push({ ...interval });
    else previous.endMs = Math.max(previous.endMs, interval.endMs);
  }
  const gaps: TimelineGap[] = [];
  if (end !== null) {
    let cursor = 0;
    for (const interval of merged) {
      if (interval.startMs > cursor) gaps.push(gap(cursor, interval.startMs));
      cursor = Math.max(cursor, interval.endMs);
    }
    if (cursor < end) gaps.push(gap(cursor, end));
  }
  const coveredMs = round(merged.reduce((total, interval) => total + interval.endMs - interval.startMs, 0));
  const unattributedMs = end === null ? null : round(Math.max(0, end - coveredMs));
  const names = spans.map((span) => normalizeName(span.name));
  const missingRequiredSpans = REQUIRED_TIMELINE_SPANS
    .filter((requirement) => !names.some((name) => requirement.patterns.some((pattern) => pattern.test(name))))
    .map((requirement) => requirement.id);
  const unexplainedMultiSecondGaps = gaps.filter((entry) => entry.durationMs >= ATTRIBUTION_GAP_MS);
  const issues: string[] = [];
  if (!telemetryAvailable) issues.push("window.__corealmBootTelemetry was unavailable; browser timing is only a fallback.");
  if (firstPlayableMs === null) issues.push("First playable time was not observed.");
  if (activeSpanCount > 0) issues.push(`${activeSpanCount} telemetry span(s) were still active at capture time.`);
  if (missingRequiredSpans.length > 0) issues.push(`Missing required spans: ${missingRequiredSpans.join(", ")}.`);
  for (const entry of unexplainedMultiSecondGaps) {
    issues.push(`Unattributed ${entry.durationMs.toFixed(1)} ms gap at ${entry.startMs.toFixed(1)}-${entry.endMs.toFixed(1)} ms.`);
  }
  if (instrumentationOverheadMs === null) issues.push("Telemetry did not report instrumentation overhead.");
  else if (instrumentationOverheadMs >= 20) issues.push(`Instrumentation cost ${instrumentationOverheadMs.toFixed(2)} ms; target is under 20 ms.`);
  if (!longTaskObserverAvailable) issues.push("The browser did not expose the Long Task observer.");
  return {
    coveredMs,
    unattributedMs,
    coverageRatio: end !== null && end > 0 ? round(coveredMs / end) : null,
    gaps,
    unexplainedMultiSecondGaps,
    missingRequiredSpans,
    issues,
    complete: issues.length === 0,
  };
}

function summarize(runs: BootRunReport[]): BootPerfReport["summary"] {
  const milestoneSamples = new Map<string, number[]>();
  for (const run of runs) {
    for (const milestone of run.milestones) {
      // The capture window deliberately remains open after play to observe background work. Keep
      // those spans in the per-run record, but do not present them as critical boot durations.
      if (run.firstPlayableMs !== null && milestone.endMs > run.firstPlayableMs) continue;
      const values = milestoneSamples.get(milestone.name) ?? [];
      values.push(milestone.durationMs);
      milestoneSamples.set(milestone.name, values);
    }
  }
  return {
    completedBoots: runs.length,
    readyBoots: runs.filter((run) => run.ready).length,
    firstPlayableMs: summaryMetric(runs.map((run) => run.firstPlayableMs)),
    approximateTbtMs: summaryMetric(runs.map((run) => run.approximateTbtMs)),
    longestTaskMs: summaryMetric(runs.map((run) => run.longestTaskMs)),
    preReadyRequests: summaryMetric(runs.map((run) => run.totals.preReadyRequests)),
    preReadyModelRequests: summaryMetric(runs.map((run) => run.totals.preReadyModelRequests)),
    transferBytes: summaryMetric(runs.map((run) => run.totals.transferBytes)),
    errorCount: runs.reduce(
      (total, run) => total + run.errors.console.length + run.errors.page.length
        + run.errors.requests.length + run.errors.game.length + run.errors.runner.length,
      0,
    ),
    milestoneDurations: Object.fromEntries(
      [...milestoneSamples.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [name, summaryMetric(values)]),
    ),
  };
}

function budgetResults(summary: BootPerfReport["summary"]): BudgetResult[] {
  return [
    budget("cold-first-playable-median", "Cold first playable median", "median", "ms", 6_000, summary.firstPlayableMs.median),
    budget("cold-first-playable-worst", "Cold first playable worst of runs", "worst", "ms", 10_000, summary.firstPlayableMs.worst),
    budget("tbt-before-play-worst", "Approximate TBT before play", "worst", "ms", 1_500, summary.approximateTbtMs.worst),
    budget("longest-boot-task-worst", "Longest boot task", "worst", "ms", 250, summary.longestTaskMs.worst),
    budget("pre-ready-model-requests-worst", "Pre-ready model requests", "worst", "requests", 50, summary.preReadyModelRequests.worst),
  ];
}

function budget(
  id: string,
  label: string,
  aggregation: BudgetResult["aggregation"],
  unit: BudgetResult["unit"],
  limit: number,
  observed: number | null,
): BudgetResult {
  return { id, label, aggregation, unit, limit, observed, met: observed === null ? null : observed <= limit };
}

async function startProductionServer(requestedBase?: string): Promise<{
  server: RunningGameServer;
  base: string;
  distIndex: string;
}> {
  await assertGameInitialized();
  const distIndex = path.join(gameRoot, "dist", "index.html");
  try {
    await access(distIndex);
  } catch {
    throw new Error(`Production build missing at ${distIndex}. Run npm run build before boot measurement.`);
  }
  const html = await readFile(distIndex, "utf8");
  const base = normalizeBase(requestedBase ?? process.env["GAME_BASE"] ?? inferBase(html));
  const vite: PreviewServer = await preview({
    root: gameRoot,
    base,
    logLevel: "error",
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  const address = vite.httpServer.address();
  if (!address || typeof address === "string") {
    await closePreview(vite);
    throw new Error("Vite preview did not expose a local TCP port");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    base,
    distIndex,
    server: { url: `${origin}${base}`, close: async () => closePreview(vite) },
  };
}

function closePreview(server: PreviewServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.httpServer.close((error) => error ? reject(error) : resolve());
  });
}

export function inferBase(html: string): string {
  const urls = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1] ?? "");
  for (const rawUrl of urls) {
    const url = rawUrl.split(/[?#]/, 1)[0] ?? "";
    const markerIndex = url.indexOf("/assets/");
    if (url.startsWith("/") && markerIndex >= 0) {
      return url.slice(0, markerIndex + 1) || "/";
    }
    if (/^(?:\.\/)?assets\//i.test(url)) return "/";
  }
  return "/";
}

export function normalizeBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === "./" || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

/** Post-play streaming may still own spans; only unfinished critical-path work invalidates boot. */
export function countPreReadyActiveSpans(value: unknown, firstPlayableMs: number | null): number {
  if (!Array.isArray(value)) return 0;
  if (firstPlayableMs === null) return value.length;
  return value.filter((entry) => {
    const record = asRecord(entry);
    const startMs = numberAt(record, "startMs") ?? numberAt(record, "startTime");
    return startMs === null || startMs < firstPlayableMs;
  }).length;
}

/** CDP reports -1 for requests whose timing record is not ready; it is not an epoch timestamp. */
export function relativeRequestStartMs(startEpochMs: number | null, timeOrigin: number): number | null {
  if (startEpochMs === null || startEpochMs <= 0 || !Number.isFinite(timeOrigin)) return null;
  const relative = startEpochMs - timeOrigin;
  return Number.isFinite(relative) && relative >= 0 ? round(relative) : null;
}

function normalizeResources(value: unknown, firstPlayableMs: number | null): BootResourceRecord[] {
  if (!Array.isArray(value)) return [];
  const resources: BootResourceRecord[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record["name"] !== "string") continue;
    const startMs = numberAt(record, "startMs") ?? numberAt(record, "startTime") ?? 0;
    const durationMs = numberAt(record, "durationMs") ?? numberAt(record, "duration") ?? 0;
    const endMs = numberAt(record, "endMs") ?? numberAt(record, "responseEnd") ?? startMs + durationMs;
    resources.push({
      name: record["name"],
      initiatorType: typeof record["initiatorType"] === "string" ? record["initiatorType"] : "unknown",
      startMs: round(startMs),
      endMs: round(endMs),
      durationMs: round(durationMs || Math.max(0, endMs - startMs)),
      transferSize: nonNegativeNumber(record["transferSize"]),
      encodedBodySize: nonNegativeNumber(record["encodedBodySize"]),
      decodedBodySize: nonNegativeNumber(record["decodedBodySize"]),
      ...(typeof record["deliveryType"] === "string" ? { deliveryType: record["deliveryType"] } : {}),
      ...(typeof record["nextHopProtocol"] === "string" ? { nextHopProtocol: record["nextHopProtocol"] } : {}),
      ...(typeof record["responseStatus"] === "number" ? { responseStatus: record["responseStatus"] } : {}),
      preReady: typeof record["preReady"] === "boolean"
        ? record["preReady"]
        : firstPlayableMs !== null && startMs <= firstPlayableMs,
      ...(record["detail"] !== undefined ? { detail: record["detail"] } : {}),
    });
  }
  return resources;
}

function normalizeSpans(value: unknown): BootSpanRecord[] {
  if (!Array.isArray(value)) return [];
  const spans: BootSpanRecord[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const name = record && typeof record["name"] === "string" ? record["name"] : null;
    if (!record || !name) continue;
    const startMs = numberAt(record, "startMs") ?? numberAt(record, "startTime");
    const durationMs = numberAt(record, "durationMs") ?? numberAt(record, "duration");
    const endMs = numberAt(record, "endMs") ?? numberAt(record, "endTime")
      ?? (startMs !== null && durationMs !== null ? startMs + durationMs : null);
    if (startMs === null || endMs === null) continue;
    spans.push({
      name,
      startMs: round(startMs),
      endMs: round(endMs),
      durationMs: round(durationMs ?? Math.max(0, endMs - startMs)),
      ...(record["detail"] !== undefined ? { detail: record["detail"] } : {}),
    });
  }
  return spans.sort((a, b) => a.startMs - b.startMs || a.name.localeCompare(b.name));
}

function normalizeMarks(value: unknown): Array<{ name: string; atMs: number; detail?: unknown }> {
  if (!Array.isArray(value)) return [];
  const marks: Array<{ name: string; atMs: number; detail?: unknown }> = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record["name"] !== "string") continue;
    const atMs = numberAt(record, "atMs") ?? numberAt(record, "startMs") ?? numberAt(record, "startTime");
    if (atMs === null) continue;
    marks.push({
      name: record["name"],
      atMs: round(atMs),
      ...(record["detail"] !== undefined ? { detail: record["detail"] } : {}),
    });
  }
  return marks.sort((a, b) => a.atMs - b.atMs || a.name.localeCompare(b.name));
}

function performanceMeasureValue(navigation: Record<string, unknown> | null | undefined): unknown {
  return navigation?.["__performanceMeasures"];
}

function summaryMetric(values: Array<number | null>): SummaryMetric {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) return { samples: 0, median: null, worst: null };
  const middle = Math.floor(finite.length / 2);
  const median = finite.length % 2 === 1
    ? finite[middle]!
    : (finite[middle - 1]! + finite[middle]!) / 2;
  return { samples: finite.length, median: round(median), worst: round(finite[finite.length - 1]!) };
}

function emptySummary(): BootPerfReport["summary"] {
  const empty = (): SummaryMetric => ({ samples: 0, median: null, worst: null });
  return {
    completedBoots: 0,
    readyBoots: 0,
    firstPlayableMs: empty(),
    approximateTbtMs: empty(),
    longestTaskMs: empty(),
    preReadyRequests: empty(),
    preReadyModelRequests: empty(),
    transferBytes: empty(),
    errorCount: 0,
    milestoneDurations: {},
  };
}

function gap(startMs: number, endMs: number): TimelineGap {
  return { startMs: round(startMs), endMs: round(endMs), durationMs: round(endMs - startMs) };
}

function metric(metrics: Record<string, number>, name: string): number | null {
  return finiteOrNull(metrics[name]);
}

function sumTransfer(resources: BootResourceRecord[]): number {
  return Math.round(resources.reduce((total, resource) => total + resource.transferSize, 0));
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

export function clipLongTasksBeforePlay(
  tasks: HarnessLongTask[],
  firstPlayableMs: number | null,
): HarnessLongTask[] {
  return tasks
    .filter((task) => firstPlayableMs === null || task.startMs < firstPlayableMs)
    .map((task) => {
      const startMs = round(task.startMs);
      const endMs = round(firstPlayableMs === null ? task.endMs : Math.min(task.endMs, firstPlayableMs));
      return { ...task, startMs, endMs, durationMs: round(Math.max(0, endMs - startMs)) };
    });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberAt(record: Record<string, unknown> | null, key: string): number | null {
  return finiteOrNull(record?.[key]);
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundedOrNull(value: number | null): number | null {
  return value === null ? null : round(value);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function pushLimited(target: string[], value: string): void {
  if (target.length < 100) target.push(value.slice(0, 2_000));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function validatePositiveInteger(value: number, flag: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer, received ${value}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runCandidate = argValue(args, "--run");
  if (!runCandidate) {
    throw new Error(
      "Usage: npx tsx tools/boot-perf.ts --run runs/<id> [--boots 5] [--timeout-ms 120000] [--base /Corealm/]",
    );
  }
  const bootCount = Number(argValue(args, "--boots") ?? argValue(args, "--count") ?? DEFAULT_BOOTS);
  const timeoutMs = Number(argValue(args, "--timeout-ms") ?? DEFAULT_TIMEOUT_MS);
  const report = await runBootPerformance(runCandidate, bootCount, timeoutMs, argValue(args, "--base"));
  console.log(JSON.stringify({
    output: path.join(runCandidate, "test-results", OUTPUT_NAME).replaceAll("\\", "/"),
    production: report.production,
    summary: report.summary,
    budgets: report.budgets,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
