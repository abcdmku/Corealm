/**
 * How many meshes each scatter bucket shards into, and what that costs in draw calls.
 *
 * `shardByTile` puts a floor (`TILE_MIN_INSTANCES`) under the COVER tiling and none at all under
 * the SHADOW tiling, so this prints instances-per-tile per bucket: a caster bucket with a dozen
 * members scattered over a 96 m grid pays a full mesh, and a shadow-pass mesh, per member.
 *
 *   npx tsx runs/corealm/audit/dcb-tiles.ts
 */
import { readFileSync } from "node:fs";
import { DEFAULT_SCATTER, scatterRegion, worldExclusions } from "../../../game/src/world/scatter.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import type { RegionId, Vec3 } from "../../../game/src/contracts.js";

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
const rects = new Map<RegionId, Rect>();
for (const region of REGIONS) {
  rects.set(region.id, {
    minX: region.bounds.min[0], maxX: region.bounds.max[0],
    minZ: region.bounds.min[1], maxZ: region.bounds.max[1],
  });
}
const amp = new Map<RegionId, { base: number; amplitude: number }>();
for (const region of REGIONS) amp.set(region.id, { base: region.baseHeight, amplitude: region.terrainAmplitude });

function heightAtXZ(x: number, z: number): number {
  for (const [id, rect] of rects) {
    if (x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ) {
      const a = amp.get(id)!;
      const f = 0.45 / a.amplitude;
      const n = (Math.sin(x * f) * Math.cos(z * f * 0.81) + Math.sin(x * f * 2.9 + z * f * 2.05) * 0.5) / 1.5;
      return a.base + (n * 0.5 + 0.5) * a.amplitude;
    }
  }
  return 0;
}

const placements: { name: string; count: number }[] = [];
const roadLines: Vec3[][] = [];
const scene = {
  getRegionRect: (id: RegionId): Rect | null => rects.get(id) ?? null,
  getWorldBounds: (): Rect => ({ minX: -360, maxX: 340, minZ: -200, maxZ: 200 }),
  heightAt: (_id: RegionId, x: number, z: number): number => heightAtXZ(x, z),
  heightAtXZ,
  meshHeightAt: heightAtXZ,
  normalAt: (x: number, z: number): Vec3 => {
    const dx = (heightAtXZ(x + 2, z) - heightAtXZ(x - 2, z)) / 4;
    const dz = (heightAtXZ(x, z + 2) - heightAtXZ(x, z - 2)) / 4;
    const len = Math.hypot(dx, 1, dz);
    return [-dx / len, 1 / len, -dz / len];
  },
  slopeAt: (x: number, z: number): number => {
    const dx = (heightAtXZ(x + 1.5, z) - heightAtXZ(x - 1.5, z)) / 3;
    const dz = (heightAtXZ(x, z + 1.5) - heightAtXZ(x, z - 1.5)) / 3;
    return Math.hypot(dx, dz);
  },
  regionAt: (x: number, z: number): RegionId => {
    for (const [id, rect] of rects) {
      if (x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ) return id;
    }
    return "fallowmarch";
  },
  regionWeightAt: (id: RegionId, x: number, z: number): number => {
    const rect = rects.get(id);
    if (!rect) return 0;
    const depth = Math.min(x - rect.minX, rect.maxX - x, z - rect.minZ, rect.maxZ - z);
    const t = Math.max(0, Math.min(1, (depth + 28) / 56));
    return t * t * (3 - 2 * t);
  },
  getRoadPolylines: (): Vec3[][] => roadLines,
  describeRegions: () => [...rects.keys()].map((id) => ({ regionId: id })),
  scatterInstanced: (_source: unknown, entries: { position: Vec3 }[], name: string) => {
    placements.push({ name, count: entries.length });
    return [{
      geometry: { getIndex: () => ({ count: 300 }), getAttribute: () => ({ count: 300 }) },
      count: entries.length,
    }];
  },
};

for (const region of REGIONS) {
  const byId = new Map(region.locations.map((l) => [l.id, l]));
  for (const road of region.roads) {
    const a = byId.get(road.from); const b = byId.get(road.to);
    if (!a || !b) continue;
    const points: Vec3[] = [];
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;
      points.push([a.position[0] + (b.position[0] - a.position[0]) * t, 0, a.position[1] + (b.position[1] - a.position[1]) * t]);
    }
    roadLines.push(points);
  }
}

const assets = { entry: (id: string) => ({ id }), byTags: () => [], loadMany: async () => {}, instance: (id: string) => ({ id }) };

worldExclusions.clear();
for (const region of REGIONS) {
  if (region.settlement) {
    worldExclusions.addCircle(region.settlement.centre[0], region.settlement.centre[1], 46, "settlement", region.settlement.id);
  }
  for (const location of region.locations) worldExclusions.addCircle(location.position[0], location.position[1], 9, "cluster", location.id);
  for (const cluster of region.clusters) worldExclusions.addCircle(cluster.centre[0], cluster.centre[1], cluster.radius + 3, "cluster", cluster.id);
  const byId = new Map(region.locations.map((l) => [l.id, l]));
  for (const road of region.roads) {
    const a = byId.get(road.from); const b = byId.get(road.to);
    if (!a || !b) continue;
    worldExclusions.addCorridor(
      [[a.position[0], 0, a.position[1]], [b.position[0], 0, b.position[1]]] as Vec3[], 8, "road", `${road.from}->${road.to}`,
    );
  }
}

for (const id of ["fallowmarch", "vellenwood", "karrowmoor"] as RegionId[]) {
  await scatterRegion(scene as never, assets as never, id, DEFAULT_SCATTER[id]!, 1);
}

const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: { id: string; file: string }[] };
const prims = new Map<string, number>();
for (const entry of manifest.assets) {
  try {
    const buf = readFileSync("game/public/assets/" + entry.file);
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8")) as { meshes?: { primitives: unknown[] }[] };
    let n = 0;
    for (const mesh of json.meshes ?? []) n += mesh.primitives.length;
    prims.set(entry.id, n);
  } catch { /* not a GLB */ }
}

const SHADOW = new Set<string>();
for (const [regionId, spec] of Object.entries(DEFAULT_SCATTER)) {
  for (const layer of spec.layers) {
    if (!layer.castShadow) continue;
    for (const sp of layer.species ?? []) SHADOW.add(`${regionId}:${sp.assetId}`);
    for (const id of layer.assetIds ?? []) SHADOW.add(`${regionId}:${id}`);
  }
}

const buckets = new Map<string, { region: string; asset: string; tiles: number; instances: number; shadow: boolean }>();
for (const p of placements) {
  const m = /^scatter-([a-z]+)-(.+)-t\d+$/.exec(p.name);
  if (!m) { console.log("unparsed", p.name); continue; }
  const key = `${m[1]}:${m[2]}`;
  const row = buckets.get(key) ?? { region: m[1]!, asset: m[2]!, tiles: 0, instances: 0, shadow: SHADOW.has(key) };
  row.tiles += 1; row.instances += p.count;
  buckets.set(key, row);
}

const rows = [...buckets.values()].map((r) => {
  const p = prims.get(r.asset) ?? 1;
  return { ...r, prims: p, calls: r.tiles * p * (r.shadow ? 2 : 1), perTile: Math.round(r.instances / r.tiles) };
});
rows.sort((a, b) => b.calls - a.calls);
let total = 0; let casterCalls = 0; let smallCasterCalls = 0;
for (const r of rows) {
  total += r.calls;
  if (r.shadow) casterCalls += r.calls;
  if (r.shadow && r.instances < 400) smallCasterCalls += r.calls;
}
console.log("bucket".padEnd(38), "tiles inst  /tile prims shadow calls");
for (const r of rows) {
  console.log(`${r.region}:${r.asset}`.padEnd(38), String(r.tiles).padStart(5), String(r.instances).padStart(5),
    String(r.perTile).padStart(6), String(r.prims).padStart(5), r.shadow ? "  yes " : "   no ", String(r.calls).padStart(5));
}
console.log("world-wide unculled calls", total, "of which casters", casterCalls, "of which casters under 400 instances", smallCasterCalls);
