import io

p = 'game/src/render/camera.ts'
s = io.open(p, encoding='utf-8').read()

# ------------------------------------------------------------------ new constant
old = '''/** The loosest entry in `PITCH_STEPS`. Above this no step is legal, so the search is skipped. */
const PITCH_SEARCH_TRIGGER_FRACTION = 0.75;
'''
new = '''/** The loosest entry in `PITCH_STEPS`. Above this no step is legal, so the search is skipped. */
const PITCH_SEARCH_TRIGGER_FRACTION = 0.75;

/**
 * Metres of daylight kept under an eave when the camera ducks beneath one. See `eavePitch`.
 *
 * The soffit heights in `coverRect` are asset measurements, and the reference they are stated
 * against is the player's own feet, which is exact on a settlement pad to a worst measured 0.086 m.
 * 0.35 m is four times that and it is also enough that the near plane's 0.106 m corner radius
 * clears the beam rather than grazing it.
 */
const EAVE_CLEARANCE_METRES = 0.35;
'''
assert old in s
s = s.replace(old, new, 1)

# ------------------------------------------------------------------ blocked-by-cover flag
old = '''  /** Whether the probe reported a blocker on the most recent update. Read by the debug snapshot. */
  private occluded = false;'''
new = '''  /** Whether the probe reported a blocker on the most recent update. Read by the debug snapshot. */
  private occluded = false;
  /**
   * Whether the LAST `clearance()` call was blocked by a walk-under roof rather than by physics.
   *
   * The two want opposite corrections and only one of them has a closed-form answer, so the pitch
   * search has to be able to tell them apart. See `eavePitch`.
   */
  private coverBlocked = false;'''
assert old in s
s = s.replace(old, new, 1)

# ------------------------------------------------------------------ clearance resets the flag
old = '''  private clearance(requested: number): number {
    let nearest: number | null = this.probeSegment(0, 0, requested);'''
new = '''  private clearance(requested: number): number {
    this.coverBlocked = false;
    let nearest: number | null = this.probeSegment(0, 0, requested);'''
assert old in s
s = s.replace(old, new, 1)

old = '''    const roof = this.coverSegment(requested);
    if (roof !== null && (nearest === null || roof < nearest)) nearest = roof;
    return nearest;'''
new = '''    const roof = this.coverSegment(requested);
    if (roof !== null) {
      this.coverBlocked = true;
      if (nearest === null || roof < nearest) nearest = roof;
    }
    return nearest;'''
assert old in s
s = s.replace(old, new, 1)

# ------------------------------------------------------------------ the search itself
old = '''    let bestPitch = this.pitch;
    let bestClear = flatClear;
    if (flatClear < requested * PITCH_SEARCH_TRIGGER_FRACTION) {
      for (const [step, allowedBelow] of PITCH_STEPS) {'''
new = '''    // Captured before any further probing, because `clearance` rewrites it on every call.
    const flatCover = this.coverBlocked;

    let bestPitch = this.pitch;
    let bestClear = flatClear;
    if (flatClear < requested * PITCH_SEARCH_TRIGGER_FRACTION) {
      // A walk-under roof is the one blocker whose answer can be SOLVED instead of searched, and
      // `PITCH_STEPS` cannot reach it: the porch at the Coldbrace bank needs the pitch to come down
      // from 0.62 to 0.27 to get the sight line out under its eave, and the largest step in the
      // table is -0.28 applied to a pitch that is already being asked to clear a 2.98 m soffit
      // 5.4 m away. Tried FIRST, so a shot that can be saved by ducking is never instead answered
      // by climbing over the roof the player is standing under.
      if (flatCover) {
        const duck = this.eavePitch();
        if (duck !== null && Math.abs(duck - this.pitch) > 1e-4) {
          this.aim(duck, requested);
          const clear = this.clearance(requested);
          if (clear > bestClear) {
            bestClear = clear;
            bestPitch = duck;
          }
        }
      }
      for (const [step, allowedBelow] of PITCH_STEPS) {
        if (bestClear >= requested * CLIMB_ACCEPT_FRACTION) break;'''
assert old in s
s = s.replace(old, new, 1)

# ------------------------------------------------------------------ eavePitch method
old = '''  /**
   * The same segment, against the walk-under roofs the physics world does not carry.'''
new = '''  /**
   * The pitch that takes the sight line out from UNDER a walk-under roof, solved rather than
   * searched.
   *
   * The geometry is small: pitch is constant along the whole segment, and a canopy only matters
   * over its own footprint, so the binding constraint is "be below the soffit by the time you leave
   * the footprint". Cast the horizontal bearing through each nearby slab's XZ rectangle, take the
   * far intersection as the exit distance, and the answer is
   * `atan2(soffit - focus height - clearance, exit)`. The most restrictive slab wins.
   *
   * Worked, at the `bank` pose, against the numbers this file already records: the Coldbrace bank
   * porch soffits at 2.68 x 1.111 = 2.978 m and the sight line leaves its 6 x 3 footprint 5.4 m
   * out, so the pitch is atan(1.528 / 5.4) = 0.27 rad against an authored 0.62 — and at 19 m that
   * seats the camera 5.1 m up, looking under the porch's front edge at the chest beneath it,
   * instead of at 2.80 m of clearance with its lens inside the beams.
   *
   * Never RAISES the pitch: clamped to the authored pitch above and `CAMERA.minPitch` below. A
   * canopy the segment already clears returns the authored pitch and the caller skips it. The
   * result is still scored by `clearance` like every other candidate and still has to pass the
   * gain gate, so a duck that trades one blocker for another is rejected on measurement rather
   * than believed on construction.
   */
  private eavePitch(): number | null {
    const slabs = overheadCover();
    if (slabs.length === 0) return null;
    const ax = this.smoothed.x;
    const az = this.smoothed.z;
    // The same horizontal bearing `aim` builds the seat on, as a unit vector, so the slab test's
    // parametric range comes out in metres.
    const dx = Math.sin(this.yaw);
    const dz = Math.cos(this.yaw);

    let best: number | null = null;
    for (const slab of slabs) {
      const ox = ax - slab.cx;
      const oz = az - slab.cz;
      if (ox * ox + oz * oz > COVER_RANGE_METRES * COVER_RANGE_METRES) continue;
      const lox = slab.cos * ox - slab.sin * oz;
      const loz = slab.sin * ox + slab.cos * oz;
      const ldx = slab.cos * dx - slab.sin * dz;
      const ldz = slab.sin * dx + slab.cos * dz;

      this.slabRange[0] = 0;
      this.slabRange[1] = COVER_RANGE_METRES;
      if (!this.narrow(lox, ldx, -slab.hx, slab.hx)) continue;
      if (!this.narrow(loz, ldz, -slab.hz, slab.hz)) continue;
      const exit = this.slabRange[1];
      if (exit <= 1e-3) continue;

      // Both heights are stated above the pad, and the focus point is FOCUS_HEIGHT_METRES above
      // it, so the ground term cancels and this is a pure asset measurement.
      const headroom = slab.soffit - FOCUS_HEIGHT_METRES - EAVE_CLEARANCE_METRES;
      const pitch = Math.atan2(headroom, exit);
      if (best === null || pitch < best) best = pitch;
    }
    if (best === null) return null;
    return clamp(best, CAMERA.minPitch, this.pitch);
  }

  /**
   * The same segment, against the walk-under roofs the physics world does not carry.'''
assert old in s
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
