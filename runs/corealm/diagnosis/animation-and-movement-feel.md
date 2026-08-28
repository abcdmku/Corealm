# animation and movement feel

## Summary

Movement and animation are broken by one structural cause and three independent ones stacked on top. Structural: the sim runs on a fixed 100 ms tick and nothing interpolates between ticks, so at 480 fps the player teleports 0.4202 m exactly ten times a second while the camera, world and UI move smoothly — measured, only 170 of 11,050 rendered frames (1.54%) contain any player displacement. That same per-frame position delta is what loop.ts feeds into the rig's pose selector, so the rig is told "standing still" on 98.5% of frames and "running at 190 m/s" on the rest; CharacterRig.play() therefore alternates idle/run ~20x per second, each call doing action.reset(), and the run clip never advances — a CDP screencast at 100 fps shows the body pose pixel-identical across 116 ms of continuous running. Independently, attachOutfit() adds outfit pieces to this.root instead of rebinding them to the body skeleton, so the chest plate, belt, hood and boots hang in bind pose next to a bare-armed, barefoot body that animates without them. Independently, NAMED_CHARACTER_RESERVE = 64 equals maxUniqueDrawCalls = 64, which makes the non-NPC ceiling exactly zero: all 50 enemies and 8 of 12 NPCs can never get a live mixer, and animatedLastFrame reads 0 in every frame sampled outside Coldbrace square. And click-to-move paths carry only 2-3 corners over 50 m with Y linearly interpolated between them, putting the player up to 4.46 m below the terrace surface on a single Karrowmoor path.

## Evidence

- **Headed Chromium (real GPU) per-rAF recording of getPlayerPosition/getPlayer/getCamera at 480 fps, 9 motion series: hold W 2 s, release, tap W, strafe D 1 s, W+A diagonal 1.2 s, S 1.2 s, click-to-move, path interrupted by D, Karrowmoor W and S, region-seam A** — 11,050 rendered frames, 170 with any displacement (1.54%). Step size always 0.4202 m, median gap between updates 100.0 ms, instantaneous speed median 190.9 m/s max 600.2 m/s. Camera moved on 947/951 frames of the same window.
- **Tap-duration sweep, 3 trials at 30/50/80/100/150/200 ms holds of W from a clean spawn** — 30 ms -> 0 m every trial; 50 ms -> 0/0.42/0.42; 80 ms -> 0.42 x3; 150 ms -> 0.84/0.84/0.42; 200 ms -> 0.839/0.84/0.794. Movement is quantised to 0.42 m and sub-tick taps are dropped.
- **Forward-kinematics stride analysis of animation_library_1.glb (manual glTF parse, 240 samples/clip, planted-foot body-relative velocity of ball_l)** — Walk_Loop 1.333 s, stride 0.809 m, implied ground speed 0.979 m/s. Jog_Fwd_Loop 0.933 s, stride 1.453 m, 5.92 m/s. Sprint_Loop 0.667 s, 9.15 m/s. Root node translation range 0.000 in all axes (in-place clips). PLAYER_SPEED = 4.2 -> Jog timeScale should be 0.71.
- **CDP Page.startScreencast at ~100 fps (10 ms frame gaps, no main-thread stall) while holding D, 203 frames, 14 consecutive frames saved from the middle** — runs/corealm/screenshots/MOTION-cast-0-crop.png, MOTION-cast-6-crop.png and MOTION-cast-12-crop.png at t=1015/1073/1131 ms are pose-identical: same trailing leg, same forward arm, same toe angle across 116 ms of a 0.933 s clip. Outfit chest plate, belt, hood and boots visibly detached and floating beside a bare-armed, barefoot body.
- **getEntityViewStats() sampled at spawn, at Coldbrace square, standing on enemy rill_skitterlings_1, and during an attack attempt** — 872 entities, uniqueViews 4, riggedViews 4, uniqueDrawCalls 58/64, animatedLastFrame 0 everywhere except Coldbrace square (4). getDrawnBounds on the enemy returns path "instanced" before and after combat; npc_warden_ilse returns "animated:Idle_Loop" with height 1.501 m.
- **Navmesh ground probe: 21 samples along the final 46 m segment of the Karrowmoor terraces path, comparing followPath's linear Y against the navmesh surface Y** — Path is 3 points over 56 m. Linear Y sits below the navmesh surface for 90% of the segment, worst -4.46 m at the midpoint, past 3 m of error for 60% of the segment.
- **Gate passage test: hold W 3.5 s from spawn, then getNavPath from the stall point to town centre, then strafe-around** — Player creeps 7.86 m in 3.46 s (2.27 m/s vs configured 4.2) to (-161.094, -110.142) and then produces 0.002 m over a further 300 ms hold. Navmesh routes west around the gate via (-164.15,-110) -> (-164.15,-106.85). Strafing D then W gets through at (-164.9,-104.3). Screenshot MOTION-walk-f0.png shows the player stopped inside the arch.
- **Camera occlusion sweep: 4 walks around Coldbrace square at min zoom, 1 walk in Vellenwood canopy, 1 walk in the Gravelmaw chamber, plus 4 walks on the Karrowmoor terraces at pitch 0.18** — Coldbrace 0/3449 occluded frames, canopy 0/1202, Gravelmaw 0/1001 (camera at y=22.36 outside the rock). Karrowmoor at pitch 0.18: 401-1058 occluded frames per direction, distance pulled from 18 to 12.2. The probe works; the default pitch of 0.72 puts the camera 11.9 m above the head where nothing blocks it.
- **Clip existence and duration check of every name in POSE_CLIPS against both animation libraries** — All 23 clip names resolve; nothing falls back to idle for a missing clip. Durations: Sword_Attack 1.533, Sword_Regular_A 0.433, Punch_Jab 0.867, Spell_Simple_Shoot 0.500, Hit_Chest 0.333, Chest_Open 1.367, ClimbUp_1m 0.667, Fixing_Kneeling 5.200, TreeChopping_Loop 0.967. Seven of the 14 poses are never selected by poseFor.
- **Camera follow-lag computation from the holdW series (reconstructing the smoothed focus from camera position minus the fixed yaw/pitch/distance offset)** — Lag against the true player position sawtooths 0.005 m -> 0.692 m every 100 ms, median 0.415 m, because the camera lerps every frame (followLerp 0.14 per 60 Hz frame, ~110 ms time constant) against a player that teleports at 10 Hz.
- **Terrace climb series on Karrowmoor with direct WASD (28 movement ticks over 2.7 s)** — Direct mode grounds correctly: y follows the terrain smoothly (0.062 m per step uphill, 0.148 m per step downhill, slope 0.15 to 0.35), and XZ step stays 0.4200-0.4202 m regardless of slope, so true along-ground speed rises to ~4.45 m/s on a 20 degree grade. The grounding bug is specific to click-to-move paths.

## Findings

### 1. [critical/confirmed] Player position updates at 10 Hz with no render interpolation — the character teleports 42 cm per step

`game/src/app/loop.ts:151`

**Root cause.** `frame()` runs `clock.advance(realDelta)` sim ticks of SIM_TICK_MS = 100 ms (core/time.ts:2) and then `renderFrame()` reads `state.player.position` raw. `Movement.update()` moves the player `PLAYER_SPEED * 0.1 = 0.42 m` per tick, and no code interpolates the render pose between ticks, so the drawn character stands still for ~48 frames then jumps 42 cm in one 2 ms frame.

**Evidence.** Headed Chromium at 480 fps / 2.08 ms frames. Holding W for 2 s: 20 of 951 rendered frames had any displacement; every step was 0.4202 m; median gap between position changes 100.0 ms. Across 9 motion series (11,050 frames of continuous movement) only 170 frames (1.54%) moved, instantaneous speed on those frames median 190.9 m/s, max 600.2 m/s. Over the same 951 frames the camera moved on 947 — so the world is smooth and only the player jitters. Camera focus lag against the player sawtooths 0.005 m -> 0.692 m every 100 ms (median 0.415 m).

**Fix.** Keep `prevPosition`/`prevFacing` in the loop, expose the clock accumulator as `alpha = accumulator / SIM_TICK_MS`, and in `renderFrame()` lerp position (and shortest-arc-interpolate facing) before calling `scene.syncPlayer`, `rig.setPosition` and `camera.update`. Do the same for `EntityViews` record positions. Alternative, more invasive: drop SIM_TICK_MS to 16-33 ms for movement only. Interpolation is the cheaper fix and also removes the camera sawtooth.

### 2. [critical/confirmed] The player's run animation is frozen: pose thrashes idle<->run 20x/s and resets the clip every time

`game/src/app/loop.ts:232`

**Root cause.** `syncPlayerRig` derives `speed` from the per-rendered-frame position delta (loop.ts:222-227) and passes `moving: speed > 0.25` to `poseFor`. Because position only changes on 100 ms sim ticks, speed is 0 on ~98.5% of frames (-> pose "idle") and ~190 m/s on the rest (-> pose "run"). `CharacterRig.play()` (characterRig.ts:140-171) early-returns only when the pose is unchanged, so each flip runs `action.reset()` + `crossFadeFrom(previous, 0.18)`. The locomotion clip is restarted at t=0 ten times a second and never plays past ~2 ms of its 0.933 s.

**Evidence.** Chrome DevTools screencast at ~100 fps while holding D. Frames at t=1015 ms, t=1073 ms and t=1131 ms (runs/corealm/screenshots/MOTION-cast-0-crop.png, MOTION-cast-6-crop.png, MOTION-cast-12-crop.png) show an identical mid-stride pose — same trailing leg, same arm, same toe angle — across 116 ms of a 0.933 s clip. Contrast MOTION-walk-f0-crop.png (player genuinely blocked, feet together). Frame-band histogram across 11,050 frames: 10,880 frames land in the idle band (<=0.25 m/s), 169 in the run band (>3.0), and exactly 1 in the walk band — `Walk_Loop` is effectively dead code.

**Fix.** Stop deriving speed from render-frame deltas. Have `Movement` write `player.movement.speed` (and `mode`) into the store each tick, and have `syncPlayerRig` read `moving = movement.mode !== "idle"` and `speed = movement.speed`. Then `poseFor`'s 3.0 m/s threshold becomes reachable. Also add a guard in `play()` so a re-selected pose that is already the current action is not reset.

### 3. [critical/confirmed] Outfit pieces are never rebound to the body skeleton, so clothes float in bind pose beside a naked animating body

`game/src/render/characterRig.ts:130`

**Root cause.** `attachOutfit()` does `cloneSkinned(source)` and `this.root.add(piece)`. The clone carries its own Armature and Skeleton; the `AnimationMixer` is built on `body` only (characterRig.ts:105), so the outfit's bones never receive a track. The pieces therefore render in bind pose, positioned only by the root transform, while the body underneath animates.

**Evidence.** runs/corealm/screenshots/MOTION-cast-0-crop.png and MOTION-run-f4-crop.png: the chest plate + belt + hood cluster and a pair of boots hang detached in a vertical bind stack while a bald, bare-armed, barefoot body runs out from under them. `getSceneStats()` confirms three separate sibling groups under `character-rig`: `outfit-outfit_male_peasant_chest`, `outfit-outfit_male_peasant_legs`, `outfit-outfit_male_peasant_boots`, alongside `body`. All character packs share one 65-bone skeleton (root/pelvis/spine/.../ball_r), so rebinding is a name match, not retargeting.

**Fix.** In `attachOutfit`, collect the body's `Skeleton` once (from any body `SkinnedMesh`), then for each `SkinnedMesh` in the cloned piece call `mesh.bind(bodySkeleton, mesh.bindMatrix)` and reparent the mesh under the body's Armature; discard the piece's own Armature/bones. Because both skeletons come from the same 65-bone rig the bone order matches directly; if not, build a name->bone map and construct a reordered `THREE.Skeleton`.

### 4. [critical/confirmed] No enemy and only 4 of 12 NPCs can ever animate: the animation reserve equals the whole draw-call budget

`game/src/render/entityViews.ts:1033`

**Root cause.** `canAffordUnique` computes `ceiling = named ? maxUniqueDrawCalls : maxUniqueDrawCalls - NAMED_CHARACTER_RESERVE`. `NAMED_CHARACTER_RESERVE` is 64 (entityViews.ts:146) and boot.ts:260 passes `maxUniqueDrawCalls: 64`, so the non-NPC ceiling is 0 and `uniqueDrawCalls + cost <= 0` is never true. The reserve was authored against the 96 default. Separately the NPC ceiling of 64 is exhausted by four dressed NPCs (10-mesh outfits cost 20 each), so `maxUniqueViews: 16` never binds.

**Evidence.** `getEntityViewStats()` at spawn, at Coldbrace square and standing on top of an enemy: `uniqueViews: 4, riggedViews: 4, uniqueDrawCalls: 58` out of 872 entities; `animatedLastFrame` 0 everywhere except Coldbrace square where it is 4. `getDrawnBounds("rill_skitterlings_1")` returns `path: "instanced"` before and after combat. Manifest: enemy_crab/blob/skull each ship 10 clips including Idle, Walk, Bite_Front, Death, HitRecieve; enemy_bee ships Flying. None of them play — the bee does not flap. Whole-frame draw calls measured 265 against the 400 budget, so 135 calls are unused.

**Fix.** Make the reserve proportional: `const reserve = Math.min(24, Math.floor(maxUniqueDrawCalls / 2))`, and raise boot.ts's `maxUniqueDrawCalls` to 96 (still ~90 calls under budget at the worst measured pose). Then teach `entityViews` a state-driven clip selection for enemies — `idleCandidates` already prefers an asset's own `/idle/i` clip, so extend it to a `clipForState(entity.state, runtime.state)` map: alive/idle -> Idle, aggro/returning -> Walk, dead -> Death, plus a Bite_Front one-shot on `combat.hit`. For the instanced fallback, bake one pose per state instead of only the idle pose.

### 5. [high/confirmed] Click-to-move walks the player up to 4.46 m under the terrain: path Y is linearly interpolated between 2-3 corners over 50 m

`game/src/systems/movement.ts:263`

**Root cause.** `followPath` lerps position component-wise between path corners, including Y, and never re-snaps to the navmesh (unlike `applyDirect`, which calls `nav.closestPoint` every step at movement.ts:243). Detour's string-pulled path returns only the corners needed for XZ clearance, so a long segment across stepped terrain carries no intermediate elevation samples.

**Evidence.** `getNavPath` from the Karrowmoor terraces start (60, 15.924, -16) to (100, -, -56) returns exactly 3 points: (60,15.92,-16), (71.2,17.24,-20), (100,27.68,-56). I probed the navmesh surface at 21 points along the final 46 m segment (each via a 1 cm `getNavPath` snap): linear Y vs navmesh Y diverges to -4.46 m at t=0.50 and stays past 3 m for 60% of the segment. Same class of gap on the 53 m two-point path near spawn (y 1.147 -> -3.5, zero intermediate points).

**Fix.** In `followPath`, after advancing `position`, do what `applyDirect` already does: `const snapped = this.nav.closestPoint(position); if (snapped) position = snapped;` — cost is one Detour query per tick (10/s), which is nothing. Belt and braces: in `smooth()`, subdivide any segment longer than ~3 m and snap each inserted point, so the corner list itself carries elevation.

### 6. [high/confirmed] Coldbrace's south gatehouse is impassable — walking into the starting town's front gate dead-stops the player

`game/src/systems/movement.ts:245`

**Root cause.** The navmesh has no polygon through the south gatehouse arch (the nav obstacle boxes for `coldbrace_gate_south` close the opening). `applyDirect` then rejects any snap that moves the target more than 0.6 m, so instead of sliding along the blocker the player simply stops: there is no wall-slide and no character controller, only navmesh snapping.

**Evidence.** From spawn (-160, -118) holding W for 3.5 s the player creeps to (-161.094, 1.041, -110.142) — 7.86 m in 3.46 s, 2.27 m/s against a configured 4.2 — and then produces 0.002 m over a further 300 ms hold. `getNavPath` from that point to town centre routes west around the gate: (-163.25,-110.45) -> (-164.15,-110) -> (-164.15,-106.85) -> (-160,-80). Strafing D then W walks around it fine, ending at (-164.9,-104.3). runs/corealm/screenshots/MOTION-walk-f0.png shows the player standing dead in the middle of the arch.

**Fix.** Two parts. (1) Widen the gatehouse gap: check `buildNavObstacles` for the gatehouse case in app/boot.ts — the two pier boxes plus the 0.6 m navmesh inset (NAV_CONFIG walkableRadius 2 * cs 0.3) are closing a gap that reads as open. Verify with `getNavPath` straight through (-160,-112) -> (-160,-104). (2) Give `applyDirect` a wall-slide: when the snap is rejected, retry with the movement vector projected onto each of the two axes and take whichever produces a valid snap, so the player slides along a blocker instead of sticking.

### 7. [high/confirmed] Foot slide: locomotion clips are in-place with no timeScale driven by speed — Jog_Fwd_Loop implies 5.92 m/s against an actual 4.2 m/s

`game/src/render/characterRig.ts:151`

**Root cause.** `play()` hard-sets `action.setEffectiveTimeScale(1)` and nothing anywhere calls `setEffectiveTimeScale` again; `update()` only forwards the raw delta to the mixer. The clips have root motion baked out (root node is fixed at the origin for the whole clip), so the stride rate is fixed regardless of ground speed.

**Evidence.** Forward-kinematics sampling of animation_library_1.glb at 240 samples/clip, measuring the body-relative velocity of `ball_l` during the planted (minimum-Y) phase: Walk_Loop = 0.979 m/s (duration 1.333 s, stride 0.809 m, stance 62%); Jog_Fwd_Loop = 5.92 m/s (0.933 s, stride 1.453 m); Sprint_Loop = 9.15 m/s (0.667 s, stride 1.347 m). Root node world translation range is 0.000 in X/Y/Z for all three, confirming in-place clips. PLAYER_SPEED is 4.2 (app/config.ts:3). Mismatch ratio for the clip actually selected: 4.2 / 5.92 = 0.71, i.e. the legs cycle 41% too fast, feet skating backwards at 1.72 m/s. Walk_Loop at 4.2 m/s would be 4.3x too fast. Today the visible slide is 100% because the clip is also frozen.

**Fix.** Add `CharacterRig.setLocomotionSpeed(metresPerSecond)`, called from `syncPlayerRig`, that sets `action.setEffectiveTimeScale(speed / IMPLIED[clipName])` with IMPLIED = { Walk_Loop: 0.98, Jog_Fwd_Loop: 5.92, Sprint_Loop: 9.15 }, clamped to 0.6..1.6 so a stalled player does not freeze the clip. Also introduce a real walk speed so `Walk_Loop` is reachable: WALK_SPEED 1.6 m/s (shift or default) with a pose threshold at 2.2 m/s instead of the current 3.0.

### 8. [medium/confirmed] Facing turns in 1.26 rad (72 deg) jumps at 10 Hz because facing is also only integrated on sim ticks

`game/src/systems/movement.ts:249`

**Root cause.** `turnToward` is called once per sim tick with `deltaMs = 100`, so max step is `MAX_TURN_RATE * 1.8 * 0.1 = 1.26 rad` for direct input and 0.7 rad for path following. The rig reads `facingRad` raw with no interpolation (loop.ts:231).

**Evidence.** Recorded facing during a W-then-camera-turn run: facingRad takes exactly three values, -0.140 -> -0.740 -> -1.940, i.e. one 0.60 rad step then one 1.20 rad step, each applied in a single rendered frame 100 ms apart. Direct-input turns snap to their target the moment |delta| <= maxStep, so a 90 deg strafe change (A -> D) lands in 1-2 ticks.

**Fix.** Same fix as the interpolation finding — interpolate facing in the render frame (shortest-arc between the previous and current tick values). If you want turning to also feel less abrupt, drop MAX_TURN_RATE from 7 to about 9 rad/s for direct and keep 7 for path, then let the interpolation carry it.

### 9. [medium/confirmed] No acceleration, no deceleration, and no movement smaller than 42 cm; taps under ~40 ms are dropped entirely

`game/src/systems/movement.ts:197`

**Root cause.** `const step = PLAYER_SPEED * (deltaMs / 1000)` with a fixed 100 ms tick makes velocity binary: 0 or 4.2 m/s. `hasDirectInput()` is a boolean poll, so a key held for less than one tick boundary contributes nothing and a key held across N boundaries contributes exactly N * 0.42 m.

**Evidence.** Tap-duration sweep, 3 trials each, distance moved: 30 ms -> 0, 0, 0 m. 50 ms -> 0, 0.42, 0.42 m. 80 ms -> 0.42, 0.42, 0.419 m. 150 ms -> 0.84, 0.84, 0.42 m. 200 ms -> 0.839, 0.84, 0.794 m. So a 150 ms tap gives you either one step or two, a 100% swing. Releasing W stops the player inside one tick: 0.000 m over the following 500 ms (241 frames).

**Fix.** Give the player a velocity vector in the store instead of a boolean. Accelerate toward `PLAYER_SPEED * inputMagnitude` at about 18 m/s^2 and decelerate at about 25 m/s^2 (0 -> 4.2 in 0.23 s, 4.2 -> 0 in 0.17 s), integrate it on the sim tick, and let the render interpolation smooth the result. This also makes the animation timeScale meaningful during ramp-up.

### 10. [medium/confirmed] Camera occlusion never fires at the default pitch, and never fires inside the Gravelmaw at all

`game/src/render/camera.ts:118`

**Root cause.** At CAMERA.defaultPitch 0.72 and distance 18 the camera sits sin(0.72)*18 = 11.9 m above the player's head — above every roofline in the game — so the probe segment clears all building boxes. Separately the dungeon geometry (`buildDungeon`) is added to the scene but never handed to `physics.addStaticBox`, so the Rapier world has nothing to hit inside it.

**Evidence.** Four 1.5 s walks around Coldbrace square at minimum zoom (distance 6): 0 occluded frames out of 3,449, camera distance constant. Vellenwood canopy walk: 0 occluded frames out of 1,202, distance flat at 18. Gravelmaw chamber: 0 occluded frames out of 1,001, distance 18, camera at y = 22.36 while the player is in the chamber — the camera is outside the rock filming through it. The probe itself works: at pitch 0.18 on the Karrowmoor terraces it reports occluded on 401-1,058 of ~1,050 frames per direction and pulls distance from 18 down to 12.2.

**Fix.** Two changes. (1) Lower CAMERA.defaultPitch from 0.72 to about 0.52 so the camera lives in the world rather than above it, or aim the probe at the player's chest and also probe the near-plane corners. (2) Add static box colliders for the dungeon walls and ceilings in boot.ts step 8a, next to the existing `for (const box of built.buildings) physics.addStaticBox(...)` loop, so the occlusion probe and any future collision have something to hit underground.

### 11. [medium/confirmed] Half the pose table is unreachable: attack, cast, hit, fish, chop, bank and walk never play

`game/src/render/characterRig.ts:191`

**Root cause.** `poseFor` maps only the five `ActivityState` kinds (gathering, production, farming, eating, traversing) plus dead/moving. `inCombat` is accepted as a parameter and never read; combat is deliberately not an activity (systems/activity.ts:13), and nothing else calls `rig.play()` — loop.ts:232 is the only call site in the codebase. `gathering` maps unconditionally to "mine", so woodcutting and fishing also play TreeChopping_Loop.

**Evidence.** `listClips()` returns 84 clips and every name in POSE_CLIPS resolves — `getMissingClips()` would be empty, so nothing falls back to idle for a missing clip. Reachable poses: idle, run, mine, produce, farm, eat, climb, death. Unreachable: walk (1 frame in 11,050), chop, fish, attack_melee, cast, hit, bank. Durations measured from the GLBs: Sword_Attack 1.533 s, Sword_Regular_A 0.433 s, Punch_Jab 0.867 s, Spell_Simple_Shoot 0.500 s, Hit_Chest 0.333 s, Chest_Open 1.367 s — all authored, all dead.

**Fix.** Pass the real drivers into poseFor: (a) split gathering by `skill` (mining -> mine, woodcutting -> chop, fishing -> fish); (b) have the loop drain `CombatSystem.consumeHits()` — it already does this for damage numbers at loop.ts:246 — and call `rig.play("attack_melee", true)` on an outgoing swing and `rig.play("hit", true)` on an incoming one, both as forced one-shots; (c) fire `rig.play("bank", true)` from the bank interaction handler. Crossfade at 0.18 s is fine for locomotion but too slow for a 0.333 s Hit_Chest — use 0.06 s for one-shots.

### 12. [medium/confirmed] Agility traversals play a 0.667 s climb then stand idle for the remaining 1.3-3.3 s

`game/src/render/characterRig.ts:51`

**Root cause.** "climb" is in ONE_SHOT, so `ClimbUp_1m` plays once, clamps, and `update()` snaps back to idle when the action stops. But `Movement.updateTraversal` holds the player frozen at the obstacle for `leg.durationMs` (authored 2-4 s per PRD) before placing them at the exit.

**Evidence.** ClimbUp_1m duration measured from animation_library_2.glb = 0.667 s; NinjaJump_Start = 0.967 s. `activity.started {kind:"traversing", durationMs}` is emitted at movement.ts:337 with the leg duration, and the traversal ends with an instantaneous `state.player.position = landing` at movement.ts:376.

**Fix.** Either loop the climb for the traversal duration (`setEffectiveTimeScale(0.667 / durationSeconds)` and LoopRepeat), or better, drive the player's position along the obstacle's entry->exit arc over `durationMs` in `updateTraversal` instead of teleporting at the end, and time the clip to match. The second removes the teleport, which is the more visible half of the problem.

### 13. [low/likely] Entity views resync at 4 Hz, so anything that moves in the world will visibly step at a quarter of the sim rate

`game/src/app/loop.ts:264`

**Root cause.** `syncEntityViews` accumulates SIM_TICK_MS and returns early until 250 ms have passed; `syncOne` then rebuilds an instance matrix only when the signature changes, and the signature rounds position to 0.01 m. `EnemyAI.stepToward` writes `entity.position` every 100 ms tick, so three of every four enemy movement steps are invisible.

**Evidence.** loop.ts:266-270 (`if (this.viewSyncAccumulatorMs < 250) return`) against entityViews.ts:434 `signature` using `round()` = 2 decimals (entityViews.ts:1446). Not yet observable in play because enemies never move: `rill_skitterlings_1` (behaviour "passive", aggroRadius 6) stayed at (-82.38, -1.35, -69.53) for 4,000 ms with the player standing on top of it, and its drawn bounds were byte-identical before and after.

**Fix.** Split the sync: keep the 250 ms cadence for the structural diff (asset, tier, state, add/remove) but push position and rotationY into the record every frame for archetypes that move (enemy, npc, boss), and interpolate them with the same alpha as the player.

### 14. [low/confirmed] __gameDebug.groundHeight is documented and wired as a DebugDep but not exposed on the debug object

`game/src/debug/gameDebug.ts:77`

**Root cause.** `DebugDeps.groundHeight` exists and is used internally by `checkBuildingFooting`, but no `groundHeight()` method is added to the `debugApi` literal, so scenarios and probes cannot query terrain height.

**Evidence.** Calling `window.__gameDebug.groundHeight(x, z)` from a scenario throws `TypeError: d.groundHeight is not a function`. I had to fake a ground probe by calling `getNavPath([x,y,z],[x+0.01,y,z+0.01])` and reading the snapped first point.

**Fix.** Add `groundHeight(x, z) { return deps.groundHeight(x, z); }` to the debugApi literal next to `checkBuildingFooting`. This is one line and it is what any grounding audit needs.

## Recommendations

1. Add render interpolation. In GameLoop, keep prevPlayerPos/prevFacing captured before the tick batch, expose SimClock.alpha() = accumulator / SIM_TICK_MS, and in renderFrame lerp position and shortest-arc-interpolate facing before scene.syncPlayer, rig.setPosition and camera.update. This is the single change that removes the 0.4202 m / 100 ms teleport and the 0.415 m camera sawtooth. Apply the same alpha to EntityViews record positions for enemy/npc/boss archetypes.

2. Move speed out of the render frame. Have Movement.update write player.movement.speed (m/s) and keep mode authoritative; change loop.ts:232 to moving = movement.mode !== "idle" and speed = movement.speed. This alone stops the 20-calls-per-second idle/run thrash that freezes the run clip.

3. Rebind outfits in CharacterRig.attachOutfit: grab the body's Skeleton once, and for each SkinnedMesh in the cloned piece call mesh.bind(bodySkeleton, mesh.bindMatrix) and reparent it under the body's Armature, discarding the piece's own bones. All packs share the same 65-bone rig so bone order matches; fall back to a name->bone remap if it does not.

4. Add CharacterRig.setLocomotionSpeed(v) that sets effectiveTimeScale = v / IMPLIED[clip] with IMPLIED = { Walk_Loop: 0.98, Jog_Fwd_Loop: 5.92, Sprint_Loop: 9.15 }, clamped 0.6..1.6. Add WALK_SPEED = 1.6 m/s to config and drop poseFor's run threshold from 3.0 to 2.2 so Walk_Loop becomes reachable at all.

5. Fix the animation budget: change NAMED_CHARACTER_RESERVE to Math.min(24, Math.floor(maxUniqueDrawCalls / 2)) and raise boot.ts's maxUniqueDrawCalls from 64 to 96 (measured frame draw calls are 265 of a 400 budget). Then add state-driven clip selection in entityViews so enemies play their own Idle / Walk / Bite_Front / Death / HitRecieve, and bake one instanced pose per state instead of only idle.

6. Snap the path to the ground: in Movement.followPath, after advancing position, call nav.closestPoint(position) exactly as applyDirect already does at movement.ts:243, and subdivide any smoothed segment longer than 3 m in smooth() so the corner list itself carries elevation. Verify with the 21-point probe on the Karrowmoor terraces path (currently worst -4.46 m).

7. Give applyDirect a wall-slide: when the snap is rejected by the 0.6 m test, retry with the movement vector projected onto each world axis and take whichever snaps cleanly. Then fix the Coldbrace south gatehouse specifically - the nav obstacle piers plus the 0.6 m navmesh inset close an opening that reads as walkable; confirm with getNavPath((-160,-112) -> (-160,-104)).

8. Replace the binary velocity with acceleration: store a velocity vector, accelerate toward PLAYER_SPEED * inputMagnitude at ~18 m/s^2 and decelerate at ~25 m/s^2, integrate it on the sim tick. This kills the 42 cm quantum, makes sub-100 ms taps register proportionally, and gives the animation timeScale something to ramp against.

9. Wire the unreachable poses: split gathering by skill (mining -> mine, woodcutting -> chop, fishing -> fish); drain CombatSystem.consumeHits() in the loop (it is already drained for damage numbers) and force-play attack_melee on an outgoing swing and hit on an incoming one; fire bank from the bank interaction handler. Use a 0.06 s crossfade for one-shots, since Hit_Chest is only 0.333 s long, and keep 0.18 s for locomotion.

10. Camera: lower CAMERA.defaultPitch from 0.72 to ~0.52 so the camera sits in the world rather than 11.9 m above every roofline (the occlusion spring is provably functional - it fires on the Karrowmoor terraces at pitch 0.18 - it just never has anything to hit). Add static box colliders for the Gravelmaw walls and ceilings alongside the building boxes in boot.ts step 8a, so the camera stops filming the dungeon from outside the rock.

11. Loop the Agility traversal clip, or better, drive the player along the entry->exit arc over durationMs instead of teleporting at the end: ClimbUp_1m is 0.667 s against a 2-4 s traversal, so the player currently climbs, returns to idle, stands still, then teleports.

12. Expose groundHeight on window.__gameDebug (one line in gameDebug.ts next to checkBuildingFooting) - it is documented in the debug API list but missing from the object, and every grounding audit needs it.
