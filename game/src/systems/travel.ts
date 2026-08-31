/**
 * Portals: entering the dungeon and coming back out.
 *
 * The `enter` interaction was owned by `systems/agility.ts`, which reads it as an obstacle
 * traversal and refuses anything without an `obstacle` block — so the Gravelmaw mouth, a `portal`,
 * could be inspected and never entered. That is the only way into the dungeon and therefore the
 * only way to finish The Long Cairn.
 *
 * A portal is a placement, not a route: the player walks to it on the navmesh, and arriving moves
 * them to the linked location. Nothing here bypasses navigation — you still have to get there.
 */
import type { EntityId, RegionId, Result, SemanticEntity, Vec3 } from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { Store } from "../state/store.js";
import type { InteractionDispatcher } from "../world/interactions.js";
import { distanceXZ } from "../core/math.js";
import { INTERACT_RANGE } from "../app/config.js";

export interface TravelEntityPort {
  get(id: EntityId): SemanticEntity | undefined;
  all(): SemanticEntity[];
}

export interface TravelNavPort {
  closestPoint(point: Vec3): Vec3 | null;
  routeNode(id: string): { id: string; position: Vec3; regionId: string } | undefined;
}

export interface TravelDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  entities: TravelEntityPort;
  nav: TravelNavPort;
  dispatcher: InteractionDispatcher;
  /** Portal placement interrupts any timed action before the player's region changes. */
  activity?: { stop(reason: "moved", atMs: number): boolean };
  /** Places the player and resyncs the views. The root owns the camera and scene. */
  place(position: Vec3, regionId: RegionId): void;
}

export class TravelSystem {
  constructor(private readonly deps: TravelDeps) {
    // Registering `enter` here REPLACES agility's handler for the interaction. Portals and
    // obstacles both use the verb, so this one dispatches on the entity: an entity carrying an
    // `obstacle` block is handed back to agility's traversal, anything else is a portal.
    this.deps.dispatcher.registerHandler("enter", (context) => this.enter(context.entity));
  }

  private enter(entity: SemanticEntity): Result<{ started: string }> {
    const state = this.deps.store.get();

    if (entity.obstacle) {
      // An agility obstacle that reached here means the dispatcher order changed. Refuse loudly
      // rather than silently teleporting the player past a climb they have not earned.
      return err("UNAVAILABLE", `${entity.name} is an agility obstacle, not a portal`, entity.id);
    }

    if (entity.state === "locked" || entity.state === "sealed") {
      const reason = typeof entity.meta?.lockedReason === "string"
        ? entity.meta.lockedReason
        : `${entity.name} is sealed.`;
      return err("REQUIREMENTS_NOT_MET", reason, entity.id);
    }

    const gap = distanceXZ(state.player.position, entity.position);
    if (gap > INTERACT_RANGE * 2) {
      return err("OUT_OF_RANGE", `Walk to ${entity.name} first.`, entity.id);
    }

    const destination = this.resolveDestination(entity);
    if (!destination) {
      return err("NOT_REACHABLE", `${entity.name} does not lead anywhere yet.`, entity.id);
    }

    this.deps.activity?.stop("moved", this.deps.clock.elapsedMs);
    this.deps.place(destination.position, destination.regionId);

    // Entering somewhere is a discovery: the location becomes known, so `observe({scope:"known"})`
    // can return it and an agent can navigate back by id.
    state.discovery.locations[destination.locationId] = Date.now();
    if (!state.discovery.regions.includes(destination.regionId)) {
      state.discovery.regions.push(destination.regionId);
    }
    this.deps.store.markDirty();

    this.deps.events.emit(
      "entity.discovered",
      { locationId: destination.locationId, regionId: destination.regionId, via: "portal" },
      entity.id,
      this.deps.clock.elapsedMs,
    );

    return ok({ started: `entered ${entity.name}` });
  }

  /**
   * Where a portal leads.
   *
   * `meta.toLocationId` is the authored answer — that is the key `content/regions.ts` writes, and
   * the content's naming wins over anything this file would rather have been called. The dungeon
   * fallbacks exist for a portal authored without an explicit target.
   */
  private resolveDestination(
    entity: SemanticEntity,
  ): { position: Vec3; regionId: RegionId; locationId: string } | undefined {
    const linked = typeof entity.meta?.toLocationId === "string" ? entity.meta.toLocationId : null;
    const dungeonId = typeof entity.meta?.toRegionId === "string"
      ? entity.meta.toRegionId
      : typeof entity.meta?.dungeonId === "string" ? entity.meta.dungeonId : null;

    const candidates = [
      ...(linked ? [linked] : []),
      ...(dungeonId ? [`${dungeonId}_chamber1`, `${dungeonId}_entrance`] : []),
    ];

    for (const candidate of candidates) {
      const node = this.deps.nav.routeNode(candidate);
      if (!node) continue;
      const snapped = this.deps.nav.closestPoint(node.position) ?? node.position;
      return { position: snapped, regionId: node.regionId as RegionId, locationId: node.id };
    }
    return undefined;
  }
}
