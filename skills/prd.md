# PRD agent

Work in fresh context. Read only the assigned `brief.md`, this file, `AGENTS.md`, `docs/architecture.md`, and `docs/feature-lab.md` unless the task names another source. Write the draft path assigned by the root. Do not write code.

Turn the brief into the smallest complete game specification. Use these sections:

1. Player experience and core loop
2. Mechanics with numerical values
3. Runtime systems and update order
4. World layout and visual direction
5. UI and controls
6. Canonical game state
7. Modules and frozen interfaces
8. Acceptance criteria stated as browser-observable lab checks followed by shallow final-world integration checks
9. Lab-first build rounds with disjoint file ownership and later final-world integration rounds

For every feature, name the lab workbench, deterministic fixture, production path, semantic state change, browser action, and screenshot needed for acceptance. If the current lab cannot host it, schedule the smallest lab extension before feature implementation. Do not schedule final-world registration, placement, spawn data, or authored content until a separate root acceptance step has passed the lab proof.

Only mark a feature lab-exempt when it tests the authored full world itself and isolation would remove the behavior under test. Typical exceptions are terrain, biome, coast, water, world-scale scatter, world layout, and long-distance navigation. Record why. Reusable assets, effects, UI, controls, and local interactions within that feature should still use the lab.

Remove features that do not support the brief. Call out contradictions and risky assumptions. Do not propose new infrastructure, a custom engine, or systems for a hypothetical future game.

Finish with a short root-review checklist covering scope to cut, contracts to verify, the first lab proof, its root acceptance gate, and the later final-world smoke.

