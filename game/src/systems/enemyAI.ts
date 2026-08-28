/**
 * Enemy behaviour: aggro, pursuit, leash, respawn, and Ordrun's two phases.
 *
 * Three behaviours, straight from the content row:
 *
 *  - `passive`      never initiates. It fights back once struck, and stops when the player leaves.
 *  - `aggressive`   attacks anything alive inside `aggroRadius` (content authors 6 m to 14 m).
 *  - `territorial`  attacks only once attacked, and then pursues.
 *
 * All three leash at 28 m from their spawn point and walk home, which is the rule that makes a
 * dungeon chamber a place rather than a conga line.
 *
 * This file decides *who is fighting whom and where they stand*. `systems/combat.ts` decides *what
 * a swing does*, and the two are separate objects because PRD section 3 has them as separate rows:
 * AI is row 7, combat is row 8. The one exception is Ordrun's ground slam, which is a special
 * attack owned here and applied through `CombatSystem.damagePlayer`, so it lands on the same
 * clamps and the same hit log as an ordinary swing.
 *
 * The boss telegraph is exposed as readable state, never as a render call: `bossPhase` in
 * `state.world.enemies[id]`, plus `telegraphs()` and `onTelegraph()` on this class. Nothing here
 * knows a mesh exists.
 */
import type { EntityId, SemanticEntity, Vec3 } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { TickSystem } from "../app/loop.js";
import { distanceXZ } from "../core/math.js";
import type { EnemyDef } from "../content/index.js";
import type { BossPhase } from "../content/enemies.js";
import { ORDRUN_PHASES } from "../content/enemies.js";
import type { CombatEntityPort, CombatSystem } from "./combat.js";
import { cloneVec3, spawnPositionOf } from "./combat.js";

// ------------------------------------------------------------------ tunables

/** PRD 2.4: enemies leash at 28 m from their spawn point. */
export const LEASH_METRES = 28;

/** Enemies move slower than the player's 4.2 m/s, so disengaging by running is a real option. */
export const ENEMY_SPEED_MPS = 3.1;
export const ENEMY_RETURN_SPEED_MPS = 3.6;

/** Where an enemy stops closing. Just inside `ENEMY_ATTACK_RANGE` so it can actually swing. */
export const ENEMY_STANDOFF_METRES = 1.35;

/** A provoked enemy stays interested this long after it last saw or was hit by the player. */
export const PROVOKE_MEMORY_MS = 12_000;

/** Only enemies this close to the player are simulated. Everything else idles for free. */
export const AI_ACTIVE_RADIUS = 70;

/** The enemy list is rebuilt on this cadence rather than every 100 ms tick. */
const ENEMY_SCAN_INTERVAL_MS = 2_000;

// ------------------------------------------------------------- boss tuning

/**
 * Boss phase scripts, keyed by entity id.
 *
 * The numbers are content's, not this file's: `ORDRUN_PHASES` in `content/enemies.ts` carries the
 * health fraction, the phase armour, the phase cadence, the phase max hit and the telegraph shape,
 * because `EnemyDef` is frozen and has no room for them. Phase 2 dropping Ordrun's armour from 62
 * to 50 is what keeps the second half winnable at the DPS the first half establishes.
 */
const BOSS_PHASES: Readonly<Record<string, readonly BossPhase[]>> = {
  ordrun: ORDRUN_PHASES,
};

/** Gap between ground slams once a phase unlocks one. */
export const SLAM_INTERVAL_MS = 12_000;

/** How long the scorched circle stays readable after it fires. */
export const SLAM_LINGER_MS = 600;

/** Fallbacks for a phase that names a telegraph without giving it a shape. */
export const SLAM_WINDUP_MS = 1_500;
export const SLAM_RADIUS_METRES = 5.0;

/** Slam damage as a multiple of the boss's phase max hit. */
export const SLAM_DAMAGE_MULTIPLIER = 1.5;

// -------------------------------------------------------------------- types

export type TelegraphStage = "windup" | "active";

/**
 * A telegraphed boss attack, in world terms only. The render layer reads this to draw the ground
 * ring; the UI reads it to warn. Neither is allowed to change it.
 */
export interface BossTelegraph {
  enemyId: EntityId;
  kind: "ground_slam";
  stage: TelegraphStage;
  centre: Vec3;
  radius: number;
  startedAtMs: number;
  /** When the damage lands. During `windup`, this is in the future. */
  firesAtMs: number;
  endsAtMs: number;
  phase: number;
}

/** Optional navmesh snapping, so a chasing enemy does not walk through a cliff. */
export interface EnemyNavPort {
  nearestWalkable(point: Vec3, maxDistance?: number): Vec3 | null;
}

export interface EnemyAiDeps {
  store: Store;
  events: EventBus;
  entities: CombatEntityPort;
  combat: CombatSystem;
  nav?: EnemyNavPort;
}

type AiMode = "idle" | "aggro" | "returning";

interface AiRecord {
  mode: AiMode;
  provokedUntilMs: number;
  nextSlamAtMs: number;
  telegraph: BossTelegraph | null;
}

// ------------------------------------------------------------------- system

export class EnemyAiSystem implements TickSystem {
  readonly name = "enemyAI";

  /** PRD section 3, row 7 ("Enemy AI"), scaled by ten. Before combat (80). */
  readonly order = 70;

  private readonly records = new Map<EntityId, AiRecord>();
  private readonly telegraphListeners: ((telegraph: BossTelegraph) => void)[] = [];

  private enemies: SemanticEntity[] = [];
  private nextScanAtMs = -1;

  constructor(private readonly deps: EnemyAiDeps) {
    // Being struck provokes, whatever the behaviour says. This is what makes `territorial` work
    // and what stops a `passive` skitterling standing still while it is beaten to death.
    deps.combat.onEnemyProvoked((enemyId, atMs) => this.provoke(enemyId, atMs));
  }

  // -------------------------------------------------------------------- tick

  tick(deltaMs: number, atMs: number): void {
    const state = this.deps.store.get();

    this.rescanIfDue(atMs);
    this.respawnDead(state, atMs);

    const playerAlive = state.player.health > 0;
    const playerPos = state.player.position;

    for (const entity of this.enemies) {
      const runtime = this.deps.combat.runtimeFor(state, entity);
      if (runtime.state === "dead") continue;

      const record = this.recordFor(entity.id);
      const def = this.deps.combat.defFor(entity);
      const spawn = runtime.spawnPos;
      const distanceToPlayer = distanceXZ(playerPos, entity.position);
      const distanceFromSpawn = distanceXZ(spawn, entity.position);

      const phases = BOSS_PHASES[entity.id];
      if (phases) this.updateBoss(state, entity, runtime, record, phases, atMs);

      // 1. leash. Nothing outruns 28 m from home, including a boss mid-telegraph.
      if (record.mode === "aggro" && distanceFromSpawn > LEASH_METRES) {
        this.leash(state, entity, record, atMs);
      }

      // 2. return home.
      if (record.mode === "returning") {
        const arrived = this.stepToward(entity, spawn, ENEMY_RETURN_SPEED_MPS, deltaMs, 0.6);
        if (arrived) {
          record.mode = "idle";
          runtime.state = "idle";
          // A leashed enemy heals up. Without this, a player can chip a boss down in safe pieces.
          runtime.health = entity.combat?.maxHealth ?? def.maxHealth;
          if (entity.combat) entity.combat.health = runtime.health;
          if (entity.state !== "dead") this.setEntityState(entity, "alive");
          this.deps.store.markDirty();
        }
        continue;
      }

      // 3. acquire.
      if (record.mode === "idle" && playerAlive) {
        const provoked = atMs < record.provokedUntilMs;
        const inAggro = distanceToPlayer <= def.aggroRadius;
        const initiates = def.behaviour === "aggressive" && inAggro;
        if (provoked || initiates) this.engage(state, entity, record, runtime, atMs);
      }

      // 4. chase and hold.
      if (record.mode === "aggro") {
        if (!playerAlive || (atMs >= record.provokedUntilMs && distanceToPlayer > def.aggroRadius + 6)) {
          this.leash(state, entity, record, atMs);
          continue;
        }
        if (distanceToPlayer > ENEMY_STANDOFF_METRES) {
          this.stepToward(entity, playerPos, ENEMY_SPEED_MPS, deltaMs, ENEMY_STANDOFF_METRES);
        }
        this.faceless(entity, playerPos);
      }
    }
  }

  // ------------------------------------------------------------- engagement

  /** Marks an enemy as interested in the player. Called on every hit the player lands. */
  provoke(enemyId: EntityId, atMs: number): void {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(enemyId);
    if (!entity) return;
    const runtime = this.deps.combat.runtimeFor(state, entity);
    if (runtime.state === "dead") return;

    const record = this.recordFor(enemyId);
    record.provokedUntilMs = atMs + PROVOKE_MEMORY_MS;
    if (record.mode !== "aggro") this.engage(state, entity, record, runtime, atMs);
  }

  private engage(
    state: GameState,
    entity: SemanticEntity,
    record: AiRecord,
    runtime: GameState["world"]["enemies"][string],
    atMs: number,
  ): void {
    if (!runtime) return;
    record.mode = "aggro";
    record.provokedUntilMs = Math.max(record.provokedUntilMs, atMs + PROVOKE_MEMORY_MS);
    runtime.state = "aggro";
    this.setEntityState(entity, "aggro");
    this.deps.combat.engageEnemy(entity.id, atMs);
    this.deps.store.markDirty();
  }

  private leash(state: GameState, entity: SemanticEntity, record: AiRecord, atMs: number): void {
    record.mode = "returning";
    record.provokedUntilMs = 0;
    record.telegraph = null;
    const runtime = state.world.enemies[entity.id];
    if (runtime) runtime.state = "returning";
    this.setEntityState(entity, "returning");
    this.deps.combat.disengageEnemy(state, entity.id, atMs);
    this.deps.store.markDirty();
  }

  // ---------------------------------------------------------------- respawn

  /** Dead enemies come back at their spawn point on the timer combat stamped on them. */
  private respawnDead(state: GameState, atMs: number): void {
    for (const [entityId, runtime] of Object.entries(state.world.enemies)) {
      if (!runtime || runtime.state !== "dead") continue;
      if (runtime.respawnAtMs === null || atMs < runtime.respawnAtMs) continue;

      const entity = this.deps.entities.get(entityId);
      if (!entity) {
        runtime.respawnAtMs = atMs + 30_000;
        continue;
      }
      const def = this.deps.combat.defFor(entity);
      runtime.health = entity.combat?.maxHealth ?? def.maxHealth;
      runtime.state = "idle";
      runtime.respawnAtMs = null;
      delete runtime.bossPhase;

      if (entity.combat) entity.combat.health = runtime.health;
      this.deps.entities.setPosition?.(entityId, cloneVec3(runtime.spawnPos));
      entity.position = cloneVec3(runtime.spawnPos);
      this.setEntityState(entity, "alive");

      const record = this.recordFor(entityId);
      record.mode = "idle";
      record.provokedUntilMs = 0;
      record.telegraph = null;
      record.nextSlamAtMs = 0;
      this.deps.combat.setEnemyOverride(entityId, null);
      this.deps.store.markDirty();
    }
  }

  // ------------------------------------------------------------------- boss

  /**
   * Ordrun. Phase 1 is a plain slugging match; at 55% health he drops to phase 2 - lighter armour,
   * a 2.4 s swing instead of 3.0 s, a higher max hit - and starts telegraphing a ground slam every
   * 12 s: 1.8 s of wind-up, then damage to anyone still standing in a 6 m circle.
   *
   * Every number here comes from `ORDRUN_PHASES`. This file owns *when* a phase applies and how the
   * telegraph is published; content owns *what* the phase is.
   *
   * The whole fight is readable from state: `bossPhase` on the enemy record, `telegraphs()` here.
   */
  private updateBoss(
    state: GameState,
    entity: SemanticEntity,
    runtime: NonNullable<GameState["world"]["enemies"][string]>,
    record: AiRecord,
    phases: readonly BossPhase[],
    atMs: number,
  ): void {
    const base = this.deps.combat.baseDefFor(entity);
    const maxHealth = entity.combat?.maxHealth ?? base.maxHealth;
    const fraction = maxHealth > 0 ? runtime.health / maxHealth : 1;

    let index = 0;
    for (let i = 0; i < phases.length; i += 1) {
      const candidate = phases[i];
      if (candidate && fraction <= candidate.atHealthFraction) index = i;
    }
    const phase = phases[index];
    if (!phase) return;
    const phaseNumber = index + 1;

    if (runtime.bossPhase !== phaseNumber) {
      runtime.bossPhase = phaseNumber;
      this.deps.combat.setEnemyOverride(entity.id, {
        armour: phase.armour,
        attackSpeedMs: phase.attackSpeedMs,
        maxHit: phase.maxHit,
      });
      this.deps.store.markDirty();
      // The frozen `GameEventType` has no boss verb, so a phase change rides on `combat.started`
      // with a discriminated `event` payload. See the report: a contract gap, not a preference.
      this.deps.events.emit(
        "combat.started",
        { event: "boss.phase", enemyId: entity.id, name: entity.name, phase: phaseNumber },
        entity.id,
        atMs,
      );
      record.nextSlamAtMs = phase.telegraphId
        ? atMs + (phase.telegraphWindupMs ?? SLAM_WINDUP_MS)
        : 0;
    }

    const telegraph = record.telegraph;
    if (telegraph) {
      if (telegraph.stage === "windup" && atMs >= telegraph.firesAtMs) {
        telegraph.stage = "active";
        this.fireSlam(state, entity, telegraph, phase, atMs);
        this.publishTelegraph(telegraph);
      } else if (telegraph.stage === "active" && atMs >= telegraph.endsAtMs) {
        record.telegraph = null;
      }
      return;
    }

    if (!phase.telegraphId || record.mode !== "aggro") return;
    if (record.nextSlamAtMs === 0) record.nextSlamAtMs = atMs + SLAM_INTERVAL_MS;
    if (atMs < record.nextSlamAtMs) return;

    const windupMs = phase.telegraphWindupMs ?? SLAM_WINDUP_MS;
    const next: BossTelegraph = {
      enemyId: entity.id,
      kind: "ground_slam",
      stage: "windup",
      centre: cloneVec3(entity.position),
      radius: phase.telegraphRadiusM ?? SLAM_RADIUS_METRES,
      startedAtMs: atMs,
      firesAtMs: atMs + windupMs,
      endsAtMs: atMs + windupMs + SLAM_LINGER_MS,
      phase: phaseNumber,
    };
    record.telegraph = next;
    record.nextSlamAtMs = next.endsAtMs + SLAM_INTERVAL_MS;
    this.deps.events.emit(
      "combat.started",
      {
        event: "boss.telegraph", enemyId: entity.id, name: entity.name, kind: phase.telegraphId,
        centre: next.centre, radius: next.radius, firesAtMs: next.firesAtMs, phase: phaseNumber,
      },
      entity.id,
      atMs,
    );
    this.publishTelegraph(next);
  }

  private fireSlam(
    state: GameState,
    entity: SemanticEntity,
    telegraph: BossTelegraph,
    phase: BossPhase,
    atMs: number,
  ): void {
    const inside = distanceXZ(state.player.position, telegraph.centre) <= telegraph.radius;
    const peak = Math.max(1, Math.round(phase.maxHit * SLAM_DAMAGE_MULTIPLIER));
    const damage = inside ? peak : 0;
    if (damage > 0) this.deps.combat.damagePlayer(damage, entity.id, atMs, "special", peak);
    this.deps.events.emit(
      "combat.started",
      {
        event: "boss.slam", enemyId: entity.id, name: entity.name,
        centre: telegraph.centre, radius: telegraph.radius, damage, hit: inside,
      },
      entity.id,
      atMs,
    );
  }

  // -------------------------------------------------------------- read-only

  /** Every live telegraph. `render/overlays.ts` and the HUD both poll this. */
  telegraphs(): BossTelegraph[] {
    const out: BossTelegraph[] = [];
    for (const record of this.records.values()) {
      if (record.telegraph) out.push(record.telegraph);
    }
    return out;
  }

  telegraphFor(enemyId: EntityId): BossTelegraph | undefined {
    return this.records.get(enemyId)?.telegraph ?? undefined;
  }

  /** Push notification for the same data, for a renderer that would rather not poll. */
  onTelegraph(listener: (telegraph: BossTelegraph) => void): () => void {
    this.telegraphListeners.push(listener);
    return () => {
      const index = this.telegraphListeners.indexOf(listener);
      if (index >= 0) this.telegraphListeners.splice(index, 1);
    };
  }

  /** Clears every provocation. `systems/death.ts` calls this so respawning is not a re-ambush. */
  resetOnPlayerDeath(atMs: number): void {
    const state = this.deps.store.get();
    for (const [entityId, record] of this.records) {
      if (record.mode === "aggro") {
        const entity = this.deps.entities.get(entityId);
        if (entity) this.leash(state, entity, record, atMs);
      }
      record.provokedUntilMs = 0;
      record.telegraph = null;
    }
  }

  /** Live AI mode, for `__gameDebug` and the round's acceptance checks. */
  modeOf(enemyId: EntityId): AiMode | undefined {
    return this.records.get(enemyId)?.mode;
  }

  // -------------------------------------------------------------- internals

  private publishTelegraph(telegraph: BossTelegraph): void {
    for (const listener of this.telegraphListeners) listener(telegraph);
  }

  private recordFor(entityId: EntityId): AiRecord {
    const existing = this.records.get(entityId);
    if (existing) return existing;
    const created: AiRecord = { mode: "idle", provokedUntilMs: 0, nextSlamAtMs: 0, telegraph: null };
    this.records.set(entityId, created);
    return created;
  }

  /**
   * Rebuilds the simulated set. Enemies far from the player do nothing at all, so a 700-entity
   * world costs one filtered pass every two seconds rather than a distance check per tick.
   */
  private rescanIfDue(atMs: number): void {
    if (this.nextScanAtMs > atMs) return;
    this.nextScanAtMs = atMs + ENEMY_SCAN_INTERVAL_MS;

    const state = this.deps.store.get();
    const from = state.player.position;
    const next: SemanticEntity[] = [];
    for (const entity of this.deps.entities.all()) {
      if (entity.archetype !== "enemy" && entity.archetype !== "boss") continue;
      const record = this.records.get(entity.id);
      const busy = record !== undefined && record.mode !== "idle";
      const runtime = state.world.enemies[entity.id];
      const dead = runtime?.state === "dead";
      if (!busy && !dead && distanceXZ(from, entity.position) > AI_ACTIVE_RADIUS) continue;
      next.push(entity);
    }
    this.enemies = next;
  }

  /**
   * Straight-line steering, clamped to the enemy's speed and snapped to the navmesh when one is
   * wired. Enemies are not path-followers on purpose: chase distances are short, and a full
   * Detour query per enemy per tick is well outside the 3 ms sim budget.
   */
  private stepToward(
    entity: SemanticEntity,
    target: Vec3,
    speed: number,
    deltaMs: number,
    stopWithin: number,
  ): boolean {
    const dx = target[0] - entity.position[0];
    const dz = target[2] - entity.position[2];
    const gap = Math.sqrt(dx * dx + dz * dz);
    if (gap <= stopWithin) return true;

    const step = Math.min(gap - stopWithin, (speed * deltaMs) / 1000);
    if (step <= 0) return false;

    const nx = entity.position[0] + (dx / gap) * step;
    const nz = entity.position[2] + (dz / gap) * step;
    const wanted: Vec3 = [nx, entity.position[1], nz];
    const snapped = this.deps.nav?.nearestWalkable(wanted, 2) ?? wanted;

    entity.position = snapped;
    this.deps.entities.setPosition?.(entity.id, snapped);
    this.deps.store.markDirty();
    return distanceXZ(snapped, target) <= stopWithin;
  }

  /** Points an enemy at the player. Purely cosmetic, and cosmetics live in `meta`, not in a mesh. */
  private faceless(entity: SemanticEntity, target: Vec3): void {
    const view = entity.view;
    if (!view) return;
    view.rotationY = Math.atan2(target[0] - entity.position[0], target[2] - entity.position[2]);
  }

  private setEntityState(entity: SemanticEntity, state: string): void {
    entity.state = state;
    this.deps.entities.setState?.(entity.id, state);
  }
}
