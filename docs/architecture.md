# Minimal architecture

The repository has three independent parts:

- `game/` becomes a normal Vite game after a PRD is approved. It never imports run or agent tooling.
- `tools/` starts that game, drives Chromium, calls `window.__gameDebug`, and writes evidence.
- `runs/<run-id>/` holds durable planning and review artifacts for one build.

The root agent owns architecture, shared contracts, integration, and acceptance. A fresh PRD agent proposes only the systems required by the brief. The root removes poor scope, creates the foundation, and freezes the smallest useful interfaces before assigning disjoint files to specialists.

```text
brief -> fresh PRD -> root review -> browser foundation -> frozen contracts
      -> owned build round -> integrate -> smoke -> scripted play
      -> screenshots + state -> fresh critic -> fix round -> retest
```

The foundation is real code, not stubs: application boot, renderer, scene, update loop, input, Rapier, Recast, asset loading, canonical state, shared types, debug API, and Playwright connectivity. It must launch successfully in Chromium before parallel game work begins.

Shared contracts normally live in `game/src/contracts.ts`, but their contents come from the approved PRD. The template does not predeclare final-game schemas. When a contract is wrong, specialists stop; the root updates the contract and affected callers together.

The command-line layer stays thin. `game-agent build` creates a run folder, browser commands collect evidence, and `critic-pack` assembles paths for an independent review. Agent spawning remains the responsibility of the coding environment.
