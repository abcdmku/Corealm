import type { SkillId } from "../contracts.js";
import { SKILL_IDS } from "../contracts.js";

export type SkillGroup = "combat" | "gathering" | "production" | "utility";

export interface SkillDef {
  id: SkillId;
  name: string;
  group: SkillGroup;
  /** UI accent, also used for floating XP numbers. */
  colour: string;
  blurb: string;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  melee: {
    id: "melee", name: "Melee", group: "combat", colour: "#c9553d",
    blurb: "Physical accuracy, damage, and defence. Governs melee weapon and armour requirements.",
  },
  magic: {
    id: "magic", name: "Magic", group: "combat", colour: "#6f7fd6",
    blurb: "Spellcasting power and accuracy, magical defence, and utility magic.",
  },
  mining: {
    id: "mining", name: "Mining", group: "gathering", colour: "#8d8579",
    blurb: "Breaks ore, stone, and gems out of seams and outcrops.",
  },
  woodcutting: {
    id: "woodcutting", name: "Woodcutting", group: "gathering", colour: "#6b8f47",
    blurb: "Fells trees for logs and specialty wood.",
  },
  fishing: {
    id: "fishing", name: "Fishing", group: "gathering", colour: "#4a8fa8",
    blurb: "Takes fish and aquatic materials from shallows, pools, and deep water.",
  },
  smithing: {
    id: "smithing", name: "Smithing", group: "production", colour: "#9a6b3f",
    blurb: "Smelts ore into bars and forges melee equipment, tools, and metal components.",
  },
  crafting: {
    id: "crafting", name: "Crafting", group: "production", colour: "#a0679a",
    blurb: "Works gems, hide, and cloth into accessories, magic equipment, and components.",
  },
  cooking: {
    id: "cooking", name: "Cooking", group: "production", colour: "#c98a3d",
    blurb: "Turns raw ingredients into healing food and stronger meals.",
  },
  fletching: {
    id: "fletching", name: "Fletching", group: "production", colour: "#7d9b6a",
    blurb: "Precision woodworking: shafts, handles, staves, and wooden tool components.",
  },
  agility: {
    id: "agility", name: "Agility", group: "utility", colour: "#4fa08b",
    blurb: "Opens climbs, gaps, and tunnels that shorten routes between banks and resources.",
  },
};

export const COMBAT_SKILLS: readonly SkillId[] = ["melee", "magic"] as const;
export const GATHERING_SKILLS: readonly SkillId[] = ["mining", "woodcutting", "fishing"] as const;
export const PRODUCTION_SKILLS: readonly SkillId[] = ["smithing", "crafting", "cooking", "fletching"] as const;

export function allSkills(): readonly SkillId[] {
  return SKILL_IDS;
}

export function skillsInGroup(group: SkillGroup): SkillId[] {
  return SKILL_IDS.filter((id) => SKILLS[id].group === group);
}
