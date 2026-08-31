/**
 * Deferred food consumption.
 *
 * Inventory validates a use request and owns the item/heal transaction. This driver owns the
 * 1.8-second activity deadline, so every interruption before completion is lossless and combat
 * cannot be entered during the timer to bypass the no-eating-while-attacking rule.
 */
import type { ActivitySummary, ItemId, Result } from "../contracts.js";
import type { ActivityState, GameState, Store } from "../state/store.js";
import type { ActivityDriver, ActivityTickResult } from "./activity.js";
import { CONTINUE, progressToward, stopWith } from "./activity.js";
import { EAT_DURATION_MS } from "./inventory.js";

export interface EatingInventoryPort {
  completeEating(itemId: ItemId, atMs: number): Result<{ restored: number; effect: string }>;
}

export interface EatingActivityPort {
  register(driver: ActivityDriver): void;
  start(activity: ActivityState, atMs: number, extra?: Record<string, unknown>): void;
  isBusy(): boolean;
  noteStopData(data: Record<string, unknown>): void;
}

export interface EatingDeps {
  store: Store;
  inventory: EatingInventoryPort;
  activity: EatingActivityPort;
}

export class EatingSystem {
  readonly driver: ActivityDriver;

  constructor(private readonly deps: EatingDeps) {
    this.driver = {
      kind: "eating",
      tick: (activity, state, deltaMs, atMs) => this.advance(activity, state, deltaMs, atMs),
      summary: (activity, state, atMs) => this.summarise(activity, state, atMs),
      onStop: (_activity, _state, _reason, _atMs) => {
        // Consumption happens only in `completeEating`, never during cleanup.
      },
    };
    deps.activity.register(this.driver);
  }

  /** Late-bound callback passed to `InventorySystem`, avoiding a construction-order cycle at boot. */
  beginEating(itemId: ItemId, durationMs: number, atMs: number): boolean {
    const state = this.deps.store.get();
    if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
    if (state.player.health <= 0 || state.combat.targetId !== null || this.deps.activity.isBusy()) {
      return false;
    }

    this.deps.activity.start(
      { kind: "eating", itemId, endsAtMs: atMs + durationMs },
      atMs,
      { itemId, durationMs },
    );
    return true;
  }

  private advance(
    activity: ActivityState,
    state: GameState,
    _deltaMs: number,
    atMs: number,
  ): ActivityTickResult {
    if (activity.kind !== "eating") return stopWith("failed");

    // Combat may be targeted after the timer starts. End without consuming instead of letting a
    // queued attack and a heal resolve together.
    if (state.combat.targetId !== null) return stopWith("failed");
    if (atMs < activity.endsAtMs) return CONTINUE;

    const completed = this.deps.inventory.completeEating(activity.itemId, atMs);
    if (!completed.ok) return stopWith(completed.error.code === "DEAD" ? "dead" : "failed");

    this.deps.activity.noteStopData({
      completed: 1,
      remaining: 0,
      itemId: activity.itemId,
      restored: completed.value.restored,
      effect: completed.value.effect,
    });
    return stopWith("completed");
  }

  private summarise(activity: ActivityState, _state: GameState, atMs: number): ActivitySummary {
    if (activity.kind !== "eating") {
      return { kind: "eating", progress: 0, completed: 0, remaining: 0 };
    }
    return {
      kind: "eating",
      progress: progressToward(atMs, activity.endsAtMs, EAT_DURATION_MS),
      completed: 0,
      remaining: 1,
    };
  }
}
