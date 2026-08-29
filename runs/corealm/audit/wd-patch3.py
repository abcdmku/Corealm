import io

p = 'game/src/render/buildings.ts'
s = io.open(p, encoding='utf-8').read()

old = '''    loose("brow", "rock_medium_3", -0.2, -0.7, -4.6, 1.9, 2.2),
'''
new = '''    loose("brow", "rock_medium_3", -0.2, -0.7, -4.6, 1.9, 3.0),
    loose("brow_top", "rock_medium_1", 0.6, 3.4, -5.6, 0.7, 2.4),
'''
assert old in s
s = s.replace(old, new, 1)

old_cairn_start = s.index('function greatCairn(): PartPlacement[] {')
old_cairn_end = s.index('\n/**\n * Four uprights in a ring around the hero boulder.')
new_cairn = '''function greatCairn(): PartPlacement[] {
  const out: PartPlacement[] = [];
  // The lower course. Asset, radius, scale and yaw vary per index so the ring is not eight copies
  // of one silhouette; authored rather than seeded, because a landmark has to look the same in
  // every screenshot of it. Each stone tops out 2.4-2.7 m above the origin.
  const ring: readonly (readonly [string, number, number, number])[] = [
    ["rock_medium_1", 3.4, 1.85, 0.4],
    ["rock_medium_3", 3.6, 1.75, 2.1],
    ["rock_medium_2", 3.3, 1.90, 1.2],
    ["rock_medium_1", 3.5, 1.70, 2.9],
    ["rock_medium_3", 3.4, 1.80, 0.8],
    ["rock_medium_2", 3.6, 1.85, 2.4],
    ["rock_medium_1", 3.3, 1.75, 1.7],
    ["rock_medium_3", 3.5, 1.85, 0.2],
  ];
  for (const [index, entry] of ring.entries()) {
    const [assetId, radius, scale, yaw] = entry;
    const angle = (index / ring.length) * Math.PI * 2 + 0.26;
    out.push(loose(
      `ring${index}`, assetId,
      Math.cos(angle) * radius, -0.55, Math.sin(angle) * radius, yaw, scale,
    ));
  }
  // The second course, bedded into the first at 1.8 and reaching 4.4 - which is where the hero's
  // own 4.26 m crown is, so nothing of the untextured cone is left showing between the two rings.
  const mid: readonly (readonly [string, number, number])[] = [
    ["rock_medium_2", 1.45, 2.6],
    ["rock_medium_1", 1.40, 0.9],
    ["rock_medium_3", 1.35, 1.9],
    ["rock_medium_2", 1.50, 0.3],
    ["rock_medium_1", 1.30, 2.2],
  ];
  for (const [index, entry] of mid.entries()) {
    const [assetId, scale, yaw] = entry;
    const angle = (index / mid.length) * Math.PI * 2 + 0.9;
    out.push(loose(
      `mid${index}`, assetId,
      Math.cos(angle) * 2.4, 1.8, Math.sin(angle) * 2.4, yaw, scale,
    ));
  }
  // The crown, and one capstone. 5.7 m above the ground at the top, which is what "visible against
  // the sky" from 30 m needs; the blurb's "head height" is content's number and predates the hero
  // mesh, which is 4.26 m on its own before anything is stacked on it.
  out.push(loose("crown_1", "rock_medium_1", 0.4, 3.4, 0.2, 1.4, 1.35));
  out.push(loose("crown_2", "rock_medium_3", -1.2, 3.3, -1.1, 2.7, 1.15));
  out.push(loose("crown_3", "rock_medium_2", 1.2, 3.6, -1.0, 0.5, 1.05));
  out.push(loose("cap", "rock_medium_2", 0.1, 4.4, -0.1, 1.9, 0.8));
  // The two outliers that make it read as a heap somebody built rather than a rock that grew there.
  out.push(loose("flank_l", "rock_medium_2", -5.4, -0.5, 1.4, 1.1, 0.95));
  out.push(loose("skirt", "rock_medium_1", 5.3, -0.5, 2.2, 0.3, 0.85));
  return out;
}
'''
s = s[:old_cairn_start] + new_cairn + s[old_cairn_end:]

# the doc comment above greatCairn quotes the old ring radii; keep it accurate
s = s.replace(
    ' * CLADS it: eight ring stones on 45 degree centres at radius 3.6-3.9, each 3.6-4.6 m wide, is\n'
    ' * about 150% of the circumference at that radius, and four crown stones cover the top.\n',
    ' * CLADS it, in three courses: eight stones on 45 degree centres at radius 3.3-3.6 (each 4.3-5.6 m\n'
    ' * wide, which is about 190% of the circumference at that radius), five more bedded into their\n'
    ' * tops at dy 1.8, and a crown of four. Nothing of the cone is left visible.\n', 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
