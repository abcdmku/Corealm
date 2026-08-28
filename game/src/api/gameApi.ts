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
  ItemStack, MoveTarget, ObserveFilter, ObservedEntity, PlayerView, QuestSummary, RecipeId,
  Result, SemanticEntity, SkillId, SkillView, SpellId, Vec3, OverlaySpec,
} from "../contracts.js";
import { EQUIP_SLOTS, SKILL_IDS, err, ok } from "../contracts.js";
import type { Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { Navigation } from "../systems/navigation.js";
import type { Movement } from "../systems/movement.js";
import type { SimClock } from "../core/time.js";
import { levelProgress, xpToNextLevel } from "../content/xp.js";
import { distanceXZ } from "../core/math.js";
import { INTERACT_RANGE } from "../app/config.js";

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
  production?: { produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }> };
  combat?: {
    attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }>;
    cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }>;
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
  interactions?: { run(entityId: EntityId, interaction: InteractionId): Result<{ started: string }> };
}

type ShopViewLike = import("../contracts.js").ShopView;

export class CorealmGameApi implements GameApiContract {
  readonly hooks: SystemHooks = {};

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
      inCombat: state.combat.inCombatUntilMs > this.clock.elapsedMs,
      dead: player.health <= 0,
      moving: player.movement.mode !== "idle",
      activityKind: state.activity?.kind ?? null,
      combatLevelEstimate: Math.max(
        1,
        Math.floor((state.skills.melee.level + state.skills.magic.level) / 2),
      ),
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
    return { slots, totals: emptyBonuses() };
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
    const state = this.store.get();
    if (state.player.health <= 0) return err("DEAD", "The player is dead");
    if (!this.nav.isReady()) return err("UNAVAILABLE", "Navigation is not ready");

    let destination: Vec3 | null = null;
    let entityId: EntityId | null = null;

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
    }

    if (!destination) return err("INVALID_ARGUMENT", "No destination resolved");

    const started = this.movement.startPath(state, destination, entityId, this.clock.elapsedMs);
    if (!started) return err("NOT_REACHABLE", "No walkable path to that destination");
    this.store.markDirty();
    return ok(started);
  }

  stop(): Result<{ stopped: string[] }> {
    const state = this.store.get();
    const stopped: string[] = [];
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

    const gap = distanceXZ(state.player.position, entity.position);
    if (gap > INTERACT_RANGE) {
      // Matching the human affordance: one click walks into range and then acts.
      const moved = this.moveTo({ entityId });
      if (!moved.ok) return moved as Result<{ started: string }>;
      return ok({ started: `walking to ${entity.name}` });
    }

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
    if (!Number.isFinite(quantity) || quantity < 1) return err("INVALID_ARGUMENT", "Quantity must be at least 1");
    return hook.produce(recipeId, Math.floor(quantity));
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

  // ---------------------------------------------------------------- helpers

  /** Convenience for UI progress bars. Not part of the frozen contract. */
  skillProgress(skill: SkillId): number {
    return levelProgress(this.store.get().skills[skill].xp);
  }
}

export function emptyBonuses(): EquipmentBonuses {
  return { accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0 };
}
