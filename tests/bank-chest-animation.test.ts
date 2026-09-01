import { describe, expect, it } from "vitest";

import { ownClipCandidates } from "../game/src/render/entityViews.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";

describe("bank chest resting state", () => {
  it("holds the closed pose instead of looping the close transition", () => {
    const clips = ["Chest_Close", "Chest_Closed", "Chest_Open", "Chest_Opened"];

    expect(ownClipCandidates(clips, "idle")[0]).toBe("Chest_Closed");
  });

  it("authors every bank as closed", () => {
    const banks = buildWorld(1337, () => 0).entities.filter((entity) => entity.archetype === "bank");

    expect(banks.length).toBeGreaterThan(0);
    expect(banks.every((bank) => bank.state === "closed")).toBe(true);
  });
});
