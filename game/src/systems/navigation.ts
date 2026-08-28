/**
 * Navigation: the navmesh, path queries, and the route graph that sits above it.
 *
 * The navmesh handles ordinary walking only. Agility shortcuts are NOT Detour off-mesh links —
 * they are route-graph edges (runs/corealm/architecture.md, correction R2), because
 * `threeToSoloNavMesh` gives no supported way to author off-mesh connections and a pillar of the
 * design should not rest on a library detail.
 *
 * Round 1 measured the generator question rather than guessing it. Against the real 700 x 400 m
 * three-region terrain (140k triangles, 39 m of terraced verticality in Karrowmoor):
 *
 *   solo   cs 0.30   4579 ms   1066 polys           connected, bank -> Upper Karrow 428.5 m
 *   tiled  cs 0.30   3150 ms   1361 polys 209 tiles connected, 427.2 m
 *   solo   cs 0.45   1308 ms   2213 polys           connected, 430.3 m
 *   tiled  cs 0.45   1337 ms   2485 polys  91 tiles connected, 429.5 m
 *   solo   cs 0.60    739 ms   2870 polys           connected but 556.7 m — routes lost
 *
 * So: **a solo navmesh does cope with Karrowmoor.** All four terraces stay on one connected mesh
 * and the Coldbrace-to-Upper-Karrow path lands inside the PRD's 380-460 m acceptance window. Tiled
 * buys nothing here and adds tile-boundary vertices to every path, so solo stays the default and
 * tiled is the automatic fallback if solo ever fails.
 *
 * Cell size is the real lever: at the root's authored cs of 0.3 the build costs 4.6 s, which does
 * not fit a 6 s cold boot. Worlds wider than 320 m therefore generate at cs 0.45, which is 3.5x
 * faster and produces paths within 0.5% of the fine build. cs 0.60 is too coarse — it drops
 * walkable ground on the terrace risers and inflates the cross-world route by 30%.
 */
import * as THREE from "three";
import { init as initRecast, NavMeshQuery, type NavMesh } from "@recast-navigation/core";
import { threeToSoloNavMesh, threeToTiledNavMesh } from "@recast-navigation/three";
import type { EntityId, Vec3 } from "../contracts.js";
import { NAV_CONFIG, PLAYER_SPEED } from "../app/config.js";
import { distance, distanceXZ, pathLength } from "../core/math.js";

export type NavStatus = "uninitialized" | "building" | "ready" | "failed";

export type NavStrategy = "auto" | "solo" | "tiled";

/** Tile edge in voxels. 128 voxels at cs 0.3 is a 38 m tile: ~200 tiles over the round-1 world. */
const TILE_SIZE_VOXELS = 128;

/** Above this world extent in metres, generation drops to the coarser cell size. */
const LARGE_WORLD_EXTENT = 320;

/** Cell size used for large worlds. Measured: 3.5x faster than 0.3 with equivalent paths. */
const LARGE_WORLD_CELL_SIZE = 0.45;

/**
 * Search box for snapping a world point onto the mesh.
 *
 * Deliberately tall. Callers routinely ask about a point whose y they do not know — the world
 * builder places an entity at ground level by asking for the ground, the route graph is authored in
 * plan view — and Karrowmoor climbs 39 m, so a 1 m default box silently fails on three of the four
 * terraces. Nearest-polygon is still resolved by true 3D distance, so a tall box costs accuracy
 * nothing.
 */
const QUERY_HALF_EXTENTS = { x: 4, y: 40, z: 4 } as const;

export interface NavigationSnapshot {
  /** The harness checks this exact string. Do not rename. */
  status: NavStatus;
  polyCount: number;
  hasPath: boolean;
  pathPoints: number;
  destination: Vec3 | null;
  remainingDistance: number;
  error: string | null;
  /** Which generator produced the live mesh. JSON-safe extra; the harness ignores extras. */
  strategy: NavStrategy | null;
}

/** Escape hatch over the root's `NAV_CONFIG`, for tuning generation without editing shared config. */
export interface NavConfigOverrides {
  cs?: number;
  ch?: number;
  walkableSlopeAngle?: number;
  tileSizeVoxels?: number;
}

export interface NavDiagnostics {
  status: NavStatus;
  strategy: NavStrategy | null;
  /** The strategy that was tried first, if it failed and we fell back. */
  fallbackFrom: NavStrategy | null;
  polyCount: number;
  tileCount: number;
  cellSize: number;
  buildMs: number;
  sourceMeshes: number;
  sourceTriangles: number;
  bounds: { min: Vec3; max: Vec3 } | null;
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
  /** Where the player must stand to start the shortcut. Defaults to the `from` node. */
  entrance?: Vec3;
  /** Where the shortcut deposits the player. Defaults to the `to` node. */
  exit?: Vec3;
  /** Traversal animation time in milliseconds, from `SemanticEntity.obstacle.durationMs`. */
  durationMs?: number;
  /** Straight-line metres this shortcut saves, for the route-flip explanation in the UI. */
  savesMeters?: number;
}

/**
 * One walkable step of a planned route. This is what makes a route actually walkable rather than
 * only plannable: `Movement.startRoute` consumes these in order, walking the `walk` legs over the
 * navmesh and playing the traversal for the `shortcut` legs.
 */
export interface RouteLeg {
  kind: "walk" | "shortcut";
  from: Vec3;
  to: Vec3;
  fromId: string;
  toId: string;
  /** Seconds. */
  cost: number;
  obstacleId?: EntityId;
  reqLevel?: number;
  durationMs?: number;
  /** Only populated when the caller asks for paths. */
  path?: Vec3[];
}

export interface RoutePlan {
  path: string[];
  cost: number;
  edges: RouteEdge[];
  legs: RouteLeg[];
}

export class Navigation {
  private navMesh: NavMesh | null = null;
  private query: NavMeshQuery | null = null;
  private status: NavStatus = "uninitialized";
  private error: string | null = null;
  private polyCount = 0;
  private strategy: NavStrategy | null = null;
  private fallbackFrom: NavStrategy | null = null;
  private tileCount = 0;
  private buildMs = 0;
  private sourceMeshes = 0;
  private sourceTriangles = 0;
  private bounds: { min: Vec3; max: Vec3 } | null = null;

  private overrides: NavConfigOverrides = {};

  private routeNodes = new Map<string, RouteNode>();
  private routeEdges: RouteEdge[] = [];

  static async initLibrary(): Promise<void> {
    await initRecast();
  }

  /**
   * Builds the navmesh from the walkable meshes currently in the scene.
   * They must already exist in the scene graph; recast reads their geometry directly.
   */
  build(
    walkable: THREE.Mesh[],
    strategy: NavStrategy = "auto",
    overrides: NavConfigOverrides = {},
  ): boolean {
    this.status = "building";
    this.error = null;
    this.fallbackFrom = null;
    const startedAt = now();

    try {
      if (walkable.length === 0) throw new Error("No walkable meshes supplied");
      this.measureSource(walkable);

      this.overrides = overrides;
      const chosen = strategy === "auto" ? this.autoStrategy() : strategy;
      let navMesh = this.generate(walkable, chosen);

      if (!navMesh) {
        // Whichever generator was chosen, try the other one before giving up. A world with no
        // navmesh is unplayable; a world with a slower navmesh is merely slower.
        const alternate: NavStrategy = chosen === "solo" ? "tiled" : "solo";
        navMesh = this.generate(walkable, alternate);
        if (navMesh) {
          this.fallbackFrom = chosen;
          this.strategy = alternate;
        }
      } else {
        this.strategy = chosen;
      }

      if (!navMesh) throw new Error(this.error ?? "Navmesh generation returned no mesh");

      this.navMesh = navMesh;
      this.query = new NavMeshQuery(this.navMesh);
      this.polyCount = this.countPolys();
      this.buildMs = Math.round(now() - startedAt);
      this.status = "ready";
      return true;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      this.status = "failed";
      this.navMesh = null;
      this.query = null;
      this.strategy = null;
      this.buildMs = Math.round(now() - startedAt);
      return false;
    }
  }

  /** Measured on the real world: solo wins. Tiled remains the fallback if solo ever fails. */
  private autoStrategy(): NavStrategy {
    return "solo";
  }

  private worldExtent(): number {
    if (!this.bounds) return 0;
    return Math.max(
      this.bounds.max[0] - this.bounds.min[0],
      this.bounds.max[2] - this.bounds.min[2],
    );
  }

  /**
   * Cell size drives everything: see the measurements in the file header. The tightest gap in
   * Phase 1 is a town gate, not a corridor, so the coarser cell costs nothing playable.
   */
  private worldCellSize(): number {
    if (this.overrides.cs !== undefined) return this.overrides.cs;
    return this.worldExtent() > LARGE_WORLD_EXTENT ? LARGE_WORLD_CELL_SIZE : NAV_CONFIG.cs;
  }

  private generate(walkable: THREE.Mesh[], strategy: NavStrategy): NavMesh | null {
    const config = {
      cs: this.worldCellSize(),
      ch: this.overrides.ch ?? NAV_CONFIG.ch,
      walkableRadius: NAV_CONFIG.walkableRadius,
      walkableClimb: NAV_CONFIG.walkableClimb,
      walkableHeight: NAV_CONFIG.walkableHeight,
      walkableSlopeAngle: this.overrides.walkableSlopeAngle ?? NAV_CONFIG.walkableSlopeAngle,
      minRegionArea: NAV_CONFIG.minRegionArea,
    };

    try {
      if (strategy === "tiled") {
        const tileSize = this.overrides.tileSizeVoxels ?? TILE_SIZE_VOXELS;
        const result = threeToTiledNavMesh(walkable, { ...config, tileSize });
        if (!result.success || !result.navMesh) {
          this.error = result.success ? "Tiled navmesh returned no mesh" : result.error;
          return null;
        }
        return result.navMesh;
      }

      const result = threeToSoloNavMesh(walkable, config);
      if (!result.success || !result.navMesh) {
        this.error = result.success ? "Solo navmesh returned no mesh" : result.error;
        return null;
      }
      return result.navMesh;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return null;
    }
  }

  private measureSource(walkable: THREE.Mesh[]): void {
    this.sourceMeshes = walkable.length;
    this.sourceTriangles = 0;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const box = new THREE.Box3();

    for (const mesh of walkable) {
      const index = mesh.geometry.getIndex();
      const position = mesh.geometry.getAttribute("position");
      this.sourceTriangles += index ? index.count / 3 : position ? position.count / 3 : 0;
      box.setFromObject(mesh);
      min[0] = Math.min(min[0], box.min.x);
      min[1] = Math.min(min[1], box.min.y);
      min[2] = Math.min(min[2], box.min.z);
      max[0] = Math.max(max[0], box.max.x);
      max[1] = Math.max(max[1], box.max.y);
      max[2] = Math.max(max[2], box.max.z);
    }
    this.sourceTriangles = Math.round(this.sourceTriangles);
    this.bounds = Number.isFinite(min[0]) ? { min, max } : null;
  }

  private countPolys(): number {
    if (!this.navMesh) return 0;
    let total = 0;
    let tiles = 0;
    try {
      for (let index = 0; index < this.navMesh.getMaxTiles(); index += 1) {
        const tile = this.navMesh.getTile(index);
        const header = tile?.header();
        if (!header) continue;
        const count = header.polyCount();
        if (count > 0) tiles += 1;
        total += count;
      }
    } catch {
      this.tileCount = tiles;
      return total;
    }
    this.tileCount = tiles;
    return total;
  }

  isReady(): boolean {
    return this.status === "ready" && this.query !== null;
  }

  /** Nearest point actually on the navmesh. Returns null when the mesh is not built. */
  closestPoint(point: Vec3): Vec3 | null {
    if (!this.query) return null;
    try {
      const found = this.query.findClosestPoint(
        { x: point[0], y: point[1], z: point[2] },
        { halfExtents: QUERY_HALF_EXTENTS },
      );
      // `success` matters: a miss still returns a `point`, and it is (0, 0, 0). Trusting it puts
      // the player at the world origin and makes every path from there look plausible.
      if (!found?.success || !found.point) return null;
      return [found.point.x, found.point.y, found.point.z];
    } catch {
      return null;
    }
  }

  /** Nearest walkable point, but only if it is within `maxDistance`. Used by stuck recovery. */
  nearestWalkable(point: Vec3, maxDistance = 3): Vec3 | null {
    const snapped = this.closestPoint(point);
    if (!snapped) return null;
    return distanceXZ(snapped, point) <= maxDistance ? snapped : null;
  }

  /** A walkable path between two points, snapped to the navmesh. Null when unreachable. */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    if (!this.query) return null;
    try {
      const start = this.query.findClosestPoint(
        { x: from[0], y: from[1], z: from[2] },
        { halfExtents: QUERY_HALF_EXTENTS },
      );
      const end = this.query.findClosestPoint(
        { x: to[0], y: to[1], z: to[2] },
        { halfExtents: QUERY_HALF_EXTENTS },
      );
      if (!start?.success || !start.point || !end?.success || !end.point) return null;

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

  /**
   * Are two points genuinely on the same connected navmesh?
   *
   * Detour returns a partial path to the nearest reachable polygon rather than failing, so a path
   * existing is not proof of connectivity. This checks the path actually ARRIVES, which is what
   * PRD acceptance B3 (Coldbrace bank -> Upper Karrow seam, one mesh, 380-460 m) needs.
   */
  isConnected(from: Vec3, to: Vec3, tolerance = 2.5): boolean {
    const path = this.findPath(from, to);
    if (!path || path.length === 0) return false;
    const arrival = path[path.length - 1]!;
    const target = this.closestPoint(to) ?? to;
    return distanceXZ(arrival, target) <= tolerance;
  }

  /** Connectivity matrix over a set of probe points. The root asserts three-region connectivity. */
  verifyConnectivity(points: readonly { id: string; position: Vec3 }[]): {
    connected: boolean;
    pairs: { from: string; to: string; metres: number | null }[];
  } {
    const pairs: { from: string; to: string; metres: number | null }[] = [];
    let connected = true;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i]!;
        const b = points[j]!;
        const reachable = this.isConnected(a.position, b.position);
        const metres = reachable ? this.pathDistance(a.position, b.position) : null;
        if (!reachable) connected = false;
        pairs.push({
          from: a.id,
          to: b.id,
          metres: metres === null ? null : Math.round(metres * 10) / 10,
        });
      }
    }
    return { connected, pairs };
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

  listRouteEdges(): RouteEdge[] {
    return [...this.routeEdges];
  }

  /** Nearest route node to a world position, for "where am I on the graph" queries. */
  nearestRouteNode(position: Vec3): RouteNode | null {
    let best: RouteNode | null = null;
    let bestDistance = Infinity;
    for (const node of this.routeNodes.values()) {
      const gap = distanceXZ(node.position, position);
      if (gap < bestDistance) {
        bestDistance = gap;
        best = node;
      }
    }
    return best;
  }

  /**
   * Cheapest route between two named locations, honouring the player's Agility level.
   * This is where the route-optimisation metagame lives: a shortcut edge unlocked at a given
   * Agility level can flip which training spot is actually the best one.
   */
  planRoute(
    fromId: string,
    toId: string,
    agilityLevel: number,
    options: { withPaths?: boolean } = {},
  ): RoutePlan | null {
    if (!this.routeNodes.has(fromId) || !this.routeNodes.has(toId)) return null;
    if (fromId === toId) return { path: [fromId], cost: 0, edges: [], legs: [] };

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

    return { path, cost: total, edges, legs: this.toLegs(edges, options.withPaths ?? false) };
  }

  /**
   * Turns route edges into walkable legs.
   *
   * A shortcut is expanded into TWO legs: walk to the obstacle entrance, then traverse it. That is
   * the whole of correction R2 in one function — the traversal is a gameplay step with a duration
   * and a requirement, not a Detour off-mesh connection, so it is interruptible and it fires real
   * events.
   */
  toLegs(edges: readonly RouteEdge[], withPaths = false): RouteLeg[] {
    const legs: RouteLeg[] = [];

    for (const edge of edges) {
      const fromNode = this.routeNodes.get(edge.from);
      const toNode = this.routeNodes.get(edge.to);
      if (!fromNode || !toNode) continue;

      if (edge.kind === "walk") {
        legs.push(this.walkLeg(edge.from, edge.to, fromNode.position, toNode.position, edge.cost, withPaths));
        continue;
      }

      const entrance = edge.entrance ?? fromNode.position;
      const exit = edge.exit ?? toNode.position;
      const approach = this.pathDistance(fromNode.position, entrance);
      if (distanceXZ(fromNode.position, entrance) > 0.5) {
        legs.push(this.walkLeg(
          edge.from,
          `${edge.to}:entrance`,
          fromNode.position,
          entrance,
          (approach ?? 0) / PLAYER_SPEED,
          withPaths,
        ));
      }

      const leg: RouteLeg = {
        kind: "shortcut",
        from: entrance,
        to: exit,
        fromId: `${edge.to}:entrance`,
        toId: edge.to,
        cost: (edge.durationMs ?? 0) / 1000,
        durationMs: edge.durationMs ?? 0,
      };
      if (edge.obstacleId !== undefined) leg.obstacleId = edge.obstacleId;
      if (edge.reqLevel !== undefined) leg.reqLevel = edge.reqLevel;
      legs.push(leg);

      if (distanceXZ(exit, toNode.position) > 0.5) {
        const tail = this.pathDistance(exit, toNode.position);
        legs.push(this.walkLeg(
          `${edge.to}:exit`,
          edge.to,
          exit,
          toNode.position,
          (tail ?? 0) / PLAYER_SPEED,
          withPaths,
        ));
      }
    }
    return legs;
  }

  private walkLeg(
    fromId: string,
    toId: string,
    from: Vec3,
    to: Vec3,
    cost: number,
    withPaths: boolean,
  ): RouteLeg {
    const leg: RouteLeg = { kind: "walk", from, to, fromId, toId, cost };
    if (withPaths) {
      const path = this.findPath(from, to);
      if (path) leg.path = path;
    }
    return leg;
  }

  // ------------------------------------------------------------ snapshot

  snapshot(activePath: Vec3[] | null, destination: Vec3 | null, remainingDistance: number): NavigationSnapshot {
    return {
      status: this.status,
      polyCount: this.polyCount,
      hasPath: Boolean(activePath && activePath.length > 0),
      pathPoints: activePath?.length ?? 0,
      destination,
      remainingDistance: Math.round(remainingDistance * 100) / 100,
      error: this.error,
      strategy: this.strategy,
    };
  }

  /** JSON-safe build report. The root asserts against this after boot. */
  getDiagnostics(): NavDiagnostics {
    return {
      status: this.status,
      strategy: this.strategy,
      fallbackFrom: this.fallbackFrom,
      polyCount: this.polyCount,
      tileCount: this.tileCount,
      cellSize: this.worldCellSize(),
      buildMs: this.buildMs,
      sourceMeshes: this.sourceMeshes,
      sourceTriangles: this.sourceTriangles,
      bounds: this.bounds,
      error: this.error,
    };
  }

  getStatus(): NavStatus {
    return this.status;
  }
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
