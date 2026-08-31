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
import type { BossPhase } from "../content/enemies.js";
import { ORDRUN_PHASES } from "../content/enemies.js";
import type { CombatEntityPort, CombatSystem } from "./combat.js";
import { cloneVec3, spawnPositionOf } from "./combat.js";

// ------------------------------------------------------------------ tunables

/** PRD 2.4: enemies leash at 28 m from their spawn point. */
export const LEASH_METRES = 28;

/** Enemies move slower than the player's 4.2 m/s, so disengaging by running is a real option. */
export const ENEMY_SPEED_MPS = 3.1;

/**
 * How fast an enemy is allowed to be pushed out of another one, metres per second.
 *
 * Well under any pursuit speed, so giving way never outruns chasing and two animals cannot shove
 * each other across the field. It only has to resolve an overlap over a handful of ticks.
 */
const SEPARATION_SPEED_MPS = 1.1;

/**
 * The footprint assumed for an enemy whose asset is not in the manifest.
 *
 * `world/regionBuilder.ts` measures the real one for everything that ships. This is the value that
 * keeps a content gap from collapsing separation entirely, and it is deliberately small: crowding
 * slightly is a better failure than shoving apart two things that were never touching.
 */
const DEFAULT_BODY_RADIUS = 0.4;

/**
 * How far to move ONE of two overlapping enemies, along the line between them.
 *
 * Exported and pure so the rule can be pinned by a test without standing up a store, a navmesh and
 * a combat system. The caller applies this to the second of the pair and its negation to the first.
 *
 * `want` is the sum of the two body radii and `limit` is one tick of separation travel. Half the
 * overlap each, so neither creature is privileged and the pair converges on touching rather than
 * one of them being walked backwards out of the other.
 *
 * `tie` only matters when the two are exactly coincident, which has no direction to push along and
 * whose normalisation is a NaN. It picks a fixed angle, so the same frame always resolves the same
 * way - a random one would be a thing a replay could not reproduce.
 */
export function separationPush(
  dx: number,
  dz: number,
  want: number,
  limit: number,
  tie: number,
): { x: number; z: number } | null {
  const gap = Math.sqrt(dx * dx + dz * dz);
  if (gap >= want) return null;

  // Direction and distance are taken apart here rather than normalising in place, because the
  // coincident case has a distance of zero and only the direction needs inventing. Folding the two
  // together - substituting a unit gap to keep the division alive - would also quietly shrink the
  // overlap it thinks it is resolving, from the whole body down to whatever that unit was.
  let ux = 0;
  let uz = 0;
  if (gap < 1e-4) {
    const angle = (((tie % 360) + 360) % 360) * (Math.PI / 180);
    ux = Math.cos(angle);
    uz = Math.sin(angle);
  } else {
    ux = dx / gap;
    uz = dz / gap;
  }

  const push = Math.min(limit, (want - gap) / 2);
  return { x: ux * push, z: uz * push };
}
export const ENEMY_RETURN_SPEED_MPS = 3.6;

/**
 * How fast this creature pursues, in metres per second.
 *
 * `content/enemies.ts` sets it per family from the animal's own gait, because one shared speed made
 * a hen and a bear cover ground identically and neither's legs could keep up with it: the hen's
 * walk cycle implies 0.75 m/s against the 3.1 it was travelling at. `render/entityViews.ts` reads
 * the same number to pick the clip's playback rate, so the two cannot drift.
 */
function pursuitSpeed(entity: SemanticEntity): number {
  return entity.combat?.moveSpeedMps ?? ENEMY_SPEED_MPS;
}

/** Returning is the same gait, hurried by the ratio the shared constants already establish. */
function returnSpeed(entity: SemanticEntity): number {
  return pursuitSpeed(entity) * (ENEMY_RETURN_SPEED_MPS / ENEMY_SPEED_MPS);
}

/** Where an enemy stops closing. Just inside `ENEMY_ATTACK_RANGE` so it can actually swing. */
export const ENEMY_STANDOFF_METRES = 1.35;

/** A provoked enemy stays interested this long after it last saw or was hit by the player. */
export const PROVOKE_MEMORY_MS = 12_000;

/**
 * The smallest movement worth taking, in metres.
 *
 * Below this a step is noise: the navmesh snap alone moves a candidate by more than this, so a
 * shorter "step" says nothing about whether the enemy actually got anywhere. Both the progress test
 * and the arrival test read it, and they have to read the same number — see `stepToward`.
 */
const STEP_EPSILON_METRES = 0.001;

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
    // and what stops a `passive` frog standing still while it is beaten to death.
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
        const arrived = this.stepToward(entity, spawn, returnSpeed(entity), deltaMs, 0.6);
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
          this.stepToward(entity, playerPos, pursuitSpeed(entity), deltaMs, ENEMY_STANDOFF_METRES);
        } else {
          // At standoff there is no displacement for stepToward to face along. Keep looking at the
          // player while the combat system swings.
          this.faceless(entity, playerPos);
        }
      }
    }

    // 5. give way. Last, because it is a correction to where everything ended up this tick.
    this.separate(deltaMs);
  }

  /**
   * Pushes enemies that are standing inside each other apart.
   *
   * Every animal that aggros steers at the SAME point - the player - and steering alone has no
   * opinion about the other animals doing it. So a sett of bears converges on one spot and arrives
   * as one lump of fur: measured with `tools/animals/overlap.ts --chase`, a Gravelmaw rat finished
   * a chase 0.02 m from a reaver, inside a body 1.2 m across. Nothing about the spawn scatter is
   * wrong - at rest not one pair in the world overlaps - so the fix belongs here, on the movement,
   * not on the placement.
   *
   * Pairwise over the ACTIVE list, which `refreshActive` has already cut to what is near the
   * player, so this is a few hundred distance checks a tick rather than a sweep of the world.
   *
   * The push is along the line between the two, which on a standoff ring is close to tangential -
   * so it spreads them around the player rather than fighting the pursuit that is pulling them in.
   * It is also speed-limited like any other movement and snapped to the navmesh, because an enemy
   * shoved through a wall to make room is worse than one standing too close.
   */
  private separate(deltaMs: number): void {
    const active = this.enemies;
    const limit = (SEPARATION_SPEED_MPS * deltaMs) / 1000;
    const state = this.deps.store.get();

    for (let i = 0; i < active.length; i += 1) {
      const a = active[i]!;
      if (state.world.enemies[a.id]?.state === "dead") continue;
      const ra = a.combat?.bodyRadius ?? DEFAULT_BODY_RADIUS;

      for (let j = i + 1; j < active.length; j += 1) {
        const b = active[j]!;
        if (state.world.enemies[b.id]?.state === "dead") continue;
        const want = ra + (b.combat?.bodyRadius ?? DEFAULT_BODY_RADIUS);

        const push = separationPush(
          b.position[0] - a.position[0], b.position[2] - a.position[2], want, limit, i * 31 + j * 17,
        );
        if (!push) continue;
        this.nudge(a, -push.x, -push.z);
        this.nudge(b, push.x, push.z);
      }
    }
  }

  /** One separation step for one enemy, refused rather than forced when the navmesh says no. */
  private nudge(entity: SemanticEntity, dx: number, dz: number): void {
    const from = entity.position;
    const wanted: Vec3 = [from[0] + dx, from[1], from[2] + dz];
    const snapped = this.snapStep(wanted);
    // No `faceDirection` here on purpose: a creature being shoved aside is still looking at what it
    // is chasing, and turning it to face the shove is what made the animals spin.
    if (!snapped || distanceXZ(from, snapped) <= 0.001) return;
    entity.position = snapped;
    this.deps.entities.setPosition?.(entity.id, snapped);
    this.deps.store.markDirty();
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
      // Both halves, or the renderer keeps fading a creature that is alive again.
      delete runtime.diedAtMs;
      if (entity.view) delete entity.view.diedAtMs;

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
    const from = entity.position;
    const dx = target[0] - from[0];
    const dz = target[2] - from[2];
    const gap = Math.sqrt(dx * dx + dz * dz);
    // The same epsilon `madeProgress` rejects a step by, and it has to be the same one.
    //
    // The step below is clamped to `gap - stopWithin`, so the last step of a walk home is however
    // much is left. Once that remainder falls under a millimetre, `madeProgress` rejects the
    // candidate for not moving far enough, rejects both axis slides for the same reason, and
    // `stepToward` returns false — forever. The enemy freezes a fraction of a millimetre outside
    // its own arrival threshold and never arrives.
    //
    // That is not cosmetic. `returning` only ends when this returns true, and arriving is what
    // restores a leashed enemy to full health. A boss stuck here stays in `returning` and stays
    // damaged, which is exactly the "chip it down in safe pieces" the leash heal exists to stop.
    // Measured in the feature lab: a Redsill Cow walking home settled at 0.6001 m against a 0.6 m
    // threshold and sat there for the rest of the session.
    if (gap - stopWithin <= STEP_EPSILON_METRES) return true;

    const step = Math.min(gap - stopWithin, (speed * deltaMs) / 1000);
    if (step <= 0) return false;

    const nx = from[0] + (dx / gap) * step;
    const nz = from[2] + (dz / gap) * step;
    const wanted: Vec3 = [nx, from[1], nz];
    let snapped = this.snapStep(wanted);

    // Detour returns the current boundary point when the direct candidate falls inside a carved
    // solid. Retrying that point forever is the enemy version of walking into a wall. Sliding one
    // axis at a time is cheap, deterministic, and gets around the ordinary building and rock
    // corners without a full path query per enemy per tick.
    if (!this.madeProgress(from, snapped, target, gap)) {
      const candidates = [
        this.snapStep([nx, from[1], from[2]]),
        this.snapStep([from[0], from[1], nz]),
      ].filter((candidate): candidate is Vec3 => this.madeProgress(from, candidate, target, gap));
      candidates.sort((a, b) => distanceXZ(a, target) - distanceXZ(b, target));
      snapped = candidates[0] ?? null;
    }

    if (!snapped) return false;
    const movedX = snapped[0] - from[0];
    const movedZ = snapped[2] - from[2];
    entity.position = snapped;
    this.deps.entities.setPosition?.(entity.id, snapped);
    this.faceDirection(entity, movedX, movedZ);
    this.deps.store.markDirty();
    return distanceXZ(snapped, target) <= stopWithin;
  }

  /** Uses raw steering only when no nav port exists. A nav miss is a blocker, not permission. */
  private snapStep(wanted: Vec3): Vec3 | null {
    return this.deps.nav ? this.deps.nav.nearestWalkable(wanted, 2) : wanted;
  }

  /** A useful snap moves at least `STEP_EPSILON_METRES` and does not take the enemy further away. */
  private madeProgress(from: Vec3, candidate: Vec3 | null, target: Vec3, oldGap: number): boolean {
    if (!candidate || distanceXZ(from, candidate) <= STEP_EPSILON_METRES) return false;
    return distanceXZ(candidate, target) < oldGap - STEP_EPSILON_METRES;
  }

  /** Faces the direction the navmesh actually allowed, including an axis fallback. */
  private faceDirection(entity: SemanticEntity, dx: number, dz: number): void {
    if (Math.hypot(dx, dz) <= 0.001) return;
    const view = entity.view;
    if (view) view.rotationY = Math.atan2(dx, dz);
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
