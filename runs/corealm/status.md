# Status — Corealm

- [x] Brief recorded (`brief.md`)
- [x] Fresh PRD draft (`PRD.md`)
- [x] Root PRD review — approved with corrections R1-R6 (`architecture.md`)
- [x] Stack de-risked before writing game code (`stack-findings.md`)
- [x] WebMCP researched before building the adapter (`webmcp-research.md`)
- [x] Asset pipeline — 213 CC0 GLBs, 37.6 MB (`asset-report.md`)
- [x] Round 0 — foundation passes the Chromium smoke test
- [x] Round 1 — world, movement, navigation
- [x] Round 1 critique and fix round (`critique-round1.md`)
- [x] Round 2 — gathering, inventory, banking, economy, UI
- [x] Round 3 — combat, production, quests, dialogue, dungeon
- [x] Agent interface — 19 tools, WebMCP, generated docs, overlays
- [x] Phase 1 report (`phase1-report.md`)
- [x] Round 4 — every High and Medium issue in that report
- [x] Round 5 — the screens a human needs, built by six parallel workers
- [x] **Gate check 27/27, agent proofs 2/2, perf 18/18**

Phase 1 is closed and playable end to end by a human. What remains is Phase 2 content depth,
listed under "Still open" in the report.

## New feature work

All Phase 2 and later features use the lab-first workflow in `docs/feature-lab.md`. Build and accept an isolatable feature in the production-backed lab before assigning its final-world wiring. Only authored full-world behavior can use a recorded exception, and reusable local pieces still use the lab.

## Commands

```
npm run smoke       -- --run runs/corealm     9/9 checks
npm test                                       25/25 unit tests
npm run build                                  clean
npm run gate-check  -- --run runs/corealm     27/27 gate lines
npm run agent-proof -- --run runs/corealm     2/2 agent proofs
npm run perf        -- --run runs/corealm     18/18 poses in budget
npm run gen-docs                               10 files from canonical content
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
