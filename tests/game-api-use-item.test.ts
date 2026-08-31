import { describe, expect, it, vi } from "vitest";
import { CorealmGameApi } from "../game/src/api/gameApi.js";
import { ok } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";

content.register({ items: ALL_ITEMS });

function seedHarness() {
  const plot = {
    id: "marchfield_plot_1",
    name: "Marchfield Plot",
    archetype: "farm_plot",
    regionId: "fallowmarch",
    position: [0, 0, 0],
    state: "raked",
    interactions: ["rake", "plant", "harvest"],
    meta: { plotId: "marchfield_plot_1", cropItemId: "bittergrain" },
  };
  const state = { player: { health: 10, position: [0, 0, 0] } };
  const inventoryUse = vi.fn(() => ok({ effect: "inventory fallback" }));
  const run = vi.fn(() => ok({ started: "planting bittergrain_seed in Marchfield Plot" }));
  const api = new CorealmGameApi(
    { get: () => state, markDirty: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    { elapsedMs: 0 } as never,
  );
  api.register("inventory", {
    slots: () => [
      { slotIndex: 0, itemId: "bittergrain_seed", quantity: 1 },
      { slotIndex: 1, itemId: "duskberry_seed", quantity: 1 },
    ],
    freeSlots: () => 26,
    use: inventoryUse,
  });
  api.register("entities", {
    get: (id) => id === plot.id ? plot as never : undefined,
    all: () => [plot as never],
    observe: () => [],
  });
  api.register("interactions", { run, rangeFor: () => 2.2 });
  return { api, inventoryUse, plot, run };
}

describe("CorealmGameApi targeted seed use", () => {
  it("routes a matching carried seed through the production planting interaction", () => {
    const { api, inventoryUse, plot, run } = seedHarness();

    expect(api.useItem("bittergrain_seed", { entityId: plot.id })).toEqual(ok({
      effect: "planting bittergrain_seed in Marchfield Plot",
    }));
    expect(run).toHaveBeenCalledWith(plot.id, "plant");
    expect(inventoryUse).not.toHaveBeenCalled();
  });

  it("rejects a seed whose crop does not match the target plot", () => {
    const { api, plot, run } = seedHarness();

    const result = api.useItem("duskberry_seed", { entityId: plot.id });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(run).not.toHaveBeenCalled();
  });
});
