# Lean 3D game-building harness

This is an uninitialized template for an agent-built Three.js browser game. It contains the workflow, agent instructions, browser driver, state-backed playtests, screenshot support, and critic handoffs. It does not contain a game, a game brief, or a completed run.

## Start from a brief

Use Node 24 (other Node majors are rejected), then install the harness once:

```bash
node --version # v24.x
npm ci
npx playwright install chromium
```

Write a short Markdown brief, then create a run:

```bash
npm run game-agent -- build briefs/my-game.md --id my-game
```

That command records the brief under `runs/my-game/`. It does not call a model or invent the game. Give the repository to a root coding agent and ask it to follow [AGENTS.md](./AGENTS.md):

1. Use a fresh-context PRD agent with `skills/prd.md`.
2. Review and approve `runs/my-game/PRD.md`.
3. Build the minimal browser foundation, freeze only the shared contracts the PRD needs, and boot the production-backed feature lab.
4. Pass the Chromium foundation smoke before delegating disjoint specialist files.
5. Build each isolatable feature in the lab, inspect browser state and screenshots, and have the root accept it there.
6. Wire accepted features into the final world, keep the integration smoke shallow, and use a fresh read-only critic.
7. Convert concrete criticism into a lab fix round, reaccept it, then repeat the final-world integration check.

Durable context belongs in the run directory, not in a long orchestration transcript.

## Repository shape

```text
game/                 uninitialized until a PRD is approved
skills/               PRD, builder, and critic role instructions
tools/                browser driver and small command-line utilities
runs/<run-id>/        brief, PRD, architecture, evidence, and critique
docs/                 architecture and source-pattern notes
```

The game remains a normal Vite application and never imports the harness at runtime.

## Commands after the foundation exists

```bash
npm run dev
npm run test:watch
npm run structure:contracts:watch
npm run structure:lint
npm run structure:sweep
npm run lab:preview
npm run lab:building:preview
npm run lab:test
npm run check
npm run smoke -- --run runs/my-game
npm run play -- --run runs/my-game --scenario tools/scenarios/my-game.json
npm run screenshot -- --run runs/my-game --name checkpoint
npm run game-agent -- critic-pack --run runs/my-game
```

`npm run check` is the local CI loop: typecheck, all unit tests, and the game and guide production builds. `dev`, `build`, and browser commands intentionally stop with a clear message while `game/index.html` is absent.

Use the persistent realtime feature lab as the default development environment for every feature that can run in a compact deterministic scene. This includes structures, actors, animation, combat, effects, resources, interactables, pickups, UI, equipment, inventory, crafting, shops, quest interactions, input, camera behavior, and local collision or navigation. When the lab lacks a fixture or control, extend it as part of the feature. After focused checks and `npm run lab:test` pass and the root accepts the visual evidence, wire the feature into the final world and verify only its loading, real data flow, placement, and representative interaction.

The lab-first gate may be skipped only when isolation would remove the authored full-world behavior under test, such as terrain, biome, coast, water, world-scale scatter, world layout, or long-distance navigation. Record the exception. Reusable assets, effects, UI, controls, and local interactions still belong in the lab. See the authoritative [feature-lab workflow and budgets](./docs/feature-lab.md) and [world-authoring workflow](./docs/world-authoring.md).

Generated icons, world maps, and guide captures are committed inputs to normal development and CI. Refresh text with `npm run docs:refresh`; use `npm run assets:refresh` or `npm run docs:refresh:visuals` only when those generated visuals intentionally need to change. The visual commands boot Chromium and are deliberately not part of `dev`, `build`, `check`, or deployment.

## Runtime testing contract

Development builds expose a synchronous, JSON-safe `window.__gameDebug` with:

```text
getState()
getPlayer()
getPlayerPosition()
getCamera()
getEntities()
getCurrentActivity()
getObjectives()
getNavigationState()
reset()
```

Games may add development-only helpers such as `teleport()` or `setScenario()` when they make tests deterministic. Gameplay tests record state before and after every action; source inspection alone is not proof that a feature works.

## Scripted play

A scenario is JSON with a name and up to 50 actions. Supported actions include key presses, mouse input, waits, debug calls, semantic inspections, screenshots, reset, and reload.

```json
{
  "name": "movement-proof",
  "actions": [
    { "key": "w", "holdMs": 1000, "label": "Move forward" },
    { "inspect": "getPlayerPosition", "label": "Read the result" },
    { "screenshot": "after-move" }
  ]
}
```

Reports and screenshots are written into the selected run directory.

GLB assets belong under `game/public/assets/` with a small metadata manifest. `npm run inspect-glb -- game/public/assets/model.glb` reports scenes, nodes, meshes, and animations without introducing an asset database.

The harness keeps the useful mechanisms from [WorldBuild Bench](https://github.com/sebnado/worldbuild-bench) and [Sunburst Isle](https://github.com/djtoon/sunburst_isle), summarized in [docs/reference-patterns.md](./docs/reference-patterns.md). It deliberately omits model-provider adapters, workflow databases, queues, plugins, benchmark scoring, and other infrastructure that does not help build and inspect the next game.
