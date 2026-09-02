# Realtime feature labs

The combat and building labs are two modes of the same compact Fallowmarch yard. Both boot through `game/index.html`, the production renderer and `WorldScene`, and the normal asset, material, rig, animation, entity-view, effect, navigation, physics, and input paths. The yard is a 256 m by 256 m plains terrain with gentle relief and a 96 m by 96 m flat central build pad. It keeps edit feedback fast by leaving out the full authored island, persistence, quests, economy, water, biome blending, scatter, and ordinary world content.

The shared setting matters. A structure seen in building mode and an actor or spell seen in combat mode receive the same terrain, daylight, fog, camera stack, and scene treatment. The labs are real game scenes, not separate Three.js turntables.

## Lab-first feature gate

The lab is the default place to build any feature that can be exercised in a compact deterministic scene. Current controls cover structures, characters, creatures, equipment, skills, movement, camera behavior, melee, and spells. New work is not limited to that list. Resources, interactables, pickups, projectiles, UI, inventory, crafting, shops, quest interactions, audio, foliage response, and other local systems should add the smallest fixture or control they need to a lab workbench and use the production implementation there.

Follow this order:

1. Build or update the production module and its focused tests without registering it in authored final-world content.
2. Expose that same production path through a deterministic lab fixture. Do not make a lab-only renderer, rig, effect, interaction, or duplicate data model.
3. Prove the feature through real Chromium actions, semantic state before and after those actions, console checks, and relevant screenshots.
4. Have the root accept the lab proof. A worker's source review or focused test result is not acceptance.
5. In a later integration step, wire the accepted feature into final-world boot, placement, spawn data, authored content, progression, persistence, or cross-system flows.
6. Run a small final-world check for loading, wiring, real data flow, representative interaction, and placement. Fix feature behavior in the lab first, then repeat integration.

If the lab lacks a needed capability, extending the lab is part of the feature. Do not use the full world as a temporary development harness.

The gate may be skipped only when the behavior being built is the authored full world itself and isolation would remove what needs testing. This covers terrain, biome, coast, water, world-scale scatter, world layout, island-scale navigation, and similar spatial integration. Record the exception and its reason in the task and handoff, then follow [the world-authoring workflow](./world-authoring.md). Reusable structures, actors, foliage assets, effects, UI, controls, and local interactions still use the lab whenever they can be separated from world generation.

## Development loop

Start with the smallest loop that can reject a bad change:

```bash
# General unit tests, kept alive while editing
npm run test:watch

# Structure recipes, compositions, collisions, and asset references
npm run structure:contracts:watch

# Whole-catalogue geometry lint: floating, sunken, near-miss and card-thin parts
npm run structure:lint

# Combat mode on the persistent Vite server
npm run lab:preview

# Building mode on the same kind of persistent Vite server
npm run lab:building:preview
```

Both preview commands use port 4174, so run one at a time. You can switch workbenches from inside the lab without restarting Vite. A workbench change updates `mode` in the current URL, preserves every other query parameter and the hash, and performs a full document reload. The destination boots a fresh scene with its own defaults. Runtime state, spawned targets, movement, and unsaved panel setup do not transfer across that reload. Realtime HMR remains active because the Vite server stays running.

### Combat mode

`npm run lab:preview` opens `/index.html?mode=combat`. Use the lab controls to spawn production NPCs and creatures, choose equipment by slot, set presentation-only skill levels, select a spell, and exercise melee and spell effects. A deterministic production bank fixture near the yard spawn can be opened or reset from the Bank workbench. Its contents and carried inventory are published in lab state so transfer behavior can be checked without relying on a save. Walking, ground clicks, target selection, animation, damage, effects, and bank interaction still flow through the production game systems.

Editable skill values and direct equipment choices are test setup. They do not simulate progression, item eligibility, inventory acquisition, or persistence.

### Building mode

`npm run lab:building:preview` opens `/index.html?mode=building`. The building controls can select a prefab, composition, or wall run; change the plaster, timber, or stone regional kit; edit supported dimensions; step through variant seeds; and fit the production camera to the result.

Prefab width and depth are whole metres from 2 through 30. Compositions have authored dimensions, so their size controls are disabled. Wall runs follow the production two-metre module grid. Their total width is an even value from 6 through 30 m. The field labelled `Opening` is also even, starts at 2 m, and stops at `width - 4`, leaving at least one two-metre wall module on each side. Dimension values entered in the panel or URL are clamped and snapped to these supported ranges before a recipe runs.

### Production structure and collision path

Prefabs, compositions, and wall runs use the production recipes. Recipe parts become the same semantic structure entities consumed by the normal `EntityViews` renderer, with the selected regional material context. A composition can also have a separate semantic hero asset that its authored world recipe expects, such as the arch paired with a region gate. The lab adds that hero beside the composition dressing instead of showing the dressing alone.

Prefab and wall-run collision comes from their production collision recipes. Composition collision is measured from collidable recipe parts and any solid hero asset. On every rebuild, the lab prepares assets through `EntityViews`, replaces the semantic structure entities, refreshes obstacle-carve objects, rebuilds the terrain heightfield and static physics boxes, and gives direct movement the resulting production solids. The browser gate checks emitted collision metadata and a ready debug state. It does not prove that each replacement carve was baked into the navmesh or that every collision face blocks the player.

The published `partCount` is the number of rendered semantic structure entities, including a separate composition hero when one exists. `collisionCount` is the number of emitted solid volumes. Neither value is a visual-quality judgment.

### Building view controls

Building mode has three independent checkboxes. Its defaults are player visible, `Walk in yard` off, and `Free camera` off.

- `Player visible` changes only whether the production player rig is drawn. It does not move the player, change walking, or change the camera mode.
- `Walk in yard` controls player movement input. When it is off, the input controller stops any current route, clears held movement keys, and ignores WASD, arrow-key movement, ground-click movement, and `Walk here`. Hover, selection, inspection, camera gestures, and panel keybindings remain available. When it is on, normal camera-relative WASD, arrow controls, and click-to-move are active.
- `Free camera` detaches camera focus from the player without moving or hiding the player and without changing walking. Right-drag orbits, middle-drag pans, and the wheel zooms. Turn it off to return to the normal player-follow camera.

The controls may be combined. For a normal game-scale check, leave the player visible, turn walking on, and keep the follow camera. For structure inspection, turn free camera on, then hide or show the player as a scale reference without changing the camera focus. Walking can remain on while the camera is detached, although the camera does not follow the moving player in that combination.

Rebuilding a structure stops movement and resets the player to the yard spawn. In free-camera mode, `Fit structure` targets the rendered structure bounds without relocating the player. With free camera off, the normal player-follow camera owns focus.

A structure rebuild preserves the selected workbench and publishes its normalized selection, revision, bounds, entity count, asset count, collision count, build time, and errors through `window.__featureLab`.

The old `npm run structure:preview` command and `structure-preview.html` route remain compatibility entry points. They forward into the production building mode instead of booting a separate renderer. Direct `mode=actors` and `mode=structures` queries remain aliases for combat and building respectively.

## Geometry lint and the structure sweep

Two commands sit between the focused tests and the browser gate. Neither renders anything the game
needs; both are review instruments and their output is disposable.

```bash
# Every recipe, every shipped footprint, kit and variant seed, measured against the GLB manifest
npm run structure:lint
npm run structure:lint -- --only "composition region_gate" --kind FLOATING

# Photograph the whole catalogue in the building lab, four orbit poses each
npm run structure:sweep
npm run structure:sweep -- --out test-results/my-sweep --group composition --angles a-front,c-eye
```

`structure:lint` turns every `PartPlacement` into a world-space box using each asset's measured
`size` and `base`, then reports the defects that need no opinion: a connected group of parts that
never reaches the ground (`FLOATING`), a part drawn entirely under the ground plane (`SUNKEN`), two
load-bearing pieces that line up on two axes and stop short on the third (`NEAR_MISS`), a
near-zero-thickness plane used where the recipe wants mass (`THIN_PLANE`), stacked duplicates
(`DUPLICATE`), and assets the manifest does not ship (`MISSING_ASSET`). Contact is decided on the
axis-aligned envelope of each rotated box, so it is deliberately generous and will not claim a gap
a rotated part actually closes. Composition dressing is linted together with the hero mesh the
world pairs it with, because half of a composition leans on that hero.

`tests/structure-geometry.test.ts` runs the same checks as a contract, with one documented
allowlist entry: `vault_door` is authored against the Coldbrace vault tower, which is a separate
building, so its braziers and banners have nothing behind them in isolation.

`structure:sweep` boots one Vite server and one Chromium page in `mode=building` and walks the
whole prefab-variant, composition and wall-run space through `window.__featureLab`, capturing four
poses per selection into `test-results/structure-sweep/` plus a JSON manifest of bounds, part
counts, collision counts and errors. `--shard 2/4` lets several sweeps share one output directory;
keep the shard count low, because each shard is a full software-rasterised renderer.

Note which way the lab faces. `fitStructure` frames from `bounds.min[2]`, the **-Z** side. Closed
prefab rings enter at -Z, so that is their door; `forge`, `porch`, `arcade` and every composition
author local **+Z** as their approach, so for those the fitted view is the back and the sweep's
`b-rear` capture is the front.

## Browser gate and shared-state proof

When focused behavior is ready, run the self-contained Chromium gate. The default command keeps
the combined local loop, while CI runs three focused shards so a slower software renderer does not
consume one shard's 60-second budget before the next proof starts:

```bash
npm run lab:test
npm run lab:test -- --shard building
npm run lab:test -- --shard navigation
npm run lab:test -- --shard combat
```

Each invocation starts one Vite server and one Chromium session. Together the shards cover the combat route, building route, mode navigation, and legacy redirect, and prove that both labs report `engine: "corealm-production"` and the same `fallowmarch-yard` identity. Combat coverage checks the production canvas and debug state, actor rigs and animation progress, a direct equipment change, pointer selection, repeated route-failure reporting, melee damage and motion, spell particles and damage, and the production bank panel. The bank proof opens the fixture through the real interaction dispatcher, checks the 1 / 5 / 10 / All / X quantity modes, transfers five items in both directions, filters by item name, and deposits all carried fixture items. Building coverage boots a production prefab through the compatibility route, changes it to a wall run through the real authoring panel, checks collision output and revision changes, walks through real keyboard input, suppresses keyboard movement when walking is off, and orbits and fits the free camera without moving the player. Focused structure tests cover the full prefab, composition, kit, and wall-run catalogue.

The navigation shard treats the mode selector as navigation, not an in-place state mutation. It records the current query and hash, switches from building to combat, waits for the document and `window.__featureLab` to load again, then checks the canonical destination `mode`, preserved URL fields, shared-yard identity, and fresh combat defaults. Both options use the same navigation path, while the building-route readiness check locks its defaults to player visible, walking off, and free camera off.

The building and navigation shards enter through `structure-preview.html`. The page preserves `kind`, `id`, `kit`, `width`, `depth`, `seed`, extra query fields, and the hash; changes the mode to `building`; and redirects to `game/index.html`. The gate confirms that the production lab and debug APIs replace the retired `window.__structurePreview` runtime. The combat shard boots the combat route directly so its detailed interaction proof has a separate 60-second budget.

These checks do not replace visual review. The automated gate records semantic and timing evidence, but it does not compare pixels, inspect screenshots, or maintain visual baselines. Inspect the live scene and the generated screenshots when structure readability, equipment silhouettes, animation, melee timing, spell contrast, framing, or ground contact changes.

Only after root lab acceptance, wire the feature into the final environment and run a shallow integration smoke:

```bash
npm run smoke -- --run runs/corealm
npm run check
```

Final-world coverage should prove loading, wiring, representative interaction, and stable semantic state. It should not repeat every structure, actor, attack, or spell combination already covered by focused tests and the lab gate.

## Scope boundary

The current labs intentionally omit expensive world systems. Add deterministic fixtures for isolatable feature logic and presentation rather than treating these omissions as permanent exceptions. Passing the labs does **not** prove:

- final-world terrain placement, biome blending, water, scatter, or world layout;
- the island navigation mesh, long-distance pathfinding, final collision integration, or final-world physics behavior;
- final progression, equipment eligibility, inventory acquisition, economy, persistence, or simulation integration;
- interactions that depend on several full-world systems at once.

Building-lab walking and free camera are presentation and local input checks. The gate proves that real keyboard input moves the player only when walking is enabled, and that free-camera orbit and fit can change framing without moving the player. It also checks that the selected structure remains stable and the prefab and wall run emit non-empty collision metadata. It does not walk the player into a wall, through an opening, or around every recipe. It does not prove replacement navmesh carving, collision blocking, final-world navigation, physics, terrain placement, or collision behavior. Test those systems in their focused source tests and with a small number of representative final-world scenarios.

Use lab fixtures to prove the local logic, UI, and interactions for progression, inventory, equipment, quests, economy, persistence, and simulation work. The final world must still prove that real authored data and cross-system flows connect correctly. A feature is accepted only when its lab proof and relevant integration proof both pass.

## Time budgets

These are hard design targets for every testing loop:

| Loop | Target |
| --- | ---: |
| Focused unit or contract tests | under 10 seconds |
| Persistent lab edit feedback | realtime HMR |
| Combined labs and legacy redirect gate | at most 60 seconds |
| Lab interactions after startup | at most 10 seconds |
| Full-world smoke | at most 2 minutes |
| Entire GitHub CI workflow | at most 5 minutes |

Every `npm run lab:test` invocation owns one 60-second end-to-end deadline, including server startup,
its selected lab modes, screenshots, and compatibility routing. CI runs the building, navigation, and
combat shards as separate loops; it does not expand any deadline.

If a loop exceeds its budget, split detailed coverage into focused tests or the labs instead of expanding a full-world matrix. Keep one persistent development server per loop and avoid repeated browser or world startup.

## Evidence and generated files

The combined gate overwrites four ignored screenshots under `test-results/feature-labs/`:

- `bank-transfer.png`
- `combat-melee.png`
- `combat-spell.png`
- `building-authoring.png`

All four capture calls must succeed, but the gate does not decide whether the scene is readable. State and camera probes can show that framing changed, but they do not prove that the player, structure, or camera composition looks correct. The gate does not clean the directory, so these fixed names are overwritten while unrelated stale files remain. The gate prints its JSON result to stdout and does not write a durable report, trace, or pixel baseline. The legacy redirect step does not capture a separate screenshot.

Lab screenshots, browser reports, traces, and other generated evidence are disposable by default. Keep routine output under ignored test-result locations and overwrite it between runs. Inspect visual output during development, but do not update Markdown, commit screenshots, or create report diffs on every pass.

Promote an artifact into the repository only when it is deliberately selected as durable acceptance evidence or documentation. Record why it is being retained. Otherwise the command should leave the tracked worktree unchanged.
