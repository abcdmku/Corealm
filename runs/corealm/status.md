# Status — Corealm Phase 1

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
- [x] Phase 1 critic pass
- [x] Phase 1 report (`phase1-report.md`)
- [x] Visual and agent-surface fix round — every High and Medium issue in that report
- [x] **Gate check 25/25, agent proofs 2/2, perf 18/18**

Phase 1 is closed. What remains is Phase 2 content depth, listed under "Still open" in the report.

## Commands

```
npm run smoke       -- --run runs/corealm     9/9 checks
npm test                                       25/25 unit tests
npm run build                                  clean
npm run gate-check  -- --run runs/corealm     25/25 gate lines
npm run agent-proof -- --run runs/corealm     2/2 agent proofs
npm run perf        -- --run runs/corealm     18/18 poses in budget
npm run gen-docs                               10 files from canonical content
```

`gate-check` is the one that matters. Every line it reports is a state delta produced by playing
through the agent surface; `__gameDebug` may set a check up but can never satisfy one.

Seven of the 25 lines were added in the fix round, one per bug that had shipped without a check
that could see it:

```
spent-node        a worked-out node still draws, and draws differently from a full one
combat-clears     inCombat goes false on the kill, not eight seconds later
equip-events      wearing a sword emits item.equipped, and not item.lost
ui-panels         every panel key opens its panel, and the dock advertises the keys
building-footing  the ground under all 36 buildings is level to 0.000 m
objective-prose   no objective prints a developer id, and every one carries refs
long-cairn        the seven-stage chain can be driven past stage 0 by playing
```

Four of those needed new **observation**, not new play. A screenshot cannot tell a mesh that is
missing from one that is tiny, so `__gameDebug` grew `getDrawnBounds`, `checkBuildingFooting`,
`getKeyBindings` and `getPanels`. All four are read-only and none of them can satisfy a check.
