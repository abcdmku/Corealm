# collision — what the player can walk through that they should not

## Summary

"No collisions" is almost literally true: the entire world has exactly 40 colliders — one terrain heightfield plus 39 static boxes derived from the 36 authored `settlement.buildings` — and nothing else in the game is solid. 892 semantic entities exist; 0 of them register a volume. I walked the player straight through the bank chest, the anvil, the cauldron, both market stalls, an NPC, an enemy, a resource tree, an ore rock, a landmark composition, the region gate arch, and a pond (walking the lake bed 0.50 m under the water plane). Buildings do block, but only because boot step 8b feeds Recast invisible boxes — and that mechanism has three of its own defects: the 2 m gap in Coldbrace's south gatehouse is completely eroded away, so the gate the player spawns in front of is impassable and the path from spawn to the bank detours around the outside of the gatehouse; each box leaves a walkable roof island (the player stands on the March Company Hall ridge at y=9.041 and strolls 5 m along it); and each box leaves a disconnected interior island that `Navigation.findPath` then bridges with a fabricated straight segment, so click-to-move walks the player through cottage walls and through the Forge Shed. Movement never touches Rapier at any point — `physics.step()` runs every frame over 40 static bodies purely so the camera occlusion ray works. The fix is option (a): carve every solid thing into the navmesh via one generic volume list, clamp direct steps against that list, and stop `findPath` from inventing the last leg. That needs no character controller, no second position source, no RNG, and cannot break the gate check as long as carve radii stay under INTERACT_RANGE = 2.4 m.

## Evidence

- **Walk-through table. Camera yaw 3.002 fixed, so W = (-0.139, +0.990) and D = (-0.990, -0.139). For each target: teleport to target - forward*standoff, hold the key, read getPlayerPosition. 'signed' = (end - targetCentre) dot forward; positive means the player finished PAST the object's centre.** — BLOCKED - cottage coldbrace_house_3 (-146,-104) 6x4: start (-144.89,1.04,-111.92) end (-146.06,1.04,-107.30), travelled 4.77 of 12.6 free, stopped 3.30 m from centre (1.30 m outside the wall). BLOCKED - gatehouse pier_l (-162,-108): start (-161.16,-113.94) end (-161.68,-110.23), 3.75 of 10.5. BLOCKED - wall_segment coldbrace_wall_s (-176,-108) 8x0.5: start (-175.16,-113.94) end (-176.51,-109.55), 4.59 of 11.55, signed -1.46. BLOCKED - south gate GAP, dead centre of the 2 m opening at (-160,-108): start (-159.16,-113.94) end (-160.10,-110.00), 4.05 of 13.65, signed -1.97: THE GATE IS SHUT. WALK-THROUGH - bank chest coldbrace_bank (-160,-88): start (-159.30,-92.95) end (-160.18,-86.71), travelled 6.30, signed +1.30. WALK-THROUGH - anvil coldbrace_anvil (-154,-94) approached along +X with D: start (-149.05,-93.30) end (-156.53,-94.36), signed +2.56. WALK-THROUGH - cauldron coldbrace_furnace (-150,-94): end (-149.68,-91.94), signed +2.06. WALK-THROUGH - market_stall coldbrace_general (-176,-80): start (-175.30,-84.95) end (-176.36,-77.46), signed +2.56. WALK-THROUGH - NPC npc_carter_bel (-158,-102): start (-157.49,-105.62) end (-158.19,-100.63), travelled 5.04 (more than the 4.2 m of free travel for the same hold), signed +1.38. WALK-THROUGH - tree palewood_copse_trees_1 at (-330.78,-0.81,-64.58): end (-330.93,-0.56,-63.55), 1.04 m PAST the trunk centre. WALK-THROUGH - ore bracken_pit_grithe_1: start (-156.19,74.61) end (-157.54,84.17), travelled 9.66 = full free travel, no deflection. WALK-THROUGH - enemy rill_skitterlings_1 centre (-82.38,-69.53): end (-82.86,-66.16), signed +3.40. WALK-THROUGH - water, Redsill Shallows (-40,-60): start (-38.61,-0.56,-69.90) end (-40.54,-0.56,-56.18), travelled 13.86 m straight across the pond, y never changes from the basin floor.
- **runs/corealm/screenshots/collision-in-water.png (captured this session): player teleported to the centre of Redsill Shallows.** — The player is standing on the lake bed with the water plane cutting across them at hip height, casting a shadow on the bottom. Water surface = basinFloor + WATER_BASIN_DEPTH*0.55 = playerY + 0.495, so the player is 0.50 m submerged and walks freely. scene.ts:815 comments the water mesh as 'Not walkable, not a collider' - but the terrain under it IS in getWalkableMeshes(), so the navmesh covers the whole basin.
- **runs/corealm/screenshots/baseline-bank.png - verifying root's claim that the player stands INSIDE the bank chest.** — CONFIRMED. The chest_wood mesh passes through the player's shins; the legs and feet are hidden inside the chest volume and the lid is at hip height. The anvil and cauldron are visible loose on grass in the same frame with nothing solid about them.
- **Nav path across the south gatehouse. getNavPath at seven x values from -162 to -158, each from z=-112 to z=-104 (straight through the 2 m gate opening at (-160,-108)).** — Not one path goes through. x=-160: (-160,-112) -> (-163.25,-110.45) -> (-164.15,-110) -> (-164.15,-106.85) -> (-163.7,-105.5) -> (-160,-104) - a detour around the OUTSIDE of the west pier. x=-159 and -158 detour to x=-156.05 around the east pier. Live confirmation: corealm_move_to locationId bank_interior from spawn (-160,-118) tracked (-160.4,-117.3) (-162.3,-113.5) (-164.2,-108.5) (-164.2,-107.6) (-163.6,-104.3) ... (-160,-88). The player walks around the gatehouse, not through it. Arithmetic: gap 2.0 m minus 2 x walkableRadius (2 voxels x cs 0.45 = 0.90 m) leaves 0.20 m, which cs-0.45 rasterisation and minRegionArea then delete entirely.
- **Nav path around a cottage, to check boot step 8b actually works.** — WORKS for the outside. (-146,1,-110) -> (-142.1,-107.3) -> (-141.65,-104.15) -> (-142.1,-101) -> (-146,-98): a clean 4-corner detour around the east side of coldbrace_house_3. Building nav obstacles are doing their job on the exterior.
- **Partial-path fabrication. getNavPath from inside coldbrace_house_3 (-146,-104) to the town square (-160,-80), then the same journey driven live through corealm_move_to.** — Path returned is 3 points: (-146,-104) -> (-147.95,-103.25) -> (-160,-80). The last leg is a 26 m straight line. The live track walked it verbatim: (-147.2,-103.5) (-148.5,-102.1) (-149.9,-99.5) (-150.8,-97.7) (-151.4,-96.5) (-152.4,-94.7) ... - (-150.8,-97.7) and (-151.4,-96.5) are inside the Forge Shed footprint (x -154..-150, z -100..-96). The player walked out through the cottage wall and then through the shed.
- **The same bug in the other direction: corealm_move_to position [-146,1.04,-104] (the middle of a cottage) starting from the town square (-160,-80).** — Tool returned pathLength 28.34, etaMs 6748 - a successful path. Track ends (-146.0,-102.1) (-146.0,-103.0) (-146.0,-103.8) and holds there. The cottage spans z -106..-102, so the player walked through the south wall and parked inside the building. Screenshot runs/corealm/screenshots/collision-pathed-into-cottage.png.
- **Roof islands. getNavPath probes started at roof height above two buildings.** — (-146,5,-104) snaps to y=7.841 (cottage roof); (-160,6,-60) snaps to y=9.041 (hall roof). Both are real walkable polygons. Reachable in play: __gameDebug.teleport({x:-160,y:9,z:-60}) - which is the same nav.closestPoint() call used by teleport, teleportPlayer (region travel), focusCamera and death respawn - landed the player at (-160, 9.041, -60), and holding D walked them to (-164.99, 9.041, -60.70). Screenshot runs/corealm/screenshots/collision-on-hall-roof.png shows the player standing on the roof ridge of the March Company Hall. getNavPath from the roof to the square returns (-160,9.041,-60) -> (-160.1,9.041,-61.85) -> (-160,1.041,-80): a partial path with an 18 m fabricated leg that falls 8 m through the roof.
- **Collider inventory. Read every physics.* call site in boot.ts and every BuildingBox emission site.** — boot.ts has exactly four physics calls: create(), addHeightfield() (line 161), addStaticBox() in the step-8b loop (line 220), and raycast() for the camera occlusion probe (line 281). 36 authored buildings across three settlements produce 39 boxes (3 gatehouses emit 2 piers each). Grep for physics/collider in world/scatter.ts returns nothing. Grep for 'fence' across game/src returns zero world uses. movement.ts contains no reference to Physics at all.
- **Entity census from __gameDebug.getEntities(), grouped by archetype.** — 892 entities total: landmark 725 (building parts + landmark/gate compositions), enemy 50, tree 26, ore 21, fishing_spot 13, npc 12, station 10, farm_plot 10, obstacle 9, shop 5, portal 5, bank 3, door 2, boss 1. None of these carries a collision volume; only the 39 prefab boxes exist, and those are derived from settlement.buildings, not from entities.
- **Diagonal wall slide behaviour (W+A into the hall's south face at z=-63).** — Not a bug: start (-166,-65), end (-159.82,-64.10), travelled 6.25 m. The player slides along the wall, clamped 1.10 m south of the face. The 0.6 m snap-rejection at movement.ts:245 only hard-stops when the whole desired step lands more than 0.6 m off-mesh.
- **Navmesh config read from app/config.ts and confirmed against the measured wall standoff.** — NAV_CONFIG = { cs 0.3, ch 0.2, walkableRadius 2 voxels, walkableClimb 2, walkableHeight 9, walkableSlopeAngle 48, minRegionArea 4 }. World extent > 320 m so LARGE_WORLD_CELL_SIZE 0.45 is used (navigation.ts:44); polyCount 3169, strategy solo. Effective agent radius = 2 x 0.45 = 0.90 m. Predicted stop distance from the 0.5 m-thick south wall = 0.25 + 0.90 = 1.15 m; measured 1.46 m (the extra 0.31 m is cs quantisation). The player's shoulders are ~0.35 m, so the radius is 2.5x too generous - walls repel the player half a metre before they look like they should.

## Findings

### 1. [critical/confirmed] Only 39 boxes in the whole world are solid — every prop, station, shop, bank, NPC, enemy, tree, rock, landmark and gate is walk-through

`game/src/app/boot.ts:217`

**Root cause.** boot step 8b registers collision for exactly one thing: `built.buildings`, which regionBuilder only populates from `settlement.buildings` via `prefabCollision`. Every other entity emitter in `buildRegionEntities` (bank, shops, stations, npcs, obstacles, enemies, landmarks, gates, clusters) pushes a SemanticEntity and no volume, and `scatter.ts` never touches physics or nav at all.

**Evidence.** Physics call sites in boot.ts total four: create, addHeightfield (161), addStaticBox in the 8b loop (220), raycast for camera occlusion (281). 892 entities exist; 39 boxes from 36 authored buildings. Measured signed pass-through past object centres: bank chest +1.30 m, anvil +2.56 m, cauldron +2.06 m, market stall +2.56 m, NPC Carter Bel +1.38 m, enemy +3.40 m, tree trunk +1.04 m, ore rock full free travel with no deflection. baseline-bank.png shows the player's legs inside the chest.

**Fix.** Generalise `BuildingBox` (regionBuilder.ts:115) into a `SolidVolume { id, kind: 'box'|'cylinder', position, halfExtents|radius+height, rotationY }` list on `BuiltWorld`, and emit one from every site in `buildRegionEntities`: bank :333, shops :352, stations :368, landmarks :433 plus emitComposition :443, gates :461 plus emitComposition :469, cluster nodes in buildCluster :658. Have `scatterWorld` (scatter.ts:424) return its placed instance transforms so boot can emit cylinders for tree_*/boulder_*/cliff_* while skipping grass and pebbles. Feed the whole list to the two consumers step 8b already uses: `physics.addStaticBox/addStaticCylinder` and `buildNavObstacles`. Keep every carve radius under INTERACT_RANGE (2.4 m) so `moveTo(entityId)` with its 2.4 m stopDistance trim still lands in range and the gathering/talking gate checks still pass.

### 2. [critical/confirmed] Coldbrace's south gate is impassable — the player cannot walk through the gate they spawn in front of

`game/src/render/buildings.ts:910`

**Root cause.** `prefabCollision` leaves a 2.0 m gap between the two gatehouse piers, but the navmesh erodes 0.90 m off every obstacle (walkableRadius 2 voxels at cs 0.45), so 2.0 - 1.8 = 0.2 m survives and cs-0.45 rasterisation plus minRegionArea delete that remainder. The comment on line 911 ("blocking it would wall the town shut") describes exactly what happens anyway.

**Evidence.** Holding W dead-centre of the gate from (-159.16,-113.94) stopped at (-160.10,-110.00) after 4.05 m of a possible 13.65 m — 1.97 m short of the gatehouse centre. getNavPath at x = -162, -161, -160.5, -160, -159.5 all detour to x=-164.15 around the west pier; x=-159, -158 detour to x=-156.05 around the east pier. Live corealm_move_to from spawn to bank_interior tracked out to (-164.2,-108.5) and back — the player's first walk in the game goes around the gatehouse.

**Fix.** Two changes, neither sufficient alone. In `prefabCollision`, widen the gate: `const pier = (width - GATE_CLEAR) / 2` with GATE_CLEAR >= 3.0, and bump the three authored gatehouse footprints in content/regions.ts from [6,3] to [8,3] so the piers stay visually substantial. Then drop `NAV_CONFIG.walkableRadius` (app/config.ts:46) from 2 to 1 voxel — 0.45 m still exceeds the player's 0.35 m shoulder width and halves the invisible standoff everywhere. Acceptance probe: `getNavPath([-160,1,-112],[-160,1,-104])` must return a straight 2-point path.

### 3. [critical/confirmed] Navigation.findPath fabricates the last leg of a partial path, so click-to-move walks straight through walls

`game/src/systems/navigation.ts:376`

**Root cause.** When Detour returns a partial path (destination on a disconnected polygon — which is every building interior and every roof), findPath unconditionally appends the snapped destination: `if (distance(last, snappedEnd) > 0.05) points.push(snappedEnd)`. Movement.followPath then lerps that segment literally; `smooth()` only validates corner-rounding insertions, never the original corners.

**Evidence.** getNavPath from inside coldbrace_house_3 to the square returns 3 points with a 26 m final leg: (-146,-104) -> (-147.95,-103.25) -> (-160,-80). Driving it with corealm_move_to tracked the player through the cottage wall and then through the Forge Shed footprint at (-150.8,-97.7) and (-151.4,-96.5) (shed box x -154..-150, z -100..-96). The reverse — moveTo position [-146,1.04,-104] from the square — reported a valid pathLength of 28.34 m and parked the player at (-146,-103.8), inside the building. Same fabrication off the hall roof: (-160,9.041,-60) -> (-160.1,9.041,-61.85) -> (-160,1.041,-80), an 18 m leg that drops 8 m through the roof.

**Fix.** Only append `snappedEnd` when the computed path arrives within tolerance — reuse the arrival test already written in `isConnected` (navigation.ts:322). Return `{ path, partial }` (or a sibling findPathDetailed) so `Movement.startPath` (movement.ts:96) emits navigation.failed { reason: 'unreachable' } instead of walking a fiction.

### 4. [high/confirmed] Every building has a walkable roof island and a walkable interior island in the navmesh

`game/src/app/boot.ts:1047`

**Root cause.** `buildNavObstacles` hands Recast a closed BoxGeometry. The four vertical sides exceed the 48-degree slope and drop out, but the top face rasterises into a perfectly flat walkable roof polygon, and the terrain inside the footprint keeps its span because the roof is 5+ m of clearance above it. The comment at boot.ts:214 claims the roof polygon is "harmless: nothing connects to it" — true for pathing, false for `closestPoint`, which every teleport in the codebase goes through.

**Evidence.** getNavPath probe at (-146,5,-104) snaps to y=7.841 (cottage roof); (-160,6,-60) snaps to y=9.041 (hall roof). `__gameDebug.teleport({x:-160,y:9,z:-60})` — the same nav.closestPoint used by teleport (boot.ts:759), region travel (boot.ts:531), focusCamera (boot.ts:823) and death respawn (death.ts:135) — landed the player at (-160,9.041,-60) and D walked them 5 m along the ridge. runs/corealm/screenshots/collision-on-hall-roof.png shows the player standing on the roof of the March Company Hall. Teleport into the cottage centre (-146,-104) likewise leaves them inside, free to walk a ~1 m interior island.

**Fix.** In `buildNavObstacles`, replace BoxGeometry with a 4-quad open-topped ring BufferGeometry — no top face, no roof polygon. That leaves only the interior island, which `closestPoint` must then refuse: add a `Solids.contains(point)` test and have `Navigation.closestPoint` (navigation.ts:334) and `nearestWalkable` (navigation.ts:348) reject a candidate inside a registered volume or more than a climb-height above the requested y. Route boot.ts:531, boot.ts:759, boot.ts:823, death.ts:135 and agility.ts:177 through that guarded helper.

### 5. [high/confirmed] Water has no collider and the navmesh runs across the lake bed — the player wades ponds half-submerged

`game/src/render/scene.ts:815`

**Root cause.** The water surface is documented "Not walkable, not a collider", but the terrain basin underneath it stays in `scene.getWalkableMeshes()`, so `nav.build()` covers the whole pond floor. There is no swim state, no wade state, and no shoreline carve.

**Evidence.** Teleport to Redsill Shallows (-40,-60) put the player at y = -0.559 and holding W carried them 13.86 m straight across the pond with y never changing. Water surface = basinFloor + WATER_BASIN_DEPTH*0.55 = player y + 0.495, so the player is 0.50 m under the plane. runs/corealm/screenshots/collision-in-water.png shows the water cutting across the player at hip height with their shadow on the bottom.

**Fix.** In `buildWaterBodies` (boot.ts:945), after scene.buildWater, add an invisible collar mesh on the waterline contour to `navObstacles.meshes` before nav.build, so the pond disc drops out of the navmesh. The rope_coil fishing markers sit at cluster radius <= 9 while the water half-extent is radius + 14, so they stay on the bank outside the carve and the `fishing` gate line is unaffected. If wading is wanted later it belongs in a systems/ state, not in the navmesh.

### 6. [medium/confirmed] Direct (WASD) movement is constrained only by a nearest-point snap tested against the wrong reference point

`game/src/systems/movement.ts:245`

**Root cause.** `applyDirect` computes an unconstrained target, snaps it with `nav.closestPoint`, and accepts the snap if `distanceXZ(snapped, target) < 0.6`. The tolerance is measured from the desired target, not from where the player currently stands, so nothing bounds how far one step may move the player — a snap that lands 5 m away is accepted as long as it is within 0.6 m of the target. Nothing here tests the Rapier world, and there is no capsule, no sweep, and no continuous check between old and new position.

**Evidence.** movement.ts contains zero references to Physics; the only per-frame physics use is `physics.step()` (loop.ts:176) over 40 static bodies plus one camera occlusion raycast (boot.ts:281). The same 0.6 m gate is what produces a hard dead-stop against a wall rather than a slide when the whole step lands more than 0.6 m off-mesh, and it is the only thing standing between the player and a snap onto a roof polygon 8 m up — roof snaps are avoided today only by accident, because the ground boundary happens to be nearer in 3D.

**Fix.** Bound the STEP, not the target: `if (snapped && distanceXZ(snapped, player.position) <= step + 0.05 && Math.abs(snapped[1] - player.position[1]) <= MAX_STEP_UP)`. Then apply `player.position = solids.resolve(snapped, player.position)` — an XZ push-out against the volume list and, for moving things, against NPC/enemy circles pulled from EntityStore. Pure geometry, deterministic, no RNG, and the store stays the only source of truth for position.

### 7. [medium/confirmed] Agent radius 0.90 m puts an invisible 1.2-1.5 m standoff around every wall

`game/src/app/config.ts:46`

**Root cause.** `walkableRadius: 2` voxels combined with the large-world cell size of 0.45 m (selected in navigation.ts:44 because the world extent exceeds 320 m) yields 0.90 m of erosion. The player capsule is roughly 0.35 m across.

**Evidence.** Measured stop distance from the 0.5 m-thick south wall_segment was 1.46 m from its centre — 1.21 m of clear air outside the wall face. The cottage stop was 3.30 m from centre against a 2.0 m half-depth, so 1.30 m of standoff. This is also the arithmetic that closes the 2 m gate gap.

**Fix.** Set `walkableRadius: 1` in NAV_CONFIG. At cs 0.45 that is 0.45 m, still larger than the player's shoulders, and it halves the invisible-wall gap while opening every authored 2 m doorway. Re-run smoke and the navigation gate line afterwards; polyCount will rise from 3169, so re-check the boot budget against the measurements in navigation.ts's header.

### 8. [low/confirmed] Rapier is stepped every frame but nothing gameplay-facing reads it

`game/src/systems/physics.ts:1`

**Root cause.** The header comment scopes physics to "what is the ground height under this point" and "does this box overlap a building", but only the first is used, at boot. The second has no caller. The 39 building boxes exist solely so the camera occlusion ray has something to hit.

**Evidence.** `physics.step()` runs in loop.ts:176 with 40 static bodies and zero dynamic bodies. The only runtime consumer is the occlusion probe at boot.ts:281. `Physics.addStaticCylinder` has no callers at all; `PhysicsStats.buildingColliders` is 39 and nothing asserts on it.

**Fix.** Do not delete it — the occlusion probe and boot-time groundHeight are both real. Once the generic solid list exists, register cylinders for trees and rocks too (addStaticCylinder is already written and unused) so the camera also stops clipping through trunks. Keep Rapier read-only: explicitly do NOT add a kinematic character controller, because that creates the second position source of truth physics.ts's header rules out and makes movement frame-rate dependent, which neither the gate check nor the 55 FPS / 400 draw-call budget can absorb.

## Recommendations

1. Recommend option (a): keep navmesh authority, no Rapier character controller. Concretely, add game/src/systems/solids.ts owning a `SolidVolume[]` (box and cylinder) built once at boot from world data, exposing `contains(point)`, `resolve(point, from)` (XZ push-out) and `navMeshes()` (open-topped ring geometry). Pure geometry: deterministic, no RNG, no physics stepping, no second position source. Rapier stays read-only for ground queries and camera occlusion exactly as physics.ts's header requires.

2. Fix Navigation.findPath first — one line, worst symptom. game/src/systems/navigation.ts:373-377: only push `snappedEnd` when the computed path arrives within tolerance (reuse the arrival test from `isConnected`, navigation.ts:322). Return `{ path, partial }` so Movement.startPath (movement.ts:96) emits navigation.failed instead of walking a straight line through a wall. Regression probe: `getNavPath([-146,1,-104],[-160,1,-80])` must return null or a path that stays outside the cottage, not today's 3-point line.

3. Generalise BuildingBox into SolidVolume in game/src/world/regionBuilder.ts:115 (and delete its now-stale TODO comment), then emit volumes at every entity site in `buildRegionEntities`: bank :333, shops :352, stations :368, landmarks :433 and their compositions via emitComposition :443, gates :461 / :469, and cluster nodes (trees, ore) in buildCluster :658. Size them from the manifest `size {x,y,z}` of the asset, capped so radius stays under 2.4 m (INTERACT_RANGE) or moveTo(entityId) can no longer reach them.

4. Make scatter solid. game/src/world/scatter.ts:424 `scatterWorld` currently returns nothing usable; have it return the placed instance transforms per asset id so boot can emit cylinders for tree_*, boulder_*, cliff_* and rock_large/medium, skipping grass/flower/pebble/clover. Without this, Karrowmoor's cliff_tall and boulder_large stay walk-through no matter what else is fixed.

5. Rewire boot step 8b (game/src/app/boot.ts:217-227) to iterate the generic volume list rather than `built.buildings`, and change `buildNavObstacles` (boot.ts:1047-1067) to build an open-topped 4-quad ring instead of a closed BoxGeometry so no walkable roof polygon is generated. Verify with `getNavPath([-160,6,-60],[-160,6,-59])` — it must no longer snap to y=9.041.

6. Open the gates. game/src/render/buildings.ts:910-917: widen the gatehouse gap to >= 3.0 m (`const pier = (width - 3) / 2`) and bump the three authored gatehouse footprints in content/regions.ts from [6,3] to [8,3]. Then drop NAV_CONFIG.walkableRadius from 2 to 1 in game/src/app/config.ts:46. Acceptance: `getNavPath([-160,1,-112],[-160,1,-104])` returns a straight 2-point path, and holding W from spawn walks the player into the square without detouring past x=-163.

7. Clamp direct movement. game/src/systems/movement.ts:243-247: change the acceptance test from `distanceXZ(snapped, target) < 0.6` to a step-bounded test against the player's current position plus a vertical-jump guard, then apply `solids.resolve(snapped, player.position)` as the final clamp. Do the same push-out for moving entities (NPCs, enemies) by querying EntityStore for circles within ~1.5 m — that is the only way to stop walking through NPCs, since a navmesh carve cannot follow them.

8. Guard every teleport. Route boot.ts:531 (region travel), boot.ts:759 (debug teleport), boot.ts:823 (focusCamera), systems/death.ts:135 (respawn) and systems/agility.ts:177 (shortcut landing) through a `nav.nearestOpenPoint()` that rejects any candidate inside a SolidVolume or more than a climb-height above the requested y. This is what currently allows landing on the hall roof and inside cottages.

9. Give the water a shoreline collar in `buildWaterBodies` (game/src/app/boot.ts:945-968): after scene.buildWater, add an invisible ring mesh at the waterline contour to navObstacles.meshes before nav.build, so the pond disc drops out of the navmesh. Leave the rope_coil fishing markers on the bank inside the carve-free radius so the fishing gate check still passes.

10. Snapshot the numbers before touching anything so the fix can be proved: polyCount 3169, strategy solo, cs 0.45, 39 building boxes, 892 entities, 0 non-building colliders. After the change re-run `npm run smoke`, `npm run perf` (extra nav-obstacle geometry raises navmesh build time against a 6 s cold boot) and `npm run gate-check`. The gate lines at risk are navigation, mining, woodcutting, fishing, farming, agility and dungeon — all depend on moveTo(entityId) still reaching within 2.4 m, so keep every carve radius under that.

## Files to edit

- game/src/systems/navigation.ts
- game/src/systems/movement.ts
- game/src/systems/solids.ts
- game/src/systems/physics.ts
- game/src/world/regionBuilder.ts
- game/src/world/scatter.ts
- game/src/render/buildings.ts
- game/src/app/boot.ts
- game/src/app/config.ts
- game/src/content/regions.ts
- game/src/systems/death.ts
- game/src/systems/agility.ts
