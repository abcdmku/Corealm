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

import {
  content,
  gatherXp,
  respawnSeconds,
  sellPrice,
  toolBonus,
  yieldRange,
  type EnemyDef,
} from "../game/src/content/index.js";
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

function captureAsset(kind: CaptureKind, id: string, base = "./"): string {
  const folder = {
    npc: "npcs",
    enemy: "enemies",
    enemyGroup: "enemy-groups",
    entity: "entities",
    location: "locations",
  }[kind];
  return `${base}assets/captures/${folder}/${id}.webp`;
}

function publicCaptureAsset(kind: CaptureKind, id: string, base: string): string {
  return captureAsset(kind, id, base);
}

function capture(kind: CaptureKind, id: string, label: string, base = "./"): string {
  return `![${label}](${captureAsset(kind, id, base)})`;
}

function itemLink(id: string, label = itemName(id), base = "./"): string {
  return `[${label}](${base}items/#${headingSlug(label)})`;
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

interface CreatureSpawn {
  group: EnemyGroupDef;
  regionId: RegionId;
  regionLabel: string;
  place: PlaceRecord;
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
  options: { className?: string; ariaLabel: string; caption: string; assetBase: string },
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
    `<img src="${options.assetBase}world-map.webp?v=${WORLD_MAP_RENDER_FINGERPRINT}" alt="Overhead map rendered from the Corealm game world" draggable="false" />`,
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
    assetBase: "../assets/",
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

function nearestPlace(regionId: RegionId, position: readonly [number, number]): PlaceRecord {
  const places = allPlaces().filter((place) => place.regionId === regionId);
  const nearest = [...places].sort((a, b) =>
    distanceBetween(a.location.position, position) - distanceBetween(b.location.position, position))[0];
  if (!nearest) throw new Error(`No authored place exists in ${regionId}.`);
  return nearest;
}

function creatureForGroup(group: EnemyGroupDef): EnemyDef {
  const creature = ENEMY_BLOCKS.find((candidate) =>
    candidate.family === group.family && candidate.tier === group.tier);
  if (!creature) throw new Error(`No creature stat block resolves for enemy group ${group.id}.`);
  return creature;
}

function creatureSpawns(creature: EnemyDef): CreatureSpawn[] {
  const spawns: CreatureSpawn[] = [];
  for (const region of REGIONS) {
    for (const group of region.enemyGroups) {
      if (group.family !== creature.family || group.tier !== creature.tier) continue;
      spawns.push({
        group,
        regionId: region.id,
        regionLabel: region.name,
        place: nearestPlace(region.id, group.centre),
      });
    }
    for (const group of region.dungeon?.enemyGroups ?? []) {
      if (group.family !== creature.family || group.tier !== creature.tier || !region.dungeon) continue;
      spawns.push({
        group,
        regionId: region.dungeon.id,
        regionLabel: region.dungeon.name,
        place: nearestPlace(region.dungeon.id, group.centre),
      });
    }
  }
  if (spawns.length === 0) throw new Error(`No authored spawn group resolves for creature ${creature.id}.`);
  return spawns;
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
          ? `../../npcs/#${headingSlug(person.name)}`
          : `../../regions/#${headingSlug(places[0]!.location.name)}`,
      });
    }
    if (ref.kind === "enemyFamily") {
      const resolved = enemyGroupForStage(quest, stage, ref.id);
      if (!resolved || resolved.regionId === "gravelmaw") continue;
      const creature = creatureForGroup(resolved.group);
      subjectPoints.push({
        id: resolved.group.id,
        label: resolved.group.name,
        context: regionName(resolved.regionId),
        kind: "enemy",
        position: resolved.group.centre,
        href: `../../creatures/${creature.id}/`,
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
      href: `../../regions/#${headingSlug(place.location.name)}`,
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
      href: `../../regions/#${headingSlug(dungeonPlaces.at(-1)!.location.name)}`,
    });
  }

  const unique = [...new Map(points.map((point) => [`${point.id}:${point.href}`, point])).values()];
  const names = places.map((place) => place.location.name).join(", ");
  const dungeonNote = dungeonPlaces.length > 0 ? " Dungeon rooms are reached through The Gravelmaw entrance." : "";
  return worldMapFigure(unique, {
    className: "corealm-quest-map",
    ariaLabel: `Map for ${quest.name}, step ${stage.index + 1}`,
    caption: `${names}.${dungeonNote}`,
    assetBase: "../../assets/",
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
    `<a href="../../regions/#${headingSlug(place.location.name)}">${escapeHtml(place.location.name)}</a>`).join("");
  const itemLinks = (stage.refs ?? [])
    .filter((ref) => ref.kind === "item")
    .map((ref) => `<a href="../../items/#${headingSlug(itemName(ref.id))}">${escapeHtml(itemName(ref.id))}</a>`)
    .join("");
  const where = `<nav class="corealm-quest-where" aria-label="Locations for step ${stage.index + 1}"><span>Where</span>${whereLinks}</nav>`;
  const items = itemLinks
    ? `<nav class="corealm-quest-items" aria-label="Items for step ${stage.index + 1}"><span>Items</span>${itemLinks}</nav>`
    : "";
  const placeNames = places.map((place) => place.location.name).join(", ");
  const scenes = questStepScenes(quest, stage).map((scene) => [
    `<figure class="corealm-quest-scene">`,
    `<img src="${publicCaptureAsset(scene.kind, scene.id, "../../")}" alt="${escapeHtml(`${scene.label} in the running Corealm world`)}" loading="lazy" />`,
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

function creatureSpawnMap(creature: EnemyDef, spawns: readonly CreatureSpawn[]): string {
  const entrance = placeById("gravelmaw_entrance");
  const points = spawns.map((spawn): MapPoint => {
    const insideDungeon = spawn.regionId === "gravelmaw";
    if (insideDungeon && !entrance) throw new Error("The Gravelmaw entrance is missing from the authored locations.");
    return {
      id: spawn.group.id,
      label: spawn.group.name,
      context: insideDungeon
        ? `${spawn.regionLabel}, ${spawn.place.location.name}`
        : `${spawn.place.location.name}, ${spawn.regionLabel}`,
      kind: insideDungeon ? "dungeon" : "enemy",
      position: insideDungeon ? entrance!.location.position : spawn.group.centre,
      href: `../../regions/#${headingSlug(spawn.place.location.name)}`,
    };
  });
  const hasDungeonSpawn = spawns.some((spawn) => spawn.regionId === "gravelmaw");
  return worldMapFigure(points, {
    className: "corealm-creature-map",
    ariaLabel: `Spawn map for ${creature.name}`,
    caption: hasDungeonSpawn
      ? "Outdoor markers use the exact spawn centre. Gravelmaw markers use the dungeon entrance; the room is listed beside each capture."
      : "Markers use each authored spawn group's exact centre.",
    assetBase: "../../assets/",
  });
}

function creatureIndexDoc(): string {
  const rows = [...ENEMY_BLOCKS]
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
    .map((creature) => {
      const spawns = creatureSpawns(creature);
      const regions = [...new Map(spawns.map((spawn) => [spawn.regionId, spawn.regionLabel])).values()].join(", ");
      return [`[${creature.name}](./${creature.id}/)`, creature.tier, regions];
    });
  return page("Creatures", "Every creature in Corealm, with a separate spawn, stats, and drops page.", table(
    ["Creature", "Tier", "Regions"],
    rows,
  ));
}

function creatureDoc(creature: EnemyDef): string {
  const spawns = creatureSpawns(creature);
  const spawnRows = spawns.map((spawn) => [
    `[${spawn.regionLabel}](../../regions/#${headingSlug(spawn.place.location.name)})`,
    `[${spawn.place.location.name}](../../regions/#${headingSlug(spawn.place.location.name)})`,
    spawn.group.name,
    spawn.group.count,
  ]);
  const scenes = spawns.map((spawn) => [
    `<figure class="corealm-quest-scene">`,
    `<img src="${publicCaptureAsset("enemyGroup", spawn.group.id, "../../")}" alt="${escapeHtml(`${spawn.group.name} at its authored spawn in ${spawn.regionLabel}`)}" loading="lazy" />`,
    `<figcaption><strong>${escapeHtml(spawn.group.name)}</strong><span>${escapeHtml(`${spawn.place.location.name}, ${spawn.regionLabel}`)}</span></figcaption>`,
    `</figure>`,
  ].join("")).join("\n");
  const dropRows: (string | number)[][] = creature.drops.map((drop) => [
    itemLink(drop.itemId, itemName(drop.itemId), "../../"),
    drop.quantity[0] === drop.quantity[1] ? drop.quantity[0] : `${drop.quantity[0]}-${drop.quantity[1]}`,
    `${Math.round(drop.chance * 1000) / 10}%`,
  ]);
  if (creature.marks) {
    dropRows.unshift([
      "Marks",
      creature.marks[0] === creature.marks[1] ? creature.marks[0] : `${creature.marks[0]}-${creature.marks[1]}`,
      "Always",
    ]);
  }
  return page(creature.name, `${creature.name} spawn locations, combat stats, and drops.`, [
    `<div class="corealm-creature-spawn-evidence">`,
    `<div class="corealm-quest-scenes">${scenes}</div>`,
    creatureSpawnMap(creature, spawns),
    `</div>`,
    "",
    "## Spawn locations",
    "",
    table(["Region", "Nearest place", "Spawn group", "Count"], spawnRows),
    "",
    "## Stats",
    "",
    table(["Tier", "Health", "Attack", "Defence", "Accuracy", "Max hit", "Attack speed", "Armour", "Magic armour", "Behaviour", "Aggro"], [[
      creature.tier,
      creature.maxHealth,
      creature.attackLevel,
      creature.defenceLevel,
      creature.accuracy,
      creature.maxHit,
      `${(creature.attackSpeedMs / 1000).toFixed(1)} s`,
      creature.armour,
      creature.magicArmour,
      creature.behaviour,
      `${creature.aggroRadius} m`,
    ]]),
    "",
    "## Drops",
    "",
    table(["Drop", "Quantity", "Chance"], dropRows),
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
    const places = region.locations.map((location) => [
      `### ${location.name}`,
      "",
      capture("location", location.id, location.name),
      "",
      location.blurb ?? `${location.name} is a ${location.kind.replace(/_/g, " ")} in ${region.name}.`,
      "",
      `**Tier:** ${region.tier} · **Type:** ${location.kind.replace(/_/g, " ")}`,
    ].join("\n")).join("\n\n");
    const dungeon = region.dungeon
      ? [
          `## ${region.dungeon.name}`,
          "",
          `Tier ${region.dungeon.tier}. Enter through [The Gravelmaw](#the-gravelmaw).`,
          "",
          region.dungeon.locations.map((location) => [
            `### ${location.name}`,
            "",
            capture("location", location.id, location.name),
            "",
            location.blurb ?? `${location.name} is a ${location.kind.replace(/_/g, " ")} in ${region.dungeon!.name}.`,
            "",
            `**Tier:** ${region.dungeon!.tier} · **Type:** ${location.kind.replace(/_/g, " ")}`,
          ].join("\n")).join("\n\n"),
        ].join("\n")
      : "";
    return [
      `## ${region.name}`,
      "",
      region.lore,
      "",
      `Tier ${region.tier}. Settlement: **${region.settlement.name}**.`,
      "",
      places,
      dungeon,
    ].join("\n");
  });
  return page("Regions", "Corealm's regions, settlements, routes, landmarks, gathering sites, and dungeon rooms.", [
    locationMap(),
    sections.join("\n\n"),
  ].join("\n\n"));
}

function npcsDoc(): string {
  const sections = NPCS.map((person) => {
    const place = placeById(person.locationId);
    const quests = person.questIds.length
      ? person.questIds.map((id) => `- [${QUESTS.find((quest) => quest.id === id)?.name ?? id}](../quests/${id}/)`).join("\n")
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

function grantRows(grant: QuestGrant | undefined, itemBase = "./"): (string | number)[][] {
  if (!grant) return [];
  const rows: (string | number)[][] = [];
  for (const [skill, xp] of Object.entries(grant.xp ?? {})) rows.push([`${skillName(skill as SkillId)} XP`, xp ?? 0]);
  for (const stack of grant.items ?? []) rows.push([itemLink(stack.itemId, itemName(stack.itemId), itemBase), stack.quantity]);
  if (grant.currency) rows.push(["Marks", grant.currency]);
  for (const unlock of grant.unlocks ?? []) rows.push(["Unlock", unlock]);
  return rows;
}

function rewardSummary(grant: QuestGrant, itemBase: string): string {
  const parts: string[] = [];
  for (const [skill, xp] of Object.entries(grant.xp ?? {})) {
    if (xp) parts.push(`${xp.toLocaleString()} ${skillName(skill as SkillId)} XP`);
  }
  for (const stack of grant.items ?? []) {
    parts.push(`${stack.quantity}× ${itemLink(stack.itemId, itemName(stack.itemId), itemBase)}`);
  }
  if (grant.currency) parts.push(`${grant.currency.toLocaleString()} Marks`);
  for (const unlock of grant.unlocks ?? []) parts.push(unlock);
  return parts.join("; ") || "None";
}

function questStartPlace(quest: QuestDef): PlaceRecord {
  const giver = npcGivingQuest(quest.id) ?? npc(quest.giverNpcId);
  const place = giver && placeById(giver.locationId);
  if (!place) throw new Error(`Quest ${quest.id} has no authored start location.`);
  return place;
}

function questIndexDoc(): string {
  const rows = QUESTS.map((quest) => {
    const start = questStartPlace(quest);
    return [
      `[${quest.name}](./${quest.id}/)`,
      `[${start.location.name}](../regions/#${headingSlug(start.location.name)})`,
      rewardSummary(quest.rewards, "../"),
    ];
  });
  return page("Quests", "Every Corealm quest, its start location, and its completion reward.", table(
    ["Quest", "Start location", "Reward"],
    rows,
  ));
}

function questDoc(quest: QuestDef): string {
  const giver = npcGivingQuest(quest.id) ?? npc(quest.giverNpcId);
  const start = questStartPlace(quest);
  const requirements = Object.entries(quest.requirements)
    .map(([skill, level]) => `${skillName(skill as SkillId)} ${level}`)
    .join(", ") || "None";
  const prerequisites = quest.prerequisiteQuestIds
    .map((id) => {
      const prerequisite = QUESTS.find((candidate) => candidate.id === id);
      return `[${prerequisite?.name ?? id}](../${id}/)`;
    })
    .join(", ") || "None";
  const stages = quest.stages.map((stage) => {
    const grants = grantRows(stage.grants, "../../");
    return [
      `### ${stage.index + 1}. ${stage.objective}`,
      "",
      stage.hint,
      "",
      questStepEvidence(quest, stage),
      grants.length ? `\n#### Stage reward\n\n${table(["Reward", "Amount"], grants)}` : "",
    ].join("\n");
  }).join("\n\n");
  const rewards = grantRows(quest.rewards, "../../");
  const supplied = grantRows(quest.onStart, "../../");
  return page(quest.name, `${quest.name} start location, requirements, walkthrough, and rewards.`, [
    quest.summary,
    "",
    giver ? capture("npc", giver.id, giver.name, "../") : "",
    "",
    table(["Giver", "Start location", "Region", "Requirements", "Prerequisite"], [[
      giver ? `[${giver.name}](../../npcs/#${headingSlug(giver.name)})` : quest.giverNpcId,
      `[${start.location.name}](../../regions/#${headingSlug(start.location.name)})`,
      `[${regionName(quest.regionId)}](../../regions/#${headingSlug(regionName(quest.regionId))})`,
      requirements,
      prerequisites,
    ]]),
    "",
    supplied.length ? `## Supplied when accepted\n\n${table(["Item", "Amount"], supplied)}` : "",
    "",
    "## Walkthrough",
    "",
    stages,
    "",
    "## Completion rewards",
    "",
    rewards.length ? table(["Reward", "Amount"], rewards) : "_No additional reward._",
  ].join("\n"));
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

  for (const stale of ["quests.md", "enemies.md", "locations.md", "quests", "creatures"]) {
    await rm(path.join(out, stale), { recursive: true, force: true });
  }

  const files: [string, string][] = [
    ["quests/index.md", questIndexDoc()],
    ...QUESTS.map((quest): [string, string] => [`quests/${quest.id}.md`, questDoc(quest)]),
    ["npcs.md", npcsDoc()],
    ["creatures/index.md", creatureIndexDoc()],
    ...ENEMY_BLOCKS.map((creature): [string, string] => [`creatures/${creature.id}.md`, creatureDoc(creature)]),
    ["regions.md", regionsDoc()],
    ["items.md", itemsDoc()],
    ["recipes.md", recipesDoc()],
    ["resources.md", resourcesDoc()],
    ["skills.md", skillsDoc()],
    ["experience.md", xpDoc()],
    ["spells-and-shops.md", spellsAndShopsDoc()],
  ];

  const index = page("Game guide", "Generated guides for Corealm's quests, people, creatures, regions, and systems.", [
    "These pages are regenerated from the same content tables the game runs.",
    "",
    "- [Quests](./quests)",
    "- [People](./npcs)",
    "- [Creatures](./creatures)",
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
  for (const [name, body] of files) {
    const target = path.join(out, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, "utf8");
  }
  console.log(`Wrote ${files.length + 1} guide files to ${path.relative(repoRoot, out)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
