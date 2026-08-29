import io

p = 'game/src/render/scene.ts'
s = io.open(p, encoding='utf-8').read()

old = """    // Shoreline distance per azimuth. Bisection rather than a linear walk because the bank is
    // monotonic over the basin's own falloff and 18 samples resolve it to under a centimetre.
    const shoreline = new Float64Array(WATER_SEGMENTS);
    for (let step = 0; step < WATER_SEGMENTS; step += 1) {
      const angle = (step / WATER_SEGMENTS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      let low = 0;
      let high = maxRadius;
      if (this.meshHeightAt(centreX + dx * high, centreZ + dz * high) < level) {
        shoreline[step] = high;
        continue;
      }
      for (let iteration = 0; iteration < 18; iteration += 1) {
        const mid = (low + high) / 2;
        if (this.meshHeightAt(centreX + dx * mid, centreZ + dz * mid) < level) low = mid;
        else high = mid;
      }
      // A floor, so a basin that was carved too shallow still draws something a player can see is
      // water rather than collapsing to a point.
      shoreline[step] = Math.max(WATER_MIN_RADIUS, low);
    }"""

new = """    // Shoreline distance per azimuth: the FIRST radius at which the drawn ground crosses the
    // surface, found by marching outward and then bisecting inside the metre it crossed in.
    //
    // This was a pure bisection with an early-out that returned `maxRadius` whenever the ground at
    // maxRadius was below the level, on the stated reasoning that the bank is monotonic over the
    // basin's falloff. Measured, it is not: on a 1 m grid, 11% of the Redsill and Cairn Tarn disc
    // footprints stood ABOVE the surface by up to 2.12 m, because a spur crosses the plane at
    // r = 21 and drops back under it by r = 23, and the early-out drew straight over the top of it.
    // Marching finds the first crossing by construction, which is the definition of a shoreline.
    const shoreline = new Float64Array(WATER_SEGMENTS);
    for (let step = 0; step < WATER_SEGMENTS; step += 1) {
      const angle = (step / WATER_SEGMENTS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      let low = 0;
      let high = maxRadius;
      for (let radius = WATER_MARCH_METRES; radius <= maxRadius; radius += WATER_MARCH_METRES) {
        if (this.meshHeightAt(centreX + dx * radius, centreZ + dz * radius) >= level) {
          high = radius;
          break;
        }
        low = radius;
      }
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const mid = (low + high) / 2;
        if (this.meshHeightAt(centreX + dx * mid, centreZ + dz * mid) < level) low = mid;
        else high = mid;
      }
      // A floor, so a basin that was carved too shallow still draws something a player can see is
      // water rather than collapsing to a point.
      shoreline[step] = Math.max(WATER_MIN_RADIUS, low);
    }"""
assert old in s
s = s.replace(old, new)

old = """/** Smallest shoreline radius a water body will draw, in metres. */
const WATER_MIN_RADIUS = 2.5;"""
new = """/** Smallest shoreline radius a water body will draw, in metres. */
const WATER_MIN_RADIUS = 2.5;

/**
 * Outward march step when solving for the shoreline, in metres.
 *
 * 1 m is half the terrain lattice's 2 m quad, so the march cannot step over a bank the drawn mesh
 * is able to represent. 26 steps on the widest disc in the world, then 12 bisections inside the
 * metre it crossed in, which resolves the waterline to 0.25 mm.
 */
const WATER_MARCH_METRES = 1;"""
assert old in s
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
