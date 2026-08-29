import io

p = 'game/src/render/scene.ts'
s = io.open(p, encoding='utf-8').read()

old = """    const centreX = (rect.minX + rect.maxX) / 2;
    const centreZ = (rect.minZ + rect.maxZ) / 2;
    const maxRadius = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2;"""
new = """    const centreX = (rect.minX + rect.maxX) / 2;
    const centreZ = (rect.minZ + rect.maxZ) / 2;
    // The rect is the caller's guess at how big the pond is; the terrain is the answer. Searching
    // past the guess is what stops a disc ending in a straight line across open water: measured on
    // the Redsill basin, 26 of 32 azimuths were cut off by the rect while the ground under the rim
    // was still 0.6-0.8 m below the surface.
    const maxRadius = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2 + WATER_SEARCH_MARGIN;"""
assert old in s
s = s.replace(old, new)

old = """    const mesh = new THREE.Mesh(geometry, this.materials.water(regionId));
    mesh.position.set(centreX, level, centreZ);
    mesh.name = `water-${regionId}`;
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scatterGroup.add(mesh);
    // The bank treatment in the terrain splat needs to know where the waterline is. Registering
    // here rather than requiring a separate call is what keeps the mud and the shoreline agreeing
    // even when the caller only knows about the water.
    this.waters.push({ centre: [centreX, centreZ], radius: maxRadius, level });
    if (this.chunks.length > 0) {
      const reach = maxRadius + WATER_BANK_METRES;
      this.restampArea(centreX - reach, centreZ - reach, centreX + reach, centreZ + reach);
    }
    return mesh;"""
new = """    const mesh = new THREE.Mesh(geometry, this.materials.water(regionId));
    mesh.position.set(centreX, level, centreZ);
    mesh.name = `water-${regionId}`;
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scatterGroup.add(mesh);
    // The bank treatment in the terrain splat needs to know where the waterline is, so it is
    // registered at the radius the SHORELINE reached rather than at the rect the caller guessed.
    // Registering the guess put the mud and wet bands metres inside or outside the drawn edge.
    let reached = WATER_MIN_RADIUS;
    for (let step = 0; step < WATER_SEGMENTS; step += 1) reached = Math.max(reached, shoreline[step]!);
    this.waters.push({ centre: [centreX, centreZ], radius: reached, level });
    if (this.chunks.length > 0) {
      const reach = reached + WATER_BANK_METRES;
      this.restampArea(centreX - reach, centreZ - reach, centreX + reach, centreZ + reach);
    }
    return mesh;"""
assert old in s
s = s.replace(old, new)

old = """const WATER_MARCH_METRES = 1;"""
new = """const WATER_MARCH_METRES = 1;

/**
 * How far past the caller's rect the shoreline search may reach, in metres.
 *
 * The basins are carved with a falloff of `cluster.radius + 16` while the water rect is
 * `cluster.radius + 14`, so the bowl is always slightly wider than the disc the caller asks for
 * and the disc would end in open water on every azimuth the terrain had not already closed. 14 m
 * covers that gap on all four basins with margin, and the search stops at the first crossing
 * anyway, so a pond can only get as big as the hole it sits in.
 */
const WATER_SEARCH_MARGIN = 14;"""
assert old in s
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
