/**
 * Agility shortcuts.
 *
 * Per architecture correction R2, an obstacle is **not** a navmesh off-mesh link. Traversal is a
 * gameplay step, and it is exactly three things:
 *
 *   1. be at the entrance (the dispatcher already enforced range),
 *   2. play out `obstacle.durationMs` as a `traversing` activity,
 *   3. get placed at `obstacle.exitPosition`, snapped back onto the navmesh.
 *
 *   agilityXp(tier)   = round(10 * tier ^ 0.55 * 1.8)
 *   successChance     = clamp(0.60 + 0.02 * (agilityLevel - obstacle.reqLevel), 0.50, 1.00)
 *   onFail            = randomInt(2, 6) damage, no XP, player stays at the entrance
 *
 * `systems/movement.ts` walks the *planned route* version of the same thing: `startRoute` turns a
 * shortcut leg into its own timed traversal and emits its own `activity.started` / `activity.stopped`
 * pair. That path is for `moveTo({ locationId })`; this one is for a direct `climb` / `vault`
 * interaction. They stay out of each other's way because movement's route traversal never touches
 * `state.activity`, and this system refuses to start while the player is moving.
 *
 * The failure placement is the entrance, not a `failPoint`: the frozen `SemanticEntity.obstacle`
 * shape has no such field, and inventing one would be a contract change.
 */
import type { ActivitySummary, Result, SemanticEntity, Vec3 } from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { ActivityState, GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { Rng, RngStreams } from "../core/rng.js";
import type { InteractionContext, InteractionDispatcher } from "../world/interactions.js";
import type { ActivityDriver, ActivityTickResult, EntityLookup } from "./activity.js";
import type { ActivitySystem } from "./activity.js";
import { CONTINUE, awardXp, progressToward, stopWith } from "./activity.js";
import type { TickSystem } from "../app/loop.js";
import { agilitySuccessChance, agilityXp } from "../content/index.js";

/** PRD 2.8: a botched climb costs 2 to 6 health. */
const FAIL_DAMAGE_RANGE: readonly [number, number] = [2, 6];

/** Fallback when an obstacle omits `durationMs`. PRD 2.8 puts traversals between 2.0 s and 4.0 s. */
const DEFAULT_DURATION_MS = 3000;

/** The navmesh snap this system needs. Injected so agility never imports the navigation system. */
export interface NavSnap {
  closestPoint(point: Vec3): Vec3 | null;
}

export interface AgilityDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  rng: RngStreams;
  entities: EntityLookup;
  activity: ActivitySystem;
  dispatcher: InteractionDispatcher;
  nav: NavSnap;
}

export class AgilitySystem implements TickSystem {
  readonly name = "agility";

  /**
   * PRD section 3 row 6 ("Activity"), just after the spine at 60.
   *
   * The traversal itself is advanced by `ActivitySystem` through `this.driver`, so this system's
   * own tick has nothing to do. It still implements `TickSystem` so the root registers all four
   * round-2 systems the same way instead of special-casing one of them.
   */
  readonly order = 65;

  readonly driver: ActivityDriver;

  private readonly rng: Rng;

  constructor(private readonly deps: AgilityDeps) {
    // "misc", not "gather": an agility roll must never shift the gather sequence, or the Mining
    // 1-to-10 timing stops being reproducible from a seed.
    this.rng = deps.rng.get("misc");

    this.driver = {
      kind: "traversing",
      tick: (activity, state, deltaMs, atMs) => this.advance(activity, state, deltaMs, atMs),
      summary: (activity, state, atMs) => this.summarise(activity, state, atMs),
    };
    deps.activity.register(this.driver);

    for (const interaction of ["climb", "vault"] as const) {
      deps.dispatcher.registerHandler(interaction, (context) => this.begin(context));
    }
  }

  /** Nothing to do: `ActivitySystem` drives the traversal. See the `order` comment. */
  tick(_deltaMs: number, _atMs: number): void {
    // intentionally empty
  }

  // ------------------------------------------------------------------ start

  private begin(context: InteractionContext): Result<{ started: string }> {
    const state = this.deps.store.get();
    const atMs = this.deps.clock.elapsedMs;
    const entity = context.entity;

    const obstacle = entity.obstacle;
    if (!obstacle) {
      return err("INVALID_ARGUMENT", `${entity.name} is not an obstacle.`, entity.id);
    }

    // Base requirement, checked again here for the same reason gathering re-checks its own: this
    // is the file that owns the rule, and the dispatcher is a general gate.
    if (state.skills.agility.level < obstacle.reqLevel) {
      return err(
        "REQUIREMENTS_NOT_MET",
        `${entity.name} needs Agility ${obstacle.reqLevel}.`,
        entity.id,
      );
    }

    if (state.player.movement.mode !== "idle") {
      return err("BUSY", "Stop moving before you take the shortcut.", entity.id);
    }

    const running = state.activity;
    if (running && running.kind === "traversing") {
      return running.obstacleId === entity.id
        ? ok({ started: `already on ${entity.name}` })
        : err("BUSY", "You are already on an obstacle.", entity.id);
    }

    const durationMs = obstacle.durationMs > 0 ? obstacle.durationMs : DEFAULT_DURATION_MS;
    const chance = agilitySuccessChance(state.skills.agility.level, obstacle.reqLevel);

    this.deps.activity.start(
      { kind: "traversing", obstacleId: entity.id, endsAtMs: atMs + durationMs },
      atMs,
      {
        op: context.interaction,
        durationMs,
        reqLevel: obstacle.reqLevel,
        savesMeters: obstacle.savesMeters,
        successChance: Math.round(chance * 1000) / 1000,
        xp: agilityXp(entity.tier),
      },
    );

    return ok({ started: `${context.interaction} ${entity.name}` });
  }

  // ------------------------------------------------------- activity driver

  private advance(
    activity: ActivityState,
    state: GameState,
    _deltaMs: number,
    atMs: number,
  ): ActivityTickResult {
    if (activity.kind !== "traversing") return stopWith("cancelled");
    if (atMs < activity.endsAtMs) return CONTINUE;

    const entity = this.deps.entities.get(activity.obstacleId);
    const obstacle = entity?.obstacle;
    if (!entity || !obstacle) return stopWith("gone");

    const chance = agilitySuccessChance(state.skills.agility.level, obstacle.reqLevel);
    const succeeded = this.rng.chance(chance);

    if (!succeeded) {
      const damage = this.rng.int(FAIL_DAMAGE_RANGE[0], FAIL_DAMAGE_RANGE[1]);
      state.player.health = Math.max(0, state.player.health - damage);
      this.deps.store.markDirty();
      // Rides out on the spine's single `activity.stopped` rather than a second, near-identical
      // event of its own. Damage is the number a player or an agent actually reacts to.
      this.deps.activity.noteStopData({ damage, xp: 0, health: state.player.health });
      return stopWith("failed");
    }

    const landing = this.deps.nav.closestPoint(obstacle.exitPosition) ?? obstacle.exitPosition;
    state.player.position = [landing[0], landing[1], landing[2]];
    state.player.movement.mode = "idle";
    state.player.movement.path = null;
    state.player.movement.pathIndex = 0;
    state.player.movement.destination = null;
    state.player.movement.destinationEntityId = null;

    state.world.obstaclesUsed[entity.id] = (state.world.obstaclesUsed[entity.id] ?? 0) + 1;
    const xp = agilityXp(entity.tier);
    awardXp(state, this.deps.events, "agility", xp, atMs);
    this.deps.store.markDirty();

    this.deps.activity.noteStopData({ xp, damage: 0, exitPosition: state.player.position });
    return stopWith("completed");
  }

  private summarise(activity: ActivityState, state: GameState, atMs: number): ActivitySummary {
    if (activity.kind !== "traversing") {
      return { kind: activity.kind, progress: 0, completed: 0, remaining: 0 };
    }
    const entity = this.deps.entities.get(activity.obstacleId);
    const durationMs = durationOf(entity);
    return {
      kind: "traversing",
      skill: "agility",
      entityId: activity.obstacleId,
      progress: progressToward(atMs, activity.endsAtMs, durationMs),
      completed: state.world.obstaclesUsed[activity.obstacleId] ?? 0,
      remaining: 1,
    };
  }
}

function durationOf(entity: SemanticEntity | undefined): number {
  const durationMs = entity?.obstacle?.durationMs;
  return durationMs && durationMs > 0 ? durationMs : DEFAULT_DURATION_MS;
}
