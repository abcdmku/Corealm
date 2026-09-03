/**
 * Guidance: everything that says "go there" to the player, and knows when they got there.
 *
 * Sits between `GameApi.overlay` and the overlay renderer. A `marker` overlay is a destination,
 * so this layer gives it what a destination needs: a ground route planned from the player and
 * re-planned as they walk, an arrival check against the target, a flourish and an
 * `overlay.arrived` event when they get there, and — unless the marker was set to persist — its
 * own removal. Every other overlay kind passes straight through to the renderer.
 *
 * Two things in the game are sequences of destinations, and both are driven from here rather than
 * from the code that owns them:
 *
 *  - The agent's proposed plan (`agent/session.ts` `Proposal`). Its current step is drawn as the
 *    guide marker, arrival advances the cursor, and the next step lights up. The session holds the
 *    plan and has no world access; this layer watches it and does the seeing.
 *  - The pinned quest (`ui/questTracker.ts`). Its current objective is drawn as a persistent
 *    marker and follows the objective as stages complete (`quest.updated`).
 *
 * Loaded by boot through a dynamic import, with the renderer behind it, so none of it sits on the
 * critical boot graph.
 */
import {
  asTypedEvent,
  type EntityId, type GameEvent, type GameEventPayloads, type GameEventType, type MoveTarget, type OverlaySpec,
  type PathPlan, type QuestId, type QuestSummary, type Result, type Vec3,
} from "../contracts.js";
import type { AgentSession } from "../agent/session.js";
import {
  GUIDE_COLOUR, GUIDE_STEP_OVERLAY_ID, GUIDE_UPCOMING_PREFIX, QUEST_OVERLAY_ID, guideOverlaySpecs, isGuideOverlayId,
} from "../agent/guide.js";
import { Overlays, type OverlayDeps } from "../render/overlays.js";

/** Boot's entry: the renderer and the layer over it, built together behind one dynamic import. */
export function createGuidance(
  overlayDeps: OverlayDeps,
  deps: Omit<GuidanceDeps, "overlays">,
): { overlays: Overlays; guidance: Guidance } {
  const overlays = new Overlays(overlayDeps);
  return { overlays, guidance: new Guidance({ ...deps, overlays }) };
}

/** What this layer asks of the overlay renderer. `render/overlays.ts` is the one implementation. */
export interface OverlayLayer {
  set(spec: OverlaySpec, nowMs: number): number;
  clear(id?: string): number;
  has(id: string): boolean;
  activeCount(): number;
  setRoute(id: string, points: readonly Vec3[] | null): boolean;
  /** Slides a route's visible head to `position`; null when the overlay has no route. */
  setRouteHead(id: string, position: Vec3): { along: number; lateral: number; remaining: number } | null;
  setReached(id: string, position: Vec3, nowMs: number, colour?: string): number;
  update(nowMs: number): void;
}

export interface GuidanceDeps {
  overlays: OverlayLayer;
  /** Sim clock, milliseconds. */
  now(): number;
  playerPosition(): Vec3;
  entityPosition(entityId: EntityId): Vec3 | null;
  planPath(target: MoveTarget): Result<PathPlan>;
  /**
   * `GameApi.overlay`. Resolves location ids and validates targets, then lands back in this
   * layer's `set`/`clear` as the registered hook — the guide and the quest marker are drawn
   * through it so they get the same resolution an agent's marker does.
   */
  overlay(op: "set" | "clear", spec?: OverlaySpec): Result<{ activeCount: number }>;
  emit<T extends GameEventType>(type: T, data: GameEventPayloads[T]): void;
}

export interface QuestSource {
  pinnedQuestId(): QuestId | null;
  quests(): QuestSummary[];
}

type WaypointOwner = "overlay" | "guide" | "quest";

interface Waypoint {
  id: string;
  spec: OverlaySpec;
  target: MoveTarget;
  owner: WaypointOwner;
  radius: number;
  persist: boolean;
  wantRoute: boolean;
  /** False for a guide step tracked in guide mode: arrival counts, nothing is drawn. */
  visible: boolean;
  /** Inside the arrival radius right now. */
  near: boolean;
  plannedTo: Vec3 | null;
  plannedAtMs: number;
  planFailed: boolean;
}

/** Arrival radii by target kind. An entity has a size; a place is an area. */
const ARRIVE_ENTITY_METRES = 4;
const ARRIVE_LOCATION_METRES = 8;
const ARRIVE_POSITION_METRES = 5;
/** A persisted marker gets its route back once the player has left by this much more. */
const LEAVE_HYSTERESIS_METRES = 2;
/**
 * The route's visible head slides along the standing ribbon every frame; the ribbon itself is only
 * re-planned when the player has strayed this far off it...
 */
const REPLAN_STRAY_METRES = 1.5;
/** ...or walked this far along it (the walked part is invisible, but it is still geometry)... */
const REPLAN_ALONG_METRES = 6;
/** ...or the target has moved this far. */
const REPLAN_TARGET_METRES = 0.75;
/** And never more often than this, so a sprint does not plan every frame. */
const REPLAN_MIN_INTERVAL_MS = 200;
/** A route that could not be planned is retried at this cadence. */
const REPLAN_RETRY_MS = 2000;
/** How often the pinned quest is re-read when nothing announced a change. */
const QUEST_POLL_MS = 500;

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function targetOf(spec: OverlaySpec): MoveTarget | null {
  if (spec.entityId) return { entityId: spec.entityId };
  if (spec.locationId) return { locationId: spec.locationId };
  if (spec.position) return { position: spec.position };
  return null;
}

function defaultRadius(target: MoveTarget): number {
  if ("entityId" in target) return ARRIVE_ENTITY_METRES;
  if ("locationId" in target) return ARRIVE_LOCATION_METRES;
  return ARRIVE_POSITION_METRES;
}

export class Guidance {
  private readonly waypoints = new Map<string, Waypoint>();
  private session: AgentSession | null = null;
  private guideSignature = "";
  /** Overlay ids the guide drew last time, so they can be taken down whatever the plan became. */
  private guideDrawn: string[] = [];
  private questSource: QuestSource | null = null;
  private questSignature = "";
  private questDirty = true;
  private questPolledAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: GuidanceDeps) {}

  // ---------------------------------------------------------------- the hook

  /** `GameApi.overlay("set")` lands here with ids already resolved. Returns the active count. */
  set(spec: OverlaySpec): number {
    if (spec.kind !== "marker") {
      this.waypoints.delete(spec.id);
      return this.deps.overlays.set(spec, this.deps.now());
    }
    const owner: WaypointOwner = spec.id === GUIDE_STEP_OVERLAY_ID ? "guide" : spec.id === QUEST_OVERLAY_ID ? "quest" : "overlay";
    const visible = owner !== "guide" || this.session?.read().mode !== "guide";
    return this.setWaypoint(spec, owner, visible);
  }

  /** `GameApi.overlay("clear")`. Clearing everything takes the guide and quest markers down too. */
  clear(id?: string): number {
    if (id === undefined) {
      this.waypoints.clear();
      const count = this.deps.overlays.clear();
      // The plan and the pinned quest are still there; put their markers back.
      this.guideSignature = "";
      this.guideDrawn = [];
      this.questSignature = "";
      this.syncGuide();
      this.syncQuest();
      return this.deps.overlays.activeCount() || count;
    }
    this.waypoints.delete(id);
    return this.deps.overlays.clear(id);
  }

  // -------------------------------------------------------------- per frame

  /**
   * Once a frame, before the renderer's own update, which it runs. `renderPosition` is the
   * player as drawn this frame — interpolated between sim ticks — so the route head slides
   * rather than stepping at the sim rate; the store's position is the fallback.
   */
  update(nowMs: number, renderPosition?: Vec3): void {
    const player = renderPosition ?? this.deps.playerPosition();
    for (const waypoint of [...this.waypoints.values()]) {
      const target = this.resolve(waypoint);
      if (!target) continue;
      const gap = distanceXZ(player, target);
      if (!waypoint.near && gap <= waypoint.radius) {
        this.arrive(waypoint, target, nowMs);
        continue;
      }
      if (waypoint.near && gap > waypoint.radius + LEAVE_HYSTERESIS_METRES) waypoint.near = false;
      if (!waypoint.near) this.refreshRoute(waypoint, player, target, nowMs, false);
    }
    if (this.questDirty || nowMs - this.questPolledAtMs >= QUEST_POLL_MS) {
      this.questPolledAtMs = nowMs;
      this.questDirty = false;
      this.syncQuest();
    }
    this.deps.overlays.update(nowMs);
  }

  /** Every game event, from boot's bus subscription. */
  onEvent(event: GameEvent): void {
    if (event.type === "quest.updated") {
      this.questDirty = true;
      return;
    }
    // Starting to use the thing a marker points at is arriving, whatever the distance: a bank
    // counter or a furnace is interacted with from further away than its centre is near.
    const dialogue = asTypedEvent(event, "dialogue.opened");
    const activity = asTypedEvent(event, "activity.started");
    const entityId = dialogue?.data.npcId ?? activity?.data.entityId ?? activity?.entityId;
    if (!entityId) return;
    for (const waypoint of [...this.waypoints.values()]) {
      if (waypoint.near || waypoint.spec.entityId !== entityId) continue;
      const target = this.resolve(waypoint) ?? this.deps.playerPosition();
      this.arrive(waypoint, target, this.deps.now());
    }
  }

  // ---------------------------------------------------------------- sources

  /** The agent session, once boot has it. The plan is drawn from here on. */
  attachSession(session: AgentSession): void {
    this.session = session;
    session.subscribe(() => this.syncGuide());
    this.syncGuide();
  }

  /** The quest tracker's pin and the quest list, once the UI exists. */
  attachQuests(source: QuestSource): void {
    this.questSource = source;
    this.questDirty = true;
  }

  // --------------------------------------------------------------- waypoints

  private setWaypoint(spec: OverlaySpec, owner: WaypointOwner, visible: boolean): number {
    const target = targetOf(spec);
    if (!target) return this.deps.overlays.set(spec, this.deps.now());
    const nowMs = this.deps.now();
    const waypoint: Waypoint = {
      id: spec.id,
      spec,
      target,
      owner,
      radius: spec.arriveRadius ?? defaultRadius(target),
      persist: spec.persist === true,
      wantRoute: spec.route !== false,
      visible,
      near: false,
      plannedTo: null,
      plannedAtMs: Number.NEGATIVE_INFINITY,
      planFailed: false,
    };
    this.waypoints.set(spec.id, waypoint);
    let count = this.deps.overlays.activeCount();
    if (visible) count = this.deps.overlays.set(spec, nowMs);
    else this.deps.overlays.clear(spec.id);
    // Judged now rather than next frame, so a marker set at the player's feet never draws a route
    // to nowhere, and one set at a distance has its route on the first frame it is seen.
    const resolved = this.resolve(waypoint);
    if (resolved) {
      const player = this.deps.playerPosition();
      if (distanceXZ(player, resolved) <= waypoint.radius) this.arrive(waypoint, resolved, nowMs);
      else this.refreshRoute(waypoint, player, resolved, nowMs, true);
    }
    return this.waypoints.has(spec.id) ? count : this.deps.overlays.activeCount();
  }

  private resolve(waypoint: Waypoint): Vec3 | null {
    if (waypoint.spec.entityId) return this.deps.entityPosition(waypoint.spec.entityId);
    return waypoint.spec.position ?? null;
  }

  private refreshRoute(waypoint: Waypoint, player: Vec3, target: Vec3, nowMs: number, force: boolean): void {
    if (!waypoint.wantRoute || !waypoint.visible) return;
    const since = nowMs - waypoint.plannedAtMs;
    if (!force) {
      // Every frame: the head follows the player along the ribbon that is already there.
      const head = waypoint.planFailed ? null : this.deps.overlays.setRouteHead(waypoint.id, player);
      if (since < REPLAN_MIN_INTERVAL_MS) return;
      if (waypoint.planFailed && since < REPLAN_RETRY_MS) return;
      const strayed = !head || head.lateral > REPLAN_STRAY_METRES || head.along >= REPLAN_ALONG_METRES;
      const targetMoved = !waypoint.plannedTo || distanceXZ(target, waypoint.plannedTo) >= REPLAN_TARGET_METRES;
      if (!strayed && !targetMoved) return;
    }
    waypoint.plannedAtMs = nowMs;
    waypoint.plannedTo = [target[0], target[1], target[2]];
    const plan = this.deps.planPath(waypoint.target);
    waypoint.planFailed = !plan.ok;
    this.deps.overlays.setRoute(waypoint.id, plan.ok ? plan.value.points : null);
  }

  private arrive(waypoint: Waypoint, target: Vec3, nowMs: number): void {
    waypoint.near = true;
    this.deps.overlays.setRoute(waypoint.id, null);
    const cleared = !waypoint.persist;
    if (cleared) {
      this.waypoints.delete(waypoint.id);
      this.deps.overlays.clear(waypoint.id);
      if (waypoint.visible) this.deps.overlays.setReached(`${waypoint.id}#reached`, target, nowMs, waypoint.spec.colour ?? GUIDE_COLOUR);
    }
    this.deps.emit("overlay.arrived", { id: waypoint.id, position: target, cleared });
    if (waypoint.owner === "guide") this.guideArrived();
  }

  // ------------------------------------------------------------------- guide

  private guideArrived(): void {
    const session = this.session;
    if (!session) return;
    const proposal = session.read().proposal;
    if (!proposal || proposal.currentStep === null) return;
    const step = proposal.steps[proposal.currentStep];
    // A manual step keeps its pin; the player is meant to do something there. The agent advances it.
    if (step?.done === "arrive") session.advanceProposal("arrived");
  }

  private syncGuide(): void {
    const session = this.session;
    if (!session) return;
    const view = session.read();
    const proposal = view.proposal;
    const signature = proposal
      ? `${proposal.proposedAtMs}|${proposal.currentStep}|${proposal.steps.map((step) => step.status[0]).join("")}|${view.mode}`
      : "";
    if (signature === this.guideSignature) return;
    this.guideSignature = signature;

    for (const id of this.guideDrawn) this.clear(id);
    for (const id of [...this.waypoints.keys()]) if (isGuideOverlayId(id)) this.clear(id);
    this.guideDrawn = [];

    const visible = view.mode !== "guide";
    for (const spec of guideOverlaySpecs(proposal)) {
      // Labels for the steps still to come are decoration; in guide mode there is none. The
      // current step goes through `set` whatever the mode, so arrival is tracked either way.
      if (!visible && spec.id.startsWith(GUIDE_UPCOMING_PREFIX)) continue;
      const result = this.deps.overlay("set", spec);
      if (result.ok) this.guideDrawn.push(spec.id);
    }
  }

  // ------------------------------------------------------------------- quest

  private syncQuest(): void {
    const source = this.questSource;
    if (!source) return;
    const pinned = source.pinnedQuestId();
    const quest = pinned ? source.quests().find((entry) => entry.id === pinned) : undefined;
    const active = quest && quest.status === "active" ? quest : null;
    const signature = active ? `${active.id}|${active.stage}` : "";
    if (signature === this.questSignature) return;
    this.questSignature = signature;

    this.clear(QUEST_OVERLAY_ID);
    if (!active) return;
    const refs = active.currentObjectiveRefs;
    const entityRef = refs.find((ref) => ref.kind === "entity");
    const locationRef = refs.find((ref) => ref.kind === "location");
    const target: Pick<OverlaySpec, "entityId" | "locationId"> | null = entityRef
      ? { entityId: entityRef.id as EntityId }
      : locationRef ? { locationId: locationRef.id } : null;
    if (!target) return;
    // Persistent: the objective decides when it is done, not proximity. Arriving only takes the
    // route away; `quest.updated` moves the pin to the next stage.
    this.deps.overlay("set", { id: QUEST_OVERLAY_ID, kind: "marker", ...target, text: active.name, colour: GUIDE_COLOUR, persist: true });
  }
}
