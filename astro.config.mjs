import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { sites } from "@openai/sites-vite-plugin";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const base = process.env.DOCS_BASE ?? "/";
const site = process.env.DOCS_SITE_URL;
const asset = (pathname) => `${base.replace(/\/$/, "")}${pathname}` || pathname;
const socialAsset = (pathname) => site ? new URL(asset(pathname), site).href : asset(pathname);

const sitesStaticWorker = {
  name: "corealm-sites-static-worker",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      const serverDir = new URL("./server/", dir);
      await mkdir(fileURLToPath(serverDir), { recursive: true });
      await writeFile(
        new URL("index.js", serverDir),
        `export default {\n  fetch(request, env) {\n    return env.ASSETS.fetch(request);\n  },\n};\n`,
      );
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
