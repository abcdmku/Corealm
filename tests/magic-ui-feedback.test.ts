import { describe, expect, it } from "vitest";
import type { EquippedMagicWeaponView, GameEvent } from "../game/src/contracts.js";
import { formatWeaponCharge } from "../game/src/ui/equipmentPanel.js";
import { describeEssenceRecharge, eventChangesWeaponCharge } from "../game/src/ui/hud.js";
import { formatWeaponChargeLine, liveWeaponChargeFor } from "../game/src/ui/tooltips.js";

const AIR_WAND: EquippedMagicWeaponView = {
  itemId: "air_wand",
  name: "Air Wand",
  element: "wind",
  charges: 999,
  capacity: 1_000,
  rechargeItemId: "air_essence",
  rechargeCost: 100,
};

describe("magic charge UI", () => {
  it("prints current and maximum charge on the equipped weapon", () => {
    expect(formatWeaponCharge(999, 1_000)).toBe("999 / 1,000");
    expect(formatWeaponCharge(0, 1_000)).toBe("0 / 1,000");
  });

  it("uses the equipped weapon ledger value in its tooltip", () => {
    expect(liveWeaponChargeFor("air_wand", AIR_WAND)).toBe(999);
    expect(formatWeaponChargeLine("wind", 1_000, 999))
      .toBe("Air weapon · 999 / 1,000 charges remaining.");
    expect(liveWeaponChargeFor("earth_wand", AIR_WAND)).toBeNull();
  });

  it("turns a recharge event into a complete receipt", () => {
    const data: GameEvent["data"] = {
      altarId: "coldbrace_essence_altar",
      weaponItemId: "air_wand",
      element: "wind",
      before: 243,
      after: 1_000,
      essenceItemId: "air_essence",
      essenceSpent: 100,
    };
    expect(describeEssenceRecharge(data))
      .toBe("Air Wand recharged to 1,000 charges. Spent 100 Air Essence.");
  });

  it("refreshes charge UI for casts and recharges", () => {
    const event = (type: GameEvent["type"]): GameEvent => ({ seq: 1, type, atMs: 0, data: {} });
    expect(eventChangesWeaponCharge(event("spell.launched"))).toBe(true);
    expect(eventChangesWeaponCharge(event("essence.recharged"))).toBe(true);
    expect(eventChangesWeaponCharge(event("item.received"))).toBe(false);
  });
});
