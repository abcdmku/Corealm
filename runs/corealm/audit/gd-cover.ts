/**
 * Ground COVERAGE, not instance count.
 *
 * The metric cov-offline.ts reports — the share of 3 m cells holding at least one prop — said 78%
 * for `palewood_copse` at a point where `w3-palewood_copse.png` is visibly a green shader with a
 * handful of tufts on it. One 0.4 m tuft satisfies a 9 m2 cell. So this measures the thing the
 * brief actually asks about: the fraction of the ground plane covered by the drawn footprint of
 * ground-cover geometry, within the radius a player reads as "the field in front of me".
 *
 * Footprint per instance is the manifest's native X x Z bounds times the placement's own scale,
 * times pi/4 for the inscribed ellipse, because a leafy plant's bbox is not a solid disc. Overlap
 * is NOT subtracted, so the number is an upper bound and the honest reading of "0.42" is "a bit
 * under 42%". Trees, boulders and cliffs are excluded: this is about the surface, not the canopy.
 *
 *   npx tsx runs/corealm/audit/gd-cover.ts
 */
import { readFileSync } from "node:fs";
import { DEFAULT_SCATTER, scatterRegion, worldExclusions } from "../../../game/src/world/scatter.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import { SHOTS } from "../../../game/src/debug/shots.js";
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

interface Instance { asset: string; x: number; z: number; scale: number }
const instances: Instance[] = [];
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
  scatterInstanced: (
    source: { id: string },
    entries: { position: Vec3; scale: number | readonly [number, number, number] }[],
  ): { geometry: { getIndex(): { count: number } | null; getAttribute(): { count: number } }; count: number }[] => {
    for (const entry of entries) {
      const scale = typeof entry.scale === "number" ? entry.scale : entry.scale[0];
      instances.push({ asset: source.id, x: entry.position[0], z: entry.position[2], scale });
    }
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

const assets = {
  entry: (id: string) => ({ id }),
  byTags: () => [],
  loadMany: async (): Promise<void> => {},
  instance: (id: string) => ({ id }),
};

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
      [[a.position[0], 0, a.position[1]], [b.position[0], 0, b.position[1]]] as Vec3[],
      8, "road", `${road.from}->${road.to}`,
    );
  }
}

for (const id of ["fallowmarch", "vellenwood", "karrowmoor"] as RegionId[]) {
  await scatterRegion(scene as never, assets as never, id, DEFAULT_SCATTER[id], 1);
}

const manifestRaw = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as
  { assets?: { id: string; size?: { x: number; y: number; z: number } }[] };
const manifest = Array.isArray(manifestRaw) ? manifestRaw : manifestRaw.assets ?? [];
const size = new Map<string, { x: number; z: number }>();
for (const entry of manifest) if (entry.size) size.set(entry.id, { x: entry.size.x, z: entry.size.z });

// Canopy and boulders are not ground cover; counting them would say the ground is covered when
// what is covered is the sky above it.
const NOT_COVER = /^(tree_|boulder_|cliff_|rock_medium)/;

console.log("pose                     r=25 m           r=12 m        world region");
console.log("                     inst/m2  cover   inst/m2  cover");
const worldTotals = new Map<string, { count: number; area: number }>();
for (const instance of instances) {
  if (NOT_COVER.test(instance.asset)) continue;
  const region = scene.regionAt(instance.x, instance.z);
  const bounds = size.get(instance.asset);
  if (!bounds) continue;
  const entry = worldTotals.get(region) ?? { count: 0, area: 0 };
  entry.count += 1;
  entry.area += (Math.PI / 4) * bounds.x * instance.scale * bounds.z * instance.scale;
  worldTotals.set(region, entry);
}

// A shot names a route node, not a coordinate, so the pose position comes from the region data.
const locations = new Map<string, [number, number]>();
for (const region of REGIONS) {
  for (const location of region.locations) locations.set(location.id, [location.position[0], location.position[1]]);
}

for (const shot of SHOTS) {
  const target = locations.get(shot.locationId);
  if (!target) { console.log(`${shot.id.padEnd(22)} (no route node ${shot.locationId})`); continue; }
  const cells: string[] = [];
  for (const radius of [25, 12]) {
    let count = 0;
    let area = 0;
    for (const instance of instances) {
      if (NOT_COVER.test(instance.asset)) continue;
      const dx = instance.x - target[0];
      const dz = instance.z - target[1];
      if (dx * dx + dz * dz > radius * radius) continue;
      const bounds = size.get(instance.asset);
      if (!bounds) continue;
      count += 1;
      area += (Math.PI / 4) * bounds.x * instance.scale * bounds.z * instance.scale;
    }
    const disc = Math.PI * radius * radius;
    cells.push(`${(count / disc).toFixed(3).padStart(8)}${`${(100 * area / disc).toFixed(0)}%`.padStart(7)}`);
  }
  console.log(shot.id.padEnd(22), cells.join("  "), `  ${shot.regionId}`);
}

console.log("\nregion         cover instances   mean footprint m2   region cover");
for (const region of REGIONS) {
  const entry = worldTotals.get(region.id);
  if (!entry || entry.count === 0) continue;
  const rect = rects.get(region.id)!;
  const regionArea = (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ);
  console.log(
    region.id.padEnd(14),
    String(entry.count).padStart(9),
    (entry.area / entry.count).toFixed(3).padStart(19),
    `${(100 * entry.area / regionArea).toFixed(1)}%`.padStart(14),
    `over ${(regionArea / 10000).toFixed(1)} ha`,
  );
}
