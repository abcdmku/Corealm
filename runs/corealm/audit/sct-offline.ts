/**
 * Offline sampler probe: runs scatterRegion against a stub WorldScene and a stub AssetRegistry so
 * the density, spacing and clustering numbers can be measured without a browser.
 *
 * The stub terrain is the real region base height plus a couple of sine waves at the region's
 * amplitude, which is enough to exercise the slope, altitude and normal rules.
 */
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
      // Frequency scaled by 1/amplitude so the stub's worst slope lands near 0.5 in every region;
      // a fixed frequency put Karrowmoor's 62 m amplitude at a 1.07 gradient everywhere, which is
      // steeper than any rule in DEFAULT_SCATTER accepts and made the probe useless there.
      const f = 0.45 / a.amplitude;
      const n = (Math.sin(x * f) * Math.cos(z * f * 0.81) + Math.sin(x * f * 2.9 + z * f * 2.05) * 0.5) / 1.5;
      return a.base + (n * 0.5 + 0.5) * a.amplitude;
    }
  }
  return 0;
}

const placements: { name: string; count: number; xs: number[]; zs: number[] }[] = [];

const scene = {
  getRegionRect: (id: RegionId): Rect | null => rects.get(id) ?? null,
  getWorldBounds: (): Rect => ({ minX: -350, maxX: 350, minZ: -200, maxZ: 200 }),
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
    _source: unknown,
    entries: { position: Vec3 }[],
    name: string,
  ): { geometry: { getIndex(): { count: number } | null; getAttribute(): { count: number } }; count: number }[] => {
    placements.push({ name, count: entries.length, xs: entries.map((e) => e.position[0]), zs: entries.map((e) => e.position[2]) });
    return [{
      geometry: { getIndex: () => ({ count: 300 }), getAttribute: () => ({ count: 300 }) },
      count: entries.length,
    }];
  },
};

const roadLines: Vec3[][] = [];
for (const region of REGIONS) {
  const byId = new Map(region.locations.map((l) => [l.id, l]));
  for (const road of region.roads) {
    const a = byId.get(road.from); const b = byId.get(road.to);
    if (!a || !b) continue;
    const points: Vec3[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      points.push([a.position[0] + (b.position[0] - a.position[0]) * t, 0, a.position[1] + (b.position[1] - a.position[1]) * t]);
    }
    roadLines.push(points);
  }
}

const assets = {
  entry: (id: string) => ({ id }),
  byTags: () => [],
  loadMany: async () => {},
  instance: (id: string) => ({ id }),
};

// Same exclusions the root registers (app/boot.ts registerExclusions).
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

const started = Date.now();
let placed = 0;
let calls = 0;
for (const id of ["fallowmarch", "vellenwood", "karrowmoor"] as RegionId[]) {
  const spec = DEFAULT_SCATTER[id];
  const result = await scatterRegion(scene as never, assets as never, id, spec, 1);
  const rect = rects.get(id)!;
  const hectares = ((rect.maxX - rect.minX) * (rect.maxZ - rect.minZ)) / 10000;
  placed += result.placed;
  calls += result.estimatedDrawCalls;
  console.log(
    id, "placed", result.placed, "clusters", result.clusters, "rejected", result.rejected,
    "meshes", result.instancedMeshes, "perHa", (result.placed / hectares).toFixed(0),
  );
  console.log("   byLayer", JSON.stringify(result.byLayer));
  console.log("   bySource", JSON.stringify(result.bySource), "missing", JSON.stringify(result.missingAssets));
}
console.log("world placed", placed, "estimated draw calls (stub: 1 prim per asset)", calls, "ms", Date.now() - started);

// Real triangle and primitive costs, parsed from the GLB JSON chunks.
const fs = await import("node:fs");
const manifest = JSON.parse(fs.readFileSync("game/public/assets/manifest.json", "utf8")) as { assets?: unknown } | unknown[];
const entries = (Array.isArray(manifest) ? manifest : (manifest as { assets: unknown[] }).assets) as { id: string; file: string }[];
const cost = new Map<string, { tris: number; prims: number }>();
for (const entry of entries) {
  try {
    const buf = fs.readFileSync("game/public/assets/" + entry.file);
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8")) as {
      meshes?: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[];
      accessors: { count: number }[];
    };
    let tris = 0; let prims = 0;
    for (const mesh of json.meshes ?? []) for (const prim of mesh.primitives) {
      prims += 1;
      const n = prim.indices != null ? json.accessors[prim.indices]!.count : json.accessors[prim.attributes.POSITION]!.count;
      tris += Math.round(n / 3);
    }
    cost.set(entry.id, { tris, prims });
  } catch { /* not a GLB we care about */ }
}

const shadowLayers = new Set(["copse", "deadwood", "canopy", "conifer", "duskoak", "crags", "cairnpine", "windfall"]);
const perRegion = new Map<string, { tris: number; calls: number }>();
for (const p of placements) {
  const [, region, assetId] = /^scatter-([a-z]+)-(.+)$/.exec(p.name) ?? [];
  if (!region || !assetId) continue;
  const c = cost.get(assetId);
  if (!c) { console.log("no cost for", assetId); continue; }
  const layer = Object.entries(DEFAULT_SCATTER).find(([r]) => r === region)?.[1]
    .layers.find((l) => (l.species ?? l.assetIds?.map((a) => ({ assetId: a })) ?? []).some((sp) => (sp as { assetId: string }).assetId === assetId));
  const shadow = layer && shadowLayers.has(layer.id) ? 2 : 1;
  const acc = perRegion.get(region) ?? { tris: 0, calls: 0 };
  acc.tris += c.tris * p.count * shadow;
  acc.calls += c.prims * shadow;
  perRegion.set(region, acc);
}
let worldTris = 0; let worldCalls = 0;
for (const [region, acc] of perRegion) {
  console.log(region, "triangles", (acc.tris / 1e6).toFixed(2) + "M", "draw calls", acc.calls);
  worldTris += acc.tris; worldCalls += acc.calls;
}
console.log("world triangles", (worldTris / 1e6).toFixed(2) + "M", "draw calls", worldCalls);
const pairs: [string, string][] = [["fallowmarch", "vellenwood"], ["vellenwood", "karrowmoor"], ["fallowmarch", "karrowmoor"]];
for (const [a, b] of pairs) {
  const x = perRegion.get(a)!; const y = perRegion.get(b)!;
  console.log("pair", a, b, ((x.tris + y.tris) / 1e6).toFixed(2) + "M", x.calls + y.calls, "calls");
}

// Nearest-neighbour distances inside the ground-cover layer, which is the number the diagnosis
// measured at 10.4 m minimum / 11.3 m mean.
const cover = placements.filter((p) => /grass_common_short|plant_broad_small|plant_leafy_small|clover_1|plant_broad_large/.test(p.name) && p.name.includes("fallowmarch"));
const pts: [number, number][] = [];
for (const p of cover) for (let i = 0; i < p.xs.length; i += 1) pts.push([p.xs[i]!, p.zs[i]!]);
let min = Infinity;
let sum = 0;
const sample = pts.slice(0, 3000);
for (const a of sample) {
  let best = Infinity;
  for (const b of pts) {
    if (a === b) continue;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d > 0 && d < best) best = d;
  }
  if (best < min) min = best;
  sum += best;
}
console.log("fallowmarch ground cover:", pts.length, "instances, nnMin", min.toFixed(2), "nnMean", (sum / sample.length).toFixed(2));
