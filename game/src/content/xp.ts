/**
 * Corealm's XP curve. Original, exponential, ~10M XP at level 99.
 *
 *   totalXpAt(L) = floor(873 * 1.1^(L-1) - 873 + 6*L*(L-1))
 *
 * Closed form, so lookups are O(1) with no summation table. Verified checkpoints:
 * L2 = 99, L10 = 1,725, L50 = 106,992, L92 = 5,151,454, L99 = 9,999,879.
 *
 * Level 92 sits at 51.5% of the total, which is the pacing shape the genre trains players to expect.
 * The table is frozen by a unit test; a refactor must not silently move the curve.
 */

export const MAX_LEVEL = 99;

/** The twelve content tiers. Levels between tiers still improve things incrementally. */
export const TIERS: readonly number[] = [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99] as const;

const XP_TABLE: number[] = buildTable();

function buildTable(): number[] {
  const table: number[] = new Array(MAX_LEVEL + 1).fill(0);
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    table[level] = Math.floor(873 * Math.pow(1.1, level - 1) - 873 + 6 * level * (level - 1));
  }
  return table;
}

/** Total cumulative XP required to be exactly `level`. Level 1 is 0. */
export function totalXpAt(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return XP_TABLE[clamped]!;
}

/** The level a given cumulative XP total corresponds to. */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  let low = 1;
  let high = MAX_LEVEL;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (XP_TABLE[mid]! <= xp) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** XP still needed to reach the next level. Zero at 99. */
export function xpToNextLevel(xp: number): number {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return 0;
  return XP_TABLE[level + 1]! - xp;
}

/** Progress through the current level, 0..1. Returns 1 at 99. */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return 1;
  const floorXp = XP_TABLE[level]!;
  const ceilXp = XP_TABLE[level + 1]!;
  if (ceilXp === floorXp) return 1;
  return Math.max(0, Math.min(1, (xp - floorXp) / (ceilXp - floorXp)));
}

/** The whole table, for the generated documentation. */
export function xpTable(): readonly number[] {
  return XP_TABLE;
}

/** The highest content tier a level qualifies for. */
export function tierForLevel(level: number): number {
  let tier = TIERS[0]!;
  for (const candidate of TIERS) if (level >= candidate) tier = candidate;
  return tier;
}
