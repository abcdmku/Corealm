/**
 * Structure FORM audit: is each assembled structure a well-made solid, or a pile of parts?
 *
 * `bld-geometry.ts` answers "can you see through it" and `structure-visual-contracts.ts` answers
 * "did a recipe break an invariant". Neither can see the defects a player reports as "non-manifold
 * edges", "2-D buildings", or "walls poking through the roof", because all three are questions
 * about where a part's real triangles sit relative to the parts around it.
 *
 * This loads the real GLB triangles for every part of every assembled prefab and composition and
 * reports four failures:
 *
 *   PIERCE    a part's geometry stands proud of the roof surface that is supposed to cover it
 *   FLOAT     a part hangs with nothing under it, from the ground up
 *   ORPHAN    a part touches nothing else in the structure
 *   CARD      a part is a plane on edge: it reads as a 2-D card from any oblique view
 *
 *   npx tsx runs/corealm/audit/sp/form.ts [--json out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import {
  BUILDING_KITS, COMPOSITION_IDS, KIT_IDS, buildComposition, buildPrefab, buildWallRun, variantSeed,
  type KitId, type PartPlacement, type PrefabId,
} from "../../../../game/src/render/buildings.js";
import { REGIONS } from "../../../../game/src/content/regions.js";
import { structureVariantCount } from "../../../../game/src/render/structures/catalog.js";

interface ManifestAsset { id: string; file: string; size: { x: number; y: number; z: number } }
const manifest = JSON.parse(
  readFileSync("game/public/assets/manifest.json", "utf8"),
) as { assets: ManifestAsset[] };
const assetById = new Map(manifest.assets.map((a) => [a.id, a]));

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
type Vec = [number, number, number];
type Tri = readonly [Vec, Vec, Vec];
const triCache = new Map<string, Tri[]>();

function mul(m: readonly number[], v: readonly number[]): Vec {
  return [
    m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
    m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
    m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
  ];
}

async function trianglesOf(assetId: string): Promise<Tri[]> {
  const cached = triCache.get(assetId);
  if (cached) return cached;
  const src = assetById.get(assetId);
  if (src === undefined) throw new Error(`asset ${assetId} is not in the manifest`);
  const doc = await io.read(`game/public/assets/${src.file}`);
  const tris: Tri[] = [];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const world = node.getWorldMatrix() as unknown as number[];
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const indices = prim.getIndices();
        const count = indices ? indices.getCount() : pos.getCount();
        const el = [0, 0, 0];
        const at = (i: number): Vec => {
          pos.getElement(indices ? indices.getScalar(i) : i, el);
          return mul(world, el);
        };
        for (let i = 0; i + 2 < count; i += 3) tris.push([at(i), at(i + 1), at(i + 2)]);
      }
    });
  }
  triCache.set(assetId, tris);
  return tris;
}

function placed(part: PartPlacement, tris: readonly Tri[]): Tri[] {
  const cos = Math.cos(part.rotationY);
  const sin = Math.sin(part.rotationY);
  const s = part.scale;
  const ax = (part.scaleAxes?.[0] ?? 1) * s;
  const ay = (part.scaleAxes?.[1] ?? 1) * s;
  const az = (part.scaleAxes?.[2] ?? 1) * s;
  const map = (p: Vec): Vec => {
    const x = p[0] * ax;
    const y = p[1] * ay;
    const z = p[2] * az;
    return [part.dx + x * cos + z * sin, part.dy + y, part.dz - x * sin + z * cos];
  };
  return tris.map((t) => [map(t[0]), map(t[1]), map(t[2])] as Tri);
}

interface Box { min: Vec; max: Vec }
function boxOf(tris: readonly Tri[]): Box {
  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const p of t) {
      for (let a = 0; a < 3; a += 1) {
        if (p[a]! < min[a]!) min[a] = p[a]!;
        if (p[a]! > max[a]!) max[a] = p[a]!;
      }
    }
  }
  return { min, max };
}

function overlaps(a: Box, b: Box, pad: number): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (a.min[i]! - pad > b.max[i]! || b.min[i]! - pad > a.max[i]!) return false;
  }
  return true;
}

/**
 * A 1 m XZ bucket grid over a triangle soup, so a downward ray tests a few dozen triangles rather
 * than the whole roof. A `roof_tiles_6x12` is 4,000 triangles and a building has 20,000 vertices to
 * test against it; without this the audit is quadratic and takes minutes per structure.
 */
class TriGrid {
  private readonly cells = new Map<string, Tri[]>();

  constructor(tris: readonly Tri[]) {
    for (const t of tris) {
      const x0 = Math.floor(Math.min(t[0][0], t[1][0], t[2][0]));
      const x1 = Math.floor(Math.max(t[0][0], t[1][0], t[2][0]));
      const z0 = Math.floor(Math.min(t[0][2], t[1][2], t[2][2]));
      const z1 = Math.floor(Math.max(t[0][2], t[1][2], t[2][2]));
      for (let x = x0; x <= x1; x += 1) {
        for (let z = z0; z <= z1; z += 1) {
          const key = `${x},${z}`;
          const cell = this.cells.get(key);
          if (cell) cell.push(t);
          else this.cells.set(key, [t]);
        }
      }
    }
  }

  at(x: number, z: number): readonly Tri[] {
    return this.cells.get(`${Math.floor(x)},${Math.floor(z)}`) ?? EMPTY_TRIS;
  }

  /** Every triangle in the grid; the axis-parallel ray test has no useful XZ bucket. */
  all(): readonly Tri[] {
    if (this.flat === null) this.flat = [...new Set([...this.cells.values()].flat())];
    return this.flat;
  }

  /** Triangles whose bounds could contain the infinite line (axis, u, y). */
  column(u: number, y: number, axis: 0 | 2): readonly Tri[] {
    const other = axis === 0 ? 2 : 0;
    return this.all().filter((t) => {
      const lo = Math.min(t[0][other]!, t[1][other]!, t[2][other]!);
      const hi = Math.max(t[0][other]!, t[1][other]!, t[2][other]!);
      if (u < lo || u > hi) return false;
      const yLo = Math.min(t[0][1]!, t[1][1]!, t[2][1]!);
      const yHi = Math.max(t[0][1]!, t[1][1]!, t[2][1]!);
      return y >= yLo && y <= yHi;
    });
  }

  private flat: Tri[] | null = null;
}

/** Does the infinite line at (other-axis = u, y = y) pass through this triangle? */
function crossesLine(t: Tri, axis: 0 | 2, u: number, y: number): boolean {
  const a = axis === 0 ? 2 : 0;
  const x0 = t[0][a]!;
  const y0 = t[0][1]!;
  const x1 = t[1][a]!;
  const y1 = t[1][1]!;
  const x2 = t[2][a]!;
  const y2 = t[2][1]!;
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(d) < 1e-12) return false;
  const l0 = ((y1 - y2) * (u - x2) + (x2 - x1) * (y - y2)) / d;
  const l1 = ((y2 - y0) * (u - x2) + (x0 - x2) * (y - y2)) / d;
  const l2 = 1 - l0 - l1;
  return l0 >= 0 && l1 >= 0 && l2 >= 0;
}

const EMPTY_TRIS: readonly Tri[] = [];

/** Highest point of `tris` directly above (x, z), or null when the ray misses every triangle. */
function surfaceAt(tris: readonly Tri[], x: number, z: number): number | null {
  let best: number | null = null;
  for (const t of tris) {
    const [a, b, c] = t;
    const d = (b[2]! - c[2]!) * (a[0]! - c[0]!) + (c[0]! - b[0]!) * (a[2]! - c[2]!);
    if (Math.abs(d) < 1e-12) continue;
    const l0 = ((b[2]! - c[2]!) * (x - c[0]!) + (c[0]! - b[0]!) * (z - c[2]!)) / d;
    const l1 = ((c[2]! - a[2]!) * (x - c[0]!) + (a[0]! - c[0]!) * (z - c[2]!)) / d;
    const l2 = 1 - l0 - l1;
    if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
    const y = l0 * a[1]! + l1 * b[1]! + l2 * c[1]!;
    if (best === null || y > best) best = y;
  }
  return best;
}

interface PartGeometry {
  part: PartPlacement;
  tris: Tri[];
  box: Box;
}

// A ridge log, chimney, dormer, spire or finial is SUPPOSED to break the roof plane.
const ROOF_FURNITURE = /^(chimney|roof_log|roof_dormer|roof_tower|roof_tiles|roof_gable|banner|lamp|torch|vine|plant_|flower)/;
const ROOF_TILE = /^roof_tiles_/;
// Hanging, mounted or bracketed dressing has no footing by design.
const AIRBORNE = /^(banner|lamp_wall|torch|vine|chain|rope|mushroom|window_|door_|support_beam|roof_|overhang_|balcony_|floor_|wall_bottom_trim|kerb_)/;
/** Assets whose thinnest axis is a real, intended plane: trim courses, paving, cloth, glass. */
const PLANAR_BY_DESIGN = /^(floor_|kerb_|banner|chain_coil|rope_coil|fence_|balcony_|vine|wall_bottom_trim)/;
/**
 * Parts that have to be part of a construction.
 *
 * Loose dressing is SUPPOSED to stand on its own: a barrel two metres from a wall is a barrel, not
 * a detached building. Running the orphan test over everything reported 286 findings, 270 of which
 * were crates, sacks, rubble and flowers doing exactly what they were authored to do.
 */
const STRUCTURAL = /^(wall_|corner_|roof_|door_|overhang_|floor_|stairs_|balcony_|support_beam|kerb_|chimney|window_)/;

interface Finding {
  kind: "PIERCE" | "GAP" | "FLOAT" | "ORPHAN" | "CARD";
  subject: string;
  tag: string;
  assetId: string;
  metres: number;
  note: string;
}

const findings: Finding[] = [];

async function geometryFor(parts: readonly PartPlacement[]): Promise<PartGeometry[]> {
  const out: PartGeometry[] = [];
  for (const part of parts) {
    const tris = placed(part, await trianglesOf(part.assetId));
    out.push({ part, tris, box: boxOf(tris) });
  }
  return out;
}

function auditPierce(subject: string, geo: readonly PartGeometry[], grid: TriGrid | null, roofBox: Box | null): void {
  if (!grid || !roofBox) return;
  for (const g of geo) {
    if (ROOF_FURNITURE.test(g.part.assetId)) continue;
    let worst = 0;
    let where = "";
    for (const t of g.tris) {
      for (const p of t) {
        if (p[0]! < roofBox.min[0]! || p[0]! > roofBox.max[0]!) continue;
        if (p[2]! < roofBox.min[2]! || p[2]! > roofBox.max[2]!) continue;
        const roofY = surfaceAt(grid.at(p[0]!, p[2]!), p[0]!, p[2]!);
        if (roofY === null) continue;
        const over = p[1]! - roofY;
        if (over > worst) { worst = over; where = `${p[0]!.toFixed(2)},${p[2]!.toFixed(2)}`; }
      }
    }
    if (worst > 0.02) {
      findings.push({
        kind: "PIERCE", subject, tag: g.part.tag, assetId: g.part.assetId,
        metres: worst, note: `stands ${worst.toFixed(3)} m proud of the tiles at (${where})`,
      });
    }
  }
}

function auditGable(subject: string, geo: readonly PartGeometry[], grid: TriGrid | null): void {
  if (!grid) return;
  for (const g of geo) {
    if (g.part.assetId !== "roof_gable_brick") continue;
    let worst = 0;
    let outside = 0;
    for (const t of g.tris) {
      for (const p of t) {
        const roofY = surfaceAt(grid.at(p[0]!, p[2]!), p[0]!, p[2]!);
        // Outside the roof's own XZ shadow entirely: the gable sticks out past the tiles.
        if (roofY === null) { outside += 1; continue; }
        worst = Math.max(worst, p[1]! - roofY);
      }
    }
    if (worst > 0.02 || outside > 0) {
      findings.push({
        kind: "PIERCE", subject, tag: g.part.tag, assetId: g.part.assetId,
        metres: Math.max(worst, outside > 0 ? 0.001 : 0),
        note: outside > 0
          ? `${outside} gable vertices sit outside the roof outline; worst proud ${worst.toFixed(3)} m`
          : `gable stands ${worst.toFixed(3)} m proud of the tiles`,
      });
    }
  }
}

function auditFloat(subject: string, geo: readonly PartGeometry[]): void {
  for (const [index, g] of geo.entries()) {
    if (AIRBORNE.test(g.part.assetId)) continue;
    const bottom = g.box.min[1]!;
    if (bottom <= 0.12) continue;
    // Anything whose own solid overlaps the column below it counts as supported.
    const column: Box = {
      min: [g.box.min[0]! + 0.05, -0.5, g.box.min[2]! + 0.05],
      max: [g.box.max[0]! - 0.05, bottom - 0.02, g.box.max[2]! - 0.05],
    };
    // ...and so does anything it is fixed TO: a lintel spanning two piers and a grille set in a
    // window both have open air underneath and are held up at the side, which is what a building
    // is. Only a part with nothing below it AND nothing beside it reaching lower is floating.
    const supported = geo.some((other, otherIndex) => otherIndex !== index && (
      overlaps(other.box, column, 0)
      || (other.box.min[1]! < bottom - 0.05 && overlaps(other.box, g.box, 0.12))
    ));
    if (!supported) {
      findings.push({
        kind: "FLOAT", subject, tag: g.part.tag, assetId: g.part.assetId,
        metres: bottom, note: `hangs with ${bottom.toFixed(2)} m of daylight under it`,
      });
    }
  }
}

function auditOrphan(subject: string, geo: readonly PartGeometry[]): void {
  if (geo.length < 2) return;
  for (const [index, g] of geo.entries()) {
    if (!STRUCTURAL.test(g.part.assetId)) continue;
    const touches = geo.some((other, otherIndex) => otherIndex !== index && overlaps(g.box, other.box, 0.12));
    if (touches) continue;
    let gap = Infinity;
    for (const [otherIndex, other] of geo.entries()) {
      if (otherIndex === index) continue;
      let d = 0;
      for (let a = 0; a < 3; a += 1) {
        d += Math.max(0, Math.max(g.box.min[a]! - other.box.max[a]!, other.box.min[a]! - g.box.max[a]!)) ** 2;
      }
      gap = Math.min(gap, Math.sqrt(d));
    }
    findings.push({
      kind: "ORPHAN", subject, tag: g.part.tag, assetId: g.part.assetId,
      metres: gap, note: `nearest other part is ${gap.toFixed(2)} m away`,
    });
  }
}

function auditCard(subject: string, geo: readonly PartGeometry[]): void {
  for (const g of geo) {
    if (PLANAR_BY_DESIGN.test(g.part.assetId)) continue;
    const sx = g.box.max[0]! - g.box.min[0]!;
    const sy = g.box.max[1]! - g.box.min[1]!;
    const sz = g.box.max[2]! - g.box.min[2]!;
    const thin = Math.min(sx, sz);
    const wide = Math.max(sx, sz);
    // A standing plane: tall and wide, but with under 12 cm of body, and nothing bracing it.
    if (sy < 1.2 || thin > 0.12 || wide < 1) continue;
    let braced = false;
    for (const other of geo) {
      if (other === g || PLANAR_BY_DESIGN.test(other.part.assetId)) continue;
      const otherThin = Math.min(
        other.box.max[0]! - other.box.min[0]!,
        other.box.max[2]! - other.box.min[2]!,
      );
      if (otherThin > 0.2 && overlaps(g.box, other.box, 0.05)) { braced = true; break; }
    }
    if (braced) continue;
    findings.push({
      kind: "CARD", subject, tag: g.part.tag, assetId: g.part.assetId,
      metres: thin, note: `${wide.toFixed(2)} x ${sy.toFixed(2)} m plane only ${thin.toFixed(3)} m thick, unbraced`,
    });
  }
}

/**
 * Daylight through a gable end: rays along the ridge axis that cross nothing.
 *
 * `gableEnds` exists because a `roof_tiles_*` is an open-ended prism, and shrinking a gable to keep
 * it under the tiles can reopen exactly the hole it was added to close. This fires a grid of rays
 * down the ridge axis through the triangle between the wall head and the tile surface and counts
 * the ones that pass clean through the whole structure.
 */
function auditGableGap(subject: string, geo: readonly PartGeometry[], grid: TriGrid | null): void {
  if (!grid) return;
  const gables = geo.filter((g) => g.part.assetId === "roof_gable_brick");
  if (gables.length === 0) return;
  const all: Tri[] = [];
  for (const g of geo) all.push(...g.tris);
  const solid = new TriGrid(all);

  for (const g of gables) {
    // The gable's own plane: whichever horizontal axis its placement is offset along.
    const alongX = Math.abs(g.part.dx) > Math.abs(g.part.dz);
    const plane = alongX ? g.part.dx : g.part.dz;
    const half = (alongX ? g.box.max[2]! - g.box.min[2]! : g.box.max[0]! - g.box.min[0]!) / 2;
    const baseY = g.box.min[1]!;
    const topY = g.box.max[1]!;
    let open = 0;
    let total = 0;
    for (let i = 0; i < 24; i += 1) {
      const across = (-1 + 2 * ((i + 0.5) / 24)) * half * 1.05;
      const x = alongX ? plane : across;
      const z = alongX ? across : plane;
      const roofY = surfaceAt(grid.at(x, z), x, z);
      if (roofY === null) continue;
      for (let j = 0; j < 16; j += 1) {
        const y = baseY + ((j + 0.5) / 16) * (topY - baseY);
        if (y > roofY) continue;
        total += 1;
        // Count crossings of the whole structure on the line through (x, y) along the ridge axis.
        let hits = 0;
        const cell = alongX ? solid.column(z, y, 0) : solid.column(x, y, 2);
        for (const t of cell) if (crossesLine(t, alongX ? 0 : 2, alongX ? z : x, y)) hits += 1;
        if (hits < 1) open += 1;
      }
    }
    if (total > 0 && open / total > 0.04) {
      findings.push({
        kind: "GAP", subject, tag: g.part.tag, assetId: g.part.assetId,
        metres: open / total,
        note: `${((open / total) * 100).toFixed(1)}% of the gable end is see-through (${open}/${total} rays)`,
      });
    }
  }
}

async function auditParts(subject: string, parts: readonly PartPlacement[]): Promise<void> {
  const geo = await geometryFor(parts);
  const roofTris: Tri[] = [];
  for (const g of geo) if (ROOF_TILE.test(g.part.assetId)) roofTris.push(...g.tris);
  const grid = roofTris.length === 0 ? null : new TriGrid(roofTris);
  const roofBox = roofTris.length === 0 ? null : boxOf(roofTris);
  auditPierce(subject, geo, grid, roofBox);
  auditGable(subject, geo, grid);
  auditGableGap(subject, geo, grid);
  auditFloat(subject, geo);
  auditOrphan(subject, geo);
  auditCard(subject, geo);
}

// -------------------------------------------------------------------- probes

interface Probe { prefab: PrefabId; footprint: [number, number]; kit: KitId; label: string }

const probes: Probe[] = [];
const seen = new Set<string>();
for (const region of REGIONS) {
  const kit = region.settlement.kit;
  for (const building of region.settlement.buildings) {
    const key = `${building.prefab}|${building.footprint.join("x")}|${kit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    probes.push({
      prefab: building.prefab as PrefabId,
      footprint: [building.footprint[0], building.footprint[1]],
      kit,
      label: `${building.prefab}[${building.footprint.join("x")}] ${kit}`,
    });
  }
}
// Prefabs no settlement authors yet still ship, so keep the table total.
const extras: { prefab: PrefabId; footprint: [number, number] }[] = [
  { prefab: "farmstead", footprint: [10, 6] },
  { prefab: "ruin", footprint: [6, 4] },
  { prefab: "stall", footprint: [3, 2] },
  { prefab: "market_row", footprint: [9, 3] },
  { prefab: "wall_segment", footprint: [8, 1] },
];
for (const extra of extras) {
  for (const kit of KIT_IDS) {
    probes.push({ ...extra, kit, label: `${extra.prefab}[${extra.footprint.join("x")}] ${kit}` });
  }
}

for (const probe of probes) {
  const kit = BUILDING_KITS[probe.kit];
  const variants = Math.max(1, structureVariantCount(probe.prefab, probe.footprint, kit));
  for (let index = 0; index < variants; index += 1) {
    const parts = buildPrefab(probe.prefab, probe.footprint, index, probe.kit);
    await auditParts(`${probe.label} v${index}`, parts);
  }
}

/**
 * The hero mesh each composition is authored around.
 *
 * `buildComposition` deliberately does NOT emit it - the world owns the landmark or portal entity -
 * so an audit that only sees the composition sees a crane jib hanging 5.7 m from anything, when in
 * the game it is bolted to a 9.6 m mast. Read the real hero off the content layer.
 */
interface Hero { assetId: string; scale: number }
/** Keyed by `composition|kit`: one composition can wear a different hero in each vernacular. */
const HERO_BY_COMPOSITION = new Map<string, Hero>();
const heroKey = (composition: string, kit: KitId): string => `${composition}|${kit}`;
for (const region of REGIONS) {
  const kit = region.settlement.kit;
  const put = (composition: string | undefined, hero: Hero): void => {
    if (composition && !HERO_BY_COMPOSITION.has(heroKey(composition, kit))) {
      HERO_BY_COMPOSITION.set(heroKey(composition, kit), hero);
    }
  };
  for (const landmark of region.landmarks) {
    put(landmark.composition, { assetId: landmark.assetId, scale: landmark.scale ?? 1 });
  }
  for (const gate of region.gates) put(gate.composition, { assetId: gate.assetId, scale: 1.4 });
  // Agility shortcuts carry the root tunnel and canopy walk trailheads.
  for (const obstacle of region.obstacles) {
    put(obstacle.composition, { assetId: obstacle.assetId, scale: obstacle.scale ?? 1 });
  }
  const dungeon = region.dungeon;
  if (dungeon) {
    put(dungeon.entranceComposition, {
      assetId: dungeon.entranceAssetId, scale: dungeon.entranceScale ?? 1,
    });
    // The chamber-side portal is built in `world/regionBuilder.ts`, not authored in content.
    put("gravelmaw_exit", { assetId: "wall_brick_door", scale: 2.2 });
  }
}

for (const composition of COMPOSITION_IDS) {
  // A composition that dresses a hero is only ever built with that hero's own region kit, so
  // auditing `highcairn_crane` in the plaster vernacular measures a jib hanging off a mast that
  // does not exist there. Compositions with no hero - the settlement furniture - are used in all
  // three towns and are audited in all three.
  const owned = KIT_IDS.filter((kitId) => HERO_BY_COMPOSITION.has(heroKey(composition, kitId)));
  for (const kitId of owned.length > 0 ? owned : KIT_IDS) {
    const parts = [...buildComposition(composition, variantSeed(`${composition}_${kitId}`), kitId)];
    const hero = HERO_BY_COMPOSITION.get(heroKey(composition, kitId));
    if (hero) {
      parts.unshift({
        tag: "hero", assetId: hero.assetId, dx: 0, dy: 0, dz: 0, rotationY: 0, scale: hero.scale,
      });
    }
    await auditParts(`composition ${composition} ${kitId}`, parts);
  }
}

for (const region of REGIONS) {
  for (const run of region.settlement.walls ?? []) {
    const length = Math.hypot(run.to[0] - run.from[0], run.to[1] - run.from[1]);
    const openings = (run.openings ?? []).map((opening) => ({ at: opening.at, width: opening.width }));
    const parts = buildWallRun(length, openings, BUILDING_KITS[region.settlement.kit], 0);
    await auditParts(`wall ${run.id}`, parts);
  }
}

// ------------------------------------------------------------------- report

const order: Finding["kind"][] = ["PIERCE", "GAP", "CARD", "FLOAT", "ORPHAN"];
findings.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.metres - a.metres);

const subjects = new Set(findings.map((finding) => finding.subject));

for (const kind of order) {
  const group = findings.filter((f) => f.kind === kind);
  console.log(`\n=== ${kind}: ${group.length}`);
  const collapsed = new Map<string, { count: number; worst: Finding }>();
  for (const finding of group) {
    const key = `${finding.subject.replace(/ v\d+$/, "")}|${finding.assetId}|${finding.tag.replace(/\d+/g, "#")}`;
    const entry = collapsed.get(key);
    if (!entry) collapsed.set(key, { count: 1, worst: finding });
    else {
      entry.count += 1;
      if (finding.metres > entry.worst.metres) entry.worst = finding;
    }
  }
  const rows = [...collapsed.values()].sort((a, b) => b.worst.metres - a.worst.metres);
  for (const row of rows.slice(0, 70)) {
    console.log(
      `  ${row.worst.subject.replace(/ v\d+$/, "").padEnd(32)} ${row.worst.tag.padEnd(18)}`
      + ` ${row.worst.assetId.padEnd(21)} x${String(row.count).padEnd(4)} ${row.worst.note}`,
    );
  }
  if (rows.length > 70) console.log(`  ... and ${rows.length - 70} more distinct rows`);
}

console.log(`\nTotal findings: ${findings.length} across ${subjects.size} structures.`);
const jsonFlag = process.argv.indexOf("--json");
if (jsonFlag >= 0 && process.argv[jsonFlag + 1]) {
  writeFileSync(process.argv[jsonFlag + 1]!, JSON.stringify(findings, null, 1));
}
