import { describe, expect, it } from "vitest";
import { RECIPES } from "../game/src/content/recipes.js";

const BY_ID = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

describe("magic weapon recipes", () => {
  it.each([
    ["palewood", 24],
    ["duskoak", 58],
    ["cairnpine", 84],
  ] as const)("uses the approved 2.4 wand weight for %s", (wood, xp) => {
    const wand = BY_ID.get(`fletch_${wood}_wand`);
    expect(wand?.xp).toBe(xp);
    expect(wand?.durationMs).toBe(1_800);
    expect(wand?.inputs).toEqual([{ itemId: `${wood}_shaft`, quantity: 2 }]);
    expect(wand?.output).toEqual({ itemId: `${wood}_wand`, quantity: 1 });
  });

  it.each(["palewood", "duskoak", "cairnpine"] as const)(
    "keeps %s staff shaft-only and three-shaft",
    (wood) => {
      const staff = BY_ID.get(`fletch_${wood}_staff`);
      expect(staff?.durationMs).toBe(1_800);
      expect(staff?.inputs).toEqual([{ itemId: `${wood}_shaft`, quantity: 3 }]);
      expect(staff?.output).toEqual({ itemId: `${wood}_staff`, quantity: 1 });
    },
  );

  it.each([
    ["air", "palewood", 1],
    ["earth", "duskoak", 5],
    ["water", "cairnpine", 10],
  ] as const)("crafts the %s Orb into either matching weapon", (element, wood, level) => {
    for (const kind of ["wand", "staff"] as const) {
      const recipe = BY_ID.get(`craft_${element}_${kind}`);
      expect(recipe?.reqLevel).toBe(level);
      expect(recipe?.stations).toEqual(["crafting_table"]);
      expect(recipe?.inputs).toEqual([
        { itemId: `${wood}_${kind}`, quantity: 1 },
        { itemId: `${element}_orb`, quantity: 1 },
      ]);
      expect(recipe?.output).toEqual({ itemId: `${element}_${kind}`, quantity: 1 });
    }
  });

  it("lets the starter weapons be replaced through fletching", () => {
    expect(BY_ID.get("fletch_basic_wooden_wand")?.inputs).toEqual([
      { itemId: "palewood_shaft", quantity: 1 },
    ]);
    expect(BY_ID.get("fletch_basic_wooden_staff")?.inputs).toEqual([
      { itemId: "palewood_shaft", quantity: 2 },
    ]);
  });
});
