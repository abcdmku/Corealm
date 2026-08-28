/**
 * Enemy stat blocks for the four families the world already places, plus Ordrun.
 *
 * Owned by W-CONTENT.
 *
 * LOOKUP. `world/regionBuilder.ts` stamps each spawned entity with `meta.family`, `meta.groupId`
 * and `tier`, and nothing else. So every stat block is published twice: once under
 * `<family>_t<tier>` (use `enemyIdFor`) and once under each `content/regions.ts` group id, so
 * `content.enemy(entity.meta.groupId)` resolves directly. Ordrun's group has count 1, which means
 * its entity id IS `ordrun`, so `content.enemy("ordrun")` works too. The provisional level and
 * maxHealth in regions.ts are superseded by this table, exactly as its comment says.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ARITHMETIC. Every defender stat below is SOLVED from PRD 2.4's time-to-kill table, not
 * chosen. Formulas: attackRoll = (attackLevel + 9) * (1 + accuracy/100) * styleFactor,
 * defenceRoll = (defenceLevel + 9) * (1 + armour/100), hitChance = attackRoll/(attackRoll+defenceRoll),
 * damage/s = hitChance * (1 + maxHit)/2 / attackSpeedSeconds.
 *
 *  PRD row                                                | solved from            | result
 *  ------------------------------------------------------ | ---------------------- | ------------
 *  Melee 1 unarmed vs Rill Skitterling, 50%, maxHit 2, 19s | defL 1, armour 0       | 10/(10+10)=50%
 *                                                          |                        | 6/0.3125 = 19.2 s
 *  Melee 3 Grithe dagger vs Rill, 56%, maxHit 4, 10s       | same block             | 12.72/22.72=56%
 *                                                          |                        | 6/0.5831 = 10.3 s
 *  Melee 7 Corven sword vs Thornbound Husk, 51%, 7, 30s    | defL 7, armour 10      | 18.24/35.84=50.9%
 *                                                          |                        | 26/0.8482 = 30.7 s
 *  Melee 12 Kaldite sword vs Scree Skitterling, 51%, 11,27s| defL 11, armour 30     | 26.88/52.88=50.8%
 *                                                          |                        | 34/1.2708 = 26.8 s
 *  Melee 12 Kaldite sword vs Cairnwight, 46%, 11, 33s      | defL 11, armour 55     | 26.88/57.88=46.4%
 *                                                          |                        | 38/1.1610 = 32.7 s
 *  Melee 18 tier 10 kit vs Ordrun, 45%, 12, 165s           | defL 20, armour 62     | 38.34/85.32=44.9%
 *                                                          |                        | 200/1.2170 = 164.3 s
 *  "Ordrun deals about 1.02 damage/s through tier 10 armour"| atkL 24, acc 15,      | 37.95/80.61=47.1%
 *                                                          | maxHit 12, 3.0 s       | = 1.020 dmg/s
 *                                                          |                        | 164 s -> 167 damage
 *
 * MAGIC VS MELEE, the gate criterion in PRD 2.4. Voltrend at Magic 10 in the full tier 10 magic kit
 * (magicPower 32 -> maxHit 15, magicAccuracy 47 -> attackRoll 32.12, styleFactor 1.15):
 *   vs Cairnwight  (magicArmour  10): defenceRoll 22.0 -> 59.3% -> 1.583 dmg/s -> 38/1.583 = 24.0 s
 *                                     melee at Melee 12 takes 32.7 s.  MAGIC WINS by 27%.  MATCHES PRD.
 *   vs Scree Skitt.(magicArmour 115): defenceRoll 43.0 -> 42.8% -> 1.140 dmg/s -> 34/1.140 = 29.8 s
 *                                     melee at Melee 12 takes 26.8 s.  MELEE WINS by 10%.
 *
 * DEVIATION, flagged rather than hidden: PRD 2.4 quotes the Scree Skitterling at magicArmour +40.
 * That number cannot produce "melee wins" alongside the 24 s Cairnwight claim. Hit chance is
 * saturating, so with a magic attack roll R the best possible TTK ratio between the two targets is
 * (R + 20*1.40)/(R + 20*1.10), and even as R -> 0 that caps at 1.27, while the PRD needs at least
 * 1.257 AFTER the 34/38 health ratio is applied - which needs R below 1.4, and R is 32.1. The two
 * claims are only simultaneously satisfiable if the Scree's magic resistance is far higher, so it
 * is set to 115. Its armour stays at the PRD's +30. This keeps both halves of the balance gate
 * true and makes the "stone-shelled thing shrugs off lightning" read explicit.
 * ---------------------------------------------------------------------------------------------
 */
import type { EnemyDef } from "./index.js";

/** PRD 2.4: enemies leash at 28 m from their spawn point, at every tier. */
export const LEASH_RADIUS_M = 28;

/** PRD 2.10: enemy mark drops are randomInt(round(tier * 3), round(tier * 11)). */
function marksFor(tier: number): [number, number] {
  return [Math.round(tier * 3), Math.round(tier * 11)];
}

/** The canonical id for a family at a tier. `meta.family` + `tier` is all the entity carries. */
export function enemyIdFor(family: string, tier: number): string {
  return `${family}_t${tier}`;
}

const BLOCKS: readonly EnemyDef[] = [
  // ---------------------------------------------------------------- Fallowmarch, tier 1
  {
    id: "skitterling_t1", name: "Rill Skitterling", family: "skitterling", tier: 1,
    // 6 HP and the unarmed 50% row together fix defenceLevel 1 / armour 0. PRD 2.4 also uses this
    // block for its XP maths: 6*4 + round(6*2) = 36 XP a kill, 48 kills to Melee 10.
    maxHealth: 6, attackLevel: 2, defenceLevel: 1,
    accuracy: 0, armour: 0, magicArmour: 0,
    maxHit: 2, attackSpeedMs: 2400, aggroRadius: 6, behaviour: "passive",
    marks: marksFor(1),
    drops: [
      { itemId: "march_stone", quantity: [1, 2], chance: 0.35 },
      { itemId: "coarse_hide", quantity: [1, 1], chance: 0.20 },
      { itemId: "pale_quartz", quantity: [1, 1], chance: 0.06 },
    ],
  },
  {
    id: "marchwolf_t1", name: "Marchwolf Pup", family: "marchwolf", tier: 1,
    // The aggressive tier 1 spawn. Against a naked Melee 1 player (23 max health, PRD 2.3) the
    // fight runs 43 s and the pup lands 0.479 dmg/s, so it costs about 21 health: survivable, and
    // obviously not free. With a Grithe dagger it is 31 s and 15 damage; in the full tier 1 kit
    // (29 max health, armour 16) it is 25 s and 11 damage.
    maxHealth: 12, attackLevel: 4, defenceLevel: 3,
    accuracy: 4, armour: 4, magicArmour: 2,
    maxHit: 3, attackSpeedMs: 2400, aggroRadius: 8, behaviour: "aggressive",
    marks: marksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.60 },
      { itemId: "grithe_ore", quantity: [1, 2], chance: 0.20 },
      { itemId: "grithe_dagger", quantity: [1, 1], chance: 0.02 },
    ],
  },

  // ---------------------------------------------------------------- Vellenwood, tier 5
  {
    id: "thornbound_t5", name: "Thornbound Husk", family: "thornbound", tier: 5,
    // 26 HP, defL 7, armour 10 -> 51% and 30 s against a Melee 7 Corven sword. Both PRD numbers.
    // High magicArmour: a Thornbound is the target you do NOT bring a staff to.
    maxHealth: 26, attackLevel: 12, defenceLevel: 7,
    accuracy: 12, armour: 10, magicArmour: 45,
    maxHit: 5, attackSpeedMs: 2400, aggroRadius: 9, behaviour: "territorial",
    marks: marksFor(5),
    drops: [
      { itemId: "duskoak_log", quantity: [1, 3], chance: 0.40 },
      { itemId: "bramble_hide", quantity: [1, 1], chance: 0.35 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.08 },
      { itemId: "corven_helm", quantity: [1, 1], chance: 0.02 },
    ],
  },
  {
    id: "skitterling_t5", name: "Bramble Skitterling", family: "skitterling", tier: 5,
    maxHealth: 22, attackLevel: 10, defenceLevel: 6,
    accuracy: 8, armour: 18, magicArmour: 55,
    maxHit: 4, attackSpeedMs: 2400, aggroRadius: 7, behaviour: "aggressive",
    marks: marksFor(5),
    drops: [
      { itemId: "corven_ore", quantity: [1, 2], chance: 0.35 },
      { itemId: "bramble_hide", quantity: [1, 1], chance: 0.30 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.07 },
    ],
  },
  {
    id: "marchwolf_t5", name: "Marchwolf", family: "marchwolf", tier: 5,
    // The one tier 5 family with low magic resistance, so Stonebrand has somewhere to go.
    maxHealth: 28, attackLevel: 13, defenceLevel: 8,
    accuracy: 10, armour: 14, magicArmour: 8,
    maxHit: 6, attackSpeedMs: 2400, aggroRadius: 10, behaviour: "aggressive",
    marks: marksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.55 },
      { itemId: "bramble_trout", quantity: [1, 2], chance: 0.25 },
      { itemId: "corven_dagger", quantity: [1, 1], chance: 0.02 },
    ],
  },

  // ---------------------------------------------------------------- Karrowmoor / Gravelmaw, tier 10
  {
    id: "cairnwight_t10", name: "Cairnwight", family: "cairnwight", tier: 10,
    // PRD 2.4 verbatim: 38 HP, armour +55, magicArmour +10. defenceLevel 11 is solved from the
    // 46% row. This is the target the whole magic-versus-melee argument is built on.
    maxHealth: 38, attackLevel: 18, defenceLevel: 11,
    accuracy: 16, armour: 55, magicArmour: 10,
    maxHit: 7, attackSpeedMs: 2400, aggroRadius: 10, behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "wight_shroud", quantity: [1, 1], chance: 0.40 },
      { itemId: "kaldite_ore", quantity: [1, 2], chance: 0.30 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.10 },
      { itemId: "kaldite_boots", quantity: [1, 1], chance: 0.02 },
    ],
  },
  {
    id: "skitterling_t10", name: "Scree Skitterling", family: "skitterling", tier: 10,
    // 34 HP and armour +30 are PRD 2.4. magicArmour is 115 rather than the quoted +40; see the
    // header block for why +40 cannot make melee win here.
    maxHealth: 34, attackLevel: 16, defenceLevel: 11,
    accuracy: 14, armour: 30, magicArmour: 115,
    maxHit: 6, attackSpeedMs: 2400, aggroRadius: 8, behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "kaldite_ore", quantity: [1, 3], chance: 0.45 },
      { itemId: "march_stone", quantity: [2, 4], chance: 0.30 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.08 },
    ],
  },
  {
    id: "thornbound_t10", name: "Thornbound Elder", family: "thornbound", tier: 10,
    maxHealth: 44, attackLevel: 20, defenceLevel: 12,
    accuracy: 18, armour: 22, magicArmour: 70,
    maxHit: 8, attackSpeedMs: 3000, aggroRadius: 11, behaviour: "territorial",
    marks: marksFor(10),
    drops: [
      { itemId: "cairnpine_log", quantity: [1, 3], chance: 0.45 },
      { itemId: "wight_shroud", quantity: [1, 1], chance: 0.35 },
      { itemId: "cairnleaf_seed", quantity: [1, 2], chance: 0.15 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.12 },
      { itemId: "cairnpine_staff", quantity: [1, 1], chance: 0.02 },
    ],
  },
  {
    id: "quarrykeeper_t10", name: "Ordrun the Quarrykeeper", family: "quarrykeeper", tier: 10,
    // 200 HP and magicArmour 18 are given. defenceLevel 20 / armour 62 are solved from the 45%
    // row; attackLevel 24 / accuracy 15 / maxHit 12 at 3.0 s are solved from "about 1.02 damage/s
    // through tier 10 armour". 165 s x 1.020 = 168 damage against a 75 health pool: a boss you
    // can lose, which PRD 2.4 says is the point.
    maxHealth: 200, attackLevel: 24, defenceLevel: 20,
    accuracy: 15, armour: 62, magicArmour: 18,
    maxHit: 12, attackSpeedMs: 3000, aggroRadius: 24, behaviour: "territorial",
    marks: [900, 1400],
    drops: [
      // PRD 2.10: "900 to 1,400 plus a guaranteed Kaldite piece".
      { itemId: "kaldite_sword", quantity: [1, 1], chance: 1.00 },
      { itemId: "kaldite_bar", quantity: [3, 6], chance: 1.00 },
      { itemId: "cairn_garnet", quantity: [2, 4], chance: 1.00 },
      { itemId: "wight_shroud", quantity: [1, 2], chance: 0.75 },
    ],
  },
];

/**
 * Ordrun's two phases. `EnemyDef` is frozen and carries no phase field, so `systems/combat.ts`
 * imports this directly. PRD section 0 caps Phase 1 at two phases and one telegraphed ground slam.
 *
 * Phase 2 starts at 55% health per `content/regions.ts`. The armour drop is what makes the second
 * half winnable at the same DPS the first half establishes: at Melee 18 in the tier 10 kit, the
 * hit chance goes from 44.9% to 49.5%, which roughly cancels the faster swing.
 */
export interface BossPhase {
  /** Enter this phase when health/maxHealth falls to or below this fraction. */
  atHealthFraction: number;
  armour: number;
  attackSpeedMs: number;
  maxHit: number;
  telegraphId?: string;
  telegraphWindupMs?: number;
  telegraphRadiusM?: number;
}

export const ORDRUN_PHASES: readonly BossPhase[] = [
  { atHealthFraction: 1.00, armour: 62, attackSpeedMs: 3000, maxHit: 12 },
  {
    atHealthFraction: 0.55, armour: 50, attackSpeedMs: 2400, maxHit: 14,
    telegraphId: "ground_slam", telegraphWindupMs: 1800, telegraphRadiusM: 6.0,
  },
];

/**
 * `content/regions.ts` group id -> stat block id. Every enemy group in the three regions and the
 * dungeon appears here, so a combat system can resolve straight off `meta.groupId`.
 */
const GROUP_BLOCK: readonly (readonly [string, string])[] = [
  ["rill_skitterlings", "skitterling_t1"],
  ["marchwolf_pups", "marchwolf_t1"],
  ["thornbound_husks", "thornbound_t5"],
  ["bramble_skitterlings", "skitterling_t5"],
  ["marchwolves_deepwood", "marchwolf_t5"],
  ["cairnwights_fields", "cairnwight_t10"],
  ["scree_skitterlings", "skitterling_t10"],
  ["thornbound_elders_ridge", "thornbound_t10"],
  ["gravelmaw_ch1_wights", "cairnwight_t10"],
  ["gravelmaw_ch2_skitterlings", "skitterling_t10"],
  ["gravelmaw_ch3_elders", "thornbound_t10"],
  // Count 1, so the entity id is the group id: content.enemy("ordrun") resolves the boss.
  ["ordrun", "quarrykeeper_t10"],
];

const BY_BLOCK_ID = new Map(BLOCKS.map((row) => [row.id, row] as const));

const GROUP_ALIASES: readonly EnemyDef[] = GROUP_BLOCK.flatMap(([groupId, blockId]) => {
  const base = BY_BLOCK_ID.get(blockId);
  return base === undefined ? [] : [{ ...base, id: groupId }];
});

/** Nine stat blocks plus twelve group aliases: 21 rows. */
export const ENEMIES: readonly EnemyDef[] = [...BLOCKS, ...GROUP_ALIASES];

/** The nine canonical stat blocks, without the group aliases. For docs and the bestiary. */
export const ENEMY_BLOCKS: readonly EnemyDef[] = BLOCKS;
