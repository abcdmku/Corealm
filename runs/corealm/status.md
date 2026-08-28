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
- [x] **Gate check 18/18, agent proofs 2/2**
- [x] Phase 1 report (`phase1-report.md`)
- [ ] High-priority visual issues — listed in the report, carried into Phase 2

## Commands

```
npm run smoke       -- --run runs/corealm     9/9 checks
npm test                                       25/25 unit tests
npm run build                                  clean
npm run gate-check  -- --run runs/corealm     18/18 gate lines
npm run agent-proof -- --run runs/corealm     2/2 agent proofs
npm run perf        -- --run runs/corealm     18/18 poses in budget
npm run gen-docs                               10 files from canonical content
```

`gate-check` is the one that matters. Every line it reports is a state delta produced by playing
through the agent surface; `__gameDebug` may set a check up but can never satisfy one.
