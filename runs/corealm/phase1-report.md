# Corealm Phase 1 report

Build: `phase1-round3`. Content tiers 1, 5 and 10 across three connected regions plus a dungeon.

## Verdict

Phase 1's systems are built and proven, and the presentation issues round 2 left open are closed.
Every High and Medium item from the round-2 report is fixed and each one now has a gate check that
fails if it comes back. The gate is 25/25.

What is still open is content DEPTH, not polish: three regions of ten, three of the Long Cairn's
seven stages proven by playing rather than all seven, and one tiled roof covering shared across
three settlement kits because the free library ships exactly one. Those are listed at the bottom.

## Systems implemented

All eleven skills — Melee, Magic, Mining, Woodcutting, Fishing, Farming, Smithing, Crafting,
Cooking, Fletching, Agility. Player movement with click-to-move over a real navmesh plus WASD, an
orbit camera, Rapier collision, semantic entities, a 28-slot inventory, 9-slot equipment, a 400-slot
bank, currency, shops, gathering with depletion and respawn, four production skills, melee and magic
combat, enemy AI with three behaviours, a two-phase boss, loot, derived health, death with a
recoverable cache, NPCs, dialogue, quests, a dungeon, persistence, generated documentation, a
19-tool agent surface with WebMCP registration, agent events, overlays, and the HUD plus six panels
behind a permanent on-screen dock.

## Content counts

| Table | Rows |
| --- | --- |
| Items (including equipment) | 102 |
| Recipes | 78 |
| Enemies (canonical blocks) | 9, plus group aliases |
| Spells | 3 |
| Shops | 5 |
| Quests | 10 |
| NPCs | 12 |
| Dialogue nodes | 82 |
| Semantic entities in the world | 864 |
| Assembled buildings | 36 (614 parts) |
| Roads | 42 |
| Regions | 3 + 1 dungeon |

## Asset packs used

All CC0 by Quaternius, 213 GLBs totalling 37.6 MB after optimisation from 740 MB of source:
Medieval Village MegaKit, Stylized Nature MegaKit, Fantasy Props MegaKit, Universal Base Characters,
Modular Character Outfits: Fantasy, Universal Animation Library 1 and 2. Every pack, licence and
source URL is recorded in `game/public/assets/manifest.json`.

The single most useful measured fact: every character pack and both animation libraries share one
identical 65-bone skeleton, so 86 animation clips play on any rig with no retargeting at all.

## Test evidence

```
npm run smoke        9/9 checks, zero console/page/request errors
npm test             25/25 unit tests (the XP curve and every PRD formula, frozen)
npm run build        clean
npm run gate-check   25/25 Phase 1 gate lines
npm run agent-proof  2/2 agent proofs
npm run perf         18/18 camera poses inside budget
```

### Gate check, 25/25

Every line is a state delta produced **by playing**, through the same agent surface an external agent
gets. `__gameDebug` may set a check up; it can never satisfy one.

```
navigation        path points 12, travelled 37.8 m
mining            xp 0 -> 40 on bracken_pit_grithe_1
woodcutting       xp 0 -> 40 on palewood_copse_trees_1
fishing           xp 0 -> 50 on redsill_spots_1
depletion         bracken_pit_grithe_1 depleted by mining it out
spent-node        depleted node draws 3.9 x 2.0 m in 1 mesh, live sibling in 2 (vein gone)
farming           xp 0 -> 3
smithing          xp 0 -> 16 via smelt_grithe_bar
cooking           xp 0 -> 15 via cook_seared_minnow
crafting          xp 0 -> 24 via craft_essence_shard_t1
fletching         xp 0 -> 20 via fletch_palewood_shaft
melee             xp 0 -> 1761, killed=true
magic             xp 0 -> 1776
agility           xp 0 -> 6789, displaced 73.7 m via canopy_walk
death             dropped=true, respawned 343 m away, cache=1, recovered=true
quest             cold_iron active stage 0/5
dungeon           entered=true, region on entry=gravelmaw
boss              ordrun 200 -> 0 KILLED, player deaths 0
combat-clears     killed=true, inCombat=false, regenBlocked=true, targetId=null
equip-events      equip emitted [item.equipped] and nothing else
ui-panels         4/4 panel keys open their panel, 4 dock buttons on screen
building-footing  36 buildings, worst ground tilt across a footprint 0.000 m
objective-prose   1 active, 0 printing ids, 1 carrying refs
long-cairn        long_cairn active stage 2/7, driven by dialogue and movement
persistence       save 7 KB, 4 skills above level 1
```

The seven checks added this round exist because each one is a bug that shipped in round 2 and that
no existing check could see. Three of them needed new observation, not new play: a screenshot cannot
distinguish "the depleted node is drawn as a pebble" from "the depleted node is not drawn at all",
and `getSceneStats` cannot either, because an `InstancedMesh` exists whether or not any of its slots
hold a visible matrix. So `__gameDebug` grew three read-only measurements:

```
getDrawnBounds(entityId)   the world box the renderer actually draws, its mesh count, and which
                           path drew it ("instanced" vs "animated:<clip>")
checkBuildingFooting()     ground height under every building's footprint vs at its origin
getKeyBindings()/getPanels()  what is bound, and what is open
```

Each answers a question a picture cannot. `checkBuildingFooting` is the clearest case: it reports
0.000 m of tilt under all 36 buildings, and the number it replaced was 1.353 m.

### Agent proofs, 2/2

```
mining-1-to-10   passed, 308 tool calls, 102.5 s
                 miningLevel 10, miningXp 1744, banked 160 ore, 37 log entries
cold-iron-start  passed, 12 tool calls, 10.6 s
```

The mining agent genuinely plays: it prospected 25 locations to find seams, mined each until it
depleted, filled its 28 slots, banked six times, and used two different banks because it had wandered
into Vellenwood. The quest agent discovers its target rather than being told — it observes visible
NPCs, inspects each, and finds `cold_iron` in `questIds` before talking to anyone.

## Performance

Measured on a real GPU (RTX 5080 via ANGLE/D3D11), 1920x1080, across all 18 named camera poses.

```
worst pose      397 draw calls against a 400 budget   (Highcairn)
worst frame     2.2 ms median against a 16.67 ms budget
poses over      0 of 18
```

Up one from round 2, and Highcairn is where it went: the stone kit's brick walls carry three
materials where the plaster walls carried two, and the gable ends are a fourth group. Three draw
calls of headroom is not headroom. Anything added to that settlement needs a call given back first.

The smoke and play harness deliberately runs SwiftShader for determinism and reports ~4 FPS on the
same scene. That number is meaningless as performance and is never used as evidence.

## WebMCP capabilities

19 tools, consolidated from the brief's ~30 capability bullets. `observe` absorbs known-location
recall through a `scope` parameter, `interact` absorbs gather/agility/loot/talk/door through the
`InteractionId` it is given, and `events` absorbs both draining and long-poll waiting through an
optional timeout.

One implementation, three ways in: `window.corealm.agent` always; `document.modelContext` when the
browser supports it, with a local polyfill otherwise so the registration path stays exercised; and
`__gameDebug.callTool` for tests. Spec research is in `webmcp-research.md` — the draft has moved to
`document.modelContext`, and this Chromium exposes neither spelling even with feature flags, so the
browser API is a view onto the canonical surface rather than a second code path.

`docs/agent-api.md` documents all of it, including a complete worked Mining 1-to-10 agent.

## What round 3 fixed

Every High and Medium item from the round-2 report, with the check that now holds it in place.

### High

- **Depleted nodes disappeared instead of showing a spent state.** The cause was content, not code:
  ore swapped `rock_medium_1` for `rock_small_1` and trees swapped for `anvil_log`, and from the
  camera the game is played at, a small rock standing where a big one stood is indistinguishable
  from nothing. A spent node now keeps the silhouette the player walked up to and is derived from
  the LIVE mesh — the ore vein is dropped (it was already a separate part), a tree is clipped to its
  own trunk, a crop is cut back to stubble. `writeSlot` also falls back to the live instance rather
  than hiding it when a group has no spent geometry at all, so the failure mode is now "wrong
  colour" instead of "gone". Gate: `spent-node`.
- **Building parts landed detached.** Not an assembly bug. A building is assembled level, so any
  tilt in the ground under it comes out as a corner in the air. Two causes, both in the terrain:
  pad radius was a fixed 34 m regardless of what stood on it, and pads did not compose — a 7 m
  location pad inside a settlement targeted the RAW hillside height at its own centre and pulled it
  back up through the town, while the Cairn Tarn's blend (widened to ~100 m by `normaliseFlats`)
  reached into Highcairn and dragged its east side toward the waterline. Pads are now sized from
  their own contents, resolved in order so an inner pad adopts the height of the pad it stands on,
  and a pad's falloff can no longer disturb ground another pad has already made flat. Worst tilt
  went 1.353 m -> 0.000 m. Gate: `building-footing`.
- **No UI panel appeared in any screenshot and nothing said how to open one.** Two separate bugs.
  There was no affordance, and the keys did not work either: `boot.ts` built a second
  `KeyboardController` beside the one `InputController` already owned, both listened on `window`,
  and both dispatched the same keydown through the same shared registry — so one press toggled a
  panel open and shut again. Movement still worked, because held keys are a set. There is now one
  controller, a permanent dock along the bottom-right with a button and its own key printed on it
  per panel, and a Journal panel (`j`) that was missing entirely. Gate: `ui-panels`.
- **The three regions shared one building kit.** Settlements now name a `kit`, and a kit is a wall
  family, a corner post, a roof pitch and a roofline: Coldbrace in lime plaster under steep
  pantiles, Rootfall in exposed frame with a felled log along each ridge and dormers in the roof,
  Highcairn in brick and cut stone with brick piers, gable ends closed in stone, and the shallower
  six-wide roof. Roofs also take the tier body swatch, which weathers Highcairn's toward its
  blue-grey slate. The library ships one tiled covering, so the tile texture is shared by
  necessity; the walls carry the identity.

### Medium

- **Rootfall's landmark was a five-times-scale anvil.** It is now a real Duskoak cut off above its
  root flare, using the same trunk-clipping that felled trees use, and the composition around it —
  steps, brackets, vine — was re-authored against the mesh it actually stands on.
- **`inCombat` never cleared after a kill.** It meant "the eight-second no-regen window is open".
  It now means a fight is happening: a target, or an enemy that has engaged. The window is
  `regenBlocked`, and `targetId`/`engagedBy` name who. Gate: `combat-clears`.
- **Equipping emitted `item.lost`.** Equip and unequip move gear silently and emit
  `item.equipped`/`item.unequipped` instead, so an agent rebuilding its pack from item events never
  reads wearing a sword as losing it. Gate: `equip-events`.
- **Generated docs contradicted their own index.** The index counts `ENEMY_BLOCKS` (9) and
  `RESOURCE_ARCHETYPES` (12), matching the pages they link to, and publishes the alias counts
  separately as what they are: lookup ids.
- **Quest objectives printed developer ids.** Objective text is prose. Every id it names lives in
  `refs` on the stage and reaches an agent as `QuestSummary.currentObjectiveRefs`. Boot fails if an
  objective contains a backtick or a ref names something that does not exist. Gate:
  `objective-prose`.
- **Water and roads were unfinished surfaces.** Roads sat 0.3 m proud of the grass — a kerb that
  caught the light and drew a hard line down every route — and were coloured from `palette.soil`,
  which is near-black in Vellenwood. They now sit 0.02 m up (the polygon offset was already doing
  the z-fighting work), take a colour lifted toward the region's rock, and fade out at both edges
  and both ends through vertex alpha. Water is a disc matching the basin it fills, with a faded rim
  that meets the sloping bank, instead of a rectangle stopping dead on the grass.

### Low

- **No item icons.** Slots draw a vector icon chosen by what the item does — sword, shield, helm,
  boot and glove for the slot a piece of gear goes in, ore chunk, ingot, fish, log, seed, scroll,
  coin or shard for the rest. Same category hue and tier shade as before; the two letters are gone.
- **The Long Cairn's later stages were unproven.** The gate now starts the quest through Ode's
  dialogue, walks to the Great Cairn, and talks her through her tree to reach stage 2 of 7. Stages
  3 to 6 — the Gravelmaw fight, the three-lever puzzle, the keeping-stone — are still authored and
  unplayed.
- **Ordrun's static pose.** The boss was on the instanced fallback, frozen on one baked idle frame.
  A boss now always takes the animated path regardless of the unique-view budget, and a rigged
  entity built before its skeleton arrived is upgraded per entity rather than only during the
  global sweep — which is why Ordrun in particular never got a rig: the sweep fires when some other
  asset finishes loading, and the dungeon is not in the entity list until the player is inside it.
  Measured: `instanced` at 4.47 m wide -> `animated:Idle_FoldArms_Loop` at 1.97 m.

## Still open

- **Content depth.** Three regions of ten, tiers 1/5/10 of 99. This is the Phase 2 job.
- **The Long Cairn past stage 2.** Four stages are authored and not proven by playing.
- **One roof covering.** `roof_wood_plank` is a single 2.3 m board and `roof_gable_brick` is a
  gable end; the only whole roofs in the library are the three tile meshes. Kits differ in wall
  family, corner, pitch and roofline, and share the tile texture.
- **Highcairn sits 3 draw calls under the budget** (397 of 400) — the stone kit's brick walls carry
  three materials where plaster carries two. It passes, and it has no room to grow.
- **The player wades.** The fishing basins are 0.5 m deep by design (PRD: shin-deep at the edge, and
  the markers have to stay visible), so the navmesh reaching across them is intended rather than a
  defect. Deep water does not exist in Phase 1.

## Phase 2 readiness

The architecture is ready. Content schemas carry `tier: number` and nothing else changes for tiers
20-99; the material system has palettes authored to 99; the XP curve is closed-form to 99; and the
route graph, activity spine and agent surface are all tier-agnostic.

The two things the round-2 report said to fix **before** Phase 2 are now done:

1. **Region visual identity.** Settlements name a `BuildingKit` — wall family, corner, roof pitch,
   roofline — and `buildPrefab` takes it. Adding a region means adding a kit, not editing every
   prefab. Content validation rejects an unknown kit id, and `prefabPartAssetIds()` walks every kit
   so a wall family only one region uses is still checked against the manifest.
2. **The manifest's "is" versus "contains" distinction.** Every asset publishes an `is` field: what
   the mesh IS, one word, always the first tag. Everything after the first tag is an association —
   what it contains, stands on, or is used for. `assets.byIs("stump")` is the lookup; `byTags` is
   for "anything to do with farming" and is the wrong question for identity. This is what turned an
   anvil that happens to stand on a log into every felled tree in the world.

Carry forward as a standing rule: **tinting multiplies `material.color` against the texture, so it
can darken a hue but never re-hue one.** A tier palette shifts a material within the hue its texture
already has; a genuinely different colour needs a different mesh or a different texture. This cost a
full round to learn in Vellenwood and matters far more across nine further regions.

## Process note

Three false greens got through this run before the gate check existed: a scenario step that could not
fail (`driver.drag()` dropped the mouse button, so "orbit the camera" sent a left drag and passed), a
performance budget that only ever sampled the emptiest frame, and a `callDebug` that did not await —
so every `callTool` step in every scenario reported `{}` while looking like a pass.

Every false signal in this build came from the test layer, never the game layer. `npm run gate-check`
exists because of that. Its own first three runs were wrong in the same direction: reading a correct
level requirement as an empty world, and a refused walk as a missing resource. The lesson is to trust
a harness failure less than a harness pass until the failure has been traced to the game.

Round 3 adds a second lesson, from the other direction. Four of the seven bugs it fixed were
invisible to every check that existed, because the checks could only see semantics and the bugs were
all in the seam between semantics and pixels: a node whose state was correct and whose mesh was not
drawn, a building assembled correctly on ground that was not level, a key that was bound and
dispatched twice, a boss on the wrong render path. A screenshot showed all four and identified none
of them — an empty patch of grass looks the same whether the mesh is missing, tiny, or somewhere
else. What closed them was three read-only measurements added to `__gameDebug`
(`getDrawnBounds`, `checkBuildingFooting`, `getKeyBindings`/`getPanels`), each of which turns "it
looks wrong" into a number a check can fail on. Screenshots find visual bugs; only measurements
prove them fixed.
