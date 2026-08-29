import io

p = 'game/src/render/buildings.ts'
s = io.open(p, encoding='utf-8').read()

start = s.index('/**\n * The Gravelmaw. PRD:')
end = s.index('/** Somebody has cut steps into the north face of it. */')

new = r'''/**
 * The Gravelmaw. PRD: "a twelve-metre black wound in grey stone, visible from anywhere on terrace
 * one". The arch itself is the dungeon portal entity (`wall_arch` at 4x, drawn 6.14 m wide and
 * 10.43 m tall, clear opening 72% of the panel = 4.42 m); this builds the stone around it.
 *
 * WHY EVERY PART IS A `rock_medium_*` AND NOT A `cliff_*` OR `boulder_*`. Measured on the shipped
 * GLBs: the six ultimate-platformer rocks - boulder_large, boulder_medium, cliff_tall,
 * cliff_step_1..3 - carry POSITION and NORMAL and NOTHING ELSE. No TEXCOORD_0, no texture, no
 * vertex colour; one flat `baseColorFactor` (0.384, 0.208, 0.108) on a doubleSided material. They
 * CANNOT be textured, at any tier, by any material swap, because there are no UVs to sample with.
 * At the 1.7-2.6x scales this composition used they drew as 8.9 m wide smooth tan truncated cones
 * and were most of runs/corealm/screenshots/w3-gravelmaw_entrance.png. The
 * stylized-nature-megakit rocks (`rock_medium_1/2/3`, 3.0-3.4 m) carry TEXCOORD_0 and an embedded
 * `Rocks_Diffuse` jpeg, so they are the only rock in the library that reads as stone.
 *
 * AND WHY NOTHING REACHES PAST 9.3 m. `world/regionBuilder.emitParts` places every composition part
 * at `origin.y + dy` - flat, with no terrain sample of its own - so a part's grounding error is
 * exactly how far the terrain has moved by the time you get out to it. Measured around (46, -24)
 * with `__gameDebug.groundHeight` (runs/corealm/audit/wd-probe.json): +-0.14 m at 3 m, -1.01 m at
 * 5 m, -1.57 m at 7 m, -2.13 m at 9 m and -3.37 m at 13 m, all of it on the downhill approach.
 * The old `shoulder_l` at 13.4 m floated 3.03 m, `spoil_l` at 15.2 m floated 3.22 m, and the
 * `brow` at dy 6.0 floated 5.59 m with daylight under a 19.9 m wide rock. Everything here is
 * inside 9.3 m and sunk 0.5-0.9 m, so the worst measured local ground still buries its footing.
 *
 * Local +Z faces the approach from the Lower Quarry. The corridor between the spoil heaps is 7 m
 * clear, so the mouth stays reachable by `moveTo({ entityId: "gravelmaw_mouth_portal" })`.
 */
function gravelmawMouth(): PartPlacement[] {
  return [
    // The two jaws, three courses each, leaning in over the arch. Outer faces at +-9.9 m, inner
    // faces at -3.3 and +3.3, which clears the 4.42 m opening on both sides.
    loose("jaw_l", "rock_medium_3", -6.6, -0.5, 0.2, 0.55, 2.2),
    loose("jaw_r", "rock_medium_1", 6.6, -0.5, 0.2, -1.15, 2.35),
    loose("rock_l", "rock_medium_1", -6.0, 2.6, -0.4, 2.35, 1.8),
    loose("rock_r", "rock_medium_3", 6.0, 2.6, -0.4, 0.85, 1.75),
    loose("crown_l", "rock_medium_2", -5.6, 5.2, 0.3, 1.6, 1.4),
    loose("crown_r", "rock_medium_2", 5.6, 5.2, 0.3, -0.4, 1.35),
    // Behind the arch, so the opening leads into rock rather than into sky. Its solid is capped by
    // `emitComposition` (4.6 m out against a 3.3 m half-diagonal), which keeps the portal's own
    // 2.4 m interact ring clear.
    loose("brow", "rock_medium_3", -0.2, -0.7, -4.6, 1.9, 2.2),
    loose("shoulder_l", "rock_medium_3", -9.2, -0.8, -1.0, 1.1, 2.0),
    loose("shoulder_r", "rock_medium_3", 9.2, -0.8, -1.0, -0.7, 2.05),
    // Spoil at the lip, on the falling ground, sunk deeper for it.
    loose("spoil_l", "rock_medium_2", -5.0, -0.9, 5.5, 0.8, 1.15),
    loose("spoil_r", "rock_medium_1", 5.0, -0.9, 5.5, 2.2, 1.05),
    loose("rubble_l", "rock_medium_2", -3.3, -0.7, 7.4, 2.6, 0.7),
    loose("rubble_r", "rock_medium_3", 3.6, -0.7, 7.0, 0.4, 0.6),
    // `torch` base.y is -0.278, so at 2.6x it hangs 0.63 m below its own pivot: dy 0.5 stands it on
    // the ground instead of leaving the head floating 1.7 m up, which is where dy 1.7 left it.
    loose("brazier_l", "torch", -4.4, 0.5, 1.4, 0, 2.6),
    loose("brazier_r", "torch", 4.4, 0.5, 1.4, 0, 2.6),
  ];
}

/**
 * The Great Cairn: a clad heap. "Head height and forty paces round", and Karrowmoor's navigation
 * beacon, so it has to read as stacked stone against the sky from 30 m.
 *
 * The hero mesh is `boulder_large` at 1.3 and it is NOT this file's to change - it is
 * `content/regions.ts`. It draws 8.39 m across and 4.26 m tall and, for the reason set out on
 * `gravelmawMouth`, it is an untextured tan cone that no material can fix. So this composition
 * CLADS it: eight ring stones on 45 degree centres at radius 3.6-3.9, each 3.6-4.6 m wide, is
 * about 150% of the circumference at that radius, and four crown stones cover the top.
 *
 * Grounding, measured at (140, -176) with `__gameDebug.groundHeight`: the ground is level to
 * +-0.15 m at 3 m and falls 0.74 m at 5 m on one bearing only. A uniform dy of -0.55 therefore
 * buries every ring stone by 0.3-1.2 m, which is what a cairn's footings look like, and nothing
 * floats. The old five-part version put `flank_l` 4.75 m out at dy 0 and it floated 0.53 m.
 */
function greatCairn(): PartPlacement[] {
  const out: PartPlacement[] = [];
  // Asset, radius, scale and yaw vary per index so the ring is not eight copies of one silhouette.
  // Authored rather than seeded: a landmark has to look the same in every screenshot of it.
  const ring: readonly (readonly [string, number, number, number])[] = [
    ["rock_medium_1", 3.7, 1.55, 0.4],
    ["rock_medium_3", 3.9, 1.45, 2.1],
    ["rock_medium_2", 3.6, 1.60, 1.2],
    ["rock_medium_1", 3.8, 1.40, 2.9],
    ["rock_medium_3", 3.7, 1.50, 0.8],
    ["rock_medium_2", 3.9, 1.55, 2.4],
    ["rock_medium_1", 3.6, 1.45, 1.7],
    ["rock_medium_3", 3.8, 1.55, 0.2],
  ];
  for (const [index, entry] of ring.entries()) {
    const [assetId, radius, scale, yaw] = entry;
    const angle = (index / ring.length) * Math.PI * 2 + 0.26;
    out.push(loose(
      `ring${index}`, assetId,
      Math.cos(angle) * radius, -0.55, Math.sin(angle) * radius, yaw, scale,
    ));
  }
  // The crown. The hero's top is 4.26 m above the origin, so a crown stone at dy 3.4 beds INTO it
  // rather than balancing on it, and the capstone at 5.1 beds into the crown.
  out.push(loose("crown_1", "rock_medium_1", 0.4, 3.4, 0.2, 1.4, 1.35));
  out.push(loose("crown_2", "rock_medium_3", -1.2, 3.3, -1.1, 2.7, 1.15));
  out.push(loose("crown_3", "rock_medium_2", 1.2, 3.6, -1.0, 0.5, 1.05));
  out.push(loose("cap", "rock_medium_2", 0.1, 5.1, -0.1, 1.9, 0.8));
  // The two outliers that make it read as a heap somebody built rather than a rock that grew there.
  out.push(loose("flank_l", "rock_medium_2", -5.4, -0.5, 1.4, 1.1, 0.95));
  out.push(loose("skirt", "rock_medium_1", 5.3, -0.5, 2.2, 0.3, 0.85));
  return out;
}

/**
 * Four uprights in a ring around the hero boulder. The edge the Thornbound will not cross.
 *
 * `cliff_tall` was the upright and it is one of the six untextured platformer rocks
 * (`gravelmawMouth` carries the measurement), so all four read as smooth tan cones.
 * `rock_medium_*` are the textured alternative and they are boulders rather than menhirs, which is
 * the trade this library forces.
 *
 * Each stone carries its own dy because the ground here is NOT level: measured at (206, 168) on the
 * ring radius the four bearings differ by 1.88 m (-0.94, +0.26, +0.23, +0.94), and one shared dy
 * either floats the low stone or buries the high one to its shoulders.
 */
function standingStones(rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const stones: readonly (readonly [string, number])[] = [
    ["rock_medium_1", -1.49],
    ["rock_medium_3", -0.29],
    ["rock_medium_1", -0.32],
    ["rock_medium_3", 0.39],
  ];
  for (const [index, entry] of stones.entries()) {
    const [assetId, dy] = entry;
    const angle = (index / stones.length) * Math.PI * 2 + 0.4;
    out.push(loose(
      `stone${index}`, assetId,
      Math.cos(angle) * 5.4, dy, Math.sin(angle) * 5.4,
      rng.float(0, Math.PI * 2), rng.float(1.15, 1.45),
    ));
  }
  out.push(loose("low_1", "rock_medium_2", 2.6, -0.35, 3.4, 1.1, 1.0));
  out.push(loose("low_2", "rock_medium_1", -3.1, -0.35, -2.8, 2.5, 0.8));
  return out;
}

'''

s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
