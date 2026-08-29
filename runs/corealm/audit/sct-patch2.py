import io

p = 'game/src/world/scatter.ts'
s = io.open(p, encoding='utf8').read()

subs = []

# ---------------------------------------------------------------- profile gains a settlement band
subs.append((
"""export interface ExclusionProfile {
  base: ExclusionBand;
  byKind?: Partial<Record<ExclusionKind, ExclusionBand>>;
}""",
"""export interface ExclusionProfile {
  base: ExclusionBand;
  byKind?: Partial<Record<ExclusionKind, ExclusionBand>>;
  /**
   * Band against a settlement's own authored buildings, wall runs, paving and props, which are a
   * separate zone set from the root's one 46 m ring per settlement. Defaults to `base`.
   */
  authored?: ExclusionBand;
}"""))

# ---------------------------------------------------------------- footprints become many small zones
old_footprint_start = s.index("""/**
 * Settlement footprints measured from the authored content, not from the root's 46 m ring.""")
old_footprint_end = s.index("/** Region terrain envelope, for the altitude rules. */")
new_footprint = '''/**
 * A settlement's own geometry, as one zone per authored thing rather than one disc round the lot.
 *
 * The root registers every settlement as a single 46 m circle. A boolean test on that circle is
 * what produced the bare disc in every settlement screenshot, and an enclosing circle measured off
 * the content is barely better: Coldbrace's wall runs reach ~40 m from its centre, so one disc that
 * clears them clears the entire approach as well. Registering the buildings, the wall runs, the
 * paving and the props separately lets grass grow in the yards, along the foot of the wall and
 * right up to the gate, and still keeps it out of a cottage.
 *
 * Everything here is read from `content/regions.ts`, so a settlement that gains a wall or a paved
 * square in a later pass pushes the planting back on its own.
 */
function authoredZones(regionId: RegionId): ExclusionZones {
  const zones = new ExclusionZones();
  const settlement = REGIONS.find((entry) => entry.id === regionId)?.settlement;
  if (!settlement) return zones;

  for (const building of settlement.buildings) {
    // Circumscribed circle of the footprint, so the zone is right whatever the rotation is, plus
    // ROOF_EAVE_METRES (0.79, render/buildings.ts) rounded up for the overhang.
    const [width, depth] = building.footprint;
    zones.addCircle(
      building.position[0], building.position[1],
      Math.hypot(width, depth) / 2 + 1, "settlement", building.id,
    );
  }
  for (const wall of settlement.walls ?? []) {
    const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    const steps = Math.max(1, Math.ceil(length / 2.5));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      zones.addCircle(
        wall.from[0] + (wall.to[0] - wall.from[0]) * t,
        wall.from[1] + (wall.to[1] - wall.from[1]) * t,
        1.8, "settlement", wall.id,
      );
    }
  }
  for (const paving of settlement.paving ?? []) {
    zones.addRect(paving.rect, 0.5, "settlement", paving.id);
  }
  for (const station of settlement.stations) zones.addCircle(station.position[0], station.position[1], 1.8, "custom", station.id);
  for (const shop of settlement.shops) zones.addCircle(shop.position[0], shop.position[1], 2.2, "custom", shop.id);
  zones.addCircle(settlement.bank.position[0], settlement.bank.position[1], 2.2, "custom", settlement.bank.id);
  for (const prop of settlement.props ?? []) zones.addCircle(prop.position[0], prop.position[1], 1.4, "custom", prop.id);
  for (const npc of settlement.npcs) zones.addCircle(npc.position[0], npc.position[1], 1.2, "custom", npc.id);
  return zones;
}

'''
s = s[:old_footprint_start] + new_footprint + s[old_footprint_end:]

# ---------------------------------------------------------------- context
subs.append((
"""  waters: WaterBody[];
  settlements: SettlementFootprint[];""",
"""  waters: WaterBody[];
  authored: ExclusionZones;"""))
subs.append((
"""    waters: measureWaterBodies(scene, regionId),
    settlements: settlementFootprints(regionId),""",
"""    waters: measureWaterBodies(scene, regionId),
    authored: authoredZones(regionId),"""))

# ---------------------------------------------------------------- site test
subs.append((
"""  for (const settlement of ctx.settlements) {
    if (Math.hypot(x - settlement.x, z - settlement.z) < settlement.radius) return 0;
  }""",
"""  factor *= ctx.authored.densityAt(x, z, { base: profile.authored ?? profile.base });
  if (factor <= 0) return 0;"""))

# ---------------------------------------------------------------- profiles
subs.append((
"""const TREE_EXCLUSION: ExclusionProfile = {
  base: { hard: 6, fade: 14 },
  byKind: {
    settlement: { hard: 9, fade: 30 },
    road: { hard: 5, fade: 12 },
    cluster: { hard: 5, fade: 10 },
    spawn: { hard: 9, fade: 20 },
  },
};""",
"""const TREE_EXCLUSION: ExclusionProfile = {
  base: { hard: 6, fade: 14 },
  byKind: {
    settlement: { hard: 9, fade: 30 },
    road: { hard: 5, fade: 12 },
    cluster: { hard: 5, fade: 10 },
    spawn: { hard: 9, fade: 20 },
  },
  authored: { hard: 6, fade: 12 },
};"""))
subs.append((
"""const SHRUB_EXCLUSION: ExclusionProfile = {
  base: { hard: 2.5, fade: 9 },
  byKind: {
    settlement: { hard: 1, fade: 22 },
    road: { hard: 3, fade: 6 },
    cluster: { hard: 2, fade: 6 },
    spawn: { hard: 4, fade: 12 },
  },
};""",
"""const SHRUB_EXCLUSION: ExclusionProfile = {
  base: { hard: 2.5, fade: 9 },
  byKind: {
    settlement: { hard: -12, fade: 26 },
    road: { hard: 3, fade: 6 },
    cluster: { hard: 2, fade: 6 },
    spawn: { hard: 4, fade: 12 },
  },
  authored: { hard: 2.5, fade: 6 },
};"""))
subs.append((
"""const COVER_EXCLUSION: ExclusionProfile = {
  base: { hard: 0.6, fade: 3 },
  byKind: {
    settlement: { hard: -14, fade: 18 },
    road: { hard: 2.6, fade: 3 },
    cluster: { hard: -0.5, fade: 4 },
    spawn: { hard: 1, fade: 6 },
  },
};""",
"""const COVER_EXCLUSION: ExclusionProfile = {
  base: { hard: 0.6, fade: 3 },
  byKind: {
    settlement: { hard: -36, fade: 24 },
    road: { hard: 2.6, fade: 3 },
    cluster: { hard: -0.5, fade: 4 },
    spawn: { hard: 1, fade: 6 },
  },
  authored: { hard: 0.8, fade: 2.5 },
};"""))
subs.append((
"""const LITTER_EXCLUSION: ExclusionProfile = {
  base: { hard: 0.5, fade: 3 },
  byKind: {
    settlement: { hard: -12, fade: 14 },
    road: { hard: -1, fade: 2 },
    cluster: { hard: 0, fade: 3 },
    spawn: { hard: 0.5, fade: 4 },
  },
};""",
"""const LITTER_EXCLUSION: ExclusionProfile = {
  base: { hard: 0.5, fade: 3 },
  byKind: {
    settlement: { hard: -38, fade: 20 },
    road: { hard: -1, fade: 2 },
    cluster: { hard: 0, fade: 3 },
    spawn: { hard: 0.5, fade: 4 },
  },
  authored: { hard: 0.5, fade: 2 },
};"""))

# ---------------------------------------------------------------- doc for the cover profile
subs.append((
"""/**
 * Ground cover. Reaches 14 m INSIDE the root's 46 m settlement ring, because that ring is twice the
 * measured extent of the largest settlement and a town with a shaved lawn around it reads as a
 * decal. The buildings themselves are protected by `settlementFootprints`, which is measured from
 * the authored content and grows with it.
 */""",
"""/**
 * Ground cover. Reaches 36 m INSIDE the root's 46 m settlement ring, i.e. almost all the way to a
 * settlement's centre, because that ring is a placeholder: a town with a shaved lawn around it
 * reads as a decal stuck on a field. What actually keeps grass off a doorstep is `authoredZones`,
 * one small zone per building, wall segment, paving rect and prop.
 */"""))

for old, new in subs:
    assert old in s, old[:90]
    s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf8', newline='\n').write(s)
print("ok")
