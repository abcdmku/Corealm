/**
 * Scratch: solve and check the new enemy stat blocks against the PRD's own combat formulas.
 *
 * Reference attack rolls are the ones already reproduced in content/enemies.ts's header, so a
 * number that matches here matches the PRD rows the existing five families were solved from.
 */
import { ENEMY_BLOCKS } from "../../../game/src/content/enemies.js";

const atk = (level: number, acc: number, style = 1) => (level + 9) * (1 + acc / 100) * style;
const def = (level: number, armour: number) => (level + 9) * (1 + armour / 100);
const hit = (a: number, d: number) => Math.min(0.95, Math.max(0.05, a / (a + d)));
const dps = (chance: number, maxHit: number, speedMs: number) =>
  (chance * (1 + Math.max(1, maxHit)) / 2) / (speedMs / 1000);

interface Fighter {
  label: string; attackRoll: number; maxHit: number; speedMs: number;
  meleeLevel: number; armour: number; magicLevel: number; magicArmour: number; health: number;
}

const FIGHTERS: Fighter[] = [
  // Melee 1 in the starter kit the wave just shipped: worn shortsword, accuracy 3, power 3.
  { label: "M1 worn sword", attackRoll: atk(1, 3), maxHit: Math.floor(2 + (1 + 3) / 4.2), speedMs: 2400,
    meleeLevel: 1, armour: 0, magicLevel: 1, magicArmour: 0, health: 23 },
  // PRD 2.4 row: Melee 3, Grithe dagger.
  { label: "M3 grithe dagger", attackRoll: 12.72, maxHit: 4, speedMs: 2400,
    meleeLevel: 3, armour: 0, magicLevel: 1, magicArmour: 0, health: 26 },
  // PRD 2.4 row: Melee 7, Corven sword.
  { label: "M7 corven sword", attackRoll: 18.24, maxHit: 7, speedMs: 2400,
    meleeLevel: 7, armour: 26, magicLevel: 1, magicArmour: 26, health: 32 },
  // PRD 2.4 row: Melee 12, Kaldite sword.
  { label: "M12 kaldite sword", attackRoll: 26.88, maxHit: 11, speedMs: 2400,
    meleeLevel: 12, armour: 42, magicLevel: 1, magicArmour: 40, health: 41 },
  // PRD 2.4 row: Melee 18 in the full tier 10 kit.
  { label: "M18 tier10 kit", attackRoll: 38.34, maxHit: 12, speedMs: 2400,
    meleeLevel: 18, armour: 62, magicLevel: 10, magicArmour: 40, health: 75 },
];

/** Voltrend at Magic 10 in the full tier 10 magic kit, exactly as the enemies.ts header solves it. */
const CASTER = { label: "Voltrend M10 t10", attackRoll: 32.12, maxHit: 15, speedMs: 3000 };

const rows = [...ENEMY_BLOCKS].sort((a, b) => a.tier - b.tier || a.family.localeCompare(b.family));
for (const e of rows) {
  console.log(`\n${e.id}  ${e.name}  tier ${e.tier}  hp ${e.maxHealth}  ${e.behaviour} aggro ${e.aggroRadius}m`);
  const magicChance = hit(CASTER.attackRoll, def(e.defenceLevel, e.magicArmour));
  const magicTtk = e.maxHealth / dps(magicChance, CASTER.maxHit, CASTER.speedMs);
  for (const f of FIGHTERS) {
    const chance = hit(f.attackRoll, def(e.defenceLevel, e.armour));
    const ttk = e.maxHealth / dps(chance, f.maxHit, f.speedMs);
    const back = dps(hit(atk(e.attackLevel, e.accuracy), def(f.meleeLevel, f.armour)), e.maxHit, e.attackSpeedMs);
    console.log(
      `  vs ${f.label.padEnd(18)} hit ${(chance * 100).toFixed(1).padStart(5)}%  ttk ${ttk.toFixed(1).padStart(6)}s` +
      `  takes ${(back * ttk).toFixed(1).padStart(6)} of ${f.health} hp  (${back.toFixed(3)} dmg/s)`);
  }
  console.log(`  vs ${CASTER.label.padEnd(18)} hit ${(magicChance * 100).toFixed(1).padStart(5)}%  ttk ${magicTtk.toFixed(1).padStart(6)}s`);
}
