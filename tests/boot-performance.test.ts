import { describe, expect, it } from "vitest";
import {
  BOOT_MILESTONES,
  BOOT_SPANS,
  BOOT_TELEMETRY_SCHEMA_VERSION,
  createBootTelemetry,
} from "../game/src/perf/bootTelemetry.js";
import {
  clipLongTasksBeforePlay,
  countPreReadyActiveSpans,
  inferBase,
  normalizeBase,
  relativeRequestStartMs,
} from "../tools/boot-perf.js";

/**
 * Wave 0 records these limits but does not enforce the product budgets yet.
 * Keep the values numeric so the production runner can serialize and compare them.
 */
export const WAVE_0_BOOT_PERFORMANCE_BUDGETS = {
  schemaVersion: 1,
  enforcement: "report-only",
  targets: {
    coldFirstPlayableMedianMs: 6_000,
    coldFirstPlayableWorstOfFiveMs: 10_000,
    attachedChromiumReadinessMs: 10_000,
    approximateTbtBeforePlayMs: 1_500,
    longestBootTaskMs: 250,
    blockingGlbGzipBytes: 6_000_000,
    preReadyModelRequests: 50,
    mainJavaScriptGzipBytes: 1_000_000,
    initialMapTransferBytes: 150_000,
  },
  telemetry: {
    maxInstrumentationOverheadMs: 20,
    maxUnattributedGapMs: 1_000,
  },
  wave0Baseline: {
    coldFirstPlayableMedianMs: 19_150,
    coldFirstPlayableWorstOfFiveMs: { lowerBound: 20_000 },
    attachedChromiumReadinessMs: { min: 41_600, max: 48_500 },
    approximateTbtBeforePlayMs: 16_930,
    longestBootTaskMs: 4_000,
    blockingGlbGzipBytes: 14_480_000,
    preReadyModelRequests: 137,
    mainJavaScriptGzipBytes: 1_580_000,
    initialMapTransferBytes: 8_630_000,
  },
} as const;

describe("Wave 0 boot-performance budgets", () => {
  it("resolves the production app root instead of treating the assets directory as the base", () => {
    expect(inferBase('<script type="module" src="/assets/index-abc.js"></script>')).toBe("/");
    expect(inferBase('<script type="module" src="/Corealm/assets/index-abc.js"></script>')).toBe("/Corealm/");
    expect(inferBase('<link rel="stylesheet" href="./assets/index-abc.css">')).toBe("/");
    expect(normalizeBase("/")).toBe("/");
    expect(normalizeBase("Corealm")).toBe("/Corealm/");
  });

  it("clips a long task at first playable instead of charging post-ready work to TBT", () => {
    expect(clipLongTasksBeforePlay([
      { name: "self", startMs: 33_000, endMs: 45_000, durationMs: 12_000 },
      { name: "post-ready", startMs: 36_000, endMs: 37_000, durationMs: 1_000 },
    ], 35_000)).toEqual([
      { name: "self", startMs: 33_000, endMs: 35_000, durationMs: 2_000 },
    ]);
  });

  it("does not report intentionally post-ready streaming spans as unfinished boot work", () => {
    const active = [
      { name: "critical", startMs: 900 },
      { name: "background", startMs: 1_001 },
    ];
    expect(countPreReadyActiveSpans(active, 1_000)).toBe(1);
    expect(countPreReadyActiveSpans(active.slice(1), 1_000)).toBe(0);
    expect(countPreReadyActiveSpans(active, null)).toBe(2);
  });

  it("rejects CDP's unresolved request timing sentinel instead of inventing a pre-ready request", () => {
    expect(relativeRequestStartMs(-1, 1_000)).toBeNull();
    expect(relativeRequestStartMs(999, 1_000)).toBeNull();
    expect(relativeRequestStartMs(1_025.25, 1_000)).toBe(25.25);
  });

  it("keeps every final acceptance limit in one machine-readable object", () => {
    expect(WAVE_0_BOOT_PERFORMANCE_BUDGETS).toEqual(expect.objectContaining({
      schemaVersion: 1,
      enforcement: "report-only",
      targets: {
        coldFirstPlayableMedianMs: 6_000,
        coldFirstPlayableWorstOfFiveMs: 10_000,
        attachedChromiumReadinessMs: 10_000,
        approximateTbtBeforePlayMs: 1_500,
        longestBootTaskMs: 250,
        blockingGlbGzipBytes: 6_000_000,
        preReadyModelRequests: 50,
        mainJavaScriptGzipBytes: 1_000_000,
        initialMapTransferBytes: 150_000,
      },
    }));
  });

  it("starts in report-only mode", () => {
    expect(WAVE_0_BOOT_PERFORMANCE_BUDGETS.enforcement).toBe("report-only");
  });

  it("uses finite non-negative values and explicit units", () => {
    for (const [name, value] of Object.entries(WAVE_0_BOOT_PERFORMANCE_BUDGETS.targets)) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(name, name).toMatch(/(?:Ms|Bytes|Requests)$/);
    }
    for (const [name, value] of Object.entries(WAVE_0_BOOT_PERFORMANCE_BUDGETS.telemetry)) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(name, name).toMatch(/Ms$/);
    }
  });

  it("captures the measured Wave 0 starting point without requiring a baseline file", () => {
    const baseline = WAVE_0_BOOT_PERFORMANCE_BUDGETS.wave0Baseline;
    expect(baseline.coldFirstPlayableMedianMs).toBe(19_150);
    expect(baseline.coldFirstPlayableWorstOfFiveMs.lowerBound).toBe(20_000);
    expect(baseline.attachedChromiumReadinessMs).toEqual({ min: 41_600, max: 48_500 });
    expect(baseline.attachedChromiumReadinessMs.min)
      .toBeLessThan(baseline.attachedChromiumReadinessMs.max);
  });
});

const EXPECTED_BOOT_SPANS = {
  TOTAL: "boot.total",
  JS_EVALUATION: "boot.js.evaluate",
  PHYSICS_WASM_INIT: "boot.wasm.physics.initialize",
  NAVIGATION_WASM_INIT: "boot.wasm.navigation.initialize",
  MANIFEST_LOAD: "boot.assets.manifest.load",
  ANIMATION_LOAD: "boot.assets.animations.load",
  TERRAIN_BUILD: "boot.terrain.build",
  TERRAIN_RESTAMP: "boot.terrain.restamp",
  NAVIGATION_IMPORT: "boot.navigation.import",
  NAVIGATION_BUILD: "boot.navigation.build",
  SCATTER_CANDIDATES: "boot.scatter.candidates",
  SCATTER_MESHES: "boot.scatter.meshes",
  ENTITY_PRELOAD: "boot.entities.preload",
  GLTF_PARSE: "boot.entities.gltf.parse",
  FIRST_ENTITY_SYNC: "boot.entities.firstSync",
  PLAYER_CONSTRUCTION: "boot.player.construct",
  UI_CONSTRUCTION: "boot.ui.construct",
  SHADER_COMPILE: "boot.shaders.compile",
  BOOT_SCREEN_REMOVAL: "boot.screen.remove",
  FIRST_RENDERED_FRAME: "boot.frame.first",
} as const;

const EXPECTED_BOOT_MILESTONES = {
  SESSION_START: "boot.session.start",
  JS_EVALUATED: "boot.js.evaluated",
  WASM_READY: "boot.wasm.ready",
  MANIFEST_READY: "boot.assets.manifest.ready",
  ANIMATIONS_READY: "boot.assets.animations.ready",
  TERRAIN_READY: "boot.terrain.ready",
  NAVIGATION_READY: "boot.navigation.ready",
  SCATTER_SPAWN_READY: "boot.scatter.spawn.ready",
  ENTITIES_READY: "boot.entities.ready",
  PLAYER_READY: "boot.player.ready",
  UI_READY: "boot.ui.ready",
  SHADERS_READY: "boot.shaders.ready",
  BOOT_SCREEN_REMOVED: "boot.screen.removed",
  FIRST_RENDERED_FRAME: "boot.frame.first",
  FIRST_PLAYABLE: "boot.playable",
} as const;

function deterministicTelemetry() {
  const clock = { nowMs: 0 };
  const telemetry = createBootTelemetry({
    now: () => clock.nowMs,
    epochNow: () => 1_788_134_400_000,
    sessionId: "boot-performance-test",
    captureResources: false,
  });
  return { clock, telemetry };
}

describe("boot telemetry contract", () => {
  it("keeps the span and milestone vocabulary stable", () => {
    expect(BOOT_TELEMETRY_SCHEMA_VERSION).toBe(1);
    expect(BOOT_SPANS).toEqual(EXPECTED_BOOT_SPANS);
    expect(BOOT_MILESTONES).toEqual(EXPECTED_BOOT_MILESTONES);
    expect(new Set(Object.values(BOOT_SPANS)).size).toBe(Object.keys(BOOT_SPANS).length);
    expect(new Set(Object.values(BOOT_MILESTONES)).size)
      .toBe(Object.keys(BOOT_MILESTONES).length);
  });

  it("derives span duration from its recorded endpoints", () => {
    const { clock, telemetry } = deterministicTelemetry();
    clock.nowMs = 12;
    const span = telemetry.startSpan(BOOT_SPANS.TERRAIN_BUILD);
    clock.nowMs = 47.5;
    span.end();

    const recorded = telemetry.snapshot().spans.at(-1);
    expect(recorded).toMatchObject({
      name: BOOT_SPANS.TERRAIN_BUILD,
      startMs: 12,
      endMs: 47.5,
      durationMs: 35.5,
      attributed: true,
    });
    expect(recorded?.durationMs).toBe(recorded!.endMs - recorded!.startMs);
  });

  it("unions overlapping spans and leaves the total span out of attribution", () => {
    const { clock, telemetry } = deterministicTelemetry();
    const total = telemetry.startSpan(BOOT_SPANS.TOTAL);

    clock.nowMs = 10;
    const terrain = telemetry.startSpan(BOOT_SPANS.TERRAIN_BUILD);
    clock.nowMs = 30;
    const manifest = telemetry.startSpan(BOOT_SPANS.MANIFEST_LOAD);
    clock.nowMs = 50;
    terrain.end();
    clock.nowMs = 70;
    manifest.end();
    clock.nowMs = 100;
    total.end();

    const attribution = telemetry.getAttribution({
      startMs: 0,
      endMs: 100,
      minimumGapMs: 0,
    });
    expect(attribution).toMatchObject({
      startMs: 0,
      endMs: 100,
      durationMs: 100,
      accountedMs: 60,
      unattributedMs: 40,
      coverage: 0.6,
      maxGapMs: 30,
    });
    expect(attribution.gaps).toEqual([
      { startMs: 0, endMs: 10, durationMs: 10 },
      { startMs: 70, endMs: 100, durationMs: 30 },
    ]);
  });

  it("reports attribution gaps that exceed the Wave 0 explanation limit", () => {
    const { clock, telemetry } = deterministicTelemetry();
    const earlyWork = telemetry.startSpan(BOOT_SPANS.JS_EVALUATION);
    clock.nowMs = 200;
    earlyWork.end();
    clock.nowMs = 1_300;
    const lateWork = telemetry.startSpan(BOOT_SPANS.UI_CONSTRUCTION);
    clock.nowMs = 1_500;
    lateWork.end();

    const attribution = telemetry.getAttribution({
      startMs: 0,
      endMs: 1_500,
      minimumGapMs: WAVE_0_BOOT_PERFORMANCE_BUDGETS.telemetry.maxUnattributedGapMs,
    });
    expect(attribution.maxGapMs)
      .toBeGreaterThan(WAVE_0_BOOT_PERFORMANCE_BUDGETS.telemetry.maxUnattributedGapMs);
    expect(attribution.gaps).toEqual([
      { startMs: 200, endMs: 1_300, durationMs: 1_100 },
    ]);
  });

  it("exports the same schema and stays below the instrumentation overhead budget", () => {
    const { clock, telemetry } = deterministicTelemetry();
    const span = telemetry.startSpan(BOOT_SPANS.PLAYER_CONSTRUCTION);
    clock.nowMs = 5;
    span.end();
    telemetry.mark(BOOT_MILESTONES.PLAYER_READY);

    const snapshot = telemetry.snapshot();
    const exported = JSON.parse(telemetry.exportJson()) as typeof snapshot;
    expect(exported).toMatchObject({
      schemaVersion: BOOT_TELEMETRY_SCHEMA_VERSION,
      sessionId: "boot-performance-test",
    });
    expect(exported.spans).toEqual(snapshot.spans);
    expect(exported.marks).toEqual(snapshot.marks);
    expect(snapshot.instrumentationOperations).toBeGreaterThan(0);
    expect(exported.instrumentationOperations).toBeGreaterThan(snapshot.instrumentationOperations);
    expect(exported.instrumentationOverheadMs).toBeGreaterThanOrEqual(
      snapshot.instrumentationOverheadMs,
    );
    expect(snapshot.instrumentationOverheadMs)
      .toBeLessThan(WAVE_0_BOOT_PERFORMANCE_BUDGETS.telemetry.maxInstrumentationOverheadMs);
    expect(exported.instrumentationOverheadMs)
      .toBeLessThan(WAVE_0_BOOT_PERFORMANCE_BUDGETS.telemetry.maxInstrumentationOverheadMs);
  });
});
