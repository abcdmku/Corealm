import io

p = 'game/src/render/scene.ts'
s = io.open(p, encoding='utf-8').read()

# ------------------------------------------------------------------ 1. noise field state
old = """  /** Graded corridors joining flat pads the raw terrain cannot join. See `buildHaulRoads`. */
  private hauls: HaulRoad[] = [];"""
new = """  /**
   * The macro-variation field the surface weights are broken up with.
   *
   * Measured before it existed: on a settlement pad the terrain relief is EXACTLY 0.000 m, so the
   * altitude ramp that decides grass-versus-dry returns one number over the whole 7,238 m2 disc
   * and the square reads as a single flat swatch with a hard arc where it meets the hillside -
   * visible as the pale grey plate filling the foreground of runs/corealm/screenshots/
   * wire-town_entrance.png. Altitude is also the ONLY signal the weights had, and the height noise
   * has no content below a 21 m wavelength, so the same flatness applies at every scale a player
   * walks through. Two octaves of dedicated surface noise at 62 m and 19 m give the weights
   * something to vary by that the height field does not have to provide.
   */
  private surfaceNoise: Noise2D | null = null;
  /** Graded corridors joining flat pads the raw terrain cannot join. See `buildHaulRoads`. */
  private hauls: HaulRoad[] = [];"""
assert old in s
s = s.replace(old, new)

# ------------------------------------------------------------------ 2. seed it in buildWorld
old = """    this.resolveFlatTargets();
    this.buildHaulRoads();"""
new = """    // Its own stream, drawn once, so adding it shifts nothing else in the world's rng order.
    this.surfaceNoise = createValueNoise((spec.regions[0]?.seed ?? 0x5b0a11) ^ 0x51_7f_ac_e1);

    this.resolveFlatTargets();
    this.buildHaulRoads();"""
assert old in s
s = s.replace(old, new)

old = """    const field = makeRegionField(region);
    const range = sweepFieldRange(rect, field);
    this.fields.push({"""
new = """    const field = makeRegionField(region);
    const range = sweepFieldRange(rect, field);
    this.surfaceNoise ??= createValueNoise(spec.seed ^ 0x51_7f_ac_e1);
    this.fields.push({"""
assert old in s
s = s.replace(old, new)

old = """    this.legacySamplers.clear();
    this.scatterByRegion.clear();"""
new = """    this.legacySamplers.clear();
    this.scatterByRegion.clear();
    this.surfaceNoise = null;"""
assert old in s
s = s.replace(old, new)

# ------------------------------------------------------------------ 3. sampleSurface
old = """    // Slope above ~23 degrees loses its soil and shows stone. Lowered from the old 0.5 threshold
    // because at 0.5 only 12.71% of the world had any surface variation at all.
    const rock = smoothstep01((slope - 0.42) / 0.5);
    // Debris collects in hollows and washes off crests.
    const gravel = smoothstep01((curvature - 0.05) / 0.14) * (1 - rock * 0.6);

    // Stamps, in priority order: paving beats a road, a road beats a waterlogged bank.
    const road = this.roadAt(x, z);
    let dirt = 0;
    let roadPerpendicular = 0.5;
    let roadPresence = 0;
    if (road) {
      dirt = 1 - smoothstep01((road.distance - ROAD_WORN_HALF) / (ROAD_FADE_HALF - ROAD_WORN_HALF));
      roadPerpendicular = clamp(road.perpendicular / (ROAD_PERP_RANGE * 2) + 0.5, 0, 1);
      roadPresence = dirt > 0.02 ? 1 : 0;
    }"""
new = """    // Macro variation. Everything above this point is derived from the height field, and the
    // height field is flat on every pad and smooth at 21 m and up everywhere else, so without an
    // independent signal the ground has nothing to say between a hill and a texel. Two octaves:
    // 62 m sets which parts of a meadow are dry and which are lush, 19 m breaks the boundary
    // between them so it is not one soft gradient.
    const noise = this.surfaceNoise;
    const macro = noise
      ? noise(x / 62, z / 62) * 0.62 + noise((x + 611) / 19, (z - 407) / 19) * 0.38
      : 0;

    // Altitude still leads, and the noise is a bias on it rather than a replacement, so the
    // region's authored high/low swatches still land where the region author put them.
    const dryness = clamp(local + macro * SURFACE_MACRO_RANGE, 0, 1);

    // Slope above ~23 degrees loses its soil and shows stone. Lowered from the old 0.5 threshold
    // because at 0.5 only 12.71% of the world had any surface variation at all. The macro field
    // moves the soil line by +/-3.5 degrees so it is a coastline rather than a contour.
    const rock = smoothstep01((slope - 0.42 - macro * 0.07) / 0.5);
    // Debris collects in hollows and washes off crests, and gathers in patches within that.
    const gravel = smoothstep01((curvature - 0.05) / 0.14) * (1 - rock * 0.6)
      * clamp(0.45 + macro * 0.8, 0, 1);

    // Stamps, in priority order: paving beats a road, a road beats a waterlogged bank.
    //
    // The corridor is deliberately narrow and hard-edged. The first stamped version feathered from
    // a 1.9 m worn half-width out to 3.4 m, and 1.5 m of gradient either side of a 3.8 m track is
    // most of what a player sees, so the road read as an airbrush smear rather than as a track
    // with a verge. 1.5 m of full wear out to 2.5 m is a 3 m rut band with a 1 m shoulder, and the
    // shoulder now carries GRAVEL rather than more dirt, so the edge is a material change instead
    // of a fade to nothing.
    const road = this.roadAt(x, z);
    let dirt = 0;
    let verge = 0;
    let roadPerpendicular = 0.5;
    let roadPresence = 0;
    let roadWear = 0;
    if (road) {
      dirt = 1 - smoothstep01((road.distance - ROAD_WORN_HALF) / (ROAD_FADE_HALF - ROAD_WORN_HALF));
      // A gravel shoulder peaking exactly where the dirt gives out, and gone by the time the
      // untouched ground starts.
      verge = (1 - dirt) * (1 - smoothstep01((road.distance - ROAD_FADE_HALF) / ROAD_VERGE_METRES));
      roadPerpendicular = clamp(road.perpendicular / (ROAD_PERP_RANGE * 2) + 0.5, 0, 1);
      roadPresence = dirt > 0.02 ? 1 : 0;
      roadWear = dirt;
    }"""
assert old in s
s = s.replace(old, new)

old = """    // Paving covers a road; both cover the bank.
    dirt = Math.min(dirt, 1 - cobble);
    wet = Math.min(wet, 1 - cobble - dirt);
    mud = Math.min(mud, Math.max(0, 1 - cobble - dirt - wet));

    const stamped = clamp(cobble + dirt + wet + mud, 0, 1);
    const natural = 1 - stamped;
    out.rock = rock * natural;
    out.gravel = clamp(gravel, 0, 1) * (1 - rock) * natural;
    const remaining = Math.max(0, natural - out.rock - out.gravel);
    out.dry = remaining * local;
    out.grass = remaining * (1 - local);
    out.cobble = cobble;
    out.dirt = dirt;
    out.wet = wet;
    out.mud = mud;
    out.roadPerpendicular = roadPerpendicular;
    out.roadPresence = roadPresence;"""
new = """    // Paving covers a road; both cover the bank.
    dirt = Math.min(dirt, 1 - cobble);
    wet = Math.min(wet, 1 - cobble - dirt);
    mud = Math.min(mud, Math.max(0, 1 - cobble - dirt - wet));
    verge = Math.min(verge, Math.max(0, 1 - cobble - dirt - wet - mud));

    const stamped = clamp(cobble + dirt + wet + mud + verge, 0, 1);
    const natural = 1 - stamped;
    out.rock = rock * natural;
    out.gravel = clamp(gravel, 0, 1) * (1 - rock) * natural + verge;
    const remaining = Math.max(0, natural - rock * natural - clamp(gravel, 0, 1) * (1 - rock) * natural);
    out.dry = remaining * dryness;
    out.grass = remaining * (1 - dryness);
    out.cobble = cobble;
    out.dirt = dirt;
    out.wet = wet;
    out.mud = mud;
    out.roadPerpendicular = roadPerpendicular;
    out.roadPresence = roadPresence;
    out.roadWear = roadWear;
    out.macro = clamp(macro * 0.5 + 0.5, 0, 1);"""
assert old in s
s = s.replace(old, new)

# fallback branch
old = """      out.grass = 1; out.dry = 0; out.rock = 0; out.gravel = 0;
      out.dirt = 0; out.mud = 0; out.cobble = 0; out.wet = 0;
      out.roadPerpendicular = 0.5;
      out.roadPresence = 0;
      return;"""
new = """      out.grass = 1; out.dry = 0; out.rock = 0; out.gravel = 0;
      out.dirt = 0; out.mud = 0; out.cobble = 0; out.wet = 0;
      out.roadPerpendicular = 0.5;
      out.roadPresence = 0;
      out.roadWear = 0;
      out.macro = 0.5;
      return;"""
assert old in s
s = s.replace(old, new)

# ------------------------------------------------------------------ 4. SurfaceSample + writeSplat
old = """  /** Signed perpendicular distance to the nearest road, remapped onto 0..1. 0.5 is no road. */
  roadPerpendicular: number;
  /** 1 where a road is close enough for wheel ruts to exist. */
  roadPresence: number;
}"""
new = """  /** Signed perpendicular distance to the nearest road, remapped onto 0..1. 0.5 is no road. */
  roadPerpendicular: number;
  /** 1 where a road is close enough for wheel ruts to exist. */
  roadPresence: number;
  /** How worn the track is here, 0 at the shoulder to 1 on the centreline. Drives rut depth. */
  roadWear: number;
  /** The macro-variation field, remapped onto 0..1 with 0.5 as its mean. */
  macro: number;
}"""
assert old in s
s = s.replace(old, new)

old = """    colour: new THREE.Color(),
    grass: 1, dry: 0, rock: 0, gravel: 0,
    dirt: 0, mud: 0, cobble: 0, wet: 0,
    roadPerpendicular: 0.5, roadPresence: 0,
  };"""
new = """    colour: new THREE.Color(),
    grass: 1, dry: 0, rock: 0, gravel: 0,
    dirt: 0, mud: 0, cobble: 0, wet: 0,
    roadPerpendicular: 0.5, roadPresence: 0, roadWear: 0, macro: 0.5,
  };"""
assert old in s
s = s.replace(old, new)

old = """  extra[index * 4] = toByte(surface.roadPerpendicular);
  extra[index * 4 + 1] = toByte(surface.roadPresence);
  extra[index * 4 + 2] = 0;
  extra[index * 4 + 3] = 0;
}"""
new = """  extra[index * 4] = toByte(surface.roadPerpendicular);
  extra[index * 4 + 1] = toByte(surface.roadPresence);
  extra[index * 4 + 2] = toByte(surface.roadWear);
  extra[index * 4 + 3] = toByte(surface.macro);
}"""
assert old in s
s = s.replace(old, new)

# ------------------------------------------------------------------ 5. road constants
old = """const ROAD_WORN_HALF = 1.9;
const ROAD_FADE_HALF = 3.4;
const ROAD_PERP_RANGE = 3.5;"""
new = """const ROAD_WORN_HALF = 1.5;
const ROAD_FADE_HALF = 2.5;
const ROAD_PERP_RANGE = 2.6;

/** How far past the worn edge the gravel shoulder reaches, in metres. */
const ROAD_VERGE_METRES = 1.1;

/**
 * How far the macro field may bias the grass/dry split, as a fraction of the whole ramp.
 *
 * 0.34 is enough that a flat settlement pad, whose altitude ramp is one constant number, still
 * shows dry patches and lush patches; small enough that the region's authored altitude palette is
 * still the thing you read when you walk uphill.
 */
const SURFACE_MACRO_RANGE = 0.34;"""
assert old in s
s = s.replace(old, new)

# ------------------------------------------------------------------ 6. road corridor comment
old = """ * `ROAD_WORN_HALF` is fully worn track; from there the dirt weight feathers out to
 * `ROAD_FADE_HALF`. Wider than the old ribbon's 1.6 m half-width because a corridor written into a
 * 2 m vertex lattice needs to catch at least two vertices across to read as a track at all.
 * `ROAD_PERP_RANGE` is only the encoding range of the perpendicular distance in `aGround.x`; at
 * 3.5 m it gives the fragment shader 2.7 cm of resolution, which is finer than the 16 cm rut band.
 */"""
new = """ * `ROAD_WORN_HALF` is fully worn track; from there the dirt weight feathers out to
 * `ROAD_FADE_HALF` and a gravel shoulder carries it the last `ROAD_VERGE_METRES`.
 *
 * The first stamped version used 1.9 m and 3.4 m, which put 1.5 m of pure gradient either side of
 * a 3.8 m track, and a 6.8 m corridor that is more than half feather reads as an airbrush smear
 * rather than as a road. 1.5 m and 2.5 m is a 3 m rut band with a 1 m shoulder: the boundary lands
 * inside one 2 m lattice quad, which is as hard an edge as vertex weights on this lattice can
 * make, and the shoulder is a MATERIAL change (gravel) rather than less of the same dirt.
 *
 * `ROAD_PERP_RANGE` is only the encoding range of the perpendicular distance in `aGround.x`; at
 * 2.6 m it gives the fragment shader 2.0 cm of resolution, finer than any rut band worth drawing.
 */"""
assert old in s
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
