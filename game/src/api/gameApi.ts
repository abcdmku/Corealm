/**
 * The canonical game API — the ONLY write path into the world.
 *
 * `ui/*`, `agent/tools.ts`, and `debug/gameDebug.ts` all route through this class. A human click
 * and a WebMCP call reach the identical function, which is what makes agent parity a property of
 * the architecture rather than a claim in a document.
 *
 * Nothing here throws across the boundary. Failures come back as `Result<T>`.
 *
 * FROZEN. Only the root edits this file.
 */
import type {
  ActivitySummary, BankView, DialogueView, DocHit, EntityId, EquipSlot, EquipmentBonuses,
  GameApi as GameApiContract, GameEvent, GameEventType, InteractionId, InventorySlot, ItemId,
  ItemStack, MoveTarget, ObserveFilter, ObservedEntity, PlayerView, QuestSummary, RecipeId, TimeView,
  Result, SemanticEntity, SkillId, SkillView, SpellbookView, SpellId, SpellRow, Vec3, OverlaySpec,
} from "../contracts.js";
import { EQUIP_SLOTS, SKILL_IDS, err, ok } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { Navigation } from "../systems/navigation.js";
import type { Movement } from "../systems/movement.js";
import { equipmentTotalsOf } from "../systems/equipment.js";
import type { SimClock } from "../core/time.js";
import { levelProgress, xpToNextLevel } from "../content/xp.js";
import { distanceXZ } from "../core/math.js";
import { INTERACT_RANGE, PLAYER_SPEED } from "../app/config.js";
import { content } from "../content/index.js";
import { magicMaxHit } from "../systems/combat.js";

/** What every attack spell is paid for in. One id, because PRD section 0 decision 3 says so. */
const ESSENCE_SHARD_ITEM_ID = "essence_shard";

/**
 * Metres of reach given up when walking into range of a ranged interaction.
 *
 * Stopping exactly on the range boundary puts the player one footstep from being out of it, and a
 * wandering enemy would then bounce them between "in range" and "walk closer" for the whole fight.
 */
const RANGED_APPROACH_SLACK = 1.5;

/** Total quantity of one item across inventory slots, ignoring the empty ones. */
function countIn(slots: readonly (InventorySlot | null)[], itemId: ItemId): number {
  let total = 0;
  for (const slot of slots) if (slot && slot.itemId === itemId) total += slot.quantity;
  return total;
}

/**
 * Systems register themselves here as they come online in later build rounds. The API surface is
 * frozen now; the implementations behind these hooks arrive per round. A hook that is not yet
 * registered returns UNAVAILABLE rather than throwing, so the contract holds from round 0.
 */
export interface SystemHooks {
  entities?: {
    get(id: EntityId): SemanticEntity | undefined;
    all(): SemanticEntity[];
    observe(filter: ObserveFilter, from: Vec3): ObservedEntity[];
  };
  gathering?: { start(entityId: EntityId, interaction: InteractionId): Result<{ started: string }> };
  inventory?: {
    slots(): (InventorySlot | null)[];
    freeSlots(): number;
    use(itemId: ItemId, target?: { itemId: ItemId } | { entityId: EntityId }): Result<{ effect: string }>;
  };
  equipment?: {
    slots(): Record<EquipSlot, ItemStack | null>;
    totals(): EquipmentBonuses;
    equip(itemId: ItemId): Result<{ slot: EquipSlot; replaced: ItemId | null }>;
    unequip(slot: EquipSlot): Result<{ itemId: ItemId }>;
  };
  production?: {
    produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }>;
    produceAt(
      stationId: EntityId,
      recipeId: RecipeId,
      quantity: number,
    ): Result<{ queued: number; durationMs: number }>;
  };
  campfire?: {
    build(logItemId: ItemId): Result<{ entityId: EntityId; lifetimeMs: number; position: Vec3 }>;
  };
  combat?: {
    attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }>;
    cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }>;
    setPreferredSpell(spellId: SpellId | null): void;
  };
  dialogue?: { op(op: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null> };
  bank?: {
    op(op: "list" | "deposit" | "withdraw" | "depositAll", args?: { itemId?: ItemId; quantity?: number; filter?: string }): Result<BankView>;
  };
  shop?: {
    op(op: "list" | "buy" | "sell", args?: { shopId?: EntityId; itemId?: ItemId; quantity?: number }): Result<ShopViewLike>;
  };
  quests?: { summaries(): QuestSummary[] };
  overlays?: { set(spec: OverlaySpec): number; clear(id?: string): number };
  docs?: { search(query: string, limit: number): DocHit[] };
  activity?: { summary(): ActivitySummary | null };
  interactions?: {
    run(entityId: EntityId, interaction: InteractionId): Result<{ started: string }>;
    /**
     * How close this verb needs the player before its handler runs.
     *
     * `world/interactions.ts` has owned per-verb reach since round 4 and `interact` did not consult
     * it: it walked to a hardcoded INTERACT_RANGE for everything, so a nine-metre spell marched the
     * caster into melee before the first cast and the dispatcher's own SPELL_RANGE never came into
     * play. Optional, so a partially-registered hook still behaves exactly as before.
     */
    rangeFor?(interaction: InteractionId): number;
  };
}

type ShopViewLike = import("../contracts.js").ShopView;

export class CorealmGameApi implements GameApiContract {
  readonly hooks: SystemHooks = {};

  /**
   * The interaction to re-fire once the player finishes walking into range.
   *
   * Without this, "click a distant ore" walked the player there and then stopped — the single most
   * important affordance in the game, silently half-implemented. It is held here rather than in the
   * movement system because it is an API-level affordance: one call means "get there and do it",
   * for a human click and an agent tool call alike.
   */
  private pending: { entityId: EntityId; interaction: InteractionId; expiresAtMs: number } | null = null;

  constructor(
    private readonly store: Store,
    private readonly eventBus: EventBus,
    private readonly nav: Navigation,
    private readonly movement: Movement,
    private readonly clock: SimClock,
  ) {}

  register<K extends keyof SystemHooks>(key: K, hook: NonNullable<SystemHooks[K]>): void {
    this.hooks[key] = hook;
  }

  // ------------------------------------------------------------------ state

  getPlayer(): PlayerView {
    const state = this.store.get();
    const player = state.player;
    return {
      position: [...player.position] as unknown as Vec3,
      regionId: player.regionId,
      health: player.health,
      maxHealth: player.maxHealth,
      facingRad: player.facingRad,
      // A live fight, not the regen window. An agent that waits for `inCombat === false` after a
      // kill used to hang for the full eight-second no-regen stamp; that stamp is `regenBlocked`.
      inCombat: state.combat.targetId !== null || state.combat.engagedBy.length > 0,
      regenBlocked: state.combat.inCombatUntilMs > this.clock.elapsedMs,
      targetId: state.combat.targetId,
      engagedBy: [...state.combat.engagedBy],
      dead: player.health <= 0,
      moving: player.movement.mode !== "idle",
      activityKind: state.activity?.kind ?? null,
      combatLevelEstimate: Math.max(
        1,
        Math.floor((state.skills.melee.level + state.skills.magic.level) / 2),
      ),
    };
  }

  getTime(): TimeView {
    return {
      simMs: this.clock.elapsedMs,
      tick: this.clock.tick,
      timeScale: this.clock.timeScale,
      paused: this.clock.paused,
    };
  }

  getSkills(): Record<SkillId, SkillView> {
    const state = this.store.get();
    const out = {} as Record<SkillId, SkillView>;
    for (const id of SKILL_IDS) {
      const entry = state.skills[id];
      out[id] = { level: entry.level, xp: entry.xp, xpToNext: xpToNextLevel(entry.xp) };
    }
    return out;
  }

  getInventory(): { slots: (InventorySlot | null)[]; freeSlots: number } {
    const hook = this.hooks.inventory;
    if (hook) return { slots: hook.slots(), freeSlots: hook.freeSlots() };
    const slots = this.store.get().inventory.slots;
    return { slots: [...slots], freeSlots: slots.filter((slot) => slot === null).length };
  }

  getEquipment(): { slots: Record<EquipSlot, ItemStack | null>; totals: EquipmentBonuses } {
    const hook = this.hooks.equipment;
    if (hook) return { slots: hook.slots(), totals: hook.totals() };
    const slots = {} as Record<EquipSlot, ItemStack | null>;
    for (const slot of EQUIP_SLOTS) slots[slot] = this.store.get().equipment[slot];
    // Derive the totals rather than answering zero. An agent or a panel asking what the player is
    // wearing used to get a confident all-zero `EquipmentBonuses` whenever the equipment hook was
    // absent, which is indistinguishable from wearing nothing — the worst of the three possible
    // answers, because it is wrong and it looks right. `equipmentTotalsOf` is the same derivation
    // the hook runs, over the slots this branch has already read out of the store.
    return { slots, totals: equipmentTotalsOf(slots) };
  }

  getActivity(): ActivitySummary | null {
    const hook = this.hooks.activity;
    if (hook) return hook.summary();
    const activity = this.store.get().activity;
    if (!activity) return null;
    return { kind: activity.kind, progress: 0, completed: 0, remaining: 0 };
  }

  getQuests(): QuestSummary[] {
    return this.hooks.quests?.summaries() ?? [];
  }

  getCurrency(): number {
    return this.store.get().currency;
  }

  // ------------------------------------------------------------ observation

  observe(filter: ObserveFilter): ObservedEntity[] {
    const hook = this.hooks.entities;
    if (!hook) return [];
    return hook.observe(filter, this.store.get().player.position);
  }

  inspect(entityId: EntityId): Result<SemanticEntity> {
    const entity = this.hooks.entities?.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);
    return ok(entity);
  }

  searchDocs(query: string, limit = 5): DocHit[] {
    return this.hooks.docs?.search(query, Math.max(1, Math.min(limit, 25))) ?? [];
  }

  // --------------------------------------------------------------- movement

  moveTo(target: MoveTarget): Result<{ pathLength: number; etaMs: number }> {
    return this.walkTo(target, 0);
  }

  /**
   * `moveTo`, but allowed to stop short.
   *
   * `stopDistance` is metres of the tail to leave unwalked, which `Movement.startPath` implements by
   * trimming the path. It exists for ranged interactions: a click on an enemy fifteen metres off
   * used to path all the way ONTO the target and only then check range, so a caster jogged into
   * melee to cast a spell that already had line of sight from where they were standing.
   */
  private walkTo(target: MoveTarget, stopDistance: number): Result<{ pathLength: number; etaMs: number }> {
    const state = this.store.get();
    if (state.player.health <= 0) return err("DEAD", "The player is dead");
    if (!this.nav.isReady()) return err("UNAVAILABLE", "Navigation is not ready");

    let destination: Vec3 | null = null;
    let entityId: EntityId | null = null;
    let locationId: string | null = null;

    if ("position" in target) {
      destination = target.position;
    } else if ("entityId" in target) {
      const entity = this.hooks.entities?.get(target.entityId);
      if (!entity) return err("NOT_FOUND", `No entity with id ${target.entityId}`, target.entityId);
      destination = entity.position;
      entityId = entity.id;
    } else {
      const node = this.nav.routeNode(target.locationId);
      if (!node) return err("NOT_FOUND", `No known location ${target.locationId}`);
      destination = node.position;
      locationId = target.locationId;
    }

    if (!destination) return err("INVALID_ARGUMENT", "No destination resolved");

    // The probe is silent on failure: it is a question, not an answer, and an agent waiting on
    // `navigation.failed` must not hear it while the route below is walking the player out.
    const started = this.movement.startPath(state, destination, entityId, this.clock.elapsedMs, {
      quietFailure: true,
      stopDistance,
    });
    if (started) {
      this.store.markDirty();
      return ok(started);
    }

    // One navmesh query is not the whole answer to "walk to that thing". A portal is a gameplay
    // link the mesh cannot express, so from inside the Gravelmaw every overworld target is
    // correctly NOT_REACHABLE on the mesh and still perfectly reachable on foot — you walk out
    // through the mouth first. That is what a player does, so it is what this does.
    const routed = this.startPlannedRoute(state, destination, entityId, locationId);
    if (routed) {
      this.store.markDirty();
      return ok(routed);
    }

    // Both answers are no, so now the failure is real and it is emitted exactly as `startPath`
    // used to emit it, because that is what the UI and every waiting agent already handle.
    this.eventBus.emit(
      "navigation.failed",
      { reason: "unreachable", to: destination },
      entityId ?? undefined,
      this.clock.elapsedMs,
    );
    return err("NOT_REACHABLE", "No walkable path to that destination");
  }

  /**
   * The route fallback behind `moveTo`.
   *
   * `pathLength` counts only the walk legs, because a portal crossing and an Agility traversal are
   * durations rather than distances and folding them in at walking pace would report metres nobody
   * walks. `etaMs` is the whole plan, which is what a caller waiting on arrival actually needs.
   */
  private startPlannedRoute(
    state: GameState,
    destination: Vec3,
    entityId: EntityId | null,
    locationId: string | null,
  ): { pathLength: number; etaMs: number } | null {
    const agility = state.skills.agility.level;
    const plan = locationId !== null
      ? this.nav.planRouteVia(state.player.position, { locationId }, agility)
      : this.nav.planRouteVia(
        state.player.position,
        entityId !== null ? { position: destination, id: entityId } : { position: destination },
        agility,
      );
    if (!plan || plan.legs.length === 0) return null;
    if (!this.movement.startRoute(state, plan.legs, this.clock.elapsedMs, entityId)) return null;

    const walked = plan.legs
      .filter((leg) => leg.kind === "walk")
      .reduce((sum, leg) => sum + leg.cost, 0) * PLAYER_SPEED;
    return {
      pathLength: Math.round(walked * 100) / 100,
      etaMs: Math.round(plan.cost * 1000),
    };
  }

  stop(): Result<{ stopped: string[] }> {
    const state = this.store.get();
    const stopped: string[] = [];
    this.pending = null;
    if (this.movement.stop(state, this.clock.elapsedMs, "cancelled")) stopped.push("navigation");
    if (state.activity) {
      this.eventBus.emit("activity.stopped", { kind: state.activity.kind, reason: "cancelled" }, undefined, this.clock.elapsedMs);
      stopped.push(state.activity.kind);
      state.activity = null;
    }
    if (state.combat.targetId) {
      this.eventBus.emit("combat.ended", { reason: "disengaged" }, state.combat.targetId, this.clock.elapsedMs);
      state.combat.targetId = null;
      stopped.push("combat");
    }
    this.store.markDirty();
    return ok({ stopped });
  }

  // ------------------------------------------------------------ interaction

  interact(entityId: EntityId, interaction: InteractionId): Result<{ started: string }> {
    const state = this.store.get();
    if (state.player.health <= 0) return err("DEAD", "The player is dead");

    const entity = this.hooks.entities?.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);
    if (!entity.interactions.includes(interaction)) {
      return err("INVALID_ARGUMENT", `${entity.name} has no "${interaction}" interaction`, entityId);
    }

    // The VERB's reach, not one constant for all of them. A staff attack is allowed to start from
    // nine metres; a chop still needs the player at the tree.
    const reach = this.hooks.interactions?.rangeFor?.(interaction) ?? INTERACT_RANGE;
    const gap = distanceXZ(state.player.position, entity.position);
    if (gap > reach) {
      // One click walks into range and THEN acts. The interaction is remembered and re-fired by
      // `resumePending` when navigation completes.
      //
      // Walk only as far as the verb needs. A short-reach verb still walks onto its target — you
      // chop a tree from arm's length — but anything with real reach stops at the edge of it, less
      // a metre and a half of slack so a target that drifts a step does not immediately fall out of
      // range and restart the approach.
      const moved = this.walkTo(
        { entityId },
        reach > INTERACT_RANGE ? Math.max(0, reach - RANGED_APPROACH_SLACK) : 0,
      );
      if (!moved.ok) return moved as Result<{ started: string }>;
      this.pending = {
        entityId,
        interaction,
        // Generous, but bounded: a stale intent must not fire minutes later after the player has
        // wandered off and forgotten they ever clicked.
        expiresAtMs: this.clock.elapsedMs + moved.value.etaMs + 10_000,
      };
      return ok({ started: `walking to ${entity.name}` });
    }

    this.pending = null;
    const runner = this.hooks.interactions;
    if (!runner) return err("UNAVAILABLE", "Interaction system is not available yet");
    return runner.run(entityId, interaction);
  }

  useItem(itemId: ItemId, target?: { itemId: ItemId } | { entityId: EntityId }): Result<{ effect: string }> {
    const hook = this.hooks.inventory;
    if (!hook) return err("UNAVAILABLE", "Inventory system is not available yet");
    return hook.use(itemId, target);
  }

  equipItem(itemId: ItemId): Result<{ slot: EquipSlot; replaced: ItemId | null }> {
    const hook = this.hooks.equipment;
    if (!hook) return err("UNAVAILABLE", "Equipment system is not available yet");
    return hook.equip(itemId);
  }

  unequipItem(slot: EquipSlot): Result<{ itemId: ItemId }> {
    const hook = this.hooks.equipment;
    if (!hook) return err("UNAVAILABLE", "Equipment system is not available yet");
    return hook.unequip(slot);
  }

  produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }> {
    const hook = this.hooks.production;
    if (!hook) return err("UNAVAILABLE", "Production system is not available yet");
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 28) {
      return err("INVALID_ARGUMENT", "Quantity must be between 1 and 28");
    }
    return hook.produce(recipeId, Math.floor(quantity));
  }

  produceAt(
    stationId: EntityId,
    recipeId: RecipeId,
    quantity: number,
  ): Result<{ queued: number; durationMs: number }> {
    const hook = this.hooks.production;
    if (!hook) return err("UNAVAILABLE", "Production system is not available yet");
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 28) {
      return err("INVALID_ARGUMENT", "Quantity must be between 1 and 28");
    }
    return hook.produceAt(stationId, recipeId, Math.floor(quantity));
  }

  buildCampfire(logItemId: ItemId): Result<{ entityId: EntityId; lifetimeMs: number; position: Vec3 }> {
    const hook = this.hooks.campfire;
    if (!hook) return err("UNAVAILABLE", "Campfire building is not available yet");
    return hook.build(logItemId);
  }

  // ----------------------------------------------------------------- combat

  attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }> {
    const hook = this.hooks.combat;
    if (!hook) return err("UNAVAILABLE", "Combat system is not available yet");
    return hook.attack(entityId);
  }

  cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }> {
    const hook = this.hooks.combat;
    if (!hook) return err("UNAVAILABLE", "Combat system is not available yet");
    return hook.cast(spellId, entityId);
  }

  /**
   * The whole spellbook, resolved against the player standing here right now.
   *
   * Assembled in this class rather than in `ui/spellbookPanel.ts` for the reason the header gives:
   * a human opening the panel and an agent calling the tool must see the SAME sixteen rows with the
   * same max hits. Doing the arithmetic in the UI would put the agent one refactor away from a
   * different answer.
   *
   * `maxHit` reuses `magicMaxHit` from `systems/combat.ts` rather than restating PRD 2.4's formula,
   * because a second copy of a damage formula is a second thing to get wrong.
   */
  getSpellbook(): SpellbookView {
    const state = this.store.get();
    const magicLevel = state.skills.magic.level;
    const gear = equipmentTotalsOf(state.equipment);
    const inventory = this.hooks.inventory;

    // Shard counts come from the inventory slots directly. The `inventory` hook exposes `slots()`
    // but no count helper, and reaching for `countItem` on the combat system would make the read
    // path depend on a system that is allowed to be absent.
    const slots = inventory ? inventory.slots() : state.inventory.slots;

    const spells = content.allSpells().map((spell) => {
      const shards = countIn(slots, spell.cost.itemId);
      const unlocked = magicLevel >= spell.reqLevel;
      return {
        id: spell.id,
        name: spell.name,
        element: spell.element,
        rung: spell.rung,
        reqLevel: spell.reqLevel,
        maxHit: magicMaxHit(magicLevel, gear.magicPower, spell),
        baseXp: spell.baseXp,
        castMs: spell.castMs,
        costItemId: spell.cost.itemId,
        costQuantity: spell.cost.quantity,
        unlocked,
        castable: unlocked && shards >= spell.cost.quantity,
        description: spell.description,
      };
    });

    const preferredSpellId = state.combat.preferredSpellId ?? null;
    const preferred = spells.find((row) => row.id === preferredSpellId);
    // What "Cast at" would throw: the standing choice when it is castable, else the strongest that
    // is. This mirrors `CombatSystem.preferredSpellId` and the two must not drift; the panel prints
    // this as "automatic", so a wrong answer here teaches the player something false.
    const active = preferred?.castable
      ? preferred
      : spells.reduce<SpellRow | undefined>(
        (best, row) => (row.castable && (!best || row.reqLevel > best.reqLevel) ? row : best),
        undefined,
      );

    return {
      spells,
      preferredSpellId,
      activeSpellId: active?.id ?? null,
      magicLevel,
      shards: countIn(slots, ESSENCE_SHARD_ITEM_ID),
    };
  }

  setPreferredSpell(spellId: SpellId | null): Result<{ preferredSpellId: SpellId | null }> {
    const hook = this.hooks.combat;
    if (!hook) return err("UNAVAILABLE", "Combat system is not available yet");
    if (spellId !== null && !content.spell(spellId)) {
      return err("NOT_FOUND", `No spell with id ${spellId}`);
    }
    hook.setPreferredSpell(spellId);
    return ok({ preferredSpellId: spellId });
  }

  // ------------------------------------------------------- npc, bank, shop

  dialogue(op: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null> {
    const hook = this.hooks.dialogue;
    if (!hook) return err("UNAVAILABLE", "Dialogue system is not available yet");
    return hook.op(op, optionId);
  }

  bank(
    op: "list" | "deposit" | "withdraw" | "depositAll",
    args?: { itemId?: ItemId; quantity?: number; filter?: string },
  ): Result<BankView> {
    const hook = this.hooks.bank;
    if (!hook) return err("UNAVAILABLE", "Banking system is not available yet");
    return hook.op(op, args);
  }

  shop(
    op: "list" | "buy" | "sell",
    args?: { shopId?: EntityId; itemId?: ItemId; quantity?: number },
  ): Result<ShopViewLike> {
    const hook = this.hooks.shop;
    if (!hook) return err("UNAVAILABLE", "Shop system is not available yet");
    return hook.op(op, args);
  }

  // --------------------------------------------------------------- overlays

  overlay(op: "set" | "clear", spec?: OverlaySpec): Result<{ activeCount: number }> {
    const hook = this.hooks.overlays;
    if (!hook) return err("UNAVAILABLE", "Overlay system is not available yet");
    if (op === "set") {
      if (!spec) return err("INVALID_ARGUMENT", "overlay('set') needs a spec");
      return ok({ activeCount: hook.set(spec) });
    }
    return ok({ activeCount: hook.clear(spec?.id) });
  }

  // ----------------------------------------------------------------- events

  events(sinceSeq: number, filter?: GameEventType[], timeoutMs?: number): Promise<{ events: GameEvent[]; nextSeq: number }> {
    if (timeoutMs === undefined || timeoutMs <= 0) {
      return Promise.resolve(this.eventBus.since(sinceSeq, filter));
    }
    return this.eventBus.wait(sinceSeq, filter, timeoutMs);
  }

  /**
   * Runs the remembered interaction now that the player has arrived.
   * Called by the loop when navigation completes. Returns what happened, or null if nothing waited.
   */
  resumePending(): Result<{ started: string }> | null {
    const pending = this.pending;
    if (!pending) return null;
    this.pending = null;
    if (this.clock.elapsedMs > pending.expiresAtMs) return null;

    const entity = this.hooks.entities?.get(pending.entityId);
    if (!entity) return null;
    // The world moves while the player walks: a node can deplete or an enemy die en route, and a
    // click that lands minutes later on something that has wandered off is worse than no click.
    //
    // Measured against the VERB's reach, not one constant. This used to be `INTERACT_RANGE * 1.6`
    // (3.84 m) for everything, which was invisible while every walk ended on top of its target — and
    // became a silent dead end the moment ranged approach landed: a caster walked thirty metres,
    // stopped correctly at the edge of spell range, and had the queued attack thrown away here
    // because 13.5 m is not 3.84 m. The click did nothing at all, with no error.
    //
    // The 1.6 slack is kept as-is. It is a "has the world moved too much" guard, not a range check;
    // `world/interactions.ts` applies the real range immediately below.
    const reach = this.hooks.interactions?.rangeFor?.(pending.interaction) ?? INTERACT_RANGE;
    const gap = distanceXZ(this.store.get().player.position, entity.position);
    if (gap > reach * 1.6) return null;

    const runner = this.hooks.interactions;
    if (!runner) return null;
    return runner.run(pending.entityId, pending.interaction);
  }

  /** Drops any remembered interaction. Called when the player cancels or is interrupted. */
  clearPending(): void {
    this.pending = null;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  // ---------------------------------------------------------------- helpers

  /** Convenience for UI progress bars. Not part of the frozen contract. */
  skillProgress(skill: SkillId): number {
    return levelProgress(this.store.get().skills[skill].xp);
  }
}

export function emptyBonuses(): EquipmentBonuses {
  return { accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0 };
}
