/**
 * Offline coverage probe. Runs the real scatterRegion against a stub scene (copied from
 * sct-offline.ts), then reports per-region layer counts, real GLB triangle cost, and per-shot-pose
 * ground coverage: instances within 30 m of each camera pose and the fraction of 3 m cells in that
 * disc holding at least one.
 */
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

const placements: { name: string; count: number; xs: number[]; zs: number[] }[] = [];
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
for (const id of ["fallowmarch", "vellenwood", "karrowmoor"] as RegionId[]) {
  const spec = DEFAULT_SCATTER[id];
  const result = await scatterRegion(scene as never, assets as never, id, spec, 1);
  placed += result.placed;
  console.log(id, "placed", result.placed, "clusters", result.clusters, "rejected", result.rejected);
  console.log("   byLayer", JSON.stringify(result.byLayer), "bySource", JSON.stringify(result.bySource), "missing", JSON.stringify(result.missingAssets));
}
console.log("world placed", placed, "ms", Date.now() - started);

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
  } catch { /* not a GLB */ }
}

/** `${regionId}:${assetId}` for every asset a shadow-casting layer names. */
const SHADOW_ASSETS = new Set<string>();
for (const [regionId, spec] of Object.entries(DEFAULT_SCATTER)) {
  for (const layer of spec.layers) {
    if (!layer.castShadow) continue;
    for (const sp of layer.species ?? []) SHADOW_ASSETS.add(`${regionId}:${sp.assetId}`);
    for (const id of layer.assetIds ?? []) SHADOW_ASSETS.add(`${regionId}:${id}`);
  }
}

const perRegion = new Map<string, { tris: number; calls: number }>();
const perAsset: { name: string; tris: number; calls: number; count: number }[] = [];
for (const p of placements) {
  const m = /^scatter-([a-z]+)-(.+)-t\d+$/.exec(p.name);
  const region = m?.[1];
  const assetId = m?.[2];
  if (!region || !assetId) { console.log("unparsed", p.name); continue; }
  const c = cost.get(assetId);
  if (!c) { console.log("no cost for", assetId); continue; }
  const shadow = SHADOW_ASSETS.has(`${region}:${assetId}`) ? 2 : 1;
  const acc = perRegion.get(region) ?? { tris: 0, calls: 0 };
  acc.tris += c.tris * p.count * shadow;
  acc.calls += c.prims * shadow;
  perRegion.set(region, acc);
  perAsset.push({ name: p.name, tris: c.tris * p.count * shadow, calls: c.prims * shadow, count: p.count });
}
let worldTris = 0; let worldCalls = 0;
for (const [region, acc] of perRegion) {
  console.log(region, "triangles", (acc.tris / 1e6).toFixed(2) + "M", "draw calls", acc.calls);
  worldTris += acc.tris; worldCalls += acc.calls;
}
console.log("world triangles", (worldTris / 1e6).toFixed(2) + "M", "draw calls", worldCalls);
perAsset.sort((a, b) => b.tris - a.tris);
console.log("--- top cost");
for (const a of perAsset.slice(0, 14)) console.log("  ", a.name, a.count, "x ->", (a.tris / 1e6).toFixed(2) + "M", a.calls, "calls");

console.log("--- pose coverage (3 m cells, r=30 m and r=14 m near field)");
const all: { x: number; z: number }[] = [];
for (const p of placements) for (let i = 0; i < p.count; i += 1) all.push({ x: p.xs[i]!, z: p.zs[i]! });
const locById = new Map<string, [number, number]>();
for (const region of REGIONS) {
  for (const l of region.locations) locById.set(l.id, l.position);
  if (region.settlement) for (const b of region.settlement.buildings) locById.set(b.id, b.position);
}
let total = 0;
for (let cxi = -10; cxi < 10; cxi += 1) {
  for (let czi = -10; czi < 10; czi += 1) {
    const mx = cxi * 3 + 1.5; const mz = czi * 3 + 1.5;
    if (mx * mx + mz * mz <= 900) total += 1;
  }
}
for (const shot of SHOTS) {
  const pos = locById.get(shot.locationId);
  if (!pos) { console.log("  ", shot.id.padEnd(22), "NO LOCATION"); continue; }
  const [cx, cz] = pos;
  let near = 0;
  const cells = new Set<number>();
  for (const inst of all) {
    const dx = inst.x - cx; const dz = inst.z - cz;
    if (dx * dx + dz * dz > 900) continue;
    near += 1;
    cells.add(((Math.floor(dx / 3) + 32) << 8) | (Math.floor(dz / 3) + 32));
  }
  let near14 = 0;
  const cells14 = new Set<number>();
  for (const inst of all) {
    const dx = inst.x - cx; const dz = inst.z - cz;
    if (dx * dx + dz * dz > 196) continue;
    near14 += 1;
    cells14.add(((Math.floor(dx / 3) + 32) << 8) | (Math.floor(dz / 3) + 32));
  }
  let total14 = 0;
  for (let a = -6; a < 6; a += 1) for (let b = -6; b < 6; b += 1) {
    const mx = a * 3 + 1.5; const mz = b * 3 + 1.5;
    if (mx * mx + mz * mz <= 196) total14 += 1;
  }
  console.log("  ", shot.id.padEnd(22), "r30", String(near).padStart(5), ((cells.size / total) * 100).toFixed(0).padStart(3) + "%", "  r14", String(near14).padStart(4), ((cells14.size / total14) * 100).toFixed(0).padStart(3) + "%");
}

// ---- water discs: nothing may be drawn inside the measured waterline of a fishing pond.
console.log("--- water discs (root builds the disc at cluster.radius + 14)");
for (const region of REGIONS) {
  for (const c of region.clusters) {
    if (c.archetype !== "fishing_spot") continue;
    let inside = 0; let ring = 0;
    for (const inst of all) {
      const d = Math.hypot(inst.x - c.centre[0], inst.z - c.centre[1]);
      if (d < c.radius + 3) inside += 1;
      else if (d < c.radius + 14) ring += 1;
    }
    console.log("  ", c.id.padEnd(22), "inside r+3", inside, " r+3..r+14 annulus", ring);
  }
}

// ---- region seams: instances must exist on both sides of a border, or the fade is dead code.
console.log("--- region seams (candidates outside the owning rect prove the fade is live)");
for (const p of placements) {
  const m = /^scatter-([a-z]+)-/.exec(p.name);
  const rect = rects.get((m?.[1] ?? "") as RegionId);
  if (!rect) continue;
  let out = 0;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.xs[i]!; const z = p.zs[i]!;
    if (x < rect.minX || x > rect.maxX || z < rect.minZ || z > rect.maxZ) out += 1;
  }
  if (out > 0) console.log("  ", p.name, out, "of", p.count, "outside own rect");
}

// ---- settlement fringe: density as a function of distance from a settlement centre.
console.log("--- settlement radial density (instances per 100 m2 by ring)");
for (const region of REGIONS) {
  const s = region.settlement;
  if (!s) continue;
  const rings: number[] = new Array(9).fill(0);
  for (const inst of all) {
    const d = Math.hypot(inst.x - s.centre[0], inst.z - s.centre[1]);
    const ring = Math.floor(d / 10);
    if (ring < rings.length) rings[ring]! += 1;
  }
  const per = rings.map((n, i) => {
    const area = Math.PI * (((i + 1) * 10) ** 2 - (i * 10) ** 2);
    return (n / area * 100).toFixed(1);
  });
  console.log("  ", s.id.padEnd(12), per.join("  "), "(0-10 .. 80-90 m)");
}

// ---- what the camera actually sees, swept over tile size and threshold.
//
// The measurement the perf tool cannot give while five other agents are editing the renderer:
// rebuild each candidate mesh's bounding sphere from its own instances, then test it against the
// real camera frustum (fov 55, far 280, 1920x1080) and against the 96 m shadow box, per shot pose.
const FOV = 55 * Math.PI / 180;
const ASPECT = 1920 / 1080;
const FAR = 280;
const FOCUS_HEIGHT = 1.1;

interface Inst { x: number; z: number }
const byAsset = new Map<string, { region: string; assetId: string; tris: number; shadow: boolean; insts: Inst[] }>();
for (const p of placements) {
  const m = /^scatter-([a-z]+)-(.+)-t\d+$/.exec(p.name);
  const region = m?.[1]; const assetId = m?.[2];
  if (!region || !assetId) continue;
  const c = cost.get(assetId);
  if (!c) continue;
  const key = `${region}:${assetId}`;
  const acc = byAsset.get(key)
    ?? { region, assetId, tris: c.tris, shadow: SHADOW_ASSETS.has(key), insts: [] as Inst[] };
  for (let i = 0; i < p.count; i += 1) acc.insts.push({ x: p.xs[i]!, z: p.zs[i]! });
  byAsset.set(key, acc);
}

interface Sphere { cx: number; cy: number; cz: number; r: number; tris: number; count: number; shadow: boolean; region: string }
function buildSpheres(tileMetres: number, minInstances: number, shadowTile: number): Sphere[] {
  const out: Sphere[] = [];
  for (const acc of byAsset.values()) {
    const size = acc.shadow && shadowTile > 0
      ? shadowTile
      : (tileMetres > 0 && acc.insts.length >= minInstances ? tileMetres : 0);
    const groups = new Map<number, Inst[]>();
    for (const inst of acc.insts) {
      const key = size > 0
        ? ((Math.floor(inst.x / size) & 0xffff) << 16) | (Math.floor(inst.z / size) & 0xffff)
        : 0;
      const g = groups.get(key);
      if (g) g.push(inst); else groups.set(key, [inst]);
    }
    for (const g of groups.values()) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const inst of g) {
        const y = heightAtXZ(inst.x, inst.z);
        if (inst.x < minX) minX = inst.x; if (inst.x > maxX) maxX = inst.x;
        if (inst.z < minZ) minZ = inst.z; if (inst.z > maxZ) maxZ = inst.z;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
      out.push({
        cx, cy, cz,
        // +4 m for the instance's own height, which the placement point does not carry.
        r: Math.hypot(maxX - cx, maxY - cy, maxZ - cz) + 4,
        tris: acc.tris, count: g.length, shadow: acc.shadow, region: acc.region,
      });
    }
  }
  return out;
}

function visibleCost(spheres: Sphere[], px: number, py: number, pz: number, yaw: number, pitch: number, distance: number): { calls: number; tris: number } {
  const fx = px, fy = py + FOCUS_HEIGHT, fz = pz;
  const horizontal = Math.cos(pitch) * distance;
  const ex = fx + Math.sin(yaw) * horizontal;
  const ey = fy + Math.sin(pitch) * distance;
  const ez = fz + Math.cos(yaw) * horizontal;
  let dx = fx - ex, dy = fy - ey, dz = fz - ez;
  const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
  let rx = dz, ry = 0, rz = -dx;                        // cross(forward, worldUp)
  const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * dz - rz * dy, uy = rz * dx - rx * dz, uz = rx * dy - ry * dx;
  const tanV = Math.tan(FOV / 2);
  const tanH = tanV * ASPECT;
  const planes: [number, number, number, number][] = [];
  const add = (nx: number, ny: number, nz: number): void => {
    const l = Math.hypot(nx, ny, nz);
    planes.push([nx / l, ny / l, nz / l, -(nx / l * ex + ny / l * ey + nz / l * ez)]);
  };
  add(dx + rx / tanH, dy + ry / tanH, dz + rz / tanH);
  add(dx - rx / tanH, dy - ry / tanH, dz - rz / tanH);
  add(dx + ux / tanV, dy + uy / tanV, dz + uz / tanV);
  add(dx - ux / tanV, dy - uy / tanV, dz - uz / tanV);
  planes.push([dx, dy, dz, -(dx * ex + dy * ey + dz * ez)]);
  planes.push([-dx, -dy, -dz, dx * ex + dy * ey + dz * ez + FAR]);

  let calls = 0; let tris = 0;
  for (const s of spheres) {
    const rect = rects.get(s.region as RegionId)!;
    const depth = Math.min(px - rect.minX, rect.maxX - px, pz - rect.minZ, rect.maxZ - pz);
    if (depth <= -240) continue;
    let inside = true;
    for (const [nx, ny, nz, d] of planes) {
      if (nx * s.cx + ny * s.cy + nz * s.cz + d < -s.r) { inside = false; break; }
    }
    if (inside) { calls += 1; tris += s.tris * s.count; }
    if (s.shadow) {
      const near = Math.max(0, Math.abs(s.cx - px) - s.r) < 48 && Math.max(0, Math.abs(s.cz - pz) - s.r) < 48;
      if (near) { calls += 1; tris += s.tris * s.count; }
    }
  }
  return { calls, tris };
}

const configs: { label: string; tile: number; min: number; shadow: number }[] = [
  { label: "none", tile: 0, min: 0, shadow: 0 },
  { label: "sh96 only", tile: 0, min: 0, shadow: 96 },
  { label: "sh128 only", tile: 0, min: 0, shadow: 128 },
  { label: "sh96 c256/1200", tile: 256, min: 1200, shadow: 96 },
  { label: "sh96 c192/1200", tile: 192, min: 1200, shadow: 96 },
  { label: "sh96 c160/1200", tile: 160, min: 1200, shadow: 96 },
  { label: "sh96 c128/1200", tile: 128, min: 1200, shadow: 96 },
  { label: "sh96 c128/2500", tile: 128, min: 2500, shadow: 96 },
  { label: "sh96 c144/2500", tile: 144, min: 2500, shadow: 96 },
  { label: "sh96 c112/2500", tile: 112, min: 2500, shadow: 96 },
  { label: "sh96 c128/4000", tile: 128, min: 4000, shadow: 96 },
  { label: "sh96 c96/2500", tile: 96, min: 2500, shadow: 96 },
  { label: "sh96 c96/1200", tile: 96, min: 1200, shadow: 96 },
  { label: "sh64 c96/1200", tile: 96, min: 1200, shadow: 64 },
];
console.log("--- visible scatter cost per pose: worst-pose calls and triangles by config");
for (const cfg of configs) {
  const spheres = buildSpheres(cfg.tile, cfg.min, cfg.shadow);
  let worstCalls = 0; let worstTris = 0; let sumCalls = 0; let sumTris = 0; let n = 0;
  let worstCallsShot = ""; let worstTrisShot = "";
  for (const shot of SHOTS) {
    const pos = locById.get(shot.locationId);
    if (!pos) continue;
    const [px, pz] = pos;
    const v = visibleCost(spheres, px, heightAtXZ(px, pz), pz, shot.yaw, shot.pitch, shot.distance);
    if (v.calls > worstCalls) { worstCalls = v.calls; worstCallsShot = shot.id; }
    if (v.tris > worstTris) { worstTris = v.tris; worstTrisShot = shot.id; }
    sumCalls += v.calls; sumTris += v.tris; n += 1;
  }
  console.log(
    "  ", cfg.label.padEnd(13), "meshes", String(spheres.length).padStart(4),
    " worst calls", String(worstCalls).padStart(3), `(${worstCallsShot})`.padEnd(22),
    " worst tris", (worstTris / 1e6).toFixed(2) + "M", `(${worstTrisShot})`.padEnd(22),
    " mean", (sumCalls / n).toFixed(0), (sumTris / n / 1e6).toFixed(2) + "M",
  );
}
