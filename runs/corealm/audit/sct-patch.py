import io

p = 'game/src/world/scatter.ts'
s = io.open(p, encoding='utf8').read()

start = s.index("/**\n * The ground-cover pool, shared by all three regions.")
end = s.index("/**\n * Pebbles, plus the six previously unused")
new_cover = '''/**
 * The ground-cover pool, shared by all three regions.
 *
 * **Every species here is picked off its own UVs, not off its material name.** The nature kit's
 * `Leaves` atlas is one 512x512 sheet holding greens, a blue leaf, two orange leaves and a purple
 * clover side by side, so two assets on the same material can be opposite colours and a
 * whole-texture mean says nothing. Sampled at the UVs each mesh actually reads
 * (`runs/corealm/audit/sct-uvcolour.mjs`):
 *
 *     plant_leafy_small/large  rgb(107,146,16)  green    fern_1             rgb(121,166,10)  green
 *     grass_common_short/tall  rgb(121,171,32)  green    grass_wispy_*      rgb(182,159,0)   gold
 *     plant_broad_small/large  rgb(184,63,27)   RED      clover_1/2         rgb(220,95,34)   RED
 *     flower_a_* petals        rgb(216,116,106) salmon   flower_b_* petals  rgb(167,129,190) violet
 *
 * That table corrects a comment this file used to carry. `plant_broad_large` was described as "the
 * shared green `Leaves` texture, mean rgb(94,118,81)" and used as the green stand-in after
 * `bush_common` was banned for rendering red; it is rgb(184,63,27) at its own UVs, redder than the
 * bush it replaced. Carried at weight 3 in the first cut of this layer it turned every Fallowmarch
 * verge into purple cabbages - `runs/corealm/screenshots/sct-crop-bloom.png` is what that looked
 * like. `clover_1` has the same problem and was the old `bloom` layer's base.
 *
 * Scale bands are set against the manifest's native size so a prop lands at 0.3-0.65 m in world
 * space and, for the flat ones, under ~1.2 m across. Round 1 used `grass_common_short` (1.334 m
 * native) at [0.8, 1.5], i.e. 1.07-2.00 m - taller than the 1.8 m player - which is why the "grass"
 * read as scattered shrubs rather than as a surface.
 *
 * `grass_wispy_tall` and the second `fern_1` entry are shore-only: gold reeds standing out of the
 * water and a bigger damp-bank frond. That band is the only place in the world with a moisture rule.
 */
const GROUND_COVER: ScatterSpeciesSpec[] = [
  // 1.334 m native -> 0.32-0.64 m. 155 triangles.
  { assetId: "grass_common_short", weight: 5, scale: [0.24, 0.48] },
  // 1.014 m tall, 1.27 m wide native -> 0.30-0.61 m tall, 0.38-0.76 m across. 120 triangles: the
  // cheapest green leaf in the kit now that the broad-leaf mats are out.
  { assetId: "plant_leafy_small", weight: 4, scale: [0.3, 0.6] },
  // 0.840 m tall, 2.83 m wide native -> 0.19-0.36 m tall, 0.62-1.19 m across: a low frond mat, and
  // the flat silhouette the red broad-leaf plants used to supply.
  { assetId: "fern_1", weight: 2, scale: [0.22, 0.42], tilt: 1 },
  // 1.672 m native -> 1.25-2.09 m. Reeds stand plumb out of still water, so tilt is 0.
  { assetId: "grass_wispy_tall", weight: 5, scale: [0.75, 1.25], tilt: 0, sources: ["shore"] },
  // The same fern at damp-bank size. A second entry rather than a second asset: buckets are keyed
  // on asset id, so both sizes share one InstancedMesh and the variety costs no draw call.
  { assetId: "fern_1", weight: 3, scale: [0.45, 0.85], sources: ["shore"] },
];

'''
s = s[:start] + new_cover + s[end:]

head, table = s.split("export const DEFAULT_SCATTER", 1)

subs = [
(
"""        species: [
          { assetId: "plant_leafy_large", weight: 3 },
          { assetId: "plant_broad_large", weight: 2, scale: [0.9, 2.1], tilt: 1 },
        ],
        maxCount: 260, scale: [0.7, 1.25], tilt: 0.35, mirror: true,""",
"""        species: [
          { assetId: "plant_leafy_large", weight: 3 },
          // 1.672 m native -> 0.84-1.51 m of dry gold moor grass, rgb(182,159,0) at its own UVs.
          { assetId: "grass_wispy_short", weight: 2, scale: [0.8, 1.4], tilt: 0.2 },
        ],
        maxCount: 260, scale: [0.7, 1.25], tilt: 0.35, mirror: true,"""),
(
"""        // Was 104 instances of `bush_common`, whose only material is `Leaves_TwistedTree` — the
        // red-dominant autumn texture this same file removed from Vellenwood for rendering crimson.
        // Sampled mean rgb(105,79,84). It read as magenta blobs on olive grass in every Fallowmarch
        // screenshot. `bush_flowering` carries the same silhouette on `Leaves_NormalTree`+`Flowers`
        // and `plant_leafy_large` on the shared green `Leaves`, mean rgb(94,118,81).""",
"""        // Was 104 instances of `bush_common`, whose only material is `Leaves_TwistedTree` — the
        // red-dominant autumn texture this same file removed from Vellenwood for rendering crimson.
        // It read as magenta blobs on olive grass in every Fallowmarch screenshot. The replacement
        // is `plant_leafy_large` (rgb(107,146,16) at its UVs, 360 triangles against bush_common's
        // 900) and gold moor grass. `bush_flowering` was the obvious swap and is not used: it is
        // 1368 triangles across 2 primitives, i.e. twice the draw cost for one more silhouette."""),
(
"""          { assetId: "fern_1", weight: 3, scale: [0.7, 1.5], tilt: 0.8 },
          { assetId: "plant_broad_large", weight: 3, scale: [0.9, 2.0], tilt: 1 },
          // plant_leafy_large was dropped here rather than in Fallowmarch's bracken: it is the same
          // 2.35 m leafy volume in both, and one region carrying it is one draw call, not two.
          { assetId: "plant_leafy_small", weight: 3, scale: [0.5, 1.1] },""",
"""          { assetId: "fern_1", weight: 4, scale: [0.7, 1.5], tilt: 0.8 },
          { assetId: "plant_leafy_large", weight: 2 },
          { assetId: "plant_leafy_small", weight: 3, scale: [0.5, 1.1] },"""),
(
"""        // `bush_common` is deliberately absent even though it is the cheapest volume in the kit:
        // it shares `Leaves_TwistedTree` with the autumn tree and put a crimson mass at eye height
        // across the whole wood. `plant_broad_large` uses the shared green `Leaves` texture for the
        // same silhouette.""",
"""        // `bush_common` is deliberately absent even though it is the cheapest volume in the kit:
        // it shares `Leaves_TwistedTree` with the autumn tree and put a crimson mass at eye height
        // across the whole wood. `plant_broad_large` is NOT the green replacement this file used to
        // claim it was - it is rgb(184,63,27) at its own UVs, redder than the bush it replaced - so
        // the volume comes from ferns and the two leafy plants instead."""),
(
"""        species: [
          { assetId: "plant_leafy_small", weight: 3 },
          { assetId: "plant_broad_large", weight: 2, scale: [0.8, 1.8], tilt: 1 },
        ],
        maxCount: 480, scale: [0.6, 1.1], tilt: 0.5, mirror: true,""",
"""        species: [
          { assetId: "plant_leafy_small", weight: 3 },
          // Dry gold moor grass, rgb(182,159,0). The `plant_broad_large` that used to sit here is
          // rgb(184,63,27) - the same red the `bush_common` swap was made to get rid of.
          { assetId: "grass_wispy_short", weight: 3, scale: [0.7, 1.3], tilt: 0.2 },
        ],
        maxCount: 480, scale: [0.6, 1.1], tilt: 0.5, mirror: true,"""),
(
"""        // Was 134 instances of `bush_common` and the same red-material problem as Fallowmarch's
        // bracken. `plant_leafy_small` is 120 triangles against bush_common's 900 and green.""",
"""        // Was 134 instances of `bush_common` and the same red-material problem as Fallowmarch's
        // bracken. `plant_leafy_small` is 120 triangles against bush_common's 900, and green."""),
]
for old, new in subs:
    assert old in table, old[:80]
    table = table.replace(old, new, 1)

io.open(p, 'w', encoding='utf8', newline='\n').write(head + "export const DEFAULT_SCATTER" + table)
print("ok")
