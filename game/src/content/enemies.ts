/**
 * Enemy stat blocks for every ordinary family and the three released region bosses.
 *
 * Owned by W-CONTENT.
 *
 * ---------------------------------------------------------------------------------------------
 * THE FAMILY VOCABULARY. Five of the nine families were solved straight from PRD 2.4's rows; four
 * were added because two groups per region left the ground between the settlements empty. A family
 * earns its name by being a distinct SHAPE in the numbers, not a rename - there are only four enemy
 * meshes in the whole library, so the mechanics have to carry the difference the art cannot.
 *
 *  family        shape                  the number that defines it
 *  ------------- ---------------------- ----------------------------------------------------------
 *  skitterling   armoured scuttler      high armour, high magicArmour: the melee-favouring block
 *  marchwolf     pack hunter            low magicArmour, and at tier 10 an 1800 ms cadence
 *  thornbound    drifting husk          magicArmour 45-70: the target you do NOT bring a staff to
 *  cairnwight    armoured dead          armour 55 against magicArmour 10: the staff's answer
 *  quarrykeeper  boss                   200 health, two phases, a telegraphed slam
 *  fenmite       swarm                  1200 ms, max hit 1-3, 4-12 health, passive at 4-5 m
 *  mudback       bulwark                the highest armour in the game against magicArmour 0
 *  reaver        humanoid raider        aggro 14 m, symmetric armour, and 2.4x the mark drop
 *  hollow        glass cannon           armour 0-6 and the biggest single blow at its tier
 *
 * Behaviour is the second axis and it is doing real work: `passive` fenmites and `territorial`
 * mudbacks/hollows can be walked past, so the four aggressive families (marchwolf, skitterling
 * above tier 1, reaver) are what actually decides whether a stretch of ground is dangerous.
 * `systems/enemyAI.ts` reads exactly `behaviour` and `aggroRadius`; `systems/combat.ts` reads every
 * other field on the row. Nothing here is decorative.
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
 * MAGIC VS MELEE, the gate criterion in PRD 2.4. Rimewash at Magic 10 in the full tier 10 magic kit
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

/**
 * Reavers carry a purse, so they pay 2.4x the ordinary band.
 *
 * This is the one mechanical reason to take an aggressive 14 m-aggro fight you could have walked
 * around: at tier 1 a Reaver averages 25 marks against a Marchwolf Pup's 7, which is a Grithe
 * dagger (90 marks) in four fights instead of thirteen.
 */
function purseMarksFor(tier: number): [number, number] {
  return [Math.round(tier * 7), Math.round(tier * 27)];
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

  {
    id: "fenmite_t1", name: "Bracken Fenmite", family: "fenmite", tier: 1,
    // The swarm shape, and the only one in the table: 1200 ms is the fastest cadence in the game
    // (two combat ticks), and 1 max hit makes every landed swing worth exactly 1. Against a Melee 1
    // player in the starter kit it deals 0.437 dmg/s and dies in 12.6 s, so one fenmite costs 5.5 of
    // 23 health - four of them is a real problem and one of them is a nuisance. Passive at 4 m, so a
    // starting player walks the March Road through the cloud and fights only what they swing at.
    maxHealth: 4, attackLevel: 2, defenceLevel: 1,
    accuracy: 0, armour: 0, magicArmour: 0,
    maxHit: 1, attackSpeedMs: 1200, aggroRadius: 4, behaviour: "passive",
    marks: marksFor(1),
    drops: [
      { itemId: "bittergrain_seed", quantity: [1, 2], chance: 0.30 },
      { itemId: "duskberry_seed", quantity: [1, 1], chance: 0.12 },
      { itemId: "pale_quartz", quantity: [1, 1], chance: 0.04 },
    ],
  },
  {
    id: "mudback_t1", name: "Redsill Mudback", family: "mudback", tier: 1,
    // The bulwark shape. Armour 35 and a 3600 ms cadence are the two numbers that define it: it is
    // the slowest thing in Fallowmarch and the hardest to cut, and it is the ONLY tier 1 block with
    // magicArmour 0. Melee 3 with a Grithe dagger takes 34.9 s and 16.1 of 26 health.
    //
    // Deliberately NOT a Melee 1 fight: at 0.25 dmg/s in the starter kit it runs 65.9 s and costs
    // 32.8 against a 23 health pool, i.e. the player loses. That is what `territorial` is for - it
    // never initiates, its aggro radius is 5 m, and it stands off the road. It is the block that
    // says "come back", and the one whose magicArmour 0 says how.
    maxHealth: 16, attackLevel: 5, defenceLevel: 3,
    accuracy: 6, armour: 35, magicArmour: 0,
    maxHit: 5, attackSpeedMs: 3600, aggroRadius: 5, behaviour: "territorial",
    marks: marksFor(1),
    drops: [
      { itemId: "march_stone", quantity: [2, 4], chance: 0.65 },
      { itemId: "grithe_ore", quantity: [1, 2], chance: 0.30 },
      { itemId: "pale_quartz", quantity: [1, 1], chance: 0.10 },
    ],
  },
  {
    id: "reaver_t1", name: "March Road Reaver", family: "reaver", tier: 1,
    // The humanoid shape, and the widest aggro radius in the game outside Ordrun: 14 m, against
    // 6-11 m everywhere else. A Reaver is the enemy that comes to you, and the one that pays for
    // it (see `purseMarksFor`). Balanced armour and magicArmour both at 10, so neither style has an
    // answer to it and it is the block a new player learns to just fight.
    //
    // 9 health is the number that makes an UNAVOIDABLE tier 1 fight survivable, and it is a hard
    // constraint rather than a taste: at Melee 1 in the starter kit the player deals 0.26 dmg/s, so
    // every extra point of enemy health costs about 2 of the player's 23. At 9 the fight runs 34.4 s
    // and costs 17.6 - worse than a Marchwolf Pup's 20.3 only in that it finds you from 14 m instead
    // of 8. Everything harder than this in Fallowmarch is territorial and can be walked past.
    maxHealth: 9, attackLevel: 6, defenceLevel: 4,
    accuracy: 6, armour: 10, magicArmour: 10,
    maxHit: 3, attackSpeedMs: 2400, aggroRadius: 14, behaviour: "aggressive",
    marks: purseMarksFor(1),
    drops: [
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.35 },
      { itemId: "grithe_ore", quantity: [1, 2], chance: 0.25 },
      { itemId: "air_essence", quantity: [1, 1], chance: 0.10 },
      { itemId: "grithe_helm", quantity: [1, 1], chance: 0.03 },
    ],
  },
  {
    id: "hollow_t1", name: "Palewood Hollow", family: "hollow", tier: 1,
    // The glass cannon. Armour 0 and 9 health make it the second-fastest tier 1 kill in the table,
    // and max hit 5 on a 3000 ms cadence makes it the hardest single blow at tier 1 - a bad roll
    // takes a fifth of a starting player's health in one swing. Same damage race as at tier 5: 29.8 s
    // and 19.0 of 23 health against a Marchwolf Pup's 42.5 s and 20.3 - nearly the same bill in 70%
    // of the time. magicArmour 20 against armour 0 is the inverse of the Mudback standing 264 m east,
    // so the two of them teach the same lesson from opposite ends.
    // Territorial: it does not leave the dead wood south of the copse.
    maxHealth: 9, attackLevel: 7, defenceLevel: 2,
    accuracy: 10, armour: 0, magicArmour: 20,
    maxHit: 5, attackSpeedMs: 3000, aggroRadius: 7, behaviour: "territorial",
    marks: marksFor(1),
    drops: [
      { itemId: "palewood_log", quantity: [1, 2], chance: 0.30 },
      { itemId: "pale_quartz", quantity: [1, 1], chance: 0.20 },
      { itemId: "air_essence", quantity: [1, 1], chance: 0.08 },
    ],
  },
  {
    id: "tempest_roc_t1", name: "Tempest Roc", family: "tempest_roc", tier: 1,
    // Fallowmarch's region boss. Its slow heavy cadence leaves room to eat or disengage, while
    // enough health separates the fight from the ordinary road enemies.
    maxHealth: 80, attackLevel: 9, defenceLevel: 7,
    accuracy: 10, armour: 18, magicArmour: 24,
    maxHit: 6, attackSpeedMs: 3000, aggroRadius: 20, behaviour: "territorial",
    marks: [80, 140],
    drops: [
      { itemId: "air_orb", quantity: [1, 1], chance: 1.00 },
      { itemId: "palewood_log", quantity: [3, 5], chance: 1.00 },
      { itemId: "pale_quartz", quantity: [1, 2], chance: 0.75 },
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

  {
    id: "fenmite_t5", name: "Mire Fenmite", family: "fenmite", tier: 5,
    // Same shape one tier up: still 1200 ms, still passive, still the cheapest kill in its region.
    // Armour and magicArmour both 8 keep it deliberately unresistant - the swarm is a pace change
    // over the Blackwater pools, not a wall.
    maxHealth: 12, attackLevel: 10, defenceLevel: 5,
    accuracy: 6, armour: 8, magicArmour: 8,
    maxHit: 3, attackSpeedMs: 1200, aggroRadius: 5, behaviour: "passive",
    marks: marksFor(5),
    drops: [
      { itemId: "duskberry_seed", quantity: [1, 2], chance: 0.28 },
      { itemId: "bramble_hide", quantity: [1, 1], chance: 0.15 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.06 },
    ],
  },
  {
    id: "reaver_t5", name: "Gorge Reaver", family: "reaver", tier: 5,
    // Armour 26 / magicArmour 24 hold the family's "no style has the answer" rule at tier 5, where
    // every other Vellenwood block is lopsided (Thornbound 10/45, Bramble Skitterling 18/55,
    // Marchwolf 14/8). Melee 7 with a Corven sword takes 35.0 s and 28.9 of 32 health, which is the
    // most expensive ordinary fight in the region - just past the Marchwolf's 27.6 and no further,
    // because this one initiates from 14 m and the Marchwolf does not. The purse pays 35-135 marks.
    maxHealth: 26, attackLevel: 14, defenceLevel: 9,
    accuracy: 14, armour: 26, magicArmour: 24,
    maxHit: 6, attackSpeedMs: 2400, aggroRadius: 14, behaviour: "aggressive",
    marks: purseMarksFor(5),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.35 },
      { itemId: "corven_ore", quantity: [1, 2], chance: 0.25 },
      { itemId: "earth_essence", quantity: [1, 2], chance: 0.15 },
      { itemId: "corven_boots", quantity: [1, 1], chance: 0.03 },
    ],
  },
  {
    id: "hollow_t5", name: "Canopy Hollow", family: "hollow", tier: 5,
    // Armour 6 is the lowest in Vellenwood and max hit 8 at 3000 ms is the biggest single blow in
    // it, two above the Marchwolf. That is the glass cannon stated in numbers: a Corven-kitted
    // player kills it in 27.0 s - faster than the Husk's 30.7 and the Marchwolf's 34.7 - and still
    // pays 23.8 of 32 health for it, more than either. It is a damage race, not a grind.
    // magicArmour 40 is the second highest in the region behind the Husk's 45, so a staff gets no
    // discount here: 14.9 s against the Bramble Skitterling's 14.2.
    maxHealth: 24, attackLevel: 16, defenceLevel: 6,
    accuracy: 16, armour: 6, magicArmour: 40,
    maxHit: 8, attackSpeedMs: 3000, aggroRadius: 8, behaviour: "territorial",
    marks: marksFor(5),
    drops: [
      { itemId: "duskoak_log", quantity: [1, 2], chance: 0.30 },
      { itemId: "vell_amber", quantity: [1, 1], chance: 0.15 },
      { itemId: "earth_essence", quantity: [1, 2], chance: 0.12 },
      { itemId: "duskoak_wand", quantity: [1, 1], chance: 0.02 },
    ],
  },
  {
    id: "rootheart_t5", name: "The Rootheart", family: "rootheart", tier: 5,
    // Vellenwood's region boss. High physical armour favours the Earth Orb it guards once the
    // player has earned that progression reward.
    maxHealth: 140, attackLevel: 18, defenceLevel: 14,
    accuracy: 16, armour: 48, magicArmour: 32,
    maxHit: 9, attackSpeedMs: 3000, aggroRadius: 22, behaviour: "territorial",
    marks: [350, 550],
    drops: [
      { itemId: "earth_orb", quantity: [1, 1], chance: 1.00 },
      { itemId: "duskoak_log", quantity: [3, 6], chance: 1.00 },
      { itemId: "vell_amber", quantity: [2, 3], chance: 0.75 },
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.60 },
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
    id: "mudback_t10", name: "Terrace Mudback", family: "mudback", tier: 10,
    // Armour 78 is the highest in the game, boss included, and magicArmour 0 is the lowest. That
    // pairing is the point: Melee 12 with a Kaldite sword needs 45.2 s, Rimewash at Magic 10 needs
    // 29.1 s, so MAGIC WINS by 35% - the exact mirror of the Scree Skitterling standing 60 m away,
    // where melee wins by 10%. Between them, the two blocks make "which style do I bring" a question
    // about the target rather than a global answer.
    // Territorial at 6 m, because 39.6 of 41 health is not a fight to be dragged into.
    maxHealth: 46, attackLevel: 20, defenceLevel: 13,
    accuracy: 14, armour: 78, magicArmour: 0,
    maxHit: 11, attackSpeedMs: 3600, aggroRadius: 6, behaviour: "territorial",
    marks: marksFor(10),
    drops: [
      { itemId: "kaldite_ore", quantity: [2, 4], chance: 0.55 },
      { itemId: "march_stone", quantity: [2, 5], chance: 0.35 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.12 },
    ],
  },
  {
    id: "reaver_t10", name: "Karrow Reaver", family: "reaver", tier: 10,
    // The last quarry crew, still armed. Armour 42 / magicArmour 40 keeps the family symmetric at
    // the top tier, and 40 health puts it between the Cairnwight (38) and the Thornbound Elder (44)
    // rather than beyond either. Aggro 14 makes it the thing that finds you on the moor road, so its
    // cost is capped at the Cairnwight's: 34.6 s and 31.8 of 41 health at Melee 12 in a Kaldite
    // sword, against the Cairnwight's 32.7 s and 27.9.
    maxHealth: 40, attackLevel: 22, defenceLevel: 13,
    accuracy: 18, armour: 42, magicArmour: 40,
    maxHit: 7, attackSpeedMs: 2400, aggroRadius: 14, behaviour: "aggressive",
    marks: purseMarksFor(10),
    drops: [
      { itemId: "wight_shroud", quantity: [1, 1], chance: 0.30 },
      { itemId: "kaldite_ore", quantity: [1, 3], chance: 0.30 },
      { itemId: "water_essence", quantity: [1, 3], chance: 0.20 },
      { itemId: "kaldite_dagger", quantity: [1, 1], chance: 0.03 },
    ],
  },
  {
    id: "marchwolf_t10", name: "Tarn Marchwolf", family: "marchwolf", tier: 10,
    // The family's third tier, and the only tier 10 block that swings faster than 2400 ms. 1800 ms
    // is three combat ticks, so it lands four swings for every three of anything else on the moor:
    // 1.206 dmg/s through a Melee 12 Kaldite kit, the highest on the surface, off the LOWEST tier 10
    // armour (20) and magicArmour (12). It dies fast and hurts while it lives - 23.3 s and 28.0 of
    // 41 health, where a Cairnwight is 32.7 s and 27.9.
    maxHealth: 30, attackLevel: 21, defenceLevel: 12,
    accuracy: 18, armour: 20, magicArmour: 12,
    maxHit: 7, attackSpeedMs: 1800, aggroRadius: 12, behaviour: "aggressive",
    marks: marksFor(10),
    drops: [
      { itemId: "bramble_hide", quantity: [1, 2], chance: 0.40 },
      { itemId: "cragfin", quantity: [1, 2], chance: 0.30 },
      { itemId: "coarse_hide", quantity: [1, 2], chance: 0.25 },
      { itemId: "cairn_garnet", quantity: [1, 1], chance: 0.06 },
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
      { itemId: "water_orb", quantity: [1, 1], chance: 1.00 },
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
  // Fallowmarch, tier 1
  ["rill_skitterlings", "skitterling_t1"],
  ["marchwolf_pups", "marchwolf_t1"],
  ["bracken_fenmites", "fenmite_t1"],
  ["redsill_mudbacks", "mudback_t1"],
  ["march_road_reavers", "reaver_t1"],
  ["palewood_hollows", "hollow_t1"],
  ["tempest_roc", "tempest_roc_t1"],
  // Vellenwood, tier 5
  ["thornbound_husks", "thornbound_t5"],
  ["bramble_skitterlings", "skitterling_t5"],
  ["marchwolves_deepwood", "marchwolf_t5"],
  ["mire_fenmites", "fenmite_t5"],
  ["gorge_reavers", "reaver_t5"],
  ["canopy_hollows", "hollow_t5"],
  ["rootheart", "rootheart_t5"],
  // Karrowmoor, tier 10
  ["cairnwights_fields", "cairnwight_t10"],
  ["scree_skitterlings", "skitterling_t10"],
  ["thornbound_elders_ridge", "thornbound_t10"],
  ["terrace_mudbacks", "mudback_t10"],
  ["karrow_reavers", "reaver_t10"],
  ["tarn_marchwolves", "marchwolf_t10"],
  // Gravelmaw, tier 10
  ["gravelmaw_ch1_wights", "cairnwight_t10"],
  ["gravelmaw_ch1_reavers", "reaver_t10"],
  ["gravelmaw_ch2_skitterlings", "skitterling_t10"],
  ["gravelmaw_ch2_mudbacks", "mudback_t10"],
  ["gravelmaw_ch3_elders", "thornbound_t10"],
  // Count 1, so the entity id is the group id: content.enemy("ordrun") resolves the boss.
  ["ordrun", "quarrykeeper_t10"],
];

const BY_BLOCK_ID = new Map(BLOCKS.map((row) => [row.id, row] as const));

const GROUP_ALIASES: readonly EnemyDef[] = GROUP_BLOCK.flatMap(([groupId, blockId]) => {
  const base = BY_BLOCK_ID.get(blockId);
  return base === undefined ? [] : [{ ...base, id: groupId }];
});

/** Twenty-one stat blocks plus twenty-six group aliases: 47 rows. */
export const ENEMIES: readonly EnemyDef[] = [...BLOCKS, ...GROUP_ALIASES];

/** The twenty-one canonical stat blocks, without the group aliases. For docs and the bestiary. */
export const ENEMY_BLOCKS: readonly EnemyDef[] = BLOCKS;
