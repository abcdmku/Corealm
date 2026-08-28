/**
 * Generates Corealm's human-readable documentation from canonical content.
 *
 * The point is that these files cannot drift from the game: they are produced from the same tables
 * the runtime reads, so a rebalanced recipe rewrites its own documentation. Anything hand-written
 * here would be a second source of truth and would eventually be wrong.
 *
 * Usage: npx tsx tools/gen-docs.ts [--out docs/game]
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { argValue, repoRoot } from "./lib/paths.js";

import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RESOURCES, RESOURCE_ARCHETYPES } from "../game/src/content/resources.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { SPELLS } from "../game/src/content/spells.js";
import { ENEMIES, ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { SHOPS } from "../game/src/content/shops.js";
import { QUESTS } from "../game/src/content/quests.js";
import { REGIONS } from "../game/src/content/regions.js";
import { SKILLS } from "../game/src/content/skills.js";
import { MAX_LEVEL, TIERS, totalXpAt, xpTable } from "../game/src/content/xp.js";
import { gatherXp, healAmount, respawnSeconds, sellPrice, toolBonus, yieldRange } from "../game/src/content/index.js";
import type { SkillId } from "../game/src/contracts.js";

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [head, rule, body].join("\n");
}

function skillName(id: SkillId): string {
  return SKILLS[id]?.name ?? id;
}

function xpDoc(): string {
  const rows = xpTable()
    .map((xp, level) => [level, xp.toLocaleString(), level > 1 ? (xp - xpTable()[level - 1]!).toLocaleString() : "—"])
    .filter((row) => Number(row[0]) >= 1);
  return [
    "# Experience table",
    "",
    `Every skill runs from level 1 to level ${MAX_LEVEL}. Reaching ${MAX_LEVEL} costs`,
    `**${totalXpAt(MAX_LEVEL).toLocaleString()} experience**.`,
    "",
    `Content tiers sit at ${TIERS.join(", ")}. Level 92 is roughly the halfway point of the total,`,
    "so the last seven levels cost about as much as the first ninety-two.",
    "",
    table(["Level", "Total XP", "XP for this level"], rows),
    "",
  ].join("\n");
}

function skillsDoc(): string {
  const groups: Record<string, string[]> = {};
  for (const skill of Object.values(SKILLS)) {
    (groups[skill.group] ??= []).push(`**${skill.name}** — ${skill.blurb}`);
  }
  const sections = Object.entries(groups)
    .map(([group, lines]) => `## ${group[0]!.toUpperCase()}${group.slice(1)}\n\n${lines.join("\n\n")}`)
    .join("\n\n");

  const gatherRows = TIERS.map((tier) => {
    const [low, high] = yieldRange(tier);
    return [tier, gatherXp(tier), `${low}–${high}`, `${respawnSeconds(tier)} s`, `+${toolBonus(tier)}`];
  });

  return [
    "# Skills",
    "",
    sections,
    "",
    "## How gathering works",
    "",
    "Mining, Woodcutting and Fishing share one model. An attempt happens every **1.8 seconds**.",
    "At a node's own required level your success chance is exactly **30%** — one yield every six",
    "seconds — rising 1.6 percentage points per level above the requirement, capped at 95%.",
    "",
    "A better tool raises your *effective* level but never lets you gather something you do not",
    "meet the base requirement for.",
    "",
    table(["Tier", "XP per yield", "Yields per node", "Respawn", "Tool bonus"], gatherRows),
    "",
    "## How combat works",
    "",
    "Attacks resolve on a 600 ms tick. Your chance to hit is `attackRoll / (attackRoll + defenceRoll)`,",
    "clamped between 5% and 95%. Melee damage rolls 1 to `floor(2 + (Melee + gear power) / 4.2)`.",
    "",
    "There is no separate Defence skill: **Melee is your physical defence and Magic is your magical",
    "defence**. Health is derived as `20 + 3 × floor((Melee + Magic) / 2)` plus equipment vitality.",
    "",
    "Magic is 15% more accurate and each cast costs an essence shard. It beats high-armour,",
    "low-magic-armour targets; melee beats the reverse.",
    "",
    "You gain 4 experience per point of damage, plus twice the target's maximum health on the kill.",
    "",
  ].join("\n");
}

function itemsDoc(): string {
  const rows = [...ALL_ITEMS]
    .sort((a, b) => a.tier - b.tier || a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    .map((item) => {
      const requires = item.equip
        ? Object.entries(item.equip.requires).map(([skill, level]) => `${skillName(skill as SkillId)} ${level}`).join(", ")
        : "";
      const notes = [
        item.equip ? `${item.equip.slot}` : "",
        item.food ? `heals ${item.food.healAmount}` : "",
        item.tool ? `${item.tool.skill} +${item.tool.gatherBonus}` : "",
        requires,
      ].filter(Boolean).join("; ");
      return [item.name, item.tier, item.category, item.stackable ? "yes" : "no", item.value, sellPrice(item.value), notes || "—"];
    });
  return [
    "# Item encyclopedia",
    "",
    `${ALL_ITEMS.length} items. Shop price is what a shop charges; sell price is what one pays you.`,
    "",
    table(["Item", "Tier", "Category", "Stacks", "Buy", "Sell", "Notes"], rows),
    "",
  ].join("\n");
}

function recipesDoc(): string {
  const bySkill = new Map<SkillId, typeof RECIPES[number][]>();
  for (const recipe of RECIPES) {
    const list = bySkill.get(recipe.skill) ?? [];
    list.push(recipe);
    bySkill.set(recipe.skill, list);
  }
  const sections = [...bySkill.entries()].map(([skill, recipes]) => {
    const rows = [...recipes].sort((a, b) => a.reqLevel - b.reqLevel).map((recipe) => [
      recipe.name,
      recipe.reqLevel,
      recipe.station ?? "anywhere",
      recipe.inputs.map((input) => `${input.quantity}× ${content.item(input.itemId)?.name ?? input.itemId}`).join(" + "),
      `${recipe.output.quantity}× ${content.item(recipe.output.itemId)?.name ?? recipe.output.itemId}`,
      `${(recipe.durationMs / 1000).toFixed(1)} s`,
      recipe.xp,
    ]);
    return `## ${skillName(skill)}\n\n${table(["Recipe", "Level", "Station", "Ingredients", "Makes", "Time", "XP"], rows)}`;
  });
  return ["# Recipes", "", `${RECIPES.length} recipes across four production skills.`, "", sections.join("\n\n"), ""].join("\n");
}

function enemiesDoc(): string {
  // `ENEMY_BLOCKS` is the canonical set: one stat block per creature. `ENEMIES` adds an alias row
  // per world group so a lookup by group id resolves, and those aliases are lookup keys, not
  // creatures. The index counts the same thing this table shows — see `main`.
  const rows = [...ENEMY_BLOCKS]
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
    .map((enemy) => [
      enemy.name, enemy.tier, enemy.maxHealth, enemy.maxHit,
      `${(enemy.attackSpeedMs / 1000).toFixed(1)} s`,
      enemy.armour, enemy.magicArmour, enemy.behaviour,
    ]);
  return [
    "# Enemies",
    "",
    "Armour resists melee; magic armour resists spells. A target with high armour and low magic",
    "armour is where Magic earns its cost, and the reverse is where Melee does.",
    "",
    table(["Enemy", "Tier", "Health", "Max hit", "Speed", "Armour", "Magic armour", "Behaviour"], rows),
    "",
  ].join("\n");
}

function resourcesDoc(): string {
  // Same alias situation as enemies: `RESOURCE_ARCHETYPES` is the canonical set and `RESOURCES`
  // adds one alias per world cluster. The index counts archetypes, matching this table.
  const rows = [...RESOURCE_ARCHETYPES]
    .sort((a, b) => a.tier - b.tier || a.skill.localeCompare(b.skill))
    .map((resource) => {
      const [low, high] = yieldRange(resource.tier);
      return [
        resource.name, skillName(resource.skill), resource.tier, resource.reqLevel,
        content.item(resource.itemId)?.name ?? resource.itemId,
        gatherXp(resource.tier), `${low}–${high}`, `${respawnSeconds(resource.tier)} s`,
      ];
    });
  return [
    "# Resources",
    "",
    "What each node gives, what it needs, and how long it lasts before it has to come back.",
    "",
    table(["Node", "Skill", "Tier", "Level", "Yields", "XP each", "Per node", "Respawn"], rows),
    "",
  ].join("\n");
}

function regionsDoc(): string {
  const sections = REGIONS.map((region) => {
    const resources = region.clusters.map((cluster) =>
      `- **${cluster.name}** — tier ${cluster.tier} ${cluster.skill}, needs level ${cluster.reqLevel}`);
    const places = region.locations.map((location) => `- **${location.name}** (\`${location.id}\`)`);
    return [
      `## ${region.name}`,
      "",
      region.lore,
      "",
      `Tier ${region.tier}. ${region.settlement ? `Settlement: **${region.settlement.name}**.` : ""}`,
      "",
      "### Resources",
      "",
      resources.join("\n") || "_None._",
      "",
      "### Places",
      "",
      places.join("\n"),
    ].join("\n");
  });
  return ["# Regions", "", sections.join("\n\n"), ""].join("\n");
}

function questsDoc(): string {
  const rows = QUESTS.map((quest) => [
    quest.name,
    quest.regionId,
    quest.stages.length,
    Object.entries(quest.requirements).map(([skill, level]) => `${skillName(skill as SkillId)} ${level}`).join(", ") || "—",
    quest.prerequisiteQuestIds.join(", ") || "—",
  ]);
  return [
    "# Quests",
    "",
    `${QUESTS.length} quests. Objectives and rewards are listed in the game's quest journal;`,
    "later stages are deliberately not printed here, because a walkthrough is not documentation.",
    "",
    table(["Quest", "Region", "Stages", "Requires", "After"], rows),
    "",
  ].join("\n");
}

function spellsAndShopsDoc(): string {
  const spellRows = SPELLS.map((spell) => [
    spell.name, spell.reqLevel, spell.baseMax, spell.divisor, spell.baseXp,
    `${(spell.castMs / 1000).toFixed(1)} s`,
    `${spell.cost.quantity}× ${content.item(spell.cost.itemId)?.name ?? spell.cost.itemId}`,
  ]);
  const shopSections = SHOPS.map((shop) => {
    const rows = shop.stock.map((entry) => {
      const item = content.item(entry.itemId);
      return [item?.name ?? entry.itemId, entry.quantity, Math.round((item?.value ?? 0) * shop.buyMultiplier)];
    });
    return `### ${shop.name}\n\n${table(["Item", "Stock", "Price"], rows)}`;
  });
  return [
    "# Spells and shops",
    "",
    "## Spells",
    "",
    "Maximum damage is `baseMax + (Magic level + magic power) / divisor`. Experience is awarded",
    "whether the cast hits or misses.",
    "",
    table(["Spell", "Magic level", "Base max", "Divisor", "XP", "Cast time", "Cost"], spellRows),
    "",
    "## Shops",
    "",
    shopSections.join("\n\n"),
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const out = path.resolve(repoRoot, argValue(process.argv.slice(2), "--out") ?? "docs/game");
  await mkdir(out, { recursive: true });

  content.register({
    items: ALL_ITEMS, resources: RESOURCES, recipes: RECIPES,
    spells: SPELLS, enemies: ENEMIES, shops: SHOPS,
  });

  const files: [string, string][] = [
    ["experience.md", xpDoc()],
    ["skills.md", skillsDoc()],
    ["items.md", itemsDoc()],
    ["recipes.md", recipesDoc()],
    ["enemies.md", enemiesDoc()],
    ["resources.md", resourcesDoc()],
    ["regions.md", regionsDoc()],
    ["quests.md", questsDoc()],
    ["spells-and-shops.md", spellsAndShopsDoc()],
  ];

  const index = [
    "# Corealm game documentation",
    "",
    "Generated from canonical content by `npm run gen-docs`. Do not edit these files by hand —",
    "they are regenerated from the same tables the game itself reads, which is what keeps them",
    "from drifting away from what the game actually does.",
    "",
    ...files.map(([name]) => `- [${name.replace(/\.md$/, "").replace(/-/g, " ")}](./${name})`),
    "",
    "## Counts",
    "",
    "One row per thing that exists, matching the page it links to. Enemies and resources also",
    "publish alias ids so a lookup by world group resolves to the same block; those aliases are",
    `lookup keys rather than content, and are counted separately below.`,
    "",
    table(["Table", "Rows"], [
      ["Items", ALL_ITEMS.length], ["Resources", RESOURCE_ARCHETYPES.length], ["Recipes", RECIPES.length],
      ["Spells", SPELLS.length], ["Enemies", ENEMY_BLOCKS.length], ["Shops", SHOPS.length],
      ["Quests", QUESTS.length], ["Regions", REGIONS.length], ["Skills", Object.keys(SKILLS).length],
    ]),
    "",
    table(["Lookup table", "Ids that resolve"], [
      ["Enemy ids (blocks + group aliases)", ENEMIES.length],
      ["Resource ids (archetypes + cluster aliases)", RESOURCES.length],
    ]),
    "",
  ].join("\n");

  await writeFile(path.join(out, "README.md"), index, "utf8");
  for (const [name, body] of files) await writeFile(path.join(out, name), body, "utf8");

  console.log(`Wrote ${files.length + 1} files to ${path.relative(repoRoot, out)}`);
  for (const [name, body] of files) console.log(`  ${name.padEnd(22)} ${body.split("\n").length} lines`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
