import { describe, expect, it } from "vitest";
import { describeNavigationFailure } from "../game/src/ui/hud.js";

describe("HUD navigation failure notices", () => {
  it.each(["cancelled", "movement-disabled"])("stays quiet for %s navigation", (reason) => {
    expect(describeNavigationFailure({ reason })).toBeNull();
  });

  it("keeps the error notice for an unreachable destination", () => {
    expect(describeNavigationFailure({ reason: "unreachable" })).toEqual({
      text: "There is no route to that place.",
      tone: "error",
    });
  });
});
