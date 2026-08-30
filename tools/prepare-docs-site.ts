/** Stages generated Markdown and its local assets into Starlight's content tree. */
import path from "node:path";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./lib/paths.js";

const source = path.resolve(repoRoot, "docs/game");
const docsSiteRoot = path.resolve(repoRoot, "docs-site");
const target = path.resolve(docsSiteRoot, "src/content/docs/game");
const worldMapSource = path.resolve(source, "assets/world-map.webp");
const worldMapTarget = path.resolve(docsSiteRoot, "public/game/locations/assets/world-map.webp");

function assertSafeTarget(): void {
  const relative = path.relative(docsSiteRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`Refusing to stage generated docs outside ${docsSiteRoot}: ${target}`);
  }
}

async function main(): Promise<void> {
  assertSafeTarget();
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  await rename(path.join(target, "README.md"), path.join(target, "index.md"));
  await mkdir(path.dirname(worldMapTarget), { recursive: true });
  await cp(worldMapSource, worldMapTarget);
  console.log(`Staged ${path.relative(repoRoot, source)} in ${path.relative(repoRoot, target)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
