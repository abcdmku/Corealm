/**
 * Player movement. Three modes, all ending in the same place: a position on the navmesh.
 *
 *  - "path"   click-to-move. A navmesh path, rounded at the corners, walked by arc length.
 *  - "direct" WASD. A desired direction, projected back onto the navmesh each step.
 *  - route    a planned multi-leg journey: walk, traverse an Agility shortcut or step through
 *             a dungeon portal, walk again.
 *
 * Movement is authoritative in the store. The renderer follows it, never the other way round.
 *
 * Two things here exist because the round-0 version looked wrong on screen rather than because it
 * was incorrect. Detour's string-pulled path hugs polygon corners, so walking it literally makes
 * the player pivot on the spot at every corner; `roundCorners` replaces each corner with a short
 * arc. And facing was assigned from the vector to the corner AFTER moving onto it, which is a zero
 * vector at arrival and snapped the player to face north; facing is now interpolated toward a
 * look-ahead point at a bounded turn rate.
 *
 * Four things here exist because the Phase 1 version was MEASURED wrong rather than because it
 * looked wrong, and all four are the same class of bug — the sim tick was treated as the unit of
 * movement instead of as a sample of it:
 *
 *  - Velocity was binary. `step = PLAYER_SPEED * (deltaMs / 1000)` on a fixed 100 ms tick meant the
 *    player covered exactly 0.4202 m or nothing: 11,050 recorded frames of continuous movement,
 *    170 of them (1.54%) with any displacement, every step 0.4202 m. A 30 ms tap of W moved the
 *    player 0 m in three trials out of three; a 150 ms tap moved them either 0.42 or 0.84 m, a
 *    100% swing. There is now a velocity vector integrated at `MOVEMENT.accelMps2` / `decelMps2`.
 *  - The step acceptance test compared the navmesh snap against the TARGET rather than against
 *    where the player was standing, so nothing bounded how far one tick could move them and
 *    nothing at all refused a snap eight metres up onto a roof polygon. It is now bounded against
 *    the current position, with a vertical guard.
 *  - `followPath` lerped Y between Detour corners and never re-snapped. A 3-point, 56 m path
 *    across the Karrowmoor terraces put the player 4.46 m UNDER the surface at its midpoint and
 *    over 3 m under for 60% of the segment.
 *  - Nothing but the navmesh was solid, so the player walked through the bank chest, the anvil,
 *    both market stalls, an NPC and an enemy. `solids.resolve` is the final clamp on every step
 *    now, and moving things (NPCs, enemies) are pushed out as circles because a navmesh carve
 *    cannot follow something that walks.
 *
 * The ports at the bottom of `MovementPorts` are all optional and movement runs without any of
 * them, exactly as it did before. That is deliberate: `app/boot.ts` is wired in a separate pass.
 */
import type { EntityId, RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import type { GameState } from "../state/store.js";
import type { Navigation, RouteLeg } from "./navigation.js";
import type { EventBus } from "../core/events.js";
import { INTERACT_RANGE, MOVEMENT, PLAYER_RADIUS, PLAYER_SPEED } from "../app/config.js";
import { distanceXZ, pathLength } from "../core/math.js";

/** How close counts as arrived, in metres. */
const ARRIVE_EPSILON = 0.35;
/** Metres ahead on the path the player looks while turning. */
const LOOK_AHEAD = 1.8;
/**
 * Radians per second while following a path. About 400 deg/s: fast enough to feel responsive,
 * slow enough to read.
 */
const MAX_TURN_RATE = 7;
/**
 * Radians per second under direct input, where the player is steering by hand and expects the body
 * to answer. This was `MAX_TURN_RATE * 1.8` = 12.6 rad/s, which at a 100 ms tick is a 1.26 rad
 * (72 degree) jump applied inside one rendered frame — recorded facing took exactly three values
 * across a whole turn, -0.140 -> -0.740 -> -1.940. 9 rad/s caps a tick at 0.90 rad.
 */
const DIRECT_TURN_RATE = 9;
/** Corner rounding radius in metres, clamped to 45% of the shorter adjacent segment. */
const CORNER_RADIUS = 1.25;
/** Stuck detection window. */
const STUCK_WINDOW_MS = 700;
const STUCK_DISTANCE = 0.18;
const MAX_RECOVERIES = 2;

/** Below this the player is standing still. 5 cm/s is under one pixel of drift per second. */
const IDLE_SPEED = 0.05;

/**
 * Slack on the step-length bound, in metres. The navmesh snap legitimately moves the point a
 * little sideways along a polygon edge, so an exact bound would reject every step taken against a
 * wall. 0.05 m is a sixth of `PLAYER_RADIUS` and an eighth of the largest possible step.
 */
const STEP_SLACK = 0.05;

/**
 * Largest vertical change one direct step may make, in metres.
 *
 * The walkable slope angle is 48 degrees and the largest possible step at `runSpeed` on a 100 ms
 * tick is 0.42 m, so the steepest legal ground gains 0.42 * tan(48) = 0.47 m in a tick. 0.75 m
 * clears that with margin while refusing the 8 m jump onto the March Company Hall roof, which the
 * old test could not see at all because it measured against the desired target rather than
 * against the player.
 */
const MAX_STEP_UP = 0.75;

/**
 * A step that achieves less than this fraction of what was asked for is retried axis by axis.
 *
 * The navmesh snap already slides along a long flat wall, which is why W+A into the hall's south
 * face travelled 6.25 m in the Phase 1 measurement. It stops dead at a corner or a short blocker,
 * because the snap comes back to the same edge point and the step makes no progress at all — that
 * is the player standing in the Coldbrace gate arch producing 0.002 m over a 300 ms hold.
 */
const SLIDE_TRIGGER = 0.9;

/**
 * How far a smoothed path segment may run before it gets an intermediate corner, in metres.
 *
 * Detour string-pulls to the minimum corner set needed for XZ clearance, so a 56 m path across
 * stepped terrain arrives with 3 points and no elevation samples between them. Subdividing at 3 m
 * puts the elevation back into the corner list itself, which is cheaper than fixing it every tick.
 */
const MAX_PATH_SEGMENT = 3;

/**
 * How far the terrain height may disagree with the navmesh before the terrain is ignored, in
 * metres.
 *
 * The player should stand on the DRAWN ground, not on the navmesh: measured, the navmesh floats
 * 0.147 m above the ground at Coldbrace square, 0.274 m on the fallen duskoak, 0.341 m at the far
 * tarn and 0.417 m on the ridge pines, so the player's feet and every entity's base plane
 * disagreed by up to 42 cm and the disagreement changed as you walked. But the Gravelmaw's
 * chambers are walkable geometry that is NOT the terrain field, and grounding a player in there
 * would fire them up to the surface. 1.2 m is 3x the worst measured navmesh float and far below
 * any dungeon offset.
 */
const GROUND_SNAP_MAX = 1.2;

/** Radius within which a moving entity is pushed out of, in metres. */
const MOVER_QUERY_RADIUS = 1.5;

/** Vertical reach of a moving entity's circle, in metres. Above this it is on another terrace. */
const MOVER_HEIGHT = 2;

/**
 * Collision radii for the archetypes that move, in metres.
 *
 * Only these: a navmesh carve is baked once at boot and cannot follow something that walks, so
 * this is the only mechanism that can stop the player walking through Carter Bel (measured: 1.38 m
 * past his centre, in a hold that covered 5.04 m against 4.2 m of free travel) or standing inside
 * an enemy (3.40 m past centre). Everything static is carved instead, which is cheaper and also
 * makes paths route around it.
 */
/**
 * How far short of a named target a path may finish and still count as having got there, in
 * metres. Only for entity and route-node destinations, never for a raw click on the ground.
 *
 * `INTERACT_RANGE` plus a metre of navmesh standoff. A solid entity's own footprint is carved out
 * of the mesh and Recast erodes another `walkableRadius` (1 voxel = 0.45 m at the large-world cell
 * size) plus up to a cell of rasterisation off that, so a path to an ore rock legitimately stops
 * roughly a metre outside the rock. Measured on a synthetic navmesh at cs 0.3: a 1.2 x 0.8 m chest
 * with a 0.72 m half-diagonal was walkable to 0.90 m from its centre — 0.18 m of overhead on top
 * of the 1-voxel 0.30 m erosion. Without this, carving props out of the navmesh would start
 * refusing `moveTo({ entityId })` on the seven gate lines that depend on it.
 */
const ENTITY_ARRIVAL_ALLOWANCE = INTERACT_RANGE + 1;

const MOVER_RADII: Readonly<Record<string, number>> = {
  npc: 0.45,
  enemy: 0.45,
  boss: 0.9,
};

/** What the rig needs to pick a locomotion clip. Written every tick; see `MovementPorts`. */
export type Gait = "idle" | "walk" | "run";

export interface DirectInput {
  forward: number;  // -1..1
  strafe: number;   // -1..1
  /** Camera yaw in radians, so W means "away from the camera". */
  cameraYaw: number;
}

/**
 * The slice of `systems/solids.ts` movement needs. Structural, so a test can pass a literal and so
 * nothing here depends on how the volume list is indexed.
 */
export interface MovementSolidsPort {
  resolve(desired: Vec3, from: Vec3, radius: number): Vec3;
}

/**
 * The slice of `world/entities.ts` movement needs, satisfied exactly by `EntityStore`. Injected
 * rather than imported: `systems/` never imports `world/`.
 */
export interface MovementEntityPort {
  get(id: EntityId): SemanticEntity | undefined;
  index(): {
    forEachInRadius(
      centre: Vec3,
      radius: number,
      visit: (id: EntityId, distanceSquared: number) => boolean | void,
    ): void;
  };
}

/**
 * Everything movement can use but does not require. All optional, all off by default, because
 * `app/boot.ts` is root-owned and wired in its own pass: `new Movement(nav, events)` still
 * compiles and still behaves exactly as it did, minus the bugs.
 */
export interface MovementPorts {
  /** Static collision. Without it, only the navmesh constrains a step. */
  solids?: MovementSolidsPort;
  /**
   * The analytic terrain height, the same port `buildWorld` is given. With it, the navmesh stays
   * authoritative for XZ and Y comes from the ground everything else is placed on.
   */
  heightAt?: (regionId: RegionId, x: number, z: number) => number;
  /**
   * Resolves the semantic region at a snapped world position.
   *
   * This takes the full point rather than only XZ because Gravelmaw sits directly below
   * Karrowmoor. The app owns that distinction; movement only makes sure a long walk updates the
   * player's region as it crosses authored borders.
   */
  regionAt?: (position: Vec3, currentRegionId: RegionId) => RegionId;
  /** NPCs and enemies, pushed out as circles. Without it, the player walks through them. */
  entities?: MovementEntityPort;
}

/**
 * The extra fields written onto `state.player.movement` every tick.
 *
 * `app/loop.ts` derives the rig's locomotion speed from a per-RENDERED-frame position delta, which
 * is 0 on 98.5% of frames and ~190 m/s on the rest because the position only changes on a 100 ms
 * sim tick. That makes `poseFor` flip idle/run about twenty times a second, and every flip calls
 * `action.reset()`, so the run clip never advances past ~2 ms of its 0.933 s — a 100 fps screencast
 * shows the body pose pixel-identical across 116 ms of continuous running. The fix is for the
 * system that owns the velocity to publish it. `speed` is the true horizontal speed AFTER the
 * collision clamp, so a player walking into a wall reads as standing still, which is what they are.
 */
export interface MovementSpeedFields {
  /** Metres per second, horizontal, after clamping. */
  speed: number;
  gait: Gait;
}

export interface PathOptions {
  /** Stop this many metres short of the destination. Walk-into-interact-range uses it. */
  stopDistance?: number;
  /** Suppress navigation.started. Used for the middle legs of a planned route. */
  quiet?: boolean;
  /**
   * Suppress navigation.failed when no path is found, because the caller has a second answer.
   *
   * `GameApi.moveTo` probes the navmesh first and falls back to a route plan. Without this the
   * probe's failure lands in the event stream a beat before the route starts walking, and every
   * caller that waits on `["navigation.completed", "navigation.failed"]` reads the journey as
   * failed while the player is walking it — which is exactly how the three red gate lines read
   * once portals existed. A route leg passes it for the same reason: `advanceRoute` emits its own
   * `leg-unreachable`, which says which leg, so the generic one is a duplicate.
   */
  quietFailure?: boolean;
  /**
   * How far short of `to` the computed path may stop and still count as reaching it, in metres.
   * Defaults to `ENTITY_ARRIVAL_ALLOWANCE` when an `entityId` is given and to 0 otherwise — a
   * raw click on the ground means that spot, an entity means "close enough to use it".
   */
  arrivalAllowance?: number;
}

export interface RouteProgress {
  active: boolean;
  legIndex: number;
  legCount: number;
  kind: RouteLeg["kind"] | null;
  traversing: boolean;
  remainingLegs: number;
}

interface Traversal {
  endsAtMs: number;
  exit: Vec3;
  obstacleId: EntityId | null;
  /**
   * Set only for a portal crossing: which region the player is standing in when it ends.
   *
   * Without it the player walks out of the Gravelmaw still tagged `gravelmaw`, and boot's interior
   * filter (`playerInDungeon`) keeps the whole cavern drawn around them on the open moor.
   */
  regionId: RegionId | null;
}

export class Movement {
  private direct: DirectInput = { forward: 0, strafe: 0, cameraYaw: 0 };

  private route: { legs: RouteLeg[]; index: number; entityId: EntityId | null } | null = null;
  private traversal: Traversal | null = null;

  private stuckSincePosition: Vec3 | null = null;
  private stuckWindowMs = 0;
  private recoveries = 0;

  /** Horizontal velocity in m/s. The whole of finding 9: there used to be no such thing. */
  private velocityX = 0;
  private velocityZ = 0;
  private speedMps = 0;
  private gait: Gait = "idle";

  private ports: MovementPorts;

  constructor(
    private readonly nav: Navigation,
    private readonly events: EventBus,
    ports: MovementPorts = {},
  ) {
    this.ports = ports;
  }

  /**
   * Wires the optional ports after construction. `app/boot.ts` builds `Movement` at step 14 but
   * the solid volume list exists from step 7, so either order works; this exists so the boot pass
   * can add collision without moving the constructor call.
   */
  setPorts(ports: MovementPorts): void {
    this.ports = { ...this.ports, ...ports };
  }

  setDirectInput(input: DirectInput): void {
    this.direct = input;
  }

  hasDirectInput(): boolean {
    return this.direct.forward !== 0 || this.direct.strafe !== 0;
  }

  /**
   * True horizontal speed in m/s after the collision clamp, updated every sim tick.
   * `app/loop.ts` should read this instead of differencing positions between rendered frames.
   */
  getSpeedMps(): number {
    return this.speedMps;
  }

  /** Which locomotion clip band the current speed falls in. Split at `MOVEMENT.walkPoseThreshold`. */
  getGait(): Gait {
    return this.gait;
  }

  // -------------------------------------------------------------- paths

  /** Starts click-to-move. Returns the path length, or null when unreachable. */
  startPath(
    state: GameState,
    to: Vec3,
    entityId: EntityId | null,
    atMs: number,
    options: PathOptions = {},
  ): { pathLength: number; etaMs: number } | null {
    const found = this.nav.findPathDetailed(state.player.position, to);
    // A partial path is Detour saying "the destination is on an island I cannot reach". Walking it
    // used to mean walking a fabricated straight line through whatever made the island — out
    // through a cottage wall and then through the Forge Shed, measured. Refuse it instead.
    //
    // `stopDistance` widens the allowance because walking into interaction range of an ore rock
    // legitimately ends short: the rock's own footprint is carved out of the navmesh, so the path
    // stops at its boundary and that IS arrival.
    const allowance = Math.max(
      options.stopDistance ?? 0,
      options.arrivalAllowance ?? (entityId !== null ? ENTITY_ARRIVAL_ALLOWANCE : 0),
    );
    if (!found || found.path.length === 0 || (found.partial && found.arrivalGap > allowance)) {
      if (!options.quietFailure) {
        this.events.emit("navigation.failed", { reason: "unreachable", to }, entityId ?? undefined, atMs);
      }
      return null;
    }

    const trimmed = options.stopDistance ? trimTail(found.path, options.stopDistance, to) : found.path;
    const path = this.smooth(trimmed);

    const movement = state.player.movement;
    movement.mode = "path";
    movement.path = path;
    movement.pathIndex = 0;
    movement.destination = path[path.length - 1]!;
    movement.destinationEntityId = entityId;

    this.resetStuck(state);

    const length = pathLength(path);
    const etaMs = this.nav.etaMs(path);
    if (!options.quiet) {
      this.events.emit(
        "navigation.started",
        { pathLength: Math.round(length * 100) / 100, etaMs, points: path.length },
        entityId ?? undefined,
        atMs,
      );
    }
    return { pathLength: length, etaMs };
  }

  /**
   * Walks a planned route leg by leg, including Agility shortcut and portal traversals.
   *
   * This is the second half of architecture correction R2. `Navigation.planRoute` decides WHICH
   * shortcuts and portals are worth using; this walks the answer. Both are a timed traversal
   * followed by a placement at the far side — a gameplay step, interruptible, not a Detour link.
   * A portal additionally re-tags the player's region, which is what makes leaving the Gravelmaw
   * on foot a walk rather than a teleport.
   */
  startRoute(state: GameState, legs: readonly RouteLeg[], atMs: number, entityId: EntityId | null = null): boolean {
    if (legs.length === 0) return false;
    this.route = { legs: [...legs], index: -1, entityId };
    this.traversal = null;
    const total = legs.reduce((sum, leg) => sum + leg.cost, 0);
    this.events.emit(
      "navigation.started",
      { legs: legs.length, etaMs: Math.round(total * 1000), route: true },
      entityId ?? undefined,
      atMs,
    );
    return this.advanceRoute(state, atMs);
  }

  getRouteProgress(): RouteProgress {
    if (!this.route) {
      return { active: false, legIndex: 0, legCount: 0, kind: null, traversing: false, remainingLegs: 0 };
    }
    const leg = this.route.legs[this.route.index];
    return {
      active: true,
      legIndex: Math.max(0, this.route.index),
      legCount: this.route.legs.length,
      kind: leg?.kind ?? null,
      traversing: this.traversal !== null,
      remainingLegs: Math.max(0, this.route.legs.length - this.route.index - 1),
    };
  }

  isTraversing(): boolean {
    return this.traversal !== null;
  }

  stop(state: GameState, atMs: number, reason = "cancelled"): boolean {
    const movement = state.player.movement;
    const hadRoute = this.route !== null;
    const wasTraversing = this.traversal !== null;

    if (wasTraversing) this.events.emit("activity.stopped", { kind: "traversing", reason }, undefined, atMs);
    this.route = null;
    this.traversal = null;

    if (movement.mode === "idle" && !hadRoute) return false;
    const wasNavigating = movement.mode === "path";
    movement.mode = "idle";
    movement.path = null;
    movement.pathIndex = 0;
    movement.destination = null;
    movement.destinationEntityId = null;
    this.resetStuck(state);
    if (wasNavigating || hadRoute) this.events.emit("navigation.failed", { reason }, undefined, atMs);
    return true;
  }

  // --------------------------------------------------------------- tick

  /** One sim tick of movement. */
  update(state: GameState, deltaMs: number, atMs: number): void {
    const movement = state.player.movement;
    const deltaSeconds = deltaMs / 1000;

    // Direct input always wins. Pressing a key mid-path cancels the path, as a player expects.
    if (this.hasDirectInput()) {
      if (movement.mode === "path" || this.route) this.stop(state, atMs, "interrupted-by-input");
      this.applyDirect(state, deltaSeconds, deltaMs);
      movement.mode = "direct";
      this.publishSpeed(movement);
      return;
    }

    if (this.traversal) {
      this.updateTraversal(state, atMs);
      this.halt();
      this.publishSpeed(movement);
      return;
    }

    if (movement.mode === "direct") {
      // Coast. Releasing a key used to stop the player inside a single tick — 0.000 m over the
      // following 500 ms, 241 rendered frames. At 25 m/s^2 a full-speed stop takes 0.17 s, so
      // "direct" survives one or two more ticks and the character glides to a halt.
      this.applyDirect(state, deltaSeconds, deltaMs);
      if (this.speedMps < IDLE_SPEED) {
        this.halt();
        movement.mode = "idle";
      }
      this.publishSpeed(movement);
      return;
    }

    if (movement.mode !== "path" || !movement.path) {
      if (this.route) this.advanceRoute(state, atMs);
      this.halt();
      this.publishSpeed(movement);
      return;
    }

    this.followPath(state, deltaSeconds, deltaMs, atMs);
    this.publishSpeed(movement);
  }

  private applyDirect(state: GameState, deltaSeconds: number, deltaMs: number): void {
    const { forward, strafe, cameraYaw } = this.direct;
    const raw = Math.hypot(forward, strafe);
    // Clamped, not normalised away: a gamepad stick half over gives half speed, and W+D gives the
    // same speed as W rather than 1.41x it.
    const magnitude = Math.min(1, raw);

    let dirX = 0;
    let dirZ = 0;
    if (raw > 0) {
      // Screen-relative: forward is away from the camera.
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      dirX = (strafe * cos - forward * sin) / raw;
      dirZ = (-strafe * sin - forward * cos) / raw;
    }

    this.integrateVelocity(dirX * MOVEMENT.runSpeed * magnitude, dirZ * MOVEMENT.runSpeed * magnitude, deltaSeconds);
    this.applyVelocity(state, deltaSeconds);

    if (raw > 0) {
      state.player.facingRad = turnToward(
        state.player.facingRad,
        Math.atan2(dirX, dirZ),
        DIRECT_TURN_RATE,
        deltaMs,
      );
    }
  }

  /**
   * Accelerates the velocity vector toward `targetX`/`targetZ`.
   *
   * Rate is chosen by whether the target is faster than the current velocity, not by whether there
   * is input, so turning at speed uses the acceleration rate rather than the harsher stopping one.
   */
  private integrateVelocity(targetX: number, targetZ: number, deltaSeconds: number): void {
    const deltaX = targetX - this.velocityX;
    const deltaZ = targetZ - this.velocityZ;
    const gap = Math.hypot(deltaX, deltaZ);
    if (gap <= 1e-9) return;

    const slowing = Math.hypot(targetX, targetZ) < Math.hypot(this.velocityX, this.velocityZ);
    const rate = slowing ? MOVEMENT.decelMps2 : MOVEMENT.accelMps2;
    const maxChange = rate * deltaSeconds;

    if (gap <= maxChange) {
      this.velocityX = targetX;
      this.velocityZ = targetZ;
      return;
    }
    const scale = maxChange / gap;
    this.velocityX += deltaX * scale;
    this.velocityZ += deltaZ * scale;
  }

  /**
   * Moves the player by the current velocity, clamped, and rewrites the velocity from the distance
   * actually covered.
   *
   * That rewrite is what makes `speed` honest: a player pressed into a wall has their velocity
   * driven to zero rather than accumulating a full 4.2 m/s of stored energy that fires them
   * sideways the moment the wall ends, and the rig is told they are standing still, which they are.
   */
  private applyVelocity(state: GameState, deltaSeconds: number): void {
    const player = state.player;
    const from = player.position;
    const stepX = this.velocityX * deltaSeconds;
    const stepZ = this.velocityZ * deltaSeconds;
    if (Math.abs(stepX) < 1e-6 && Math.abs(stepZ) < 1e-6) return;

    const next = this.clampStep(state, from, stepX, stepZ);
    if (!next) {
      this.halt();
      return;
    }

    const movedX = next[0] - from[0];
    const movedZ = next[2] - from[2];
    player.position = next;
    if (deltaSeconds > 0) {
      this.velocityX = movedX / deltaSeconds;
      this.velocityZ = movedZ / deltaSeconds;
    }
  }

  /**
   * One collision-clamped step, with the axis-projected retry that turns a dead stop into a slide.
   *
   * The navmesh snap alone already slides along a long flat wall — W+A into the March Company
   * Hall's south face covered 6.25 m. It stops dead where the snap comes back to the same point
   * every tick, which is a corner, a gate arch, or any blocker narrower than the step. Retrying
   * the step on each world axis and taking whichever travels furthest recovers the tangential
   * component in exactly those cases.
   */
  private clampStep(state: GameState, from: Vec3, stepX: number, stepZ: number): Vec3 | null {
    const wanted = Math.hypot(stepX, stepZ);
    const primary = this.clampToWorld(state, from, stepX, stepZ);
    const primaryGain = primary ? distanceXZ(primary, from) : -1;
    if (primary && primaryGain >= wanted * SLIDE_TRIGGER) return primary;

    let best = primary;
    let bestGain = primaryGain;
    if (stepX !== 0 && stepZ !== 0) {
      for (const candidate of [
        this.clampToWorld(state, from, stepX, 0),
        this.clampToWorld(state, from, 0, stepZ),
      ]) {
        if (!candidate) continue;
        const gain = distanceXZ(candidate, from);
        if (gain > bestGain) {
          best = candidate;
          bestGain = gain;
        }
      }
    }
    return bestGain > 0 ? best : null;
  }

  /**
   * Navmesh snap, then solids, then movers, then the ground. Null when the step is not legal.
   *
   * The acceptance test is the fix for finding 6: it used to be `distanceXZ(snapped, target) < 0.6`
   * — measured against the DESIRED TARGET, so a snap that moved the player five metres was
   * accepted as long as it landed near the target, and a snap eight metres up onto a roof was
   * refused only by the accident that the ground boundary happened to be nearer in 3D.
   */
  private clampToWorld(state: GameState, from: Vec3, stepX: number, stepZ: number): Vec3 | null {
    const desired: Vec3 = [from[0] + stepX, from[1], from[2] + stepZ];
    const snapped = this.nav.closestPoint(desired);
    if (!snapped) return null;

    const stepLength = Math.hypot(stepX, stepZ);
    if (distanceXZ(snapped, from) > stepLength + STEP_SLACK) return null;
    if (Math.abs(snapped[1] - from[1]) > MAX_STEP_UP) return null;

    let point = snapped;
    const solids = this.ports.solids;
    if (solids) point = solids.resolve(point, from, PLAYER_RADIUS);
    point = this.pushOutOfMovers(state, point);
    return this.ground(state, point);
  }

  /**
   * Pushes the point out of every moving entity's circle within `MOVER_QUERY_RADIUS`.
   *
   * Only npc / enemy / boss, and only alive ones — a corpse is scenery and standing on it is what
   * looting looks like.
   */
  private pushOutOfMovers(state: GameState, point: Vec3): Vec3 {
    const entities = this.ports.entities;
    if (!entities) return point;

    let x = point[0];
    let z = point[2];
    const playerId = state.player.id;
    entities.index().forEachInRadius(point, MOVER_QUERY_RADIUS, (id) => {
      if (id === playerId) return;
      const entity = entities.get(id);
      if (!entity) return;
      const radius = MOVER_RADII[entity.archetype];
      if (radius === undefined) return;
      if (entity.state === "dead" || entity.state === "depleted") return;
      if (Math.abs(point[1] - entity.position[1]) > MOVER_HEIGHT) return;

      const dx = x - entity.position[0];
      const dz = z - entity.position[2];
      const reach = radius + PLAYER_RADIUS;
      const gap = Math.hypot(dx, dz);
      if (gap >= reach) return;
      if (gap > 1e-6) {
        x = entity.position[0] + (dx / gap) * reach;
        z = entity.position[2] + (dz / gap) * reach;
      } else {
        x = entity.position[0] + reach;
      }
    });

    if (x === point[0] && z === point[2]) return point;
    return [x, point[1], z];
  }

  /**
   * Replaces the navmesh's Y with the terrain height, when the two agree closely enough to be
   * talking about the same surface. Keeps the navmesh authoritative for XZ.
   */
  private ground(state: GameState, point: Vec3): Vec3 {
    // Resolve the region from the navmesh point before sampling height. Portal traversals already
    // set their explicit destination region, but the walk after a portal can cross two more
    // overworld borders. Without this, a route from Gravelmaw to the Bracken Pit completed in
    // Fallowmarch while the semantic player still reported Karrowmoor.
    const regionAt = this.ports.regionAt;
    if (regionAt) state.player.regionId = regionAt(point, state.player.regionId);

    const heightAt = this.ports.heightAt;
    if (!heightAt) return point;
    const groundY = heightAt(state.player.regionId, point[0], point[2]);
    if (!Number.isFinite(groundY)) return point;
    if (Math.abs(groundY - point[1]) > GROUND_SNAP_MAX) return point;
    return [point[0], groundY, point[2]];
  }

  private halt(): void {
    this.velocityX = 0;
    this.velocityZ = 0;
  }

  private publishSpeed(movement: GameState["player"]["movement"]): void {
    const speed = Math.hypot(this.velocityX, this.velocityZ);
    this.speedMps = speed;
    this.gait = speed < IDLE_SPEED ? "idle" : speed < MOVEMENT.walkPoseThreshold ? "walk" : "run";
    const fields: MovementSpeedFields = { speed, gait: this.gait };
    Object.assign(movement, fields);
  }

  private followPath(state: GameState, deltaSeconds: number, deltaMs: number, atMs: number): void {
    const player = state.player;
    const movement = player.movement;
    const path = movement.path!;

    // Paths ramp up too. Without it, clicking a destination launches the player from 0 to 4.2 m/s
    // inside one tick, which is the same 42 cm teleport direct movement used to have.
    const speed = Math.hypot(this.velocityX, this.velocityZ);
    const stepSpeed = Math.min(MOVEMENT.runSpeed, speed + MOVEMENT.accelMps2 * deltaSeconds);
    const step = stepSpeed * deltaSeconds;

    const start = player.position;
    let position = player.position;
    let index = movement.pathIndex;
    let remaining = step;

    while (remaining > 0 && index < path.length) {
      const corner = path[index]!;
      const gap = distanceXZ(position, corner);
      if (gap <= 0.005) {
        index += 1;
        continue;
      }
      if (gap <= remaining) {
        position = [corner[0], corner[1], corner[2]];
        remaining -= gap;
        index += 1;
        continue;
      }
      const t = remaining / gap;
      position = [
        position[0] + (corner[0] - position[0]) * t,
        position[1] + (corner[1] - position[1]) * t,
        position[2] + (corner[2] - position[2]) * t,
      ];
      remaining = 0;
    }

    // Y between two Detour corners is a straight line and the ground is not: on the Karrowmoor
    // terraces a 3-point, 56 m path ran 4.46 m UNDER the surface at its midpoint and past 3 m under
    // for 60% of the segment. Re-snapping every tick is one Detour query at 10 Hz, which costs
    // nothing, and `applyDirect` has always done it.
    const snapped = this.nav.closestPoint(position);
    if (snapped && distanceXZ(snapped, position) < CORNER_RADIUS) position = snapped;
    const solids = this.ports.solids;
    if (solids) position = solids.resolve(position, start, PLAYER_RADIUS);
    position = this.ground(state, position);

    player.position = position;
    movement.pathIndex = index;
    if (deltaSeconds > 0) {
      this.velocityX = (position[0] - start[0]) / deltaSeconds;
      this.velocityZ = (position[2] - start[2]) / deltaSeconds;
    }

    // Face a point further down the path, not the next corner. That is what stops the visible
    // zig-zag: the body leads the turn instead of snapping at each vertex.
    const look = lookAheadPoint(path, index, position, LOOK_AHEAD);
    if (look) {
      const desired = Math.atan2(look[0] - position[0], look[2] - position[2]);
      if (Number.isFinite(desired)) {
        player.facingRad = turnToward(player.facingRad, desired, MAX_TURN_RATE, deltaMs);
      }
    }

    const destination = movement.destination;
    const arrived =
      index >= path.length ||
      (destination !== null && distanceXZ(position, destination) <= ARRIVE_EPSILON);

    if (arrived) {
      this.finishPath(state, atMs);
      return;
    }

    this.checkStuck(state, deltaMs, atMs);
  }

  private finishPath(state: GameState, atMs: number): void {
    const movement = state.player.movement;
    const entityId = movement.destinationEntityId;
    movement.mode = "idle";
    movement.path = null;
    movement.pathIndex = 0;
    movement.destination = null;
    movement.destinationEntityId = null;
    this.resetStuck(state);

    if (this.route) {
      this.advanceRoute(state, atMs);
      return;
    }
    this.events.emit("navigation.completed", { position: state.player.position }, entityId ?? undefined, atMs);
  }

  // ------------------------------------------------------------- routes

  private advanceRoute(state: GameState, atMs: number): boolean {
    const route = this.route;
    if (!route) return false;

    route.index += 1;
    const leg = route.legs[route.index];
    if (!leg) {
      const entityId = route.entityId;
      this.route = null;
      this.events.emit(
        "navigation.completed",
        { position: state.player.position, route: true },
        entityId ?? undefined,
        atMs,
      );
      return true;
    }

    // A portal leg is executed as a traversal, not as a second mechanism: the player is already
    // standing at the crossing (the leg before it walked them there), the crossing takes time, and
    // then they are somewhere the navmesh could not have carried them. The one thing a shortcut
    // does not do is change which region the player is in, so that rides on the leg.
    if (leg.kind === "shortcut" || leg.kind === "portal") {
      const movement = state.player.movement;
      const subjectId = leg.obstacleId ?? leg.portalId ?? null;
      movement.mode = "path";
      movement.path = null;
      movement.pathIndex = 0;
      movement.destination = leg.to;
      movement.destinationEntityId = subjectId;
      this.traversal = {
        endsAtMs: atMs + (leg.durationMs ?? 0),
        exit: leg.to,
        obstacleId: subjectId,
        regionId: leg.toRegionId ?? null,
      };
      this.events.emit(
        "activity.started",
        { kind: "traversing", via: leg.kind, obstacleId: subjectId, durationMs: leg.durationMs ?? 0 },
        subjectId ?? undefined,
        atMs,
      );
      return true;
    }

    // A route node can sit right beside a carved landmark, so a leg that stops a metre short of it
    // has arrived. Only a leg that cannot get near at all kills the route.
    const started = this.startPath(state, leg.to, null, atMs, {
      quiet: true,
      quietFailure: true,
      arrivalAllowance: ENTITY_ARRIVAL_ALLOWANCE,
    });
    if (started) return true;

    // A leg that cannot be walked kills the route rather than silently skipping ground.
    this.route = null;
    this.events.emit("navigation.failed", { reason: "leg-unreachable", legIndex: route.index }, undefined, atMs);
    return false;
  }

  private updateTraversal(state: GameState, atMs: number): void {
    const traversal = this.traversal;
    if (!traversal) return;
    if (atMs < traversal.endsAtMs) return;

    // Region before position: `ground` passes `state.player.regionId` to the height port. The live
    // sampler ignores that argument because the world is one continuous field, but the port's
    // signature takes it, so this is the ordering that stays right if that ever stops being true.
    if (traversal.regionId !== null) state.player.regionId = traversal.regionId;
    const landing = this.nav.closestPoint(traversal.exit) ?? traversal.exit;
    state.player.position = this.ground(state, landing);
    this.traversal = null;
    this.events.emit(
      "activity.stopped",
      { kind: "traversing", completed: true },
      traversal.obstacleId ?? undefined,
      atMs,
    );

    const movement = state.player.movement;
    movement.mode = "idle";
    movement.destination = null;
    movement.destinationEntityId = null;

    if (this.route) this.advanceRoute(state, atMs);
  }

  // -------------------------------------------------------- stuck rescue

  private resetStuck(state: GameState): void {
    this.stuckSincePosition = state.player.position;
    this.stuckWindowMs = 0;
    this.recoveries = 0;
  }

  /**
   * Recovery ladder. A path that stops making progress is almost always the player standing a
   * fraction off the mesh after a snap, so: re-snap, then replan from where we actually are, then
   * give up honestly rather than jittering forever.
   */
  private checkStuck(state: GameState, deltaMs: number, atMs: number): void {
    this.stuckWindowMs += deltaMs;
    if (this.stuckWindowMs < STUCK_WINDOW_MS) return;

    const previous = this.stuckSincePosition;
    const moved = previous ? distanceXZ(previous, state.player.position) : Infinity;
    this.stuckWindowMs = 0;
    this.stuckSincePosition = state.player.position;
    if (moved >= STUCK_DISTANCE) {
      this.recoveries = 0;
      return;
    }

    const destination = state.player.movement.destination;
    if (!destination) return;

    if (this.recoveries === 0) {
      const snapped = this.nav.nearestWalkable(state.player.position, 4);
      if (snapped) state.player.position = snapped;
      this.recoveries += 1;
      return;
    }

    if (this.recoveries < MAX_RECOVERIES) {
      this.recoveries += 1;
      const entityId = state.player.movement.destinationEntityId;
      const replanned = this.startPath(state, destination, entityId, atMs, {
        quiet: true,
        // A route leg was started with this allowance, so a replan that demanded exact arrival
        // could refuse a leg the route had already accepted and kill a journey that was working.
        ...(this.route ? { arrivalAllowance: ENTITY_ARRIVAL_ALLOWANCE } : {}),
      });
      if (replanned) return;
    }

    this.events.emit(
      "navigation.failed",
      { reason: "stuck", position: state.player.position },
      state.player.movement.destinationEntityId ?? undefined,
      atMs,
    );
    this.stop(state, atMs, "stuck");
  }

  // ------------------------------------------------------------ helpers

  /**
   * Rounds the corners of a string-pulled path, then validates every inserted point against the
   * navmesh. Cutting a corner means cutting toward whatever obstacle put the corner there, so a
   * point that snaps more than 0.75 m is discarded and the original hard corner is kept.
   */
  private smooth(path: readonly Vec3[]): Vec3[] {
    const rounded = roundCorners(path, CORNER_RADIUS);
    if (rounded.length === path.length) return this.subdivide(rounded);

    const validated: Vec3[] = [];
    for (const [index, point] of rounded.entries()) {
      if (index === 0 || index === rounded.length - 1) {
        validated.push(point);
        continue;
      }
      const snapped = this.nav.closestPoint(point);
      validated.push(snapped && distanceXZ(snapped, point) < 0.75 ? snapped : point);
    }
    return this.subdivide(validated);
  }

  /**
   * Puts elevation back into the corner list.
   *
   * Detour string-pulls to the minimum corners needed for horizontal clearance, so the Karrowmoor
   * terraces path arrived as 3 points over 56 m with no intermediate heights at all, and
   * `followPath` lerped Y straight through the hill. Each inserted point is snapped to the mesh,
   * so the list carries the real surface; anything that snaps more than 0.75 m is discarded rather
   * than trusted, the same rule the corner rounding uses, because a large snap means the inserted
   * point cut toward whatever the corner was avoiding.
   *
   * Cost is one Detour query per 3 m of path, paid once when the path is planned: a 56 m path buys
   * about 19 of them, against 10 per second for the old followPath's zero.
   */
  private subdivide(path: readonly Vec3[]): Vec3[] {
    if (path.length < 2) return [...path];
    const output: Vec3[] = [path[0]!];

    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1]!;
      const to = path[index]!;
      const gap = distanceXZ(from, to);
      const pieces = Math.ceil(gap / MAX_PATH_SEGMENT);
      for (let piece = 1; piece < pieces; piece += 1) {
        const point = lerpVec(from, to, piece / pieces);
        const snapped = this.nav.closestPoint(point);
        output.push(snapped && distanceXZ(snapped, point) < 0.75 ? snapped : point);
      }
      output.push(to);
    }
    return output;
  }

  remainingDistance(state: GameState): number {
    const movement = state.player.movement;
    let total = 0;

    if (movement.mode === "path" && movement.path) {
      const rest = movement.path.slice(Math.max(0, movement.pathIndex));
      if (rest.length > 0) total += distanceXZ(state.player.position, rest[0]!) + pathLength(rest);
    }

    if (this.route) {
      for (let index = this.route.index + 1; index < this.route.legs.length; index += 1) {
        total += this.route.legs[index]!.cost * PLAYER_SPEED;
      }
    }
    return total;
  }
}

// ------------------------------------------------------------- geometry

function turnToward(current: number, desired: number, rateRadPerSecond: number, deltaMs: number): number {
  let delta = desired - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const maxStep = rateRadPerSecond * (deltaMs / 1000);
  if (Math.abs(delta) <= maxStep) return desired;
  return current + Math.sign(delta) * maxStep;
}

/** The point `distance` metres further along the path from `position`. */
function lookAheadPoint(path: readonly Vec3[], index: number, position: Vec3, distance: number): Vec3 | null {
  let budget = distance;
  let cursor = position;
  for (let i = index; i < path.length; i += 1) {
    const corner = path[i]!;
    const gap = distanceXZ(cursor, corner);
    if (gap >= budget) {
      const t = gap === 0 ? 0 : budget / gap;
      return [
        cursor[0] + (corner[0] - cursor[0]) * t,
        corner[1],
        cursor[2] + (corner[2] - cursor[2]) * t,
      ];
    }
    budget -= gap;
    cursor = corner;
  }
  return path.length > 0 ? path[path.length - 1]! : null;
}

/**
 * Drops the tail of a path so the walk ends `stopDistance` metres short of the destination.
 * Used for walk-into-interaction-range: stopping 2.4 m from an ore node, not inside it.
 *
 * `destination` is the point the CALLER asked for, not the point the path ends at, and the
 * difference is load-bearing now that solid volumes are carved out of the navmesh. A path to an
 * ore rock stops at the edge of the rock's carve, perhaps 1.0 m short; trimming another 2.4 m off
 * that would leave the player 3.4 m away and outside `INTERACT_RANGE`, and seven gate-check lines
 * depend on `moveTo({ entityId })` still landing within 2.4 m.
 */
function trimTail(path: readonly Vec3[], stopDistance: number, destination: Vec3): Vec3[] {
  if (stopDistance <= 0 || path.length < 2) return [...path];
  const end = destination;

  let cut = -1;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (distanceXZ(path[index]!, end) >= stopDistance) {
      cut = index;
      break;
    }
  }
  // Already inside the stop radius: stay put.
  if (cut < 0) return [path[0]!];

  const output = path.slice(0, cut + 1);
  // When the cut point is the second to last corner, the remaining segment runs straight at the
  // destination, so the stop point is an exact interpolation. Otherwise stop at the corner, which
  // is never closer than requested.
  if (cut === path.length - 2) {
    const from = path[cut]!;
    const gap = distanceXZ(from, end);
    if (gap > stopDistance) {
      output.push(lerpVec(from, end, (gap - stopDistance) / gap));
    }
  }
  return output;
}

/**
 * Replaces each interior corner with a short quadratic arc. Endpoints are preserved exactly, so
 * arrival checks and reported path length still refer to the real destination.
 */
function roundCorners(path: readonly Vec3[], radius: number): Vec3[] {
  if (path.length < 3) return [...path];
  const output: Vec3[] = [path[0]!];

  for (let i = 1; i < path.length - 1; i += 1) {
    const previous = path[i - 1]!;
    const corner = path[i]!;
    const next = path[i + 1]!;
    const lengthIn = distanceXZ(previous, corner);
    const lengthOut = distanceXZ(corner, next);
    const r = Math.min(radius, lengthIn * 0.45, lengthOut * 0.45);

    if (r < 0.2) {
      output.push(corner);
      continue;
    }

    const entry = lerpVec(corner, previous, r / lengthIn);
    const exit = lerpVec(corner, next, r / lengthOut);
    output.push(entry);
    for (const t of [0.25, 0.5, 0.75]) {
      output.push(quadratic(entry, corner, exit, t));
    }
    output.push(exit);
  }

  output.push(path[path.length - 1]!);
  return output;
}

function lerpVec(from: Vec3, to: Vec3, t: number): Vec3 {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function quadratic(a: Vec3, b: Vec3, c: Vec3, t: number): Vec3 {
  const inverse = 1 - t;
  const w0 = inverse * inverse;
  const w1 = 2 * inverse * t;
  const w2 = t * t;
  return [
    a[0] * w0 + b[0] * w1 + c[0] * w2,
    a[1] * w0 + b[1] * w1 + c[1] * w2,
    a[2] * w0 + b[2] * w1 + c[2] * w2,
  ];
}
