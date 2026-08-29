import io

p = 'game/src/render/scene.ts'
s = io.open(p, encoding='utf-8').read()

# ------------------------------------------------------------------ water constants
old = '''/** Azimuths on a water disc. 32 is round at the distance a pond is ever seen from. */
const WATER_SEGMENTS = 32;

/** Rings between the hub and the shoreline. 10 x 32 + 1 = 321 vertices, against the old 34. */
const WATER_RINGS = 10;
'''
new = '''/**
 * Arc between two shoreline spokes, in metres. NOT a fixed azimuth count.
 *
 * A fixed 32 spokes is 4.5 m of arc at the Redsill rim, and the fan draws a straight chord across
 * every one of those gaps whatever the ground does inside it. Measured on the shipped world with
 * `__gameDebug.groundHeight` on a 1 m grid over each disc footprint (runs/corealm/audit/
 * wd-measure.ts): 14.6% of the Redsill footprint and 18.4% of the Cairn Tarn's had DRY GROUND
 * above the drawn surface, by up to 5.16 m — spurs narrower than one spoke gap, that the solver
 * never sampled and the fan therefore flooded.
 *
 * 2 m is the terrain lattice's own quad, so the shoreline is now sampled at the finest spacing the
 * drawn mesh can actually represent a bank at. The spoke count follows the body's size, clamped so
 * a 2.5 m pool is still round and the widest disc in the world stays under 200 spokes.
 */
const WATER_SHORE_ARC = 2;
const WATER_MIN_SEGMENTS = 32;
const WATER_MAX_SEGMENTS = 192;

/** Rings between the hub and the shoreline. */
const WATER_RINGS = 12;

/**
 * Ring distribution exponent. `radius = reach * pow(ring / rings, WATER_RING_BIAS)`.
 *
 * Evenly spaced rings put reach/12 = 1.9 m between the last two at Redsill, which is wider than
 * the band `WATER_EDGE_METRES` has to taper across, so the taper landed on a single vertex and
 * the edge came back as a hard arc. 0.6 packs the outer ring spacing down to 5.1% of the reach.
 */
const WATER_RING_BIAS = 0.6;

/**
 * How far in from the waterline the drawn depth is tapered to zero, in metres.
 *
 * The depth attribute drives the material's colour ramp AND its alpha (`materials.water`, alpha =
 * smoothstep(0, 0.25 m, depth)), so this is the width of the wet edge. It used to be "the outer
 * ring", which is a resolution-dependent distance: reach/10, or 2.3 m at Redsill and 0.25 m at a
 * pool that only cleared `WATER_MIN_RADIUS`. A metre and a bit is a bank, at any size of pond.
 */
const WATER_EDGE_METRES = 1.4;
'''
assert old in s
s = s.replace(old, new, 1)

old = '''const WATER_MARCH_METRES = 1;
'''
new = '''const WATER_MARCH_METRES = 0.5;
'''
assert old in s
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
