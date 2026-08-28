import { describe, expect, it } from "vitest";
import { MAX_LEVEL, levelForXp, levelProgress, tierForLevel, totalXpAt, xpToNextLevel } from "../game/src/content/xp.js";

describe("Corealm XP curve", () => {
  it("is frozen at the approved checkpoints", () => {
    expect(totalXpAt(1)).toBe(0);
    expect(totalXpAt(2)).toBe(99);
    expect(totalXpAt(10)).toBe(1_725);
    expect(totalXpAt(50)).toBe(106_992);
    expect(totalXpAt(92)).toBe(5_151_454);
    expect(totalXpAt(99)).toBe(9_999_879);
  });

  it("totals roughly ten million at 99", () => {
    expect(Math.abs(totalXpAt(99) - 10_000_000)).toBeLessThan(1_000);
  });

  it("increases strictly at every level", () => {
    for (let level = 2; level <= MAX_LEVEL; level += 1) {
      expect(totalXpAt(level)).toBeGreaterThan(totalXpAt(level - 1));
    }
  });

  it("round-trips xp back to the same level", () => {
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
      expect(levelForXp(totalXpAt(level))).toBe(level);
      if (level < MAX_LEVEL) expect(levelForXp(totalXpAt(level + 1) - 1)).toBe(level);
    }
  });

  it("clamps outside the table", () => {
    expect(levelForXp(-5)).toBe(1);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(50_000_000)).toBe(MAX_LEVEL);
    expect(totalXpAt(0)).toBe(0);
    expect(totalXpAt(500)).toBe(totalXpAt(MAX_LEVEL));
  });

  it("reports the remaining xp to the next level", () => {
    expect(xpToNextLevel(0)).toBe(99);
    expect(xpToNextLevel(99)).toBe(totalXpAt(3) - 99);
    expect(xpToNextLevel(totalXpAt(MAX_LEVEL))).toBe(0);
  });

  it("reports progress through the current level", () => {
    expect(levelProgress(totalXpAt(5))).toBe(0);
    expect(levelProgress(totalXpAt(MAX_LEVEL))).toBe(1);
    const midway = (totalXpAt(5) + totalXpAt(6)) / 2;
    expect(levelProgress(midway)).toBeCloseTo(0.5, 5);
  });

  it("maps levels onto content tiers", () => {
    expect(tierForLevel(1)).toBe(1);
    expect(tierForLevel(4)).toBe(1);
    expect(tierForLevel(5)).toBe(5);
    expect(tierForLevel(19)).toBe(10);
    expect(tierForLevel(99)).toBe(99);
  });
});
