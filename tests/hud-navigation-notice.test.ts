import { describe, expect, it } from "vitest";
import { UNREACHABLE_DESTINATION_MESSAGE } from "../game/src/api/gameApi.js";
import { describeNavigationFailure, ignoresRepeatedNotice } from "../game/src/ui/hud.js";

describe("HUD navigation failure notices", () => {
  it.each(["cancelled", "movement-disabled"])("stays quiet for %s navigation", (reason) => {
    expect(describeNavigationFailure({ reason })).toBeNull();
  });

  it("keeps the error notice for an unreachable destination", () => {
    expect(describeNavigationFailure({ reason: "unreachable" })).toEqual({
      text: UNREACHABLE_DESTINATION_MESSAGE,
      tone: "error",
    });
  });

  it("does not count or wake the log for the same route failure again", () => {
    expect(ignoresRepeatedNotice(UNREACHABLE_DESTINATION_MESSAGE)).toBe(true);
    expect(ignoresRepeatedNotice("Your inventory is full.")).toBe(false);
  });
});
