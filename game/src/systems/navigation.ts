/**
 * Navigation: the navmesh, path queries, and the route graph that sits above it.
 *
 * The navmesh handles ordinary walking only. Agility shortcuts are NOT Detour off-mesh links —
 * they are route-graph edges (runs/corealm/architecture.md, correction R2), because
 * `threeToSoloNavMesh` gives no supported way to author off-mesh connections and a pillar of the
 * design should not rest on a library detail.
 */
import * as THREE from "three";
import { init as initRecast, NavMeshQuery, type NavMesh } from "@recast-navigation/core";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import type { EntityId, Vec3 } from "../contracts.js";
import { NAV_CONFIG, PLAYER_SPEED } from "../app/config.js";
import { distance, pathLength } from "../core/math.js";

export type NavStatus = "uninitialized" | "building" | "ready" | "failed";

export interface NavigationSnapshot {
  /** The harness checks this exact string. Do not rename. */
  status: NavStatus;
  polyCount: number;
  hasPath: boolean;
  pathPoints: number;
  destination: Vec3 | null;
  remainingDistance: number;
  error: string | null;
}

/** A named place an agent or the UI can path to by id. */
export interface RouteNode {
  id: string;
  name: string;
  position: Vec3;
  regionId: string;
}

/** An edge in the route graph. Shortcut edges carry an Agility requirement. */
export interface RouteEdge {
  from: string;
  to: string;
  /** Seconds. Walk edges are pathLength / PLAYER_SPEED; shortcuts add their traversal duration. */
  cost: number;
  kind: "walk" | "shortcut";
  obstacleId?: EntityId;
  reqLevel?: number;
}

export class Navigation {
  private navMesh: NavMesh | null = null;
  private query: NavMeshQuery | null = null;
  private status: NavStatus = "uninitialized";
  private error: string | null = null;
  private polyCount = 0;

  private routeNodes = new Map<string, RouteNode>();
  private routeEdges: RouteEdge[] = [];

  static async initLibrary(): Promise<void> {
    await initRecast();
  }

  /**
   * Builds the navmesh from the walkable meshes currently in the scene.
   * They must already exist in the scene graph; recast reads their geometry directly.
   */
  build(walkable: THREE.Mesh[]): boolean {
    this.status = "building";
    this.error = null;
    try {
      if (walkable.length === 0) throw new Error("No walkable meshes supplied");
      const result = threeToSoloNavMesh(walkable, {
        cs: NAV_CONFIG.cs,
        ch: NAV_CONFIG.ch,
        walkableRadius: NAV_CONFIG.walkableRadius,
        walkableClimb: NAV_CONFIG.walkableClimb,
        walkableHeight: NAV_CONFIG.walkableHeight,
        walkableSlopeAngle: NAV_CONFIG.walkableSlopeAngle,
        minRegionArea: NAV_CONFIG.minRegionArea,
      });

      if (!result.success || !result.navMesh) throw new Error("Navmesh generation returned no mesh");

      this.navMesh = result.navMesh;
      this.query = new NavMeshQuery(this.navMesh);
      this.polyCount = this.countPolys();
      this.status = "ready";
      return true;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      this.status = "failed";
      this.navMesh = null;
      this.query = null;
      return false;
    }
  }

  private countPolys(): number {
    if (!this.navMesh) return 0;
    let total = 0;
    try {
      for (let index = 0; index < this.navMesh.getMaxTiles(); index += 1) {
        const tile = this.navMesh.getTile(index);
        const header = tile?.header();
        if (header) total += header.polyCount();
      }
    } catch {
      return 0;
    }
    return total;
  }

  isReady(): boolean {
    return this.status === "ready" && this.query !== null;
  }

  /** Nearest point actually on the navmesh. Returns null when the mesh is not built. */
  closestPoint(point: Vec3): Vec3 | null {
    if (!this.query) return null;
    try {
      const found = this.query.findClosestPoint({ x: point[0], y: point[1], z: point[2] });
      if (!found?.point) return null;
      return [found.point.x, found.point.y, found.point.z];
    } catch {
      return null;
    }
  }

  /** A walkable path between two points, snapped to the navmesh. Null when unreachable. */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    if (!this.query) return null;
    try {
      const start = this.query.findClosestPoint({ x: from[0], y: from[1], z: from[2] });
      const end = this.query.findClosestPoint({ x: to[0], y: to[1], z: to[2] });
      if (!start?.point || !end?.point) return null;

      const result = this.query.computePath(start.point, end.point);
      if (!result?.success || !result.path || result.path.length === 0) return null;

      const points: Vec3[] = result.path.map((point) => [point.x, point.y, point.z] as Vec3);
      // computePath can stop short when the destination sits just off-mesh. Keep the snapped end so
      // arrival checks and reported path length agree with what the player actually walks.
      const last = points[points.length - 1]!;
      const snappedEnd: Vec3 = [end.point.x, end.point.y, end.point.z];
      if (distance(last, snappedEnd) > 0.05) points.push(snappedEnd);
      return points;
    } catch {
      return null;
    }
  }

  /** Path length in metres, or null when unreachable. */
  pathDistance(from: Vec3, to: Vec3): number | null {
    const path = this.findPath(from, to);
    return path ? pathLength(path) : null;
  }

  etaMs(path: readonly Vec3[]): number {
    return Math.round((pathLength(path) / PLAYER_SPEED) * 1000);
  }

  // ---------------------------------------------------------- route graph

  setRouteGraph(nodes: RouteNode[], edges: RouteEdge[]): void {
    this.routeNodes.clear();
    for (const node of nodes) this.routeNodes.set(node.id, node);
    this.routeEdges = edges;
  }

  routeNode(id: string): RouteNode | undefined {
    return this.routeNodes.get(id);
  }

  listRouteNodes(): RouteNode[] {
    return [...this.routeNodes.values()];
  }

  /**
   * Cheapest route between two named locations, honouring the player's Agility level.
   * This is where the route-optimisation metagame lives: a shortcut edge unlocked at a given
   * Agility level can flip which training spot is actually the best one.
   */
  planRoute(fromId: string, toId: string, agilityLevel: number): { path: string[]; cost: number; edges: RouteEdge[] } | null {
    if (!this.routeNodes.has(fromId) || !this.routeNodes.has(toId)) return null;
    if (fromId === toId) return { path: [fromId], cost: 0, edges: [] };

    const usable = this.routeEdges.filter((edge) => edge.kind === "walk" || (edge.reqLevel ?? 0) <= agilityLevel);
    const adjacency = new Map<string, RouteEdge[]>();
    for (const edge of usable) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from)!.push(edge);
    }

    const best = new Map<string, number>([[fromId, 0]]);
    const cameFrom = new Map<string, RouteEdge>();
    const visited = new Set<string>();

    while (visited.size < this.routeNodes.size) {
      let current: string | null = null;
      let currentCost = Infinity;
      for (const [id, cost] of best) {
        if (!visited.has(id) && cost < currentCost) {
          current = id;
          currentCost = cost;
        }
      }
      if (current === null) break;
      if (current === toId) break;
      visited.add(current);

      for (const edge of adjacency.get(current) ?? []) {
        const next = currentCost + edge.cost;
        if (next < (best.get(edge.to) ?? Infinity)) {
          best.set(edge.to, next);
          cameFrom.set(edge.to, edge);
        }
      }
    }

    const total = best.get(toId);
    if (total === undefined) return null;

    const edges: RouteEdge[] = [];
    const path: string[] = [toId];
    let cursor = toId;
    while (cursor !== fromId) {
      const edge = cameFrom.get(cursor);
      if (!edge) return null;
      edges.unshift(edge);
      cursor = edge.from;
      path.unshift(cursor);
    }
    return { path, cost: total, edges };
  }

  snapshot(activePath: Vec3[] | null, destination: Vec3 | null, remainingDistance: number): NavigationSnapshot {
    return {
      status: this.status,
      polyCount: this.polyCount,
      hasPath: Boolean(activePath && activePath.length > 0),
      pathPoints: activePath?.length ?? 0,
      destination,
      remainingDistance: Math.round(remainingDistance * 100) / 100,
      error: this.error,
    };
  }

  getStatus(): NavStatus {
    return this.status;
  }
}
