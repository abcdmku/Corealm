import io

p = 'game/src/render/scene.ts'
s = io.open(p, encoding='utf-8').read()

start = s.index('  buildWater(rect: Rect, level: number, regionId: RegionId): THREE.Mesh {')
end = s.index('  // ------------------------------------------------------------- scatter')

new = r'''  buildWater(rect: Rect, level: number, regionId: RegionId): THREE.Mesh {
    const centreX = (rect.minX + rect.maxX) / 2;
    const centreZ = (rect.minZ + rect.maxZ) / 2;
    const maxRadius = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2;
    // See `WATER_SHORE_ARC`: the spoke count follows the body, so the shoreline is always solved
    // at the terrain lattice's own 2 m spacing rather than at a fixed 32 azimuths.
    const segments = clamp(
      Math.round((2 * Math.PI * maxRadius) / WATER_SHORE_ARC),
      WATER_MIN_SEGMENTS,
      WATER_MAX_SEGMENTS,
    );

    // Shoreline distance per azimuth: the FIRST radius at which the drawn ground crosses the
    // surface, found by marching outward and then bisecting inside the step it crossed in.
    //
    // This was a pure bisection with an early-out that returned `maxRadius` whenever the ground at
    // maxRadius was below the level, on the stated reasoning that the bank is monotonic over the
    // basin's falloff. Measured, it is not: on a 1 m grid, 11% of the Redsill and Cairn Tarn disc
    // footprints stood ABOVE the surface by up to 2.12 m, because a spur crosses the plane at
    // r = 21 and drops back under it by r = 23, and the early-out drew straight over the top of it.
    // Marching finds the first crossing by construction, which is the definition of a shoreline.
    const shoreline = new Float64Array(segments);
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
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
    }

    const rings = WATER_RINGS;
    const vertexCount = 1 + segments * rings;
    const positions = new Float32Array(vertexCount * 3);
    const depths = new Float32Array(vertexCount);
    const indices: number[] = [];

    depths[0] = Math.max(0, level - this.meshHeightAt(centreX, centreZ));
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const reach = shoreline[step]!;
      for (let ring = 0; ring < rings; ring += 1) {
        // Biased so the rings bunch toward the rim; see `WATER_RING_BIAS`.
        const radius = reach * Math.pow((ring + 1) / rings, WATER_RING_BIAS);
        const index = 1 + step * rings + ring;
        const x = dx * radius;
        const z = dz * radius;
        positions[index * 3] = x;
        positions[index * 3 + 2] = z;
        // The outer ring is the edge of the surface whether the terrain closed it or the caller's
        // rect did, so it carries zero depth in both cases and the material fades it out; measured,
        // that is 26 of 32 azimuths on the Redsill basin, where the ground under the rim is still
        // 0.6-0.8 m below the surface.
        //
        // The taper inside it is `WATER_EDGE_METRES` of real bank rather than one ring, because a
        // ring is `reach / rings` metres wide and that is 1.9 m at Redsill against 0.21 m at a pool
        // that only cleared `WATER_MIN_RADIUS` — the wet edge used to be eight times wider on a big
        // pond than on a small one for no reason but the tessellation.
        const trueDepth = Math.max(0, level - this.meshHeightAt(centreX + x, centreZ + z));
        depths[index] = ring === rings - 1
          ? 0
          : trueDepth * clamp((reach - radius) / WATER_EDGE_METRES, 0, 1);
      }
    }

    for (let step = 0; step < segments; step += 1) {
      const next = (step + 1) % segments;
      const a0 = 1 + step * rings;
      const b0 = 1 + next * rings;
      indices.push(0, b0, a0);
      for (let ring = 0; ring < rings - 1; ring += 1) {
        const a = a0 + ring;
        const b = b0 + ring;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aWaterDepth", new THREE.BufferAttribute(depths, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.materials.water(regionId));
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
    for (let step = 0; step < segments; step += 1) reached = Math.max(reached, shoreline[step]!);
    this.waters.push({ centre: [centreX, centreZ], radius: reached, level });
    if (this.chunks.length > 0) {
      const reach = reached + WATER_BANK_METRES;
      this.restampArea(centreX - reach, centreZ - reach, centreX + reach, centreZ + reach);
    }
    return mesh;
  }

'''

s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
