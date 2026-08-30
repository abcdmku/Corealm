# Agent rules

The root agent owns architecture, shared contracts, integration, and acceptance.

1. If `game/index.html` is absent, the repo is uninitiated. Do not invent a game without a current run's `brief.md`.
2. Turn that brief into an approved `PRD.md` before major game work.
3. Make the game boot in Chromium before parallel work. Freeze shared interfaces in `game/src/contracts.ts` first.
4. Give each concurrent worker explicit file ownership. Concurrent workers never edit the same file or change frozen contracts.
5. Workers stop and report a bad contract. The root agent changes shared contracts and their callers together.
6. Integrate in short rounds. Only the root runs whole-game checks while a round is active.
7. Source review is not gameplay proof. Test the real Vite game with Playwright and compare semantic state before and after actions.
8. Inspect screenshots for visual work. A passing build does not prove that the view is readable.
9. Critics are fresh-context, read-only reviewers. The root accepts changes only after build, browser play, state checks, and relevant screenshots pass.

World, biome, water, scatter, and wind work must follow [docs/world-authoring.md](./docs/world-authoring.md).
