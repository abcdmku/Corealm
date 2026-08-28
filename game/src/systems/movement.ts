/**
 * Player movement. Three modes, all ending in the same place: a position on the navmesh.
 *
 *  - "path"   click-to-move. A navmesh path, rounded at the corners, walked by arc length.
 *  - "direct" WASD. A desired direction, projected back onto the navmesh each step.
 *  - route    a planned multi-leg journey: walk, traverse an Agility shortcut, walk again.
 *
 * Movement is authoritative in the store. The renderer follows it, never the other way round.
 *
 * Two things here exist because the round-0 version looked wrong on screen rather than because it
 * was incorrect. Detour's string-pulled path hugs polygon corners, so walking it literally makes
 * the player pivot on the spot at every corner; `roundCorners` replaces each corner with a short
 * arc. And facing was assigned from the vector to the corner AFTER moving onto it, which is a zero
 * vector at arrival and snapped the player to face north; facing is now interpolated toward a
 * look-ahead point at a bounded turn rate.
 */
import type { EntityId, Vec3 } from "../contracts.js";
import type { GameState } from "../state/store.js";
import type { Navigation, RouteLeg } from "./navigation.js";
import type { EventBus } from "../core/events.js";
import { PLAYER_SPEED } from "../app/config.js";
import { distanceXZ, pathLength } from "../core/math.js";

/** How close counts as arrived, in metres. */
const ARRIVE_EPSILON = 0.35;
/** Metres ahead on the path the player looks while turning. */
const LOOK_AHEAD = 1.8;
/** Radians per second. About 400 deg/s: fast enough to feel responsive, slow enough to read. */
const MAX_TURN_RATE = 7;
/** Corner rounding radius in metres, clamped to 45% of the shorter adjacent segment. */
const CORNER_RADIUS = 1.25;
/** Stuck detection window. */
const STUCK_WINDOW_MS = 700;
const STUCK_DISTANCE = 0.18;
const MAX_RECOVERIES = 2;

export interface DirectInput {
  forward: number;  // -1..1
  strafe: number;   // -1..1
  /** Camera yaw in radians, so W means "away from the camera". */
  cameraYaw: number;
}

export interface PathOptions {
  /** Stop this many metres short of the destination. Walk-into-interact-range uses it. */
  stopDistance?: number;
  /** Suppress navigation.started. Used for the middle legs of a planned route. */
  quiet?: boolean;
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
}

export class Movement {
  private direct: DirectInput = { forward: 0, strafe: 0, cameraYaw: 0 };

  private route: { legs: RouteLeg[]; index: number; entityId: EntityId | null } | null = null;
  private traversal: Traversal | null = null;

  private stuckSincePosition: Vec3 | null = null;
  private stuckWindowMs = 0;
  private recoveries = 0;

  constructor(
    private readonly nav: Navigation,
    private readonly events: EventBus,
  ) {}

  setDirectInput(input: DirectInput): void {
    this.direct = input;
  }

  hasDirectInput(): boolean {
    return this.direct.forward !== 0 || this.direct.strafe !== 0;
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
    const raw = this.nav.findPath(state.player.position, to);
    if (!raw || raw.length === 0) {
      this.events.emit("navigation.failed", { reason: "unreachable", to }, entityId ?? undefined, atMs);
      return null;
    }

    const trimmed = options.stopDistance ? trimTail(raw, options.stopDistance) : raw;
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
   * Walks a planned route leg by leg, including Agility shortcut traversals.
   *
   * This is the second half of architecture correction R2. `Navigation.planRoute` decides WHICH
   * shortcuts are worth using; this walks the answer. A shortcut leg is a timed traversal followed
   * by a placement at the obstacle's exit — a gameplay step, interruptible, not a Detour link.
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
    const player = state.player;
    const movement = player.movement;
    const step = PLAYER_SPEED * (deltaMs / 1000);

    // Direct input always wins. Pressing a key mid-path cancels the path, as a player expects.
    if (this.hasDirectInput()) {
      if (movement.mode === "path" || this.route) this.stop(state, atMs, "interrupted-by-input");
      this.applyDirect(state, step, deltaMs);
      movement.mode = "direct";
      return;
    }

    if (this.traversal) {
      this.updateTraversal(state, atMs);
      return;
    }

    if (movement.mode === "direct") {
      movement.mode = "idle";
      return;
    }

    if (movement.mode !== "path" || !movement.path) {
      if (this.route) this.advanceRoute(state, atMs);
      return;
    }

    this.followPath(state, step, deltaMs, atMs);
  }

  private applyDirect(state: GameState, step: number, deltaMs: number): void {
    const { forward, strafe, cameraYaw } = this.direct;
    const magnitude = Math.hypot(forward, strafe);
    if (magnitude === 0) return;

    // Screen-relative: forward is away from the camera.
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const dirX = (strafe * cos - forward * sin) / magnitude;
    const dirZ = (-strafe * sin - forward * cos) / magnitude;

    const player = state.player;
    const target: Vec3 = [
      player.position[0] + dirX * step,
      player.position[1],
      player.position[2] + dirZ * step,
    ];

    const snapped = this.nav.closestPoint(target);
    // Reject a snap that yanks the player sideways — that means they walked into a wall.
    if (snapped && distanceXZ(snapped, target) < 0.6) {
      player.position = snapped;
    }
    // Direct input turns faster than pathing: the player is steering by hand and expects response.
    player.facingRad = turnToward(player.facingRad, Math.atan2(dirX, dirZ), MAX_TURN_RATE * 1.8, deltaMs);
  }

  private followPath(state: GameState, step: number, deltaMs: number, atMs: number): void {
    const player = state.player;
    const movement = player.movement;
    const path = movement.path!;

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

    player.position = position;
    movement.pathIndex = index;

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

    if (leg.kind === "shortcut") {
      const movement = state.player.movement;
      movement.mode = "path";
      movement.path = null;
      movement.pathIndex = 0;
      movement.destination = leg.to;
      movement.destinationEntityId = leg.obstacleId ?? null;
      this.traversal = {
        endsAtMs: atMs + (leg.durationMs ?? 0),
        exit: leg.to,
        obstacleId: leg.obstacleId ?? null,
      };
      this.events.emit(
        "activity.started",
        { kind: "traversing", obstacleId: leg.obstacleId ?? null, durationMs: leg.durationMs ?? 0 },
        leg.obstacleId,
        atMs,
      );
      return true;
    }

    const started = this.startPath(state, leg.to, null, atMs, { quiet: true });
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

    const landing = this.nav.closestPoint(traversal.exit) ?? traversal.exit;
    state.player.position = landing;
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
      const replanned = this.startPath(state, destination, entityId, atMs, { quiet: true });
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
    if (rounded.length === path.length) return rounded;

    const validated: Vec3[] = [];
    for (const [index, point] of rounded.entries()) {
      if (index === 0 || index === rounded.length - 1) {
        validated.push(point);
        continue;
      }
      const snapped = this.nav.closestPoint(point);
      validated.push(snapped && distanceXZ(snapped, point) < 0.75 ? snapped : point);
    }
    return validated;
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
 */
function trimTail(path: readonly Vec3[], stopDistance: number): Vec3[] {
  if (stopDistance <= 0 || path.length < 2) return [...path];
  const end = path[path.length - 1]!;

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
