/**
 * The equipment ladder: a full 9-slot kit at tiers 1, 5 and 10, in two mechanically distinct
 * lines.
 *
 * Owned by W-CONTENT. `items.ts` re-exports these rows inside `ALL_ITEMS`; nothing else should
 * import `EQUIPMENT` directly, because the registry only ever sees the concatenated table.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ARITHMETIC (PRD 2.3 and 2.4). Every number below is derived, not guessed.
 *
 * Melee damage:  maxHit = floor(2 + (meleeLevel + gearPower) / 4.2)
 *
 *   Grithe dagger, Melee 1,  power  6 -> floor(2 +  7/4.2) = floor( 3.667) =  3   (PRD 2.4)
 *   Corven sword,  Melee 5,  power 14 -> floor(2 + 19/4.2) = floor( 6.524) =  6   (PRD 2.4)
 *   Kaldite sword, Melee 10, power 26 -> floor(2 + 36/4.2) = floor(10.571) = 10   (PRD 2.4)
 *
 *   The PRD's worked rows quote weapon-only gearPower, and its Ordrun row pins that reading:
 *   "Melee 18, tier 10 kit -> maxHit 12" needs floor(2 + (18 + P)/4.2) = 12, i.e. P in [24, 28.2).
 *   The Kaldite sword alone is 26. So ARMOUR CONTRIBUTES ZERO POWER at every tier; armour buys
 *   `armour`, `magicArmour` and `vitality`, and weapons buy `power` / `magicPower`. Keep it that
 *   way or the PRD's damage table stops reproducing.
 *
 *   Cross-checks that also fall out of the same numbers:
 *     Melee 3,  Grithe dagger  -> floor(2 +  9/4.2) =  4   (PRD TTK table)
 *     Melee 7,  Corven sword   -> floor(2 + 21/4.2) =  7   (PRD TTK table)
 *     Melee 12, Kaldite sword  -> floor(2 + 38/4.2) = 11   (PRD TTK table)
 *     Melee 18, Kaldite sword  -> floor(2 + 44/4.2) = 12   (PRD Ordrun row)
 *
 * Derived health: maxHealth = 20 + 3 * max(1, floor((melee + magic)/2)) + sum(vitality)
 *
 *   Full melee kit vitality totals are tuned to reproduce PRD 2.3 exactly:
 *     tier  1 kit = +6   -> Melee 10 / Magic  1: 20 + 3*5  +  6 = 41
 *     tier  5 kit = +14  -> Melee 12 / Magic  5: 20 + 3*8  + 14 = 58
 *     tier 10 kit = +16  -> Melee 18 / Magic  8: 20 + 3*13 + 16 = 75
 *   The tier 10 kit being only +2 vitality over tier 5 is the PRD's number, not a typo on our
 *   side; tier 10's real gain is +25 armour and +12 power. The 75 HP pool is load-bearing for the
 *   Ordrun fight budget in PRD 2.4, so do not "fix" it.
 *
 * Accuracy: attackRoll = (attackLevel + 9) * (1 + gearAccuracy/100) * styleFactor
 *           defenceRoll = (defenceLevel + 9) * (1 + defenderArmour/100)
 *           hitChance   = clamp(attackRoll / (attackRoll + defenceRoll), 0.05, 0.95)
 *
 *   Weapon accuracy values are solved from the PRD's hit-chance column; see `enemies.ts` for the
 *   matching defender stat blocks and the full solved TTK table.
 *     Grithe dagger  acc  +6: Melee 3 vs Rill Skitterling  -> 12*1.06 / (12*1.06 + 10)   = 56%
 *     Corven sword   acc +14: Melee 7 vs Thornbound Husk   -> 16*1.14 / (16*1.14 + 17.6) = 51%
 *     Kaldite sword  acc +28: Melee 12 vs Scree Skitterling-> 21*1.28 / (21*1.28 + 26.0) = 51%
 *                             Melee 12 vs Cairnwight       -> 21*1.28 / (21*1.28 + 31.0) = 46%
 *
 *   Full-kit accuracy totals: 11 (t1) / 23 (t5) / 42 (t10). The t10 total is solved from the
 *   Ordrun row: 27 * 1.42 = 38.34 against Ordrun's 29 * 1.62 = 46.98 gives 45%.
 *
 *   Full-kit armour totals: 16 (t1) / 33 (t5) / 58 (t10). The t10 total is solved from "Ordrun
 *   deals about 1.02 damage/s through tier 10 armour": 27 * 1.58 = 42.66 defence roll.
 *
 * Magic damage: maxHit = floor(spell.baseMax + (magicLevel + gearMagicPower) / spell.divisor)
 *
 *   The tier 10 magic kit is solved from PRD 2.4's headline claim, "at Magic 10 with a Kaldite
 *   staff, Voltrend kills a Cairnwight in 24 s where a Kaldite sword at Melee 12 takes 33 s":
 *     magicPower    +32 -> Voltrend maxHit = floor(8 + (10 + 32)/6) = 15, average hit 8.0
 *     magicAccuracy +47 -> attackRoll = (10 + 9) * 1.15 * 1.47 = 32.12
 *     Cairnwight magic defence = (11 + 9) * 1.10 = 22.00 -> hitChance = 0.5935
 *     dps = 0.5935 * 8.0 / 3.0 s = 1.583 -> 38 HP / 1.583 = 24.0 s.  MATCHES.
 *   Lower tiers follow the same shape at 6 (t1) and 14 (t5) magicPower, which reproduces the PRD's
 *   "maxHit at unlock" column for Emberlash (3) and Stonebrand (7 against a quoted 6, see the note
 *   in `spells.ts`).
 * ---------------------------------------------------------------------------------------------
 */
import type { EquipmentBonuses, EquipSlot, ItemDef, SkillId } from "../contracts.js";

/** Zero-filled bonuses, so a row only writes the fields it actually changes. */
function bonuses(partial: Partial<EquipmentBonuses>): EquipmentBonuses {
  return {
    accuracy: partial.accuracy ?? 0,
    power: partial.power ?? 0,
    armour: partial.armour ?? 0,
    magicAccuracy: partial.magicAccuracy ?? 0,
    magicPower: partial.magicPower ?? 0,
    magicArmour: partial.magicArmour ?? 0,
    vitality: partial.vitality ?? 0,
  };
}

interface GearRow {
  id: string;
  name: string;
  tier: number;
  slot: EquipSlot;
  value: number;
  description: string;
  requires: Partial<Record<SkillId, number>>;
  bonuses: Partial<EquipmentBonuses>;
  attackSpeedMs?: number;
}

function gear(row: GearRow): ItemDef {
  const equip: ItemDef["equip"] = row.attackSpeedMs === undefined
    ? { slot: row.slot, bonuses: bonuses(row.bonuses), requires: row.requires }
    : {
      slot: row.slot,
      bonuses: bonuses(row.bonuses),
      attackSpeedMs: row.attackSpeedMs,
      requires: row.requires,
    };
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    description: row.description,
    stackable: false,
    value: row.value,
    category: "equipment",
    equip,
  };
}

/**
 * Every melee weapon uses the same swing cadence. Staffs and wands share the spell cadence. PRD 2.4 fixes 2.4 s for "a
 * standard sword", and the unarmed / dagger TTK rows only reproduce at 2.4 s, so daggers share it
 * and trade damage for cost rather than for speed.
 */
const MELEE_SPEED_MS = 2400;
/** PRD 2.4: "Magic is slower (3.0 s per cast against 2.4 s for a standard sword)". */
const CAST_SPEED_MS = 3000;

type GatheringTier = 1 | 5 | 10;

interface StaffBonuses {
  readonly power?: number;
  readonly magicAccuracy: number;
  readonly magicPower: number;
  readonly magicArmour: number;
}

const STAFF_BONUSES: Readonly<Record<GatheringTier, StaffBonuses>> = {
  1: { magicAccuracy: 6, magicPower: 4, magicArmour: 1 },
  5: { power: 2, magicAccuracy: 12, magicPower: 9, magicArmour: 2 },
  10: { power: 4, magicAccuracy: 24, magicPower: 20, magicArmour: 4 },
};

/** Wands keep two thirds of a staff's magic stats and never inherit its incidental melee power. */
function wandBonuses(tier: GatheringTier): Partial<EquipmentBonuses> {
  const staff = STAFF_BONUSES[tier];
  return {
    magicAccuracy: Math.round(staff.magicAccuracy * 2 / 3),
    magicPower: Math.round(staff.magicPower * 2 / 3),
    magicArmour: Math.round(staff.magicArmour * 2 / 3),
  };
}

// -------------------------------------------------------------- starter kit, tier 0 (Worn)
/**
 * What the player wakes up with.
 *
 * Tier 0 exists so the first minute of the game has a weapon in it and so the tier ladder starts
 * below the first thing you can buy, rather than at it. The numbers are deliberately under
 * `grithe_dagger`'s 6/6 and `palewood_staff`'s 6/4/1: these are things someone else wore out, and
 * replacing them has to be worth 90 and 140 marks. Neither row is part of any `KITS` entry, because
 * the PRD's derived-health and damage tables are written against tiers 1, 5 and 10 only.
 *
 * Tier 0 now carries ONE WEAPON PER COMBAT LINE, which it did not before `worn_staff` existed. The
 * melee line opened at Melee 1 with a blade already in hand; the magic line opened with nothing, so
 * a player who read "Magic" on the character sheet and wanted to train it from level 1 had to earn
 * the 140 marks `palewood_staff` costs with a sword first — buy your way into the skill, before the
 * skill has shown you anything. Both lines now start in the first minute.
 *
 * The staff is only half of that, and the other half is in `items.ts`: a cast also spends an Essence
 * Shard, and a new character has `currency: 0` and nothing to sell, so `STARTING_INVENTORY` carries
 * twenty shards alongside the staff. Without them this row would be a weapon that cannot be fired
 * once. The two must move together.
 *
 * `requires` is empty on both rows on purpose. A starting item that the starting character cannot
 * equip would be a bug the player meets before they meet anything else.
 */
const STARTER_EQUIPMENT: readonly ItemDef[] = [
  gear({
    id: "worn_sword", name: "Worn Shortsword", tier: 0, slot: "mainHand", value: 15,
    description: "Notched, re-hafted twice, and lighter than it looks. It was somebody else's first.",
    requires: {}, attackSpeedMs: MELEE_SPEED_MS,
    bonuses: { accuracy: 3, power: 3 },
  }),
  gear({
    id: "worn_staff", name: "Worn Staff", tier: 0, slot: "mainHand", value: 15,
    description: "A split shaft with a quartz chip wound into the crack. It holds a cast, barely.",
    requires: {}, attackSpeedMs: CAST_SPEED_MS,
    // 3/2 against `palewood_staff`'s 6/4/1. Worked through, because "slightly worse" is easy to
    // write and easy to get wrong: Emberlash at Magic 1 is floor(3 + (1 + 2)/8) = 3 on this staff
    // and floor(3 + (1 + 4)/8) = 3 on the palewood one, so at the level a player meets both, the
    // upgrade buys ACCURACY and not damage — attack roll 1.03 against 1.06. Max hit first splits at
    // Magic 4: floor(3 + 6/8) = 3 here against floor(3 + 8/8) = 4 there. That is the intended
    // shape. Any higher and the first staff a player can buy would be a sidegrade at the moment
    // they can afford it, which is the trap the tier-0 tools in `items.ts` sidestep for the same
    // reason.
    bonuses: { magicAccuracy: 3, magicPower: 2 },
  }),
];

// ------------------------------------------------------------------ melee, tier 1 (Grithe)
// Kit totals: accuracy 11, power 8 (sword) / 6 (dagger), armour 16, magicArmour 5, vitality 6.

const MELEE_TIER_1: readonly ItemDef[] = [
  gear({
    id: "grithe_dagger", name: "Grithe Dagger", tier: 1, slot: "mainHand", value: 90,
    description: "A short blade of dull grey Grithe. The first real weapon anyone out here owns.",
    requires: { melee: 1 }, attackSpeedMs: MELEE_SPEED_MS,
    // PRD 2.4 fixes power 6 and, through the 56% row at Melee 3, accuracy 6.
    bonuses: { accuracy: 6, power: 6 },
  }),
  gear({
    id: "grithe_sword", name: "Grithe Sword", tier: 1, slot: "mainHand", value: 180,
    description: "Two bars of Grithe beaten flat and given an edge. Heavier than the dagger, and hits like it.",
    requires: { melee: 1 }, attackSpeedMs: MELEE_SPEED_MS,
    bonuses: { accuracy: 7, power: 8 },
  }),
  gear({
    id: "palewood_shield", name: "Palewood Shield", tier: 1, slot: "offHand", value: 70,
    description: "Planks of pale march wood banded at the rim. It stops a claw once.",
    requires: { melee: 1 },
    bonuses: { accuracy: 1, armour: 4, magicArmour: 2 },
  }),
  gear({
    id: "grithe_helm", name: "Grithe Helm", tier: 1, slot: "head", value: 110,
    description: "An open-faced cap. You can hear things coming, which is most of the job.",
    requires: { melee: 1 },
    bonuses: { armour: 2, vitality: 1 },
  }),
  gear({
    id: "grithe_cuirass", name: "Grithe Cuirass", tier: 1, slot: "body", value: 220,
    description: "A plate front laced over a leather back. Cheap, loud, and better than nothing.",
    requires: { melee: 1 },
    bonuses: { accuracy: 1, armour: 5, magicArmour: 1, vitality: 2 },
  }),
  gear({
    id: "grithe_greaves", name: "Grithe Greaves", tier: 1, slot: "legs", value: 200,
    description: "Shin and thigh plates on a march-issue belt.",
    requires: { melee: 1 },
    bonuses: { armour: 3, magicArmour: 1, vitality: 1 },
  }),
  gear({
    id: "grithe_boots", name: "Grithe Boots", tier: 1, slot: "feet", value: 80,
    description: "Iron-shod boots for scree and bracken.",
    requires: { melee: 1 },
    bonuses: { armour: 1, vitality: 1 },
  }),
  gear({
    id: "grithe_gloves", name: "Grithe Gloves", tier: 1, slot: "hands", value: 80,
    description: "Studded gloves. They keep the grip when the haft goes wet.",
    requires: { melee: 1 },
    bonuses: { armour: 1, vitality: 1 },
  }),
  gear({
    id: "grithe_ring", name: "Grithe Ring", tier: 1, slot: "accessory1", value: 95,
    description: "A plain band set with a chip of pale quartz.",
    requires: { melee: 1 },
    bonuses: { accuracy: 1 },
  }),
  gear({
    id: "grithe_pendant", name: "Grithe Pendant", tier: 1, slot: "accessory2", value: 105,
    description: "March Company issue. The stamp on the back is a serial number, not a blessing.",
    requires: { melee: 1 },
    bonuses: { accuracy: 1, magicArmour: 1 },
  }),
];

// ------------------------------------------------------------------ melee, tier 5 (Corven)
// Kit totals: accuracy 23, power 14 (sword), armour 33, magicArmour 12, vitality 14.
// The vitality total is PRD 2.3 row 3: Melee 12 / Magic 5 -> 20 + 24 + 14 = 58 max health.

const MELEE_TIER_5: readonly ItemDef[] = [
  gear({
    id: "corven_dagger", name: "Corven Dagger", tier: 5, slot: "mainHand", value: 320,
    description: "Deepwood steel, dark and slightly oily to the touch.",
    requires: { melee: 5 }, attackSpeedMs: MELEE_SPEED_MS,
    bonuses: { accuracy: 12, power: 11 },
  }),
  gear({
    id: "corven_sword", name: "Corven Sword", tier: 5, slot: "mainHand", value: 620,
    description: "A long Corven blade. The standard by which a Vellenwood hand is judged.",
    requires: { melee: 5 }, attackSpeedMs: MELEE_SPEED_MS,
    // PRD 2.4 fixes power 14, and the 51% Thornbound row fixes accuracy 14.
    bonuses: { accuracy: 14, power: 14 },
  }),
  gear({
    id: "duskoak_shield", name: "Duskoak Shield", tier: 5, slot: "offHand", value: 240,
    description: "Laminated duskoak over a Corven boss. Heavy enough to lean on.",
    requires: { melee: 5 },
    bonuses: { accuracy: 1, armour: 8, magicArmour: 4, vitality: 1 },
  }),
  gear({
    id: "corven_helm", name: "Corven Helm", tier: 5, slot: "head", value: 380,
    description: "A full helm with a narrow sight slit.",
    requires: { melee: 5 },
    bonuses: { accuracy: 1, armour: 5, magicArmour: 1, vitality: 2 },
  }),
  gear({
    id: "corven_plate", name: "Corven Plate", tier: 5, slot: "body", value: 760,
    description: "Three bars of Corven, articulated at the waist so you can still bend to pick things up.",
    requires: { melee: 5 },
    bonuses: { accuracy: 2, armour: 10, magicArmour: 2, vitality: 4 },
  }),
  gear({
    id: "corven_greaves", name: "Corven Greaves", tier: 5, slot: "legs", value: 700,
    description: "Plated legs. Slower over a root field, worth it under a husk.",
    requires: { melee: 5 },
    bonuses: { accuracy: 1, armour: 7, magicArmour: 2, vitality: 3 },
  }),
  gear({
    id: "corven_boots", name: "Corven Boots", tier: 5, slot: "feet", value: 260,
    description: "Plated over the toe, soft in the sole. Deepwood floor is not forgiving.",
    requires: { melee: 5 },
    bonuses: { accuracy: 1, armour: 2, magicArmour: 1, vitality: 2 },
  }),
  gear({
    id: "corven_gauntlets", name: "Corven Gauntlets", tier: 5, slot: "hands", value: 260,
    description: "Fingered plate. You can hold a rod in these, badly.",
    requires: { melee: 5 },
    bonuses: { accuracy: 1, armour: 1, magicArmour: 1, vitality: 2 },
  }),
  gear({
    id: "corven_ring", name: "Corven Ring", tier: 5, slot: "accessory1", value: 330,
    description: "Corven band, amber set flush so it does not catch.",
    requires: { melee: 5 },
    bonuses: { accuracy: 1 },
  }),
  gear({
    id: "corven_pendant", name: "Corven Pendant", tier: 5, slot: "accessory2", value: 360,
    description: "A slice of vell amber on a Corven chain. Warm, which nobody has explained.",
    requires: { melee: 5 },
    bonuses: { accuracy: 1, magicAccuracy: 1, magicArmour: 1 },
  }),
];

// ------------------------------------------------------------------ melee, tier 10 (Kaldite)
// Kit totals: accuracy 42, power 26 (sword), armour 58, magicArmour 19, vitality 16. All solved above.

const MELEE_TIER_10: readonly ItemDef[] = [
  gear({
    id: "kaldite_dagger", name: "Kaldite Dagger", tier: 10, slot: "mainHand", value: 760,
    description: "A punch of black Kaldite with a needle point. It goes through moor-rot like paper.",
    requires: { melee: 9 }, attackSpeedMs: MELEE_SPEED_MS,
    bonuses: { accuracy: 24, power: 22 },
  }),
  gear({
    id: "kaldite_sword", name: "Kaldite Sword", tier: 10, slot: "mainHand", value: 1450,
    description: "Highcairn's best. Kaldite holds an edge through stone, which is the whole point up here.",
    requires: { melee: 10 }, attackSpeedMs: MELEE_SPEED_MS,
    // PRD 2.4 fixes power 26; accuracy 28 is solved from the 51% / 46% rows in the TTK table.
    bonuses: { accuracy: 28, power: 26 },
  }),
  gear({
    id: "cairnpine_shield", name: "Cairnpine Shield", tier: 10, slot: "offHand", value: 560,
    description: "Cairnpine faced in Kaldite. It rings when a wight hits it, and the wight stops.",
    requires: { melee: 10 },
    bonuses: { accuracy: 2, armour: 14, magicArmour: 6, vitality: 1 },
  }),
  gear({
    id: "kaldite_helm", name: "Kaldite Helm", tier: 10, slot: "head", value: 880,
    description: "A closed helm with a stone-cutter's brow ridge.",
    requires: { melee: 10 },
    bonuses: { accuracy: 2, armour: 9, magicArmour: 2, vitality: 2 },
  }),
  gear({
    id: "kaldite_plate", name: "Kaldite Plate", tier: 10, slot: "body", value: 1760,
    description: "Three bars of Kaldite. Quarry crews were buried in these, which is not a selling point.",
    requires: { melee: 10 },
    bonuses: { accuracy: 3, armour: 18, magicArmour: 4, vitality: 5 },
  }),
  gear({
    id: "kaldite_greaves", name: "Kaldite Greaves", tier: 10, slot: "legs", value: 1620,
    description: "Full leg plate, hinged at the knee.",
    requires: { melee: 10 },
    bonuses: { accuracy: 2, armour: 12, magicArmour: 3, vitality: 4 },
  }),
  gear({
    id: "kaldite_boots", name: "Kaldite Boots", tier: 10, slot: "feet", value: 600,
    description: "Cleated for wet cairn stone.",
    requires: { melee: 10 },
    bonuses: { accuracy: 1, armour: 3, magicArmour: 1, vitality: 2 },
  }),
  gear({
    id: "kaldite_gauntlets", name: "Kaldite Gauntlets", tier: 10, slot: "hands", value: 600,
    description: "Kaldite over the knuckle, garnet rivets. Loud.",
    requires: { melee: 10 },
    bonuses: { accuracy: 2, armour: 2, magicArmour: 1, vitality: 2 },
  }),
  gear({
    id: "kaldite_ring", name: "Kaldite Ring", tier: 10, slot: "accessory1", value: 780,
    description: "A heavy band, garnet-set. It has a quarry number filed into the inside.",
    requires: { melee: 10 },
    bonuses: { accuracy: 1 },
  }),
  gear({
    id: "kaldite_pendant", name: "Kaldite Pendant", tier: 10, slot: "accessory2", value: 840,
    description: "Cairn garnet in a Kaldite claw. Cold no matter how long you wear it.",
    requires: { melee: 10 },
    bonuses: { accuracy: 1, magicAccuracy: 2, magicArmour: 2 },
  }),
];

// ------------------------------------------------------------------------- the staff ladder
// THE STAFF LADDER IS A WOODCUTTING LADDER. The three rows below already are the "wood from better
// trees" progression the design asks for; there is no fourth staff to add, and the real gate on
// each one is the WOOD, not the `requires` field printed on the row. Written out here because the
// chain is otherwise only discoverable by cross-reading three files:
//
//   palewood_staff   Magic 1  <- 3 palewood_shaft  + 1 pale_quartz  <- palewood_log,  Woodcutting 1
//   duskoak_staff    Magic 5  <- 3 duskoak_shaft   + 1 vell_amber   <- duskoak_log,   Woodcutting 5
//   cairnpine_staff  Magic 10 <- 3 cairnpine_shaft + 1 cairn_garnet <- cairnpine_log, Woodcutting 10
//
// `content/recipes.ts` fletches each staff at the fletching bench out of its OWN wood's shafts
// (1 log -> 4 shafts, then 3 shafts + 1 tier gem -> 1 staff), and `content/regions.ts` puts the
// duskoak node at reqLevel 5 and the cairnpine node at reqLevel 10. So the Woodcutting gate is real
// and already enforced upstream, by the only source of the material. Copying it into `requires`
// would double-gate the player who buys logs instead of cutting them, which is a legal route.

// ------------------------------------------------------------------ magic, tier 1 (Marchhide)
// Kit totals: magicAccuracy 12, magicPower 6, armour 3, magicArmour 13, vitality 4.
// Emberlash at Magic 1 with the full kit: floor(3 + (1 + 6)/8) = 3, matching PRD 2.4's
// "maxHit at unlock" column.

const MAGIC_TIER_1: readonly ItemDef[] = [
  gear({
    id: "palewood_staff", name: "Palewood Staff", tier: 1, slot: "mainHand", value: 140,
    description: "A shaved palewood shaft with a quartz chip wedged in the split top.",
    requires: { magic: 1 }, attackSpeedMs: CAST_SPEED_MS,
    bonuses: STAFF_BONUSES[1],
  }),
  gear({
    id: "palewood_wand", name: "Palewood Wand", tier: 1, slot: "mainHand", value: 84,
    description: "A palewood shaft cut short around a pale quartz point. Quick to make, modest in a fight.",
    requires: { magic: 1 }, attackSpeedMs: CAST_SPEED_MS,
    bonuses: wandBonuses(1),
  }),
  gear({
    id: "quartz_focus", name: "Quartz Focus", tier: 1, slot: "offHand", value: 70,
    description: "Pale quartz on a thong. Held in the off hand, it keeps a cast from wandering.",
    requires: { magic: 1 },
    bonuses: { magicAccuracy: 1, magicPower: 1, magicArmour: 2 },
  }),
  gear({
    id: "marchhide_hood", name: "Marchhide Hood", tier: 1, slot: "head", value: 90,
    description: "Cured wolf hide, hood up against the march wind.",
    requires: { magic: 1 },
    bonuses: { magicAccuracy: 1, armour: 1, magicArmour: 2, vitality: 1 },
  }),
  gear({
    id: "marchhide_robe", name: "Marchhide Robe", tier: 1, slot: "body", value: 170,
    description: "Three hides stitched into something between a coat and a tent.",
    requires: { magic: 1 },
    bonuses: { magicAccuracy: 1, magicPower: 1, armour: 1, magicArmour: 3, vitality: 2 },
  }),
  gear({
    id: "marchhide_leggings", name: "Marchhide Leggings", tier: 1, slot: "legs", value: 150,
    description: "Hide leggings, laced at the calf.",
    requires: { magic: 1 },
    bonuses: { magicAccuracy: 1, armour: 1, magicArmour: 2, vitality: 1 },
  }),
  gear({
    id: "marchhide_boots", name: "Marchhide Boots", tier: 1, slot: "feet", value: 65,
    description: "Soft-soled. Quiet, which matters more than it sounds.",
    requires: { magic: 1 },
    bonuses: { magicArmour: 1 },
  }),
  gear({
    id: "marchhide_wraps", name: "Marchhide Wraps", tier: 1, slot: "hands", value: 65,
    description: "Hide strips wound to the knuckle, fingertips left bare.",
    requires: { magic: 1 },
    bonuses: { magicArmour: 1 },
  }),
  gear({
    id: "ember_ring", name: "Ember Ring", tier: 1, slot: "accessory1", value: 95,
    description: "Warm to the touch. Emberlash comes a little easier wearing it.",
    requires: { magic: 1 },
    bonuses: { magicAccuracy: 1 },
  }),
  gear({
    id: "ember_charm", name: "Ember Charm", tier: 1, slot: "accessory2", value: 105,
    description: "A quartz bead on a wire loop, scorched black at one end.",
    requires: { magic: 1 },
    bonuses: { magicAccuracy: 1, magicArmour: 1 },
  }),
];

// ------------------------------------------------------------------ magic, tier 5 (Bramblehide)
// Kit totals: magicAccuracy 24, magicPower 14, armour 4, magicArmour 28, vitality 10.
// Stonebrand at Magic 5 with the full kit: floor(5 + (5 + 14)/7) = 7.

const MAGIC_TIER_5: readonly ItemDef[] = [
  gear({
    id: "duskoak_staff", name: "Duskoak Staff", tier: 5, slot: "mainHand", value: 500,
    description: "Duskoak, banded in Corven, an amber the size of a thumb in the crown.",
    requires: { magic: 5 }, attackSpeedMs: CAST_SPEED_MS,
    bonuses: STAFF_BONUSES[5],
  }),
  gear({
    id: "duskoak_wand", name: "Duskoak Wand", tier: 5, slot: "mainHand", value: 300,
    description: "A dense duskoak wand capped with Vell amber. Easier to replace than a full staff.",
    requires: { magic: 5 }, attackSpeedMs: CAST_SPEED_MS,
    bonuses: wandBonuses(5),
  }),
  gear({
    id: "amber_focus", name: "Amber Focus", tier: 5, slot: "offHand", value: 240,
    description: "Vell amber in a duskoak cradle. Holds a Stonebrand steady through the whole cast.",
    requires: { magic: 5 },
    bonuses: { armour: 1, magicAccuracy: 3, magicPower: 2, magicArmour: 3, vitality: 1 },
  }),
  gear({
    id: "bramblehide_hood", name: "Bramblehide Hood", tier: 5, slot: "head", value: 300,
    description: "Deepwood hide, still faintly thorned along the seam.",
    requires: { magic: 5 },
    bonuses: { armour: 1, magicAccuracy: 2, magicPower: 1, magicArmour: 4, vitality: 2 },
  }),
  gear({
    id: "bramblehide_robe", name: "Bramblehide Robe", tier: 5, slot: "body", value: 600,
    description: "Heavy hide, waxed. Sheds a Thornbound's spores and most of the rain.",
    requires: { magic: 5 },
    bonuses: { armour: 1, magicAccuracy: 3, magicPower: 1, magicArmour: 8, vitality: 3 },
  }),
  gear({
    id: "bramblehide_leggings", name: "Bramblehide Leggings", tier: 5, slot: "legs", value: 540,
    description: "Long hide leggings cut for a full stride.",
    requires: { magic: 5 },
    bonuses: { armour: 1, magicAccuracy: 2, magicPower: 1, magicArmour: 5, vitality: 2 },
  }),
  gear({
    id: "bramblehide_boots", name: "Bramblehide Boots", tier: 5, slot: "feet", value: 220,
    description: "Laced to the knee against the root field.",
    requires: { magic: 5 },
    bonuses: { magicAccuracy: 1, magicArmour: 2, vitality: 1 },
  }),
  gear({
    id: "bramblehide_wraps", name: "Bramblehide Wraps", tier: 5, slot: "hands", value: 220,
    description: "Wrapped to the second knuckle. Casting hand stays free.",
    requires: { magic: 5 },
    bonuses: { magicArmour: 2, vitality: 1 },
  }),
  gear({
    id: "stone_ring", name: "Stone Ring", tier: 5, slot: "accessory1", value: 330,
    description: "A grey band that pulls slightly toward the ground.",
    requires: { magic: 5 },
    bonuses: { magicAccuracy: 1, magicArmour: 1 },
  }),
  gear({
    id: "stone_charm", name: "Stone Charm", tier: 5, slot: "accessory2", value: 360,
    description: "A pierced river stone. Stonebrand was worked out by someone holding one of these.",
    requires: { magic: 5 },
    bonuses: { magicArmour: 1 },
  }),
];

// ------------------------------------------------------------------ magic, tier 10 (Wightshroud)
// Kit totals: magicAccuracy 47, magicPower 32, armour 8, magicArmour 50, vitality 12.
// Both totals are solved from the Voltrend-vs-Cairnwight 24 s claim; see the header block.

const MAGIC_TIER_10: readonly ItemDef[] = [
  gear({
    id: "cairnpine_staff", name: "Cairnpine Staff", tier: 10, slot: "mainHand", value: 1180,
    description: "Cairnpine with a Kaldite ferrule and a cairn garnet caged at the head. Voltrend needs the cage.",
    requires: { magic: 10 }, attackSpeedMs: CAST_SPEED_MS,
    bonuses: STAFF_BONUSES[10],
  }),
  gear({
    id: "cairnpine_wand", name: "Cairnpine Wand", tier: 10, slot: "mainHand", value: 708,
    description: "A cairnpine wand with a garnet cage at the tip. It trades reach and power for a shorter build.",
    requires: { magic: 10 }, attackSpeedMs: CAST_SPEED_MS,
    bonuses: wandBonuses(10),
  }),
  gear({
    id: "garnet_focus", name: "Garnet Focus", tier: 10, slot: "offHand", value: 560,
    description: "Cairn garnet in a Kaldite ring. Cold enough to ache through a glove.",
    requires: { magic: 10 },
    bonuses: { armour: 2, magicAccuracy: 6, magicPower: 4, magicArmour: 6, vitality: 1 },
  }),
  gear({
    id: "wightshroud_hood", name: "Wightshroud Hood", tier: 10, slot: "head", value: 700,
    description: "Cut from a cairnwight's shroud. It does not take dye and it does not tear.",
    requires: { magic: 10 },
    bonuses: { armour: 1, magicAccuracy: 4, magicPower: 2, magicArmour: 8, vitality: 2 },
  }),
  gear({
    id: "wightshroud_robe", name: "Wightshroud Robe", tier: 10, slot: "body", value: 1400,
    description: "Three shrouds, stitched with Kaldite wire. Ordrun's floor is survivable in this.",
    requires: { magic: 10 },
    bonuses: { armour: 2, magicAccuracy: 6, magicPower: 3, magicArmour: 14, vitality: 4 },
  }),
  gear({
    id: "wightshroud_leggings", name: "Wightshroud Leggings", tier: 10, slot: "legs", value: 1260,
    description: "Shroud cloth to the ankle, weighted at the hem so it does not lift on the moor.",
    requires: { magic: 10 },
    bonuses: { armour: 1, magicAccuracy: 3, magicPower: 2, magicArmour: 9, vitality: 3 },
  }),
  gear({
    id: "wightshroud_boots", name: "Wightshroud Boots", tier: 10, slot: "feet", value: 500,
    description: "Silent on stone. The quarry crews would have hated them.",
    requires: { magic: 10 },
    bonuses: { armour: 1, magicAccuracy: 1, magicArmour: 3, vitality: 1 },
  }),
  gear({
    id: "wightshroud_wraps", name: "Wightshroud Wraps", tier: 10, slot: "hands", value: 500,
    description: "Shroud strips to the wrist. Garnet dust worked into the weave.",
    requires: { magic: 10 },
    bonuses: { armour: 1, magicAccuracy: 1, magicArmour: 3, vitality: 1 },
  }),
  gear({
    id: "storm_ring", name: "Storm Ring", tier: 10, slot: "accessory1", value: 780,
    description: "It ticks against other metal. Nobody in Highcairn will keep one in a drawer.",
    requires: { magic: 10 },
    bonuses: { magicAccuracy: 1, magicPower: 1, magicArmour: 1 },
  }),
  gear({
    id: "storm_charm", name: "Storm Charm", tier: 10, slot: "accessory2", value: 840,
    description: "A garnet split by lightning and re-caged. Voltrend's namesake.",
    requires: { magic: 10 },
    bonuses: { magicAccuracy: 1, magicArmour: 2 },
  }),
];

/**
 * Every equippable item: the tier-0 starter pair, then the melee line and the magic line at tiers
 * 1 / 5 / 10. The three wands bring the table to 62 rows.
 */
export const EQUIPMENT: readonly ItemDef[] = [
  ...STARTER_EQUIPMENT,
  ...MELEE_TIER_1, ...MELEE_TIER_5, ...MELEE_TIER_10,
  ...MAGIC_TIER_1, ...MAGIC_TIER_5, ...MAGIC_TIER_10,
];

/**
 * The canonical "kit" for a tier and style: exactly one item per slot, which is what the PRD's
 * derived-health and damage tables assume. Exported so a test can re-check the totals in the
 * header comment without re-deriving them by hand.
 */
export const KITS: Readonly<Record<string, readonly string[]>> = {
  melee_t1: [
    "grithe_sword", "palewood_shield", "grithe_helm", "grithe_cuirass", "grithe_greaves",
    "grithe_boots", "grithe_gloves", "grithe_ring", "grithe_pendant",
  ],
  melee_t5: [
    "corven_sword", "duskoak_shield", "corven_helm", "corven_plate", "corven_greaves",
    "corven_boots", "corven_gauntlets", "corven_ring", "corven_pendant",
  ],
  melee_t10: [
    "kaldite_sword", "cairnpine_shield", "kaldite_helm", "kaldite_plate", "kaldite_greaves",
    "kaldite_boots", "kaldite_gauntlets", "kaldite_ring", "kaldite_pendant",
  ],
  magic_t1: [
    "palewood_staff", "quartz_focus", "marchhide_hood", "marchhide_robe", "marchhide_leggings",
    "marchhide_boots", "marchhide_wraps", "ember_ring", "ember_charm",
  ],
  magic_t5: [
    "duskoak_staff", "amber_focus", "bramblehide_hood", "bramblehide_robe", "bramblehide_leggings",
    "bramblehide_boots", "bramblehide_wraps", "stone_ring", "stone_charm",
  ],
  magic_t10: [
    "cairnpine_staff", "garnet_focus", "wightshroud_hood", "wightshroud_robe", "wightshroud_leggings",
    "wightshroud_boots", "wightshroud_wraps", "storm_ring", "storm_charm",
  ],
};
