import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { sites } from "@openai/sites-vite-plugin";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.DOCS_BASE ?? "/";
const site = process.env.DOCS_SITE_URL;
const asset = (pathname) => `${base.replace(/\/$/, "")}${pathname}` || pathname;
const socialAsset = (pathname) => site ? new URL(asset(pathname), site).href : asset(pathname);

async function rewriteHostedImagePaths(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteHostedImagePaths(entryPath);
    } else if (entry.name.endsWith(".html")) {
      const html = await readFile(entryPath, "utf8");
      await writeFile(entryPath, html.replace(/\/_astro\/([^"'\s>]+\.webp)/g, "/__corealm_media/$1"));
    }
  }
}

const sitesStaticWorker = {
  name: "corealm-sites-static-worker",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      const outDir = fileURLToPath(dir);
      const clientDir = path.join(outDir, "client");
      const serverDir = path.join(outDir, "server");
      await mkdir(clientDir, { recursive: true });
      await mkdir(serverDir, { recursive: true });

      for (const entry of await readdir(outDir, { withFileTypes: true })) {
        if ([".openai", "client", "server"].includes(entry.name)) continue;
        await cp(path.join(outDir, entry.name), path.join(clientDir, entry.name), { recursive: true });
      }
      await rewriteHostedImagePaths(clientDir);

      await writeFile(
        path.join(serverDir, "index.js"),
        `const contentTypes = {\n  ".avif": "image/avif",\n  ".css": "text/css; charset=utf-8",\n  ".gif": "image/gif",\n  ".html": "text/html; charset=utf-8",\n  ".ico": "image/x-icon",\n  ".jpeg": "image/jpeg",\n  ".jpg": "image/jpeg",\n  ".js": "text/javascript; charset=utf-8",\n  ".json": "application/json; charset=utf-8",\n  ".mjs": "text/javascript; charset=utf-8",\n  ".png": "image/png",\n  ".svg": "image/svg+xml",\n  ".wasm": "application/wasm",\n  ".webp": "image/webp",\n  ".woff": "font/woff",\n  ".woff2": "font/woff2",\n};\n\nfunction withContentType(response, pathname) {\n  const extension = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();\n  const contentType = contentTypes[extension];\n  if (!contentType) return response;\n  const headers = new Headers(response.headers);\n  headers.set("Content-Type", contentType);\n  return new Response(response.body, {\n    status: response.status,\n    statusText: response.statusText,\n    headers,\n  });\n}\n\nasync function serveAsset(request, env) {\n  const response = await env.ASSETS.fetch(request);\n  return withContentType(response, new URL(request.url).pathname);\n}\n\nexport default {\n  async fetch(request, env) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith("/__corealm_media/")) {\n      const assetUrl = new URL(url);\n      assetUrl.pathname = url.pathname.replace("/__corealm_media/", "/_astro/");\n      return serveAsset(new Request(assetUrl, request), env);\n    }\n\n    const direct = await serveAsset(request, env);\n    if (direct.status !== 404 || !["GET", "HEAD"].includes(request.method)) return direct;\n    const cleanPath = url.pathname.endsWith("/")\n      ? \`\${url.pathname}index.html\`\n      : \`\${url.pathname}/index.html\`;\n    const cleanUrl = new URL(cleanPath, url);\n    return serveAsset(new Request(cleanUrl, request), env);\n  },\n};\n`,
      );
      await writeFile(path.join(serverDir, "wrangler.json"), JSON.stringify({
        name: "corealm-codex",
        main: "index.js",
        compatibility_date: "2026-05-15",
        no_bundle: true,
        rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
        assets: { binding: "ASSETS", directory: "../client", run_worker_first: true },
      }));
    },
  },
};

export default defineConfig({
  srcDir: "./docs-site/src",
  publicDir: "./docs-site/public",
  outDir: "./dist",
  base,
  site,
  integrations: [
    starlight({
      title: "Corealm Codex",
      description: "Game guides generated from Corealm's live content.",
      favicon: asset("/favicon.svg"),
      customCss: ["./docs-site/src/styles/corealm.css"],
      defaultLocale: "root",
      locales: { root: { label: "English", lang: "en" } },
      lastUpdated: true,
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/abcdmku/Corealm" },
      ],
      sidebar: [
        { label: "Start here", items: [{ label: "The Codex", link: "/" }] },
        {
          label: "World guide",
          items: [
            { label: "Guide index", link: "/game/" },
            { label: "Quests", link: "/game/quests/" },
            { label: "People", link: "/game/npcs/" },
            { label: "Creatures", link: "/game/creatures/" },
            { label: "Regions", link: "/game/regions/" },
          ],
        },
        {
          label: "Systems",
          items: [
            { label: "Items", link: "/game/items/" },
            { label: "Recipes", link: "/game/recipes/" },
            { label: "Resources", link: "/game/resources/" },
            { label: "Skills", link: "/game/skills/" },
            { label: "Experience", link: "/game/experience/" },
            { label: "Spells and shops", link: "/game/spells-and-shops/" },
          ],
        },
      ],
      head: [
        { tag: "meta", attrs: { property: "og:title", content: "Corealm Codex" } },
        { tag: "meta", attrs: { property: "og:description", content: "Guides, people, creatures, quests, and regions generated from the live game." } },
        { tag: "meta", attrs: { property: "og:image", content: socialAsset("/og.png") } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "script", attrs: { type: "module", src: asset("/corealm-map.js") } },
      ],
    }),
    sitesStaticWorker,
  ],
  vite: { plugins: [sites()] },
});
