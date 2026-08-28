/**
 * Death, the Recovery Cache, and looting — PRD 2.11.
 *
 * The rule in one line: **you lose your inventory, and nothing else.** Skill XP and levels survive
 * untouched, worn equipment stays worn, and currency stays in the purse. Everything in the 28
 * inventory slots drops into a single Recovery Cache at the death position, which is a real
 * semantic entity the player can walk back to and loot.
 *
 * Only one cache exists at a time. Dying with a live cache destroys the old one, which is exactly
 * why the HUD is supposed to show a countdown banner while one is out: the second death is the
 * expensive one. The cache expires 15 minutes after it is created and takes its contents with it.
 *
 * This file also sweeps enemy loot piles, because it is the only system that expires timed world
 * containers and two sweepers would be one too many.
 */
import type { EntityId, ItemStack, RegionId, Result, SemanticEntity, Vec3 } from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import { DEFAULT_SPAWN } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { TickSystem } from "../app/loop.js";
import type { InteractionDispatcher } from "../world/interactions.js";
import { cloneVec3 } from "./combat.js";
import type { CombatEntityPort, CombatInventoryPort, CombatMovementPort } from "./combat.js";

/** PRD 2.11: the cache expires 15 real minutes after creation. */
export const RECOVERY_CACHE_TTL_MS = 15 * 60_000;

/** There is exactly one cache, so it has exactly one id. */
export const RECOVERY_CACHE_ID: EntityId = "recovery_cache";

/** Where a resolved respawn point puts the player. */
export interface RespawnPoint {
  position: Vec3;
  regionId: RegionId;
  name?: string;
}

/**
 * Resolves `state.player.respawnPointId` to a place. The root wires this to the route graph or the
 * settlement table; without it the player respawns at the world origin, which is survivable but
 * wrong, so this is a required dependency rather than an optional one.
 */
export interface RespawnPort {
  resolve(respawnPointId: string, regionId: RegionId): RespawnPoint | undefined;
}

/** Satisfied by `ActivitySystem`. Death cancels whatever was running. */
export interface DeathActivityPort {
  cancel(atMs?: number): boolean;
}

/** The two combat calls death makes. Satisfied by `CombatSystem`. */
export interface DeathCombatPort {
  resetOnDeath(atMs: number): void;
}

/** Satisfied by `EnemyAiSystem`. Respawning must not leave a pack still hunting. */
export interface DeathEnemyAiPort {
  resetOnPlayerDeath(atMs: number): void;
}

/** Satisfied by `HealthSystem`. */
export interface DeathHealthPort {
  restoreFull(): number;
}

export interface DeathDeps {
  store: Store;
  events: EventBus;
  entities: CombatEntityPort;
  inventory: CombatInventoryPort;
  dispatcher: InteractionDispatcher;
  respawn: RespawnPort;
  health?: DeathHealthPort;
  combat?: DeathCombatPort;
  enemyAi?: DeathEnemyAiPort;
  activity?: DeathActivityPort;
  movement?: CombatMovementPort;
  /** Optional navmesh snap, so the cache lands somewhere reachable. */
  snapToGround?: (point: Vec3) => Vec3 | null;
  /** View block for the cache entity. Omitted means the cache is state-only, not rendered. */
  cacheView?: SemanticEntity["view"];
}

export class DeathSystem implements TickSystem {
  readonly name = "death";

  /** PRD section 3, row 10 ("Death"), scaled by ten. After health (90), before world (110). */
  readonly order = 100;

  private lastAtMs = 0;
  /** Guards against a second death being processed before the respawn lands. */
  private processing = false;

  constructor(private readonly deps: DeathDeps) {
    deps.dispatcher.registerHandler("loot", (context) => this.loot(context.entity));
  }

  // -------------------------------------------------------------------- tick

  tick(_deltaMs: number, atMs: number): void {
    this.lastAtMs = atMs;
    const state = this.deps.store.get();

    if (state.player.health <= 0 && !this.processing) this.die(state, atMs);

    this.expireCache(state, atMs);
    this.expireLootPiles(state, atMs);
  }

  // ------------------------------------------------------------------ death

  private die(state: GameState, atMs: number): void {
    this.processing = true;
    try {
      this.deps.activity?.cancel(atMs);
      this.deps.movement?.stop(state, atMs, "dead");
      this.deps.combat?.resetOnDeath(atMs);
      this.deps.enemyAi?.resetOnPlayerDeath(atMs);

      const deathPosition = cloneVec3(state.player.position);
      const deathRegion = state.player.regionId;
      const items = this.emptyInventory(state, atMs);

      // "Only one cache exists at a time, and dying with a live cache destroys the old one."
      this.destroyCache(state, "replaced", atMs);
      const cacheId = items.length > 0
        ? this.createCache(state, deathPosition, deathRegion, items, atMs)
        : null;

      const point = this.deps.respawn.resolve(state.player.respawnPointId, deathRegion);
      const target = point ?? { position: cloneVec3(DEFAULT_SPAWN), regionId: deathRegion };

      state.player.position = cloneVec3(target.position);
      state.player.regionId = target.regionId;
      state.player.movement = {
        mode: "idle", path: null, pathIndex: 0, destination: null, destinationEntityId: null,
      };
      if (this.deps.health) this.deps.health.restoreFull();
      else state.player.health = state.player.maxHealth;
      this.deps.store.markDirty();

      this.deps.events.emit(
        "player.died",
        {
          position: deathPosition,
          regionId: deathRegion,
          respawnPointId: state.player.respawnPointId,
          respawnPosition: cloneVec3(target.position),
          cacheId,
          itemsLost: items.length,
          expiresAtMs: cacheId ? atMs + RECOVERY_CACHE_TTL_MS : null,
        },
        cacheId ?? undefined,
        atMs,
      );
    } finally {
      this.processing = false;
    }
  }

  /** Takes every stack out of the 28 slots and hands them back. Currency is untouched. */
  private emptyInventory(state: GameState, atMs: number): ItemStack[] {
    const dropped: ItemStack[] = [];
    const slots = state.inventory.slots;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (!slot) continue;
      dropped.push({ itemId: slot.itemId, quantity: slot.quantity });
      slots[index] = null;
    }
    if (dropped.length > 0) {
      this.deps.store.markDirty();
      this.deps.events.emit(
        "item.lost",
        { reason: "death", items: dropped.map((row) => ({ itemId: row.itemId, quantity: row.quantity })) },
        undefined,
        atMs,
      );
    }
    return dropped;
  }

  // -------------------------------------------------------- recovery cache

  private createCache(
    state: GameState,
    position: Vec3,
    regionId: RegionId,
    items: ItemStack[],
    atMs: number,
  ): EntityId {
    const snapped = this.deps.snapToGround?.(position) ?? position;
    const expiresAtMs = atMs + RECOVERY_CACHE_TTL_MS;

    state.world.recoveryCache = {
      id: RECOVERY_CACHE_ID,
      position: cloneVec3(snapped),
      regionId,
      items,
      expiresAtMs,
    };
    this.deps.store.markDirty();

    const view = this.deps.cacheView;
    this.deps.entities.add?.({
      id: RECOVERY_CACHE_ID,
      archetype: "recovery_cache",
      name: "Recovery Cache",
      tier: 1,
      regionId,
      position: cloneVec3(snapped),
      state: "available",
      interactions: ["inspect", "loot"],
      ...(view ? { view } : {}),
      meta: {
        blurb: "Everything you were carrying when you died. It will not wait forever.",
        expiresAtMs,
        itemCount: items.length,
      },
    });

    return RECOVERY_CACHE_ID;
  }

  private destroyCache(state: GameState, reason: string, atMs: number): boolean {
    const cache = state.world.recoveryCache;
    if (!cache) return false;
    state.world.recoveryCache = null;
    this.deps.entities.remove?.(cache.id);
    this.deps.store.markDirty();
    if (cache.items.length > 0) {
      this.deps.events.emit(
        "item.lost",
        { reason, cacheId: cache.id, items: cache.items.map((row) => ({ ...row })) },
        cache.id,
        atMs,
      );
    }
    return true;
  }

  private expireCache(state: GameState, atMs: number): void {
    const cache = state.world.recoveryCache;
    if (!cache) return;
    if (atMs < cache.expiresAtMs) return;
    this.destroyCache(state, "expired", atMs);
  }

  private expireLootPiles(state: GameState, atMs: number): void {
    for (const [pileId, pile] of Object.entries(state.world.lootPiles)) {
      if (!pile || atMs < pile.expiresAtMs) continue;
      delete state.world.lootPiles[pileId];
      this.deps.entities.remove?.(pileId);
      this.deps.store.markDirty();
    }
  }

  // ------------------------------------------------------------------- loot

  /**
   * The `loot` interaction, for both container kinds. Partial pickups are a success with a message
   * rather than a failure: taking four of six stacks and being told so is more useful than being
   * refused because the last two would not fit.
   */
  loot(entity: SemanticEntity): Result<{ started: string }> {
    const state = this.deps.store.get();
    const atMs = this.lastAtMs;

    if (entity.archetype === "recovery_cache") {
      const cache = state.world.recoveryCache;
      if (!cache || cache.id !== entity.id) {
        return err("NOT_FOUND", "That cache is gone.", entity.id);
      }
      const moved = this.transfer(cache.items, entity.id, atMs);
      if (cache.items.length === 0) {
        state.world.recoveryCache = null;
        this.deps.entities.remove?.(entity.id);
        this.deps.store.markDirty();
        return ok({ started: `recovered ${moved} stack${moved === 1 ? "" : "s"}` });
      }
      this.deps.store.markDirty();
      if (moved === 0) return err("INVENTORY_FULL", "You have no room for anything in there.", entity.id);
      return ok({ started: `recovered ${moved} stacks, ${cache.items.length} left in the cache` });
    }

    const pile = state.world.lootPiles[entity.id];
    if (!pile) return err("NOT_FOUND", "There is nothing there.", entity.id);

    const moved = this.transfer(pile.items, entity.id, atMs);
    if (pile.items.length === 0) {
      delete state.world.lootPiles[entity.id];
      this.deps.entities.remove?.(entity.id);
      this.deps.store.markDirty();
      return ok({ started: `took ${moved} stack${moved === 1 ? "" : "s"}` });
    }
    this.deps.store.markDirty();
    if (moved === 0) return err("INVENTORY_FULL", "Your inventory is full.", entity.id);
    return ok({ started: `took ${moved} stacks, ${pile.items.length} left on the ground` });
  }

  /**
   * Moves what fits into the inventory and leaves the rest in place. Mutates `items` so a partial
   * pickup leaves the container holding exactly what is still in it.
   */
  private transfer(items: ItemStack[], sourceId: EntityId, atMs: number): number {
    let moved = 0;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const stack = items[index];
      if (!stack) {
        items.splice(index, 1);
        continue;
      }
      const added = this.deps.inventory.addItem(stack.itemId, stack.quantity);
      if (!added.ok || added.value <= 0) continue;

      if (added.value >= stack.quantity) {
        items.splice(index, 1);
      } else {
        stack.quantity -= added.value;
      }
      moved += 1;
      this.deps.events.emit(
        "item.received",
        { itemId: stack.itemId, quantity: added.value, from: sourceId },
        sourceId,
        atMs,
      );
    }
    return moved;
  }

  // -------------------------------------------------------------- read-only

  /** The live cache, for the HUD's countdown banner. Null when there is nothing to recover. */
  cache(): GameState["world"]["recoveryCache"] {
    return this.deps.store.get().world.recoveryCache;
  }

  /** Milliseconds until the cache expires, or null when there is no cache. */
  cacheRemainingMs(atMs: number = this.lastAtMs): number | null {
    const cache = this.deps.store.get().world.recoveryCache;
    if (!cache) return null;
    return Math.max(0, cache.expiresAtMs - atMs);
  }
}
