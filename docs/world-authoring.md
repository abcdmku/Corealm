# World authoring

This is the short path for changing terrain, biomes, water, coast, paths, foliage, and wind without
creating a second world system.

## Relationship to the feature lab

This workflow owns proof of the authored full world: terrain and coast shape, biome fields, water placement, world-scale scatter and paths, final wind composition, world layout, and island-scale navigation. Those concerns may use a recorded exception to the lab-first gate because isolating them would remove the behavior under test.

Keep the exception narrow. Build reusable structures, foliage assets, materials, wind response, effects, UI, controls, and local interactions in the production-backed feature lab first. The root accepts that lab proof before the world-authoring step places or composes the feature in the final world. If a task mixes reusable feature work with world generation, split those into lab and integration phases.

## Authority and ownership

- `game/src/contracts.ts` is frozen shared state. Stop and report if a task needs a contract change;
  the root changes the contract and all callers together.
- `game/src/content/regions.ts` owns semantic regions, locations, settlements, resource clusters, and
  interactable content. Its coordinates drive quests, navigation, and player region state.
- `game/src/app/worldSpec.ts` is the authored Corealm terrain and visual-field configuration. It is
  root-owned and frozen while workers are changing world details.
- `game/src/world/organicFields.ts` owns reusable deterministic math, including biome, coast, and
  lake-shape sampling. `game/src/world/waterBodies.ts` owns lake profile dimensions.
- `game/src/app/worldSurface.ts` turns authored roads, paving, and fishing clusters into surface
  stamps and water work. `game/src/render/scene.ts` owns terrain sampling, rendering, and wind.
- `game/src/world/scatter.ts` owns non-interactable dressing. Grass, trees, flowers, ferns, and loose
  stones belong here. A tree that can be chopped does not.

Give concurrent agents distinct files. Do not change `contracts.ts` or `worldSpec.ts` to make a local
task easier.

## Semantic regions and visual biomes

The authored region rectangles remain exact. They own `regionAt()`, player state, quests, routes, and
playable bounds. The source `worldBounds` and map markers use those same canonical gameplay bounds.
These rectangles are semantic ownership, not the shape of the land. They may still be useful as
content envelopes, but they must never be used as visual biome masks or scatter limits.

Terrain relief, palette, scatter, and `sampleWorld()` use one normalized competing field from
`sampleOrganicBiomeWeights()`. It samples two broad climate channels, moisture and exposure, from
deterministic multi-scale noise. Each visual biome names a climate target and tolerance, then adds
small raw-coordinate intent anchors and bounded corridors around authored places. A shared softmax
turns those scores into weights, so the same organic lobes and ecotones drive every visual consumer.
An anchor's hold radius is a guaranteed circular core: every point through that radius resolves to its
field. Beyond the core, the anchor feathers smoothly to its broader influence radius without drawing a
rectangle around it. Corridors guide a biome between intents, but their finite half-width never pins a
long straight border.

The field may cross a semantic rectangle, but never moves a location or changes gameplay ownership.
Relief still flows through the single `heightAtXZ()` source used to build terrain, the physics
heightfield, navigation input, and entity placement. Never add a render-only height sampler or write
biome weights into content or saved state.

The coast is render-only. `sampleOrganicCoast()` keeps the canonical rectangle dry, then walks one
continuous periodic turn around a rounded rectangle reference. A five-band quintic value-noise fBm
(3, 7, 15, 31, and 63 cells) creates the broad reach. Separate 63, 127, and 255 cell bands add only
8 m, 3 m, and 1.5 m of detail after shaping, so smaller inlets stay visible without becoming long
spikes. The result is one connected fractal contour rather than a collection of ellipse lobes. Short
join bridges soften the descent where a side meets a corner without changing the shoreline contour.
Dry headlands inherit the actual organic biome relief and material sampling, so the continuation
does not become a flat shore. The shoreline range is 18-190 m and the rendered collar is 210 m,
leaving a 20 m guaranteed margin beyond the furthest reach. Map padding rounds beyond that to 250 m,
while markers and source `worldBounds` remain the canonical playable bounds. Do not add an ocean
region, expand playable bounds, or make the collar walkable.

## Organic fields and lakes

Use the deterministic helpers in `organicFields.ts` rather than adding another noise or shape system.
Use `seedFromText()` with a stable authored ID. For a new biome, set a climate target and tolerance,
then place several small anchors at meaningful places. Set `holdRadius` for an exact guaranteed core,
then let the sampler feather it out to the anchor's broader `radius`. Use a bounded corridor only where
a biome should have a soft connection between two intents. Keep anchors in raw world coordinates so
they stay attached when climate noise changes. The shared softmax keeps competing weights covered and
normalized, so a seam cannot collapse to an arbitrary fallback. Never use `Math.random()` in world
generation.

Do not add an ellipse or rectangle-sized backstop for a biome. Large backstops recreate the old
three-block map and make every border follow a canonical axis. If the open land needs more coverage,
tune the climate targets, tolerances, and seed instead. The `world-preview` census should show every
authored centre owning its field with a useful margin and the raster should show lobes that double
back, fork, and reach the coast without a long axis run.

Lakes share one `OrganicShapeSpec` across every nested ring. `waterBasinForCluster()` remains the
authority for floor, shore, crest, and outer radii and water depth. Use the same organic distance for
the terrain carve and wet bank. `getWaterBodies()` and its solved, closed contours are the downstream
authority for water rendering and shoreline scatter. Do not recreate a lake with a circle or nominal
basin guide.

## Paths and ground stamps

`collectRoadStamps()` keeps authored endpoints and gate-axis controls. `scene.curveRoadPolyline()` adds
the deterministic broad meander, up to 9 m. `RoadStamp.width` controls the worn track, fade, and verge;
keep width drift restrained. `getRoadPolylines()` is the authority for the drawn path used by the map,
scatter, and exclusions. The visual path stamp does not deform terrain; navigation and route costs
remain authored independently.

Roads, paving, and waterlogged banks are stamped into the ground surface. Keep their placement on the
same sampled surface rather than laying duplicate geometry over it.

## Foliage and scatter recipes

`DEFAULT_SCATTER` uses a simple 1.95 budget scale to keep density steady while the visual island is
larger than the playable rectangle. Normal biome recipes sample all dry visual land through
`getScatterBounds(Infinity)` and `scatterSurfaceAt()`, so grass, trees, ferns, flowers, stones, and
other dressing continue into the organic coastal lobes. The six old coast-duplicate layers are gone.
Do not add a special coast-only copy when a normal biome recipe can cover the surface.

`bladecarpet` is for broad overlapping fields of grass sprites, while `groundcover` and accent layers
carry smaller, sparser mesh dressing. Keep flowers, ferns, stones, and broad plants from inheriting
the grass field's density. Road and water-bank layers follow `getRoadPolylines()` and solved water
contours. The visual biome lobes use global authored and water exclusions, so landmarks and lakes stay
readable without bringing back a rectangular cutoff. The scatter envelope and sampled surface are
visual only, outside physics, navigation, and click terrain. Register gameplay footprints through
`worldExclusions` and use a fade instead of a hard settlement circle.

After a scatter change, inspect `getScatterStats()`: the expected layers must place instances, missing
assets must stay empty, and density increases must fit the available triangle and draw-call budget.

## Wind

Wind is shader movement, not authored animation. Use `MaterialLibrary.wind(source, strength)`, which
preserves the source shader hook and reuses the patched material. `MaterialLibrary.setTime()` advances
it. Target flexible material families such as grass, `Leaves`, `Leaves_NormalTree`, `Leaves_Pine`,
`Leaves_TwistedTree`, `Flowers`, and `MI_Vine`.

Keep roots and trunks fixed. Displacement should grow with vertex height and vary phase by world,
instance, or batch position. Flowers and grass can move more than a tree crown. Rocks, buildings,
mushrooms, dead wood, spent trees, and collision never move. If code clones or
replaces a material, apply `wind()` after that step.

## Seeds

The same world seed must produce the same terrain, contours, field weights, path curves, and scatter
layout.

- Derive seeds from stable region, layer, lake, or feature IDs. Scatter uses an independent stream
  from the world seed, region ID, and layer ID.
- Do not consume one shared random stream across layers. Adding a flower layer must not move every tree.
- Renaming an authored ID intentionally changes its generated result. Treat IDs as saved authoring
  inputs, not display copy.

## Preview and browser probes

Run the cheap SVG preview while tuning fields:

```bash
npm run world-preview
npm run world-preview -- runs/local-worldgen/my-preview.svg
```

The preview samples the exact runtime biome and coast math at each actual rendered x/z, including the
outside collar. The blended raster is the material that the scene sees; dark seams mark the winning
field. Each intent has a labeled centre marker, a dashed influence radius, and a smaller guaranteed
hold radius.
Corridors appear as translucent bands with a centre line and midpoint cap showing their half-width.
Dashed semantic rectangles stay visible as secondary ownership guides. The legend explains the marks,
and the CLI prints winner coverage plus each authored centre's winning weight and margin. It writes the
gitignored `runs/local-worldgen/worldgen-preview.svg` by default and refuses non-`.svg` targets. It is
a bounded field check, not proof that the Three.js scene is readable.

Authoring workflow:

1. Add a few small anchors at named places in the relevant biome field. Give important hubs an explicit
   `holdRadius` for an exact guaranteed core, then let the sampler feather to the influence `radius`.
2. Add only short, bounded corridors where a biome should connect two intents. Keep their half-width
   modest and let climate noise shape the edges.
3. Run `npm run world-preview`. Confirm every centre owns its field with a positive margin, transitions
   are broad enough to read as ecotones, and no border follows one semantic x or z axis for a long run.
4. Check the coast and lakes separately, then regenerate the in-game map and inspect the real browser
   scene. The coastline is an approved render-only field and should not be folded into biome ownership.

Never solve missing coverage by adding a broad rectangle-sized backstop. That turns the visual field
back into the semantic map and restores hard cutoffs.

Regenerate the actual in-game map when the shape is ready:

```bash
npm run world-map
```

This captures the real scene into the padded `game/public/generated/world-map.png` and `.json`, plus
`game/src/generated/worldMapFingerprint.ts`. Map metadata v4 records `playableBounds`, `imageBounds`,
and `imagePaddingMetres`; the padded image may extend beyond the canonical gameplay bounds.

Focused development probes are available on `window.__gameDebug`:

- `getScatterStats()` reports placed/rejected counts, clusters, tiles, per-layer/source counts, costs,
  and missing assets by region.
- `getWaterBodies()` reports solved contours and closure state.
- `groundHeight(x, z)` reads the surface used for placement.
- `sampleWorld(x, z)` returns the semantic region, visual winner, normalized `biomeWeights`, height,
  slope, water body, and coast facts. Outside playable bounds, slope is `null` and the height/coast
  values describe the rendered collar or ocean.

## Real-browser visual check

Open the Vite game in Chromium and inspect the view, not only source or the SVG.

- Look toward every reachable edge. The padded ocean should meet the render collar without a wall,
  exposed void, or ocean over playable ground. Check the padded map as well as the game view.
- Cross each semantic seam. Visual winners should form organic transitions, while `getState().regionId`
  changes at the authored rectangle boundary.
- Follow several paths. Their curves should be broad and deterministic, width drift restrained, and
  scatter/exclusions aligned to the drawn polyline.
- Check foliage close up and from normal play distance. Grass should read as dense connected fields with
  readable paths and doors; mixed cover and accents should stay restrained.
- Check every lake. Its rings should share lobes, water should be closed, and the bank should be dry
  enough to read without a circular mud halo.
- Watch grass, leaves, flowers, and vines for several seconds. Motion should be slight, rooted,
  and out of phase. Trunks and rigid props should stay still.

Capture a coast/map edge, a biome seam, a curved path, a foliage field, and a lake. Before accepting,
check `getErrors()`, `getScatterStats()`, `getWaterBodies()`, and a few `sampleWorld()` points on both
sides of each semantic seam.
