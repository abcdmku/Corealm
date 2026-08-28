# PRD agent

Work in fresh context. Read only the assigned `brief.md`, this file, `AGENTS.md`, and `docs/architecture.md` unless the task names another source. Write the draft path assigned by the root. Do not write code.

Turn the brief into the smallest complete game specification. Use these sections:

1. Player experience and core loop
2. Mechanics with numerical values
3. Runtime systems and update order
4. World layout and visual direction
5. UI and controls
6. Canonical game state
7. Modules and frozen interfaces
8. Acceptance criteria stated as browser-observable checks
9. Parallel build rounds with disjoint file ownership

Remove features that do not support the brief. Call out contradictions and risky assumptions. Do not propose new infrastructure, a custom engine, or systems for a hypothetical future game.

Finish with a short root-review checklist: scope to cut, contracts to verify, and the first playable proof.

