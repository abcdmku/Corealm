/**
 * Production: Smithing, Crafting, Cooking and Fletching — PRD 2.7.
 *
 * One model for all four. A recipe names its inputs, its output, its duration, its XP and the
 * station kind it needs; the player has to be standing at a matching station entity. There is no
 * per-skill branch below except the one the PRD asks for: **Cooking is the only skill that can
 * fail**, and a failure yields the recipe's `burntItemId` for 0 XP.
 *
 *   burnChance = clamp(0.45 - 0.030 * (cookingLevel - recipe.reqLevel), 0.00, 0.45)
 *
 * Production **is** an activity, so it lives in `state.activity` and goes through the activity
 * spine, which already enforces the universal interruptions: player movement, damage taken, death
 * and cancel. This file adds the two that are its own — a missing ingredient and a full inventory —
 * and checks that the player is still standing at the station.
 *
 * `systems/activity.ts` belongs to another owner, so it arrives as the injected `ProductionActivityPort`
 * rather than an import. The driver object below is structurally an `ActivityDriver`; the root
 * hands it straight to `ActivitySystem.register`.
 */
import type {
  ActivitySummary, EntityId, RecipeId, Result, SemanticEntity, SkillId,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { ActivityState, GameState, Store } from "../state/store.js";
import { addSkillXp } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { Rng, RngStreams } from "../core/rng.js";
import type { TickSystem } from "../app/loop.js";
import type { InteractionDispatcher } from "../world/interactions.js";
import { distanceXZ } from "../core/math.js";
import { INTERACT_RANGE } from "../app/config.js";
import type { RecipeDef } from "../content/index.js";
import { burnChance, content } from "../content/index.js";
import type { CombatEntityPort, CombatInventoryPort } from "./combat.js";

/**
 * How far the player may drift from the station before the batch stops. Slightly looser than the
 * walk-into-range threshold so standing at an anvil and turning does not cancel a 20-bar smelt.
 */
export const STATION_RANGE = INTERACT_RANGE + 0.6;

/** Ceiling on batch repetitions caught up in one tick, so a debug time jump cannot hang a frame. */
const MAX_CATCHUP_REPETITIONS = 500;

// -------------------------------------------------------------------- ports

/**
 * The subset of `systems/activity.ts` production needs.
 *
 * `register` takes this file's driver, and `ActivitySystem.register` takes the wider
 * `ActivityDriver`; method parameters are bivariant, so the real system satisfies this port and
 * the driver is still accepted at the call site.
 */
export interface ProductionActivityPort {
  register(driver: ProductionDriver): void;
  start(activity: ActivityState, atMs: number, extra?: Record<string, unknown>): void;
  stop(reason: ProductionStopReason, atMs: number): boolean;
  current(): ActivityState | null;
  isBusy(): boolean;
}

/** The subset of `ActivityStopReason` production can produce. A strict subset, so it is assignable. */
export type ProductionStopReason =
  | "completed" | "cancelled" | "inventory-full" | "moved" | "failed" | "gone" | "replaced";

export type ProductionTickResult =
  | { done: false }
  | { done: true; reason: ProductionStopReason };

/** Structurally an `ActivityDriver` for `kind: "production"`. */
export interface ProductionDriver {
  readonly kind: "production";
  tick(activity: ActivityState, state: GameState, deltaMs: number, atMs: number): ProductionTickResult;
  summary(activity: ActivityState, state: GameState, atMs: number): ActivitySummary;
}

const CONTINUE: ProductionTickResult = { done: false };

export interface ProductionDeps {
  store: Store;
  events: EventBus;
  rng: RngStreams;
  entities: CombatEntityPort;
  inventory: CombatInventoryPort;
  activity: ProductionActivityPort;
  dispatcher: InteractionDispatcher;
  /** Registers a `produce` interaction handler for station entities. Defaults to true. */
  registerInteraction?: boolean;
}

// ------------------------------------------------------------------- system

export class ProductionSystem implements TickSystem {
  readonly name = "production";

  /**
   * PRD section 3, row 6 ("Activity"), one past `ActivitySystem`'s 60. The real work happens
   * inside `this.driver`, which the activity spine calls at 60; this system's own tick keeps the
   * clock reference the summary and the interaction handler read.
   */
  readonly order = 61;

  /** Registered with the activity system by the root: `activity.register(production.driver)`. */
  readonly driver: ProductionDriver;

  /**
   * The burn roll runs on the `misc` stream, not `combat` or `loot`.
   *
   * Deliberate: cooking a batch must not shift the next hit roll or the next drop roll, or a fight
   * stops replaying from a seed the moment a player cooks between pulls. Still seeded, still
   * reproducible, still not `Math.random`.
   */
  private readonly burnRng: Rng;

  private lastAtMs = 0;

  constructor(private readonly deps: ProductionDeps) {
    this.burnRng = deps.rng.get("misc");

    this.driver = {
      kind: "production",
      tick: (activity, state, deltaMs, atMs) => this.advance(activity, state, deltaMs, atMs),
      summary: (activity, state, atMs) => this.summarise(activity, state, atMs),
    };
    deps.activity.register(this.driver);

    if (deps.registerInteraction !== false) {
      deps.dispatcher.registerHandler("produce", (context) => this.handleProduce(context.entity));
    }
  }

  /** Satisfies `SystemHooks.production` in api/gameApi.ts. */
  hook(): { produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }> } {
    return { produce: (recipeId, quantity) => this.produce(recipeId, quantity) };
  }

  tick(_deltaMs: number, atMs: number): void {
    this.lastAtMs = atMs;
  }

  // ---------------------------------------------------------------- command

  produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }> {
    const state = this.deps.store.get();
    const atMs = this.lastAtMs;

    if (state.player.health <= 0) return err("DEAD", "You are dead.");
    if (!Number.isFinite(quantity) || quantity < 1) {
      return err("INVALID_ARGUMENT", "Quantity must be at least 1.");
    }
    const wanted = Math.floor(quantity);

    const recipe = content.recipe(recipeId);
    if (!recipe) return err("NOT_FOUND", `No recipe with id ${recipeId}`);

    const level = state.skills[recipe.skill].level;
    if (level < recipe.reqLevel) {
      return err("REQUIREMENTS_NOT_MET", `${recipe.name} needs ${recipe.skill} ${recipe.reqLevel}.`);
    }

    const station = this.findStation(state, recipe);
    if (recipe.station !== null && !station) {
      return err("OUT_OF_RANGE", `${recipe.name} needs a ${recipe.station} you are standing at.`);
    }

    const missing = this.missingInput(recipe);
    if (missing) {
      return err("NOT_ENOUGH_ITEMS", `${recipe.name} needs ${missing.quantity} ${missing.itemId}.`);
    }
    if (!this.hasRoomForOutput(recipe)) {
      return err("INVENTORY_FULL", "Your inventory is full.");
    }

    const activity: ActivityState = {
      kind: "production",
      skill: recipe.skill,
      recipeId: recipe.id,
      stationId: station?.id ?? "",
      remaining: wanted,
      completed: 0,
      nextCompleteAtMs: atMs + recipe.durationMs,
    };
    this.deps.activity.start(activity, atMs, {
      op: recipe.kind,
      recipeId: recipe.id,
      recipeName: recipe.name,
      quantity: wanted,
      durationMs: recipe.durationMs,
    });

    return ok({ queued: wanted, durationMs: recipe.durationMs });
  }

  /**
   * `interact(stationId, "produce")` with no recipe named. Picks the highest-requirement recipe the
   * station makes that the player has both the level and the ingredients for, which is what a
   * click on an anvil with a bag of bars should do.
   */
  private handleProduce(entity: SemanticEntity): Result<{ started: string }> {
    const state = this.deps.store.get();
    const station = entity.station;
    if (!station) return err("INVALID_ARGUMENT", `${entity.name} is not a production station.`, entity.id);

    const candidates = station.recipeIds.length > 0
      ? station.recipeIds.map((id) => content.recipe(id)).filter(isRecipe)
      : content.recipesForSkill(station.skill);

    let best: RecipeDef | undefined;
    for (const recipe of candidates) {
      if (state.skills[recipe.skill].level < recipe.reqLevel) continue;
      if (this.missingInput(recipe)) continue;
      if (!best || recipe.reqLevel > best.reqLevel) best = recipe;
    }
    if (!best) {
      return err("NOT_ENOUGH_ITEMS", `Nothing you can make at ${entity.name} right now.`, entity.id);
    }

    const result = this.produce(best.id, this.maxRepetitions(best));
    if (!result.ok) return result;
    return ok({ started: `making ${best.name}` });
  }

  // ------------------------------------------------------------------ drive

  private advance(
    activity: ActivityState,
    state: GameState,
    _deltaMs: number,
    atMs: number,
  ): ProductionTickResult {
    if (activity.kind !== "production") return CONTINUE;

    const recipe = content.recipe(activity.recipeId);
    if (!recipe) return { done: true, reason: "failed" };

    if (recipe.station !== null) {
      const station = this.deps.entities.get(activity.stationId);
      if (!station) return { done: true, reason: "gone" };
      if (distanceXZ(state.player.position, station.position) > STATION_RANGE) {
        return { done: true, reason: "moved" };
      }
    }

    let guard = 0;
    while (atMs >= activity.nextCompleteAtMs && activity.remaining > 0 && guard < MAX_CATCHUP_REPETITIONS) {
      guard += 1;

      if (this.missingInput(recipe)) {
        this.deps.events.emit(
          "activity.stopped",
          { kind: "production", recipeId: recipe.id, reason: "no-ingredients" },
          activity.stationId || undefined,
          atMs,
        );
        return { done: true, reason: "failed" };
      }
      if (!this.hasRoomForOutput(recipe)) {
        this.deps.events.emit("inventory.full", { recipeId: recipe.id }, undefined, atMs);
        return { done: true, reason: "inventory-full" };
      }

      this.completeOne(recipe, state, activity.stationId, atMs);
      activity.completed += 1;
      activity.remaining -= 1;
      activity.nextCompleteAtMs += recipe.durationMs;

      if (activity.remaining <= 0) return { done: true, reason: "completed" };
    }

    return CONTINUE;
  }

  /** One repetition: consume, roll (cooking only), produce, award XP, announce. */
  private completeOne(recipe: RecipeDef, state: GameState, stationId: EntityId, atMs: number): void {
    for (const input of recipe.inputs) {
      this.deps.inventory.removeItem(input.itemId, input.quantity);
    }

    const burnt = this.rollBurn(recipe, state);
    const itemId = burnt && recipe.burntItemId ? recipe.burntItemId : recipe.output.itemId;
    const quantity = burnt ? 1 : recipe.output.quantity;

    const added = this.deps.inventory.addItem(itemId, quantity);
    const delivered = added.ok ? added.value : 0;

    if (!burnt) this.awardXp(state, recipe.skill, recipe.xp, atMs);

    this.deps.events.emit(
      "production.completed",
      {
        recipeId: recipe.id,
        recipeName: recipe.name,
        skill: recipe.skill,
        itemId,
        quantity: delivered,
        burnt,
        xp: burnt ? 0 : recipe.xp,
      },
      stationId || undefined,
      atMs,
    );
    if (delivered > 0) {
      this.deps.events.emit("item.received", { itemId, quantity: delivered }, stationId || undefined, atMs);
    }
    this.deps.store.markDirty();
  }

  /**
   * Cooking is the only production skill that can fail. Anything without a `burntItemId` — every
   * Smithing, Crafting and Fletching recipe — never rolls, so no other skill can burn by accident.
   */
  private rollBurn(recipe: RecipeDef, state: GameState): boolean {
    if (recipe.skill !== "cooking" || !recipe.burntItemId) return false;
    const chance = burnChance(state.skills.cooking.level, recipe.reqLevel);
    if (chance <= 0) return false;
    return this.burnRng.chance(chance);
  }

  // ---------------------------------------------------------------- summary

  private summarise(activity: ActivityState, _state: GameState, atMs: number): ActivitySummary {
    if (activity.kind !== "production") {
      return { kind: activity.kind, progress: 0, completed: 0, remaining: 0 };
    }
    const recipe = content.recipe(activity.recipeId);
    const durationMs = recipe?.durationMs ?? 1;
    const left = activity.nextCompleteAtMs - atMs;
    const progress = durationMs > 0 ? clamp01(1 - left / durationMs) : 1;

    const summary: ActivitySummary = {
      kind: "production",
      skill: activity.skill,
      recipeId: activity.recipeId,
      progress,
      completed: activity.completed,
      remaining: activity.remaining,
    };
    if (activity.stationId) summary.entityId = activity.stationId;
    return summary;
  }

  // -------------------------------------------------------------- read-only

  /** How many repetitions the carried ingredients support. The batch UI's default quantity. */
  maxRepetitions(recipe: RecipeDef): number {
    let most = Number.POSITIVE_INFINITY;
    for (const input of recipe.inputs) {
      if (input.quantity <= 0) continue;
      most = Math.min(most, Math.floor(this.deps.inventory.countItem(input.itemId) / input.quantity));
    }
    if (!Number.isFinite(most)) return 1;
    return Math.max(1, most);
  }

  /** What a station can make right now, for the production panel and the skill guide. */
  availableAt(entityId: EntityId): RecipeDef[] {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(entityId);
    const station = entity?.station;
    if (!station) return [];
    const rows = station.recipeIds.length > 0
      ? station.recipeIds.map((id) => content.recipe(id)).filter(isRecipe)
      : content.recipesForSkill(station.skill);
    return rows.filter((recipe) => state.skills[recipe.skill].level >= recipe.reqLevel);
  }

  // -------------------------------------------------------------- internals

  /**
   * The nearest station in range that matches the recipe.
   *
   * `meta.stationKind` is what the region builder writes, so that is the primary match. The skill
   * on the station block is the fallback, which keeps a hand-placed station working without meta.
   */
  private findStation(state: GameState, recipe: RecipeDef): SemanticEntity | undefined {
    if (recipe.station === null) return undefined;

    let best: SemanticEntity | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entity of this.deps.entities.all()) {
      if (entity.archetype !== "station" || !entity.station) continue;

      const kind = entity.meta?.stationKind;
      const kindMatches = typeof kind === "string" ? kind === recipe.station : false;
      const skillMatches = entity.station.skill === recipe.skill;
      const listed = entity.station.recipeIds.includes(recipe.id);
      if (!kindMatches && !skillMatches && !listed) continue;

      const gap = distanceXZ(state.player.position, entity.position);
      if (gap > STATION_RANGE || gap >= bestDistance) continue;
      bestDistance = gap;
      best = entity;
    }
    return best;
  }

  private missingInput(recipe: RecipeDef): { itemId: string; quantity: number } | undefined {
    for (const input of recipe.inputs) {
      if (this.deps.inventory.countItem(input.itemId) < input.quantity) return input;
    }
    return undefined;
  }

  /**
   * Room for the result. The inputs come out of the bag first, so a one-for-one recipe worked at a
   * full inventory is fine; only a recipe that nets slots is refused.
   */
  private hasRoomForOutput(recipe: RecipeDef): boolean {
    if (this.deps.inventory.hasRoomFor(recipe.output.itemId, recipe.output.quantity)) return true;
    // Consuming at least one non-stacking input frees the slot the output lands in.
    return recipe.inputs.some((input) => this.deps.inventory.countItem(input.itemId) >= input.quantity);
  }

  private awardXp(state: GameState, skill: SkillId, amount: number, atMs: number): void {
    if (amount <= 0) return;
    const result = addSkillXp(state, skill, amount);
    if (result.levelsGained > 0) {
      this.deps.events.emit(
        "level.gained",
        { skill, level: result.newLevel, levelsGained: result.levelsGained },
        undefined,
        atMs,
      );
    }
  }
}

// ---------------------------------------------------------------- helpers

function isRecipe(value: RecipeDef | undefined): value is RecipeDef {
  return value !== undefined;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
