/**
 * Focused visual contracts for authored settlement structures.
 *
 * This is intentionally a source-level audit, not a browser check. It walks every authored
 * settlement building, samples every compatible structure recipe, and checks the few invariants
 * that are easy to lose when a recipe adds a facade detail. Wall runs are sampled separately at
 * several seeds because their facade is a construction, not a random decoration bag.
 *
 *   npx tsx runs/corealm/audit/structure-visual-contracts.ts
 */
import { readFileSync } from "node:fs";
import {
  BUILDING_KITS,
  buildPrefab,
  buildWallRun,
  variantSeed,
  type BuildingKit,
  type KitId,
  type PartPlacement,
  type PrefabId,
} from "../../../game/src/render/buildings.js";
import {
  REGIONS,
  spotDistance,
  type RegionDef,
  type WallRunDef,
} from "../../../game/src/content/regions.js";
import {
  selectedStructureVariantId,
  structureVariantCount,
} from "../../../game/src/render/structures/catalog.js";

interface ManifestAsset {
  id: string;
  size: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
  /** Optional future metadata. Missing metadata is reported, never inferred. */
  orientationAxis?: string;
}

const manifest = JSON.parse(
  readFileSync("game/public/assets/manifest.json", "utf8"),
) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface RoofFacts {
  /** Placement origin is the same wall-head/base Y used by the source PlacedRoof. */
  baseY: number;
  apex: number;
  drop: number;
  acrossHalf: number;
  alongHalf: number;
  alongZ: boolean;
}

interface RecipeSample {
  id: string;
  seed: number;
}

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : String(value);
}

/** Turn a manifest asset's authored base/size into the actual transformed placement bounds. */
function placedBox(part: PartPlacement): Box | null {
  const asset = byId.get(part.assetId);
  if (asset === undefined) return null;
  if (![part.dx, part.dy, part.dz, part.rotationY, part.scale].every(Number.isFinite)) return null;
  if (![asset.base.x, asset.base.y, asset.base.z, asset.size.x, asset.size.y, asset.size.z]
    .every(Number.isFinite)) return null;

  const axes = part.scaleAxes ?? [1, 1, 1];
  const lo = {
    x: asset.base.x * part.scale * axes[0],
    y: asset.base.y * part.scale * axes[1],
    z: asset.base.z * part.scale * axes[2],
  };
  const hi = {
    x: lo.x + asset.size.x * part.scale * axes[0],
    y: lo.y + asset.size.y * part.scale * axes[1],
    z: lo.z + asset.size.z * part.scale * axes[2],
  };
  const cos = Math.cos(part.rotationY);
  const sin = Math.sin(part.rotationY);
  const box: Box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: part.dy + lo.y,
    maxY: part.dy + hi.y,
    minZ: Infinity,
    maxZ: -Infinity,
  };

  for (const x of [lo.x, hi.x]) {
    for (const z of [lo.z, hi.z]) {
      const worldX = part.dx + x * cos + z * sin;
      const worldZ = part.dz - x * sin + z * cos;
      box.minX = Math.min(box.minX, worldX);
      box.maxX = Math.max(box.maxX, worldX);
      box.minZ = Math.min(box.minZ, worldZ);
      box.maxZ = Math.max(box.maxZ, worldZ);
    }
  }
  return box;
}

function isWindowBacking(part: PartPlacement): boolean {
  return part.assetId === "window_wide"
    || part.assetId === "window_thin"
    || /^wall_.*_window$/.test(part.assetId);
}

const SHUTTER_COMPANION_RADIUS = 0.8;

function checkShutterCompanions(owner: string, parts: readonly PartPlacement[]): void {
  for (const shutter of parts.filter((part) => part.assetId === "window_shutters")) {
    let nearest: { part: PartPlacement; distance: number } | undefined;
    for (const candidate of parts) {
      if (candidate.tag === shutter.tag || !isWindowBacking(candidate)) continue;
      const distance = Math.hypot(
        candidate.dx - shutter.dx,
        candidate.dy - shutter.dy,
        candidate.dz - shutter.dz,
      );
      if (nearest === undefined || distance < nearest.distance) nearest = { part: candidate, distance };
    }
    check(
      nearest !== undefined && nearest.distance <= SHUTTER_COMPANION_RADIUS,
      `${owner}: ${shutter.tag} (${shutter.assetId}) has no nearby window_wide/window_thin or wall_*_window `
        + `(nearest ${nearest?.part.tag ?? "none"} at ${nearest === undefined ? "n/a" : formatNumber(nearest.distance)} m)`,
    );
  }
}

function yawDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/** Standalone glass belongs in a real wall aperture, never pasted onto a solid facade. */
function checkWindowApertures(owner: string, parts: readonly PartPlacement[]): void {
  const apertures = parts.filter((part) => /^wall_.*_window$/.test(part.assetId));
  for (const window of parts.filter((part) => (
    part.assetId === "window_wide" || part.assetId === "window_thin"
  ))) {
    const aperture = apertures.find((candidate) => (
      Math.hypot(candidate.dx - window.dx, candidate.dy - window.dy, candidate.dz - window.dz) <= 0.8
      && yawDistance(candidate.rotationY, window.rotationY) <= Math.PI / 18
    ));
    check(
      aperture !== undefined,
      `${owner}: ${window.tag} (${window.assetId}) has no aligned wall_*_window aperture`,
    );
  }
}

const TOP_FINISH_TAG = /^(?:v_)?(?:crown_|merlon_)/;
const FLAT_COPING_ASSETS = new Set(["kerb_straight", "wall_bottom_trim"]);

function checkGatehouseTopFinish(owner: string, parts: readonly PartPlacement[]): void {
  const finish = parts.filter((part) => (
    (TOP_FINISH_TAG.test(part.tag) || (part.tag === "roof" && part.assetId.startsWith("roof_")))
    && !FLAT_COPING_ASSETS.has(part.assetId)
  ));
  check(
    finish.length > 0,
    `${owner}: gatehouse has no explicit top finish beyond flat coping `
      + `(expected a fitted roof or crown_*/merlon_* finish)`,
  );
}

/** Reconstruct the source PlacedRoof facts from the emitted roof and the kit's measured profile. */
function placedRoof(parts: readonly PartPlacement[], kit: BuildingKit): RoofFacts | null {
  const roof = parts.find((part) => part.tag === "roof");
  if (roof === undefined) return null;
  const isSmall = roof.assetId === kit.roofSmall;
  const isLarge = roof.assetId === kit.roofLarge;
  if (!isSmall && !isLarge) return null;

  const asset = byId.get(roof.assetId);
  if (asset === undefined) return null;
  const apex = (isSmall ? kit.roofSmallApex : kit.roofLargeApex) * roof.scale;
  const drop = (isSmall ? kit.roofSmallDrop : kit.roofLargeDrop) * roof.scale;
  const alongZ = Math.abs(Math.sin(roof.rotationY)) < 0.5;
  return {
    baseY: roof.dy,
    apex,
    drop,
    // The roof asset's local X is across the ridge. This is the same fact used by placeRoof().
    acrossHalf: (asset.size.x * roof.scale) / 2,
    alongHalf: ((alongZ ? asset.size.z : asset.size.x) * roof.scale) / 2,
    alongZ,
  };
}

/** Height of the actual triangular roof silhouette at a cross-ridge offset. */
function roofSurfaceY(roof: RoofFacts, cross: number): number | null {
  if (roof.acrossHalf <= 0 || Math.abs(cross) > roof.acrossHalf + 1e-6) return null;
  return roof.baseY + roof.apex
    - (roof.apex + roof.drop) * (Math.abs(cross) / roof.acrossHalf);
}

function crossRange(box: Box, alongZ: boolean): [number, number] {
  return alongZ ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
}

function alongRange(box: Box, alongZ: boolean): [number, number] {
  return alongZ ? [box.minZ, box.maxZ] : [box.minX, box.maxX];
}

/**
 * Gables are solid triangles, so their AABB would report false intersections at the two upper
 * corners. Sample their measured triangular top edge against the sloped roof instead.
 */
function gablePenetration(part: PartPlacement, box: Box, roof: RoofFacts): number | null {
  const asset = byId.get(part.assetId);
  if (asset === undefined) return null;
  const [alongMin, alongMax] = alongRange(box, roof.alongZ);
  if (alongMax < -roof.alongHalf - 0.05 || alongMin > roof.alongHalf + 0.05) return null;

  const centreCross = roof.alongZ ? part.dx : part.dz;
  const axes = part.scaleAxes ?? [1, 1, 1];
  const gableHalf = (asset.size.x * part.scale * axes[0]) / 2;
  if (gableHalf <= 0) return null;
  const [crossMin, crossMax] = crossRange(box, roof.alongZ);
  const lo = Math.max(crossMin, -roof.acrossHalf);
  const hi = Math.min(crossMax, roof.acrossHalf);
  if (lo > hi) return null;

  const baseRel = asset.base.y * part.scale * axes[1];
  const topRel = (asset.base.y + asset.size.y) * part.scale * axes[1];
  let penetration = -Infinity;
  for (let index = 0; index <= 32; index += 1) {
    const cross = lo + ((hi - lo) * index) / 32;
    const surface = roofSurfaceY(roof, cross);
    if (surface === null) continue;
    const edgeFraction = Math.min(1, Math.abs(cross - centreCross) / gableHalf);
    const gableTop = part.dy + topRel - (topRel - baseRel) * edgeFraction;
    penetration = Math.max(penetration, gableTop - surface);
  }
  return Number.isFinite(penetration) ? penetration : null;
}

const ROOF_PROFILE_TOLERANCE = 0.09;

function checkRoofSilhouette(owner: string, parts: readonly PartPlacement[], kit: BuildingKit): void {
  const roof = placedRoof(parts, kit);
  if (owner.includes(" well[")) {
    for (const post of parts.filter((part) => /^post\d+$/.test(part.tag))) {
      check(
        post.scale <= 0.76 + 1e-6,
        `${owner}: ${post.tag} scale ${formatNumber(post.scale)} exceeds measured well-canopy clearance 0.7600`,
      );
    }
  }
  if (owner.includes(" shed[")) {
    const roofPart = parts.find((part) => part.tag === "roof");
    const minimum = 0.88 * (4 / kit.roofSmallCovers[0]);
    check(
      roofPart !== undefined && roofPart.scale >= minimum - 1e-6,
      `${owner}: compact shed roof scale ${formatNumber(roofPart?.scale ?? Number.NaN)} is below `
        + `the measured wall/corner clearance fit ${formatNumber(minimum)}`,
    );
  }
  const roofAdjacent = parts.filter((part) => (
    part.assetId === "roof_gable_brick"
    || /^(?:plate|eaves|roofline)/.test(part.tag)
    || part.assetId.startsWith("wall_")
    || part.assetId.startsWith("corner_")
  ));
  if (roofAdjacent.length === 0) return;
  if (roof === null) {
    // A tower roof or a flat well canopy is not a pitched kit roof. Only report inability when a
    // pitched-roof attachment is actually present; ordinary wall/corner bodies stay below it.
    const pitchedAttachment = roofAdjacent.some((part) => (
      part.assetId === "roof_gable_brick" || /^(?:plate|eaves|roofline)/.test(part.tag)
    ));
    check(!pitchedAttachment, `${owner}: cannot derive sloped roof facts for roof-adjacent parts`);
    return;
  }

  for (const part of roofAdjacent) {
    const box = placedBox(part);
    check(box !== null, `${owner}: ${part.tag} names unknown or invalid manifest asset ${part.assetId}`);
    if (box === null) continue;

    let penetration: number | null = null;
    if (part.assetId === "roof_gable_brick") {
      penetration = gablePenetration(part, box, roof);
    } else {
      const isEaves = /^(?:plate|eaves|roofline)/.test(part.tag);
      const isWallOrCorner = part.assetId.startsWith("wall_") || part.assetId.startsWith("corner_");
      // A manifest AABB cannot tell where a wall or corner mesh reaches its own maximum height,
      // so only test it here when that box rises above the roof pivot. Exact wall/tile triangle
      // clearance is covered by the shed fit invariant and browser capture.
      if (isEaves || (isWallOrCorner && box.maxY > roof.baseY + 0.035)) {
        const [alongMin, alongMax] = alongRange(box, roof.alongZ);
        if (alongMax < -roof.alongHalf - 0.05 || alongMin > roof.alongHalf + 0.05) continue;
        const [crossMin, crossMax] = crossRange(box, roof.alongZ);
        const lo = Math.max(crossMin, -roof.acrossHalf);
        const hi = Math.min(crossMax, roof.acrossHalf);
        if (lo > hi) continue;
        const surface = roofSurfaceY(roof, Math.max(Math.abs(lo), Math.abs(hi)));
        if (surface !== null) penetration = box.maxY - surface;
      }
    }

    if (penetration !== null) {
      check(
        penetration <= ROOF_PROFILE_TOLERANCE,
        `${owner}: ${part.tag} (${part.assetId}) pierces sloped roof silhouette by `
          + `${formatNumber(penetration)} m (profile tolerance ${ROOF_PROFILE_TOLERANCE.toFixed(2)} m)`,
      );
    }
  }
}

function reportBannerHooks(owner: string, parts: readonly PartPlacement[]): void {
  for (const part of parts.filter((candidate) => candidate.assetId.startsWith("banner"))) {
    const asset = byId.get(part.assetId);
    const axis = asset?.orientationAxis;
    console.log(
      `    banner hook ${part.tag}: asset=${part.assetId} yaw=${formatNumber(part.rotationY)} `
        + `assetAxis=${axis ?? "unavailable (not asserted)"}`,
    );
  }
}

function checkBannerDensity(
  owner: string,
  prefab: PrefabId,
  footprint: readonly [number, number],
  parts: readonly PartPlacement[],
): void {
  const banners = parts.filter((part) => part.assetId === "banner_1" || part.assetId === "banner_2");
  check(banners.length <= 2, `${owner}: emits ${banners.length} banners; structures are capped at two`);
  if (footprint[0] < 6) {
    check(banners.length <= 1, `${owner}: ${footprint[0]} m facade emits a banner pair`);
  }
  if ((prefab === "porch" || prefab === "arcade" || prefab === "townhouse") && footprint[0] < 8) {
    check(banners.length <= 1, `${owner}: ordinary ${footprint[0]} m ${prefab} emits a banner pair`);
  }
}

function checkManifestParts(owner: string, parts: readonly PartPlacement[]): void {
  const tags = new Set<string>();
  for (const part of parts) {
    check(!tags.has(part.tag), `${owner}: duplicate placement tag ${part.tag}`);
    tags.add(part.tag);
    check(byId.has(part.assetId), `${owner}: ${part.tag} names unknown manifest asset ${part.assetId}`);
    check(
      [part.dx, part.dy, part.dz, part.rotationY, part.scale].every(Number.isFinite) && part.scale > 0,
      `${owner}: ${part.tag} has a non-finite or non-positive placement`,
    );
    check(
      part.scaleAxes === undefined
        || (part.scaleAxes.every(Number.isFinite) && part.scaleAxes.every((axis) => axis > 0)),
      `${owner}: ${part.tag} has invalid per-axis scale`,
    );
  }
}

function recipeSamples(
  owner: string,
  prefab: PrefabId,
  footprint: readonly [number, number],
  kitId: KitId,
  buildingSeed: number,
): RecipeSample[] {
  const kit = BUILDING_KITS[kitId];
  const count = structureVariantCount(prefab, footprint, kit);
  if (count === 0) return [{ id: "classic", seed: buildingSeed }];

  const samples: RecipeSample[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const id = selectedStructureVariantId(prefab, footprint, index, kit);
    check(id !== undefined, `${owner}: compatible recipe index ${index} has no selected id`);
    const sampleId = id ?? `recipe-${index}`;
    check(!ids.has(sampleId), `${owner}: compatible recipe id ${sampleId} selected more than once`);
    ids.add(sampleId);
    samples.push({ id: sampleId, seed: index });
  }
  return samples;
}

function wallSignature(parts: readonly PartPlacement[]): string[] {
  return parts.map((part) => (
    `${part.tag}|${part.assetId}|${part.dx}|${part.dy}|${part.dz}|${part.rotationY}|${part.scale}`
  )).sort();
}

const WALL_SEEDS = [0, 1, 0x12345678, 0x9abcdef0, 0xdeadbeef] as const;

function checkWallSeedStability(region: RegionDef, run: WallRunDef, kitId: KitId): void {
  const kit = BUILDING_KITS[kitId];
  const length = spotDistance(run.from, run.to);
  const openings = run.openings ?? [];
  const owner = `${region.id}/${run.id} wall-run kit=${kitId}`;
  console.log(
    `  wall ${region.id}/${run.id}: length=${length.toFixed(2)} m `
      + `openings=${openings.length} seeds=${WALL_SEEDS.join(",")}`,
  );

  const baseline = wallSignature(buildWallRun(length, openings, kit, WALL_SEEDS[0]));
  for (const seed of WALL_SEEDS.slice(1)) {
    const candidate = wallSignature(buildWallRun(length, openings, kit, seed));
    if (candidate.length === baseline.length && candidate.every((entry, index) => entry === baseline[index])) {
      continue;
    }
    const baselineByTag = new Map(baseline.map((entry) => [entry.split("|", 1)[0], entry]));
    const candidateByTag = new Map(candidate.map((entry) => [entry.split("|", 1)[0], entry]));
    const changedTags = new Set<string>();
    for (const tag of new Set([...baselineByTag.keys(), ...candidateByTag.keys()])) {
      if (baselineByTag.get(tag) !== candidateByTag.get(tag)) changedTags.add(tag);
    }
    check(
      false,
      `${owner}: seed ${seed} changes facade/trim/cadence placements `
        + `(stable tags changed: ${[...changedTags].sort().join(", ") || "unknown"})`,
    );
  }
}

function auditBuilding(
  region: RegionDef,
  building: {
    id: string;
    prefab: PrefabId;
    footprint: readonly [number, number];
  },
  kitId: KitId,
): void {
  const ownerBase = `${region.id}/${building.id} ${building.prefab}[${building.footprint.join("x")}] kit=${kitId}`;
  const samples = recipeSamples(ownerBase, building.prefab, building.footprint, kitId, variantSeed(building.id));
  console.log(`  building ${ownerBase}: recipes=${samples.map((sample) => sample.id).join(", ")}`);

  for (const sample of samples) {
    const owner = `${ownerBase} recipe=${sample.id}`;
    let parts: PartPlacement[];
    try {
      parts = buildPrefab(building.prefab, building.footprint, sample.seed, kitId);
    } catch (error) {
      check(false, `${owner}: build failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    checkManifestParts(owner, parts);
    checkShutterCompanions(owner, parts);
    checkWindowApertures(owner, parts);
    checkBannerDensity(owner, building.prefab, building.footprint, parts);
    if (building.prefab === "gatehouse") checkGatehouseTopFinish(owner, parts);
    checkRoofSilhouette(owner, parts, BUILDING_KITS[kitId]);
    reportBannerHooks(owner, parts);
  }
}

console.log("Corealm structure visual contracts");
let authoredBuildings = 0;
let sampledRecipes = 0;
let authoredWallRuns = 0;

for (const region of REGIONS) {
  const settlement = region.settlement;
  console.log(`\n== ${region.id}/${settlement.id} kit=${settlement.kit} ==`);
  for (const building of settlement.buildings) {
    authoredBuildings += 1;
    const samples = recipeSamples(
      `${region.id}/${building.id}`,
      building.prefab,
      building.footprint,
      settlement.kit,
      variantSeed(building.id),
    );
    sampledRecipes += samples.length;
    auditBuilding(region, building, settlement.kit);
  }
  for (const run of settlement.walls ?? []) {
    authoredWallRuns += 1;
    checkWallSeedStability(region, run, settlement.kit);
  }
}

console.log(
  `\nAudited ${authoredBuildings} authored buildings, ${sampledRecipes} compatible recipe samples, `
    + `${authoredWallRuns} wall runs.`,
);
if (failures.length === 0) {
  console.log("PASS: all structure visual contracts hold.");
} else {
  console.error(`FAIL: ${failures.length} contract violation(s).`);
  for (const failure of failures) console.error(`  - ${failure}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;
