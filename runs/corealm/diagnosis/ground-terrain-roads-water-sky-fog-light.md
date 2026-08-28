# ground, terrain, roads, water, sky/fog/lighting

## Summary

There is no texture map anywhere on the terrain, roads, or water — confirmed by grep: `CanvasTexture`, `DataTexture`, `RepeatWrapping`, `onBeforeCompile`, `ShaderMaterial`, `envMap`, and `scene.environment` return zero hits across all of game/src. The ground is one `MeshStandardMaterial({vertexColors:true, roughness:0.97})` shared by all 28 chunks, and the vertex colours it reads change by a measured 0.12 of 255 per channel across a 2 m quad — below the 8-bit display floor, so the ground is literally a solid colour field at every scale a player sees. Roads are 42 separate transparent, depthWrite-off ribbons whose only signal is an alpha feather, and `endFade` at scene.ts:772 punches an unpainted hole at every junction (visible as green at the X-crossing in terrain-bracken_pit). Coldbrace's square is a 7,238 m² disc with a measured relief of exactly 0.0000 m and no paving asset on it, despite `floor_cobble` and `kerb_straight` shipping as exact 2 m grid pieces. Water is a 34-vertex fan with no depth tint, no animation, no shoreline and no environment to reflect, so terrain-redsill_shallows reads as green haze, not a pond. Sky is a flat `Color(0x9fc4dd)` with fog set to the identical colour starting at 90 m, so the whole playable radius has zero aerial perspective and the horizon dissolves. The good news for the fix: the perf baseline has room — worst pose is highcairn at 397/400 draw calls, and deleting the 42 road ribbons pays for everything proposed here.

## Evidence

- **npm run perf -- --run runs/corealm, fresh, ANGLE D3D11 on RTX 5080, 1920x1080, all 18 poses. THIS IS THE BASELINE.** — passed=true, 20 programs, 141 MB heap. Draw calls / triangles / median frame ms per shot: spawn 365 / 2.54M / 3.9; town_entrance 369 / 2.49M / 3.4; town_center 297 / 2.81M / 3.1; bank 310 / 2.85M / 2.5; bracken_pit 140 / 1.75M / 1.2; palewood_copse 70 / 1.08M / 0.7; redsill_shallows 144 / 2.35M / 1.1; marchfield_farm 292 / 3.35M / 2.4; rootfall 240 / 3.07M / 1.2; vellenwood_canopy 195 / 2.82M / 1.2; hollowcut_seam 302 / 3.53M / 2.5; karrowmoor_terraces 293 / 3.48M / 2.8; highcairn 397 / 3.77M / 4.5 (TIGHTEST, 3 calls of headroom); upper_karrow_seam 175 / 2.71M / 2.7; sunder_ledge 198 / 3.11M / 2.8; gravelmaw_entrance 317 / 3.55M / 4.2; great_cairn 150 / 2.62M / 1.2; march_road 234 / 2.86M / 1.4. Worst frames: great_cairn 1130.6 ms, march_road 994.7 ms, gravelmaw_entrance 346.1 ms — shader-compile stalls, not steady-state.
- **Offline instrumentation of buildWorld(buildWorldTerrainSpec()) via tsx: mean absolute vertex-colour delta between horizontally adjacent terrain vertices** — 0.00140 of 3.0 on terrain-chunk-0-0 (51x51 grid, 2601 verts) = 0.12 of 255 per channel per 2 metres; max over the whole chunk 0.0107 = 0.9/255. Below the 8-bit display floor. One exact colour (linear 46,60,20 = fallowmarch groundLow #76854f) covers 21.7% of all sampled terrain vertices across all 28 chunks.
- **Altitude ramp utilisation per region, sampled at 4 m across each rect** — fallowmarch local ramp used -0.35..2.34 (46.9% of samples clamp to 0 = groundLow, 0.8% clamp to 1); vellenwood -0.14..0.33 (groundHigh #576b3f is NEVER reached); karrowmoor -0.13..1.08. Slope > 0.5 (where rock starts to appear) covers only 12.71% of the 700 x 400 m world.
- **Settlement pad flatness, measured over 64 rays x 2 m steps from each settlement centre** — coldbrace radius 48 m, blend 26 m, relief across pad 0.0000 m, area 7,238 m2; rootfall radius 35 m, relief 0.0000 m, area 3,848 m2; highcairn radius 35 m, relief 0.0000 m, area 3,848 m2. 47 flat spots total, 40 of them r=7 location pads.
- **window.__gameDebug getSceneStats() captured live via a play scenario** — 1077 scene objects. 28 terrain chunks (terrain-chunk-0..6, 4 each). 42 road meshes: road-fallowmarch 15, road-vellenwood 12, road-karrowmoor 15 — every one a separate transparent depthWrite:false draw call. 4 water discs. getMetrics at march_road: 234 draw calls, 2,857,652 triangles, 20 programs, 892 entities.
- **grep across all of game/src for texture and shader machinery** — Zero hits for CanvasTexture, DataTexture, RepeatWrapping, generateMipmaps, anisotropy, onBeforeCompile, ShaderMaterial, envMap, scene.environment, PMREM. The only textures in the world are the ones embedded in the 213 GLBs. Terrain, roads and water carry no map of any kind.
- **Captured and read all 18 shots at runs/corealm/screenshots/terrain-<shotId>.png (1280x720, via runs/corealm/scenarios/terrain-shots-a.json and -b.json)** — terrain-palewood_copse: entire frame is one flat green hill against one flat blue sky, zero ground detail, road ends as a soft trapezoid. terrain-great_cairn: an uninterrupted beige mountainside covering ~90% of the frame with no texture and no AO; stumps and pines cut straight into it. terrain-sunder_ledge: a blank grey-lavender plane with two floating white rocks and one hard-edged polygonal shadow. terrain-bracken_pit: four straight road arms cross in an X and THE CENTRE OF THE CROSSING IS GREEN — the endFade hole. terrain-march_road: same pale junction patch, four dead-straight airbrush smears. terrain-redsill_shallows: the pond is invisible as water, a road smear runs across its surface, fishing rings float. terrain-highcairn: the flat pad boundary is a visible arc where uniform grey meets green hillside; roofs near-clipped while ground is undifferentiated. terrain-hollowcut_seam: six ore boulders meet grass at a hard elliptical cut with no darkening. terrain-vellenwood_canopy: uniform dark olive ground, razor-sharp horizon against flat sky. terrain-gravelmaw_entrance: tan boulder props on a uniform grey plane with no colour agreement. terrain-upper_karrow_seam: ore sits on a floating grey cliff slab. terrain-karrowmoor_terraces: two thirds of the frame blocked by an unculled object. terrain-rootfall / terrain-town_center / terrain-town_entrance / terrain-bank / terrain-spawn / terrain-marchfield_farm: buildings and stations on unbroken grass with no square, no paving, no path.
- **Paving asset dimensions read from game/public/assets/manifest.json** — floor_cobble 2.000 x 0.020 x 2.000 m and floor_brick 2.000 x 0.020 x 2.000 m — exact matches for the 2 m module grid buildings.ts already uses. kerb_straight 2.000 x 0.134 x 0.700, kerb_corner 0.700 x 0.134 x 0.700. path_rock_round_wide 2.111 x 0.113 x 2.129, path_rock_round_thin 1.457 x 0.110 x 2.089, path_rock_small_1 1.057 x 0.113 x 1.476, path_rock_small_2 0.993 x 0.149 x 0.966. All unused today.
- **Cost accounting for the proposed scheme against the measured baseline** — Draw calls: -42 (road ribbons) +1 (sky sphere) +1 (contact-decal instancer) +3 (cobble squares, 3 settlements) +6 (kerb and path-rock instancers) = net -31. highcairn 397 -> ~366. Programs: 20 -> 23 (sky, water, contact decals; the terrain splat replaces the existing ground program via customProgramCacheKey rather than adding one). GPU texture memory: detail atlas 1024^2 RGBA + mips 5.6 MB, paving/cobble atlas 5.6 MB, two water normal maps 256^2 RG 0.35 MB, sky gradient 2x256 negligible, PMREM 256 cube 1.4 MB, contact decal 64^2 16 KB = ~13 MB. Vertex attributes: 2 x Uint8-normalised vec4 = 8 bytes/vertex x ~73k terrain vertices = 584 KB. Fill rate: +4-6 texture fetches per terrain fragment, offset by removing ~a third of the frame's blended depth-write-off road overdraw. Boot: +250 ms for baked AO, +8 ms for PMREM, +~20 ms for texture generation. Budget survives with margin at every pose.

## Findings

### 1. [critical/confirmed] Terrain has no texture of any kind; its vertex colour changes 0.12/255 per 2 m quad

`game/src/render/materials.ts:235`

**Root cause.** `MaterialLibrary.ground()` is a single `MeshStandardMaterial({color:0xffffff, vertexColors:true, roughness:0.97})` with no `map`, `normalMap`, `roughnessMap` or `aoMap`. All surface information comes from `scene.ts:687 groundColourAt()`, which lerps two palette swatches by altitude — and altitude only varies at the 74–190 m feature sizes of the height noise, so there is no colour signal at any wavelength a player can see.

**Evidence.** Instrumented `buildWorld(buildWorldTerrainSpec())` offline: mean |dRGB| between horizontally adjacent vertices on terrain-chunk-0-0 is 0.00140 of 3.0, i.e. 0.12 of 255 per channel per 2 metres (max over the chunk 0.0107 = 0.9/255). One exact colour (linear 46,60,20 = fallowmarch groundLow #76854f) covers 21.7% of all sampled terrain vertices. Visible in terrain-palewood_copse and terrain-great_cairn: an entire frame of one unbroken flat colour.

**Fix.** Add a generated 4-channel detail atlas and a splat blend via `onBeforeCompile` on the one ground material. See recommendation 1 for the full spec — keep `groundColourAt` writing the region palette into `color` (that stays the art direction), and add two `Uint8` normalised vec4 attributes carrying surface weights, multiplied by a greyscale detail value sampled at 2.5 m and 37 m tiling so the palette contract in materials.ts is untouched.

### 2. [critical/confirmed] Every road junction has an unpainted hole in it because endFade zeroes the whole first and last cross-section

`game/src/render/scene.ts:772`

**Root cause.** `const endFade = (i === 0 || i === samples.length - 1) ? 0 : 1;` sets vertex alpha to 0 across ALL FOUR lanes of the first and last sample, so the first and last 3 m of every ribbon fades to nothing. Roads are authored as straight links between location nodes (boot.ts:978-996), so 3–5 of them terminate at the same node — and all of their end-fades stack, leaving a bare circle of grass at the exact point the routes meet.

**Evidence.** terrain-bracken_pit: four road arms form an X and the centre of the crossing is GREEN, not brown — the only un-worn ground in the frame is the busiest point on it. Same pale patch at the four-way junction in terrain-march_road (~(500,470)) and under the gate in terrain-spawn. 42 authored road links across 3 regions (counted from content/regions.ts).

**Fix.** Taper the ribbon's WIDTH to zero over the last sample, not its alpha — or better, delete the ribbon meshes entirely and rasterise the road corridor into the terrain's splat weights at build time (recommendation 3). Roads are known before `buildWorld` runs, so the mask can be stamped per-vertex in `buildChunk` alongside the colour, which also removes the 42 draw calls.

### 3. [critical/confirmed] Roads are 42 transparent airbrush smears: no kerb, no gravel, no ruts, no edge, and straight-line-only

`game/src/render/materials.ts:269`

**Root cause.** `road()` is `{transparent:true, depthWrite:false, vertexColors:true, polygonOffset:true}` with no map, and `buildRoad` (scene.ts:748) draws a 4-lane strip whose outer lanes sit at 1.7x half-width with alpha 0. The entire visual difference between road and grass is a flat colour multiply feathered over 1.1 m each side. `buildRoads` in boot.ts interpolates linearly between two location positions, so there is not one curve in the world's road network.

**Evidence.** getSceneStats confirms 42 road meshes (road-fallowmarch 15, road-vellenwood 12, road-karrowmoor 15), each its own draw call with depth writes off. terrain-march_road: four dead-straight orange gradients radiating from one point, each ~5.4 m of pure gradient with no material boundary anywhere. terrain-redsill_shallows: a road smear runs straight across the surface of the pond because the ribbon and the water disc do not know about each other.

**Fix.** Move the worn track into the terrain splat (recommendation 3) and spend the recovered draw calls on real edge geometry: `kerb_straight` (2.0 x 0.134 x 0.7 m) and `kerb_corner` (0.7 m) through one InstancedMesh each, plus `path_rock_round_wide` / `path_rock_small_1/2` scattered along the corridor. Add a lateral wheel-rut term to the splat weight (two darker bands at +/-0.55 m from centreline) so the track reads as used.

### 4. [critical/confirmed] Coldbrace's square is 7,238 m2 of mathematically exact zero relief with nothing on it

`game/src/app/worldSpec.ts:73`

**Root cause.** `settlementRadius()` sizes one circular `FlatSpot` to cover everything the settlement places, and `applyFlats` (scene.ts:556) hard-sets `result = target` inside the radius. Nothing then differentiates that disc from open grass: no paving mesh, no splat change, no kerb, no square.

**Evidence.** Measured over 64 rays x 2 m steps: coldbrace pad radius 48 m, relief across the pad 0.0000 m, area 7,238 m2; rootfall and highcairn 35 m radius, 3,848 m2, also 0.0000 m. terrain-highcairn shows the pad boundary as a visible arc where uniform grey meets green hillside. terrain-town_center and baseline-bank show the bank chest, anvil and cauldron standing on unbroken grass.

**Fix.** `floor_cobble` and `floor_brick` are exactly 2.00 x 0.02 x 2.00 m — they tile the existing 2 m module grid with no authoring. Add a `square: {centre, radius, kind}` to `SettlementDef`, stamp a cobble splat weight into the terrain over it, and lay a 20 x 20 m instanced field of `floor_cobble` (100 instances = 1 draw call) ringed by ~40 `kerb_straight` + 4 `kerb_corner` (2 more draw calls) at the pad edge.

### 5. [critical/confirmed] Water is a 34-vertex fan with no depth, no animation, no shoreline and nothing to reflect

`game/src/render/scene.ts:825`

**Root cause.** `CircleGeometry(radius, 32)` is a triangle fan: 1 hub + 33 rim = 34 vertices over a 46 m diameter disc, so there is no interior geometry to vary. The rim is dropped 0.35 m and faded to alpha 0, which dissolves the outer ~40% of the disc into a wash instead of drawing a waterline. `materials.water()` sets roughness 0.22 / metalness 0.05 — but there is no `scene.environment` and no `envMap` anywhere in the codebase, so a low-roughness surface reflects literally nothing.

**Evidence.** terrain-redsill_shallows: the entire lower half of the frame is a faintly teal haze with no surface, no highlight, no edge and no horizon line; the fishing-spot rings float on it with no contact. A road ribbon crosses straight through it. Water disc radii measured from content: 23, 26, 22, 21 m (cluster.radius + 14).

**Fix.** Rebuild the disc as a radial grid (32 segments x 10 rings, 330 verts), and write `depth = level - scene.heightAtXZ(x,z)` into each vertex's colour channel. In a small `onBeforeCompile`, tint shallow->deep across 0..1.2 m of depth and fade alpha only across the last 0.25 m so the shoreline lands exactly where terrain crosses the plane. Add two generated 256x256 RG normal maps (8.0 m and 3.7 m tiling, scrolling 0.012 and -0.019 m/s, 33 degrees apart, combined by partial-derivative blend). Set `scene.environment` from a PMREM of the new sky gradient so the GGX lobe has something to return.

### 6. [high/confirmed] The altitude ramp clamps out: 46.9% of Fallowmarch is one flat swatch, and Vellenwood never reaches its groundHigh

`game/src/render/scene.ts:705`

**Root cause.** `local = clamp((height - baseHeight) / amplitude, 0, 1)` assumes the region's height field spans exactly 0..amplitude. It does not. Plains heights go negative (baseHeight 0, relief +/-11 m) so everything below the floor clamps to `groundLow`; Vellenwood's authored amplitude 26 is more than twice the relief it actually produces, so `local` never exceeds 0.33 and `groundHigh` (#576b3f) is dead data.

**Evidence.** Sampled at 4 m over each region rect: fallowmarch local ramp used -0.35..2.34, 46.9% of samples clamp to 0 and 0.8% clamp to 1; vellenwood local ramp used -0.14..0.33 (its top two-thirds of authored colour is never drawn); karrowmoor -0.13..1.08. Matches the flat uniform green across the whole lower half of baseline-spawn and terrain-vellenwood_canopy.

**Fix.** Normalise against the region's ACTUAL height range, not its authored amplitude. Compute min/max of `naturalHeight` over the rect once during `buildWorld` (a 4 m sweep costs ~10 ms) and cache it on the `RegionField`, then `local = smoothstep01((height - hMin) / (hMax - hMin))`. This is a 3-line change and it immediately restores the full eight-swatch palette that materials.ts already authored.

### 7. [high/confirmed] Flat background colour, fog set to the identical colour, and fog starting at 90 m — no sky, no horizon, no aerial perspective

`game/src/render/renderer.ts:43`

**Root cause.** `scene.background = new THREE.Color(0x9fc4dd)` and `scene.fog = new THREE.Fog(0x9fc4dd, 90, 260)`. The background has zero gradient, so there is nothing to read as sky. Fog near = 90 m means the entire gameplay volume (camera distance 6-34 m per config.ts CAMERA) receives exactly zero atmospheric attenuation, so a hill 60 m away is drawn at full saturation next to ground at 8 m.

**Evidence.** terrain-palewood_copse: the top third of the frame is a single flat blue with no gradient and no sun. terrain-great_cairn: a mountain crest against dead-flat blue with no rim haze. terrain-highcairn: the ridge ~60 m behind the village is exactly as saturated as the ground under the player's feet, so the frame has no depth cue at all. Confirmed no IBL: grep for `scene.environment|PMREM|envMap` across game/src returns nothing.

**Fix.** Add a `SphereGeometry(1000, 32, 16)` on `BackSide` with a `MeshBasicMaterial({map: gradientTex, fog:false, depthWrite:false, toneMapped:true})`, `renderOrder -1` (+1 draw call, +1 program). Gradient authored as a 2 x 256 CanvasTexture: zenith #4f83b8 -> horizon #cfe0e8 with a warm #e8d8b8 band in the lowest 12%, sun-side biased. Then PMREM that texture into `scene.environment` (256px cube, ~1.4 MB) so every roof, weapon and the water gain an IBL fill. Change fog to `new THREE.Fog(0xb8cfe0, 30, 300)` — starting at 30 m puts 8-15% haze on the mid-ground where the depth cue is needed, and 300 m matches CAMERA.far 280 with margin.

### 8. [high/confirmed] Lighting rig is a 1.6:1 key-to-fill wash with a 50-degree sun, so nothing has form

`game/src/render/renderer.ts:52`

**Root cause.** Key 2.4, hemi 1.15, bounce directional 0.35 — total ambient ~1.5 against a 2.4 key. The sun sits at `(42,60,26)` relative to target, which is atan(60/hypot(42,26)) = 50.5 degrees elevation: near-noon light, short shadows, flat terrain shading. Exposure 1.05 with ACES on top of a 2.4 key is clipping the roof texture.

**Evidence.** terrain-highcairn: roof tiles are near-clipped orange while the ground under them is an undifferentiated grey; the terrain relief across the whole frame reads as one value. terrain-sunder_ledge: an entire 1280x720 frame of one grey-lavender value with no gradient across a slope that is 36 m of authored verticality. terrain-great_cairn: a mountainside with no shading break between the lit and shaded faces of the ridge.

**Fix.** Sun 0xffe9c4 at 3.0, position offset (58, 42, 34) = 32 degrees elevation (shadows 1.6x longer, raking across the Karrowmoor terraces). Hemisphere (sky 0x9fc4dd / ground 0x4a4436) down to 0.55. Delete the 0.35 bounce directional entirely and let `scene.environment` do that job — it is directionally correct and free once the PMREM exists. `toneMappingExposure` 1.0. That takes the key:fill ratio from ~1.6:1 to ~5:1.

### 9. [high/confirmed] No ambient occlusion or contact darkening anywhere, so every prop, rock and tree floats on the surface

`game/src/render/scene.ts:687`

**Root cause.** `groundColourAt` writes only palette lerps — no sky-visibility term, no cavity term. There is no `aoMap` on the ground material and no SSAO pass. Props are drawn as instanced meshes with no contact decal, so the only thing joining an object to the ground is the directional shadow, which at 50 degrees elevation lands metres away from the object's base.

**Evidence.** terrain-hollowcut_seam: six ore boulders meet the grass at a hard elliptical cut with no darkening, no dirt mound, no debris. terrain-palewood_copse: tree trunks intersect the ground as clean cylinders with a soft blob shadow offset well to one side. terrain-great_cairn: stumps and pines sit on the slope with no seat at all.

**Fix.** Two cheap passes, both zero runtime cost. (a) Bake a horizon-angle AO term into the terrain vertex colour during `buildChunk`: for each vertex, sample `heightAtXZ` along 8 azimuths at 12 / 25 / 50 m, take max elevation angle, and multiply the colour by `mix(0.62, 1.0, 1 - maxAngle/(PI/2))`. 73k verts x 24 extra height samples adds roughly 250 ms to boot, and it is what makes the great_cairn slope read as a mountain. (b) One `InstancedMesh` of 1 x 1 m quads with a generated 64 x 64 radial-alpha texture, one instance under every prop/rock/tree placement, `depthWrite:false`, `renderOrder 1` — one draw call for the whole world's contact shadows.

### 10. [medium/confirmed] Exposed rock only ever reaches 12.7% of the world and arrives as a hard smoothstep band

`game/src/render/scene.ts:729`

**Root cause.** `rockAmount = smoothstep01((slope - 0.5) / 0.55)` is the only surface-type variation in the entire terrain. It is driven purely by gradient, so flat scree fields, riverbanks, quarry floors and worn ground are all impossible to express, and where it does fire it is a smooth grey wash over green with no material change.

**Evidence.** Sampled at 4 m across the whole 700 x 400 m world: only 12.71% of it has slope > 0.5, the point where rock begins to appear at all. terrain-karrowmoor_terraces: the rock/grass transition on the terrace riser is a soft grey-over-green paint edge with no texture break. terrain-gravelmaw_entrance: the dungeon mouth is a cluster of tan boulder props sitting on a uniform grey plane with no scree, no debris, no colour agreement between prop and ground.

**Fix.** Once the splat attributes exist (recommendation 1), drive them from more than slope: slope -> rock, curvature (second derivative of the height field, already cheap given the central differences at scene.ts:394) -> gravel in hollows and dry grass on crests, distance-to-water -> mud, distance-to-road -> dirt, settlement pad -> cobble. All of these are computable in `buildChunk` from data the file already has.

### 11. [medium/confirmed] 42 transparent depth-write-off road ribbons are the frame's largest overdraw source and the largest single draw-call block

`game/src/render/scene.ts:803`

**Root cause.** Each authored road link becomes its own `THREE.Mesh` added to the scatter group, with a `transparent:true, depthWrite:false, side:DoubleSide` material. They are not batched, not merged, not instanced, and they cannot depth-reject each other.

**Evidence.** getSceneStats at runtime: 42 road meshes. Perf baseline: highcairn peaks at 397 draw calls against a 400 ceiling — 3 calls of headroom. In terrain-march_road the road ribbons cover roughly a third of the visible ground as blended, depth-write-off geometry.

**Fix.** Removing them in favour of terrain splat weights recovers 42 draw calls and the associated blended fill. That single change funds the sky sphere (+1), the contact-decal instancer (+1), the cobble square (+1), and the kerb/path-rock instancers (~4) with about 35 calls still returned to the budget.

### 12. [medium/confirmed] A shader program compiles mid-session, producing a 1.1 second frame

`game/src/render/renderer.ts:29`

**Root cause.** Programs go 19 -> 20 between the `spawn` pose and every later pose, i.e. a material is first drawn after boot completes and triggers a compile at that moment. Nothing pre-warms the pipeline.

**Evidence.** npm run perf 2026-08-28T18:47:43Z: spawn and town_entrance report `programs: 19`, all 16 later shots report 20. Worst frame times in the same run: great_cairn 1130.6 ms, march_road 994.7 ms, gravelmaw_entrance 346.1 ms, against medians of 1.2-4.2 ms.

**Fix.** Call `renderer.compile(scene, camera)` at the end of boot after the world, entity views and overlays are built. This matters more once the splat, sky and water shaders land — they add 3 more programs, and each is another potential 300-1000 ms stall the first time a pose reveals it.

### 13. [medium/confirmed] Terrain silhouette is a smooth arc with visible 2 m facets and no macro relief

`game/src/render/scene.ts:112`

**Root cause.** `metresPerQuad: 2` with `computeVertexNormals()` and no flat shading gives smooth Gouraud interpolation across quads, but the underlying fbm uses feature sizes 120 / 74 / 105 m with only 3-4 octaves and amplitude multipliers of 0.62 / 0.55 — so the highest-frequency content in the height field is around 21-26 m wavelength. There is nothing between 2 m (the quad) and 21 m (the finest noise octave).

**Evidence.** terrain-palewood_copse: the horizon is a single clean parabolic arc across the whole frame width. terrain-bracken_pit: diagonal shading seams from the 2 m quad diagonals are visible on the otherwise-flat green. terrain-vellenwood_canopy: the hill behind the trees is one smooth dome.

**Fix.** This is fixed by the splat detail rather than by more geometry — do NOT raise the tessellation, it doubles the heightfield and navmesh cost. Add a fourth octave at 9 m feature size and 0.08 amplitude to `makeRegionField` for the plains and woodland cases, and let the 2.5 m detail texture plus its derivative-based normal perturbation carry everything below that.

### 14. [low/confirmed] The karrowmoor_terraces pose is entirely blocked by an unculled object filling two thirds of the frame

`game/src/debug/shots.ts:88`

**Root cause.** Outside this domain's ownership, but it invalidates the one shot whose stated intent is 'the verticality read: four terraces stacked'. Some large scatter or landmark asset sits between the shot camera and the terraces, and camera.ts's occlusion probe does not push through it.

**Evidence.** terrain-karrowmoor_terraces: a solid flat brown wall occupies the right two thirds of the 1280 x 720 frame. Only a strip at the left shows the actual terrain, and there the terrace riser does read correctly as grey rock over green.

**Fix.** Hand to whoever owns render/camera.ts and world/scatter.ts. For this domain's purposes the shot must be re-captured after the fix before the terrace ground treatment can be judged.

## Recommendations

1. 1. GENERATE THE DETAIL ATLAS AT BOOT. New file render/proceduralTextures.ts (owned by render, no gameplay state). Author ONE 1024x1024 RGBA8 CanvasTexture, `colorSpace = NoColorSpace` (linear, value-only — hue stays in REGION_PALETTES so materials.ts's eight-swatch contract is untouched). R = grass: 5 octaves of value noise at base period 64 px, lacunarity 2.03, gain 0.5, remapped to 0.72..1.18, plus a 6 px Worley clump pass at 0.15 weight for tussocks. G = soil/dry: 4 octaves at base 96 px remapped 0.78..1.14 with a directional streak (x-axis stretch 3:1) so tracks read as dragged, not spotted. B = rock: ridged noise `1 - |fbm|` 4 octaves at base 40 px remapped 0.60..1.25, high contrast for cliff faces. A = gravel/cobble: Worley F1 at cell size 22 px, thresholded to give visible stone boundaries, remapped 0.70..1.20. `wrapS = wrapT = RepeatWrapping`, `generateMipmaps = true`, `minFilter = LinearMipmapLinearFilter`, `anisotropy = min(8, renderer.capabilities.getMaxAnisotropy())`. Everything must go through core/rng.ts streams, not Math.random — one named stream per channel so the atlas is byte-identical across reloads. Memory: 4.2 MB + mips = 5.6 MB.

2. 2. SPLAT THE TERRAIN VIA onBeforeCompile. In scene.ts `buildChunk`, alongside the existing `colours` Float32Array, build two `Uint8Array(count*4)` normalised attributes: `aSplatA` = (grass, dryGrass, rock, gravel) and `aSplatB` = (dirt/road, mud, cobble, wet) — 8 bytes/vertex, ~584 KB over the world's ~73k terrain vertices. Weights come from the data buildChunk already computes: slope -> rock (reuse `rockAmount` at scene.ts:729), altitude -> grass/dryGrass (after fixing the clamp, see item 6), height-field curvature from the existing central differences -> gravel in hollows, plus the road/pad/water stamps from item 3. Normalise so the eight weights sum to 1. On `MaterialLibrary.ground()`, set `material.customProgramCacheKey = () => 'ground-splat-v1'` and `material.onBeforeCompile = (shader) => {...}`: prepend `attribute vec4 aSplatA; attribute vec4 aSplatB; varying vec4 vSplatA; varying vec4 vSplatB; varying vec3 vWorldXZ;` to `shader.vertexShader`, and append to `#include <begin_vertex>`: `vSplatA = aSplatA; vSplatB = aSplatB; vWorldXZ = (modelMatrix * vec4(transformed,1.0)).xyz;`. In `shader.fragmentShader`, replace `#include <map_fragment>` (the token is present in the unresolved source even with no `material.map`) with: sample `uDetail` at `vWorldXZ.xz / 2.5` and again at `vWorldXZ.xz / 37.0`; `float d = dot(vSplatA, det) + dot(vSplatB, det2)` style dot products against the four channels for each attribute group; `float macro = 0.75 + 0.5 * dot(vSplatA, mac);` then `diffuseColor.rgb *= (0.62 + 0.76 * d * macro);`. Because this only touches `diffuseColor` before `<lights_fragment_begin>`, shadows, all four lights, ACES tone mapping, fog and the sRGB output conversion are all downstream and keep working untouched. The terrain has `castShadow = false` so there is no depth-material variant to keep in sync. Two tiling scales from the same texture is what kills the 700 x 400 m repeat with zero extra memory. Add uniforms via `shader.uniforms.uDetail = {value: atlas}` and hold a reference so hot-reload does not orphan it.

3. 3. KILL THE ROAD RIBBONS, STAMP THE ROADS INTO THE GROUND. Delete the 42 `buildRoad` meshes. Instead, pass the resampled road polylines into `buildWorld` before chunk generation (they are derived in boot.ts:978 from content/regions.ts, which already runs first). Per terrain vertex, compute distance to the nearest road segment: <= 1.6 m -> dirt weight 1.0; 1.6..3.0 m -> smoothstep falloff; add two rut bands at |perp| in 0.45..0.65 m carrying +0.35 gravel weight and a -8% value multiply into the vertex colour. Because this lives in the terrain mesh it is mip-correct, shadow-correct, z-fight-free by construction, and the junction hole at scene.ts:772 stops existing. Then spend the recovered calls on edge geometry: one InstancedMesh of `kerb_straight` (2.0 x 0.134 x 0.7 m) along road edges inside settlement pads only, plus `path_rock_round_wide` / `path_rock_round_thin` / `path_rock_small_1` / `path_rock_small_2` scattered at 1 per 6 m along the corridor through the existing `scatterInstanced` path. Roads should also stop being straight: subdivide each link into 4 control points and offset the interior two by up to 12% of the link length using a seeded rng stream, then resample — the route graph in world/regionBuilder.ts is unaffected because it works on node ids, not on ribbon geometry.

4. 4. PAVE THE SQUARES. Add `square?: {centre:[number,number], radius:number, kind:'cobble'|'brick'}` to `SettlementDef` in content/regions.ts. worldSpec.ts already knows the settlement pad; feed the square into the same splat stamp so the ground under the paving turns cobble, then lay actual geometry: `floor_cobble` is exactly 2.00 x 0.02 x 2.00 m and tiles the existing 2 m module grid with no authoring, so a 20 x 20 m square is 100 instances in ONE InstancedMesh. Ring it with ~40 `kerb_straight` + 4 `kerb_corner` (2 more calls). Total cost for all three settlements: about 9 draw calls. Lift the paving 0.015 m and give the material `polygonOffsetFactor -1` since the pad under it is exactly flat (measured 0.0000 m relief), so there is no draping problem.

5. 5. REBUILD THE WATER. Replace `CircleGeometry(radius, 32)` at scene.ts:825 with a radial grid: 32 segments x 10 rings = 330 vertices. Per vertex write `depth = level - scene.heightAtXZ(worldX, worldZ)` into the green channel of the existing 4-component colour attribute (the alpha channel is already wired through `vertexColors`). New `MaterialLibrary.water()` keeps `MeshStandardMaterial` but adds `onBeforeCompile`: tint `diffuseColor.rgb` from a shallow tint (palette.water lifted 45% toward palette.groundLow) to the deep tint (palette.water darkened 30%) across depth 0..1.2 m, and drive `diffuseColor.a` as `smoothstep(0.0, 0.25, depth)` so the waterline lands exactly where terrain crosses the plane instead of 20 m out. Roughness 0.10, and TWO generated 256x256 RG normal maps (derived from the same value-noise generator, converted to normals by central difference), tiling 8.0 m and 3.7 m, scrolled at 0.012 and -0.019 m/s along directions 33 degrees apart, combined by partial-derivative blend in a replaced `#include <normal_fragment_maps>`. This only works once `scene.environment` exists (item 7) — without an IBL a roughness-0.10 surface is black.

6. 6. FIX THE ALTITUDE CLAMP FIRST — it is 3 lines and it un-deadens half the world. In `buildWorld`, sweep `naturalHeight` over each region rect at 4 m and cache `hMin`/`hMax` on the `RegionField`. In `groundColourAt` at scene.ts:705, replace `clamp((height - baseHeight)/amplitude, 0, 1)` with `smoothstep01((height - field.hMin) / max(1, field.hMax - field.hMin))`. Measured today: 46.9% of Fallowmarch clamps to groundLow, and Vellenwood only ever uses 0.00..0.33 of its authored ramp so #576b3f is never drawn. Do this before the splat work so you can see what the palette was always supposed to look like.

7. 7. SKY, FOG, IBL, LIGHTS — all in renderer.ts, all numbers stated. Sky: `SphereGeometry(1000, 32, 16)` on `BackSide`, `MeshBasicMaterial({map: gradient, fog:false, depthWrite:false})`, `renderOrder -1`, added to the scene as a child of the camera so it never leaves the frustum. Gradient is a 2 x 256 CanvasTexture: zenith #4f83b8 at v=0, #7ba7cc at v=0.45, horizon #cfe0e8 at v=0.88, warm #e8d8b8 in the lowest 12%. PMREM that texture (`PMREMGenerator.fromEquirectangular` on a 2 x 256 equirect, or `fromScene` on the sphere) into `scene.environment` — 256px cube, ~1.4 MB, generated once at boot in about 8 ms. Fog: `new THREE.Fog(0xb8cfe0, 30, 300)` — near 30 puts 8-15% haze on the mid-ground where the current 90 puts zero. Sun: colour 0xffe9c4, intensity 3.0, `followShadow` offset changed from (42,60,26) to (58,42,34) = 32 degrees elevation, shadows 1.6x longer. Hemisphere down from 1.15 to 0.55 with sky 0x9fc4dd / ground 0x4a4436. DELETE the 0.35 bounce directional — the environment map replaces it and is directionally correct. `toneMappingExposure` 1.05 -> 1.00. Shadow camera from +/-70 to +/-48 (2.9 cm/texel at 2048 instead of 6.8), `bias -0.0004`, `normalBias 0.02`.

8. 8. BAKE AO INTO THE TERRAIN, AND ADD CONTACT DECALS. In `buildChunk`, per vertex sample `heightAtXZ` along 8 azimuths at 12 / 25 / 50 m, take the max elevation angle to the horizon, and multiply the vertex colour by `mix(0.62, 1.0, 1 - maxAngle/(PI/2))`. That is 24 extra height samples per vertex over ~73k vertices, roughly 250 ms added to boot, zero runtime cost, and it is the single change that makes the great_cairn slope read as a mountain rather than a beige card. Separately, one InstancedMesh of 1 x 1 m quads with a generated 64 x 64 radial-alpha texture (16 KB), one instance under every prop/rock/tree placement, `depthWrite:false`, `renderOrder 1`: one draw call buys contact shadows for the entire world and fixes the floating read in terrain-hollowcut_seam and terrain-great_cairn.

9. 9. CALL renderer.compile(scene, camera) AT THE END OF boot.ts. Programs go 19 -> 20 mid-session today and the associated frames are 1130 ms, 994 ms and 346 ms. This proposal adds 3 more programs (sky, water, contact decals — the terrain splat replaces the existing ground program rather than adding one). Without a pre-warm each of those is another multi-hundred-millisecond stall the first time a pose reveals it.

10. 10. RE-MEASURE. After landing, run `npm run perf -- --run runs/corealm` and check highcairn specifically: it is the tightest pose at 397/400 draw calls today and the road-ribbon deletion should take it to roughly 362. Then re-capture all 18 poses (the scenarios are at runs/corealm/scenarios/terrain-shots-a.json and -b.json, 9 shots each, and karrowmoor_terraces must be re-shot after the camera occlusion is fixed) and read them back.

## Files to edit

- game/src/render/materials.ts
- game/src/render/scene.ts
- game/src/render/renderer.ts
- game/src/render/proceduralTextures.ts
- game/src/app/boot.ts
- game/src/app/worldSpec.ts
- game/src/content/regions.ts
