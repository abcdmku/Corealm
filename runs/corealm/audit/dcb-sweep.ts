/**
 * What the scatter tiling actually costs and buys, per camera pose, offline.
 *
 * `shardByTile` trades draw calls for triangles, and the only honest way to choose its constants is
 * to count both at the poses the budget is measured at. This runs the REAL `scatterRegion` against
 * the same stub scene cov-offline.ts uses, then for each candidate tiling config rebuilds every
 * shard's bounding sphere and tests it against the real camera frustum (CAMERA.fov 55, aspect
 * 1440/900, far = FOG_FAR 210) and against the 96 x 96 m orthographic shadow box the renderer runs.
 *
 * A shard costs one draw call per GLB primitive when its sphere is in the view frustum, and a
 * second when it is in the shadow box. Triangles are counted the same way. The terrain here is the
 * stub's analytic field rather than the drawn mesh, so heights are approximate and the vertical
 * frustum test is loose; the horizontal test, which is what the tiling changes, is exact.
 *
 *   npx tsx runs/corealm/audit/dcb-sweep.ts
 */
import { readFileSync } from "node:fs";
import { DEFAULT_SCATTER, scatterRegion, worldExclusions } from "../../../game/src/world/scatter.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import { SHOTS } from "../../../game/src/debug/shots.js";
import type { RegionId, Vec3 } from "../../../game/src/contracts.js";

const FOV = 55;
const ASPECT = 1440 / 900;
const FAR = 210;
const SHADOW_BOX = 96;

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

interface Placed { region: string; asset: string; xs: number[]; zs: number[] }
const placements: Placed[] = [];
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
    const m = /^scatter-([a-z]+)-(.+)-t\d+$/.exec(name);
    placements.push({
      region: m?.[1] ?? "?", asset: m?.[2] ?? "?",
      xs: entries.map((e) => e.position[0]), zs: entries.map((e) => e.position[2]),
    });
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

// Per-asset GLB cost, read straight out of the shipped files.
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: { id: string; file: string }[] };
const cost = new Map<string, { tris: number; prims: number }>();
for (const entry of manifest.assets) {
  try {
    const buf = readFileSync("game/public/assets/" + entry.file);
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

/** Every instance of one (region, asset), reassembled across whatever shards the run produced. */
interface Bucket { region: string; asset: string; shadow: boolean; xs: number[]; zs: number[] }
const buckets = new Map<string, Bucket>();
for (const p of placements) {
  const key = `${p.region}:${p.asset}`;
  const row = buckets.get(key) ?? { region: p.region, asset: p.asset, shadow: SHADOW.has(key), xs: [], zs: [] };
  row.xs.push(...p.xs); row.zs.push(...p.zs);
  buckets.set(key, row);
}

interface Config { name: string; shadowMetres: number; coverMetres: number; coverMin: number; perTileMin: number }
const CONFIGS: Config[] = [
  { name: "no tiling at all", shadowMetres: 0, coverMetres: 0, coverMin: Infinity, perTileMin: 0 },
  { name: "shipped: shadow 96, cover 128/4000", shadowMetres: 96, coverMetres: 128, coverMin: 4000, perTileMin: 0 },
  { name: "  + per-tile floor 4", shadowMetres: 96, coverMetres: 128, coverMin: 4000, perTileMin: 4 },
  { name: "  + per-tile floor 8", shadowMetres: 96, coverMetres: 128, coverMin: 4000, perTileMin: 8 },
  { name: "  + per-tile floor 12", shadowMetres: 96, coverMetres: 128, coverMin: 4000, perTileMin: 12 },
  { name: "  + per-tile floor 16", shadowMetres: 96, coverMetres: 128, coverMin: 4000, perTileMin: 16 },
  { name: "  + per-tile floor 24", shadowMetres: 96, coverMetres: 128, coverMin: 4000, perTileMin: 24 },
  { name: "shadow 128 + per-tile floor 8", shadowMetres: 128, coverMetres: 128, coverMin: 4000, perTileMin: 8 },
];

interface Shard { cx: number; cz: number; cy: number; radius: number; count: number; asset: string; shadow: boolean }

function shardsFor(bucket: Bucket, config: Config): Shard[] {
  const metres = bucket.shadow
    ? config.shadowMetres
    : bucket.xs.length >= config.coverMin ? config.coverMetres : 0;
  const groups = new Map<string, number[]>();
  if (metres <= 0) groups.set("0", bucket.xs.map((_, i) => i));
  else {
    for (let i = 0; i < bucket.xs.length; i += 1) {
      const key = `${Math.floor(bucket.xs[i]! / metres)}_${Math.floor(bucket.zs[i]! / metres)}`;
      const list = groups.get(key);
      if (list) list.push(i); else groups.set(key, [i]);
    }
    // The floor this sweep is here to choose: a shard has to hold enough instances to be worth the
    // draw call it costs, or the whole bucket stays whole.
    if (bucket.xs.length / groups.size < config.perTileMin) {
      groups.clear();
      groups.set("0", bucket.xs.map((_, i) => i));
    }
  }
  const out: Shard[] = [];
  for (const indices of groups.values()) {
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    let minY = Infinity; let maxY = -Infinity;
    for (const i of indices) {
      const x = bucket.xs[i]!; const z = bucket.zs[i]!; const y = heightAtXZ(x, z);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // 6 m of slack for the tallest tree's own half-height, so a sphere is not tighter than the art.
    const radius = Math.hypot(maxX - minX, maxZ - minZ, maxY - minY) / 2 + 6;
    out.push({
      cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, cy: (minY + maxY) / 2 + 3,
      radius, count: indices.length, asset: bucket.asset, shadow: bucket.shadow,
    });
  }
  return out;
}

// Camera poses, exactly as render/camera.ts composes them from a shot.
const locations = new Map<string, [number, number]>();
for (const region of REGIONS) {
  for (const l of region.locations) locations.set(l.id, l.position);
  if (region.settlement) for (const b of region.settlement.buildings) locations.set(b.id, b.position);
}
interface Pose { id: string; eye: [number, number, number]; target: [number, number, number] }
const poses: Pose[] = [];
for (const shot of SHOTS) {
  const spot = locations.get(shot.locationId);
  if (!spot) continue;
  const target: [number, number, number] = [spot[0], heightAtXZ(spot[0], spot[1]) + 1, spot[1]];
  const horizontal = Math.cos(shot.pitch) * shot.distance;
  poses.push({
    id: shot.id,
    eye: [
      target[0] + Math.sin(shot.yaw) * horizontal,
      target[1] + Math.sin(shot.pitch) * shot.distance,
      target[2] + Math.cos(shot.yaw) * horizontal,
    ],
    target,
  });
}

/** Four side planes plus far, as (normal, d) with the normal pointing into the frustum. */
function frustumPlanes(pose: Pose): number[][] {
  const f = [pose.target[0] - pose.eye[0], pose.target[1] - pose.eye[1], pose.target[2] - pose.eye[2]];
  const fl = Math.hypot(f[0]!, f[1]!, f[2]!) || 1;
  const fwd = [f[0]! / fl, f[1]! / fl, f[2]! / fl];
  const upRef = [0, 1, 0];
  const right = [
    fwd[1]! * upRef[2]! - fwd[2]! * upRef[1]!,
    fwd[2]! * upRef[0]! - fwd[0]! * upRef[2]!,
    fwd[0]! * upRef[1]! - fwd[1]! * upRef[0]!,
  ];
  const rl = Math.hypot(right[0]!, right[1]!, right[2]!) || 1;
  const r = [right[0]! / rl, right[1]! / rl, right[2]! / rl];
  const u = [
    r[1]! * fwd[2]! - r[2]! * fwd[1]!,
    r[2]! * fwd[0]! - r[0]! * fwd[2]!,
    r[0]! * fwd[1]! - r[1]! * fwd[0]!,
  ];
  const halfV = (FOV * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * ASPECT);
  const planes: number[][] = [];
  const push = (n: number[]): void => {
    planes.push([n[0]!, n[1]!, n[2]!, -(n[0]! * pose.eye[0] + n[1]! * pose.eye[1] + n[2]! * pose.eye[2])]);
  };
  const mix = (a: number[], b: number[], ca: number, cb: number): number[] =>
    [a[0]! * ca + b[0]! * cb, a[1]! * ca + b[1]! * cb, a[2]! * ca + b[2]! * cb];
  push(mix(fwd, r, Math.cos(halfH), Math.sin(halfH)));
  push(mix(fwd, r, Math.cos(halfH), -Math.sin(halfH)));
  push(mix(fwd, u, Math.cos(halfV), Math.sin(halfV)));
  push(mix(fwd, u, Math.cos(halfV), -Math.sin(halfV)));
  planes.push([-fwd[0]!, -fwd[1]!, -fwd[2]!,
    fwd[0]! * pose.eye[0] + fwd[1]! * pose.eye[1] + fwd[2]! * pose.eye[2] + FAR]);
  return planes;
}

function seenBy(planes: number[][], s: Shard): boolean {
  for (const p of planes) {
    if (p[0]! * s.cx + p[1]! * s.cy + p[2]! * s.cz + p[3]! < -s.radius) return false;
  }
  return true;
}

function inShadowBox(pose: Pose, s: Shard): boolean {
  return Math.abs(s.cx - pose.target[0]) <= SHADOW_BOX / 2 + s.radius
    && Math.abs(s.cz - pose.target[2]) <= SHADOW_BOX / 2 + s.radius;
}

const perPose = new Map<string, Map<string, { calls: number; tris: number }>>();
console.log("config".padEnd(38), "worst calls   worst tris   mean calls   mean tris   world meshes");
for (const config of CONFIGS) {
  const shards: Shard[] = [];
  for (const bucket of buckets.values()) shards.push(...shardsFor(bucket, config));
  let worstCalls = 0; let worstTris = 0; let sumCalls = 0; let sumTris = 0;
  for (const pose of poses) {
    const planes = frustumPlanes(pose);
    let calls = 0; let tris = 0;
    for (const s of shards) {
      const c = cost.get(s.asset);
      if (!c) continue;
      if (seenBy(planes, s)) { calls += c.prims; tris += c.tris * s.count; }
      if (s.shadow && inShadowBox(pose, s)) { calls += c.prims; tris += c.tris * s.count; }
    }
    if (calls > worstCalls) worstCalls = calls;
    if (tris > worstTris) worstTris = tris;
    sumCalls += calls; sumTris += tris;
    const row = perPose.get(pose.id) ?? new Map();
    row.set(config.name, { calls, tris });
    perPose.set(pose.id, row);
  }
  console.log(config.name.padEnd(38),
    String(worstCalls).padStart(11),
    (worstTris / 1e6).toFixed(2).padStart(12) + "M",
    String(Math.round(sumCalls / poses.length)).padStart(11),
    (sumTris / poses.length / 1e6).toFixed(2).padStart(11) + "M",
    String(shards.length).padStart(14));
}

console.log("");
console.log("per pose: shipped -> per-tile floor 8");
for (const [id, row] of perPose) {
  const a = row.get("shipped: shadow 96, cover 128/4000")!;
  const b = row.get("  + per-tile floor 8")!;
  console.log("  " + id.padEnd(22),
    String(a.calls).padStart(4) + " -> " + String(b.calls).padStart(4),
    " tris " + (a.tris / 1e6).toFixed(2) + "M -> " + (b.tris / 1e6).toFixed(2) + "M");
}
