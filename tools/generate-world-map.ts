import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import sharp, { type OverlayOptions } from "sharp";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { DEFAULT_WORLD_SEED } from "../game/src/app/worldSurface.js";
import { gameRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

const METRES_PER_PIXEL = 0.25;
const TILE_METRES = 50;
const TILE_PIXELS = TILE_METRES / METRES_PER_PIXEL;
// Thirty-two metres of guard keeps tree crowns and the lower daytime sun's longer shadows away
// from tile edges. Sharp still crops every tile back to the same 50 m, 200 px core.
const TILE_BLEED_PIXELS = 128;

const GPU_ARGS = [
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--mute-audio",
];

interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface MapMetadata {
  version: 3;
  source: "actual-game-scene";
  width: number;
  height: number;
  metresPerPixel: number;
  playableBounds: MapBounds;
  imageBounds: MapBounds;
  imagePaddingMetres: number;
  north: "+z";
  seed: number;
  sha256: string;
  renderFingerprint: string;
  tiles: { columns: number; rows: number; metres: number; pixels: number; bleedPixels: number };
  layers: readonly ["terrain", "stamped-ground", "water", "buildings", "props", "trees", "grass", "entities"];
  overlays: "none";
}

/**
 * Captures the actual Three scene in north-up orthographic tiles and stitches them into the map.
 * Nothing is reconstructed in Sharp: it only crops tile bleed, joins pixels, and compresses PNG.
 */
export async function generateWorldMap(): Promise<MapMetadata> {
  const spec = buildWorldTerrainSpec();
  const coast = spec.coast;
  if (!coast || coast.collar <= 0) {
    throw new Error("World-map capture needs a finalized positive coast collar.");
  }
  // Stop at the first full tile boundary outside the coastal mesh. That keeps the whole collar in
  // frame and leaves a strip of the ocean plane around it instead of ending on the skirt's edge.
  const imagePaddingMetres = (Math.floor(coast.collar / TILE_METRES) + 1) * TILE_METRES;
  const imageBounds: MapBounds = {
    minX: spec.bounds.minX - imagePaddingMetres,
    maxX: spec.bounds.maxX + imagePaddingMetres,
    minZ: spec.bounds.minZ - imagePaddingMetres,
    maxZ: spec.bounds.maxZ + imagePaddingMetres,
  };
  const columnCount = (imageBounds.maxX - imageBounds.minX) / TILE_METRES;
  const rowCount = (imageBounds.maxZ - imageBounds.minZ) / TILE_METRES;
  if (!Number.isInteger(columnCount) || !Number.isInteger(rowCount)) {
    throw new Error("Padded world-map bounds must tile exactly at the configured tile size.");
  }
  const columns = columnCount;
  const rows = rowCount;
  const outputWidth = columns * TILE_PIXELS;
  const outputHeight = rows * TILE_PIXELS;

  const server = await startGameServer({ logLevel: "error" });
  let browser: Browser | undefined;
  const errors: string[] = [];
  try {
    browser = await chromium.launch({ headless: true, args: GPU_ARGS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 1000)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 1000));
    });
    await page.routeWebSocket("**", () => undefined);
    await page.goto(`${server.url}?world-map-capture=1`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(
      () => window.__gameDebug?.getState().ready === true,
      undefined,
      { timeout: 120_000 },
    );
    await page.waitForTimeout(250);

    const gameErrors = await page.evaluate(() => {
      const method = (window.__gameDebug as unknown as { getErrors?: () => unknown[] } | undefined)?.getErrors;
      return typeof method === "function" ? method() : [];
    });
    if (gameErrors.length > 0) errors.push(`Game debug errors: ${JSON.stringify(gameErrors).slice(0, 2000)}`);

    const inputs: OverlayOptions[] = [];
    const bleedMetres = TILE_BLEED_PIXELS * METRES_PER_PIXEL;
    const capturePixels = TILE_PIXELS + TILE_BLEED_PIXELS * 2;
    const captureSpan = TILE_METRES + bleedMetres * 2;
    for (let row = 0; row < rows; row += 1) {
      const centreZ = imageBounds.maxZ - TILE_METRES * (row + 0.5);
      for (let column = 0; column < columns; column += 1) {
        const centreX = imageBounds.minX + TILE_METRES * (column + 0.5);
        const dataUrl = await page.evaluate((options) => {
          const api = window.__gameDebug as unknown as {
            captureWorldMapTile?: (value: typeof options) => string;
          } | undefined;
          if (typeof api?.captureWorldMapTile !== "function") {
            throw new Error("window.__gameDebug.captureWorldMapTile is unavailable");
          }
          return api.captureWorldMapTile(options);
        }, { centreX, centreZ, spanMetres: captureSpan, pixels: capturePixels });
        const comma = dataUrl.indexOf(",");
        if (comma < 0) throw new Error(`Map tile ${column},${row} did not return a data URL.`);
        const tile = await sharp(Buffer.from(dataUrl.slice(comma + 1), "base64"))
          // Capture keeps +X to the right; the vertical flip changes +Z from bottom to north/top.
          .flip()
          .extract({
            left: TILE_BLEED_PIXELS,
            top: TILE_BLEED_PIXELS,
            width: TILE_PIXELS,
            height: TILE_PIXELS,
          })
          .png()
          .toBuffer();
        inputs.push({ input: tile, left: column * TILE_PIXELS, top: row * TILE_PIXELS });
      }
    }

    if (errors.length > 0) throw new Error(`World-map browser capture failed:\n${errors.join("\n")}`);

    const outputDir = path.join(gameRoot, "public", "generated");
    const generatedSourceDir = path.join(gameRoot, "src", "generated");
    const imagePath = path.join(outputDir, "world-map.png");
    const metadataPath = path.join(outputDir, "world-map.json");
    const fingerprintPath = path.join(generatedSourceDir, "worldMapFingerprint.ts");
    await Promise.all([
      mkdir(outputDir, { recursive: true }),
      mkdir(generatedSourceDir, { recursive: true }),
    ]);
    const image = await sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite(inputs)
      .png({ compressionLevel: 9, quality: 100 })
      .toBuffer();
    const sha256 = createHash("sha256").update(image).digest("hex");
    await writeFile(imagePath, image);

    const metadata: MapMetadata = {
      version: 3,
      source: "actual-game-scene",
      width: outputWidth,
      height: outputHeight,
      metresPerPixel: METRES_PER_PIXEL,
      playableBounds: { ...spec.bounds },
      imageBounds,
      imagePaddingMetres,
      north: "+z",
      seed: DEFAULT_WORLD_SEED,
      sha256,
      renderFingerprint: sha256,
      tiles: {
        columns,
        rows,
        metres: TILE_METRES,
        pixels: TILE_PIXELS,
        bleedPixels: TILE_BLEED_PIXELS,
      },
      layers: ["terrain", "stamped-ground", "water", "buildings", "props", "trees", "grass", "entities"],
      overlays: "none",
    };
    await Promise.all([
      writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
      writeFile(
        fingerprintPath,
        "/** Generated by tools/generate-world-map.ts. Do not edit. */\n"
          + `export const WORLD_MAP_RENDER_FINGERPRINT = ${JSON.stringify(sha256)};\n`
          + `export const WORLD_MAP_IMAGE_BOUNDS = ${JSON.stringify(imageBounds)} as const;\n`,
        "utf8",
      ),
    ]);
    return metadata;
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  const metadata = await generateWorldMap();
  console.log(
    `Captured ${metadata.width}x${metadata.height} world map from the full game scene `
      + `(${metadata.tiles.columns}x${metadata.tiles.rows} tiles, no drawn overlays).`,
  );
}
