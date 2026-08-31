import { describe, expect, it } from "vitest";
import type { GameState } from "../game/src/state/store.js";
import type { SemanticEntity } from "../game/src/contracts.js";
import { rehydrateEnemyRuntimes } from "../game/src/persistence/worldContainers.js";

/**
 * A reload must not resurrect what the save says is dead.
 *
 * `GameState.world.enemies` survives a reload verbatim while `buildSemanticWorld` rebuilds every
 * enemy entity alive at its spawn. Before this reconciliation existed, a monster killed inside
 * the 30 s respawn window before a refresh came back as a ghost: visibly alive, click-attackable
 * enough to latch a target, and silently un-hittable until its persisted respawn timer fired —
 * the exact "sometimes you can't attack a monster, it eventually attacks after like 30 seconds"
 * report.
 */
function enemy(id: string, health: number, maxHealth = health): SemanticEntity {
  return {
    id,
    archetype: "enemy",
    name: id,
    tier: 1,
    regionId: "fallowmarch",
    position: [0, 0, 0],
    state: "alive",
    interactions: ["inspect", "attack"],
    combat: { health, maxHealth, level: 3, aggroRadius: 5 },
    view: { assetId: "animal_chicken" },
  };
}

function stateWith(enemies: GameState["world"]["enemies"]): GameState {
  return { world: { enemies } } as GameState;
}

describe("enemy runtime rehydration", () => {
  it("turns a dead runtime into a corpse on the NEW clock, not a living ghost", () => {
    const ghost = enemy("marchfield_hens_1", 4);
    const state = stateWith({
      marchfield_hens_1: {
        health: 0, state: "dead", spawnPos: [0, 0, 0], respawnAtMs: 90_000, diedAtMs: 60_000,
      },
    });
    const result = rehydrateEnemyRuntimes(
      state,
      { all: () => [ghost], add: () => undefined, remove: () => false },
      0,
    );
    expect(result.deadApplied).toBe(1);
    expect(ghost.state).toBe("dead");
    // The saved instants are LAST session's sim clock, which restarts at zero every boot — kept
    // as-is, a twenty-minute session's respawnAtMs sits twenty minutes into the new clock's
    // future and the ghost outlives every reload. The window restarts instead: the corpse
    // dissolves from boot and the respawn timer runs one full interval on the new clock.
    expect(ghost.view?.diedAtMs).toBe(0);
    expect(state.world.enemies["marchfield_hens_1"]?.diedAtMs).toBe(0);
    expect(state.world.enemies["marchfield_hens_1"]?.respawnAtMs).toBe(30_000);
  });

  it("gives a boss its longer respawn window back", () => {
    const boss = enemy("ordrun", 200);
    (boss as { archetype: string }).archetype = "boss";
    const state = stateWith({
      ordrun: { health: 0, state: "dead", spawnPos: [0, 0, 0], respawnAtMs: 5, diedAtMs: 1 },
    });
    rehydrateEnemyRuntimes(
      state,
      { all: () => [boss], add: () => undefined, remove: () => false },
      1_000,
    );
    expect(state.world.enemies["ordrun"]?.respawnAtMs).toBe(1_000 + 180_000);
  });

  it("keeps a damaged runtime's health honest on the fresh entity", () => {
    const wounded = enemy("redsill_cattle_1", 16);
    const result = rehydrateEnemyRuntimes(
      stateWith({
        redsill_cattle_1: { health: 7, state: "idle", spawnPos: [0, 0, 0], respawnAtMs: null },
      }),
      { all: () => [wounded], add: () => undefined, remove: () => false },
    );
    expect(result.healthApplied).toBe(1);
    expect(wounded.combat?.health).toBe(7);
    expect(wounded.state).toBe("alive");
  });

  it("leaves enemies without a saved runtime untouched", () => {
    const untouched = enemy("open_march_goats_1", 12);
    const result = rehydrateEnemyRuntimes(
      stateWith({}),
      { all: () => [untouched], add: () => undefined, remove: () => false },
    );
    expect(result.deadApplied).toBe(0);
    expect(result.healthApplied).toBe(0);
    expect(untouched.state).toBe("alive");
    expect(untouched.combat?.health).toBe(12);
  });

  it("survives a dead runtime with no recorded death instant", () => {
    // Old saves predate `diedAtMs`; the death instant is restarted on the new clock either way.
    const legacy = enemy("palewood_adders_1", 9);
    rehydrateEnemyRuntimes(
      stateWith({
        palewood_adders_1: { health: 0, state: "dead", spawnPos: [0, 0, 0], respawnAtMs: 30_000 },
      }),
      { all: () => [legacy], add: () => undefined, remove: () => false },
      500,
    );
    expect(legacy.state).toBe("dead");
    expect(legacy.view?.diedAtMs).toBe(500);
  });
});
