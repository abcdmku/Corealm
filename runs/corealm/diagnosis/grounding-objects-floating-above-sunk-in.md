# grounding — objects floating above, sunk into, or untilted on the terrain

## Summary

Buildings are not the problem: `checkBuildingFooting()` returns `worst: 0` for all 36 buildings, and the deepest building part is 13 cm into the pad (deliberate wall trim). The real defects are, in order: (1) the terrain field itself contains an unblended 32.75 m vertical cliff — two fishing-basin pads get their falloff widened to 63 m and 85 m by `normaliseFlats`, dragging natural 43 m Karrowmoor ridge down to 10.4 m, while `applyFlats`' `cored` short-circuit leaves the ridge_pines location pad standing as a 7 m-radius, 32 m-tall pillar; a tree on top floats 11.16 m above the drawn mesh and the player cannot stand there (nav snaps to 10.57). 3.4% of the world (1317/38332 samples) is steeper than 45°, max 86.3°. (2) All 10 farm plots are 100% invisible — they spawn `state: "empty"`, which the render layer draws as `CROP_STUBBLE_FRACTION` of `crop_carrot`, and that GLB's bottom 30% lives entirely below its own origin, so the stubble's TOP is 7.7–9.9 cm underground. (3) ~525 scatter pebbles are fully buried: layers sink 0.25–0.35 m into the ground meshes that are only 0.09–0.17 m tall. (4) There is no per-asset base offset anywhere — `spotToVec3` places everything at `heightAt()` and the visible gap is exactly `glbBBoxMinY × scale × tierSilhouetteScale(tier)`, verified to 3 decimals across 159 surface entities; that is why the Fallen Duskoak hovers 5.77 m and the Coldbrace fletching bench hovers 1.41 m. (5) The player walks on the navmesh, 0.147–0.417 m above the drawn ground, varying by location. Two brief hypotheses are refuted: the physics heightfield matches the render mesh exactly (both 2.000 m, origin-aligned), and building footing is clean.

## Evidence

- **runs/corealm/screenshots/ground-ridge-pines-pillar.png (teleport to 236,-85 in Karrowmoor)** — A featureless black vertical slab fills the right third of the frame — the 32.75 m unblended terrain pillar at ridge_pines. Pines stand against and on it. Water disc lies on dry grey hillside at bottom left. Zero scree stones visible across ~30 m of ground where 340 are instanced.
- **runs/corealm/screenshots/ground-preset-marchfield_farm.png** — The player stands in the middle of Marchfield Farm. Zero crops visible. All 6 marchfield_plots entities are drawn with their top 7.7 cm below the ground surface. Road ribbon ends in a hard triangular notch bottom-right where it dives into the terrain.
- **runs/corealm/screenshots/ground-coldbrace-fletching.png (Coldbrace square)** — Buildings sit flat and correct on the pad — confirms footing is not the problem. Bank chest, anvil and cooking pot stand loose on open grass but are grounded to within 3.6 cm. Ground is one untextured green plane; roads are soft brown alpha smears with no edge.
- **runs/corealm/screenshots/ground-preset-highcairn.png** — 36 building parts per hut land level on the flat pad; no floating corners. Confirms checkBuildingFooting()'s worst:0 visually.
- **runs/corealm/screenshots/ground-preset-karrowmoor_terraces.png** — 70% of the frame is one enormous orange ore rock at the Lower Quarry. lower_quarry_kaldite_3 measures 5.3 m wide and stands on 48.9° ground with 3.02 m of daylight under one edge.
- **window.__gameDebug.checkBuildingFooting() live, all 3 settlements** — 36 buildings, every one worst: 0. Flat pads work at the field level; buildings are NOT a grounding defect.
- **getDrawnBounds() over all 892 entities vs terrain-mesh raycast (runs/corealm/audit/grounding.json, terrain2.json)** — Per-archetype gap, 159 surface entities: ore 20/21 buried >5 cm (median -0.274, worst -0.364); tree 25/26 buried (median -0.254, worst -0.460); farm_plot 10/10 buried (-0.218 to -0.274, mesh top BELOW ground); enemy 7/38 buried; obstacle 3 buried + fallen_duskoak +5.773 float; station coldbrace_fletching +1.411 float; npc/shop/bank/portal/fishing_spot all within 4 cm.
- **GLB bounding boxes for all 213 manifest assets via @gltf-transform getBounds (runs/corealm/audit/glb-bounds.json)** — 119 of 213 assets have |bbox.min.y| > 2 cm. Key rows: roof_log +3.8489, support_beam +1.2114, window_shutters +1.093, workbench_drawers +0.8841, vine_1 -2.1205, banner_1 -1.5487, roof_tiles_6x12 -0.7822, roof_tower -0.5720, tree_dead_* -0.3356, rock_medium_3 -0.3156, rock_medium_1 -0.2711, torch -0.2776, tree_common_* -0.2428, crop_carrot -0.2378, bush_common -0.2347, tree_pine_5 -0.2351, cliff_step_2 -0.1895, pebble_round_1 -0.0030. Measured in-game gap == glbMinY x view.scale x tierSilhouetteScale(tier) to 3 dp.
- **Offline WorldScene rebuild + THREE.Raycaster against the 28 walkable chunk meshes, 38332 samples** — Terrain mesh vs analytic field: meanAbs 0.0309 m; <1cm 21595, 1-5cm 10844, 5-10cm 4106, 10-25cm 1651, 25-50cm 64, >50cm 72. Worst -21.63 m at (253.3,-101.8) — the flat-pad cliff, not a sampling artifact.
- **Instrumented replay of WorldScene.applyFlats at the cliff** — @(253.3,-101.8): inside ridge_pines core -> 43.12, basins #45/#46 SKIPPED (cored). @(254.3,-101.8), 1 m away: same natural 42.45, basin #45 w=0.343 -> 30.77, basin #46 w=0.862 -> 10.37. 32.75 m step in 1 m. Basin blends were widened by normaliseFlats from ~23 m to 63.0 m and 84.8 m.
- **scene.slopeAt over the whole world, 38332 samples** — 1317 samples (3.4%) steeper than 45°; max slope 15.57 (86.3°) at (255.8,-99.1). 34 of 159 surface entities stand on ground steeper than 10°.
- **Physics heightfieldSamples() geometry vs terrain chunk tessellation** — Heightfield ncols 350 / nrows 200 over 700x400 = spacing exactly 2.000 x 2.000 m, centre (0,0,0). Chunk grid 7x4 x 100 m at 50 segments = quad 2.000 x 2.000 m, same origin. Bilinear heightfield vs analytic field over 96585 samples: meanAbs 0.0311 m — the same error the render mesh has. No physics/render disagreement exists.
- **Road ribbon vertices vs terrain mesh, 979 samples at 3 m spacing** — 98 (10.0%) sit below the drawn ground. p1 -0.109, p10 -0.001, median +0.020, p90 +0.045, worst -1.362 m at (177.8,-78).
- **Water disc footprints vs terrain mesh, 2 m grid** — redsill 20% of footprint above water (max +7.51 m), blackwater 31% (+3.96), cairn_tarn 55% (+7.28), far_tarn 56% (+4.89).
- **Live teleport + getPlayerPosition().y vs offline terrain-mesh raycast at 4 locations** — Player floats above the drawn ground by +0.417 (ridge pines), +0.341 (far tarn), +0.274 (fallen duskoak), +0.147 m (Coldbrace square). NAV_CONFIG.ch = 0.2.
- **getEntityViewStats() at spawn** — 892 entities, 137 groups, 320 instanced meshes, estimatedDrawCalls 640 (budget 400), uniqueViews 0, riggedViews 0, animatedLastFrame 0, missingAssets []. Every character in the world is a baked idle pose — flagged for the animation domain, not mine.
- **window.__gameDebug key enumeration** — groundHeight and listBuildings are NOT exposed (declared in DebugDeps gameDebug.ts:77/79 and wired in boot.ts:797/798, but absent from the returned debugApi object). checkBuildingFooting, getDrawnBounds, getSceneStats, getEntityViewStats are present.

## Findings

### 1. [critical/confirmed] Flat-pad falloff widening + `cored` short-circuit cut a 32.75 m vertical terrain cliff; 3.4% of the world is steeper than 45°

`game/src/render/scene.ts:568`

**Root cause.** `normaliseFlats` (scene.ts:470) widens each fishing-basin pad's blend to `drop / 0.6` capped at 4x, which turns the Cairn Tarn and Far Tarn basins into 63 m and 84.8 m falloffs that pull the natural 42 m Karrowmoor ridge down to 10.4 m. `applyFlats` (scene.ts:553) then sets `cored = true` inside any pad radius (line 563) and skips every later pad's falloff at line 568, so the ridge_pines location pad (r=7, target 43.12) keeps its natural height while the ground 1 m outside it is 10.37 — an unblended 32.75 m wall.

**Evidence.** Traced through applyFlats offline: @(253.3,-101.8) natural=42.30, inside ridge_pines core -> final 43.12 with both basin falloffs SKIPPED (cored); @(254.3,-101.8) 1 m away, same natural 42.45, basin #45 w=0.343 then basin #46 w=0.862 -> final 10.37. `scene.slopeAt` max over 38332 world samples = 15.57 (86.3°) at (255.8,-99.1); 1317 samples (3.4%) exceed slope 1.0 (45°). Screenshot runs/corealm/screenshots/ground-ridge-pines-pillar.png shows the pillar as a black featureless slab filling the right third of frame with pines standing against it.

**Fix.** Two changes. (a) Cap `normaliseFlats` blend widening on pads that carry an explicit height (the basins): a basin should carve to its own radius+authored blend and never reach 63 m — clamp `flat.blend` to `min(flat.blend * 4, radius * 3)` or drop the widening entirely for `height !== undefined` pads. (b) Replace the `cored` short-circuit at scene.ts:568 with a proper max/priority blend: accumulate `(target, weight)` pairs for every pad in range including cores (weight 1) and return the weighted mean, so two overlapping pads with different targets produce a ramp instead of a step. Then re-run `runs/corealm/audit/terrain3.ts` and assert max `slopeAt` < 1.0 world-wide.

### 2. [critical/confirmed] All 10 farm plots render entirely underground — Marchfield Farm is an empty field

`game/src/render/entityViews.ts:736`

**Root cause.** `buildCluster` (world/regionBuilder.ts:673) spawns farm plots with `state: "empty"`, which entityViews treats as spent, so `buildSpentParts` clips `crop_carrot` to the bottom `CROP_STUBBLE_FRACTION = 0.3` (entityViews.ts:134). `crop_carrot`'s GLB bounding box is min.y = -0.2378, max.y = 0.328 — its bottom 30% is the taproot, entirely below the origin. Combined with `spotToVec3` placing the origin exactly at ground level, the whole stubble is below the surface.

**Evidence.** `getDrawnBounds("marchfield_plots_1")` = min.y -2.154, max.y -2.017, height 0.137, path "instanced-spent"; entity position.y = -1.94 and terrain-mesh raycast at that XZ = -1.94. Top of the drawn mesh is 0.077 m BELOW the ground. Highcairn plots: max.y 26.711 vs ground 26.81, 0.099 m below. All 10 of 10 farm plots. Screenshot runs/corealm/screenshots/ground-preset-marchfield_farm.png: player stands in an empty green field, zero crops visible, only scatter grass.

**Fix.** Two independent fixes, do both. (a) Ground-align by asset base (see the base-offset finding) so `crop_carrot`'s min.y sits at the terrain, which alone lifts the stubble to 0..0.137 above ground. (b) An empty plot should not be a clipped crop at all — content authors no `depletedAssetId` for farm plots; give farm_plot a real empty-state mesh (`floor_brick`/soil quad + `fence_wood_single` border, both unused in the kit) and reserve the stubble clip for the harvested state.

### 3. [critical/confirmed] Every scatter pebble and scree stone is buried below the ground — ~525 instances drawn and invisible

`game/src/world/scatter.ts:393`

**Root cause.** `position: [x, height - sink, z]` subtracts an unscaled absolute `sink` in metres, but the stone layers use meshes 0.09–0.17 m tall at scale 0.35–1.1. `sink` was written for boulders (crags, sink 0.6 on a 3.6 m boulder) and reused on pebbles.

**Evidence.** Measured GLB bounds: pebble_round_1 sizeY 0.0942 minY -0.003, pebble_round_2 0.1008, rock_small_1 0.1299, rock_small_2 0.1683. Layer sinks: fallowmarch `stones` 0.25 (scatter.ts:509), vellenwood `mossrock` 0.35 (:584), karrowmoor `scree` 0.30 (:622). Top of mesh relative to ground = `maxY*scale - sink`: fallowmarch stones -0.16 to -0.21 m, mossrock -0.30 m, scree -0.12 to -0.25 m — all fully below the surface. Counts: 130 + 55 + 340 = 525 instances. `getSceneStats()` confirms the meshes exist and are drawn (`scatter-karrowmoor-pebble_round_1`, `-rock_small_1`, `-rock_small_2`, etc.). Screenshot ground-ridge-pines-pillar.png covers ~30 m of Karrowmoor scree ground and contains zero stones, while the sink=0 grass layers in the same frame are visible.

**Fix.** Change the semantic of `sink` from 'absolute metres' to 'fraction of the instance's own height', or simply set `y = heightAt(x,z) - glbMinY*scale - bedDepth*sizeY*scale` with bedDepth ~0.15. The one-line version: `position: [x, height - sink * entry.scale * assetSizeY, z]`. Cheapest correct version is to fold this into the shared ground-align helper (below) so `sink` becomes bed depth on top of a base-aligned origin.

### 4. [high/confirmed] No per-asset base offset: `spotToVec3` puts the GLB origin at ground level, so every entity floats or sinks by exactly `glbMinY × scale`

`game/src/world/regionBuilder.ts:861`

**Root cause.** `spotToVec3(spot, heightAt, regionId)` returns `[x, heightAt(...), z]` with no per-asset y correction. `render/entityViews.writeSlot` (entityViews.ts:1119) composes the instance matrix from position + rotationY + uniform scale only, so whatever offset the GLB's own origin has becomes the grounding error. Confirmed: measured gap == `glbBBoxMinY × view.scale × tierSilhouetteScale(materialTier)` to 3 decimals for all 34 stations/shops/banks/obstacles/portals/doors.

**Evidence.** Per-archetype gap (drawn min.y minus terrain-mesh raycast, surface entities only, n=159): ore n=21 median -0.274 worst -0.364; tree n=26 median -0.254 worst -0.460; farm_plot n=10 all -0.218..-0.274; obstacle worst +5.773 (fallen_duskoak, roof_log glbMinY +3.8489 x scale 1.5); station worst +1.411 (coldbrace_fletching, workbench_drawers glbMinY +0.8841 x scale 1.6, a 39 cm drawer unit hovering at chest height); dungeon torches -0.444 (torch glbMinY -0.2776 x 1.6); enemy 7/38 buried >5 cm (enemy_skull -0.0673); npc/shop/bank/portal all within 3 cm (their assets happen to have minY ~0). Base-offset table for every asset in game/public/assets is in runs/corealm/audit/glb-bounds.json — 119 of 213 assets have |minY| > 2 cm.

**Fix.** Add `base: { y }` (the GLB world-space bbox min.y) to game/public/assets/manifest.json, emitted by tools/build-assets.ts — it is a measured property of the file and belongs next to `size`. Values are already computed in runs/corealm/audit/glb-bounds.json. Then have boot.ts inject a second port alongside `heightAt` — `assetBaseY(assetId): number` read off AssetRegistry's manifest — and make `spotToVec3` become `groundPlace(spot, assetId, effectiveScale)` returning `heightAt(...) - baseY * scale * tierSilhouetteScale(tier)`. world/ still never imports three; render/ still owns no gameplay state. Do NOT apply it inside `emitParts`/`emitComposition` (regionBuilder.ts:488/531) — prefab and composition parts are authored in the asset's own frame and are already correct (worst building part gap: -0.134 m, wall_bottom_trim, deliberate).

### 5. [high/confirmed] The player walks on the navmesh, 0.15–0.42 m above the drawn ground, and the amount changes with location

`game/src/systems/movement.ts:277`

**Root cause.** Movement interpolates y between Detour path corner heights (`position[1] + (corner[1] - position[1]) * t`) and `nav.closestPoint` returns a navmesh polygon point. Recast quantizes heights to `NAV_CONFIG.ch = 0.2` (app/config.ts:45) and biases upward, so the navmesh surface floats 0–2 cells above the terrain. `scene.syncPlayer` (scene.ts:979) copies that y straight onto the rig root with no ground re-projection. Nothing in the movement or render path ever calls `heightAtXZ` for the player.

**Evidence.** Live `teleport` + `getPlayerPosition()` vs offline terrain-mesh raycast at the same XZ: ridge pines (236,-85) player y 10.572 vs mesh 10.155 = +0.417; far tarn (284,-110) 7.441 vs 7.100 = +0.341; fallen duskoak (172,106.9) 2.974 vs 2.700 = +0.274; Coldbrace square (-160,-80) 1.041 vs 0.894 = +0.147. Entities are placed at the analytic field height, so the player's feet plane and every NPC/prop base plane disagree by up to 42 cm and the disagreement varies as you walk.

**Fix.** After `nav.closestPoint` snaps XZ, overwrite y from the terrain field: give Movement the same `heightAt(regionId, x, z)` port boot.ts:163 already builds for `buildWorld`, and set `player.position[1] = heightAt(...)` in the movement tick and in `teleportPlayer` (boot.ts:530). Keep the navmesh authoritative for XZ only. This keeps semantic state as truth and gives the player and every entity one shared definition of 'ground'.

### 6. [high/confirmed] Nothing tilts to the terrain normal: 21% of surface entities stand on ground steeper than 10°, up to 3.0 m of daylight under one edge

`game/src/render/entityViews.ts:1119`

**Root cause.** `writeSlot` composes `Matrix4.compose(position, quaternion from Y-axis only, uniform scale)` — no surface normal is consulted, and the semantic view has no field to carry one. `scene.scatterInstanced` (scene.ts:860) does the same. Every rock, tree and enemy therefore stands plumb on a slope with its base plane cutting the hill.

**Evidence.** `scene.slopeAt(x, z, 1.0)` at each surface entity: 34 of 159 (21%) are on ground steeper than 10°. Footprint-half-width x slope, worst cases: lower_quarry_kaldite_3 (5.3 m wide ore rock) on 48.9° = 3.02 m; duskoak_stand_trees_5 on 42.4° = 2.74 m; hollowcut_corven_5 on 39.9° = 1.76 m; thornbound_elders_ridge_3 (enemy) on 44.7° = 1.09 m. Per-archetype median edge gap: tree 0.553 m, obstacle 0.127 m, enemy 0.149 m; stations/shops/npc/farm all 0.000 (they sit on flat pads).

**Fix.** Add an optional `groundNormal?: [number, number, number]` (or `tiltX/tiltZ` in radians) to `SemanticEntity.view` in game/src/contracts.ts (frozen — root must make this edit). The world layer computes it from a central difference on the same `heightAt` port it already has (no Three.js), clamped to ~20° so a rock beds into a hill without a tree lying down. `writeSlot` then builds the quaternion as `setFromUnitVectors(UP, normal) * setFromAxisAngle(Y, rotationY)`. Apply to ore, tree, obstacle, landmark and scatter; skip npc, enemy, station, shop, bank, portal and all building parts.

### 7. [medium/confirmed] 10% of road ribbon vertices are below the terrain mesh — roads vanish in patches

`game/src/render/scene.ts:1124`

**Root cause.** `ROAD_LIFT = 0.02` was tuned down from 0.30 to stop roads reading as kerbs, but the ribbon samples the ANALYTIC height field (`this.heightAtXZ(x, z) + ROAD_LIFT` at scene.ts:780) while the ground the player sees is the 2 m-grid interpolated mesh. Where the mesh interpolant sits above the field by more than 2 cm, the ribbon is inside the hill.

**Evidence.** 979 road spine vertices sampled at 3 m spacing across all authored roads: 98 (10.0%) have `field + 0.02 < meshHeight`. Gap p1 = -0.109 m, p10 = -0.001 m, median +0.020 m, p90 +0.045 m, worst -1.362 m on highcairn_outpost->cairn_tarns at (177.8,-78). Field-vs-mesh disagreement world-wide: meanAbs 0.031 m, 6.1% of samples over 5 cm, 0.19% over 50 cm. The comment above ROAD_LIFT claiming the mesh sits 'up to 0.35 m above the analytic value' is roughly right at the tail and badly wrong at the median. Screenshot ground-preset-marchfield_farm.png bottom right shows the ribbon terminating in a hard triangular notch where it enters the ground.

**Fix.** Stop lifting against a guess. Build the ribbon on the SAME interpolant the mesh uses — snap each ribbon vertex to the 2 m grid's bilinear value (a `meshHeightAt(x,z)` helper next to `heightAtXZ` that reads the same lattice `heightfieldSamples` builds) and then add a 2 cm lift. That makes the gap exactly 0.02 m everywhere and lets the polygon offset do the rest. The same helper fixes the entity placement tail: use it as the ground truth in `heightAt` too, so entity, road, physics and mesh all agree by construction.

### 8. [medium/confirmed] Water discs cover more dry hillside than water: 55–56% of the tarn footprints have ground above the surface, by up to 7.3 m

`game/src/app/boot.ts:945`

**Root cause.** `buildWaterBodies` sizes the disc as `cluster.radius + 14` and sets the surface to `floor + WATER_BASIN_DEPTH * 0.55` (0.495 m above the basin floor), but the basin pad that was supposed to carve room for it is the same pad whose blend `normaliseFlats` blew out to 63–85 m. The carve and the disc are sized by two unrelated numbers.

**Evidence.** Raycast sampling the disc footprint on a 2 m grid against the terrain mesh: redsill_spots 20% of footprint above water (max +7.51 m), blackwater_spots 31% (max +3.96 m), cairn_tarn_spots 55% (max +7.28 m), far_tarn_spots 56% (max +4.89 m). Screenshot ground-ridge-pines-pillar.png bottom-left shows the pale water disc lying on a grey hillside with no shoreline.

**Fix.** Derive the disc radius from where the basin pad's carve actually reaches (walk outward from the centre until `heightAtXZ` rises above the surface height) instead of `radius + 14`, and clamp the basin pad blend so the carve is a bowl, not a regional depression. Fix the pad first (finding 1) — the water number falls out of it.

### 9. [low/confirmed] REFUTED: the physics heightfield and the render mesh do not disagree, and building footing is clean

`game/src/render/scene.ts:660`

**Root cause.** Not a defect. `heightfieldSamples(resolution = 2)` produces ncols 350 / nrows 200 over a 700x400 world — spacing exactly 2.000 m — and `buildWorld` tessellates 7x4 chunks of 100 m at 50 segments, also exactly 2.000 m, from the same `bounds.minX/minZ` origin. Both sample `heightAtXZ` at identical lattice points.

**Evidence.** Physics heightfield bilinear value vs analytic field over 96585 samples: meanAbs 0.0311 m — identical to the render mesh's 0.0309 m over 38332 samples, and the worst cases coincide at the flat-pad cliff (245.7,-90.5), not at a sampling seam. `checkBuildingFooting()` returns `worst: 0` for all 36 buildings across Coldbrace, Rootfall and Highcairn. Worst building-part gap against the drawn mesh: -0.134 m (`coldbrace_hall#t0_0`, a `wall_bottom_trim` whose GLB minY is -0.1168 — deliberate); Rootfall houses +0.002 m; Highcairn huts -0.201 m (`prop_l`, a `support_beam` with authored offset).

**Fix.** No work needed here — do not spend time on physics/mesh resolution or on re-levelling buildings. Note for tooling: `groundHeight()` and `listBuildings()` are declared in `DebugDeps` (gameDebug.ts:77, :79) and wired in boot.ts:797-806, but the returned `debugApi` object never exposes them, so `window.__gameDebug.groundHeight` and `.listBuildings` are undefined. Add both, plus a `checkGrounding()` returning `{id, archetype, drawnMinY, groundY, gap}` per entity so gate-check can assert `|gap| < 0.05` for every ground-placed entity and this class of bug cannot come back.

## Recommendations

1. Fix the terrain field first — everything else is measured against it. In game/src/render/scene.ts: (a) in `normaliseFlats` (line 470) stop widening the blend of pads that carry an explicit height, or clamp to `radius * 3`; the Cairn/Far Tarn basins currently reach 63 m and 84.8 m. (b) rewrite `applyFlats` (line 553) to accumulate weighted (target, weight) contributions from every pad in range — cores contribute weight 1 — instead of the `cored` short-circuit at line 568 that skips all later falloffs. Verify by re-running runs/corealm/audit/terrain3.ts and asserting max `slopeAt` < 1.0 world-wide (currently 15.57) and zero samples with |mesh - field| > 0.5 m (currently 72).

2. Add `base: { y }` to game/public/assets/manifest.json from the GLB world-space bbox min.y, emitted by tools/build-assets.ts. The 213 measured values are already in runs/corealm/audit/glb-bounds.json — copy them rather than re-deriving. This is asset metadata, same category as the existing `size`.

3. In game/src/app/boot.ts, inject an `assetBaseY(assetId): number` port into `buildWorld` alongside the existing `heightAt` closure (boot.ts:163/177), sourced from AssetRegistry's manifest. Then change `spotToVec3` (world/regionBuilder.ts:861) into `groundPlace(spot, assetId, scale, tier)` returning `heightAt(...) - baseY * scale * tierSilhouetteScale(tier)`. Do NOT touch `emitParts` (regionBuilder.ts:488) or `emitComposition` (:531) — prefab and composition parts are authored in the asset's own frame and already measure correct.

4. Apply the same port in game/src/world/scatter.ts:393: `y = height - baseY*scale - bedDepth*sizeY*scale`, and reinterpret `sink` (currently absolute metres at lines 509/584/604/622) as a fraction of the instance's own height. Target: pebble_round_1/2 and rock_small_1/2 sit with 15% of their height in the ground instead of 250–350% below it.

5. Give farm plots a real empty state. Right now `state: "empty"` at world/regionBuilder.ts:673 routes to `buildSpentParts`' `CROP_STUBBLE_FRACTION` clip (entityViews.ts:134/736), which for `crop_carrot` is entirely below its own origin. Author a soil bed from the unused kit (floor_brick or floor_cobble quad plus fence_wood_single border) as the empty-plot mesh, and keep the stubble clip for the harvested state only.

6. Give the player one definition of ground. In game/src/systems/movement.ts:277 and boot.ts:530 (`teleportPlayer`), keep the navmesh authoritative for XZ but overwrite y from the terrain field via the same `heightAt` port boot already builds. That removes the 0.147–0.417 m float and makes the player's feet share a plane with every entity base.

7. Add `groundNormal?: [number, number, number]` to `SemanticEntity.view` in game/src/contracts.ts (frozen file — root must make this edit). Compute it in the world layer from a central difference on `heightAt` (no Three.js), clamp to ~20°, and consume it in `writeSlot` (entityViews.ts:1119) as `setFromUnitVectors(UP, normal) * setFromAxisAngle(Y, rotationY)` and in `scatterInstanced` (scene.ts:860). Apply to ore/tree/obstacle/landmark/scatter only. 34 of 159 surface entities need it.

8. Make the road ribbon sample the same 2 m lattice the terrain mesh is tessellated from rather than the analytic field: add a `meshHeightAt(x,z)` bilinear helper next to `heightAtXZ` (scene.ts:506) reading the lattice `heightfieldSamples` already builds, use it at scene.ts:780, and keep ROAD_LIFT at 0.02. Target: zero of 979 road vertices below the ground (currently 98).

9. Close the verification loop: expose `groundHeight` and `listBuildings` on `window.__gameDebug` (they are wired in boot.ts:797-798 but missing from the returned object in gameDebug.ts), and add `checkGrounding()` returning `{id, archetype, drawnMinY, groundY, gap}` per entity. Wire a gate-check assertion of `|gap| < 0.05` for every ground-placed archetype so this whole class regresses loudly. My measurement scripts and raw data are in runs/corealm/audit/ (grounding.json, terrain2.json, glb-bounds.json plus the .ts scripts that produced them); runs/ is outside tsconfig's include list so they do not affect typecheck.

## Files to edit

- game/src/render/scene.ts
- game/src/world/regionBuilder.ts
- game/src/world/scatter.ts
- game/src/render/entityViews.ts
- game/src/systems/movement.ts
- game/src/app/boot.ts
- game/src/app/worldSpec.ts
- game/src/contracts.ts
- game/src/debug/gameDebug.ts
- game/public/assets/manifest.json
- tools/build-assets.ts
- game/src/content/regions.ts
