# Corealm — game brief

> Historical intake brief. The approved August 30, 2026 magic amendment in `PRD.md` supersedes
> this file's original nine-slot/staff/shard assumptions: the shipped contract has ten equipment
> slots including `focus`, pack-backed wands and staffs, singleton elemental orbs, and typed essence.

## One line

A persistent 3D browser RPG with classic-MMO progression clarity, where an AI agent can play the same character through the same semantic actions a human uses — and building a better agent is itself part of the game.

## Why it exists

Two audiences, one simulation:

- **Human players** get a readable, explorable, skill-driven RPG in the tradition of old-school MMORPGs: gather, produce, fight, quest, bank, unlock stronger content.
- **AI agents** get semantic, player-equivalent control of the *same* character through a WebMCP tool surface. No privileged automation, no god-mode scripting. An agent must genuinely play.

The defining idea: **a classic progression RPG where designing and optimizing the AI that plays alongside you is part of the game.** A well-built agent uses fewer observations, fewer tokens, better routes, better memory, and better planning to reach the same goal.

All content is original — world, names, lore, characters, quests, XP curve, formulas, items, enemies, visual identity.

## Product pillars

1. **Classic readable progression.** A player can see at a glance what they can use, what they can gather, where stronger content is, and why a new tier matters.
2. **Dense explorable world.** Regions are authored, not filler. Travel, banks, resources, shortcuts, enemies, and geography create real route choices.
3. **Interconnected skills.** Gathering feeds production; production feeds combat and exploration; combat and exploration consume and reward both.
4. **Agent-native gameplay.** Agents are players, not scripts.
5. **Agent optimization as metagame.** Efficiency differences between strategies must be real and measurable.
6. **Strong visual consistency.** A coherent stylized low-poly language with clear silhouettes and high gameplay readability.

## Skills — exactly 11, each 1–99

**Combat:** Melee (physical accuracy, damage, defense, equipment requirements), Magic (spells, magic gear, magical accuracy and effect, utility magic). Health is a *derived* attribute, not a skill.

**Gathering:** Mining (ores, stone, gems), Woodcutting (logs, specialty wood), Fishing (fish, aquatic materials), Farming (crops, herbs, fibers, ingredients).

**Production:** Smithing (ores/bars → melee gear, tools, components), Crafting (accessories, magic gear, cloth/leather, utility items), Cooking (healing food, meals, selected buffs), Fletching (precision woodworking: shafts, handles, staves, tool and fishing components, wooden equipment).

**Utility:** Agility (shortcuts, climbs, gaps, tunnels, alternate routes, dungeon passages) — must become one of the most strategically useful skills for route optimization.

## Progression model

Every skill runs 1–99. Major content tiers: **1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99**. Levels between tiers give incremental improvements.

Design an original exponential XP curve totalling roughly **10 million XP at level 99**. The complete XP table is canonical content data.

Content is built from **reusable archetypes × tier material profiles** (e.g. `sword` archetype at tier 1/5/10/…/99). The same approach covers ores, nodes, trees, logs, fish, crops, tools, weapons, armor, magic gear, staves, food, components, and selected enemy families. A tier variant may change material, palette, stats, requirements, name, value, recipe, attachments, and VFX — but retains visual ancestry, and tier must be obvious from normal gameplay camera distance.

## World

A single connected progression world. Regions stay physically explorable; difficulty is the primary soft gate. Explicit requirements gate only meaningful content (quests, dungeons, special locations, Agility shortcuts, major encounters).

Regional progression (original names required; escalating from grounded medieval fantasy toward the supernatural):

| Tier | Direction |
| --- | --- |
| 1 | Frontier plains |
| 5 | Deep woodland |
| 10 | Stone highlands |
| 20 | Ember foothills |
| 30 | Marshlands |
| 40 | Frozen north |
| 50 | Desert |
| 60 | Storm coast |
| 70 | Corrupted / haunted wilds |
| 80 | Volcanic wastes |
| 90 | Arcane / astral lands |
| 99 | The Core — final realm |

World authoring is code/data driven. **Semantic placement** for settlements, banks, shops, quest NPCs, roads, bridges, landmarks, mines, farms, fishing spots, dungeons, bosses, Agility shortcuts, and important resources. **Deterministic procedural composition** (seeded, biome masks, splines, Poisson-disc, density maps, exclusion zones, clusters) for vegetation, rocks, minor props, repeated architecture, and terrain dressing. Procedural work amplifies intentional design; it does not replace it.

Each region needs a recognizable silhouette, meaningful landmarks, clear travel routes, its own density and topology, distinct resource distribution, and distinct atmosphere.

## Core systems

- **Controls:** click-to-move over a real navmesh *and* direct keyboard movement. Elevated third-person classic-MMO camera with rotation, zoom, smooth follow. Hover feedback, selection feedback, target indicators, contextual actions. Readable, not twitch-oriented.
- **Inventory:** 28 slots. Stacking only where it fits naturally (currency, small components). Ores, logs, fish, and equipment consume real slots, so capacity drives route and preparation decisions.
- **Banking:** large persistent storage with deposit, withdraw, quantity selection, deposit-all, search, filter. Banks are geographic anchors; distance to training spots is an efficiency lever.
- **Equipment:** head, body, legs, feet, hands, main hand, off hand, accessory 1, accessory 2. Progression from skill × tier × archetype. Melee and Magic have visually distinct identities.
- **Economy:** one primary currency, entering via quests, combat, and selling resources or crafted goods. Shops provide baseline goods; player-made items stay economically useful.
- **Gathering:** one interaction starts a *continuing* activity — walk into range, gather repeatedly, yield over time. It ends on depletion, full inventory, movement, combat, or cancel. A WebMCP call starts exactly the same activity as one human click.
- **Resource durability:** nodes give multiple yields (roughly 8–15 low tier, 6–12 mid, 4–10 high — balance by playtest), visibly change to a depleted state, and respawn on a timer. Clusters should create circuits where early nodes respawn as later ones deplete.
- **Farming:** persistent across sessions — seed → prepare plot → plant → grow → harvest. Debug-only time controls for deterministic tests.
- **Production:** Smithing, Crafting, Cooking, Fletching from canonical recipe data (ingredients, skill, level, duration, output, quantity, XP). Batch quantities and clear progress feedback.
- **Combat:** Melee and Magic. Readable MMO pacing; starting an attack continues auto-attacks. Decisions are target, gear, food, spell, positioning, retreat, and encounter mechanics. Enemies gain interesting behavior with tier. Bosses use telegraphs, movement zones, phases, hazards, timing windows, and resource pressure. Must work identically through human input and semantic agent actions.
- **Health and death:** health derived from progression and equipment. Death keeps permanent progression but drops carried items into a recoverable container with a reasonable recovery window — consequential, but experimentation stays practical.
- **Quests:** the most authored content. Worldbuilding, characters, exploration, puzzles, skill introductions, humor, shortcuts, equipment, dungeon access, bosses, regional storylines. Support local, skill, puzzle, dungeon, regional-chain, and multi-region-chain structures. Full game targets ~35–45 meaningful quests; prefer fewer memorable ones over repetitive tasks.
- **Persistence:** skills, XP, inventory, equipment, bank, currency, quests, farming state, discovered locations, settings — browser-local for this roadmap, behind a clean typed service boundary.

## Semantic game model

Every meaningful world object has a semantic entity independent of its Three.js mesh:

```ts
{
  id: "ore_t10_0042",
  archetype: "ore",
  tier: 10,
  regionId: "highlands",
  position: [x, y, z],
  state: "available",
  requirements: { skill: "mining", level: 10 },
  interactions: ["inspect", "mine"],
  resource: { remaining: 9, respawnSeconds: 28 }
}
```

Semantic entities power gameplay, interaction, quests, AI, WebMCP, UI, overlays, persistence, and Playwright testing. **Renderers consume semantic state; they never own it.**

A canonical content layer (schema-validated TS/JSON) defines tiers, XP, skills, items, equipment, resources, recipes, spells, enemies, NPCs, dialogue, quests, regions, and shops — and feeds runtime, UI, documentation, agent knowledge, and tests from one source.

## Agent interface

Architecture:

```text
Canonical Game API
    ├── Human UI
    ├── Internal AI
    └── WebMCP adapter
```

Research the current official WebMCP specification and browser implementation before building the adapter.

Design a **small, consolidated** tool set (not one tool per bullet) covering: state inspection (player, skills, inventory, equipment, activity, quests); world observation (nearby entities, inspect entity, search known information); navigation to entities or known destinations *through the real navmesh at normal game speed*; interaction (interact, use, equip, unequip); combat (attack, cast); NPCs (talk, choose dialogue option); economy (bank deposit/withdraw, shop buy/sell); assistance overlays (highlight, render path, clear); documentation search; and event/state synchronization (wait for change).

**Agent parity:** every WebMCP action maps to an action a human has. One agent call starts the same continuous activity one human click starts. Multi-step objectives stay agent decisions. Given "raise Mining from 20 to 30," the agent must itself choose ores, choose a location, navigate, mine, react to depletion, react to a full inventory, find a bank, travel, deposit, return, and repeat.

**Events:** expose meaningful state changes (navigation completed/failed, activity started/stopped, resource depleted, inventory full, combat started/ended, low health, item received, level gained, quest updated, dialogue opened, death). Events report; agents decide. This makes token efficiency a real engineering choice instead of forcing polling.

**Information parity:** agent knowledge follows the player discovery model. Separate currently-observable entities, discovered map locations, documented public knowledge, hidden quest information, and undiscovered secrets. Semantic clarity without leaking hidden state.

**Optimization metagame:** the world should naturally create cases where the highest-tier activity is not the most efficient one — e.g. tier 50 ore with high XP but a long bank route versus tier 40 ore with a short one, and an Agility shortcut that later reverses the comparison.

## Assistance overlays

A RuneLite-style overlay system: highlighted entities, resource outlines, NPC markers, world-space labels, destination markers, route lines, quest targets, interaction requirements, hazard markers. Agents can drive these overlays, producing an adaptive AI-generated assistant experience.

## Internal AI

An internal AI interface on the same semantic layer, with three modes: **Assist** (answer questions, inspect state, search docs, highlight, show routes), **Copilot** (perform individual requested actions), **Autonomous** (pursue multi-step objectives via normal semantic actions). Keep model integration thin and configurable. WebMCP remains the canonical external interface.

## Documentation as a feature

Generate human-readable docs from canonical content wherever practical: full XP table, skill guides, item encyclopedia, equipment requirements, resource info, recipes, region info, spells, enemies, quest reference. Ship a searchable machine-readable version for agents, exposed through WebMCP search.

Ship developer documentation for the agent interface — tools, schemas, return values, events, errors, entity types, activities, navigation, combat, inventory, banking, quests, overlays, doc search — with complete example workflows and token-efficient agent patterns. **A developer unfamiliar with Corealm should be able to write a functional autonomous player from the documentation alone.**

## Visual direction

Style target sits between polished Synty-like low-poly and the readability of classic RuneScape: clean shapes, simple surfaces, restrained PBR, readable colors, strong silhouettes, clear paths, elevated classic-RPG camera, modest foliage density, visually obvious resources and interactables.

Assets come from the **free Quaternius ecosystem** — Medieval Village MegaKit, Stylized Nature MegaKit, Fantasy Props MegaKit, Universal Base Characters, Modular Character Outfits: Fantasy, Universal Animation Library 1 and 2, plus compatible free packs for monsters, crops, food, animals, fish, ruins, dungeons, structures, weapons, and environmental objects. Maintain `game/public/assets/manifest.json` with asset ID, local file, original pack, source, license, category, tags, dimensions, animations, and material info.

Build a Corealm-specific material system on top of these meshes and use tier-specific materials extensively. Quaternius is the primary visual language through tier 70; paid/source assets and heavier VFX arrive only in the final endgame phase.

## Technical constraints

TypeScript, Vite, Three.js, Rapier, recast-navigation, GLB/glTF, HTML/CSS UI, Playwright. The game stays a normal Vite app and never imports the build harness. Semantic TypeScript state and services are the source of gameplay truth; Three.js renders that state.

Representative scenes should hold smooth 60 FPS on a modern gaming desktop, measured in a real browser.

## Roadmap

Three phases, each ending at a gate, each starting from a *proven* previous build rather than speculative parallel content.

- **Phase 1 — prove Corealm.** Tiers 1, 5, 10. Three connected polished regions (frontier, woodland, highlands). Free Quaternius assets only.
- **Phase 2 — build the main game.** Tiers 20–70, six more regions, scaling proven systems. Ends with an art-gap report.
- **Phase 3 — endgame.** Tiers 80, 90, 99, using paid/source assets chosen from that report. The endgame must visually and mechanically exceed everything before it.

## This build run executes Phase 1

**Content scope:** tiers 1, 5, 10 only. **Architecture scope:** capable of the full 1–99 game.

Three connected regions:

1. **Tier 1 frontier** — primary starting settlement with bank, shops, smithing, crafting, cooking, a farm, nearby forest, mine, fishing, starter enemies, quests, Agility interactions.
2. **Tier 5 woodland** — denser wilderness, tier 5 resources, stronger enemies, stronger equipment, new quests, route choices, more production opportunities.
3. **Tier 10 highlands** — tier 10 resources, stronger combat, meaningful verticality, Agility shortcuts, a dungeon, a boss, a larger quest chain.

Phase 1 implements the **real architecture for all 11 skills** plus movement, camera, click-to-move, navigation, collision, semantic entities, inventory, equipment, bank, currency, shops, gathering with depletion and respawn, production, combat, enemies, loot, health, death and recovery, NPCs, dialogue, quests, dungeon, boss, persistence, documentation, WebMCP, agent events, and overlays.

Build vertically. Each proof must work in the browser before scaling:

1. Player loads, moves, navigates, interacts; world renders coherently with real assets and working collision/navigation.
2. One full gathering loop: navigate → mine → gather several ore → gain XP → deplete node → bank.
3. One full production loop: resources → production → equipment or consumable → XP.
4. One full combat loop: equip → engage → take and deal damage → eat → kill → loot.
5. One quest from start to reward.
6. The same kinds of actions through the semantic agent interface.
7. All Phase 1 systems and content integrated.

**Quests:** roughly 8–12 complete quests, at least one substantial multi-stage chain that an external AI agent can complete end to end.

### Phase 1 gate

- A new human player can naturally progress through tiers 1, 5, and 10, and the loop *explore → gather → craft/fight/quest → improve → unlock* is understandable and enjoyable.
- All 11 skills gain XP, level, unlock content, and integrate with surrounding systems.
- The three regions use real free Quaternius assets, look coherent, contain meaningful landmarks and useful paths, show readable resources and interactions, and feel intentionally designed.
- Nodes yield repeatedly, deplete, respawn, and create meaningful route choices.
- Inventory, bank, shops, production, equipment, and currency form a coherent economic loop.
- Melee and Magic are both useful; at least one normal enemy group and the tier 10 boss give meaningful combat.
- ~8–12 complete quests including one substantial multi-stage quest.
- **Agent proof:** an external AI raises Mining from level 1 to 10 and banks the materials through legitimate actions.
- **Agent quest proof:** an external AI completes one substantial multi-stage quest through the semantic action interface.
- The interface supports efficient event-driven agents while preserving normal game actions.
- A browser reload retains character progression correctly.
- Typecheck, build, smoke test, scripted playtests, screenshots, and a fresh critic review all pass, with blocking and high-priority findings resolved.
- Representative scenes measure smooth 60 FPS in a real browser.

Deterministic Playwright scenarios must cover movement, click-to-move, camera, all 11 skills, inventory, banking, shops, death and recovery, quests, dungeon and boss, persistence, and semantic agent actions — each comparing `window.__gameDebug` state before and after. Repeatable screenshots must cover spawn, town entrance, town center, bank, forest, mine, farm, fishing area, woodland, highlands, dungeon entrance, dungeon interior, normal combat, boss, inventory, skills, quest/dialogue, and representative overlays.

Phase 1 ends with `runs/corealm/phase1-report.md`: systems implemented, asset packs used, content counts, quest count, test evidence, screenshots reviewed, performance, WebMCP capabilities, known medium and low issues, and Phase 2 readiness.
