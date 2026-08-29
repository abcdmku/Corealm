import io

p = 'game/src/render/scene.ts'
s = io.open(p, encoding='utf-8').read()

anchor = """/** Vertical lift on a contact decal, in metres, on top of the material's polygon offset. */
const CONTACT_DECAL_LIFT = 0.03;"""
assert anchor in s

block = r'''/**
 * Haul roads: the graded corridors `buildHaulRoads` cuts between flat pads. Every number here is
 * measured against `NAV_CONFIG` in app/config.ts, which is cs 0.45 (large world), walkableRadius 2
 * voxels = 0.90 m, walkableClimb 0.40 m, walkableSlopeAngle 48 degrees = a gradient of 1.111.
 *
 * HAUL_TRIGGER_GRADE 0.72 (36 degrees) is where a link stops being walkable in practice rather
 * than in theory: recast rasterises at 0.45 m and the 2 m terrain lattice quantises the slope it
 * sees, so ground measured at 0.72 has produced spans recast rejected. Everything under it is left
 * exactly as the region field wrote it.
 *
 * HAUL_ROAD_GRADE 0.45 (24 degrees) is what a graded corridor aims for - two thirds of the limit,
 * which leaves the slope headroom for the 2 m lattice's own quantisation and for whatever a pad
 * collar adds on top.
 *
 * HAUL_ROAD_HALF 2.6 m of full regrade is 5.2 m of flat lane. Recast erodes walkableRadius 0.90 m
 * from each side, so 3.4 m of walkable width survives - nearly four times the agent - and the
 * collar outside it is graded too, so the usable corridor is wider still.
 *
 * HAUL_MIN_LINK 18 m keeps the two pads of one settlement from grading the ground between them
 * (they are already at the same height); HAUL_MAX_LINK 150 m is longer than the longest authored
 * road link in the world (the 110.5 m Moor Road Bend to Lower Quarry) with margin.
 */
const HAUL_TRIGGER_GRADE = 0.72;
const HAUL_ROAD_GRADE = 0.45;
const HAUL_ROAD_HALF = 2.6;
const HAUL_MIN_LINK = 18;
const HAUL_MAX_LINK = 150;

/** Spacing at which a haul road's profile is sampled and graded, in metres. Matches the lattice. */
const HAUL_SAMPLE_METRES = 2;

/**
 * Cap on the grading blur. Each pass halves the profile's curvature over one sample, so spreading
 * a 15 m step to a 0.45 gradient at 2 m spacing needs about 90 passes; 600 leaves room for the
 * longest link in the world and the loop exits the moment the profile is walkable anyway.
 */
const HAUL_SMOOTH_PASSES = 600;

/** Below this much movement a corridor is not worth cutting, in metres. */
const HAUL_MIN_CUT = 0.35;

/** Gradient of the corridor's own collar back into the hillside. */
const HAUL_FEATHER_GRADE = 0.5;
const HAUL_MIN_FEATHER = 3;
const HAUL_MAX_FEATHER = 22;

/** Bucket size for the haul-road segment grid, in metres. One bucket spans the widest collar. */
const HAUL_CELL = 26;

/** Segments per road in the packed grid key. Far more than any link can produce at 2 m spacing. */
const HAUL_INDEX_STRIDE = 4096;

'''

s = s.replace(anchor, block + anchor)

# helper types + functions, appended near the other module-level helpers
helper_anchor = """/** How far a pad's core reaches from its centre, in metres. Half-diagonal for a rectangle. */"""
assert helper_anchor in s

helpers = r'''/** One graded corridor, sampled at `HAUL_SAMPLE_METRES` along a pad-to-pad link. */
interface HaulRoad {
  xs: Float64Array;
  zs: Float64Array;
  /** The graded height at each sample, in metres. */
  heights: Float64Array;
  /** Collar width outside `HAUL_ROAD_HALF` at each sample, in metres. */
  feather: Float64Array;
}

/** Largest height change between neighbouring profile samples, in metres. */
function worstRise(profile: Float64Array): number {
  let worst = 0;
  for (let index = 1; index < profile.length; index += 1) {
    const rise = Math.abs(profile[index]! - profile[index - 1]!);
    if (rise > worst) worst = rise;
  }
  return worst;
}

/**
 * True when no third pad sits inside the circle with AB as its diameter.
 *
 * The Gabriel graph is the right shape for "which pads are next to each other": it is local, it
 * has no crossing edges, and it never joins two pads with a third standing between them - which is
 * exactly the long chord that would otherwise cut a corridor straight through a settlement. The
 * test is on pad CENTRES only, because a pad's core is flat and a corridor through flat ground
 * costs nothing.
 */
function isGabrielNeighbour(pads: readonly FlatSpot[], i: number, j: number): boolean {
  const a = pads[i]!;
  const b = pads[j]!;
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  const radiusSquared = ((a.x - b.x) ** 2 + (a.z - b.z) ** 2) / 4;
  for (let k = 0; k < pads.length; k += 1) {
    if (k === i || k === j) continue;
    const other = pads[k]!;
    if ((other.x - midX) ** 2 + (other.z - midZ) ** 2 < radiusSquared) return false;
  }
  return true;
}

'''

s = s.replace(helper_anchor, helpers + helper_anchor)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
