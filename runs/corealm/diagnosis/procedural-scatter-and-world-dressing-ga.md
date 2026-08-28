# procedural scatter and world dressing (game/src/world/scatter.ts, its exclusion wiring in app/boot.ts, and its instancing path in render/scene.ts)

## Summary

The scatter system is structurally incapable of clustering, and that single fact produces the "random assets thrown on a board" read. `poissonDisc` (scatter.ts:207) overrides every authored `spacing` with `sqrt(area*0.66/maxCount)`, so Fallowmarch's `spacing: 3.4` grass actually has a 10.4 m minimum and 11.3 m mean nearest-neighbour gap, and Vellenwood's canopy has a 15.3 m minimum tree-to-tree gap. Poisson-disc is an anti-clustering algorithm; the `patchiness` control on top of it is a per-point Bernoulli test that only thins, never tightens, so no grove, treeline or rock field can ever form. The whole world carries ~2,740 instances over 28 ha — one prop per 100 m2 — and every one of them stands alone. Second-order: ground cover is not ground cover (grass_common_short is 1.334 m native and is scaled to 1.07-2.0 m, i.e. taller than the player, and there is no near-field detail layer at all), instances get yaw only and never tilt to the terrain normal, the region-seam fade at scatter.ts:363 is provably dead code so region borders are hard species swaps, settlements end in a bare 46 m disc with no thinning band and no garden planting, and an 11 m annulus of scatter is drawn under every water disc. The species pool is 22 of the 63 nature+rock assets and 5 of 25 trees, including two layers (238 instances) built on `bush_common`, whose only material is the red-dominant `Leaves_TwistedTree` the file itself already banned from Vellenwood for that reason. Perf is not the constraint on density: scatter costs 62 of the 397 draw calls measured at the worst pose and the frame runs at 4.5 ms against an 18.2 ms budget for 55 FPS. Because the entire 63-asset nature+rock kit uses only 17 distinct materials (all 25 trees use 6), moving `scatterInstanced` from `InstancedMesh`-per-asset to `THREE.BatchedMesh`-per-material collapses scatter to ~20 draw calls, frees ~42 for the settlement work, gains per-instance frustum culling, and makes the species pool free.

## Evidence

- **npm run perf -- --run runs/corealm on a real GPU (ANGLE D3D11, RTX 5080), all 18 shots** — Peak 397 draw calls at highcairn against a 400 budget (3 free). Peak 3.77M triangles. Worst median frame 4.5 ms (spawn/town_center/bank) against 18.2 ms for 55 FPS -> 4.0x frame-time headroom. All 18 shots pass. Scatter's own share is 43 InstancedMesh objects = 62 draw calls world-wide, ~43 in a typical two-region frame.
- **__gameDebug.getSceneStats() via a play scenario, counting scatter-* objects** — 43 scatter InstancedMesh objects: fallowmarch 14, vellenwood 16, karrowmoor 13. getEntityViewStats(): 872 entities / 310 instanced meshes / estimatedDrawCalls 678 / uniqueDrawCalls 58 / triangles 1.07M -- entity views, not scatter, are what consume the draw budget.
- **Re-ran the exact Bridson implementation from scatter.ts:201-268 offline against the real region rects (fallowmarch 330x400, vellenwood 370x190, karrowmoor 370x210) and DEFAULT_SCATTER, measuring nearest-neighbour distances** — Every layer's authored `spacing` is a dead floor; the auto radius always wins. fallowmarch tussock: spacing 3.4 -> effective 10.4 m, nnMin 10.4 m, nnMean 11.3 m, 42/ha. vellenwood canopy: spacing 11 -> effective 15.2 m, nnMin 15.3 m, nnMean 17.0 m. karrowmoor scree: spacing 7 -> effective 12.3 m. Whole world ~2,740 placed instances over 28 ha = 1 prop per 100 m2.
- **Parsed the GLB JSON chunks of all 63 nature+rock assets for triangle counts and material names** — 17 distinct materials total. Leaves x11 assets, Bark_NormalTree x10 (all 5 tree_common + all 5 tree_pine), PathRocks x10 (all 6 path_rock_* plus pebbles and rock_small), Leaves_TwistedTree x6 (bush_common + all 5 tree_twisted), Leaves_NormalTree x6, Rock x6, Flowers x5, Bark_DeadTree x5, Leaves_Pine x5, Bark_TwistedTree x5, Grass x4, Rocks x3, Mushrooms x2, MI_Vine x2, 3 gem materials. Costs: grass_common_short 155 tris, plant_broad_small 48, clover_1 379, fern_1 288, pebble_round_1 114, rock_small_2 48, path_rock_small_2 559, path_rock_round_wide 3500, tree_common_5 3182, tree_pine_5 1646.
- **Manifest sizes for the ground-cover assets actually used** — grass_common_short native height 1.334 m, scaled [0.8,1.5] -> 1.07-2.00 m. flower_a_group native 2.055 m, scaled [0.7,1.2] -> 1.44-2.47 m. Player is 1.8 m. The 'short grass' layer is taller than the player. plant_broad_large is 0.253 m tall and 1.31 m wide -- a flat mat -- and is mixed into the same layer and scale band as fern_1 (2.83 m wide).
- **runs/corealm/screenshots/scatter-fallow-open.png -- teleport to open Fallowmarch (-200, 0), read back** — In a ~50x30 m view: 6 isolated single grass sprigs, 2 magenta/maroon bush_common blobs, 1 pink flower sprig, 1 tree. Zero pebbles despite a 6.9/ha stones layer. ~85% of the frame is featureless flat green. No two props are adjacent.
- **runs/corealm/screenshots/scatter-march_road.png** — Definitive polka-dot frame: isolated grass sprigs and lone purple bushes evenly spread across a huge bare lawn, not one clump anywhere. Roads are translucent orange smears with fuzzy alpha edges and no verge, kerb, gravel or path rock. The bottom-left ~30% of the frame is empty ground.
- **runs/corealm/screenshots/scatter-palewood_copse.png (shot whose stated intent is a copse)** — 5 trees, each isolated by 15-25 m, each casting a hard shadow onto bare mown-lawn ground. No undergrowth, saplings, leaf litter or grass at the base of any tree.
- **runs/corealm/screenshots/scatter-vellen-open.png -- teleport into Vellenwood interior (100, 120)** — Vellenwood's 'deep green woodland' with an authored 260-instance undergrowth layer and 321-instance floor layer shows ZERO ferns and exactly ONE grass sprig in a ~50 m view. One pale-grey pebble sits on the dark forest floor at a value the ground never reaches.
- **runs/corealm/screenshots/scatter-spawn.png and scatter-highcairn.png and scatter-rootfall.png** — Settlement exclusion produces a completely naked disc: at spawn the whole foreground (~60% of frame) has no scatter of any kind; at highcairn the grey-brown pad ends in a razor-sharp line against the green scatter zone; at rootfall the pad is bare dark green with trees ringing the 46 m boundary.
- **boot.ts:954 (water disc radius = cluster.radius + 14, via scene.ts:823) vs boot.ts:1085 (scatter exclusion = cluster.radius + 3)** — An 11 m wide annulus under every water disc receives scatter. At the fallowmarch grass density of 42/ha and a typical r=10 cluster that is ~1,280 m2 of submerged ground, ~5-8 grass tufts and pebbles drawn under the water plane.
- **scatter.ts:363-366 seam fade, checked against worldSpec.ts:175 (blendMetres = 28) and scene.ts:591 regionWeightAt** — Dead code. Candidates only exist inside the rect, where signedDepth >= 0, so belonging = smoothstep01((depth+28)/56) >= 0.5 always, and the guard `belonging < 0.5` can never fire. Zero candidates have ever been rejected by it. Region borders are hard species swaps -- visible as the abrupt green/grey line on the ridge in scatter-highcairn.png.
- **boot.ts:250** — `await scatterWorld(...)` discards the ScatterResult[]. placed/rejected/byLayer/estimatedDrawCalls/estimatedTriangles/missingAssets are computed and thrown away, and nothing on __gameDebug exposes them -- which is why the density numbers above had to be re-derived by re-running Bridson offline.

## Findings

### 1. [critical/confirmed] poissonDisc silently overrides every authored spacing, so nothing can ever be near anything else

`game/src/world/scatter.ts:207`

**Root cause.** `const radius = Math.max(minDistance, Math.sqrt((area * 0.66) / maxCount))` treats maxCount as a hard cap by widening the disc radius. On region areas of 70,000-132,000 m2 the computed radius exceeds the authored `spacing` for every single layer in DEFAULT_SCATTER, so `spacing` is inert and the real minimum gap is set by maxCount alone. Poisson-disc then guarantees that minimum, which means it actively forbids the clumping vegetation needs.

**Evidence.** Re-running the exact algorithm against the real rects: fallowmarch tussock authored spacing 3.4 m -> effective 10.4 m, nnMin 10.4 m, nnMean 11.3 m. vellenwood canopy 11 -> 15.2 m, nnMin 15.3 m. karrowmoor scree 7 -> 12.3 m. All 19 layers auto-widen; not one authored spacing binds. World total ~2,740 instances over 28 ha = 1 prop per 100 m2. Visible directly in scatter-march_road.png and scatter-fallow-open.png as evenly spaced lone sprigs on bare lawn.

**Fix.** Stop using maxCount as a radius dial. Run Bridson at the authored `spacing`, then thin to maxCount with a deterministic per-point hash (uniform thinning preserves the spatial distribution; truncating the frontier order does not). Then replace flat Poisson with two-level cluster placement: Poisson the cluster CENTRES at `clusterSpacing`, apply the mask/slope/altitude/settlement rules to the centre only, and Poisson the members inside a disc of radius R with a 1-(r/R)^2 radial density falloff. Suggested: vellenwood canopy clusterSpacing 34 m, R 13-27 m, member spacing 6.0 m, accept 0.55 -> ~30 groves of 18-28 trees; fallowmarch copse clusterSpacing 90 m, R 16-30 m, member spacing 8 m, accept 0.35 -> ~7 real copses; karrowmoor crags clusterSpacing 40 m, R 10-18 m, member spacing 5 m, gated on slope > 0.5.

### 2. [critical/confirmed] patchiness cannot cluster - it is a per-point Bernoulli thin over a 3-lattice-cell noise field

`game/src/world/scatter.ts:382`

**Root cause.** `density = 1 - patchiness + patchiness * (mask(x/patchScale, z/patchScale)*0.5+0.5)` followed by `if (rng.next() > density) reject`. Rejecting points independently lowers density but cannot lower the minimum spacing that poissonDisc already enforced, so a 'clump' is just a slightly less sparse sprinkle. Worse, `createValueNoise` (scene.ts:148) is single-octave, and at patchScale 85-130 m over a 330-400 m region there are only ~3-4 lattice periods across the whole region, so the mask is 3 giant smooth gradients with no grove-scale structure.

**Evidence.** vellenwood canopy patchiness 0.4 over patchScale 85 m: mean survival 0.8, so 191 candidates become ~153 trees, and the minimum gap stays 15.3 m regardless. scatter-vellenwood_canopy.png shows a uniform gloom of evenly spaced trees with no clearing/stand contrast, which is exactly what the comment at scatter.ts:539-548 says it was trying to avoid.

**Fix.** Delete `patchiness`/`patchScale` from the point loop. Move the mask to the CLUSTER ACCEPTANCE test in the new two-level placer, and make it fbm (3 octaves, featureSize 60-90 m) rather than single-octave value noise, so a rejected mask value removes a whole grove and leaves a real clearing.

### 3. [critical/confirmed] There is no ground-cover layer - the 'grass' is player-height props on 11 m centres

`game/src/world/scatter.ts:514`

**Root cause.** The tussock/floor/moorgrass layers use grass_common_short (native 1.334 m) and grass_wispy_short at scale [0.7,1.5], and bloom uses flower_a_group (native 2.055 m) at [0.7,1.2]. Combined with the 10-11 m effective spacing from finding 1, the result is scattered shrub-scale props rather than a carpet. No near-field detail layer exists at all.

**Evidence.** Manifest sizes: grass_common_short 1.334 m -> 1.07-2.00 m in world; flower_a_group 2.055 m -> 1.44-2.47 m; the player capsule is 1.8 m. In scatter-fallow-open.png the sprigs stand roughly to the player's waist and are ~15 m apart. Measured density 42-46 tufts/ha.

**Fix.** Add a camera-following detail carpet on top of (not instead of) the region layers. 8 m cells, RNG seeded per cell from `hash(seed, 'detail', cellX, cellZ)` so it is pure-positional and deterministic; 12 points per cell = 1 per 5.3 m2 = ~1,875/ha; radius 56 m -> ~154 cells -> ~1,850 live instances; scale ramps to zero linearly between 40 m and 56 m so nothing pops. Scale each species so world-space height lands in 0.22-0.55 m: grass_common_short 0.17-0.41, clover_1 0.20-0.48, plant_broad_small 0.9-2.2. Species per material group: Grass (grass_common_short/tall, grass_wispy_short/tall), Leaves (clover_1/2, plant_broad_small, plant_leafy_small, fern_1), PathRocks (pebble_round_1/2, rock_small_1/2). ~0.7M triangles, 3 draw calls with BatchedMesh, no shadow casting. Then cut the existing region-wide tussock/floor/moorgrass layers to 0 and reuse their draw calls.

### 4. [high/confirmed] Every instance gets yaw only - nothing tilts to the terrain normal, and scale is a single uniform scalar

`game/src/render/scene.ts:895`

**Root cause.** `quaternion.setFromAxisAngle(new Vector3(0,1,0), entry.rotationY)` and `scaleVector.setScalar(entry.scale)`. Instances are always perfectly upright and perfectly uniformly scaled, so a pebble on a 35 degree slope is half buried and half floating, and five tree models repeat as five identical silhouettes.

**Evidence.** scatter-karrowmoor_terraces.png: the pale rocks on the grey scree slope read as flat shards clipping through the ground plane. The karrowmoor `scree` and `crags` layers and both `stones` layers set no `slopeMax` at all, so they default to 0.85 (40 degrees). scatter.ts:395 also draws scale uniformly in [min,max], which gives no size hierarchy - the trees in scatter-palewood_copse.png are all visually the same size.

**Fix.** Add `tiltStrength` to ScatterLayerSpec and build the instance quaternion as `slerp(identity, setFromUnitVectors(UP, terrainNormal), tiltStrength) * yaw`. Use 1.0 for pebbles/path rocks/flat plants, 0.5 for grass, 0.35 for bushes and boulders, 0.10 for trees. Expose the normal via a new `WorldScene.normalAt(x,z)` derived from the same central difference as `slopeAt` (scene.ts:599). In the same commit, replace `setScalar` with per-axis `(s*(1+w), s*(1+h), s*(1+w))`, w in [-0.12,0.12], h in [-0.15,0.25], plus a 50% chance of negative X for mirroring - free, still one matrix, and it triples the apparent variety of a 5-model tree pool. And change scatter.ts:395 to `min + (max-min)*u^2.2` so most props are small and a few are large.

### 5. [high/confirmed] The region-seam fade is dead code, so region borders are hard species swaps

`game/src/world/scatter.ts:363`

**Root cause.** `const belonging = scene.regionWeightAt(regionId, x, z); if (belonging < 0.5 && rng.next() > belonging * 2) reject`. Candidates are generated only inside the region rect by `poissonDisc(rect, ...)`, where `signedDepth >= 0`, so `regionWeightAt` = smoothstep01((depth+28)/56) >= 0.5 for every candidate. The guard can never fire.

**Evidence.** worldSpec.ts:175 sets blendMetres = 28; scene.ts:591 computes the weight from signedDepth, which scene.ts:212 defines as positive inside the rect. At the rect edge weight is exactly 0.5, and `< 0.5` is false. Zero rejections in the entire world. Visible as the abrupt green/grey boundary on the ridge in scatter-highcairn.png and the wood stopping dead at the top of scatter-vellenwood_canopy.png.

**Fix.** Generate candidates over `rect` inflated by `blendMetres` (28 m) so points genuinely land outside and the weight test becomes live. Additionally force a treeline: cluster centres within 15 m of a shared region edge get R = 9 m and member spacing 4.5 m using the region's dominant species, which turns the border into a hedgerow instead of a paint-bucket edge.

### 6. [high/confirmed] Settlement exclusion is a hard 46 m circle with no thinning band and no planting inside

`game/src/app/boot.ts:1077`

**Root cause.** `worldExclusions.addCircle(centre[0], centre[1], 46, 'settlement', id)` plus `ExclusionZones.blocks()` (scatter.ts:84) is a boolean in/out test. Everything - trees, bushes, grass, pebbles - stops dead at exactly 46 m, and nothing at all is planted inside. There is also no coupling to the actual pad radius, which worldSpec.ts:105 computes per settlement.

**Evidence.** scatter-spawn.png: the entire foreground, ~60% of the frame, is bare flat green with zero props of any kind. scatter-highcairn.png: the settlement pad ends in a razor-sharp line against the vegetated ground. scatter-rootfall.png: same, dark green bald disc.

**Fix.** Replace `blocks(x,z,margin): boolean` with `densityAt(x,z,margin): number` returning 0 inside the pad radius and ramping to 1 over the next band: 30 m for trees (hard 0 to padRadius+8 so nothing grows through a roof), 22 m for shrubs, and for ground cover ramp in from padRadius-8 so the town square has grass at its edges. Multiply the layer's acceptance probability by it. Then add a separate `dressSettlement` pass driven by BuildingBox[] (garden beds along walls, bush at outside corners, path_rock paving on the square, fence runs between buildings) - that pass belongs to the settlement domain, but the ExclusionZones API change belongs here and blocks it.

### 7. [medium/confirmed] Scatter is drawn under the water surface in an 11 m annulus around every fishing pond

`game/src/app/boot.ts:1085`

**Root cause.** Fishing clusters are excluded at `cluster.radius + 3` (boot.ts:1085), but boot.ts:954 builds the water disc at `half = cluster.radius + 14` and scene.ts:823 makes the disc radius the full half-extent. The 11 m annulus between them is fair game for grass, flowers and pebbles that then render below the water plane.

**Evidence.** Annulus area for a typical r=10 cluster is pi*((24)^2-(13)^2) = 1,278 m2; at the measured fallowmarch densities (42 tussock + 10.5 bloom + 6.9 stones per ha) that is 5-8 props submerged per pond. Geometry is unambiguous from the two constants.

**Fix.** Raise the fishing-cluster exclusion to `cluster.radius + 15` in boot.ts:1085 (or key it off the same constant the water builder uses), and add a positive shoreline band instead: grass_wispy_tall (622 tris, 1.5-2.2 m) as reeds in [waterR-1, waterR+3] at 1.4 m spacing with tiltStrength 0, and plant_broad_large mats plus flower_b_group at 2x normal density in [waterR+3, waterR+18]. That is also the 'moisture band' the world is missing entirely.

### 8. [medium/confirmed] Two layers totalling 238 instances use bush_common, whose only material is the red autumn Leaves_TwistedTree the file already banned

`game/src/world/scatter.ts:501`

**Root cause.** Fallowmarch `bracken` (scatter.ts:501, 104 placed) and Karrowmoor `scrub` (scatter.ts:625, 134 placed) both use `bush_common`. Parsing the GLB shows its single primitive uses material `Leaves_TwistedTree` - the same red-dominant texture the comment at scatter.ts:572-580 identifies as the reason Vellenwood rendered crimson and explicitly removes from that region only.

**Evidence.** GLB material census: bush_common -> Leaves_TwistedTree (900 tris, 1 primitive), shared with all 5 tree_twisted variants. In scatter-march_road.png and scatter-fallow-open.png the bushes render as saturated magenta/maroon blobs on olive grass - the single most out-of-key colour in the frame.

**Fix.** Swap Fallowmarch `bracken` to `bush_flowering` (Leaves_NormalTree + Flowers, 1368 tris) and/or `plant_leafy_large` (Leaves, 360 tris); swap Karrowmoor `scrub` to `plant_leafy_small` (Leaves, 120 tris) + `plant_broad_large`. Under a material-keyed BatchedMesh (see the recommendations) both targets are already in the batch, so the swap is free in draw calls and cheaper in triangles.

### 9. [medium/confirmed] Roads and paths get a negative exclusion but no positive dressing, and all 6 path_rock assets are unused

`game/src/app/boot.ts:1097`

**Root cause.** `worldExclusions.addCorridor(points, 8, 'road', ...)` only removes scatter. Nothing is ever placed to make a road read as a made surface. Roads are drawn as a 4-lane alpha-faded vertex-colour strip (scene.ts:748, called at boot.ts:996 with width 3.2 and ROAD_SKIRT 1.7, so 5.44 m total) with nothing on it or beside it.

**Evidence.** Asset census: path_rock_round_thin/round_wide/small_1/small_2/square_thin/square_wide, plus kerb_straight and kerb_corner in the building kit, are all unused. scatter-march_road.png shows three translucent orange smears crossing bare grass with fuzzy alpha edges and no verge.

**Fix.** Add a road layer that consumes the same road splines. Lay path_rock_small_1 (998 tris) / path_rock_small_2 (559) / path_rock_square_thin (1793) along the spline at 1.5 m spacing with tiltStrength 1.0, sink 0.05 m and +/-0.35 m lateral jitter; one path_rock_round_wide (3500 tris - expensive, use sparingly) per ~20 m as a stepping stone; pebble_round_1/2 at 0.4 per linear metre in the verge band 2.7-4.5 m off centre. All of these share the `PathRocks` material, so with a material-keyed batch this costs zero extra draw calls.

### 10. [medium/confirmed] Species pool is 22 of 63 nature+rock assets and 5 of 25 trees, because maxVariants is a proxy for draw calls

`game/src/world/scatter.ts:279`

**Root cause.** `const limit = layer.maxVariants ?? 4` exists because `scatterInstanced` creates one InstancedMesh per (asset, primitive) pair, so every new species costs 1-4 draw calls. The whole DEFAULT_SCATTER table is written around that constraint, and the result is a world built from 5 tree models and 4 ground plants.

**Evidence.** Unused nature assets: bush_flowering, clover_2, flower_a_single, flower_b_group, flower_b_single, grass_wispy_tall, mushroom_bracket, plant_broad_small, plant_leafy_small, tree_common_1/2/4, tree_dead_1-4, tree_pine_1-4, tree_twisted_1/3/4/5, vine_1/2 (26 of 41). Unused rock: all 3 cliff_step, all 6 path_rock, rock_medium_1/2/3 (15 of 22). But the GLB census shows the whole 63-asset kit uses only 17 materials - all 10 tree_common+tree_pine share `Bark_NormalTree`, all 11 small plants share `Leaves`, all 10 path/pebble/small rocks share `PathRocks`.

**Fix.** Change the instancing key in scene.ts:860 from (asset, primitive) to (material). Use `THREE.BatchedMesh` (three 0.185.1 has it), one per material name, holding many geometries and doing per-instance frustum culling and sorting. The entire nature+rock library then costs ~14 base draw calls plus ~6 shadow-pass calls, against the 62 the current 22-asset pool costs - a ~42 call saving with a 2.9x larger species pool. Delete `maxVariants` at that point. Validate that all geometries share the same attribute set (POSITION/NORMAL/UV) before merging.

### 11. [medium/confirmed] No altitude, slope-preference or moisture rules are in effect anywhere

`game/src/world/scatter.ts:377`

**Root cause.** `heightRange` is implemented (scatter.ts:378) but no layer in DEFAULT_SCATTER sets it. `slopeMax` is only a rejection ceiling and only 5 of 19 layers set one - crags, scree, stones, all grass and all bushes default to 0.85 (40 degrees). There is no slope PREFERENCE, no altitude banding and no water-proximity term at all.

**Evidence.** grep of DEFAULT_SCATTER: zero `heightRange` entries across all 19 layers. karrowmoor `scree` (scatter.ts:619, 276 placed) has no slopeMax and no slope bias, so scree is as likely on the flat terrace tops as on the risers - visible in scatter-karrowmoor_terraces.png where the grey slope has ~5 stones on it while flat ground carries the same density.

**Fix.** Apply these on the cluster centre in the new placer. Slope preference multipliers: rock/scree x4 above slope 0.55, x0.15 below 0.25; broadleaf trees reject above 0.45, pines allowed to 0.70; grass x1.4 below 0.20. Altitude bands per species using the region baseHeight+amplitude (fallowmarch 0/14, vellenwood 4/26, karrowmoor 8/62): pines [regionFloor+0.55*amp, inf), broadleaf (-inf, regionFloor+0.45*amp], dead trees only above 0.7*amp. Moisture: distance to nearest water-disc centre, boost fern/plant/grass x2.5 within waterR+18.

### 12. [low/confirmed] Region-wide InstancedMesh bounding spheres defeat frustum culling, and ScatterResult's own instrumentation is thrown away

`game/src/render/scene.ts:891`

**Root cause.** `instanced.frustumCulled = true` is set on a mesh whose bounding sphere spans the whole region, so it is never culled; every streamed-in region submits 100% of its triangles every frame regardless of where the camera looks. Streaming (scene.ts:924) is region-granular at 240 m against 330-400 m regions and 90-260 m fog, so 2-3 regions are on almost everywhere. Separately, boot.ts:250 discards the ScatterResult[], so placed/rejected/byLayer/estimatedDrawCalls/estimatedTriangles are unreachable from __gameDebug.

**Evidence.** Measured 3.77M triangles at highcairn where a large fraction of the scene is behind the camera. The scatter.ts:18-27 header documents the bounding-sphere problem and concludes it cannot be fixed without per-object anchors - BatchedMesh removes that constraint entirely, since it culls per instance. And the density figures in this report had to be re-derived by re-running Bridson offline precisely because getScatterStats does not exist.

**Fix.** Switching to BatchedMesh (finding 10) fixes the culling as a side effect. In the same change, keep the ScatterResult[] from `scatterWorld` in boot.ts:250 and expose it as `__gameDebug.getScatterStats()` returning per-region per-layer placed/rejected/instances/triangles/draw calls, so the next agent can measure this domain without re-implementing the sampler.

## Recommendations

1. Land the draw-call refactor first, because it unblocks everything else: change `WorldScene.scatterInstanced` (scene.ts:860) to key on MATERIAL rather than (asset, primitive), backed by `THREE.BatchedMesh` (three 0.185.1). The 63-asset nature+rock kit uses 17 materials; scatter drops from 62 draw calls to ~20 (14 base + ~6 shadow), freeing ~42 of the 400 budget, and BatchedMesh's per-instance frustum culling ends the region-wide-bounding-sphere triangle waste. Delete `maxVariants` from ScatterLayerSpec once this lands. Verify all merged geometries share POSITION/NORMAL/UV.

2. Fix the sampler at scatter.ts:207: run Bridson at the authored `spacing`, then thin to `maxCount` with a deterministic per-point hash. Then replace flat Poisson with two-level cluster placement - Poisson the cluster centres, apply mask/slope/altitude/settlement rules to the centre only, Poisson the members inside a disc of radius R with a 1-(r/R)^2 falloff, and give each cluster a 70/30 dominant/secondary species split. Starting numbers: vellenwood canopy clusterSpacing 34 m / R 13-27 m / member spacing 6.0 m / accept 0.55 -> ~30 groves of 18-28 trees (budget ~420 trees, 2.9M tris with shadows - measure and trim); fallowmarch copse clusterSpacing 90 m / R 16-30 m / spacing 8 m / accept 0.35; karrowmoor crags clusterSpacing 40 m / R 10-18 m / spacing 5 m, gated on slope > 0.5. Delete `patchiness`/`patchScale` from the point loop and move the mask (as 3-octave fbm at featureSize 60-90 m) to cluster acceptance.

3. Add the near-field detail carpet, which is the single biggest visual win per line of code. Camera-following, 8 m cells, RNG seeded per cell from hash(seed,'detail',cellX,cellZ) so it is pure-positional and deterministic; 12 points/cell = 1 per 5.3 m2 = ~1,875/ha; refresh only when the player crosses a cell boundary; radius 56 m (~154 cells, ~1,850 live instances); linear scale-to-zero fade between 40 m and 56 m so nothing pops and no alpha sorting is needed. Scale to 0.22-0.55 m world height per species (grass_common_short 0.17-0.41, clover_1 0.20-0.48, plant_broad_small 0.9-2.2). Three BatchedMeshes: Grass, Leaves, PathRocks. ~0.7M triangles, no shadow casting. Zero the existing tussock/floor/moorgrass/bloom region layers when it lands.

4. Add orientation and scale variation to the instance composer at scene.ts:895-896: `tiltStrength` per layer (1.0 pebbles/path rocks/flat plants, 0.5 grass, 0.35 bushes/boulders, 0.10 trees) slerped from a new `WorldScene.normalAt(x,z)`; per-axis scale (s*(1+w), s*(1+h), s*(1+w)) with w in [-0.12,0.12] and h in [-0.15,0.25]; 50% negative-X mirroring; and a u^2.2 power distribution on scale at scatter.ts:395 so the world gets a size hierarchy instead of one uniform band.

5. Turn ExclusionZones from boolean into a density field: replace `blocks(x,z,margin): boolean` (scatter.ts:84) with `densityAt(x,z): number`, 0 inside the pad and ramping to 1 over 30 m for trees (hard 0 to padRadius+8), 22 m for shrubs, and from padRadius-8 for ground cover. Key the settlement radius off worldSpec's per-settlement pad radius rather than the hardcoded 46 at boot.ts:1077. This kills the bare disc visible in scatter-spawn.png and is a prerequisite for any in-town garden planting.

6. Fix the seam: generate candidates over the region rect inflated by blendMetres (28 m, worldSpec.ts:175) so the weight test at scatter.ts:363 stops being dead code, and force a treeline - cluster centres within 15 m of a shared edge get R = 9 m and member spacing 4.5 m in the region's dominant species.

7. Add the water/shoreline pass: raise the fishing-cluster exclusion at boot.ts:1085 from cluster.radius+3 to cluster.radius+15 so nothing is drawn under the water disc (radius cluster.radius+14, boot.ts:954), then plant a reed band of grass_wispy_tall in [waterR-1, waterR+3] at 1.4 m spacing with tiltStrength 0, and boost fern/plant_broad_large/flower_b_group x2.5 out to waterR+18.

8. Add the road layer that consumes the existing road splines: path_rock_small_1/small_2/square_thin at 1.5 m spacing with tiltStrength 1.0, sink 0.05 m and +/-0.35 m lateral jitter, one path_rock_round_wide per ~20 m, and pebble_round_1/2 at 0.4 per linear metre in the 2.7-4.5 m verge band. All share the PathRocks material, so with the batching refactor this is zero extra draw calls. All six path_rock assets are currently unused.

9. Swap the two red-material layers: Fallowmarch `bracken` (scatter.ts:501) and Karrowmoor `scrub` (scatter.ts:625) both use bush_common, whose sole material is Leaves_TwistedTree - the exact texture scatter.ts:572-580 removed from Vellenwood for rendering crimson. Use bush_flowering / plant_leafy_large / plant_leafy_small instead. 238 magenta blobs disappear.

10. Add slope preference, altitude bands and the moisture term to the cluster-acceptance test (rock/scree x4 above slope 0.55 and x0.15 below 0.25; broadleaf reject above slope 0.45, pines to 0.70; per-region altitude bands off baseHeight+amplitude), and add `getScatterStats()` to gameDebug backed by the ScatterResult[] that boot.ts:250 currently discards, so the next pass can measure placed/rejected/triangles per layer without re-implementing the sampler.

11. Perf budget to work against: worst pose is highcairn at 397/400 draw calls and 3.77M triangles, running at 2.8 ms median on an RTX 5080 (18.2 ms available for 55 FPS). There is effectively zero draw-call headroom today and roughly 4x frame-time headroom, so every recommendation above is written to ADD instances (free in draw calls) and to SUBTRACT draw calls via material batching. Target after the refactor: scatter at ~20 draw calls and ~6M triangles, ~42 calls handed back to the settlement/buildings work, and near-field prop density up from 42/ha to ~1,875/ha. Re-run `npm run perf -- --run runs/corealm` after the canopy cluster change specifically - 620 trees at 3400 tris with shadows is 4.2M on its own and is the one number in this plan that can blow the budget.

## Files to edit

- game/src/world/scatter.ts
- game/src/render/scene.ts
- game/src/app/boot.ts
- game/src/debug/gameDebug.ts
