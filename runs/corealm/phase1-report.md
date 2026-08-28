# Corealm Phase 1 report

Build: `phase1-round2`. Content tiers 1, 5 and 10 across three connected regions plus a dungeon.

## Verdict

Phase 1's **systems** are built and proven. Its **content depth and visual polish** are not finished.
The gate is met on every mechanical line and partially met on the presentation lines. Detail below,
including what is still wrong.

## Systems implemented

All eleven skills — Melee, Magic, Mining, Woodcutting, Fishing, Farming, Smithing, Crafting,
Cooking, Fletching, Agility. Player movement with click-to-move over a real navmesh plus WASD, an
orbit camera, Rapier collision, semantic entities, a 28-slot inventory, 9-slot equipment, a 400-slot
bank, currency, shops, gathering with depletion and respawn, four production skills, melee and magic
combat, enemy AI with three behaviours, a two-phase boss, loot, derived health, death with a
recoverable cache, NPCs, dialogue, quests, a dungeon, persistence, generated documentation, a
19-tool agent surface with WebMCP registration, agent events, overlays, and the HUD plus five panels.

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
npm run gate-check   18/18 Phase 1 gate lines
npm run agent-proof  2/2 agent proofs
npm run perf         18/18 camera poses inside budget
```

### Gate check, 18/18

Every line is a state delta produced **by playing**, through the same agent surface an external agent
gets. `__gameDebug` may set a check up; it can never satisfy one.

```
navigation    path points 12, travelled 37.8 m
mining        xp 0 -> 40 on bracken_pit_grithe_1
woodcutting   xp 0 -> 40 on palewood_copse_trees_1
fishing       xp 0 -> 50 on redsill_spots_1
depletion     bracken_pit_grithe_1 depleted by mining it out
farming       xp 0 -> 3
smithing      xp 0 -> 16 via smelt_grithe_bar
cooking       xp 0 -> 15 via cook_seared_minnow
crafting      xp 0 -> 24 via craft_essence_shard_t1
fletching     xp 0 -> 20 via fletch_palewood_shaft
melee         xp 0 -> 1761, killed=true
magic         xp 0 -> 1776
agility       xp 0 -> 6789, displaced 73.7 m via canopy_walk
death         dropped=true, respawned 343 m away, cache=1, recovered=true
quest         cold_iron active stage 0/5
dungeon       entered=true, region on entry=gravelmaw
boss          ordrun 200 -> 0 KILLED, player deaths 0
persistence   save 6 KB, 4 skills above level 1
```

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
worst pose      396 draw calls against a 400 budget
worst frame     2.1 ms median against a 16.67 ms budget
poses over      0 of 18
```

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

## Known issues

### High

- **Depleted nodes disappear rather than showing a spent state.** `ensureSpent()` returns early when
  a group has no spent parts, and `writeSlot` then hides the live instance without drawing a
  replacement. Node state and respawn are correct; only the visual is wrong.
- **Building parts land detached.** Wall panels float at an angle and roof sections rest on grass in
  `r3-shop`, `r3-bank` and `r2-spawn`. Assembly works; placement escapes the flattened pad for parts
  outside it, and for `loose()` placements whose asset local axis does not match their tag.
- **No UI panel appears in any screenshot, and there is no on-screen way to open one.** Inventory,
  skills, equipment, bank and shop open on `i`/`k`/`e` with nothing advertising those keys. A player
  who cannot find their inventory cannot progress.
- **The three regions share one building kit.** Highcairn (tier 10) uses the same cottages, roof
  pitch and wall module as Coldbrace (tier 1); only ground colour differs. Vellenwood still reads
  crimson at distance because the accent trees dominate the skyline.

### Medium

- **Rootfall's landmark is a five-times-scale anvil.** `anvil_log` carries a `stump` tag because it
  contains one; nobody opened the mesh.
- **`inCombat` never clears after a kill.** `combat.ended` fires with `reason: "killed"` and the flag
  stays true, so an agent that waits for `inCombat === false` hangs.
- **Equipping emits `item.lost`.** An agent tracking inventory from events concludes it lost the
  weapon it just equipped. Equip and unequip need their own event type.
- **Generated docs contradict their own index.** `README.md` counts the aliased `ENEMIES` array (21)
  while `enemies.md` dedupes to 9. `ENEMY_BLOCKS` exists and is the correct constant.
- **Quest objectives print developer ids.** "Mine 6 Grithe ore (item `grithe_ore`)" renders those
  backticked ids in the player-facing journal. They belong in a structured field the agent reads and
  the UI does not print.
- **Water and roads are unfinished surfaces.** Water is a hard-edged quad the navmesh extends over,
  so the player can walk on it; road ribbons sit high enough to cast shadows.

### Low

- No item icons; slots draw a category-hued glyph.
- The Long Cairn's later stages are authored but only stage 0 is proven by playing.
- Ordrun's static pose reads oddly, a consequence of the CPU-skinned instanced fallback.

## Phase 2 readiness

The architecture is ready. Content schemas carry `tier: number` and nothing else changes for tiers
20-99; the material system has palettes authored to 99; the XP curve is closed-form to 99; and the
route graph, activity spine and agent surface are all tier-agnostic.

Two things should be fixed **before** Phase 2 rather than during it:

1. **Region visual identity.** Adding six more regions on top of a settlement kit that cannot tell
   tier 1 from tier 10 multiplies the problem by six. Distinct roof and wall modules plus distinct
   settlement topology per region, decided once, before the new content lands.
2. **The manifest's "is" versus "contains" distinction.** The anvil-as-stump mistake will recur
   across 213 GLBs, and Phase 2 adds more.

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
