# Status — Corealm

- [x] Brief recorded (`brief.md`)
- [x] Fresh PRD draft (`PRD.md`)
- [x] Root PRD review — approved with corrections R1-R6 (`architecture.md`)
- [x] Stack de-risked before writing game code (`stack-findings.md`)
- [x] WebMCP researched before building the adapter (`webmcp-research.md`)
- [x] Asset pipeline — 222 CC0 GLBs, six Unity-derived magic GLBs, and one Unity-derived VFX atlas (`asset-report.md`)
- [x] Round 0 — foundation passes the Chromium smoke test
- [x] Round 1 — world, movement, navigation
- [x] Round 1 critique and fix round (`critique-round1.md`)
- [x] Round 2 — gathering, inventory, banking, economy, UI
- [x] Round 3 — combat, production, quests, dialogue, dungeon
- [x] Agent interface — 20 tools, WebMCP, generated docs, overlays
- [x] Phase 1 report (`phase1-report.md`)
- [x] Round 4 — every High and Medium issue in that report
- [x] Round 5 — the screens a human needs, built by six parallel workers
- [x] **Historical Phase 1 gate 27/27, agent proofs 2/2, perf 18/18**
- [x] Magic amendment: exact Altar Ruins Free sites at the three Essence mines, boss-Orb awakening, altar-crafted elemental weapons, live weapon charges, leveled vegetation-free regional-stone courts, and exact ruin collision/navigation

Phase 1 is closed and playable end to end by a human. What remains is Phase 2 content depth,
listed under "Still open" in the report.

## Phase 2: the Kilnhalt tier-20 expansion (September 1, 2026)

The approved amendment is in `PRD.md` ("Phase 2 — Kilnhalt tier-20 expansion"). Landed:

- [x] World extended north to 700 x 660 m; Kilnhalt spans the full width above z=200 with a
      completely OPEN southern border (no gates; three semantic route links). Terrain, biome
      field, coast, scatter, navmesh (6,429 polys), world map, and preview all regenerated.
- [x] The complete tier-20 row: Emberite/Kilnstone/Fire Opal/Cinderpine/Charhide/Ashfin/
      Ember Haunch/Coalroot, one `defineTier` row generating all 29 recipes, both armour styles,
      tools, campfires, shops, skill guides, icons, and equipment visuals.
- [x] Fire released: `fire_essence`, `fire_orb`, `fire_wand`, `fire_staff`; the Kilnhalt Fire
      altar with its five-node cache; migration awakens it for saves that already consumed the
      Orb; every "tier 15" fire string corrected to tier 20. Save version stays 6.
- [x] Emberfast: the first settlement with the complete production station set inside one wall.
- [x] Five tier-20 enemy families solved to the 25-40 s on-tier band with the bear/boar style
      gate restated at tier 20.
- [x] Four regional minibosses (one PixeliusVita Monster02 rig, four texture variants, built by
      the new named-take FBX selector), `meta.rank: "miniboss"`, 1.3x scale, boss respawn, and
      independent 10% rolls for eight rare weapons derived `ceil(base x 1.10)` from the local
      craftables. Cinderwake guards the singleton Fire Orb. Three new Unity packages ledgered.
- [x] Proofs: 452 unit tests, lab gate, creature gate (now covering minibosses), smoke,
      `tools/verify-rare-weapons.ts` (grip/tint sweep), and `tools/verify-kilnhalt-world.ts` —
      35/35 real-gameplay checks: seam crossings at five x positions, every tier-20 loop,
      Cinderwake -> Orb -> altar -> fire cast, miniboss tour with respawns, reload persistence.

### Map and coast findings (September 1, follow-up)

Playing the build surfaced that the in-game map still showed the old world. Root causes, all fixed:

- `tools/generate-world-map.ts` assumed the padded bounds tile exactly (only true of the old
  700 x 400 world by coincidence), hard-coded 4:3 rendition sizes, and its ocean-backdrop
  normalizer assumed one uniform padding width. The layout now snaps outward to the tile grid,
  renditions derive their height from the canonical aspect, and the backdrop is flat-filled with
  the sampled ocean median per-side. Detail budgets moved 750 KB -> 1.25 MB (reviewed: 33% more
  pixels plus the northern band compressing ~15% worse at unchanged quality).
- **The island had silently lost its coastline**: `coastBuildSteps` read `this.world` while the
  step list is assembled, but the incremental-boot refactor moved that assignment into the first
  deferred step, so every fresh build skipped the coast with no error. Nothing gates on the world
  edge, so no check caught it. Fixed by passing the spec directly; the skirt and ocean build again.
- The recaptured map shows 70 m headlands in the southern coast band. Those are real: the
  Karrowmoor collar anchors under the highlands field, faithfully drawn. They read flat from
  above because the far skirt carries less surface detail — cosmetic, out-of-bounds, left as is.

### Perf finding worth knowing about

The 400-draw-call budget had only ever been measured against a PARTIALLY STREAMED world: perf
poses sampled before background scatter finished loading. Fully streamed, the pre-Kilnhalt build
measured 632-668 draws at late-sequence poses. This expansion added fog-wall culling (scatter
distance-culled at 195 m player-centred — fog is opaque at 210 m from the trailing camera —
small detail at 170 m, structures resident to fog-opaque rather than camera-far). After it, the
full fully-streamed 32-pose run holds the budget at every Kilnhalt pose and at the amendment's
named views (emberfast 285, vellenwood_canopy 361, highcairn 396), with FPS 119-667 against the
55 floor. Eight LEGACY poses still exceed the budget at full residency (root_tunnel 573 down
from a ~700-class baseline, canopy_walk 529, mire_skirt 481, ...): a pre-existing condition the
historical "18/18" never actually measured. A material-keyed `BatchedMesh` for scatter (already
sketched in `world/scatter.ts`'s header) is the structural fix if the budget must hold at
absolute full residency; measurements near the boundary carry ~±40 draws of streaming-timing
noise between identical builds, so judge any future change by first-and-last pose tours.

## New feature work

All Phase 2 and later features use the lab-first workflow in `docs/feature-lab.md`. Build and accept an isolatable feature in the production-backed lab before assigning its final-world wiring. Only authored full-world behavior can use a recorded exception, and reusable local pieces still use the lab.

## Commands

```
npm run smoke       -- --run runs/corealm       9/9 checks
npm test                                         452 tests across 68 files
npm run build                                    clean
npm run gate-check  -- --run runs/corealm       last full Phase 1 run: 27/27
npm run agent-proof -- --run runs/corealm       2/2 agent proofs
npm run perf        -- --run runs/corealm       32 poses (see the perf finding below)
npx tsx tools/verify-kilnhalt-world.ts           35/35 Phase 2 gameplay checks
npx tsx tools/verify-rare-weapons.ts             rare-weapon lab sweep + screenshots
npm run gen-docs                                 guide files from canonical content
```

`gate-check` is the one that matters. Every line it reports is a state delta produced by playing
through the agent surface; `__gameDebug` may set a check up but can never satisfy one.

## What round 5 was for

A human could reach level 10 in all eleven skills and never start a quest, because all ten of them
are accepted through dialogue and there was no dialogue window. Six workers built the six screens
that were missing, each owning exactly one file:

```
dialogue   the blocker. A transcript, keyboard replies, locked options with their reasons
map        to-scale SVG over the same discovery gate an agent sees; click a place to walk there
controls   read from the live registry, so it cannot go stale
death      what you lost, where it is, how long you have, and a walk-back button
title      pause menu; New game is two deliberate acts behind an acknowledgement
settings   four preferences, each of which changes something on the next frame
```

## What building them turned up

Every screen sat on top of something that had never been exercised, and four were dead wiring:

```
kill predicates    quests.ts read `data.outcome`; the event carries `reason`. Four of the ten
                   quests could not be completed by anyone. No quest had been played past its
                   opening stages, and every kill predicate sits after those.
recovery cache     boot never passed `cacheView`, so the entity had no mesh. Agents find it
                   through `observe` and loot it by id; only a human needed to see it.
discovery gate     `EntityStore` accepts the port, boot never supplied one, so everything counted
                   as known. `state.discovery.locations` had one writer and no reader.
damage numbers     `consumeHits()` had no callers project-wide. Every fight in the game,
                   including the boss, happened in silence.
places in the docs the in-game search index had no places section, while the generated
                   `docs/game/regions.md` had always published one. Invisible until discovery was
                   gated, at which point an agent could not name anywhere it had not stood.
```

Two of the gate's own lines were also wrong, in opposite directions. `agility` granted the level as
setup and then compared XP against a baseline taken before the grant, so it passed on setup alone
while printing "no obstacle found" beside it. `combat-clears` asserted an eight-second sim window
read at `--scale 20`, which is 0.4 s of wall clock: a race that had won twice.

The pattern across all of them: the gate reads semantics, and every one of these bugs lived in the
seam between semantics and what the player actually sees or can reach.
