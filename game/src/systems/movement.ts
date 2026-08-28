/**
 * Player movement. Two modes, both ending in the same place: a position on the navmesh.
 *
 *  - "path"   click-to-move. A navmesh path, walked corner to corner.
 *  - "direct" WASD. A desired direction, projected back onto the navmesh each step.
 *
 * Movement is authoritative in the store. The renderer follows it, never the other way round.
 */
import type { EntityId, Vec3 } from "../contracts.js";
import type { GameState } from "../state/store.js";
import type { Navigation } from "./navigation.js";
import type { EventBus } from "../core/events.js";
import { PLAYER_SPEED } from "../app/config.js";
import { distanceXZ, pathLength } from "../core/math.js";

const ARRIVE_EPSILON = 0.35;
const CORNER_EPSILON = 0.45;

export interface DirectInput {
  forward: number;  // -1..1
  strafe: number;   // -1..1
  /** Camera yaw in radians, so W means "away from the camera". */
  cameraYaw: number;
}

export class Movement {
  private direct: DirectInput = { forward: 0, strafe: 0, cameraYaw: 0 };

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

  /** Starts click-to-move. Returns the path length, or null when unreachable. */
  startPath(state: GameState, to: Vec3, entityId: EntityId | null, atMs: number): { pathLength: number; etaMs: number } | null {
    const path = this.nav.findPath(state.player.position, to);
    if (!path || path.length === 0) {
      this.events.emit("navigation.failed", { reason: "unreachable", to }, entityId ?? undefined, atMs);
      return null;
    }

    const movement = state.player.movement;
    movement.mode = "path";
    movement.path = path;
    movement.pathIndex = 0;
    movement.destination = path[path.length - 1]!;
    movement.destinationEntityId = entityId;

    const length = pathLength(path);
    const etaMs = this.nav.etaMs(path);
    this.events.emit(
      "navigation.started",
      { pathLength: Math.round(length * 100) / 100, etaMs, points: path.length },
      entityId ?? undefined,
      atMs,
    );
    return { pathLength: length, etaMs };
  }

  stop(state: GameState, atMs: number, reason = "cancelled"): boolean {
    const movement = state.player.movement;
    if (movement.mode === "idle") return false;
    const wasNavigating = movement.mode === "path";
    movement.mode = "idle";
    movement.path = null;
    movement.pathIndex = 0;
    movement.destination = null;
    movement.destinationEntityId = null;
    if (wasNavigating) this.events.emit("navigation.failed", { reason }, undefined, atMs);
    return true;
  }

  /** One sim tick of movement. */
  update(state: GameState, deltaMs: number, atMs: number): void {
    const player = state.player;
    const movement = player.movement;
    const step = PLAYER_SPEED * (deltaMs / 1000);

    // Direct input always wins. Pressing a key mid-path cancels the path, as a player expects.
    if (this.hasDirectInput()) {
      if (movement.mode === "path") this.stop(state, atMs, "interrupted-by-input");
      this.applyDirect(state, step);
      movement.mode = "direct";
      return;
    }

    if (movement.mode === "direct") {
      movement.mode = "idle";
      return;
    }

    if (movement.mode !== "path" || !movement.path) return;
    this.followPath(state, step, atMs);
  }

  private applyDirect(state: GameState, step: number): void {
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
    player.facingRad = Math.atan2(dirX, dirZ);
  }

  private followPath(state: GameState, step: number, atMs: number): void {
    const player = state.player;
    const movement = player.movement;
    const path = movement.path!;
    let remaining = step;

    while (remaining > 0 && movement.pathIndex < path.length) {
      const corner = path[movement.pathIndex]!;
      const gap = distanceXZ(player.position, corner);

      if (gap <= CORNER_EPSILON) {
        movement.pathIndex += 1;
        continue;
      }

      const travel = Math.min(remaining, gap);
      const t = travel / gap;
      player.position = [
        player.position[0] + (corner[0] - player.position[0]) * t,
        corner[1],
        player.position[2] + (corner[2] - player.position[2]) * t,
      ];
      player.facingRad = Math.atan2(corner[0] - player.position[0], corner[2] - player.position[2]);
      remaining -= travel;
    }

    const destination = movement.destination;
    const arrived =
      movement.pathIndex >= path.length ||
      (destination !== null && distanceXZ(player.position, destination) <= ARRIVE_EPSILON);

    if (arrived) {
      const entityId = movement.destinationEntityId;
      movement.mode = "idle";
      movement.path = null;
      movement.pathIndex = 0;
      movement.destination = null;
      movement.destinationEntityId = null;
      this.events.emit("navigation.completed", { position: player.position }, entityId ?? undefined, atMs);
    }
  }

  remainingDistance(state: GameState): number {
    const movement = state.player.movement;
    if (movement.mode !== "path" || !movement.path) return 0;
    const rest = movement.path.slice(Math.max(0, movement.pathIndex));
    if (rest.length === 0) return 0;
    return distanceXZ(state.player.position, rest[0]!) + pathLength(rest);
  }
}
