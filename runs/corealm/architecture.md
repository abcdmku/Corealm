# Corealm — final architecture (root)

Status: **PRD approved with the corrections below.** `runs/corealm/PRD.md` is authoritative for
content, formulas, names, and numbers. This document is authoritative wherever the two disagree.

I verified the PRD's arithmetic before approving. Recomputed independently and matching:

- `totalXpAt(L) = floor(873 * 1.1^(L-1) - 873 + 6*L*(L-1))` → L2 = 99, L10 = 1,725, L50 = 106,992,
  L92 = 5,151,454, **L99 = 9,999,879**. All 98 increments strictly positive. L92 is 51.5% of L99.
- `maxHit = floor(2 + (melee + gearPower)/4.2)` reproduces every row of its table (2/3/6/10/17/40/73).
- `maxHealth = 20 + 3*max(1, floor((melee+magic)/2)) + vitality` reproduces 23/41/58/75/210/407.
- `yieldXp = round(10 * tier^0.55)` → 10/24/35/86/125 and the XP/hr column at 0.30 success × 1800 ms.
- `respawnSeconds = round(18 + 3.2*tier^0.9)` → 21/32/43/126/218.

The curve is a closed form, so `xpForLevel` is O(1) with no summation table. Keep it that way.

---

## 1. Root decisions on the PRD's open questions

### Approved as proposed

**The three simplifications.** All three are correct readings of the brief.

1. *No separate Defence skill.* The brief assigns Melee "physical defense effectiveness" and fixes
   the skill count at 11. Melee is physical defence, Magic is magical defence.
2. *Death drops inventory, not equipment.* The brief says "a recoverable death-container system for
   **carried** items". Worn gear is not carried inventory. This also keeps the agent recovery loop
   testable.
3. *Magic consumes Essence Shards.* Uncosted magic dominates melee at every tier. Shards come from
   Crafting (gem + log) and shops, which wires Magic into Mining and Crafting. Good design, keep it.

**All six cuts.** Each is outside the Phase 1 gate in the brief's §43.

One cut needs to be stated plainly rather than buried: **the internal AI (Assist / Copilot /
Autonomous) is deferred to Phase 2.** The brief describes it as a product feature, but the Phase 1
system list and the Phase 1 gate both omit it, and the gate proves agent capability through an
*external* agent over the semantic interface. `GameApi` is the seam it will attach to, so deferring
costs no rework. This is recorded as a known deferral in the phase 1 report, not as an oversight.

### Corrections I am making

**R1 — `__gameDebug` must match the real harness exactly. (Fixes assumption A1, the PRD's
highest-risk item.)** The PRD agent was told not to read `tools/` and guessed the nine method names.
It guessed wrong. The harness in `tools/lib/driver.ts` and `tools/smoke-test.ts` requires exactly:

```ts
getState(): { ready?: boolean; [k: string]: unknown }
getPlayer(): unknown
getPlayerPosition(): unknown
getCamera(): unknown
getEntities(): unknown
getCurrentActivity(): unknown
getObjectives(): unknown
getNavigationState(): unknown
reset(): void
```

Non-negotiable properties, each read off the harness source:

| Requirement | Why |
| --- | --- |
| All nine are **synchronous** | `driver.snapshot()` calls all eight getters inside a single `page.evaluate` and JSON-serialises the result. A Promise serialises to `{}`. |
| All nine are **JSON-safe** | `callDebug` does `JSON.parse(JSON.stringify(fn(...) ?? null))`. No cycles, no class instances, no `undefined`-only fields, no `Map`/`Set`. |
| `getState().ready === true` gates boot | `driver.open()` polls `window.__gameDebug?.getState().ready === true`. Install `__gameDebug` **early** with `ready: false`, flip it after boot, so there is no undefined-window race. |
| `getPlayerPosition()` returns `{ x, y, z }` | `smoke-test.ts`'s `point()` requires numeric `.x/.y/.z`. Contracts use `Vec3 = readonly [number,number,number]` internally; the debug layer converts at the boundary. Do not change `Vec3`. |
| `getNavigationState().status === "ready"` | `navigationReady()` checks that literal string. |
| `reset()` takes effect within ~150 ms and is not awaited | The driver calls it then waits 150 ms. It must restore the player to within **0.05 m** of the initial position and produce a **byte-identical** `getObjectives()` JSON. Make reset synchronous; do async teardown behind it. |
| The player must move > 0.1 m from `click(640,360)` + `press("w", 700)` | Smoke check `inputChangesState`. Spawn framing must put screen centre on walkable ground, and no modal may be open at spawn that swallows `w`. |
| `getState()` puts volatile per-frame data under exactly `clock` and `renderer` | `play-game.ts`'s `semanticFingerprint` deletes those two keys before diffing. Anything volatile placed elsewhere makes every scenario step report `changed: true` and destroys the signal. |

The PRD's own additions (`ready()`, `getVersion()`, `setPaused()`, `step()`, `getMetrics()`,
`getErrors()`, `waitForIdle()`) and all 24 game-specific helpers stay — as **additional** methods
alongside the nine. The harness ignores extras.

Acceptance criteria in PRD §8 that call `ready()` are rewritten to `getState().ready`.

**R2 — Agility shortcuts are route-graph edges, not navmesh off-mesh links. (Fixes assumption A3.)**
The PRD assumed Detour off-mesh connections. `@recast-navigation` exposes `DetourOffMeshConnection`,
but `threeToSoloNavMesh` gives no supported path to author them, and if they misbehave the route
flip in §2.8 disappears — which would remove a product pillar on a library detail. So:

- The navmesh handles ordinary walking only.
- Every Agility obstacle is a semantic entity with the `obstacle` field the contract already
  defines: `{ reqLevel, exitPosition, durationMs, savesMeters }`. Traversal is: path to the entrance
  on the navmesh → play the climb/vault clip for `durationMs` → place the player at `exitPosition`
  on the navmesh. Interruptible, and it fires real events.
- A thin **route graph** sits above the navmesh: nodes are key locations (banks, seams, camps,
  region gates), edges are either a navmesh path (cost = path length ÷ 4.2 m/s) or a shortcut
  (cost = walk-to-entrance + `durationMs`, gated on `reqLevel`). `moveTo({ locationId })` and the
  agent's navigation planning run Dijkstra over this graph, then walk each leg.

This is simpler, fully testable through `getNavPath` and `getNavigationState`, and it makes the
§2.8 flip a property of *data* rather than of Detour's internals.

**R3 — Tier 1 yield floor is 8, not 9.** The brief's band is 8–15 at low tier. Use
`yieldRange(tier) = [max(4, round(8.5 - 0.052*tier)), max(8, round(15 - 0.052*tier))]`, giving 8–15
at tier 1, 8–15 at tier 5, 8–14 at tier 10, 6–12 at tier 50, 4–10 at tier 99. Matches the brief's
three bands exactly.

**R4 — Contradiction C1 resolved as the PRD read it.** Phase 1 builds every system's *architecture*
at tier 1/5/10 content depth. Content breadth is Phases 2 and 3. This is what "prove Corealm" means
and it is what the gate checks.

**R5 — Contradiction C4 accepted as designed.** The 3-node Upper Karrow seam that genuinely runs dry
above Mining 20 is the right answer. Do not double respawn timers globally; that would flatten every
cluster into the same shape and make §2.8's numbers wrong.

**R6 — Draw-call discipline is a build-round exit condition, not a hope. (Fixes assumption A6.)**
Budget is < 400 draw calls and ≥ 55 FPS at every screenshot pose. Enforcement:

- Scatter (trees, rocks, grass, props) renders through `InstancedMesh`, keyed by
  (asset, material variant). Tier material variants must be **`MeshStandardMaterial` colour/roughness
  swaps over a shared base texture**, not distinct textures, or instancing fragments 36 ways.
- Full modular characters cost ~27 k triangles across 10 skinned meshes each (measured, see
  `stack-findings.md` §7). Cap simultaneously visible dressed characters, and merge parts for NPCs
  that never change equipment.
- Round 1 measures this with real canopy density **before** round 5 adds quest props.

---

## 2. Layering

One rule decides most questions: **semantic state is the truth, Three.js is a view of it.** Nothing
in `render/` may own gameplay state, and nothing in `systems/` may read from the scene graph.

```text
content/          static, validated, immutable. tiers, XP, items, recipes, enemies, quests, regions.
   |
state/store.ts    the single mutable canonical state. plain JSON-safe data.
   |
systems/*         pure-ish tick functions: (state, dt) -> state mutations + events.
   |
api/gameApi.ts    THE only write path. validates, calls systems, returns Result<T>, never throws.
   |
   +---- ui/*                human panels and input
   +---- agent/tools.ts      the 16 tools  ---> agent/webmcp.ts (thin adapter)
   +---- debug/gameDebug.ts  test surface
   |
render/*          reads state, draws it. owns no gameplay truth.
```

`GameApi` being the sole write path is what makes agent parity real rather than claimed: a human
click and a WebMCP call reach the identical function. PRD acceptance criterion F11 tests exactly
this by running the same action both ways and diffing state. If any UI panel writes the store
directly, that test is meaningless — so it is a review item on every round.

## 3. Boot order

Fixed, because two WASM modules and the navmesh have hard ordering (verified in `stack-findings.md`):

1. Install `window.__gameDebug` with `getState() => { ready: false }`.
2. Load and validate content. A content validation failure is fatal and surfaces in `getErrors()`.
3. `await RAPIER.init()`.
4. `await initRecast()`.
5. Create renderer, scene, camera, lights.
6. Load `assets/manifest.json`, then the GLBs it names. Animation libraries load **once** as a
   shared clip library.
7. Build region geometry and collision from `content/regions.ts`.
8. Generate the navmesh from the walkable meshes now in the scene.
9. Build the route graph over the navmesh.
10. Construct semantic entities, then their views.
11. Load the save, if any, and apply migrations.
12. Start the loop; flip `getState().ready` to `true`.

## 4. Simulation

Fixed 100 ms sim tick with an accumulator, decoupled from render. Combat resolves on a 600 ms
cadence (every 6th sim tick); gathering on 1800 ms. Render interpolates. Determinism comes from
seeded RNG streams — one per concern (gather, combat, loot, scatter) so that consuming a combat roll
cannot shift a scatter layout. `setSeed` + `setPaused` + `step` gives reproducible tests.

Update order is PRD §3. The one ordering that matters and must not be reordered: **events flush
last**, after quests, so a `level.gained` and the `quest.updated` it triggers land in the same tick
in causal order.

## 5. Persistence

`persistence/storage.ts` is a typed service over `localStorage` with a version integer and
`migrate.ts`. Node state and discovery persist as **deltas against content defaults**, not as one
entry per entity — this is the fix for assumption A7 and keeps a full save well under 100 KB.

## 6. Agent interface

Per `webmcp-research.md`: `CorealmAgentApi` is plain TypeScript over `GameApi` and is always exposed
at `window.corealm.agent`. `agent/webmcp.ts` registers the same tool table onto
`document.modelContext` (current spec) or `navigator.modelContext` (vendor spelling), and installs a
local polyfill when neither exists so the registration path stays exercised and testable. The
browser API is a *view*, never a second implementation. `__gameDebug.callTool` invokes the same
table with no WebMCP involvement, which is how parity is tested in this Chromium build.

Events are a monotonic ring buffer with cursor + long-poll (`events(sinceSeq, filter, timeoutMs)`),
so a good agent never polls. Discovery gating lives in `api/observation.ts`: `scope: "visible"`
returns what the player can currently see, `scope: "known"` returns discovered locations. Hidden
quest state is never observable.

## 7. Build order

Round 0 is root-only and ends at a passing `npm run smoke`. The **first playable proof** is the PRD's:
path to a Grithe node over the real navmesh, gather four ore one at a time, hit Mining 2 at 99 XP,
deplete the node, walk back, bank it — and get an identical result through
`callTool("corealm_interact", ...)`. Rounds 1–7 follow PRD §9 with its file ownership table, which I
accept unchanged.

---

## Round 1 integration notes (root, recorded during the round)

**Region layout must be reconciled at integration.** A2 (terrain) chose three vertical bands running
west to east in ascending tier order, chunk-aligned, in `render/scene.ts` as `COREALM_WORLD`:

```
Fallowmarch  x -360 .. -120   centre (-240, 0)   floor  0 m, amplitude  7
Vellenwood   x -120 .. +110   centre   (-5, 0)   floor +4 m, amplitude 12
Karrowmoor   x +110 .. +340   centre (+225, 0)   floor +6 m, amplitude 36
world bounds  x -360..340, z -200..200, seams at x = -120 and x = +110
```

A1 (world semantics) was briefed with a looser arrangement (Fallowmarch middle-west, Vellenwood
north-east, Karrowmoor east/south-east). **`COREALM_WORLD` wins** — it is chunk-aligned, drives the
navmesh, and owns the blend bands that keep the walkable surface continuous. At integration the root
reconciles A1's `RegionDef` bounds and every authored position against these rects, and asserts that
every entity lands inside its own region's rect and on the sampled terrain height.

This is the predictable cost of splitting semantics from rendering across two concurrent workers. The
seam held (both sides only exchange `SemanticEntity` and `heightAt`), but the coordinate frame should
have been frozen by the root *before* the round rather than left to whichever worker decided first.
Worth fixing for round 2: freeze shared constants in `app/config.ts` up front.
