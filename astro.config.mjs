import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { sites } from "@openai/sites-vite-plugin";
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.DOCS_BASE ?? "/";
const site = process.env.DOCS_SITE_URL;
const asset = (pathname) => `${base.replace(/\/$/, "")}${pathname}` || pathname;
const socialAsset = (pathname) => site ? new URL(asset(pathname), site).href : asset(pathname);

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

      await writeFile(
        path.join(serverDir, "index.js"),
        `export default {\n  async fetch(request, env) {\n    const direct = await env.ASSETS.fetch(request);\n    if (direct.status !== 404 || !["GET", "HEAD"].includes(request.method)) return direct;\n\n    const url = new URL(request.url);\n    const cleanPath = url.pathname.endsWith("/")\n      ? \`\${url.pathname}index.html\`\n      : \`\${url.pathname}/index.html\`;\n    const cleanUrl = new URL(cleanPath, url);\n    return env.ASSETS.fetch(new Request(cleanUrl, request));\n  },\n};\n`,
      );
      await writeFile(path.join(serverDir, "wrangler.json"), JSON.stringify({
        name: "corealm-codex",
        main: "index.js",
        compatibility_date: "2026-05-15",
        no_bundle: true,
        rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
        assets: { directory: "../client" },
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
            { label: "Quest guides", link: "/game/quests/" },
            { label: "People", link: "/game/npcs/" },
            { label: "Bestiary", link: "/game/enemies/" },
            { label: "Places", link: "/game/locations/" },
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
        { tag: "meta", attrs: { property: "og:description", content: "Guides, people, creatures, quests, and places generated from the live game." } },
        { tag: "meta", attrs: { property: "og:image", content: socialAsset("/og.png") } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
      ],
    }),
    sitesStaticWorker,
  ],
  vite: { plugins: [sites()] },
});
