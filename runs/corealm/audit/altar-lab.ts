import path from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import type { FeatureLabState } from "../../../game/src/contracts.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer({ logLevel: "error" });
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const diagnostics = { console: [] as string[], page: [] as string[] };
page.on("console", (message) => {
  if (message.type() === "error") diagnostics.console.push(message.text());
});
page.on("pageerror", (error) => diagnostics.page.push(error.stack ?? error.message));

try {
  const url = new URL("/index.html", server.url);
  url.searchParams.set("mode", "building");
  url.searchParams.set("kind", "composition");
  url.searchParams.set("id", "essence_altar_ruins");
  url.searchParams.set("kit", "stone");
  await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(
    () => window.__featureLab?.getState().ready === true,
    undefined,
    { timeout: 45_000 },
  );

  const output = path.join(process.cwd(), "test-results", "feature-labs");
  await mkdir(output, { recursive: true });
  const dormant = await page.evaluate(() => window.__featureLab!.getState());
  requireAltarState(dormant, "dormant");
  await page.evaluate(() => window.__featureLab!.fitStructure());
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(output, "essence-altar-dormant.png"),
    timeout: 10_000,
  });

  const awakened = await page.evaluate(() => window.__featureLab!.perform("awaken-altar"));
  requireAltarState(awakened, "awakened");
  if (!awakened.altar?.orbConsumed) throw new Error("Air Orb was not consumed by awakening");
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(output, "essence-altar-awakened.png"),
    timeout: 10_000,
  });

  if (diagnostics.console.length > 0 || diagnostics.page.length > 0) {
    throw new Error(`Browser diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  console.log(JSON.stringify({
    structure: awakened.structure,
    dormant: dormant.altar,
    awakened: awakened.altar,
    diagnostics,
  }, null, 2));
} finally {
  await page.close();
  await browser.close();
  await server.close();
}

function requireAltarState(state: FeatureLabState, expected: "dormant" | "awakened"): void {
  if (state.structure.selection.kind !== "composition"
    || state.structure.selection.id !== "essence_altar_ruins") {
    throw new Error(`Wrong lab structure: ${JSON.stringify(state.structure.selection)}`);
  }
  if (state.structure.partCount < 2 || state.structure.collisionCount < 1) {
    throw new Error(`Incomplete altar structure: ${JSON.stringify(state.structure)}`);
  }
  if (!state.structure.ready || state.errors.length > 0) {
    throw new Error(`Altar lab errors: ${state.errors.join("; ")}`);
  }
  if (state.altar?.state !== expected) {
    throw new Error(`Expected ${expected} altar, got ${state.altar?.state ?? "none"}`);
  }
}
