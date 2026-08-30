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
import sharp from "sharp";
import { argValue, repoRoot } from "./lib/paths.js";

import { content, gatherXp, respawnSeconds, sellPrice, toolBonus, yieldRange } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RESOURCES, RESOURCE_ARCHETYPES } from "../game/src/content/resources.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { SPELLS } from "../game/src/content/spells.js";
import { ENEMIES, ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { SHOPS } from "../game/src/content/shops.js";
import {
  QUESTS,
  type QuestDef,
  type QuestGrant,
  type QuestStageDef,
} from "../game/src/content/quests.js";
import { NPCS, npc, npcGivingQuest } from "../game/src/content/npcs.js";
import {
  REGIONS,
  type EnemyGroupDef,
  type LocationDef,
} from "../game/src/content/regions.js";
import { SKILLS } from "../game/src/content/skills.js";
import { MAX_LEVEL, TIERS, totalXpAt, xpTable } from "../game/src/content/xp.js";
import {
  WORLD_MAP_IMAGE_BOUNDS,
  WORLD_MAP_RENDER_FINGERPRINT,
} from "../game/src/generated/worldMapFingerprint.js";
import type { RegionId, SkillId } from "../game/src/contracts.js";

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

type CaptureKind = "npc" | "enemy" | "enemyGroup" | "entity" | "location";

function captureAsset(kind: CaptureKind, id: string): string {
  const folder = {
    npc: "npcs",
    enemy: "enemies",
    enemyGroup: "enemy-groups",
    entity: "entities",
    location: "locations",
  }[kind];
  return `./assets/captures/${folder}/${id}.webp`;
}

function publicCaptureAsset(kind: CaptureKind, id: string): string {
  return captureAsset(kind, id).replace("./assets/", "/game/assets/");
}

function capture(kind: CaptureKind, id: string, label: string): string {
  return `![${label}](${captureAsset(kind, id)})`;
}

function itemLink(id: string, label = itemName(id)): string {
  return `[${label}](./items/#${headingSlug(label)})`;
}

function humanizeId(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function headingSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

interface MapPoint {
  id: string;
  label: string;
  context: string;
  kind: string;
  position: readonly [number, number];
  href: string;
}

interface AuthoredEntityPoint {
  id: string;
  name: string;
  position: readonly [number, number];
  regionId: RegionId;
}

interface ResolvedEnemyGroup {
  group: EnemyGroupDef;
  regionId: RegionId;
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

function worldMapFigure(
  points: readonly MapPoint[],
  options: { className?: string; ariaLabel: string; caption: string },
): string {
  const bounds = WORLD_MAP_IMAGE_BOUNDS;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  const markers = points.map((point) => {
    const x = ((point.position[0] - bounds.minX) / width) * 100;
    // The 4:3 source is contained inside a square viewport, leaving 12.5% above and below it.
    const y = 12.5 + ((bounds.maxZ - point.position[1]) / height) * 75;
    const label = `${point.label}, ${point.context}`;
    return [
      `<a class="corealm-map-marker" href="${escapeHtml(point.href)}"`,
      ` style="--map-x:${x.toFixed(4)}%;--map-y:${y.toFixed(4)}%"`,
      ` data-map-side="${x > 62 ? "left" : "right"}" data-map-kind="${escapeHtml(point.kind)}" data-map-marker`,
      ` aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">`,
      `<span>${escapeHtml(point.label)}<small>${escapeHtml(point.context)}</small></span></a>`,
    ].join("");
  }).join("\n");

  return [
    `<figure class="corealm-location-map${options.className ? ` ${options.className}` : ""}" data-location-map style="--map-image-ratio:${width / height}">`,
    `<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="${escapeHtml(options.ariaLabel)}">`,
    `<div class="corealm-map-stage" data-map-stage>`,
    `<img src="/game/assets/world-map.webp?v=${WORLD_MAP_RENDER_FINGERPRINT}" alt="Overhead map rendered from the Corealm game world" draggable="false" />`,
    markers,
    `</div>`,
    `<span class="corealm-map-north" aria-hidden="true">N</span>`,
    `<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">`,
    `<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>`,
    `<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>`,
    `<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>`,
    `</div>`,
    `<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>`,
    `</div>`,
    `<figcaption>${escapeHtml(options.caption)}</figcaption>`,
    `</figure>`,
  ].join("\n");
}

function locationMap(): string {
  const points = REGIONS.flatMap((region) => region.locations.map((location): MapPoint => ({
    id: location.id,
    label: location.name,
    context: region.name,
    kind: location.kind,
    position: location.position,
    href: `#${headingSlug(location.name)}`,
  })));
  return worldMapFigure(points, {
    ariaLabel: "Interactive map of Corealm locations",
    caption: "Drag to pan. Scroll or use + and - to zoom. The Gravelmaw rooms lie below its entrance marker.",
  });
}

function placeById(id: string): PlaceRecord | undefined {
  return allPlaces().find(({ location }) => location.id === id);
}

function pointFromRecord(record: Record<string, unknown>): readonly [number, number] | undefined {
  const value = Array.isArray(record.position)
    ? record.position
    : Array.isArray(record.centre)
      ? record.centre
      : undefined;
  if (!value || value.length < 2 || typeof value[0] !== "number" || typeof value[1] !== "number") {
    return undefined;
  }
  return [value[0], value[1]];
}

function findAuthoredRecord(
  value: unknown,
  id: string,
  seen = new Set<object>(),
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findAuthoredRecord(child, id, seen);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.id === id && pointFromRecord(record)) return record;
  for (const child of Object.values(record)) {
    const found = findAuthoredRecord(child, id, seen);
    if (found) return found;
  }
  return undefined;
}

function authoredEntityPoint(id: string): AuthoredEntityPoint | undefined {
  for (const region of REGIONS) {
    const surface = findAuthoredRecord({
      settlement: region.settlement,
      obstacles: region.obstacles,
      landmarks: region.landmarks,
      gates: region.gates,
    }, id);
    const surfacePosition = surface && pointFromRecord(surface);
    if (surface && surfacePosition) {
      return {
        id,
        name: typeof surface.name === "string" ? surface.name : humanizeId(id),
        position: surfacePosition,
        regionId: region.id,
      };
    }
    const dungeon = region.dungeon && findAuthoredRecord(region.dungeon, id);
    const dungeonPosition = dungeon && pointFromRecord(dungeon);
    if (dungeon && dungeonPosition && region.dungeon) {
      return {
        id,
        name: typeof dungeon.name === "string" ? dungeon.name : humanizeId(id),
        position: dungeonPosition,
        regionId: region.dungeon.id,
      };
    }
  }
  return undefined;
}

function stagePlaces(stage: QuestStageDef): PlaceRecord[] {
  const refs = (stage.refs ?? []).filter((ref) => ref.kind === "location");
  if (refs.length === 0) {
    throw new Error(`Quest stage ${stage.index + 1} has no authored location reference.`);
  }
  return refs.map((ref) => {
    const place = placeById(ref.id);
    if (!place) throw new Error(`Quest stage ${stage.index + 1} references unknown location ${ref.id}.`);
    return place;
  });
}

function enemyGroupForStage(
  quest: QuestDef,
  stage: QuestStageDef,
  family: string,
): ResolvedEnemyGroup | undefined {
  const region = REGIONS.find((candidate) => candidate.id === quest.regionId);
  if (!region) return undefined;
  const insideDungeon = stagePlaces(stage).some((place) => place.regionId === "gravelmaw");
  if (insideDungeon && region.dungeon) {
    const group = region.dungeon.enemyGroups.find((candidate) => candidate.family === family);
    if (group) return { group, regionId: region.dungeon.id };
  }
  const group = region.enemyGroups.find((candidate) => candidate.family === family);
  return group ? { group, regionId: region.id } : undefined;
}

function distanceBetween(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function questStepMap(quest: QuestDef, stage: QuestStageDef): string {
  const places = stagePlaces(stage);
  const subjectPoints: MapPoint[] = [];
  for (const ref of stage.refs ?? []) {
    if (ref.kind === "entity") {
      const point = authoredEntityPoint(ref.id);
      if (!point || point.regionId === "gravelmaw") continue;
      const person = npc(ref.id);
      subjectPoints.push({
        id: ref.id,
        label: person?.name ?? point.name,
        context: regionName(point.regionId),
        kind: person ? "npc" : "entity",
        position: point.position,
        href: person
          ? `./npcs/#${headingSlug(person.name)}`
          : `./locations/#${headingSlug(places[0]!.location.name)}`,
      });
    }
    if (ref.kind === "enemyFamily") {
      const resolved = enemyGroupForStage(quest, stage, ref.id);
      if (!resolved || resolved.regionId === "gravelmaw") continue;
      subjectPoints.push({
        id: resolved.group.id,
        label: resolved.group.name,
        context: regionName(resolved.regionId),
        kind: "enemy",
        position: resolved.group.centre,
        href: `./bestiary/#${headingSlug(resolved.group.name)}`,
      });
    }
  }

  const locationPoints: MapPoint[] = places
    .filter((place) => place.regionId !== "gravelmaw")
    .map((place) => ({
      id: place.location.id,
      label: place.location.name,
      context: place.regionLabel,
      kind: place.location.kind,
      position: place.location.position,
      href: `./locations/#${headingSlug(place.location.name)}`,
    }));
  const distantLocations = locationPoints.filter((location) =>
    !subjectPoints.some((subject) => distanceBetween(subject.position, location.position) < 24));
  const points = [...subjectPoints, ...distantLocations];

  const dungeonPlaces = places.filter((place) => place.regionId === "gravelmaw");
  if (dungeonPlaces.length > 0) {
    const entrance = placeById("gravelmaw_entrance");
    if (!entrance) throw new Error("The Gravelmaw entrance is missing from the authored locations.");
    points.push({
      id: "gravelmaw-access",
      label: "The Gravelmaw",
      context: `Entrance to ${dungeonPlaces.map((place) => place.location.name).join(", ")}`,
      kind: "dungeon",
      position: entrance.location.position,
      href: `./locations/#${headingSlug(dungeonPlaces.at(-1)!.location.name)}`,
    });
  }

  const unique = [...new Map(points.map((point) => [`${point.id}:${point.href}`, point])).values()];
  const names = places.map((place) => place.location.name).join(", ");
  const dungeonNote = dungeonPlaces.length > 0 ? " Dungeon rooms are reached through The Gravelmaw entrance." : "";
  return worldMapFigure(unique, {
    className: "corealm-quest-map",
    ariaLabel: `Map for ${quest.name}, step ${stage.index + 1}`,
    caption: `${names}.${dungeonNote}`,
  });
}

interface QuestScene {
  key: string;
  kind: CaptureKind;
  id: string;
  label: string;
}

function questStepScenes(quest: QuestDef, stage: QuestStageDef): QuestScene[] {
  const scenes: QuestScene[] = [];
  for (const ref of stage.refs ?? []) {
    if (ref.kind === "entity") {
      const person = npc(ref.id);
      const point = authoredEntityPoint(ref.id);
      scenes.push({
        key: `entity:${ref.id}`,
        kind: person ? "npc" : "entity",
        id: ref.id,
        label: person?.name ?? point?.name ?? humanizeId(ref.id),
      });
    }
    if (ref.kind === "enemyFamily") {
      const resolved = enemyGroupForStage(quest, stage, ref.id);
      if (!resolved) throw new Error(`No ${ref.id} group resolves for ${quest.id} stage ${stage.index + 1}.`);
      scenes.push({
        key: `enemyGroup:${resolved.group.id}`,
        kind: "enemyGroup",
        id: resolved.group.id,
        label: resolved.group.name,
      });
    }
  }
  if (scenes.length === 0) {
    for (const place of stagePlaces(stage)) {
      scenes.push({
        key: `location:${place.location.id}`,
        kind: "location",
        id: place.location.id,
        label: place.location.name,
      });
    }
  }
  return [...new Map(scenes.map((scene) => [scene.key, scene])).values()];
}

function questStepEvidence(quest: QuestDef, stage: QuestStageDef): string {
  const places = stagePlaces(stage);
  const whereLinks = places.map((place) =>
    `<a href="./locations/#${headingSlug(place.location.name)}">${escapeHtml(place.location.name)}</a>`).join("");
  const itemLinks = (stage.refs ?? [])
    .filter((ref) => ref.kind === "item")
    .map((ref) => `<a href="./items/#${headingSlug(itemName(ref.id))}">${escapeHtml(itemName(ref.id))}</a>`)
    .join("");
  const where = `<nav class="corealm-quest-where" aria-label="Locations for step ${stage.index + 1}"><span>Where</span>${whereLinks}</nav>`;
  const items = itemLinks
    ? `<nav class="corealm-quest-items" aria-label="Items for step ${stage.index + 1}"><span>Items</span>${itemLinks}</nav>`
    : "";
  const placeNames = places.map((place) => place.location.name).join(", ");
  const scenes = questStepScenes(quest, stage).map((scene) => [
    `<figure class="corealm-quest-scene">`,
    `<img src="${publicCaptureAsset(scene.kind, scene.id)}" alt="${escapeHtml(`${scene.label} in the running Corealm world`)}" loading="lazy" />`,
    `<figcaption><strong>${escapeHtml(scene.label)}</strong><span>${escapeHtml(placeNames)}</span></figcaption>`,
    `</figure>`,
  ].join("")).join("\n");
  return [
    where,
    items,
    `<div class="corealm-quest-step-evidence">`,
    `<div class="corealm-quest-scenes">${scenes}</div>`,
    questStepMap(quest, stage),
    `</div>`,
  ].filter(Boolean).join("\n");
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
        `<span id="${headingSlug(item.name)}"></span>${itemIcon(item.id, item.name)} **${item.name}**`,
        item.tier,
        item.category,
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
        itemLink(drop.itemId),
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
        itemLink(resource.itemId),
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
    const places = region.locations.map((location) => `- [${location.name}](./locations/#${headingSlug(location.name)})`).join("\n");
    const dungeon = region.dungeon
      ? `\n\n### ${region.dungeon.name}\n\n${region.dungeon.locations.map((location) => `- [${location.name}](./locations/#${headingSlug(location.name)})`).join("\n")}`
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
  return page("Places", "Named settlements, routes, landmarks, gathering sites, and dungeon rooms.", [
    locationMap(),
    sections.join("\n\n"),
  ].join("\n\n"));
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
      const grants = grantRows(stage.grants);
      return [
        `#### ${stage.index + 1}. ${stage.objective}`,
        "",
        stage.hint,
        "",
        questStepEvidence(quest, stage),
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
      return [itemLink(entry.itemId, item?.name ?? entry.itemId), entry.quantity, Math.round((item?.value ?? 0) * shop.buyMultiplier)];
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
  await sharp(path.resolve(repoRoot, "game/public/generated/world-map.png"))
    .resize({ width: 2400, withoutEnlargement: true })
    .webp({ quality: 88, effort: 6, smartSubsample: true })
    .toFile(path.join(out, "assets/world-map.webp"));

  await writeFile(path.join(out, "README.md"), index, "utf8");
  for (const [name, body] of files) await writeFile(path.join(out, name), body, "utf8");
  console.log(`Wrote ${files.length + 1} guide files to ${path.relative(repoRoot, out)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
