/**
 * A uniform-grid spatial index over entity positions.
 *
 * `observe()` runs on every agent poll and on every UI hover, against ~1500 entities once scatter
 * props with colliders land, so this has to stay cheap. A uniform grid beats a quadtree here for
 * one reason: the entities are almost all static, the world is a flat 700 x 400 m rectangle, and
 * the query radius is capped at 140 m by the contract. There is no depth to win back.
 *
 * Buckets are keyed on XZ only. The world is 700 x 400 m across but only ~80 m tall, so a Y axis
 * in the grid would put every entity in one layer and cost a multiply per lookup for nothing.
 * The final distance test is full 3D, so a node 30 m below you on another terrace still measures
 * as far away as it really is.
 *
 * Allocation discipline: `forEachInRadius` allocates nothing at all, and `queryRadius` /
 * `queryBox` fill a caller-supplied array when one is given. The Map lookups per cell are the
 * only unavoidable cost.
 */
import type { EntityId, Vec3 } from "../contracts.js";

/**
 * Cell key packing. Cell coordinates are offset into unsigned space and packed into one number:
 * exact, collision-free, and no string keys (which would allocate on every lookup).
 * Valid for cell coordinates in [-32768, 32767], i.e. +/- 524 km at the default 16 m cell.
 */
const KEY_OFFSET = 1 << 15;
const KEY_SPAN = 1 << 16;

/**
 * 16 m cells. The default observe radius is 40 m, so a typical query touches a 5x5 block of 25
 * cells holding a few dozen entities. Smaller cells mean more Map lookups for the same answer;
 * larger cells mean more distance tests against entities that were never close.
 */
export const DEFAULT_CELL_SIZE = 16;

export class SpatialIndex {
  private readonly cells = new Map<number, EntityId[]>();
  /** id -> its current cell key, so `move` and `remove` do not have to scan. */
  private readonly cellOf = new Map<EntityId, number>();
  private readonly positions = new Map<EntityId, Vec3>();

  constructor(private readonly cellSize: number = DEFAULT_CELL_SIZE) {}

  get size(): number {
    return this.cellOf.size;
  }

  get cellCount(): number {
    return this.cells.size;
  }

  private key(x: number, z: number): number {
    const cx = Math.floor(x / this.cellSize) + KEY_OFFSET;
    const cz = Math.floor(z / this.cellSize) + KEY_OFFSET;
    return cx * KEY_SPAN + cz;
  }

  insert(id: EntityId, position: Vec3): void {
    const key = this.key(position[0], position[2]);
    const existing = this.cellOf.get(id);
    if (existing !== undefined) {
      if (existing === key) {
        this.positions.set(id, position);
        return;
      }
      this.detach(id, existing);
    }
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(id);
    this.cellOf.set(id, key);
    this.positions.set(id, position);
  }

  /** Same as `insert`. Named separately because the call sites read better. */
  move(id: EntityId, position: Vec3): void {
    this.insert(id, position);
  }

  remove(id: EntityId): boolean {
    const key = this.cellOf.get(id);
    if (key === undefined) return false;
    this.detach(id, key);
    this.cellOf.delete(id);
    this.positions.delete(id);
    return true;
  }

  has(id: EntityId): boolean {
    return this.cellOf.has(id);
  }

  positionOf(id: EntityId): Vec3 | undefined {
    return this.positions.get(id);
  }

  clear(): void {
    this.cells.clear();
    this.cellOf.clear();
    this.positions.clear();
  }

  /** Swap-remove out of a bucket. Order inside a cell is not meaningful, so this is safe. */
  private detach(id: EntityId, key: number): void {
    const bucket = this.cells.get(key);
    if (!bucket) return;
    const index = bucket.indexOf(id);
    if (index >= 0) {
      const last = bucket.length - 1;
      const tail = bucket[last];
      if (index !== last && tail !== undefined) bucket[index] = tail;
      bucket.pop();
    }
    if (bucket.length === 0) this.cells.delete(key);
  }

  /**
   * The hot path. Visits every entity within `radius` of `centre`, passing the squared distance so
   * the caller can skip a sqrt it may not need. Allocates nothing.
   *
   * Return `false` from `visit` to stop early.
   */
  forEachInRadius(
    centre: Vec3,
    radius: number,
    visit: (id: EntityId, distanceSquared: number) => boolean | void,
  ): void {
    if (radius <= 0) return;
    const radiusSq = radius * radius;
    const minCellX = Math.floor((centre[0] - radius) / this.cellSize);
    const maxCellX = Math.floor((centre[0] + radius) / this.cellSize);
    const minCellZ = Math.floor((centre[2] - radius) / this.cellSize);
    const maxCellZ = Math.floor((centre[2] + radius) / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
      const columnKey = (cx + KEY_OFFSET) * KEY_SPAN;
      for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
        const bucket = this.cells.get(columnKey + cz + KEY_OFFSET);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 1) {
          const id = bucket[i];
          if (id === undefined) continue;
          const position = this.positions.get(id);
          if (!position) continue;
          const dx = position[0] - centre[0];
          const dy = position[1] - centre[1];
          const dz = position[2] - centre[2];
          const distanceSquared = dx * dx + dy * dy + dz * dz;
          if (distanceSquared > radiusSq) continue;
          if (visit(id, distanceSquared) === false) return;
        }
      }
    }
  }

  /**
   * Ids within `radius`, unsorted. Pass `out` to reuse an array across frames; it is cleared first.
   */
  queryRadius(centre: Vec3, radius: number, out?: EntityId[]): EntityId[] {
    const result = out ?? [];
    result.length = 0;
    this.forEachInRadius(centre, radius, (id) => {
      result.push(id);
    });
    return result;
  }

  /**
   * Ids inside an axis-aligned box, inclusive on both corners. Y is tested too, which is what
   * makes this usable for "everything on terrace three" style queries.
   */
  queryBox(min: Vec3, max: Vec3, out?: EntityId[]): EntityId[] {
    const result = out ?? [];
    result.length = 0;

    const minCellX = Math.floor(min[0] / this.cellSize);
    const maxCellX = Math.floor(max[0] / this.cellSize);
    const minCellZ = Math.floor(min[2] / this.cellSize);
    const maxCellZ = Math.floor(max[2] / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
      const columnKey = (cx + KEY_OFFSET) * KEY_SPAN;
      for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
        const bucket = this.cells.get(columnKey + cz + KEY_OFFSET);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 1) {
          const id = bucket[i];
          if (id === undefined) continue;
          const position = this.positions.get(id);
          if (!position) continue;
          if (position[0] < min[0] || position[0] > max[0]) continue;
          if (position[1] < min[1] || position[1] > max[1]) continue;
          if (position[2] < min[2] || position[2] > max[2]) continue;
          result.push(id);
        }
      }
    }
    return result;
  }

  /**
   * Closest entity to `centre` within `radius` that passes `accept`, or undefined.
   * Used for click-picking fallbacks and for "nearest bank" style agent helpers.
   */
  nearest(
    centre: Vec3,
    radius: number,
    accept?: (id: EntityId) => boolean,
  ): { id: EntityId; distance: number } | undefined {
    let bestId: EntityId | undefined;
    let bestSq = Infinity;
    this.forEachInRadius(centre, radius, (id, distanceSquared) => {
      if (distanceSquared >= bestSq) return;
      if (accept && !accept(id)) return;
      bestSq = distanceSquared;
      bestId = id;
    });
    if (bestId === undefined) return undefined;
    return { id: bestId, distance: Math.sqrt(bestSq) };
  }

  /** Diagnostics for `__gameDebug`, not for gameplay. JSON-safe. */
  stats(): { entities: number; cells: number; cellSize: number; largestCell: number } {
    let largest = 0;
    for (const bucket of this.cells.values()) {
      if (bucket.length > largest) largest = bucket.length;
    }
    return { entities: this.cellOf.size, cells: this.cells.size, cellSize: this.cellSize, largestCell: largest };
  }
}
