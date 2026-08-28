/**
 * Combat resolution — PRD 2.4, exactly.
 *
 * Two lines cover both directions of every fight in the game:
 *
 *   attackRoll  = (attackLevel  + 9) * (1 + gearAccuracy / 100) * styleFactor
 *   defenceRoll = (defenceLevel + 9) * (1 + gearArmour   / 100)
 *   hitChance   = clamp(attackRoll / (attackRoll + defenceRoll), 0.05, 0.95)
 *
 * There is no Defence skill. Physical defence uses the defender's **Melee** level plus worn
 * `armour`; magical defence uses **Magic** plus `magicArmour`. That is a settled root decision, and
 * it is why an enemy row carries one `defenceLevel` and two armour numbers rather than two levels.
 *
 * Combat is deliberately NOT an activity. It lives in `state.combat` so the player can eat, bank,
 * or have an agent issue any other call while auto-attacks keep resolving on the 600 ms combat
 * tick. Routing it through `systems/activity.ts` would make Ordrun unwinnable, because the boss
 * fight is a 165 s exchange that costs about nine pieces of food.
 *
 * Everything random goes through the seeded `combat` stream (hit rolls, damage rolls) and the
 * seeded `loot` stream (drop rolls), so a fight replays identically from a seed and a tick count.
 */
import type {
  EntityId, EquipSlot, EquipmentBonuses, GameErrorCode, ItemId, ItemStack, Result,
  SemanticEntity, SkillId, SpellId, Vec3,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import { addSkillXp } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { Rng, RngStreams } from "../core/rng.js";
import { COMBAT_TICK_MS } from "../core/time.js";
import { clamp, distanceXZ } from "../core/math.js";
import { HEALTH_REGEN_BLOCKED_MS, MELEE_RANGE, SPELL_RANGE } from "../app/config.js";
import type { InteractionDispatcher } from "../world/interactions.js";
import type { TickSystem } from "../app/loop.js";
import type { EnemyDef, SpellDef } from "../content/index.js";
import { content } from "../content/index.js";

// ------------------------------------------------------------------ tunables

/** PRD 2.4: melee swings at style factor 1.00, magic at 1.15. */
export const MELEE_STYLE_FACTOR = 1.0;
export const MAGIC_STYLE_FACTOR = 1.15;

/** PRD 2.4: 4 XP per point of damage, to whichever skill dealt it. */
export const XP_PER_DAMAGE = 4;

/** PRD 2.4: `round(target.maxHealth * 2.0)` on the kill. */
export const KILL_XP_MULTIPLIER = 2.0;

/** Bare fists swing on the standard 2.4 s cadence, i.e. every 4 combat ticks. */
export const UNARMED_ATTACK_SPEED_MS = 2_400;

/** How far the player will walk to keep an auto-attack alive before giving up. */
export const MAX_PURSUE_METRES = 32;

/** An enemy needs to be a little inside melee range to land a swing. */
export const ENEMY_ATTACK_RANGE = MELEE_RANGE + 0.4;

/** Enemy corpses come back on a timer. Content carries no respawn field, so these are the default. */
export const ENEMY_RESPAWN_MS = 30_000;
export const BOSS_RESPAWN_MS = 180_000;

/** Drops sit on the floor for two minutes before the world sweeps them (PRD section 3, row 11). */
export const LOOT_DESPAWN_MS = 120_000;

/** Ceiling on catch-up combat ticks in one sim tick, so `advanceGameTime(3600)` cannot hang. */
const MAX_CATCHUP_TICKS = 400;

/** How many recent hits the render layer can read back for damage numbers. */
const HIT_LOG_CAPACITY = 32;

// --------------------------------------------------------------- pure maths

export function attackRoll(attackLevel: number, gearAccuracy: number, styleFactor: number): number {
  return (attackLevel + 9) * (1 + gearAccuracy / 100) * styleFactor;
}

export function defenceRoll(defenceLevel: number, gearArmour: number): number {
  return (defenceLevel + 9) * (1 + gearArmour / 100);
}

export function hitChance(attack: number, defence: number): number {
  const total = attack + defence;
  if (total <= 0) return 0.05;
  return clamp(attack / total, 0.05, 0.95);
}

/** PRD 2.4. Melee 1 unarmed is 2; Melee 10 with a +26 Kaldite sword is 10. */
export function meleeMaxHit(meleeLevel: number, gearPower: number): number {
  return Math.floor(2 + (meleeLevel + gearPower) / 4.2);
}

/** PRD 2.4. Voltrend (baseMax 8, divisor 6) at Magic 10 with +26 magic power is 14. */
export function magicMaxHit(magicLevel: number, gearMagicPower: number, spell: SpellDef): number {
  return Math.floor(spell.baseMax + (magicLevel + gearMagicPower) / spell.divisor);
}

/**
 * A weapon's cadence in whole combat ticks. PRD 2.4: "a weapon with speed 2.4 s attacks every
 * 4 combat ticks", and a 3.0 s cast is 5 ticks.
 */
export function attackIntervalMs(attackSpeedMs: number): number {
  const ticks = Math.max(1, Math.round(attackSpeedMs / COMBAT_TICK_MS));
  return ticks * COMBAT_TICK_MS;
}

/** Expected damage per swing: `hitChance * mean(1..maxHit)`. A hit always deals at least 1. */
export function expectedDamagePerSwing(chance: number, maxHit: number): number {
  const top = Math.max(1, maxHit);
  return chance * ((1 + top) / 2);
}

export interface TimeToKillInput {
  hitChance: number;
  maxHit: number;
  intervalMs: number;
  targetHealth: number;
}

/**
 * Expected time to kill in milliseconds. Exported because it is the number the PRD's balance table
 * is written in, and because the skill guide and `__gameDebug` both want to quote it.
 */
export function expectedTimeToKillMs(input: TimeToKillInput): number {
  const perSwing = expectedDamagePerSwing(input.hitChance, input.maxHit);
  if (perSwing <= 0) return Number.POSITIVE_INFINITY;
  return (input.targetHealth / perSwing) * input.intervalMs;
}

// ------------------------------------------------------------------- ports

/**
 * The slice of `world/entities.ts` combat needs. Injected, never imported: that file belongs to
 * another owner and this system must stay constructible from a literal object in a test.
 */
export interface CombatEntityPort {
  get(id: EntityId): SemanticEntity | undefined;
  all(): SemanticEntity[];
  /** Optional. Without it, kills still record drops in `state.world.lootPiles`, just unrendered. */
  add?(entity: SemanticEntity): void;
  remove?(id: EntityId): boolean;
  setPosition?(id: EntityId, position: Vec3): boolean;
  setState?(id: EntityId, state: string): boolean;
}

/** Satisfied exactly by `EquipmentSystem` in systems/equipment.ts. */
export interface CombatEquipmentPort {
  totals(): EquipmentBonuses;
  slots(): Record<EquipSlot, ItemStack | null>;
}

/** Satisfied exactly by `InventorySystem` in systems/inventory.ts. */
export interface CombatInventoryPort {
  addItem(itemId: ItemId, quantity: number): Result<number>;
  removeItem(itemId: ItemId, quantity: number): Result<number>;
  countItem(itemId: ItemId): number;
  freeSlots(): number;
  hasRoomFor(itemId: ItemId, quantity: number): boolean;
  /** Optional. Falls back to writing `state.currency` directly. */
  addCurrency?(amount: number): Result<number>;
}

/** Satisfied exactly by `Movement` in systems/movement.ts. Used only to walk back into range. */
export interface CombatMovementPort {
  startPath(
    state: GameState,
    destination: Vec3,
    entityId: EntityId | null,
    atMs: number,
  ): { pathLength: number; etaMs: number } | null;
  stop(state: GameState, atMs: number, reason?: string): boolean;
}

/**
 * Satisfied exactly by `ActivitySystem` in systems/activity.ts. Combat is not an activity, but
 * starting a fight cancels a gather the way a click on an enemy would.
 */
export interface CombatActivityPort {
  current(): { kind: string } | null;
  cancel(atMs?: number): boolean;
}

/** One resolved swing, for damage numbers and hit sparks. The render layer polls; it never writes. */
export interface CombatHit {
  atMs: number;
  attacker: "player" | "enemy";
  sourceId: EntityId;
  targetId: EntityId;
  damage: number;
  hit: boolean;
  maxHit: number;
  kind: "melee" | "magic" | "special";
  killed: boolean;
}

export interface CombatDeps {
  store: Store;
  events: EventBus;
  rng: RngStreams;
  entities: CombatEntityPort;
  equipment: CombatEquipmentPort;
  inventory: CombatInventoryPort;
  dispatcher: InteractionDispatcher;
  movement?: CombatMovementPort;
  activity?: CombatActivityPort;
  /** View block stamped onto spawned loot piles. Omitted means the pile is state-only. */
  lootView?: SemanticEntity["view"];
}

/** Live enemy runtime, mirroring `state.world.enemies` exactly. */
type EnemyRuntime = NonNullable<GameState["world"]["enemies"][string]>;

// ------------------------------------------------------------------ system

export class CombatSystem implements TickSystem {
  readonly name = "combat";

  /** PRD section 3, row 8 ("Combat"), scaled by ten. After enemy AI (70), before health (90). */
  readonly order = 80;

  private readonly combatRng: Rng;
  private readonly lootRng: Rng;

  /** Enemy swing timers. Runtime scratch; the frozen enemy record has no room for them. */
  private readonly enemyNextAttackAtMs = new Map<EntityId, number>();
  /** Per-enemy cadence multiplier, so a boss phase can speed an enemy up without new state. */
  private readonly enemySpeedScale = new Map<EntityId, number>();
  private readonly defCache = new Map<EntityId, EnemyDef>();
  private readonly provokeListeners: ((enemyId: EntityId, atMs: number) => void)[] = [];
  private readonly hitLog: CombatHit[] = [];

  private nextCombatTickAtMs = -1;
  private lastAtMs = 0;
  private pileSequence = 0;

  constructor(private readonly deps: CombatDeps) {
    this.combatRng = deps.rng.get("combat");
    this.lootRng = deps.rng.get("loot");

    deps.dispatcher.registerHandler("attack", (context) =>
      started(this.attack(context.entity.id), `attacking ${context.entity.name}`));

    deps.dispatcher.registerHandler("cast", (context) => {
      const spellId = this.preferredSpellId();
      if (!spellId) {
        return err(
          "REQUIREMENTS_NOT_MET",
          "You have no spell you can cast: check your Magic level and your essence shards.",
          context.entity.id,
        );
      }
      return started(this.cast(spellId, context.entity.id), `casting ${spellId} at ${context.entity.name}`);
    });
  }

  /** Satisfies `SystemHooks.combat` in api/gameApi.ts. */
  hook(): {
    attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }>;
    cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }>;
  } {
    return {
      attack: (entityId) => this.attack(entityId),
      cast: (spellId, entityId) => this.cast(spellId, entityId),
    };
  }

  // -------------------------------------------------------------- commands

  attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }> {
    const state = this.deps.store.get();
    const atMs = this.lastAtMs;
    if (state.player.health <= 0) return err("DEAD", "You are dead.");

    const entity = this.deps.entities.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);

    const problem = this.rejectTarget(entity);
    if (problem) return err(problem.code, problem.message, entity.id);

    const gap = distanceXZ(state.player.position, entity.position);
    if (gap > MAX_PURSUE_METRES) {
      return err(
        "OUT_OF_RANGE",
        `${entity.name} is ${gap.toFixed(1)} m away; walk closer than ${MAX_PURSUE_METRES} m first.`,
        entityId,
      );
    }

    const speedMs = this.weaponSpeedMs();
    this.engagePlayer(state, entity, null, atMs);
    if (gap > MELEE_RANGE) this.pursue(state, entity, atMs);
    return ok({ targetId: entity.id, attackSpeedMs: attackIntervalMs(speedMs) });
  }

  cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }> {
    const state = this.deps.store.get();
    const atMs = this.lastAtMs;
    if (state.player.health <= 0) return err("DEAD", "You are dead.");

    const spell = content.spell(spellId);
    if (!spell) return err("NOT_FOUND", `No spell with id ${spellId}`);
    if (state.skills.magic.level < spell.reqLevel) {
      return err("REQUIREMENTS_NOT_MET", `${spell.name} needs Magic ${spell.reqLevel}.`);
    }
    if (this.deps.inventory.countItem(spell.cost.itemId) < spell.cost.quantity) {
      return err("NOT_ENOUGH_ITEMS", `${spell.name} costs ${spell.cost.quantity} ${spell.cost.itemId}.`);
    }

    const entity = this.deps.entities.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);

    const problem = this.rejectTarget(entity);
    if (problem) return err(problem.code, problem.message, entity.id);

    const gap = distanceXZ(state.player.position, entity.position);
    if (gap > MAX_PURSUE_METRES) {
      return err(
        "OUT_OF_RANGE",
        `${entity.name} is ${gap.toFixed(1)} m away; ${spell.name} reaches ${SPELL_RANGE} m.`,
        entityId,
      );
    }

    this.engagePlayer(state, entity, spell.id, atMs);
    if (gap > SPELL_RANGE) this.pursue(state, entity, atMs);
    return ok({ targetId: entity.id, castMs: attackIntervalMs(spell.castMs) });
  }

  /** The player-facing disengage. `GameApi.stop()` has its own copy; both are safe. */
  disengagePlayer(reason: string, atMs = this.lastAtMs): boolean {
    const state = this.deps.store.get();
    const targetId = state.combat.targetId;
    if (!targetId) return false;
    state.combat.targetId = null;
    state.combat.activeSpellId = null;
    this.deps.store.markDirty();
    this.deps.events.emit("combat.ended", { reason }, targetId, atMs);
    return true;
  }

  // ------------------------------------------------------------------ tick

  tick(_deltaMs: number, atMs: number): void {
    this.lastAtMs = atMs;
    if (this.nextCombatTickAtMs < 0) this.nextCombatTickAtMs = atMs;

    let guard = 0;
    while (atMs >= this.nextCombatTickAtMs && guard < MAX_CATCHUP_TICKS) {
      this.resolveCombatTick(this.nextCombatTickAtMs);
      this.nextCombatTickAtMs += COMBAT_TICK_MS;
      guard += 1;
    }
    // A debug time jump larger than the catch-up budget resyncs rather than accumulating debt.
    if (atMs > this.nextCombatTickAtMs) this.nextCombatTickAtMs = atMs + COMBAT_TICK_MS;
  }

  private resolveCombatTick(atMs: number): void {
    const state = this.deps.store.get();
    if (state.player.health <= 0) {
      if (state.combat.targetId) this.disengagePlayer("dead", atMs);
      return;
    }
    this.resolvePlayerSwing(state, atMs);
    this.resolveEnemySwings(state, atMs);
  }

  // --------------------------------------------------------- player swings

  private resolvePlayerSwing(state: GameState, atMs: number): void {
    const targetId = state.combat.targetId;
    if (!targetId) return;

    const entity = this.deps.entities.get(targetId);
    if (!entity || entity.archetype === "loot" || entity.archetype === "recovery_cache") {
      this.disengagePlayer("target-gone", atMs);
      return;
    }
    const runtime = this.runtimeFor(state, entity);
    if (runtime.state === "dead" || runtime.health <= 0 || entity.state === "dead") {
      this.disengagePlayer("target-dead", atMs);
      return;
    }

    const spellId = state.combat.activeSpellId;
    const spell = spellId ? content.spell(spellId) : undefined;
    const range = spell ? SPELL_RANGE : MELEE_RANGE;
    const gap = distanceXZ(state.player.position, entity.position);

    if (gap > range) {
      if (!this.pursue(state, entity, atMs)) this.disengagePlayer("out-of-range", atMs);
      return;
    }

    // Eating blocks attacks for its 1.8 s, per PRD 2.7. The engagement survives it.
    if (state.activity?.kind === "eating") return;
    if (atMs < state.combat.nextAttackAtMs) return;

    const def = this.defFor(entity);
    const gear = this.deps.equipment.totals();

    let skill: SkillId;
    let chance: number;
    let maxHit: number;
    let intervalMs: number;

    if (spell) {
      const paid = this.deps.inventory.removeItem(spell.cost.itemId, spell.cost.quantity);
      if (!paid.ok || paid.value < spell.cost.quantity) {
        this.disengagePlayer("out-of-essence", atMs);
        return;
      }
      skill = "magic";
      chance = hitChance(
        attackRoll(state.skills.magic.level, gear.magicAccuracy, MAGIC_STYLE_FACTOR),
        defenceRoll(def.defenceLevel, def.magicArmour),
      );
      maxHit = magicMaxHit(state.skills.magic.level, gear.magicPower, spell);
      intervalMs = attackIntervalMs(spell.castMs);
      // PRD 2.4: a cast awards its base XP hit or miss.
      this.awardXp(state, "magic", spell.baseXp, atMs);
    } else {
      skill = "melee";
      chance = hitChance(
        attackRoll(state.skills.melee.level, gear.accuracy, MELEE_STYLE_FACTOR),
        defenceRoll(def.defenceLevel, def.armour),
      );
      maxHit = meleeMaxHit(state.skills.melee.level, gear.power);
      intervalMs = attackIntervalMs(this.weaponSpeedMs());
    }

    state.combat.nextAttackAtMs = atMs + intervalMs;
    this.markInCombat(state, atMs);

    const landed = this.combatRng.chance(chance);
    const damage = landed ? Math.max(1, this.combatRng.int(1, Math.max(1, maxHit))) : 0;

    let killed = false;
    if (damage > 0) {
      this.awardXp(state, skill, damage * XP_PER_DAMAGE, atMs);
      killed = this.applyEnemyDamage(state, entity, runtime, damage, skill, atMs);
    }

    this.record({
      atMs,
      attacker: "player",
      sourceId: state.player.id,
      targetId: entity.id,
      damage,
      hit: landed,
      maxHit,
      kind: spell ? "magic" : "melee",
      killed,
    });

    // A struck enemy always fights back, whatever its behaviour says.
    for (const listener of this.provokeListeners) listener(entity.id, atMs);
    this.deps.store.markDirty();
  }

  /**
   * Walks the player back into range so an auto-attack survives a step. Returns false when the
   * engagement should end: no movement port, the target ran too far, or the player issued another
   * command (which is exactly "moving somewhere that is not the target").
   */
  private pursue(state: GameState, entity: SemanticEntity, atMs: number): boolean {
    const move = this.deps.movement;
    if (!move) return false;

    const movement = state.player.movement;
    if (movement.mode !== "idle") return movement.destinationEntityId === entity.id;
    if (distanceXZ(state.player.position, entity.position) > MAX_PURSUE_METRES) return false;

    return move.startPath(state, entity.position, entity.id, atMs) !== null;
  }

  // ---------------------------------------------------------- enemy swings

  private resolveEnemySwings(state: GameState, atMs: number): void {
    if (state.combat.engagedBy.length === 0) return;

    for (const enemyId of [...state.combat.engagedBy]) {
      const entity = this.deps.entities.get(enemyId);
      if (!entity) {
        this.disengageEnemy(state, enemyId, atMs);
        continue;
      }
      const runtime = this.runtimeFor(state, entity);
      if (runtime.state === "dead" || runtime.health <= 0 || entity.state === "dead") {
        this.disengageEnemy(state, enemyId, atMs);
        continue;
      }

      const def = this.defFor(entity);
      const gap = distanceXZ(state.player.position, entity.position);

      // Being hunted blocks regeneration even while the enemy is still closing (PRD 2.3).
      this.markInCombat(state, atMs);
      if (gap > ENEMY_ATTACK_RANGE) continue;

      const scale = this.enemySpeedScale.get(enemyId) ?? 1;
      const intervalMs = attackIntervalMs(def.attackSpeedMs * scale);
      const due = this.enemyNextAttackAtMs.get(enemyId);
      if (due === undefined) {
        // First swing lands one full cadence after contact, not on the frame the enemy arrives.
        this.enemyNextAttackAtMs.set(enemyId, atMs + intervalMs);
        continue;
      }
      if (atMs < due) continue;
      this.enemyNextAttackAtMs.set(enemyId, atMs + intervalMs);

      const gear = this.deps.equipment.totals();
      const chance = hitChance(
        attackRoll(def.attackLevel, def.accuracy, MELEE_STYLE_FACTOR),
        defenceRoll(state.skills.melee.level, gear.armour),
      );
      const landed = this.combatRng.chance(chance);
      const damage = landed ? Math.max(1, this.combatRng.int(1, Math.max(1, def.maxHit))) : 0;

      this.damagePlayer(damage, enemyId, atMs, "melee", def.maxHit);
      if (state.player.health <= 0) return;
    }
  }

  // --------------------------------------------------------- damage, death

  /**
   * The one path player damage takes. `systems/enemyAI.ts` uses it for Ordrun's ground slam, so a
   * special attack and an ordinary swing hit the same clamps, the same in-combat stamp, and the
   * same hit log.
   */
  damagePlayer(
    amount: number,
    sourceId: EntityId,
    atMs: number,
    kind: CombatHit["kind"] = "melee",
    maxHit = amount,
  ): void {
    const state = this.deps.store.get();
    this.markInCombat(state, atMs);
    const damage = Math.max(0, Math.floor(amount));

    if (damage > 0) {
      state.player.health = Math.max(0, state.player.health - damage);
      this.deps.store.markDirty();
    }
    this.record({
      atMs,
      attacker: "enemy",
      sourceId,
      targetId: state.player.id,
      damage,
      hit: damage > 0,
      maxHit,
      kind,
      killed: state.player.health <= 0,
    });
  }

  /** Public so a quest script or a debug hook can hurt an enemy without duplicating the death path. */
  damageEnemy(entityId: EntityId, amount: number, atMs: number, skill: SkillId | null = null): boolean {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(entityId);
    if (!entity) return false;
    const runtime = this.runtimeFor(state, entity);
    if (runtime.state === "dead") return false;
    return this.applyEnemyDamage(state, entity, runtime, Math.max(0, Math.floor(amount)), skill, atMs);
  }

  /** Returns true when this blow killed the target. */
  private applyEnemyDamage(
    state: GameState,
    entity: SemanticEntity,
    runtime: EnemyRuntime,
    damage: number,
    skill: SkillId | null,
    atMs: number,
  ): boolean {
    if (damage <= 0) return false;
    runtime.health = Math.max(0, runtime.health - damage);
    if (entity.combat) entity.combat.health = runtime.health;
    this.deps.store.markDirty();
    if (runtime.health > 0) return false;
    this.killEnemy(state, entity, runtime, skill, atMs);
    return true;
  }

  private killEnemy(
    state: GameState,
    entity: SemanticEntity,
    runtime: EnemyRuntime,
    skill: SkillId | null,
    atMs: number,
  ): void {
    const def = this.defFor(entity);
    const maxHealth = entity.combat?.maxHealth ?? def.maxHealth;

    runtime.health = 0;
    runtime.state = "dead";
    runtime.respawnAtMs = atMs + (entity.archetype === "boss" ? BOSS_RESPAWN_MS : ENEMY_RESPAWN_MS);
    entity.state = "dead";
    if (entity.combat) entity.combat.health = 0;
    this.deps.entities.setState?.(entity.id, "dead");

    if (skill) this.awardXp(state, skill, Math.round(maxHealth * KILL_XP_MULTIPLIER), atMs);

    this.enemyNextAttackAtMs.delete(entity.id);
    this.enemySpeedScale.delete(entity.id);
    this.disengageEnemy(state, entity.id, atMs, false);

    this.rollDrops(state, entity, def, atMs);

    this.deps.events.emit(
      "combat.ended",
      { reason: "killed", enemyId: entity.id, name: entity.name, xp: Math.round(maxHealth * KILL_XP_MULTIPLIER) },
      entity.id,
      atMs,
    );
    if (state.combat.targetId === entity.id) {
      state.combat.targetId = null;
      state.combat.activeSpellId = null;
    }
    this.deps.store.markDirty();
  }

  /** Drop rolls run on the seeded `loot` stream so a kill never shifts the next hit roll. */
  private rollDrops(state: GameState, entity: SemanticEntity, def: EnemyDef, atMs: number): void {
    const items: ItemStack[] = [];
    for (const drop of def.drops) {
      if (!this.lootRng.chance(drop.chance)) continue;
      const quantity = this.lootRng.int(drop.quantity[0], drop.quantity[1]);
      if (quantity > 0) items.push({ itemId: drop.itemId, quantity });
    }

    if (def.marks) {
      const marks = this.lootRng.int(def.marks[0], def.marks[1]);
      if (marks > 0) {
        const added = this.deps.inventory.addCurrency?.(marks);
        if (!added || !added.ok) state.currency += marks;
        this.deps.events.emit("item.received", { currency: marks, from: entity.id }, entity.id, atMs);
      }
    }

    if (items.length === 0) return;

    this.pileSequence += 1;
    const pileId = `loot_${entity.id}_${this.pileSequence}`;
    state.world.lootPiles[pileId] = {
      position: cloneVec3(entity.position),
      items,
      expiresAtMs: atMs + LOOT_DESPAWN_MS,
      ownerOnly: true,
    };

    const view = this.deps.lootView;
    this.deps.entities.add?.({
      id: pileId,
      archetype: "loot",
      name: `${entity.name}'s drop`,
      tier: entity.tier,
      regionId: entity.regionId,
      position: cloneVec3(entity.position),
      state: "available",
      interactions: ["inspect", "loot"],
      ...(view ? { view } : {}),
      meta: { droppedBy: entity.id, expiresAtMs: state.world.lootPiles[pileId]?.expiresAtMs ?? 0 },
    });

    this.deps.events.emit(
      "item.received",
      { pileId, items: items.map((row) => ({ itemId: row.itemId, quantity: row.quantity })) },
      pileId,
      atMs,
    );
  }

  // ------------------------------------------------------ engagement state

  /** Adds an enemy to `state.combat.engagedBy`. `systems/enemyAI.ts` is the only real caller. */
  engageEnemy(enemyId: EntityId, atMs: number): void {
    const state = this.deps.store.get();
    if (!state.combat.engagedBy.includes(enemyId)) {
      state.combat.engagedBy.push(enemyId);
      this.deps.events.emit("combat.started", { by: enemyId, initiator: "enemy" }, enemyId, atMs);
      this.deps.store.markDirty();
    }
    this.markInCombat(state, atMs);
  }

  disengageEnemy(state: GameState, enemyId: EntityId, atMs: number, emit = true): void {
    const index = state.combat.engagedBy.indexOf(enemyId);
    if (index >= 0) {
      state.combat.engagedBy.splice(index, 1);
      if (emit) this.deps.events.emit("combat.ended", { reason: "disengaged", enemyId }, enemyId, atMs);
      this.deps.store.markDirty();
    }
    this.enemyNextAttackAtMs.delete(enemyId);
  }

  isEngaged(enemyId: EntityId): boolean {
    return this.deps.store.get().combat.engagedBy.includes(enemyId);
  }

  playerTargetId(): EntityId | null {
    return this.deps.store.get().combat.targetId;
  }

  /** A boss phase can speed an enemy up without adding a field to the frozen enemy record. */
  setEnemySpeedScale(enemyId: EntityId, scale: number): void {
    if (scale === 1) this.enemySpeedScale.delete(enemyId);
    else this.enemySpeedScale.set(enemyId, Math.max(0.2, scale));
  }

  /** `systems/enemyAI.ts` subscribes so a territorial enemy retaliates when struck. */
  onEnemyProvoked(listener: (enemyId: EntityId, atMs: number) => void): () => void {
    this.provokeListeners.push(listener);
    return () => {
      const index = this.provokeListeners.indexOf(listener);
      if (index >= 0) this.provokeListeners.splice(index, 1);
    };
  }

  /** Stamps the eight-second no-regen window in PRD 2.3. Also what `PlayerView.inCombat` reads. */
  markInCombat(state: GameState, atMs: number): void {
    const until = atMs + HEALTH_REGEN_BLOCKED_MS;
    if (until > state.combat.inCombatUntilMs) {
      state.combat.inCombatUntilMs = until;
      this.deps.store.markDirty();
    }
  }

  /** Called by `systems/death.ts` on respawn: nothing survives a death. */
  resetOnDeath(atMs: number): void {
    const state = this.deps.store.get();
    for (const enemyId of [...state.combat.engagedBy]) this.disengageEnemy(state, enemyId, atMs, false);
    state.combat.engagedBy.length = 0;
    state.combat.targetId = null;
    state.combat.activeSpellId = null;
    state.combat.nextAttackAtMs = 0;
    state.combat.inCombatUntilMs = 0;
    this.enemyNextAttackAtMs.clear();
    this.enemySpeedScale.clear();
    this.deps.store.markDirty();
  }

  // ------------------------------------------------------------ read-only

  /** Recent swings, newest last. `render/vfx.ts` polls this for damage numbers. */
  hits(): readonly CombatHit[] {
    return this.hitLog;
  }

  /** Drains the hit log. A renderer that has consumed the frame's hits calls this. */
  consumeHits(): CombatHit[] {
    return this.hitLog.splice(0, this.hitLog.length);
  }

  /**
   * What the player would do to this enemy right now, and it to them. The skill guide, the UI
   * "danger" readout, and the balance checks all want the same four numbers.
   */
  forecast(entityId: EntityId, spellId?: SpellId): {
    hitChance: number;
    maxHit: number;
    intervalMs: number;
    timeToKillMs: number;
    incomingDps: number;
  } | undefined {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(entityId);
    if (!entity) return undefined;
    const def = this.defFor(entity);
    const gear = this.deps.equipment.totals();
    const spell = spellId ? content.spell(spellId) : undefined;

    const chance = spell
      ? hitChance(
        attackRoll(state.skills.magic.level, gear.magicAccuracy, MAGIC_STYLE_FACTOR),
        defenceRoll(def.defenceLevel, def.magicArmour),
      )
      : hitChance(
        attackRoll(state.skills.melee.level, gear.accuracy, MELEE_STYLE_FACTOR),
        defenceRoll(def.defenceLevel, def.armour),
      );
    const maxHit = spell
      ? magicMaxHit(state.skills.magic.level, gear.magicPower, spell)
      : meleeMaxHit(state.skills.melee.level, gear.power);
    const intervalMs = attackIntervalMs(spell ? spell.castMs : this.weaponSpeedMs());
    const health = entity.combat?.maxHealth ?? def.maxHealth;

    const enemyChance = hitChance(
      attackRoll(def.attackLevel, def.accuracy, MELEE_STYLE_FACTOR),
      defenceRoll(state.skills.melee.level, gear.armour),
    );
    const incomingDps = expectedDamagePerSwing(enemyChance, def.maxHit)
      / (attackIntervalMs(def.attackSpeedMs) / 1000);

    return {
      hitChance: chance,
      maxHit,
      intervalMs,
      timeToKillMs: expectedTimeToKillMs({ hitChance: chance, maxHit, intervalMs, targetHealth: health }),
      incomingDps,
    };
  }

  /** The content row behind a spawned enemy. Public so enemy AI reads the same resolution. */
  defFor(entity: SemanticEntity): EnemyDef {
    const cached = this.defCache.get(entity.id);
    if (cached) return cached;
    const resolved = resolveEnemyDef(entity);
    this.defCache.set(entity.id, resolved);
    return resolved;
  }

  /** Ensures `state.world.enemies[id]` exists, seeded from the entity's authored spawn. */
  runtimeFor(state: GameState, entity: SemanticEntity): EnemyRuntime {
    const existing = state.world.enemies[entity.id];
    if (existing) return existing;
    const created: EnemyRuntime = {
      health: entity.combat?.health ?? entity.combat?.maxHealth ?? this.defFor(entity).maxHealth,
      state: "idle",
      spawnPos: spawnPositionOf(entity),
      respawnAtMs: null,
    };
    state.world.enemies[entity.id] = created;
    this.deps.store.markDirty();
    return created;
  }

  // ------------------------------------------------------------- internals

  private rejectTarget(entity: SemanticEntity): { code: GameErrorCode; message: string } | undefined {
    if (entity.archetype !== "enemy" && entity.archetype !== "boss") {
      return { code: "INVALID_ARGUMENT", message: `${entity.name} is not something you can attack.` };
    }
    if (entity.state === "dead") {
      return { code: "INVALID_ARGUMENT", message: `${entity.name} is already dead.` };
    }
    return undefined;
  }

  private engagePlayer(
    state: GameState,
    entity: SemanticEntity,
    spellId: SpellId | null,
    atMs: number,
  ): void {
    // A new command replaces the old one; the previous target's `combat.ended` still fires.
    if (state.combat.targetId && state.combat.targetId !== entity.id) {
      this.disengagePlayer("switched-target", atMs);
    }

    const current = this.deps.activity?.current();
    if (current && current.kind !== "eating") this.deps.activity?.cancel(atMs);

    state.combat.targetId = entity.id;
    state.combat.activeSpellId = spellId;
    state.combat.nextAttackAtMs = atMs;
    this.runtimeFor(state, entity);
    this.markInCombat(state, atMs);
    this.deps.store.markDirty();

    this.deps.events.emit(
      "combat.started",
      { targetId: entity.id, name: entity.name, initiator: "player", spellId },
      entity.id,
      atMs,
    );
    for (const listener of this.provokeListeners) listener(entity.id, atMs);
  }

  /** The equipped main-hand's cadence, or bare fists at 2.4 s. */
  private weaponSpeedMs(): number {
    const worn = this.deps.equipment.slots().mainHand;
    if (!worn) return UNARMED_ATTACK_SPEED_MS;
    return content.item(worn.itemId)?.equip?.attackSpeedMs ?? UNARMED_ATTACK_SPEED_MS;
  }

  /** Highest-tier spell the player meets the level for and can pay for. */
  private preferredSpellId(): SpellId | undefined {
    const state = this.deps.store.get();
    const active = state.combat.activeSpellId;
    if (active) {
      const spell = content.spell(active);
      if (spell
        && state.skills.magic.level >= spell.reqLevel
        && this.deps.inventory.countItem(spell.cost.itemId) >= spell.cost.quantity) {
        return spell.id;
      }
    }
    let best: SpellDef | undefined;
    for (const spell of content.allSpells()) {
      if (state.skills.magic.level < spell.reqLevel) continue;
      if (this.deps.inventory.countItem(spell.cost.itemId) < spell.cost.quantity) continue;
      if (!best || spell.tier > best.tier || (spell.tier === best.tier && spell.reqLevel > best.reqLevel)) {
        best = spell;
      }
    }
    return best?.id;
  }

  /** XP always goes through `addSkillXp` so the level curve and `level.gained` stay honest. */
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

  private record(hit: CombatHit): void {
    this.hitLog.push(hit);
    if (this.hitLog.length > HIT_LOG_CAPACITY) this.hitLog.splice(0, this.hitLog.length - HIT_LOG_CAPACITY);
  }
}

// ---------------------------------------------------------------- helpers

function started(
  result: Result<{ targetId: EntityId }>,
  message: string,
): Result<{ started: string }> {
  if (!result.ok) return result;
  return ok({ started: message });
}

export function cloneVec3(value: Vec3): Vec3 {
  return [value[0], value[1], value[2]];
}

/** The authored spawn point, from `meta.spawnX/spawnZ` when the region builder recorded it. */
export function spawnPositionOf(entity: SemanticEntity): Vec3 {
  const meta = entity.meta;
  const x = meta?.spawnX;
  const z = meta?.spawnZ;
  if (typeof x === "number" && typeof z === "number") return [x, entity.position[1], z];
  return cloneVec3(entity.position);
}

export function behaviourOf(entity: SemanticEntity): EnemyDef["behaviour"] {
  const raw = entity.meta?.behaviour;
  if (raw === "passive" || raw === "aggressive" || raw === "territorial") return raw;
  return entity.archetype === "boss" ? "territorial" : "aggressive";
}

/**
 * Maps a spawned entity onto its content row.
 *
 * The region builder names instances `${groupId}_${index}` and stashes `groupId` and `family` in
 * `meta`, so several ids are plausible and content is authored by a different worker. Every
 * candidate is tried before falling back to a row synthesised from the entity's own combat block,
 * which keeps a content gap a balance problem rather than a crash.
 */
export function resolveEnemyDef(entity: SemanticEntity): EnemyDef {
  for (const candidate of enemyDefCandidates(entity)) {
    const def = content.enemy(candidate);
    if (def) return def;
  }
  return synthesiseEnemyDef(entity);
}

function enemyDefCandidates(entity: SemanticEntity): string[] {
  const out: string[] = [];
  const meta = entity.meta;
  if (meta) {
    for (const key of ["enemyId", "enemyDefId", "defId", "groupId", "family"]) {
      const value = meta[key];
      if (typeof value === "string" && value.length > 0) out.push(value);
    }
  }
  out.push(entity.id);
  out.push(entity.id.replace(/_\d+$/, ""));
  out.push(slug(entity.name));
  return out;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** A believable row for an enemy content has not authored yet. Never wins over a real row. */
function synthesiseEnemyDef(entity: SemanticEntity): EnemyDef {
  const level = entity.combat?.level ?? Math.max(1, entity.tier);
  const maxHealth = entity.combat?.maxHealth ?? 10 + level * 2;
  return {
    id: entity.id,
    name: entity.name,
    family: typeof entity.meta?.family === "string" ? entity.meta.family : "unknown",
    tier: entity.tier,
    maxHealth,
    attackLevel: level,
    defenceLevel: level,
    accuracy: level * 2,
    armour: level * 2,
    magicArmour: level * 2,
    maxHit: Math.max(1, Math.floor(1 + level / 3)),
    attackSpeedMs: UNARMED_ATTACK_SPEED_MS,
    aggroRadius: entity.combat?.aggroRadius ?? 6,
    behaviour: behaviourOf(entity),
    drops: [],
  };
}
