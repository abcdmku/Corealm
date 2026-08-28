/**
 * Downloads free CC0 Quaternius asset packs from itch.io using a real browser.
 *
 * This is harness tooling, not game code. It writes zips into a local cache
 * directory that is gitignored; a separate step (tools/build-assets.ts) curates
 * GLBs into game/public/assets/ with a manifest entry.
 *
 * Older Quaternius pack pages hide the ".buy_btn" (Download Now) control, so
 * clicking it never works. Every itch project exposes the same free-download
 * flow at /<slug>/purchase, so we navigate there directly, take the
 * "No thanks, just take me to the downloads" link, and collect the resulting
 * a.download_btn[data-upload_id] buttons. Modern pages land on the same page,
 * so a single path handles both eras.
 *
 * Usage: npx tsx tools/fetch-assets.ts <itch-slug> [<itch-slug> ...]
 */
import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { repoRoot } from "./lib/paths.js";

const CACHE = path.join(repoRoot, ".asset-cache");
const USER = "quaternius";

function cacheName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._\[\]()-]+/g, "_");
}

/** Reach the page that lists a.download_btn[data-upload_id] for a free itch project. */
async function openDownloadList(page: Page, slug: string): Promise<void> {
  const base = `https://${USER}.itch.io/${slug}`;

  // The purchase route is the reliable entry point on both old and new layouts.
  await page.goto(`${base}/purchase`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);

  const noThanks = page
    .locator("a:has-text('No thanks, just take me to the downloads'), a.direct_download_btn")
    .first();
  if (await noThanks.count()) {
    await noThanks.click({ timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(2000);
  }

  if (await page.locator("a.download_btn[data-upload_id]").count()) return;

  // Fallback: the classic project-page flow, for projects that price-gate /purchase.
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1000);
  const buyBtn = page.locator("a.download_btn, .buy_btn").first();
  if (await buyBtn.count()) {
    await buyBtn.click({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const noThanks2 = page.locator("a:has-text('No thanks, just take me to the downloads')").first();
    if (await noThanks2.count()) {
      await noThanks2.click({ timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(2500);
    }
  }
}

export async function fetchPack(slug: string): Promise<string[]> {
  await mkdir(CACHE, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const saved: string[] = [];
  try {
    await openDownloadList(page, slug);

    const buttons = page.locator("a.download_btn[data-upload_id]");
    const count = await buttons.count();
    if (count === 0) throw new Error(`No upload buttons found for ${slug} (page: ${page.url()})`);

    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      const raw =
        (await button
          .locator("xpath=../..")
          .locator(".upload_name .name")
          .first()
          .getAttribute("title")
          .catch(() => null)) ?? `${slug}-${index}.zip`;
      const target = path.join(CACHE, cacheName(raw));
      try {
        await stat(target);
        console.log(`cached  ${raw}`);
        saved.push(target);
        continue;
      } catch {
        /* not cached yet */
      }
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 600_000 }),
        button.click(),
      ]);
      await download.saveAs(target);
      console.log(`saved   ${raw}`);
      saved.push(target);
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return saved;
}

const slugs = process.argv.slice(2);
if (slugs.length === 0) {
  console.error("Usage: npx tsx tools/fetch-assets.ts <itch-slug> [...]");
  process.exit(1);
}
for (const slug of slugs) {
  console.log(`== ${slug}`);
  try {
    await fetchPack(slug);
  } catch (error) {
    console.error(`FAILED ${slug}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
