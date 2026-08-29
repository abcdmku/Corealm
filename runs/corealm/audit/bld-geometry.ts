/**
 * Ray-cast audit for render/buildings.ts: does the geometry a prefab emits actually ENCLOSE the
 * footprint, at every kit and at every footprint the three replacement layouts in
 * runs/corealm/diagnosis/settlement-layout-coldbrace-rootfall-hig.md specify?
 *
 * buildings-audit.ts checks arithmetic against manifest bounding boxes. A bounding box cannot see
 * the defect this script exists for: every `wall_*` asset is 2.000 x 3.123 x 0.406, and one of them
 * (`wall_plaster_timber`) is a frame with no infill above y 0.84. So this one loads the real GLB
 * triangles, assembles the prefab, and fires axis-parallel rays straight through the building. A
 * sample with fewer than two triangle crossings is a place a player can see the far side of the
 * world through the house.
 *
 *   npx tsx runs/corealm/audit/bld-geometry.ts
 */
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import {
  BUILDING_KITS, KIT_IDS, MODULE_METRES, ROOF_EAVE_BY_KIT, ROOF_EAVE_METRES, STOREY_METRES,
  buildPrefab, buildWallRun, roofOverhang, variantSeed,
  type PartPlacement, type PrefabId,
} from "../../../game/src/render/buildings.js";
import { tierSilhouetteScale } from "../../../game/src/core/math.js";

interface ManifestAsset { id: string; file: string }
const manifest = JSON.parse(
  readFileSync("game/public/assets/manifest.json", "utf8"),
) as { assets: ManifestAsset[] };
const srcById = new Map(manifest.assets.map((a) => [a.id, a.file]));

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
type Tri = readonly [number[], number[], number[]];
const triCache = new Map<string, Tri[]>();

function mul(m: Float32Array | number[], v: number[]): number[] {
  return [
    m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
    m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
    m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
  ];
}

async function trianglesOf(assetId: string): Promise<Tri[]> {
  const cached = triCache.get(assetId);
  if (cached) return cached;
  const src = srcById.get(assetId);
  if (src === undefined) throw new Error(`asset ${assetId} is not in the manifest`);
  const doc = await io.read(`game/public/assets/${src}`);
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
        const at = (i: number): number[] => {
          pos.getElement(indices ? indices.getScalar(i) : i, el);
          return mul(world, el);
        };
        for (let i = 0; i + 2 < count; i += 3) tris.push([at(i), at(i + 1), at(i + 2)] as Tri);
      }
    });
  }
  triCache.set(assetId, tris);
  return tris;
}

/** A part's triangles in the prefab's local frame: scale, then yaw, then offset. */
function placed(part: PartPlacement, tris: Tri[]): Tri[] {
  const cos = Math.cos(part.rotationY);
  const sin = Math.sin(part.rotationY);
  const s = part.scale;
  const map = (p: number[]): number[] => {
    const x = p[0]! * s;
    const y = p[1]! * s;
    const z = p[2]! * s;
    return [part.dx + x * cos + z * sin, part.dy + y, part.dz - x * sin + z * cos];
  };
  return tris.map((t) => [map(t[0]), map(t[1]), map(t[2])] as Tri);
}

/**
 * Crossings of an axis-parallel ray. `axis` 0 casts along X, axis 2 along Z; `u` is the offset on
 * the other horizontal axis. Counts every triangle the infinite line passes through, which is what
 * "how many surfaces stand between me and the far side" means.
 */
function crossings(tris: readonly Tri[], axis: 0 | 2, u: number, y: number): number {
  const a = axis === 0 ? 2 : 0;
  let hits = 0;
  for (const t of tris) {
    const x0 = t[0][a]!; const y0 = t[0][1]!;
    const x1 = t[1][a]!; const y1 = t[1][1]!;
    const x2 = t[2][a]!; const y2 = t[2][1]!;
    const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(d) < 1e-12) continue;
    const l0 = ((y1 - y2) * (u - x2) + (x2 - x1) * (y - y2)) / d;
    const l1 = ((y2 - y0) * (u - x2) + (x0 - x2) * (y - y2)) / d;
    const l2 = 1 - l0 - l1;
    if (l0 >= 0 && l1 >= 0 && l2 >= 0) hits += 1;
  }
  return hits;
}

const problems: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) problems.push(message);
}

/** Panels and posts only. A roof is not what stops you seeing through a wall. */
const ENCLOSING = /^(wall_|corner_|door_|overhang_)/;
const KIT_PANEL = /^wall_(plaster|brick)_/;

interface Probe { prefab: PrefabId; footprint: [number, number]; note: string }

/**
 * Every (prefab, footprint) the three replacement layouts author, plus the two that ship today.
 * Recommendations 4 (Coldbrace), 5 (Rootfall) and 6 (Highcairn) of the settlement diagnosis.
 */
const PROBES: Probe[] = [
  { prefab: "cottage", footprint: [6, 4], note: "every house in all three towns" },
  { prefab: "hall", footprint: [12, 6], note: "coldbrace_hall" },
  { prefab: "tower", footprint: [6, 6], note: "coldbrace_vault" },
  { prefab: "shed", footprint: [4, 4], note: "coldbrace_cookhouse, rootfall_shed" },
  { prefab: "quarry_hut", footprint: [5, 4], note: "highcairn huts 1-6" },
  { prefab: "forge", footprint: [6, 5], note: "the forge in all three towns" },
  { prefab: "forge", footprint: [4, 4], note: "coldbrace_workshed" },
  { prefab: "arcade", footprint: [6, 3], note: "highcairn_arcade, rootfall_sawpit" },
  { prefab: "porch", footprint: [4, 3], note: "the bank porch" },
  { prefab: "gatehouse", footprint: [8, 3], note: "every replacement gatehouse" },
  { prefab: "gatehouse", footprint: [6, 3], note: "the three gatehouses as shipped" },
  { prefab: "well", footprint: [2, 2], note: "the square's wellhead" },
  { prefab: "market_row", footprint: [9, 3], note: "a three-pitch row" },
  { prefab: "ruin", footprint: [6, 4], note: "region furniture" },
  { prefab: "stall", footprint: [3, 2], note: "region furniture" },
];

/**
 * Which casts each prefab has to survive.
 *
 * `x` is the cast through the two side walls, `z` the cast through the front and back. A `forge`
 * is open on +Z and a `porch` or `arcade` is a roof on posts with one back wall, so the Z cast is
 * the only one that means anything for those two - it is the check that the back wall the shop
 * counter stands against is really there. A gatehouse, a market row, a stall, a ruin and a
 * wellhead enclose nothing on purpose and are printed for the record only.
 */
const ENCLOSURE: Partial<Record<PrefabId, ("x" | "z")[]>> = {
  cottage: ["x", "z"], hall: ["x", "z"], tower: ["x", "z"], shed: ["x", "z"],
  quarry_hut: ["x", "z"], forge: ["x"], porch: ["z"], arcade: ["z"],
};

async function main(): Promise<void> {
  console.log("=== enclosure: fraction of the elevation you can see straight through");
  console.log("    axis-parallel rays through the assembled prefab, real GLB triangles\n");
  console.log("    prefab       footprint kit      throughX  throughZ  panels frames trims");

  for (const probe of PROBES) {
    for (const kitId of KIT_IDS) {
      const kit = BUILDING_KITS[kitId];
      const seed = variantSeed(`${probe.prefab}_${probe.footprint.join("x")}_${kitId}`);
      const parts = buildPrefab(probe.prefab, probe.footprint, seed, kitId);
      const tris: Tri[] = [];
      for (const part of parts) {
        if (!ENCLOSING.test(part.assetId)) continue;
        tris.push(...placed(part, await trianglesOf(part.assetId)));
      }
      const [w, d] = probe.footprint;
      // Sample the two cross-sections. Inset 0.15 m from the corners so a corner post's own
      // thickness is not counted as a side, and stop 0.15 m under the wall head.
      const fraction = (axis: 0 | 2): number => {
        const span = axis === 0 ? d : w;
        let open = 0;
        let total = 0;
        for (let i = 0; i < 40; i += 1) {
          const u = -span / 2 + 0.15 + ((i + 0.5) / 40) * (span - 0.3);
          for (let j = 0; j < 24; j += 1) {
            const y = 0.1 + ((j + 0.5) / 24) * (STOREY_METRES - 0.25);
            total += 1;
            if (crossings(tris, axis, u, y) < 2) open += 1;
          }
        }
        return open / total;
      };
      const openX = fraction(0);
      const openZ = fraction(2);
      const panels = parts.filter((p) => KIT_PANEL.test(p.assetId) && p.assetId !== kit.frame).length;
      const frames = parts.filter((p) => kit.frame !== null && p.assetId === kit.frame).length;
      const trims = parts.filter((p) => p.assetId === "wall_bottom_trim").length;
      console.log(`    ${(probe.prefab + " [" + w + "," + d + "]").padEnd(22)}`
        + `${kitId.padEnd(9)}${(openX * 100).toFixed(1).padStart(7)}%  ${(openZ * 100).toFixed(1).padStart(7)}%`
        + `${String(panels).padStart(8)}${String(frames).padStart(7)}${String(trims).padStart(6)}`);

      // A closed prefab may show a doorway and a window or two; past 8% of the elevation a wall is
      // simply not there.
      const limit = 0.08;
      for (const axis of ENCLOSURE[probe.prefab] ?? []) {
        const open = axis === "x" ? openX : openZ;
        check(open <= limit,
          `${probe.prefab}[${w},${d}]/${kitId}: ${(open * 100).toFixed(1)}%`
          + ` see-through across ${axis.toUpperCase()}`);
      }
      // Footing: one plinth per ground-level panel wherever there are ground-level panels.
      const groundPanels = parts.filter(
        (p) => KIT_PANEL.test(p.assetId) && p.dy === 0 && p.assetId !== kit.frame,
      ).length;
      if (groundPanels > 0 && probe.prefab !== "gatehouse") {
        check(trims >= groundPanels,
          `${probe.prefab}[${w},${d}]/${kitId}: ${groundPanels} ground panels but ${trims} plinths`);
      }
      // Half-timbering: one frame per solid panel in the kit that has one.
      if (kit.frame !== null && ENCLOSURE[probe.prefab] !== undefined) {
        const solid = parts.filter(
          (p) => p.assetId === kit.wall || p.assetId === kit.wallFeature,
        ).length;
        check(frames === solid,
          `${probe.prefab}[${w},${d}]/${kitId}: ${solid} solid panels but ${frames} frames`);
      }
      // No two parts at the same pose, and no duplicate tags.
      const seen = new Map<string, string>();
      const tags = new Set<string>();
      for (const part of parts) {
        check(!tags.has(part.tag), `${probe.prefab}[${w},${d}]/${kitId}: duplicate tag ${part.tag}`);
        tags.add(part.tag);
        const key = `${part.assetId}@${part.dx},${part.dy},${part.dz}/${part.rotationY}`;
        const clash = seen.get(key);
        check(clash === undefined,
          `${probe.prefab}[${w},${d}]/${kitId}: ${part.tag} shares a pose with ${clash ?? ""}`);
        seen.set(key, part.tag);
      }
    }
  }

  // ------------------------------------------------------------------ the gate

  console.log("\n=== gatehouse: what the passage is made of");
  for (const width of [6, 8, 10, 12]) {
    for (const kitId of KIT_IDS) {
      const kit = BUILDING_KITS[kitId];
      const parts = buildPrefab("gatehouse", [width, 3], 7, kitId);
      const aperture = parts.filter((p) => p.assetId === kit.wallWindow || p.assetId === kit.wallDoor);
      const piers = parts.filter((p) => p.tag.startsWith("p"));
      const head = parts.filter((p) => p.tag.startsWith("h"));
      const jambs = parts.filter((p) => p.tag.startsWith("c"));
      check(aperture.length === 0,
        `gatehouse ${width}/${kitId}: ${aperture.length} apertured panels`
        + ` (${aperture.map((p) => p.tag).join(",")})`);
      check(piers.every((p) => p.assetId === kit.gatePier),
        `gatehouse ${width}/${kitId}: a pier is not kit.gatePier`);
      check(head.every((p) => p.assetId === kit.gatePier),
        `gatehouse ${width}/${kitId}: a head panel is not kit.gatePier`);
      check(jambs.every((p) => p.assetId === kit.gateJamb),
        `gatehouse ${width}/${kitId}: a jamb is not kit.gateJamb`);
      if (kitId === "plaster") {
        console.log(`    width ${width}: ${piers.length} pier panels of ${kit.gatePier},`
          + ` ${head.length} head panels, ${jambs.length} ${kit.gateJamb} jambs,`
          + ` ${aperture.length} apertures`);
      }
    }
  }

  // ------------------------------------------------------------- the wall runs

  console.log("\n=== wall runs, as the three replacement layouts author them");
  interface RunProbe { id: string; length: number; openings: { at: number; width: number }[] }
  const RUNS: RunProbe[] = [
    { id: "coldbrace W", length: 52, openings: [{ at: 28, width: 8 }] },
    { id: "coldbrace N", length: 52, openings: [] },
    { id: "coldbrace E", length: 52, openings: [{ at: 24, width: 8 }] },
    { id: "coldbrace S", length: 52, openings: [{ at: 26, width: 8 }] },
    { id: "rootfall W", length: 42, openings: [{ at: 18, width: 8 }] },
    { id: "rootfall N", length: 34, openings: [{ at: 22, width: 6 }] },
    { id: "rootfall E", length: 42, openings: [{ at: 10, width: 4 }, { at: 34, width: 6 }] },
    { id: "rootfall S", length: 34, openings: [{ at: 18, width: 6 }] },
    { id: "highcairn S", length: 40, openings: [] },
    { id: "highcairn E", length: 26, openings: [{ at: 16, width: 8 }] },
    { id: "highcairn N", length: 40, openings: [] },
    { id: "highcairn W", length: 26, openings: [{ at: 10, width: 8 }] },
    { id: "opening at the very start", length: 42, openings: [{ at: 0, width: 4 }] },
    { id: "opening past the end", length: 42, openings: [{ at: 42, width: 4 }] },
    { id: "every module cut", length: 6, openings: [{ at: 3, width: 8 }] },
    { id: "off-grid length", length: 25, openings: [{ at: 12.5, width: 8 }] },
  ];
  for (const run of RUNS) {
    for (const kitId of KIT_IDS) {
      const kit = BUILDING_KITS[kitId];
      const parts = buildWallRun(run.length, run.openings, kit, variantSeed(run.id + kitId));
      const panels = parts.filter((p) => KIT_PANEL.test(p.assetId) && p.assetId !== kit.frame);
      const frames = parts.filter((p) => kit.frame !== null && p.assetId === kit.frame);
      const trims = parts.filter((p) => p.assetId === "wall_bottom_trim" && p.dy === 0);
      const posts = parts.filter((p) => p.assetId === kit.corner);
      check(panels.length === trims.length,
        `${run.id}/${kitId}: ${panels.length} panels but ${trims.length} plinths`);
      if (kit.frame !== null) {
        const solid = panels.filter((p) => p.assetId === kit.wall).length;
        check(frames.length === solid,
          `${run.id}/${kitId}: ${solid} solid panels but ${frames.length} frames`);
      }
      for (const part of parts) {
        check(part.dx >= -1e-6 && part.dx <= run.length + 1e-6,
          `${run.id}/${kitId}: part ${part.tag} at dx ${part.dx} leaves [0,${run.length}]`);
      }
      if (kitId === "plaster") {
        const built = panels.reduce((sum, p) => sum + p.scale * MODULE_METRES, 0);
        console.log(`    ${run.id.padEnd(26)} L=${String(run.length).padStart(3)}`
          + ` ${String(panels.length).padStart(2)} panels (${built.toFixed(1)} m of ${run.length} m),`
          + ` ${posts.length} posts`);
      }
    }
  }
  // A gatehouse standing in an opening needs its whole footprint clear, not just its arch: the
  // piers are part of the building. Anything narrower and the run's end module lands inside a pier.
  const gateOpenings: readonly (readonly [string, number, number])[] = [
    ["coldbrace S", 8, 8], ["rootfall N", 6, 8], ["rootfall E postern", 4, 8],
    ["rootfall S", 6, 8], ["highcairn E", 8, 8],
  ];
  console.log("\n=== for the settlement authors: openings that cannot hold their gatehouse");
  let narrow = 0;
  for (const [id, opening, gatehouseWidth] of gateOpenings) {
    if (opening >= gatehouseWidth) continue;
    narrow += 1;
    console.log(`    ${id}: a ${opening} m opening against a [${gatehouseWidth},3] gatehouse leaves`
      + ` ${((gatehouseWidth - opening) / 2).toFixed(1)} m of wall standing inside each pier`);
  }
  if (narrow === 0) console.log("    none");

  // ------------------------------------------------------------------- eaves

  console.log("\n=== roof overhang past the footprint, per axis, at the authored scale");
  const eaveProbes: readonly (readonly [PrefabId, readonly [number, number]])[] = [
    ["cottage", [6, 4]], ["hall", [12, 6]], ["tower", [6, 6]], ["shed", [4, 4]],
    ["quarry_hut", [5, 4]], ["forge", [6, 5]], ["forge", [4, 4]],
  ];
  for (const [prefab, footprint] of eaveProbes) {
    const row = KIT_IDS.map((kitId) => {
      const over = roofOverhang(prefab, footprint, kitId);
      return `${kitId} x${over.x.toFixed(3)} z${over.z.toFixed(3)}`;
    }).join("   ");
    console.log(`    ${(prefab + " [" + footprint[0] + "," + footprint[1] + "]").padEnd(20)}${row}`);
  }
  console.log(`    ROOF_EAVE_BY_KIT ${JSON.stringify(ROOF_EAVE_BY_KIT)}`
    + `  ROOF_EAVE_METRES ${ROOF_EAVE_METRES}`);
  for (const kitId of KIT_IDS) {
    check(ROOF_EAVE_BY_KIT[kitId] <= ROOF_EAVE_METRES + 1e-9,
      `ROOF_EAVE_METRES ${ROOF_EAVE_METRES} is under ${kitId}'s worst eave ${ROOF_EAVE_BY_KIT[kitId]}`);
  }

  // ------------------------------------------------- what the game actually draws

  console.log("\n=== the tier scale regionBuilder still cancels (not fixable in buildings.ts)");
  for (const [name, tier] of [["Coldbrace", 1], ["Rootfall", 5], ["Highcairn", 10]] as const) {
    const drawn = MODULE_METRES / tierSilhouetteScale(tier);
    console.log(`    ${name.padEnd(10)} tier ${String(tier).padStart(2)}:`
      + ` a ${MODULE_METRES} m module draws ${drawn.toFixed(3)} m,`
      + ` so two modules on 2 m centres leave ${(MODULE_METRES - drawn).toFixed(3)} m`);
  }

  console.log(`\n${problems.length === 0 ? "OK - no problems" : `${problems.length} PROBLEMS`}`);
  for (const problem of problems) console.log(`  ! ${problem}`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

await main();
