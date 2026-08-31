/**
 * Farming — persistent crops, per PRD 2.9.
 *
 *   empty -> raked -> growing (stage 1..n) -> ready -> harvested -> empty
 *
 * The one rule that shapes this whole file: **growth is wall-clock, not sim time.** A plot planted
 * before a reload keeps growing while the tab is closed, so every growth decision is made against
 * `FarmPlotState.stageStartedAtMs` (a wall-clock stamp in the save) and never against the sim
 * clock. The sim clock is only used for the three *actions* — raking, planting, and the 1.8 s
 * harvest tick — because those are things the player is standing there doing.
 *
 * | Crop tier | Farming req | Stages | Seconds/stage | Total | Yield | Harvest XP | Plant XP |
 * | 1  | 1  | 4 | 60  | 240 s | 3 to 6 | 10 | 2 |
 * | 5  | 5  | 5 | 120 | 600 s | 3 to 6 | 24 | 5 |
 * | 10 | 10 | 5 | 180 | 900 s | 2 to 5 | 35 | 7 |
 *
 * Harvesting deliberately reuses the gathering model rather than inventing a second one: it rolls
 * `gatherSuccessChance` on the same 1800 ms tick, so a Farming 10 player harvests a tier 10 crop at
 * exactly the rate a Mining 10 player works a tier 10 seam. The per-plot yield counter lives in
 * `state.world.nodes[plotId]`, which is the same field a mineable node uses — a plot is a resource
 * with a growth phase, and modelling it twice would be the mistake.
 */
import type {
  ActivitySummary, EntityId, ItemId, Result, SemanticEntity,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { ActivityState, FarmPlotState, GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import { GATHER_TICK_MS } from "../core/time.js";
import type { Rng, RngStreams } from "../core/rng.js";
import type { InteractionContext, InteractionDispatcher } from "../world/interactions.js";
import type { ActivityDriver, ActivityTickResult, EntityLookup, InventoryPort } from "./activity.js";
import type { ActivitySystem } from "./activity.js";
import { CONTINUE, awardXp, clamp01, progressToward, stopWith } from "./activity.js";
import type { GatheringSystem, NodeRuntime } from "./gathering.js";
import type { TickSystem } from "../app/loop.js";
import { content, gatherSuccessChance, gatherXp } from "../content/index.js";

/** Raking and planting both take 1.8 s, matching the gather tick. PRD 2.9. */
export const FARM_ACTION_MS = 1800;

/** PRD 2.9: raking gives a flat 3 Farming XP regardless of crop. */
export const RAKE_XP = 3;

/** Bound on catch-up harvest rolls in one tick. Same reasoning as gathering's. */
const MAX_CATCHUP_ROLLS = 4000;

/** Authored stage lengths for the Phase 1 tiers. Everything else interpolates. */
const STAGE_SECONDS: Readonly<Record<number, number>> = { 1: 60, 5: 120, 10: 180 };

export interface CropProfile {
  tier: number;
  stageCount: number;
  stageSeconds: number;
  /** Inclusive range of crops one ready plot produces. */
  yieldRange: readonly [number, number];
  plantXp: number;
  harvestXp: number;
}

/**
 * Everything about a crop, derived from its tier.
 *
 * Deriving rather than authoring keeps farming honest with the rest of the game: harvest XP is
 * literally `gatherXp(tier)`, and plant XP is a fifth of it, which reproduces the PRD's 2 / 5 / 7
 * exactly. A tier 20 crop added later needs no new table.
 */
export function cropProfile(tier: number): CropProfile {
  const harvestXp = gatherXp(tier);
  const min = Math.max(1, Math.round(3 - 0.1 * (tier - 1)));
  return {
    tier,
    stageCount: tier <= 1 ? 4 : 5,
    stageSeconds: STAGE_SECONDS[tier] ?? Math.round(48 + 13.2 * tier),
    yieldRange: [min, min + 3],
    plantXp: Math.round(harvestXp * 0.2),
    harvestXp,
  };
}

export interface FarmingDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  rng: RngStreams;
  entities: EntityLookup;
  inventory: InventoryPort;
  activity: ActivitySystem;
  dispatcher: InteractionDispatcher;
  /** Reused for `effectiveLevel`, so a rake/hoe tool bonus applies to harvesting too. */
  gathering: GatheringSystem;
  /** Wall clock. Injected so a test can drive growth without waiting ten minutes. */
  now?: () => number;
}

export class FarmingSystem implements TickSystem {
  readonly name = "farming";

  /**
   * PRD section 3 row 11 ("World: crop growth"), one slot after node respawn so the two world
   * passes have a defined order. The three farm *actions* run in the activity pass at row 6.
   */
  readonly order = 111;

  readonly driver: ActivityDriver;

  private readonly rng: Rng;
  private readonly now: () => number;

  /**
   * Wall-clock offset contributed by `__gameDebug.advanceGameTime`.
   *
   * That helper moves the sim clock only, so crops would ignore it and the farming acceptance
   * check would take fifteen real minutes. Detecting the sim jump here and folding it into the
   * wall clock keeps the fast-forward working without touching debug/ or app/, which this round
   * does not own.
   */
  private debugSkewMs = 0;
  private lastAtMs: number | null = null;

  /** Crops taken in the current harvest, for the summary's `completed`. Purely cosmetic. */
  private harvested = new Map<EntityId, number>();

  constructor(private readonly deps: FarmingDeps) {
    this.rng = deps.rng.get("gather");
    this.now = deps.now ?? (() => Date.now());

    this.driver = {
      kind: "farming",
      tick: (activity, state, deltaMs, atMs) => this.advance(activity, state, deltaMs, atMs),
      summary: (activity, state, atMs) => this.summarise(activity, state, atMs),
    };
    deps.activity.register(this.driver);

    deps.dispatcher.registerHandler("rake", (context) => this.beginRake(context));
    deps.dispatcher.registerHandler("plant", (context) => this.beginPlant(context));
    deps.dispatcher.registerHandler("harvest", (context) => this.beginHarvest(context));
  }

  /** Wall-clock now, including any debug fast-forward. */
  wallClockMs(): number {
    return this.now() + this.debugSkewMs;
  }

  // ------------------------------------------------------------ world tick

  /** Advances growth for every planted plot and keeps entity state mirroring plot state. */
  tick(deltaMs: number, atMs: number): void {
    this.trackDebugSkew(deltaMs, atMs);

    const state = this.deps.store.get();
    const wallNow = this.wallClockMs();
    let changed = false;

    for (const plot of Object.values(state.farming)) {
      const entity = this.deps.entities.get(plot.plotId);

      if (plot.state === "growing" && plot.cropId) {
        const profile = cropProfile(entity?.tier ?? 1);
        const stageMs = profile.stageSeconds * 1000;
        let guard = 0;
        while (
          plot.stage <= plot.stageCount
          && wallNow - plot.stageStartedAtMs >= stageMs
          && guard < 512
        ) {
          guard += 1;
          plot.stage += 1;
          plot.stageStartedAtMs += stageMs;
        }
        if (plot.stage > plot.stageCount) {
          plot.stage = plot.stageCount;
          plot.state = "ready";
          this.rollHarvestYield(state, plot, profile);
          this.deps.events.emit(
            "production.completed",
            { kind: "crop", cropId: plot.cropId, plotId: plot.plotId, tier: profile.tier },
            plot.plotId,
            atMs,
          );
          changed = true;
        }
      }

      // The entity is the view the dispatcher and the renderer read. Re-sync it every pass rather
      // than only on transition, so a restored save lines up on the first tick after boot.
      if (entity && entity.state !== plot.state) {
        entity.state = plot.state;
        changed = true;
      }
    }

    if (changed) this.deps.store.markDirty();
  }

  // ----------------------------------------------------------------- rake

  private beginRake(context: InteractionContext): Result<{ started: string }> {
    const state = this.deps.store.get();
    const atMs = this.deps.clock.elapsedMs;
    const entity = context.entity;
    const plot = this.plotState(state, entity);

    if (plot.state !== "empty") {
      return err("INVALID_ARGUMENT", `${entity.name} already has something in it.`, entity.id);
    }

    this.deps.activity.start(
      { kind: "farming", op: "rake", plotId: plot.plotId, endsAtMs: atMs + FARM_ACTION_MS },
      atMs,
      { op: "rake", durationMs: FARM_ACTION_MS, xp: RAKE_XP },
    );
    return ok({ started: `raking ${entity.name}` });
  }

  // ---------------------------------------------------------------- plant

  private beginPlant(context: InteractionContext): Result<{ started: string }> {
    const state = this.deps.store.get();
    const atMs = this.deps.clock.elapsedMs;
    const entity = context.entity;
    const plot = this.plotState(state, entity);

    if (plot.state !== "raked") {
      return err("INVALID_ARGUMENT", `${entity.name} has to be raked first.`, entity.id);
    }

    const seedId = this.findSeed(entity);
    if (!seedId) {
      const cropId = cropItemOf(entity);
      return err(
        "NOT_ENOUGH_ITEMS",
        cropId ? `You have no seeds for ${cropId}.` : "You have no seeds to plant.",
        entity.id,
      );
    }

    this.deps.activity.start(
      { kind: "farming", op: "plant", plotId: plot.plotId, endsAtMs: atMs + FARM_ACTION_MS },
      atMs,
      { op: "plant", durationMs: FARM_ACTION_MS, seedId },
    );
    return ok({ started: `planting ${seedId} in ${entity.name}` });
  }

  // -------------------------------------------------------------- harvest

  private beginHarvest(context: InteractionContext): Result<{ started: string }> {
    const state = this.deps.store.get();
    const atMs = this.deps.clock.elapsedMs;
    const entity = context.entity;
    const plot = this.plotState(state, entity);

    if (plot.state !== "ready" || !plot.cropId) {
      return err("INVALID_ARGUMENT", `${entity.name} is not ready to harvest.`, entity.id);
    }

    const profile = cropProfile(entity.tier);
    const node = this.plotNode(state, plot.plotId);
    if (node.remaining <= 0) this.rollHarvestYield(state, plot, profile);

    if (!this.deps.inventory.hasRoomFor(plot.cropId, 1)) {
      this.deps.events.emit("inventory.full", { itemId: plot.cropId }, entity.id, atMs);
      return err("INVENTORY_FULL", "Your inventory is full.", entity.id);
    }

    const running = state.activity;
    if (running && running.kind === "farming" && running.op === "harvest" && running.plotId === plot.plotId) {
      return ok({ started: `already harvesting ${entity.name}` });
    }

    this.harvested.set(plot.plotId, 0);
    this.deps.activity.start(
      { kind: "farming", op: "harvest", plotId: plot.plotId, endsAtMs: atMs + GATHER_TICK_MS },
      atMs,
      {
        op: "harvest",
        cropId: plot.cropId,
        remaining: node.remaining,
        tickMs: GATHER_TICK_MS,
        tier: profile.tier,
      },
    );
    return ok({ started: `harvesting ${entity.name}` });
  }

  // ------------------------------------------------------- activity driver

  private advance(
    activity: ActivityState,
    state: GameState,
    _deltaMs: number,
    atMs: number,
  ): ActivityTickResult {
    if (activity.kind !== "farming") return stopWith("cancelled");

    const entity = this.deps.entities.get(activity.plotId);
    const plot = state.farming[activity.plotId];
    if (!entity || !plot) return stopWith("gone");

    if (activity.op === "harvest") return this.advanceHarvest(activity, state, entity, plot, atMs);

    if (atMs < activity.endsAtMs) return CONTINUE;

    if (activity.op === "rake") {
      if (plot.state !== "empty") return stopWith("cancelled");
      plot.state = "raked";
      plot.cropId = null;
      plot.stage = 0;
      plot.stageCount = 0;
      plot.stageStartedAtMs = this.wallClockMs();
      entity.state = "raked";
      awardXp(state, this.deps.events, "farming", RAKE_XP, atMs);
      this.deps.store.markDirty();
      return stopWith("completed");
    }

    // plant
    if (plot.state !== "raked") return stopWith("cancelled");
    const seedId = this.findSeed(entity);
    if (!seedId) return stopWith("cancelled");

    const removed = this.deps.inventory.removeItem(seedId, 1);
    if (!removed.ok || removed.value <= 0) return stopWith("cancelled");
    this.deps.events.emit("item.lost", { itemId: seedId, quantity: 1, reason: "planted" }, entity.id, atMs);

    const cropId = content.item(seedId)?.seed?.cropId ?? cropItemOf(entity);
    if (!cropId) return stopWith("cancelled");

    const profile = cropProfile(entity.tier);
    plot.cropId = cropId;
    plot.stage = 1;
    plot.stageCount = profile.stageCount;
    plot.stageStartedAtMs = this.wallClockMs();
    plot.state = "growing";
    entity.state = "growing";

    awardXp(state, this.deps.events, "farming", profile.plantXp, atMs);
    this.deps.store.markDirty();
    return stopWith("completed");
  }

  private advanceHarvest(
    activity: Extract<ActivityState, { kind: "farming" }>,
    state: GameState,
    entity: SemanticEntity,
    plot: FarmPlotState,
    atMs: number,
  ): ActivityTickResult {
    if (plot.state !== "ready" || !plot.cropId) return stopWith("depleted");

    const profile = cropProfile(entity.tier);
    const node = this.plotNode(state, plot.plotId);
    if (node.remaining <= 0) return stopWith("depleted");

    const required = entity.requirements?.farming ?? 1;
    const cropId = plot.cropId;
    let rolls = 0;
    let gained = false;

    while (atMs >= activity.endsAtMs && rolls < MAX_CATCHUP_ROLLS) {
      rolls += 1;
      activity.endsAtMs += GATHER_TICK_MS;

      const level = this.deps.gathering.effectiveLevel(state, "farming");
      if (!this.rng.chance(gatherSuccessChance(level, required))) continue;

      if (!this.deps.inventory.hasRoomFor(cropId, 1)) {
        this.deps.events.emit("inventory.full", { itemId: cropId }, entity.id, atMs);
        return stopWith("inventory-full");
      }
      const added = this.deps.inventory.addItem(cropId, 1);
      if (!added.ok || added.value <= 0) {
        this.deps.events.emit("inventory.full", { itemId: cropId }, entity.id, atMs);
        return stopWith("inventory-full");
      }

      this.deps.events.emit(
        "item.received",
        { itemId: cropId, quantity: added.value, source: "harvest", skill: "farming" },
        entity.id,
        atMs,
      );
      awardXp(state, this.deps.events, "farming", profile.harvestXp, atMs);
      this.harvested.set(plot.plotId, (this.harvested.get(plot.plotId) ?? 0) + 1);

      node.remaining = Math.max(0, node.remaining - 1);
      gained = true;

      if (node.remaining <= 0) {
        this.clearPlot(state, entity, plot, atMs, cropId);
        return stopWith("depleted");
      }
    }

    if (gained) this.deps.store.markDirty();
    return CONTINUE;
  }

  private summarise(activity: ActivityState, state: GameState, atMs: number): ActivitySummary {
    if (activity.kind !== "farming") {
      return { kind: activity.kind, progress: 0, completed: 0, remaining: 0 };
    }
    if (activity.op === "harvest") {
      const node = state.world.nodes[activity.plotId];
      return {
        kind: "farming",
        skill: "farming",
        entityId: activity.plotId,
        progress: clamp01(1 - (activity.endsAtMs - atMs) / GATHER_TICK_MS),
        completed: this.harvested.get(activity.plotId) ?? 0,
        remaining: node?.remaining ?? 0,
      };
    }
    return {
      kind: "farming",
      skill: "farming",
      entityId: activity.plotId,
      progress: progressToward(atMs, activity.endsAtMs, FARM_ACTION_MS),
      completed: 0,
      remaining: 1,
    };
  }

  // -------------------------------------------------------------- internals

  /** The plot record, created on first touch. Also re-syncs the entity view from the save. */
  plotState(state: GameState, entity: SemanticEntity): FarmPlotState {
    const id = plotIdOf(entity);
    const existing = state.farming[id];
    if (existing) {
      entity.state = existing.state;
      return existing;
    }
    const created: FarmPlotState = {
      plotId: id,
      regionId: entity.regionId,
      cropId: null,
      stage: 0,
      stageCount: 0,
      stageStartedAtMs: this.wallClockMs(),
      state: "empty",
    };
    state.farming[id] = created;
    entity.state = "empty";
    return created;
  }

  /** The yield counter for a ready plot. Shares `world.nodes` with mineable nodes on purpose. */
  private plotNode(state: GameState, plotId: EntityId): NodeRuntime {
    const existing = state.world.nodes[plotId];
    if (existing) return existing;
    // Never "depleted": that state belongs to gathering's respawn pass, which would otherwise
    // re-roll a farm plot into an ore seam's worth of yields.
    const created: NodeRuntime = {
      remaining: 0,
      maxYields: 0,
      state: "available",
      respawnAtMs: null,
    };
    state.world.nodes[plotId] = created;
    return created;
  }

  private rollHarvestYield(state: GameState, plot: FarmPlotState, profile: CropProfile): void {
    const node = this.plotNode(state, plot.plotId);
    const [min, max] = profile.yieldRange;
    node.remaining = this.rng.int(min, max);
    node.maxYields = node.remaining;
    node.state = "available";
    node.respawnAtMs = null;
  }

  private clearPlot(
    state: GameState,
    entity: SemanticEntity,
    plot: FarmPlotState,
    atMs: number,
    cropId: ItemId,
  ): void {
    plot.state = "empty";
    plot.cropId = null;
    plot.stage = 0;
    plot.stageCount = 0;
    plot.stageStartedAtMs = this.wallClockMs();
    entity.state = "empty";

    const node = this.plotNode(state, plot.plotId);
    node.remaining = 0;
    node.maxYields = 0;
    node.state = "available";
    node.respawnAtMs = null;

    // The harvest tally is deliberately NOT cleared here: `ActivitySystem.stop` reads the summary
    // one call later, and a stop that reports "completed: 0" for a fully harvested plot is a lie.
    // It is reset when the next harvest starts.
    this.deps.events.emit(
      "resource.depleted",
      { itemId: cropId, plotId: plot.plotId, respawnSeconds: 0 },
      entity.id,
      atMs,
    );
    this.deps.store.markDirty();
  }

  /**
   * The seed to plant here.
   *
   * A plot is authored with the crop it grows (`meta.cropItemId`), so the matching seed wins. If
   * the player has none, any seed in the bag is accepted — a plot that refuses a seed the player
   * is holding, with no way to see why, is a worse experience than a plot that grows something
   * else.
   */
  private findSeed(entity: SemanticEntity): ItemId | undefined {
    const cropId = cropItemOf(entity);
    let fallback: ItemId | undefined;

    for (const item of content.allItems()) {
      const seed = item.seed;
      if (!seed) continue;
      if (this.deps.inventory.countItem(item.id) <= 0) continue;
      if (cropId && seed.cropId === cropId) return item.id;
      if (!fallback) fallback = item.id;
    }
    return fallback;
  }

  /** Folds a `__gameDebug.advanceGameTime` sim jump into the wall clock. */
  private trackDebugSkew(deltaMs: number, atMs: number): void {
    if (this.lastAtMs !== null) {
      const jump = atMs - this.lastAtMs - deltaMs;
      if (jump > 0) this.debugSkewMs += jump;
    }
    this.lastAtMs = atMs;
  }
}

// ----------------------------------------------------------------- helpers

function plotIdOf(entity: SemanticEntity): EntityId {
  const id = entity.meta?.plotId;
  return typeof id === "string" ? id : entity.id;
}

function cropItemOf(entity: SemanticEntity): ItemId | undefined {
  const cropId = entity.meta?.cropItemId;
  return typeof cropId === "string" ? cropId : undefined;
}
