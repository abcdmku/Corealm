/**
 * Generates the public game guide from the canonical content tables.
 *
 * The Markdown and the website consume the same output. Screenshots are produced separately by
 * tools/capture-docs.ts from the running Chromium game, then referenced here by stable content id.
 *
 * Usage: npx tsx tools/gen-docs.ts [--out docs/game]
 */
import path from "node:path";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { argValue, repoRoot } from "./lib/paths.js";

import { content, gatherXp, respawnSeconds, sellPrice, toolBonus, yieldRange } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RESOURCES, RESOURCE_ARCHETYPES } from "../game/src/content/resources.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { SPELLS } from "../game/src/content/spells.js";
import { ENEMIES, ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { SHOPS } from "../game/src/content/shops.js";
import { QUESTS, type QuestGrant } from "../game/src/content/quests.js";
import { NPCS, npc, npcGivingQuest } from "../game/src/content/npcs.js";
import { REGIONS, type LocationDef } from "../game/src/content/regions.js";
import { SKILLS } from "../game/src/content/skills.js";
import { MAX_LEVEL, TIERS, totalXpAt, xpTable } from "../game/src/content/xp.js";
import type { QuestObjectiveRef, RegionId, SkillId } from "../game/src/contracts.js";

function cleanCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.map(cleanCell).join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(cleanCell).join(" | ")} |`).join("\n");
  return [head, rule, body].join("\n");
}

function page(title: string, description: string, body: string): string {
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

function skillName(id: SkillId): string {
  return SKILLS[id]?.name ?? id;
}

function itemName(id: string): string {
  return content.item(id)?.name ?? id;
}

function itemIcon(id: string, label = itemName(id)): string {
  return `![${label}](./assets/items/${id}.png)`;
}

function capture(kind: "npc" | "enemy" | "entity" | "location", id: string, label: string): string {
  const folder = { npc: "npcs", enemy: "enemies", entity: "entities", location: "locations" }[kind];
  return `![${label}](./assets/captures/${folder}/${id}.webp)`;
}

function humanizeId(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function regionName(id: RegionId): string {
  if (id === "gravelmaw") return "Gravelmaw";
  return REGIONS.find((region) => region.id === id)?.name ?? id;
}

interface PlaceRecord {
  location: LocationDef;
  regionId: RegionId;
  regionLabel: string;
  tier: number;
}

function allPlaces(): PlaceRecord[] {
  const places: PlaceRecord[] = [];
  for (const region of REGIONS) {
    for (const location of region.locations) {
      places.push({ location, regionId: region.id, regionLabel: region.name, tier: region.tier });
    }
    for (const location of region.dungeon?.locations ?? []) {
      places.push({
        location,
        regionId: region.dungeon!.id,
        regionLabel: region.dungeon!.name,
        tier: region.dungeon!.tier,
      });
    }
  }
  return places;
}

function placeById(id: string): PlaceRecord | undefined {
  return allPlaces().find(({ location }) => location.id === id);
}

function xpDoc(): string {
  const levels = xpTable();
  const rows = levels
    .map((xp, level) => [level, xp.toLocaleString(), level > 1 ? (xp - levels[level - 1]!).toLocaleString() : "-"])
    .filter((row) => Number(row[0]) >= 1);
  return page("Experience table", "The complete Corealm experience curve.", [
    `Skills run from level 1 to ${MAX_LEVEL}. Level ${MAX_LEVEL} requires **${totalXpAt(MAX_LEVEL).toLocaleString()} XP**.`,
    "",
    `Content tiers unlock at levels ${TIERS.join(", ")}.`,
    "",
    table(["Level", "Total XP", "XP from previous level"], rows),
  ].join("\n"));
}

function skillsDoc(): string {
  const groups: Record<string, string[]> = {};
  for (const skill of Object.values(SKILLS)) {
    (groups[skill.group] ??= []).push(`- **${skill.name}:** ${skill.blurb}`);
  }
  const sections = Object.entries(groups)
    .map(([group, lines]) => `## ${group[0]!.toUpperCase()}${group.slice(1)}\n\n${lines.join("\n")}`)
    .join("\n\n");
  const gatherRows = TIERS.map((tier) => {
    const [low, high] = yieldRange(tier);
    return [tier, gatherXp(tier), `${low}-${high}`, `${respawnSeconds(tier)} s`, `+${toolBonus(tier)}`];
  });
  return page("Skills", "Corealm skills, gathering rules, and combat rules.", [
    sections,
    "",
    "## Gathering",
    "",
    "Mining, Woodcutting, and Fishing attempt an action every **1.8 seconds**. Success starts at 30% at the required level, rises by 1.6 percentage points per extra level, and caps at 95%.",
    "",
    table(["Tier", "XP per yield", "Yields per node", "Respawn", "Tool bonus"], gatherRows),
    "",
    "## Combat",
    "",
    "Attacks resolve on a 600 ms tick. Melee supplies physical defence; Magic supplies magical defence. Health is `20 + 3 × floor((Melee + Magic) / 2)` plus equipment vitality. Magic is 15% more accurate but consumes an essence shard per cast.",
  ].join("\n"));
}

function itemsDoc(): string {
  const rows = [...ALL_ITEMS]
    .sort((a, b) => a.tier - b.tier || a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    .map((item) => {
      const requires = item.equip
        ? Object.entries(item.equip.requires).map(([skill, level]) => `${skillName(skill as SkillId)} ${level}`).join(", ")
        : "";
      const notes = [
        item.equip?.slot,
        item.food ? `Heals ${item.food.healAmount}` : "",
        item.tool ? `${skillName(item.tool.skill)} +${item.tool.gatherBonus}` : "",
        requires,
      ].filter(Boolean).join("; ");
      return [
        `${itemIcon(item.id, item.name)} **${item.name}**`, item.tier, item.category,
        item.stackable ? "Yes" : "No", item.value, sellPrice(item.value), notes || "-",
      ];
    });
  return page("Items", "Every item, price, requirement, and effect in Corealm.", table(
    ["Item", "Tier", "Category", "Stacks", "Buy", "Sell", "Use"],
    rows,
  ));
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
      recipe.station ?? "Anywhere",
      recipe.inputs.map((input) => `${input.quantity}× ${itemName(input.itemId)}`).join(" + "),
      `${recipe.output.quantity}× ${itemName(recipe.output.itemId)}`,
      `${(recipe.durationMs / 1000).toFixed(1)} s`,
      recipe.xp,
    ]);
    return `## ${skillName(skill)}\n\n${table(["Recipe", "Level", "Station", "Ingredients", "Makes", "Time", "XP"], rows)}`;
  });
  return page("Recipes", "Production recipes generated from the live game tables.", sections.join("\n\n"));
}

function enemiesDoc(): string {
  const sections = [...ENEMY_BLOCKS]
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
    .map((enemy) => {
      const dropRows = enemy.drops.map((drop) => [
        `${itemIcon(drop.itemId)} ${itemName(drop.itemId)}`,
        drop.quantity[0] === drop.quantity[1] ? drop.quantity[0] : `${drop.quantity[0]}-${drop.quantity[1]}`,
        `${Math.round(drop.chance * 1000) / 10}%`,
      ]);
      if (enemy.marks) {
        dropRows.unshift(["Marks", enemy.marks[0] === enemy.marks[1] ? enemy.marks[0] : `${enemy.marks[0]}-${enemy.marks[1]}`, "Always"]);
      }
      return [
        `## ${enemy.name}`,
        "",
        capture("enemy", enemy.id, enemy.name),
        "",
        table(["Tier", "Health", "Max hit", "Attack speed", "Armour", "Magic armour", "Behaviour", "Aggro"], [[
          enemy.tier, enemy.maxHealth, enemy.maxHit, `${(enemy.attackSpeedMs / 1000).toFixed(1)} s`,
          enemy.armour, enemy.magicArmour, enemy.behaviour, `${enemy.aggroRadius} m`,
        ]]),
        "",
        "### Drops",
        "",
        table(["Drop", "Quantity", "Chance"], dropRows),
      ].join("\n");
    });
  return page("Bestiary", "Creature portraits, combat stats, and drop tables from Corealm.", [
    "Armour resists melee. Magic armour resists spells.",
    "",
    sections.join("\n\n"),
  ].join("\n"));
}

function resourcesDoc(): string {
  const rows = [...RESOURCE_ARCHETYPES]
    .sort((a, b) => a.tier - b.tier || a.skill.localeCompare(b.skill))
    .map((resource) => {
      const [low, high] = yieldRange(resource.tier);
      return [
        resource.name,
        skillName(resource.skill),
        resource.tier,
        resource.reqLevel,
        `${itemIcon(resource.itemId)} ${itemName(resource.itemId)}`,
        gatherXp(resource.tier),
        `${low}-${high}`,
        `${respawnSeconds(resource.tier)} s`,
      ];
    });
  return page("Resources", "Gathering nodes, requirements, yields, and respawn times.", table(
    ["Node", "Skill", "Tier", "Level", "Yields", "XP each", "Per node", "Respawn"],
    rows,
  ));
}

function regionsDoc(): string {
  const sections = REGIONS.map((region) => {
    const settlement = region.locations.find((location) => location.kind === "settlement") ?? region.locations[0];
    const places = region.locations.map((location) => `- [${location.name}](./locations/#${location.id.replace(/_/g, "-")})`).join("\n");
    const dungeon = region.dungeon
      ? `\n\n### ${region.dungeon.name}\n\n${region.dungeon.locations.map((location) => `- [${location.name}](./locations/#${location.id.replace(/_/g, "-")})`).join("\n")}`
      : "";
    return [
      `## ${region.name}`,
      "",
      settlement ? capture("location", settlement.id, region.name) : "",
      "",
      region.lore,
      "",
      `Tier ${region.tier}. Settlement: **${region.settlement.name}**.`,
      "",
      "### Places",
      "",
      places,
      dungeon,
    ].join("\n");
  });
  return page("Regions", "Corealm's regions and the places within them.", sections.join("\n\n"));
}

function locationsDoc(): string {
  const sections = allPlaces().map(({ location, regionLabel, tier }) => [
    `## ${location.name}`,
    "",
    capture("location", location.id, location.name),
    "",
    location.blurb ?? `${location.name} is a ${location.kind.replace(/_/g, " ")} in ${regionLabel}.`,
    "",
    `**Region:** ${regionLabel} · **Tier:** ${tier} · **Type:** ${location.kind.replace(/_/g, " ")}`,
  ].join("\n"));
  return page("Places", "Named settlements, routes, landmarks, gathering sites, and dungeon rooms.", sections.join("\n\n"));
}

function npcsDoc(): string {
  const sections = NPCS.map((person) => {
    const place = placeById(person.locationId);
    const quests = person.questIds.length
      ? person.questIds.map((id) => `- [${QUESTS.find((quest) => quest.id === id)?.name ?? id}](./quests/#${id.replace(/_/g, "-")})`).join("\n")
      : "_No quest._";
    return [
      `## ${person.name}`,
      "",
      capture("npc", person.id, person.name),
      "",
      person.role,
      "",
      `**Found at:** ${place?.location.name ?? person.locationId}, ${regionName(person.regionId)}`,
      "",
      "### Quests",
      "",
      quests,
    ].join("\n");
  });
  return page("People", "Every named NPC, where to find them, and the quests they give.", sections.join("\n\n"));
}

function grantRows(grant: QuestGrant | undefined): (string | number)[][] {
  if (!grant) return [];
  const rows: (string | number)[][] = [];
  for (const [skill, xp] of Object.entries(grant.xp ?? {})) rows.push([`${skillName(skill as SkillId)} XP`, xp ?? 0]);
  for (const stack of grant.items ?? []) rows.push([itemName(stack.itemId), stack.quantity]);
  if (grant.currency) rows.push(["Marks", grant.currency]);
  for (const unlock of grant.unlocks ?? []) rows.push(["Unlock", unlock]);
  return rows;
}

function questReference(ref: QuestObjectiveRef, regionId: RegionId): string {
  switch (ref.kind) {
    case "item":
      return `${itemIcon(ref.id)}\n\n**${itemName(ref.id)}**`;
    case "location": {
      const place = placeById(ref.id);
      return `${capture("location", ref.id, place?.location.name ?? ref.id)}\n\n**${place?.location.name ?? ref.id}**`;
    }
    case "entity": {
      const person = npc(ref.id);
      return person
        ? `${capture("npc", ref.id, person.name)}\n\n**${person.name}**`
        : `${capture("entity", ref.id, humanizeId(ref.id))}\n\n**${humanizeId(ref.id)}**`;
    }
    case "enemyFamily": {
      const tier = REGIONS.find((region) => region.id === regionId)?.tier ?? 1;
      const choices = ENEMY_BLOCKS.filter((enemy) => enemy.family === ref.id);
      const enemy = choices.sort((a, b) => Math.abs(a.tier - tier) - Math.abs(b.tier - tier))[0];
      return enemy ? `${capture("enemy", enemy.id, enemy.name)}\n\n**${enemy.name}**` : `**${ref.id}**`;
    }
    case "recipe":
      return `**Recipe:** ${RECIPES.find((recipe) => recipe.id === ref.id)?.name ?? ref.id}`;
    case "spell":
      return `**Spell:** ${SPELLS.find((spell) => spell.id === ref.id)?.name ?? ref.id}`;
  }
}

function questsDoc(): string {
  const sections = QUESTS.map((quest) => {
    const giver = npcGivingQuest(quest.id) ?? npc(quest.giverNpcId);
    const requirements = Object.entries(quest.requirements)
      .map(([skill, level]) => `${skillName(skill as SkillId)} ${level}`)
      .join(", ") || "None";
    const prerequisites = quest.prerequisiteQuestIds
      .map((id) => QUESTS.find((candidate) => candidate.id === id)?.name ?? id)
      .join(", ") || "None";
    const stages = quest.stages.map((stage) => {
      const refs = (stage.refs ?? []).map((ref) => questReference(ref, quest.regionId)).join("\n\n");
      const grants = grantRows(stage.grants);
      return [
        `#### ${stage.index + 1}. ${stage.objective}`,
        "",
        stage.hint,
        refs ? `\n${refs}` : "",
        grants.length ? `\n**Stage reward**\n\n${table(["Reward", "Amount"], grants)}` : "",
      ].join("\n");
    }).join("\n\n");
    const rewards = grantRows(quest.rewards);
    return [
      `## ${quest.name}`,
      "",
      giver ? capture("npc", giver.id, giver.name) : "",
      "",
      quest.summary,
      "",
      table(["Giver", "Region", "Requirements", "Prerequisite"], [[
        giver?.name ?? quest.giverNpcId, regionName(quest.regionId), requirements, prerequisites,
      ]]),
      "",
      quest.onStart && grantRows(quest.onStart).length ? `### Supplied when accepted\n\n${table(["Item", "Amount"], grantRows(quest.onStart))}` : "",
      "",
      "### Walkthrough",
      "",
      stages,
      "",
      "### Completion rewards",
      "",
      rewards.length ? table(["Reward", "Amount"], rewards) : "_No additional reward._",
    ].join("\n");
  });
  return page("Quest guides", "Complete Corealm quest walkthroughs generated from the live objectives.", sections.join("\n\n"));
}

function spellsAndShopsDoc(): string {
  const spellRows = SPELLS.map((spell) => [
    spell.name, spell.reqLevel, spell.baseMax, spell.divisor, spell.baseXp,
    `${(spell.castMs / 1000).toFixed(1)} s`, `${spell.cost.quantity}× ${itemName(spell.cost.itemId)}`,
  ]);
  const shopSections = SHOPS.map((shop) => {
    const rows = shop.stock.map((entry) => {
      const item = content.item(entry.itemId);
      return [`${itemIcon(entry.itemId)} ${item?.name ?? entry.itemId}`, entry.quantity, Math.round((item?.value ?? 0) * shop.buyMultiplier)];
    });
    return `### ${shop.name}\n\n${table(["Item", "Stock", "Price"], rows)}`;
  });
  return page("Spells and shops", "Spell costs and shop inventories from the live economy tables.", [
    "## Spells",
    "",
    table(["Spell", "Magic level", "Base max", "Divisor", "XP", "Cast time", "Cost"], spellRows),
    "",
    "## Shops",
    "",
    shopSections.join("\n\n"),
  ].join("\n"));
}

async function main(): Promise<void> {
  const out = path.resolve(repoRoot, argValue(process.argv.slice(2), "--out") ?? "docs/game");
  await mkdir(out, { recursive: true });

  content.register({
    items: ALL_ITEMS, resources: RESOURCES, recipes: RECIPES,
    spells: SPELLS, enemies: ENEMIES, shops: SHOPS,
  });

  const files: [string, string][] = [
    ["quests.md", questsDoc()],
    ["npcs.md", npcsDoc()],
    ["enemies.md", enemiesDoc()],
    ["locations.md", locationsDoc()],
    ["regions.md", regionsDoc()],
    ["items.md", itemsDoc()],
    ["recipes.md", recipesDoc()],
    ["resources.md", resourcesDoc()],
    ["skills.md", skillsDoc()],
    ["experience.md", xpDoc()],
    ["spells-and-shops.md", spellsAndShopsDoc()],
  ];

  const index = page("Game guide", "Generated guides for Corealm's quests, people, creatures, places, and systems.", [
    "These pages are regenerated from the same content tables the game runs.",
    "",
    "- [Quest guides](./quests)",
    "- [People](./npcs)",
    "- [Bestiary](./enemies)",
    "- [Places](./locations)",
    "- [Regions](./regions)",
    "- [Items](./items)",
    "- [Recipes](./recipes)",
    "- [Resources](./resources)",
    "- [Skills](./skills)",
    "- [Experience table](./experience)",
    "- [Spells and shops](./spells-and-shops)",
  ].join("\n"));

  const iconSource = path.resolve(repoRoot, "art/item-icons/256");
  const iconTarget = path.join(out, "assets/items");
  await rm(iconTarget, { recursive: true, force: true });
  await mkdir(path.dirname(iconTarget), { recursive: true });
  await cp(iconSource, iconTarget, { recursive: true });

  await writeFile(path.join(out, "README.md"), index, "utf8");
  for (const [name, body] of files) await writeFile(path.join(out, name), body, "utf8");
  console.log(`Wrote ${files.length + 1} guide files to ${path.relative(repoRoot, out)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
