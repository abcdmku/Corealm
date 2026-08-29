import io

p = 'game/src/render/scene.ts'
s = io.open(p, encoding='utf-8').read()

old = """    // The cutting has to blend back into the hillside it was cut out of, and how far that takes
    // depends on how deep the cut is: a 1 m trim needs a couple of metres, an 8 m bench needs a
    // collar, or the corridor is a slot with vertical sides that recast drops on both flanks.
    const feather = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      const cut = Math.abs(graded[index]! - natural[index]!);
      feather[index] = clamp(cut / HAUL_FEATHER_GRADE, HAUL_MIN_FEATHER, HAUL_MAX_FEATHER);
    }"""

new = """    // The cutting has to blend back into the hillside it was cut out of, and how far that takes is
    // set by the ground at the collar's OWN outer edge, not by the ground on the centreline. Those
    // are different numbers wherever a pad has already pulled the centreline down — measured at
    // the ramp-two corridor, the centreline cut read 0.5 m while the hillside 6 m to the side stood
    // 7 m higher, so a collar sized off the centreline left a slot with a 2.22 gradient wall. The
    // probe distance depends on the collar width and the collar width depends on the probe, so it
    // is a fixed point; four passes converge it to under 10 cm on every corridor in the world.
    const nx = -(b.z - a.z) / span;
    const nz = (b.x - a.x) / span;
    const feather = new Float64Array(count);
    feather.fill(HAUL_MIN_FEATHER);
    for (let pass = 0; pass < 4; pass += 1) {
      for (let index = 0; index < count; index += 1) {
        const reach = HAUL_ROAD_HALF + feather[index]!;
        const target = graded[index]!;
        let drop = Math.abs(target - natural[index]!);
        for (const side of [-1, 1]) {
          const px = xs[index]! + nx * reach * side;
          const pz = zs[index]! + nz * reach * side;
          const ground = this.applyFlats(px, pz, this.applyHaulRoads(px, pz, this.naturalHeight(px, pz)));
          drop = Math.max(drop, Math.abs(ground - target));
        }
        feather[index] = clamp(drop / HAUL_FEATHER_GRADE, HAUL_MIN_FEATHER, HAUL_MAX_FEATHER);
      }
    }"""

assert old in s
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
