# Realtime feature lab

The feature lab is the canonical place to build and deeply test isolated 3D features. It renders production structures, the main player, NPCs, creatures, animations, melee actions, and spell effects without booting the terrain, simulation, or full world. Player equipment can be selected independently by slot, and editable skill levels make level-dependent presentation and feature cases reproducible. This keeps edit feedback immediate while exercising the same render, asset, rig, animation, and effect paths used by the game.

## Development loop

Start with the smallest loop that can reject a bad change:

```bash
# General unit tests, kept alive while editing
npm run test:watch

# Structure recipes, compositions, collisions, and asset references
npm run structure:contracts:watch

# Persistent Vite lab with realtime HMR
npm run lab:preview
```

Keep `lab:preview` running while editing. Use its controls to swap structures; spawn the main player, NPCs, and creatures; equip the player by slot; set player skill levels; select animations; and exercise attacks and spells. Skill values are isolated setup state for presentation and feature tests, not simulated progression. Confirm both visible behavior and semantic lab state before moving on. Do not use a full-world boot as the inner development loop for a feature the lab supports.

When the focused behavior is ready, run the automated browser gate:

```bash
npm run lab:test
```

The gate proves representative production-path structure assembly, actor spawning, animation progress, melee feedback, and spell effects in the isolated scene. It is the repeatable acceptance gate for these feature details; interactive lab inspection remains necessary when appearance or readability changes.

Then wire the accepted feature into the final environment and run a shallow integration smoke:

```bash
npm run smoke -- --run runs/corealm
npm run check
```

Final-world coverage should prove loading, wiring, representative interaction, and stable semantic state. It should not duplicate every structure, actor, animation, attack, or spell combination already covered by focused tests and the lab gate.

## Scope boundary

The lab intentionally isolates features from expensive world systems. Passing it does **not** prove:

- terrain placement, biome blending, water, scatter, or world layout;
- navigation meshes, pathfinding, collision integration, or physics behavior;
- quest and skill progression, equipment eligibility or inventory rules, economy, persistence, or simulation rules;
- interactions that depend on several full-world systems at once.

Test those concerns in their focused source tests and with a small number of representative final-world scenarios. In particular, the final world must still prove that earned skill levels and equipped items flow through progression, inventory, and equipment rules correctly. A feature is accepted only when both its lab proof and its relevant integration proof pass.

## Time budgets

These are hard design targets for every testing loop:

| Loop | Target |
| --- | ---: |
| Focused unit or contract tests | under 10 seconds |
| Persistent lab edit feedback | realtime HMR |
| Cold automated lab gate | at most 60 seconds |
| Lab interactions after startup | at most 10 seconds |
| Full-world smoke | at most 2 minutes |
| Entire GitHub CI workflow | at most 5 minutes |

If a loop exceeds its budget, split detailed coverage into focused tests or the lab instead of expanding a full-world matrix. Keep one persistent development server per loop and avoid repeated browser or world startup.

## Evidence and generated files

Lab screenshots, browser reports, traces, and other generated evidence are disposable by default. Keep routine output under ignored test-result locations and overwrite it between runs. Inspect visual output during development, but do not update Markdown, commit screenshots, or create report diffs on every pass.

Promote an artifact into the repository only when it is deliberately selected as durable acceptance evidence or documentation. Record why it is being retained; otherwise the command should leave the tracked worktree unchanged.
