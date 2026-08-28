/**
 * Generated game documentation and its search index.
 *
 * Documentation is a game feature, not a README. Everything here is derived from the same canonical
 * content the runtime uses, so the docs cannot drift from the game: if a recipe changes, its doc
 * entry changes with it.
 *
 * This backs `GameApi.searchDocs` and therefore the agent's `corealm_search_docs` tool. It is
 * strictly *public* knowledge — XP tables, recipes, item stats, region descriptions. Hidden quest
 * state never appears here, because information parity is a design pillar: an agent discovers the
 * world the way a player does.
 *
 * FROZEN. Only the root edits this file.
 */
import type { DocHit, SkillId } from "../contracts.js";
import { SKILLS } from "../content/skills.js";
import { MAX_LEVEL, TIERS, totalXpAt, xpTable } from "../content/xp.js";
import {
  content, gatherXp, healAmount, respawnSeconds, sellPrice, toolBonus, yieldRange,
} from "../content/index.js";
import { REGIONS } from "../content/regions.js";

export interface DocEntry {
  id: string;
  title: string;
  section: string;
  /** Plain text. The search index tokenises this. */
  body: string;
  /** Extra terms that should match this entry without cluttering the body. */
  keywords?: string[];
}

/** Builds the whole documentation set from canonical content. Call after `content.register`. */
export function buildDocs(): DocEntry[] {
  const entries: DocEntry[] = [];

  // ------------------------------------------------------------ progression
  const table = xpTable();
  const checkpoints = TIERS.map((tier) => `level ${tier}: ${totalXpAt(tier).toLocaleString()} XP`).join(", ");
  entries.push({
    id: "xp-curve",
    title: "Experience and levels",
    section: "Progression",
    body:
      `Every skill runs from level 1 to level ${MAX_LEVEL}. Reaching level ${MAX_LEVEL} in one skill `
      + `costs ${totalXpAt(MAX_LEVEL).toLocaleString()} experience in total. The curve is exponential: `
      + `${checkpoints}. Level 92 is roughly the halfway point of the total, so the second half of a `
      + `skill costs about as much as the first 92 levels combined. Content tiers sit at `
      + `${TIERS.join(", ")}.`,
    keywords: ["xp", "experience", "level", "curve", "table", "99"],
  });

  entries.push({
    id: "xp-table",
    title: "Full experience table",
    section: "Progression",
    body: table
      .map((xp, level) => (level === 0 ? "" : `Level ${level}: ${xp.toLocaleString()} total XP`))
      .filter(Boolean)
      .join(". "),
    keywords: ["xp table", "experience table", "how much xp"],
  });

  // ----------------------------------------------------------------- skills
  for (const skill of Object.values(SKILLS)) {
    entries.push({
      id: `skill-${skill.id}`,
      title: skill.name,
      section: "Skills",
      body: `${skill.name} is a ${skill.group} skill. ${skill.blurb}`,
      keywords: [skill.id, skill.group],
    });
  }

  entries.push({
    id: "gathering-rates",
    title: "How gathering works",
    section: "Skills",
    body:
      "Mining, Woodcutting and Fishing share one model. A gather attempt happens every 1.8 seconds. "
      + "At the node's own required level the success chance is exactly 30%, which is one yield every "
      + "6 seconds; the chance rises by 1.6 percentage points per level above the requirement and caps "
      + "at 95%. Experience per yield is round(10 * tier^0.55), so "
      + `${[1, 5, 10].map((tier) => `tier ${tier} gives ${gatherXp(tier)} XP`).join(", ")}. `
      + "A better tool raises your effective level but never lets you gather a node you do not meet "
      + `the base requirement for: ${[1, 5, 10].map((tier) => `a tier ${tier} tool adds +${toolBonus(tier)} effective levels`).join(", ")}. `
      + `Nodes give a limited number of yields before depleting: ${[1, 5, 10].map((tier) => {
        const [low, high] = yieldRange(tier);
        return `tier ${tier} gives ${low} to ${high} and respawns after ${respawnSeconds(tier)} seconds`;
      }).join(", ")}.`,
    keywords: ["mining", "woodcutting", "fishing", "gather", "xp per hour", "respawn", "depleted"],
  });

  entries.push({
    id: "combat-formulas",
    title: "How combat works",
    section: "Combat",
    body:
      "Attacks resolve on a 600 ms combat tick; a weapon's speed decides how many ticks between "
      + "swings. Your chance to hit is attackRoll / (attackRoll + defenceRoll), clamped between 5% "
      + "and 95%, where attackRoll is (attackLevel + 9) scaled by your accuracy bonus and defenceRoll "
      + "is (defenceLevel + 9) scaled by the target's armour. Melee damage rolls between 1 and "
      + "floor(2 + (Melee level + gear power) / 4.2). Magic is 15% more accurate and rolls up to "
      + "floor(spell base + (Magic level + magic power) / spell divisor), but it is slower and each "
      + "cast consumes an essence shard. Magic beats high-armour, low-magic-armour targets; melee "
      + "beats the reverse. You gain 4 experience per point of damage dealt, plus twice the target's "
      + "maximum health when it dies. Health is derived: 20 + 3 * floor((Melee + Magic) / 2) plus any "
      + "vitality from equipment. Out of combat you regain 1 health every 6 seconds.",
    keywords: ["melee", "magic", "damage", "accuracy", "max hit", "health", "hp", "spell"],
  });

  entries.push({
    id: "death",
    title: "Death and recovery",
    section: "Combat",
    body:
      "Dying never costs skill experience or levels. Worn equipment stays equipped. Everything in "
      + "your inventory drops into a recovery cache where you fell, which you can walk back to and "
      + "loot before it expires.",
    keywords: ["death", "die", "recovery", "cache", "lost items"],
  });

  entries.push({
    id: "inventory-banking",
    title: "Inventory and banking",
    section: "Economy",
    body:
      "You carry 28 inventory slots. Currency and a few small components stack; ore, logs, fish and "
      + "equipment each take a whole slot, which is why a gathering trip is limited by pack space "
      + "rather than by time. Banks hold far more and everything stacks there. Because banks are "
      + "fixed places, how far a resource sits from the nearest bank changes its real experience per "
      + "hour — a lower-tier resource beside a bank often beats a higher-tier one far from it.",
    keywords: ["inventory", "28", "bank", "deposit", "withdraw", "slots", "full"],
  });

  entries.push({
    id: "agility-shortcuts",
    title: "Agility and shortcuts",
    section: "Skills",
    body:
      "Agility opens climbs, vaults and tunnels that shorten routes. A shortcut has a required "
      + "Agility level; succeeding moves you to the far side, failing costs 2 to 6 health and leaves "
      + "you where you started. Shortcuts matter because they change which training spot is actually "
      + "the most efficient: a distant high-tier resource can go from worse to better than a nearby "
      + "low-tier one the moment its shortcut opens.",
    keywords: ["agility", "shortcut", "climb", "vault", "route", "efficiency"],
  });

  // ------------------------------------------------------------------ items
  for (const item of content.allItems()) {
    const parts = [`${item.name} is a tier ${item.tier} ${item.category}.`, item.description];
    if (item.equip) {
      const requires = Object.entries(item.equip.requires)
        .map(([skill, level]) => `${SKILLS[skill as SkillId]?.name ?? skill} ${level}`)
        .join(", ");
      parts.push(`Equips to the ${item.equip.slot} slot.`);
      if (requires) parts.push(`Requires ${requires}.`);
      const bonuses = Object.entries(item.equip.bonuses)
        .filter(([, value]) => value !== 0)
        .map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`)
        .join(", ");
      if (bonuses) parts.push(`Bonuses: ${bonuses}.`);
    }
    if (item.food) parts.push(`Eating it restores ${item.food.healAmount} health.`);
    if (item.tool) parts.push(`Used for ${item.tool.skill}, adding ${item.tool.gatherBonus} effective levels.`);
    parts.push(`Worth ${item.value} marks in a shop, sells for about ${sellPrice(item.value)}.`);
    entries.push({
      id: `item-${item.id}`,
      title: item.name,
      section: "Items",
      body: parts.join(" "),
      keywords: [item.id, item.category, `tier ${item.tier}`],
    });
  }

  // ---------------------------------------------------------------- recipes
  for (const recipe of content.allRecipes()) {
    const inputs = recipe.inputs
      .map((input) => `${input.quantity}x ${content.item(input.itemId)?.name ?? input.itemId}`)
      .join(" and ");
    const output = content.item(recipe.output.itemId)?.name ?? recipe.output.itemId;
    entries.push({
      id: `recipe-${recipe.id}`,
      title: `${recipe.name} (recipe)`,
      section: "Recipes",
      body:
        `Making ${output} needs ${SKILLS[recipe.skill]?.name ?? recipe.skill} level ${recipe.reqLevel}`
        + `${recipe.station ? ` at a ${recipe.station.replace(/_/g, " ")}` : ""}. `
        + `It consumes ${inputs}, produces ${recipe.output.quantity}x ${output}, takes `
        + `${(recipe.durationMs / 1000).toFixed(1)} seconds, and gives ${recipe.xp} experience.`,
      keywords: [recipe.id, recipe.kind, recipe.skill, output.toLowerCase()],
    });
  }

  // ---------------------------------------------------------------- enemies
  for (const enemy of content.allEnemies()) {
    entries.push({
      id: `enemy-${enemy.id}`,
      title: enemy.name,
      section: "Enemies",
      body:
        `${enemy.name} is a tier ${enemy.tier} ${enemy.family} with ${enemy.maxHealth} health. `
        + `It hits for up to ${enemy.maxHit}, attacks every ${(enemy.attackSpeedMs / 1000).toFixed(1)} `
        + `seconds, and has ${enemy.armour} armour and ${enemy.magicArmour} magic armour. `
        + `It is ${enemy.behaviour}${enemy.behaviour === "aggressive" ? ` and attacks on sight within ${enemy.aggroRadius} metres` : ""}.`,
      keywords: [enemy.id, enemy.family, `tier ${enemy.tier}`],
    });
  }

  // ---------------------------------------------------------------- spells
  for (const spell of content.allSpells()) {
    entries.push({
      id: `spell-${spell.id}`,
      title: spell.name,
      section: "Combat",
      body:
        `${spell.name} needs Magic ${spell.reqLevel}. ${spell.description} `
        + `Maximum damage is ${spell.baseMax} plus (Magic level + magic power) / ${spell.divisor}. `
        + `Each cast takes ${(spell.castMs / 1000).toFixed(1)} seconds, gives ${spell.baseXp} Magic `
        + `experience hit or miss, and consumes ${spell.cost.quantity}x `
        + `${content.item(spell.cost.itemId)?.name ?? spell.cost.itemId}.`,
      keywords: [spell.id, "spell", "magic"],
    });
  }

  // --------------------------------------------------------------- regions
  for (const region of REGIONS) {
    const resources = region.clusters
      .map((cluster) => `${cluster.name} (tier ${cluster.tier} ${cluster.skill})`)
      .join(", ");
    entries.push({
      id: `region-${region.id}`,
      title: region.name,
      section: "Regions",
      body:
        `${region.name}. ${region.lore ?? ""} `
        + `${region.settlement ? `Its settlement is ${region.settlement.name}. ` : ""}`
        + `${resources ? `Resources here: ${resources}.` : ""}`,
      keywords: [region.id, "region", "area", "where"],
    });
  }

  return entries;
}

// ------------------------------------------------------------ search index

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "is", "it", "for", "on", "at", "by", "with",
  "how", "do", "i", "what", "where", "does", "can", "you", "my",
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * A small inverted index with TF-IDF-ish scoring. Deliberately not a dependency: the corpus is a
 * few hundred short entries generated from local content, and a real search library would be more
 * bytes than the corpus it searches.
 */
export class DocSearch {
  private entries: DocEntry[] = [];
  private postings = new Map<string, Map<number, number>>();
  private documentFrequency = new Map<string, number>();

  build(entries: DocEntry[]): void {
    this.entries = entries;
    this.postings.clear();
    this.documentFrequency.clear();

    for (const [index, entry] of entries.entries()) {
      const tokens = [
        ...tokenise(entry.title),
        ...tokenise(entry.title), // title matches count double
        ...tokenise(entry.section),
        ...tokenise(entry.body),
        ...(entry.keywords ?? []).flatMap(tokenise),
        ...(entry.keywords ?? []).flatMap(tokenise), // keywords count double too
      ];
      const seen = new Set<string>();
      for (const token of tokens) {
        let posting = this.postings.get(token);
        if (!posting) {
          posting = new Map();
          this.postings.set(token, posting);
        }
        posting.set(index, (posting.get(index) ?? 0) + 1);
        seen.add(token);
      }
      for (const token of seen) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
    }
  }

  search(query: string, limit = 5): DocHit[] {
    if (this.entries.length === 0) return [];
    const tokens = tokenise(query);
    if (tokens.length === 0) return [];

    const scores = new Map<number, number>();
    const total = this.entries.length;

    for (const token of tokens) {
      // Prefix matching, so "mine" finds "mining" and "recip" finds "recipe".
      for (const [indexed, posting] of this.postings) {
        if (indexed !== token && !indexed.startsWith(token) && !token.startsWith(indexed)) continue;
        const exact = indexed === token ? 1 : 0.55;
        const idf = Math.log(1 + total / (this.documentFrequency.get(indexed) ?? 1));
        for (const [docIndex, count] of posting) {
          scores.set(docIndex, (scores.get(docIndex) ?? 0) + count * idf * exact);
        }
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(1, Math.min(limit, 25)))
      .map(([index, score]) => {
        const entry = this.entries[index]!;
        return {
          docId: entry.id,
          title: entry.title,
          section: entry.section,
          snippet: snippetFor(entry.body, tokens),
          score: Math.round(score * 100) / 100,
        };
      });
  }

  size(): number {
    return this.entries.length;
  }

  entry(docId: string): DocEntry | undefined {
    return this.entries.find((candidate) => candidate.id === docId);
  }

  all(): readonly DocEntry[] {
    return this.entries;
  }
}

/** A window of the body around the first query hit, so an agent gets the relevant sentence. */
function snippetFor(body: string, tokens: string[]): string {
  const lower = body.toLowerCase();
  let best = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found >= 0 && (best < 0 || found < best)) best = found;
  }
  if (best < 0) return body.slice(0, 220);
  const start = Math.max(0, best - 70);
  const end = Math.min(body.length, start + 260);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
}
