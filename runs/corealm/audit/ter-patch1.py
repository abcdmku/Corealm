import io

p = 'game/src/render/scene.ts'
s = io.open(p, encoding='utf-8').read()

anchor = """  /** Adds a flattened building pad. Call before `buildWorld`; it changes the ground. */
  addFlatSpot(flat: FlatSpot): void {
    this.flats.push(flat);
  }"""
assert anchor in s

block = r'''  /**
   * Grades a walkable corridor between every pair of neighbouring flat pads the raw terrain cannot
   * join - a haul road up a quarry face.
   *
   * THE DEFECT THIS CLOSES. Karrowmoor is four terraces and every flat place on it is a pad: the
   * Moor Road Bend, Highcairn, the two ramps, the Upper Karrow Seam, the Great Cairn. Measured
   * against `NAV_CONFIG.walkableSlopeAngle` of 48 degrees, the ground BETWEEN those pads was not
   * walkable - the Moor Road Bend to Highcairn escarpment peaked at 1.38 (54 degrees) and the
   * ramp-two to ramp-three riser at 1.02 (45.6 degrees). Recast therefore never connected terrace
   * two, and an offline navmesh build over the authored 6x7 probe grid (x 50..300, z 0..-180 from
   * the Lower Quarry at (60,-16)) reached 7 of 42 cells: only the z = 0 strip. Highcairn, its
   * bank, its plots, both ramps, the Upper Karrow Seam and the Great Cairn were all NOT_REACHABLE,
   * which is three red gate-check lines.
   *
   * WHY IT IS A TERRAIN FIX AND NOT A NAVIGATION ONE. Nothing about the navmesh is wrong. A
   * terraced quarry with no way up its faces is a quarry nobody could have worked, and the way up
   * a quarry face is a haul road: a graded cutting across the riser. So the ground grows one,
   * rather than the slope limit being loosened to pretend the cliff is walkable.
   *
   * WHERE THE ROUTES COME FROM. The pads themselves. Every named location in `content/regions.ts`
   * is a pad, and the authored road network joins locations, so the pad graph already contains
   * every route the content asks for and this file does not have to know the content to find them.
   * The graph is Gabriel-like: A and B are neighbours when no third pad sits inside the circle on
   * AB as diameter, which keeps the edges local and drops the long chords that would cut a trench
   * across a whole region. Only edges whose terrain measures too steep are graded at all, so
   * Fallowmarch and Vellenwood, where the worst authored route measures 0.66, get none.
   *
   * The Agility distance ledger in `content/regions.ts` is unaffected: it is straight-line metres
   * between authored coordinates and a haul road changes only y.
   */
  private buildHaulRoads(): void {
    const pads = this.flats.filter((flat) => !this.carvedPads.has(flat));
    if (pads.length < 2) return;

    for (let i = 0; i < pads.length; i += 1) {
      for (let j = i + 1; j < pads.length; j += 1) {
        const a = pads[i]!;
        const b = pads[j]!;
        const span = Math.hypot(b.x - a.x, b.z - a.z);
        if (span < HAUL_MIN_LINK || span > HAUL_MAX_LINK) continue;
        if (!isGabrielNeighbour(pads, i, j)) continue;
        const road = this.gradeHaulRoad(a, b, span);
        if (!road) continue;
        this.hauls.push(road);
        this.indexHaulRoad(this.hauls.length - 1, road);
      }
    }
  }

  /**
   * Samples the ground along one pad-to-pad link and, if it is too steep to walk, returns the
   * graded profile that replaces it.
   *
   * Grading is repeated binomial smoothing with the two endpoints pinned. That is the cheapest
   * operation that is local (a straight stretch is a fixed point of a blur, so only the riser
   * moves) and guaranteed to converge - the limit of the blur is the straight line between the
   * pins, whose gradient is the link's mean and therefore the gentlest any corridor between those
   * two pads could be. It stops as soon as the profile is walkable, so the corridor keeps as much
   * of the hill's shape as the grade allows.
   */
  private gradeHaulRoad(a: FlatSpot, b: FlatSpot, span: number): HaulRoad | null {
    const count = Math.max(3, Math.round(span / HAUL_SAMPLE_METRES) + 1);
    const xs = new Float64Array(count);
    const zs = new Float64Array(count);
    const natural = new Float64Array(count);
    const spacing = span / (count - 1);

    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      xs[index] = x;
      zs[index] = z;
      natural[index] = this.applyFlats(x, z, this.applyHaulRoads(x, z, this.naturalHeight(x, z)));
    }

    if (worstRise(natural) <= HAUL_TRIGGER_GRADE * spacing) return null;

    const limit = HAUL_ROAD_GRADE * spacing;
    const graded = Float64Array.from(natural);
    const previous = new Float64Array(count);
    for (let pass = 0; pass < HAUL_SMOOTH_PASSES; pass += 1) {
      if (worstRise(graded) <= limit) break;
      previous.set(graded);
      for (let index = 1; index < count - 1; index += 1) {
        graded[index] = (previous[index - 1]! + 2 * previous[index]! + previous[index + 1]!) / 4;
      }
    }

    // Nothing moved far enough to be worth a corridor: the link measured steep because of a single
    // 2 m sample, and ground that shifts by centimetres is not a road.
    let deepest = 0;
    for (let index = 0; index < count; index += 1) {
      deepest = Math.max(deepest, Math.abs(graded[index]! - natural[index]!));
    }
    if (deepest < HAUL_MIN_CUT) return null;

    // The cutting has to blend back into the hillside it was cut out of, and how far that takes
    // depends on how deep the cut is: a 1 m trim needs a couple of metres, an 8 m bench needs a
    // collar, or the corridor is a slot with vertical sides that recast drops on both flanks.
    const feather = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      const cut = Math.abs(graded[index]! - natural[index]!);
      feather[index] = clamp(cut / HAUL_FEATHER_GRADE, HAUL_MIN_FEATHER, HAUL_MAX_FEATHER);
    }
    // One smoothing pass on the collar width itself, so the corridor's edge is a line rather than
    // a staircase of per-sample widths.
    const collar = Float64Array.from(feather);
    for (let index = 1; index < count - 1; index += 1) {
      collar[index] = (feather[index - 1]! + 2 * feather[index]! + feather[index + 1]!) / 4;
    }

    return { xs, zs, heights: graded, feather: collar };
  }

  /** Buckets each corridor segment on the same grid scheme the road stamps use. */
  private indexHaulRoad(roadIndex: number, road: HaulRoad): void {
    for (let index = 0; index < road.xs.length - 1; index += 1) {
      const reach = HAUL_ROAD_HALF + Math.max(road.feather[index]!, road.feather[index + 1]!);
      const minX = Math.min(road.xs[index]!, road.xs[index + 1]!) - reach;
      const maxX = Math.max(road.xs[index]!, road.xs[index + 1]!) + reach;
      const minZ = Math.min(road.zs[index]!, road.zs[index + 1]!) - reach;
      const maxZ = Math.max(road.zs[index]!, road.zs[index + 1]!) + reach;
      for (let cz = Math.floor(minZ / HAUL_CELL); cz <= Math.floor(maxZ / HAUL_CELL); cz += 1) {
        for (let cx = Math.floor(minX / HAUL_CELL); cx <= Math.floor(maxX / HAUL_CELL); cx += 1) {
          const key = cellKey(cx, cz);
          const packed = roadIndex * HAUL_INDEX_STRIDE + index;
          const bucket = this.haulGrid.get(key);
          if (bucket) bucket.push(packed);
          else this.haulGrid.set(key, [packed]);
        }
      }
    }
  }

  /**
   * Blends a point toward whatever haul-road corridors reach it.
   *
   * Same weighted-mean-plus-influence shape as `applyFlats`, for the same reason: the mean decides
   * WHAT the ground becomes where two corridors cross, and the separate influence decides HOW MUCH
   * of it survives at the corridor's edge. Both terms use the same falloff, so a crossing is
   * continuous rather than a seam.
   */
  private applyHaulRoads(x: number, z: number, height: number): number {
    if (this.hauls.length === 0) return height;
    const bucket = this.haulGrid.get(cellKey(Math.floor(x / HAUL_CELL), Math.floor(z / HAUL_CELL)));
    if (!bucket) return height;

    let accumulated = 0;
    let weightSum = 0;
    let influence = 0;

    for (const packed of bucket) {
      const road = this.hauls[Math.floor(packed / HAUL_INDEX_STRIDE)]!;
      const index = packed % HAUL_INDEX_STRIDE;
      const ax = road.xs[index]!;
      const az = road.zs[index]!;
      const ex = road.xs[index + 1]! - ax;
      const ez = road.zs[index + 1]! - az;
      const lengthSquared = ex * ex + ez * ez;
      const t = lengthSquared <= 1e-9
        ? 0
        : clamp(((x - ax) * ex + (z - az) * ez) / lengthSquared, 0, 1);
      const distance = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
      const feather = road.feather[index]! + (road.feather[index + 1]! - road.feather[index]!) * t;
      if (distance > HAUL_ROAD_HALF + feather) continue;
      const weight = 1 - smoothstep01((distance - HAUL_ROAD_HALF) / feather);
      if (weight <= 0) continue;
      const target = road.heights[index]! + (road.heights[index + 1]! - road.heights[index]!) * t;
      influence = Math.max(influence, weight);
      accumulated += target * weight;
      weightSum += weight;
    }

    if (weightSum <= 0) return height;
    return height + (accumulated / weightSum - height) * influence;
  }

'''

s = s.replace(anchor, block + anchor)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
