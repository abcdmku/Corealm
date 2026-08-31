import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import viteConfig, {
  BUNDLE_BUDGETS,
  analyzeBundleBudget,
  assertBundleBudgets,
  bundleChunkForModule,
  formatBundleBudgetReport,
  resolveCriticalPreloads,
  type BundleArtifact,
  type BundleBudgetReport,
} from "../game/vite.config.js";

function chunk(
  fileName: string,
  name: string,
  options: { entry?: boolean; imports?: string[]; modules?: string[]; code?: string } = {},
): BundleArtifact {
  return {
    type: "chunk",
    fileName,
    name,
    code: options.code ?? `export const ${name.replaceAll("-", "_")} = 1;`,
    isEntry: options.entry ?? false,
    imports: options.imports ?? [],
    modules: Object.fromEntries((options.modules ?? []).map((id) => [id, {}])),
  };
}

function passingReport(): BundleBudgetReport {
  return {
    artifacts: [],
    initialChunks: [],
    applicationInitialJsGzipBytes: BUNDLE_BUDGETS.applicationInitialJsGzipBytes,
    criticalInitialJsAndWasmGzipBytes: BUNDLE_BUDGETS.criticalInitialJsAndWasmGzipBytes,
    wasmGzipBytes: 0,
    wasmFiles: [],
    recastCompatibilityChunks: [],
    sourceMaps: [],
    missingDedicatedChunks: [],
  };
}

describe("production bundle policy", () => {
  it("assigns Three, Rapier, Recast, and remaining dependencies to stable chunks", () => {
    expect(bundleChunkForModule("C:/repo/node_modules/three/build/three.module.js")).toBe("three");
    expect(bundleChunkForModule("C:\\repo\\node_modules\\three\\examples\\jsm\\loaders\\GLTFLoader.js")).toBe("three");
    expect(bundleChunkForModule("C:/repo/node_modules/@dimforge/rapier3d-compat/rapier.mjs")).toBe("rapier");
    expect(bundleChunkForModule("C:/repo/node_modules/@dimforge/rapier3d/rapier.js")).toBe("rapier");
    expect(bundleChunkForModule("C:/repo/node_modules/@recast-navigation/core/dist/index.mjs")).toBe("recast");
    expect(bundleChunkForModule("C:/repo/node_modules/recast-navigation/index.mjs")).toBe("recast");
    expect(bundleChunkForModule("C:/repo/node_modules/some-runtime/index.js")).toBe("vendor");
    expect(bundleChunkForModule("C:/repo/game/src/app/boot.ts")).toBeUndefined();
  });

  it("limits document preloads to critical synchronous chunks", () => {
    const dependencies = [
      "assets/chunks/three-a.js",
      "assets/chunks/rapier-b.js",
      "assets/chunks/recast-c.js",
      "assets/chunks/vendor-d.js",
      "assets/chunks/debug-panel-e.js",
      "assets/world-map-detail-4800.webp",
    ];
    expect(resolveCriticalPreloads("assets/entry/index.js", dependencies, { hostId: "index.html", hostType: "html" }))
      .toEqual(dependencies.slice(0, 4));
    expect(resolveCriticalPreloads("assets/chunks/panels.js", dependencies, { hostId: "boot.js", hostType: "js" }))
      .toEqual(dependencies);
  });

  it("measures the complete static entry graph and excludes vendor chunks from app JS", () => {
    const bundle: Record<string, BundleArtifact> = {
      "assets/entry/index-a.js": chunk("assets/entry/index-a.js", "index", {
        entry: true,
        imports: [
          "assets/chunks/app-b.js",
          "assets/chunks/three-c.js",
          "assets/chunks/rapier-d.js",
          "assets/chunks/recast-e.js",
        ],
        code: "import './app-b.js';",
      }),
      "assets/chunks/app-b.js": chunk("assets/chunks/app-b.js", "app", { code: "export const boot = true;" }),
      "assets/chunks/three-c.js": chunk("assets/chunks/three-c.js", "three"),
      "assets/chunks/rapier-d.js": chunk("assets/chunks/rapier-d.js", "rapier"),
      "assets/chunks/recast-e.js": chunk("assets/chunks/recast-e.js", "recast"),
      "assets/chunks/lazy-panel-f.js": chunk("assets/chunks/lazy-panel-f.js", "lazy-panel", { code: "export const panel = true;" }),
      "assets/wasm/recast-g.wasm": {
        type: "asset",
        fileName: "assets/wasm/recast-g.wasm",
        source: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
      },
    };
    const report = analyzeBundleBudget(bundle);

    expect(report.initialChunks).toEqual([
      "assets/chunks/app-b.js",
      "assets/chunks/rapier-d.js",
      "assets/chunks/recast-e.js",
      "assets/chunks/three-c.js",
      "assets/entry/index-a.js",
    ]);
    expect(report.artifacts.find((artifact) => artifact.fileName.includes("lazy-panel"))?.initial).toBe(false);
    const initialAppGzip = report.artifacts
      .filter((artifact) => artifact.initial && /(?:entry\/index|chunks\/app)-/.test(artifact.fileName))
      .reduce((total, artifact) => total + artifact.gzipBytes, 0);
    expect(report.applicationInitialJsGzipBytes).toBe(initialAppGzip);
    expect(report.criticalInitialJsAndWasmGzipBytes).toBeGreaterThan(report.applicationInitialJsGzipBytes);
    expect(report.wasmFiles).toEqual(["assets/wasm/recast-g.wasm"]);
    expect(report.missingDedicatedChunks).toEqual([]);
    expect(formatBundleBudgetReport(report)).toContain("gzip");
    expect(formatBundleBudgetReport(report)).toContain("br ");
  });

  it("fails closed on either transfer budget, source maps, or a missing engine chunk", () => {
    expect(() => assertBundleBudgets(passingReport())).not.toThrow();
    expect(() => assertBundleBudgets({
      ...passingReport(),
      applicationInitialJsGzipBytes: BUNDLE_BUDGETS.applicationInitialJsGzipBytes + 1,
    })).toThrow(/initial application JavaScript/);
    expect(() => assertBundleBudgets({
      ...passingReport(),
      criticalInitialJsAndWasmGzipBytes: BUNDLE_BUDGETS.criticalInitialJsAndWasmGzipBytes + 1,
    })).toThrow(/critical JavaScript plus WASM/);
    expect(() => assertBundleBudgets({ ...passingReport(), sourceMaps: ["assets/entry/index.js.map"] }))
      .toThrow(/source maps/);
    expect(() => assertBundleBudgets({ ...passingReport(), missingDedicatedChunks: ["recast"] }))
      .toThrow(/missing dedicated engine chunks/);
  });

  it("reports a bundled Recast compatibility loader as a request-chain gap", () => {
    const bundle: Record<string, BundleArtifact> = {
      "assets/chunks/recast-a.js": chunk("assets/chunks/recast-a.js", "recast", {
        modules: ["C:/repo/node_modules/@recast-navigation/wasm/dist/recast-navigation.wasm-compat.js"],
      }),
      "assets/chunks/three-b.js": chunk("assets/chunks/three-b.js", "three"),
      "assets/chunks/rapier-c.js": chunk("assets/chunks/rapier-c.js", "rapier"),
    };
    expect(analyzeBundleBudget(bundle).recastCompatibilityChunks).toEqual(["assets/chunks/recast-a.js"]);
  });

  it("keeps WASM external, source maps off, and source HTML base-relative", async () => {
    const config = viteConfig as {
      assetsInclude?: string[];
      optimizeDeps?: { exclude?: string[] };
      plugins?: { name?: string; configureServer?: unknown }[];
      resolve?: { alias?: { find: string | RegExp; replacement: string }[] };
      build?: {
        target?: unknown;
        sourcemap?: unknown;
        assetsInlineLimit?: (filePath: string, content: Buffer) => boolean | undefined;
        modulePreload?: { polyfill?: boolean };
        rollupOptions?: { output?: { entryFileNames?: string; chunkFileNames?: string } };
      };
    };
    expect(config.assetsInclude).toContain("**/*.wasm");
    const recastWasmAlias = config.resolve?.alias?.find((alias) =>
      alias.find instanceof RegExp && alias.find.test("@recast-navigation/wasm")
    );
    expect(recastWasmAlias?.replacement).toBe("@recast-navigation/wasm/wasm");
    expect(recastWasmAlias?.find).toBeInstanceOf(RegExp);
    expect((recastWasmAlias?.find as RegExp).test("@recast-navigation/wasm")).toBe(true);
    expect((recastWasmAlias?.find as RegExp).test("@recast-navigation/wasm/wasm")).toBe(false);
    expect((recastWasmAlias?.find as RegExp).test("@recast-navigation/wasm-compat")).toBe(false);
    expect(config.optimizeDeps?.exclude).toEqual(expect.arrayContaining([
      "@dimforge/rapier3d",
      "@recast-navigation/wasm",
      "@recast-navigation/wasm/wasm",
    ]));
    expect(config.build?.target).toBe("es2022");
    expect(config.build?.sourcemap).toBe(false);
    expect(config.build?.assetsInlineLimit?.("engine.wasm", Buffer.alloc(1))).toBe(false);
    expect(config.build?.assetsInlineLimit?.("texture.webp", Buffer.alloc(1))).toBeUndefined();
    expect(config.build?.modulePreload?.polyfill).toBe(false);
    expect(config.build?.rollupOptions?.output?.entryFileNames).toMatch(/^assets\//);
    expect(config.build?.rollupOptions?.output?.chunkFileNames).toMatch(/^assets\//);

    const html = await readFile("game/index.html", "utf8");
    expect(html).not.toMatch(/<(?:script|link)\b[^>]*(?:src|href)="\/(?!\/)/);
    expect(html).not.toMatch(/rel="(?:modulepreload|preload)"/);
    expect(html).toContain('src="./src/main.ts"');

    const rapierWasmEntry = await readFile("node_modules/@dimforge/rapier3d/rapier_wasm3d.js", "utf8");
    expect(rapierWasmEntry).toContain('import * as wasm from "./rapier_wasm3d_bg.wasm"');

    let middleware: ((
      request: { url?: string },
      response: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => void) | undefined;
    const mimePlugin = config.plugins?.find((plugin) => plugin.name === "corealm-wasm-mime");
    expect(mimePlugin).toBeDefined();
    const configureServer = mimePlugin?.configureServer as ((server: {
      middlewares: { use: (handler: NonNullable<typeof middleware>) => void };
    }) => void) | undefined;
    configureServer?.({ middlewares: { use: (handler) => { middleware = handler; } } });
    expect(middleware).toBeDefined();
    const setHeader = vi.fn();
    const next = vi.fn();
    middleware?.({ url: "/Corealm/assets/wasm/rapier.wasm?v=1" }, { setHeader }, next);
    expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/wasm");
    expect(next).toHaveBeenCalledOnce();
  });
});
