import path from "node:path";
import { pathToFileURL } from "node:url";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { ALL_ITEMS } from "../game/src/content/items.js";
import type { ItemId } from "../game/src/contracts.js";
import { itemIconAppearance } from "../game/src/render/itemIconAppearances.js";
import { repoRoot } from "./lib/paths.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

export const ITEM_ICON_MASTER_SIZE = 256;
export const ITEM_ICON_GAME_SIZE = 48;
const ITEM_ICON_CONTENT_SIZE = 44;
const ITEM_ICON_OUTLINE_RADIUS = 1;
export const ITEM_ICON_MASTER_DIR = path.join(repoRoot, "art", "item-icons", "256");
export const ITEM_ICON_GAME_DIR = path.join(repoRoot, "game", "public", "assets", "icons", "items", "48");
export const ITEM_ICON_CONTACT_SHEET = path.join(repoRoot, "art", "item-icons", "contact-sheet-48.png");

export interface GenerateItemIconOptions {
  all?: boolean;
}

interface ImageCheck {
  ok: boolean;
  reason?: string;
}

export function itemIconFiles(itemId: ItemId): { master: string; game: string } {
  return {
    master: path.join(ITEM_ICON_MASTER_DIR, `${itemId}.png`),
    game: path.join(ITEM_ICON_GAME_DIR, `${itemId}.png`),
  };
}

async function inspectImage(input: Buffer, expectedSize: number): Promise<ImageCheck> {
  try {
    const source = sharp(input, { failOn: "error" });
    const metadata = await source.metadata();
    if (metadata.width !== expectedSize || metadata.height !== expectedSize) {
      return { ok: false, reason: `${metadata.width ?? "?"}x${metadata.height ?? "?"}, expected ${expectedSize}x${expectedSize}` };
    }
    if (!metadata.hasAlpha) return { ok: false, reason: "no alpha channel" };

    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let visible = 0;
    let transparent = 0;
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const alpha = data[(y * info.width + x) * info.channels + 3] ?? 0;
        if (alpha < 250) transparent += 1;
        if (alpha <= 8) continue;
        visible += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (visible < expectedSize * expectedSize * 0.01) return { ok: false, reason: `only ${visible} visible pixels` };
    if (transparent < expectedSize * expectedSize * 0.01) return { ok: false, reason: "background is opaque" };
    const safeMargin = expectedSize >= 128 ? 4 : 1;
    if (minX < safeMargin || minY < safeMargin || maxX >= expectedSize - safeMargin || maxY >= expectedSize - safeMargin) {
      return { ok: false, reason: `visible bounds ${minX},${minY}-${maxX},${maxY} touch the safe margin` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function validFile(file: string, size: number): Promise<boolean> {
  try {
    return (await inspectImage(await readFile(file), size)).ok;
  } catch {
    return false;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function deriveGameIcon(master: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(master)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize(ITEM_ICON_CONTENT_SIZE, ITEM_ICON_CONTENT_SIZE, {
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const silhouette = Buffer.alloc(data.length);
  for (let offset = 0; offset < data.length; offset += info.channels) {
    silhouette[offset] = 0;
    silhouette[offset + 1] = 0;
    silhouette[offset + 2] = 0;
    silhouette[offset + 3] = data[offset + 3] ?? 0;
  }
  const raw = { width: info.width, height: info.height, channels: info.channels } as const;
  const [foregroundPng, silhouettePng] = await Promise.all([
    sharp(data, { raw }).png().toBuffer(),
    sharp(silhouette, { raw }).png().toBuffer(),
  ]);
  const left = Math.floor((ITEM_ICON_GAME_SIZE - info.width) / 2);
  const top = Math.floor((ITEM_ICON_GAME_SIZE - info.height) / 2);
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  for (let y = -ITEM_ICON_OUTLINE_RADIUS; y <= ITEM_ICON_OUTLINE_RADIUS; y += 1) {
    for (let x = -ITEM_ICON_OUTLINE_RADIUS; x <= ITEM_ICON_OUTLINE_RADIUS; x += 1) {
      if (x === 0 && y === 0) continue;
      layers.push({ input: silhouettePng, left: left + x, top: top + y });
    }
  }
  layers.push({ input: foregroundPng, left, top });

  return sharp({
    create: {
      width: ITEM_ICON_GAME_SIZE,
      height: ITEM_ICON_GAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colours: 256 })
    .toBuffer();
}

function decodePngDataUrl(value: string): Buffer {
  const match = /^data:image\/png;base64,(.+)$/.exec(value);
  if (!match?.[1]) throw new Error("Item icon renderer returned a non-PNG data URL");
  return Buffer.from(match[1], "base64");
}

async function openRenderer(): Promise<{
  server: RunningGameServer;
  browser: Browser;
  page: Page;
  errors: string[];
}> {
  const server = await startGameServer({ logLevel: "error" });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--mute-audio"] });
    const page = await browser.newPage({ viewport: { width: ITEM_ICON_MASTER_SIZE, height: ITEM_ICON_MASTER_SIZE } });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 1000));
    });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 1000)));
    await page.goto(`${server.url}/item-icon-renderer.html`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => window.__itemIconRenderer?.ready === true, undefined, { timeout: 30_000 });
    return { server, browser, page, errors };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    throw error;
  }
}

async function renderMaster(page: Page, itemId: ItemId): Promise<Buffer> {
  const dataUrl = await page.evaluate(async (id) => {
    const api = window.__itemIconRenderer;
    if (!api?.ready) throw new Error("window.__itemIconRenderer is not ready");
    return api.render(id);
  }, itemId);
  return decodePngDataUrl(dataUrl);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function writeContactSheet(): Promise<void> {
  const columns = 6;
  const cellWidth = 200;
  const cellHeight = 72;
  const rows = Math.ceil(ALL_ITEMS.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const cells: string[] = [];
  for (const [index, item] of ALL_ITEMS.entries()) {
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const image = (await readFile(itemIconFiles(item.id).game)).toString("base64");
    cells.push(
      `<g transform="translate(${x} ${y})">`,
      `<rect width="${cellWidth}" height="${cellHeight}" fill="${index % 2 === 0 ? "#1d1916" : "#241f1a"}" stroke="#3d352d"/>`,
      `<image x="8" y="12" width="48" height="48" href="data:image/png;base64,${image}"/>`,
      `<text x="64" y="30" fill="#eee7da" font-family="Segoe UI, sans-serif" font-size="12">${escapeXml(item.name)}</text>`,
      `<text x="64" y="47" fill="#9d9284" font-family="Consolas, monospace" font-size="9">${escapeXml(item.id)}</text>`,
      "</g>",
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171411"/>${cells.join("")}</svg>`;
  await mkdir(path.dirname(ITEM_ICON_CONTACT_SHEET), { recursive: true });
  await writeFile(ITEM_ICON_CONTACT_SHEET, await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
}

export async function generateItemIcons(options: GenerateItemIconOptions = {}): Promise<{
  rendered: number;
  derived: number;
}> {
  // Resolve the catalog before touching the filesystem. A missing mapping is a source error.
  for (const item of ALL_ITEMS) itemIconAppearance(item.id);

  await mkdir(ITEM_ICON_MASTER_DIR, { recursive: true });
  await mkdir(ITEM_ICON_GAME_DIR, { recursive: true });

  const masterNeeded = new Set<ItemId>();
  const gameNeeded = new Set<ItemId>();
  for (const item of ALL_ITEMS) {
    const files = itemIconFiles(item.id);
    if (options.all || !(await validFile(files.master, ITEM_ICON_MASTER_SIZE))) masterNeeded.add(item.id);
    if (options.all || masterNeeded.has(item.id) || !(await validFile(files.game, ITEM_ICON_GAME_SIZE))) gameNeeded.add(item.id);
  }

  let rendered = 0;
  let derived = 0;
  let rendererSession: Awaited<ReturnType<typeof openRenderer>> | undefined;
  try {
    if (masterNeeded.size > 0) {
      rendererSession = await openRenderer();
      for (const item of ALL_ITEMS) {
        if (!masterNeeded.has(item.id)) continue;
        const master = await renderMaster(rendererSession.page, item.id);
        const check = await inspectImage(master, ITEM_ICON_MASTER_SIZE);
        if (!check.ok) {
          const diagnostic = path.join(repoRoot, "runs", "corealm", "icon-diagnostics", `${item.id}.png`);
          await mkdir(path.dirname(diagnostic), { recursive: true });
          await writeFile(diagnostic, master);
          throw new Error(`${item.id} master failed validation: ${check.reason}; wrote ${diagnostic}`);
        }
        await writeFile(itemIconFiles(item.id).master, master);
        rendered += 1;
        process.stdout.write(`rendered ${item.id}\n`);
      }
      if (rendererSession.errors.length > 0) {
        throw new Error(`Item icon renderer reported browser errors:\n${rendererSession.errors.join("\n")}`);
      }
    }

    for (const item of ALL_ITEMS) {
      if (!gameNeeded.has(item.id)) continue;
      const master = await readFile(itemIconFiles(item.id).master);
      const game = await deriveGameIcon(master);
      const check = await inspectImage(game, ITEM_ICON_GAME_SIZE);
      if (!check.ok) throw new Error(`${item.id} ${ITEM_ICON_GAME_SIZE}px icon failed validation: ${check.reason}`);
      await writeFile(itemIconFiles(item.id).game, game);
      derived += 1;
    }
    if (rendered > 0 || derived > 0 || !(await fileExists(ITEM_ICON_CONTACT_SHEET))) await writeContactSheet();
  } finally {
    await rendererSession?.browser.close().catch(() => undefined);
    await rendererSession?.server.close().catch(() => undefined);
  }

  process.stdout.write(`item icons: ${rendered} master render(s), ${derived} gameplay derivative(s)\n`);
  return { rendered, derived };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--all");
  if (unknown.length > 0) throw new Error(`Usage: npm run icons [-- --all]\nUnknown argument(s): ${unknown.join(", ")}`);
  await generateItemIcons({ all: args.includes("--all") });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
