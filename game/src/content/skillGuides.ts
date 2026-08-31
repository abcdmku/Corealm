/**
 * The concise, level-grouped unlock view used by the Skills panel.
 *
 * Items, resources, recipes and spells come from the registered content tables. Crops and
 * traversal shortcuts live in their own canonical content files, so this module joins them here
 * instead of making the UI carry a second unlock catalog.
 */
import type { ItemDef, ItemId, SkillId } from "../contracts.js";
import { content } from "./index.js";
import type { RecipeDef } from "./index.js";
import { CROPS } from "./resources.js";
import { REGIONS } from "./regions.js";

export type SkillUnlockKind = "resource" | "recipe" | "spell" | "gear" | "shortcut";

export interface SkillUnlock {
  level: number;
  kind: SkillUnlockKind;
  name: string;
  detail?: string;
}

export interface SkillUnlockLevel {
  level: number;
  unlocks: readonly SkillUnlock[];
}

const KIND_ORDER: Readonly<Record<SkillUnlockKind, number>> = {
  resource: 0,
  recipe: 1,
  spell: 2,
  gear: 3,
  shortcut: 4,
};

/** Builds the current unlocks for one skill, grouped and sorted by required level. */
export function skillUnlockLevels(skill: SkillId): SkillUnlockLevel[] {
  const unlocks: SkillUnlock[] = [];
  const add = (unlock: SkillUnlock): void => {
    unlocks.push(unlock);
  };

  addResources(skill, add);
  addRecipes(skill, add);
  addSpells(skill, add);
  addGear(skill, add);
  addShortcuts(skill, add);

  unlocks.sort(compareUnlocks);

  const grouped = new Map<number, SkillUnlock[]>();
  for (const unlock of unlocks) {
    const level = grouped.get(unlock.level);
    if (level) level.push(unlock);
    else grouped.set(unlock.level, [unlock]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([level, levelUnlocks]) => ({ level, unlocks: levelUnlocks }));
}

function addResources(skill: SkillId, add: (unlock: SkillUnlock) => void): void {
  const resources = content.allResources();
  const seen = new Set<string>();

  for (const resource of resources) {
    if (resource.skill !== skill) continue;
    // Keep one guide row per named resource, output, and requirement. This defensive key also
    // prevents a future presentation variant from appearing as a second skill unlock.
    const key = `${resource.reqLevel}|${resource.itemId}|${resource.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bonus = resource.bonus?.map((drop) =>
      `${itemLabel(drop.itemId)} ${Math.round(drop.chance * 100)}%`,
    ).join(", ");
    add({
      level: resource.reqLevel,
      kind: "resource",
      name: resource.name,
      detail: `yields ${itemLabel(resource.itemId)}${bonus ? ` · + ${bonus}` : ""}`,
    });
  }

  if (skill !== "farming") return;

  // Duskberry is present in the crop table but has no Phase 1 plot row. Bittergrain and Cairnleaf
  // already appear above through their active plot resources, so do not show either twice.
  const representedCrops = new Set(
    resources
      .filter((resource) => resource.skill === "farming")
      .map((resource) => `${resource.reqLevel}|${resource.itemId}`),
  );
  for (const crop of CROPS) {
    const key = `${crop.reqLevel}|${crop.cropItemId}`;
    if (representedCrops.has(key)) continue;
    add({
      level: crop.reqLevel,
      kind: "resource",
      name: itemLabel(crop.cropItemId as ItemId),
      detail: "no Phase 1 plot",
    });
  }
}

function addRecipes(skill: SkillId, add: (unlock: SkillUnlock) => void): void {
  const seen = new Set<string>();
  for (const recipe of content.allRecipes()) {
    if (recipe.skill !== skill) continue;
    // Production unlocks are material progressions, not an item encyclopedia. One material name
    // per level keeps Smithing at Grithe / Corven / Kaldite and still exposes the distinct resource
    // families used by Crafting and Fletching without dumping every finished item into the guide.
    const name = productionMaterialName(recipe);
    const key = `${recipe.reqLevel}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add({
      level: recipe.reqLevel,
      kind: "recipe",
      name,
    });
  }
}

function productionMaterialName(recipe: RecipeDef): string {
  if (recipe.skill === "cooking") {
    const input = recipe.inputs[0];
    if (input) return itemLabel(input.itemId);
  }

  // A few legacy recipe titles carry their material in parentheses.
  const parenthetical = recipe.name.match(/\(([^)]+)\)/)?.[1];
  if (parenthetical) return parenthetical;

  const firstWord = recipe.name.trim().split(/\s+/)[0];
  if (firstWord) return firstWord;

  const input = recipe.inputs[0];
  return input ? itemLabel(input.itemId) : itemLabel(recipe.output.itemId);
}

function addSpells(skill: SkillId, add: (unlock: SkillUnlock) => void): void {
  if (skill !== "magic") return;
  // SpellDef intentionally has no skill field because the current spell table is Magic-only.
  for (const spell of content.allSpells()) {
    add({
      level: spell.reqLevel,
      kind: "spell",
      name: spell.name,
      detail: `costs ${spell.cost.charges} ${elementLabel(spell.cost.element)} Essence or weapon charge`,
    });
  }
}

function elementLabel(element: "wind" | "water" | "earth" | "fire"): string {
  if (element === "wind") return "Air";
  return element.charAt(0).toUpperCase() + element.slice(1);
}

function addGear(skill: SkillId, add: (unlock: SkillUnlock) => void): void {
  const byLevel = new Map<number, ItemDef[]>();
  for (const item of content.allItems()) {
    const gear = item.equip;
    if (!gear) continue;
    const level = gear.requires[skill];
    if (typeof level !== "number") continue;
    const items = byLevel.get(level);
    if (items) items.push(item);
    else byLevel.set(level, [item]);
  }

  for (const [level, items] of byLevel) {
    if (skill === "magic") {
      const weapons = items.filter((item) => item.magicWeapon !== undefined);
      if (weapons.length > 0) {
        const wood = weapons[0]?.name.replace(/ (Wand|Staff)$/, "") ?? "Wooden";
        add({
          level,
          kind: "gear",
          name: `${wood} Wand and Staff`,
          detail: "wand 2.2s, one hand; staff 3.0s, two hands",
        });
      }

      const body = items.find((item) => item.equip?.slot === "body");
      if (body) add({ level, kind: "gear", name: body.name.split(/\s+/)[0] ?? "Magic gear" });
      continue;
    }

    const mainHand = items.find((item) => item.equip?.slot === "mainHand");
    const representative = skill === "melee" ? mainHand : items.find((item) =>
      item.equip?.slot === "body") ?? items[0];
    const label = representative?.name.split(/\s+/)[0] ?? "Gear";
    add({
      level,
      kind: "gear",
      name: label,
    });
  }
}

function addShortcuts(skill: SkillId, add: (unlock: SkillUnlock) => void): void {
  if (skill !== "agility") return;
  for (const region of REGIONS) {
    for (const obstacle of region.obstacles) {
      add({
        level: obstacle.reqLevel,
        kind: "shortcut",
        name: obstacle.name,
        detail: shortcutDetail(obstacle.savesMeters, obstacle.oneWay),
      });
    }
    for (const obstacle of region.dungeon?.obstacles ?? []) {
      add({
        level: obstacle.reqLevel,
        kind: "shortcut",
        name: obstacle.name,
        detail: shortcutDetail(obstacle.savesMeters, obstacle.oneWay),
      });
    }
  }
}

function itemLabel(itemId: ItemId): string {
  return content.item(itemId)?.name ?? itemId
    .split("_")
    .map((part) => part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortcutDetail(savesMeters: number, oneWay = false): string {
  return `saves ${savesMeters}m${oneWay ? " · one-way" : ""}`;
}

function compareUnlocks(left: SkillUnlock, right: SkillUnlock): number {
  return left.level - right.level
    || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || compareText(left.name, right.name)
    || compareText(left.detail ?? "", right.detail ?? "");
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
