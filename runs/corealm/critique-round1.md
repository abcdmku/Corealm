# Round 1 critique (fresh read-only critic) and the root's fix plan

Nine findings, every one cited to a screenshot pixel or a log field. The critic refuted two of my
own hypotheses and found three problems I had missed, including a false green in my own tooling.

## Findings

| # | Finding | Priority | Owner |
| --- | --- | --- | --- |
| 1 | All 37 authored buildings are never instantiated. `regionBuilder` never reads `settlement.buildings`. | blocking | F1 |
| 2 | Spawn camera faces 180° away from Coldbrace; the town is behind the player at frame 0. | blocking | root + F1 |
| 3 | `buildRoad` and `addFlatSpot` are dead code. Roads exist only as scatter exclusion zones. | high | root |
| 4 | Ore tier is unreadable. `oreRock()` has zero callers; retint runs at 0.25 strength. Nodes share meshes with scatter dressing. | high | F2 |
| 5 | Vellenwood is crimson and black. The `twisted` tree family is an autumn tree, at scale 0.55, under a 55 m fog start. | high | F3 |
| 6 | Nothing is animated. 98 clips load; no `AnimationMixer` exists anywhere. NPCs stand in bind pose. | high | F2 |
| 7 | Draw-call budget breached, and `perf.json` could not detect it because it measured only the spawn pose. | high | root + F3 |
| 8 | Landmarks are single stand-in props. The dungeon mouth is a wooden door frame. | medium | F1 |
| 9 | Camera orbit was never actually tested. `driver.drag` dropped the button, so the assertion could not fail. | medium | root |

## Corrections to my own reading

- The floating red cone in `r1-town-center` is **not** a failed building assembly. It is
  `march_vault_tower`, a landmark deliberately authored as a bare `roof_tower` prop. The real
  problem is larger: *no* building is assembled anywhere.
- The Vellenwood colour is **not** a shader bug, confirming my read — but the fix is species and
  scale, not tinting, because a 0.25 retint cannot move a dark autumn albedo.

## Root-owned fixes, done

**Finding 9 — the false green.** `tools/lib/driver.ts`'s `drag()` took no button parameter and
called a bare `mouse.down()`, which Playwright defaults to left. `tools/play-game.ts` then discarded
`action.button` entirely. So a scenario step labelled "Orbit the camera" sent a *left* drag, the
game correctly refused to orbit (left-drag is reserved), and the step passed. Every camera snapshot
in both scenario files reads `yaw: 0.471`, which is exactly the hardcoded initial
`Math.PI * 0.15`. Both files now honour the button.

**Finding 7 — the budget that reported green.** `tools/perf-test.ts` measured one pose and passed
itself. It now enforces a 400 draw-call ceiling **per pose**, and treats a run that only measured
the default pose as a failure, because a budget sampled at the cheapest frame is worse than no
budget.

**Finding 2 and the weak screenshot set.** `game/src/debug/shots.ts` adds 18 named poses carrying an
explicit yaw, pitch, distance, and a stated intent. Round 1's nine screenshots all shared one
compass bearing, which is why the "dungeon mouth" and "terraces" shots were the same two fence posts
at different distances.

## Measured after wiring the poses

The budget is genuinely breached, at poses the old tool never visited:

```
shot                        draws       tris   medMs   ok
gravelmaw_entrance            803   12562890     3.0   FAIL
redsill_shallows              454    7569354     1.4   FAIL
marchfield_farm               395    8520574     2.3   pass (marginal)
karrowmoor_terraces           375    8380414     2.4   pass (marginal)
town_center                   305    6276446     1.9   pass
palewood_copse                 61    1465484     0.6   pass
```

Frame time is still comfortable on an RTX 5080 (3.0 ms worst case against a 16.67 ms budget), so
this is a headroom problem for weaker hardware rather than a stutter today. It is still a real
breach of an exit condition and is fixed in this round rather than deferred.

## A note on the dead duplicate

`content/regions.ts` carries `ScatterLayerDef` data that nothing reads: `boot.ts` calls
`scatterWorld(scene, assets, seed)` without specs, so the live values are `DEFAULT_SCATTER` in
`world/scatter.ts`. Two sources of truth, one of them dead. The fix round removes the unused one.

---

## Fix round results

### F3 (scatter) — done, and it refuted the obvious diagnosis

F3 parsed the GLB JSON chunks to build a real triangle census rather than trusting the manifest, and
found the tag-based asset selection had been picking the **most expensive member of every family**:

```
tree_twisted_1..5  9134-10104 tris    tree_common_1..5   3182-6265
tree_dead_1..5     5648- 6557         tree_pine_1..5     1646-4964
```

Every tree is 2 primitives (trunk + foliage), so 2 InstancedMeshes per asset, doubled again when the
layer casts shadows. Switching to hand-picked ids cut world scatter from 129 draw calls / 10.83M
triangles to **62 / 4.78M** — a 52% draw-call and 56% triangle cut.

**But scatter was never the cause of the breach.** Its world-wide ceiling is 129 calls and at most
two regions stream at once, so its share of the 803-call worst pose was at most ~92. F3 traced the
remaining ~711:

1. `entityViews.ts` `maxUniqueViews = 16`. Rigged characters bypass instancing; a modular character
   is ~10 skinned meshes, all shadow casters. 16 x 10 x 2 passes is **up to 320 draw calls from
   characters alone** — about 40% of the worst pose. Relayed to F2.
2. `InstanceGroup.resize` leaves `InstancedMesh.count` at capacity. Hidden slots still count toward
   reported triangles. Relayed to F2.
3. **`gravelmaw_entrance` is a content-layout problem.** The dungeon chambers are authored at
   `floorOffset` -2 to -12, at XZ `[40,-40]` to `[10,-96]`, beside the entrance at `[46,-24]`. That
   pose was rendering the entire dungeon population — every chamber enemy plus the boss — on top of
   the terrace.

**F3 declined to implement per-layer cull distance, with reasoning I accept.** A layer is one
`InstancedMesh` per (asset, primitive) spanning the region, so its bounding sphere is region-sized:
draw calls are *flat* in instance count while triangles are *linear* in it. Tiling therefore trades
triangles for draw calls at a bad rate — tiling Vellenwood's grass turns 2 calls into 10-14 to save
0.16M triangles — and the shadow pass makes it worse, since the sun's 140x140 ortho box would
multiply rather than divide. Draw calls are the failing exit condition; triangles are not (worst
frame 3.0 ms against 16.67). Spending the budget on species and count was the right call.

Vellenwood is now 360 trees with only **20** `twisted` kept as a sparse red accent scaled to
1.35-2.15, against 505 trees with 85 `twisted` as the dominant layer. F3 bought the enclosure back
with scale and clumping rather than count — scale costs zero triangles, and clumping is what
produces the PRD's "shafted light against canopy shadow" instead of uniform gloom.

### Root fixes from F3's findings

- **`CAMERA.far` 600 -> 280.** Fog ends at 260 m, so everything from 260-600 m was drawn fully
  fogged out: invisible geometry, fully paid for.
- **Dungeon entities render only from inside the dungeon.** A one-line filter on the render entity
  source in `boot.ts`, which removes the entire cause of the 803-call pose.

---

## Fix round: final state

All nine findings closed. Measured after integration:

| metric | before | after |
| --- | --- | --- |
| worst-pose draw calls | 803 (`gravelmaw_entrance`) | **359** |
| worst-pose triangles | 12,562,890 | **3,446,944** |
| worst-pose frame time | 3.0 ms | **1.9 ms** |
| poses over the 400 budget | 2 of 18 | **0 of 18** |
| entities | 179 | **864** |

That is with 36 assembled buildings, 614 building parts, 42 roads, and animation added — the budget
came down while the content went up roughly fivefold.

### Three bugs found by measuring rather than reasoning

**Vellenwood stayed crimson after the species fix.** F3 correctly identified the `twisted` tree
family as autumn-coloured and replaced the dominant canopy. The region was still red. I guessed at
the undergrowth, changed it, and it was still red. Disabling the red accent trees entirely: still
red. The actual cause was the **tier-5 woodcutting node entities** — ten `tree_twisted_1` at the
heart of the region — and the reason the tier tint could not fix them is structural:

> Tinting multiplies `material.color` against the texture. It can darken a red leaf. It can never
> re-hue one.

That is worth carrying into Phase 2, where tier variants do much more work. A tier palette can only
shift a material within the hue its texture already has; a genuinely different hue needs a
different mesh or a different texture.

**Forty-two roads rendered as nothing.** `buildRoad` and `addFlatSpot` had zero callers, which the
critic caught. After wiring them the roads were still invisible. `getSceneStats()` (added for this,
and kept) proved 42 road meshes existed in the scene graph with nothing hidden — so the geometry
was being drawn and could not be seen. The ribbon is a flat horizontal strip whose triangle winding
comes out facing down, and `MeshStandardMaterial` defaults to `FrontSide`, so every road was
backface-culled from the only angle a player ever looks from. One `side: THREE.DoubleSide`.

I chased two wrong theories first — texture contrast, then the 6 cm ground lift against A2's
measured 0.35 m terrain discretisation error. Both were plausible and both were wrong. Adding a
scene-graph census turned a fourth round of guessing into one decisive answer, which is why
`getSceneStats()` stays: a render bug is either "the object was never created" or "the object
exists and is invisible", and those need completely different fixes.

**Clip names collided across skeletons.** `AssetRegistry` keyed animation clips by bare name
globally, and `enemy_blob`, `enemy_crab` and `enemy_skull` each ship `Idle` / `Walk` / `Death` on
three different skeletons — so whichever GLB loaded first won the name and would deform the other
two. F2 caught it and added a compatibility check; the underlying fix was mine: clips are now keyed
`${assetId}:${name}`, and the shared library only accepts clips from the animation packs, where the
identical-skeleton guarantee actually holds.

### The fix that mattered most, and I would not have specified it

I asked F2 for an `AnimationMixer` on rigged entities. It pointed out that would have fixed almost
nothing, because **`InstancedMesh` ignores skinning** — the instanced majority of characters were
rendering in bind pose, and a mixer only ever touches the handful of unique views. It CPU-skins one
idle frame into static geometry and instances from that, so characters past the animation budget
stand naturally instead of T-posing. Cost is a few milliseconds once per asset and nothing per
frame.
