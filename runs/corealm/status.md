# Status — Corealm Phase 1

- [x] Brief recorded (`brief.md`)
- [x] Fresh PRD draft (`PRD.md`, 1645 lines)
- [x] Root PRD review — approved with corrections R1-R6 (`architecture.md`)
- [x] Stack de-risked before code (`stack-findings.md`)
- [x] WebMCP researched (`webmcp-research.md`)
- [x] Asset pipeline (213 GLBs, 37.6 MB, `asset-report.md`)
- [x] **Round 0 foundation passes Chromium smoke test (9/9)**
- [ ] Round 1 — world, movement, navigation
- [ ] Round 2 — gathering loop
- [ ] Round 3 — production loop
- [ ] Round 4 — combat loop
- [ ] Round 5 — quests, dialogue, farming, agility
- [ ] Round 6 — agent interface
- [ ] Round 7 — integration and the two gate proofs
- [ ] Play and critique loop complete

## Round 0 evidence

```
smoke:  9/9 pass, zero console/page/request errors
tests:  11/11 pass (XP curve frozen at 9,999,879 @ L99)
build:  clean
perf:   RTX 5080 via ANGLE/D3D11, median 0.2 ms/frame, 42 draw calls, 1.23M triangles
nav:    238 navmesh polys, route graph + Dijkstra planning live
assets: 213 manifest entries, 85 animation clips loaded
```

Note on FPS measurement: the smoke/play harness runs SwiftShader for determinism and reports ~4 FPS,
which is meaningless as a performance signal. `npm run perf` measures the real GPU instead.
