# What this project keeps from the reference builds

I inspected [WorldBuild Bench](https://github.com/sebnado/worldbuild-bench) and [Sunburst Isle](https://github.com/djtoon/sunburst_isle) before choosing this structure.

WorldBuild Bench provides the reusable testing pattern. Its best mechanisms are a fresh PRD worker, a root orchestrator, frozen module exports, disjoint worker files, a fixed browser health probe, semantic telemetry, and scripted Playwright actions that record state after every step. Its own README is candid about the limit of gates: builds can pass mechanical checks while humans immediately find broken controls or impossible objectives. This project keeps that split between fast health checks and independent visual criticism.

Sunburst Isle provides a useful production pattern. Its foundation came first, including timing, collision, the player controller, and capture hooks. Specialist work then ran in file-owned rounds with integration barriers. Its critique capture uses named scenarios, repeatable player and camera placement, screenshots, and telemetry. It also shows why test hooks should be semantic. Several visual fixes came from checking the actual rendered pose, shadow bounds, or camera position rather than reading code.

This project deliberately leaves out WorldBuild Bench's provider adapters, pricing, scoring, transcripts, resumability, model registry, benchmark rounds, and workspace jail. Those solve benchmark operation, not game construction. It also leaves out Sunburst Isle's game-specific capture matrix. A later PRD should add only the checkpoints that its game needs.

The retained loop is short:

```text
brief -> fresh PRD -> root review -> running foundation -> frozen contracts
      -> owned lab feature round -> lab state + screenshots -> root acceptance
      -> final-world wiring -> shallow browser integration -> fresh critic
      -> fixes in lab -> reaccept -> reintegrate
```

This project adds one rule beyond the reference builds: any feature that can run in a compact deterministic scene is built and accepted through the production-backed feature lab before final-world wiring. See `docs/feature-lab.md` for the gate and its narrow full-world exceptions.

