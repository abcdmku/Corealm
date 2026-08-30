# Magic ladder, Magic 1–70 — frozen spec

Root-authored. Workers build against this and do not change it; a worker who finds it wrong stops
and reports the mismatch (AGENTS.md rule 5).

## 0. What this wave adds

1. Sixteen attack spells covering Magic 1–70, in four elements (wind, water, earth, fire) and four
   escalating rungs (lash, bolt, burst, surge). The PRD's three existing spells keep their ids,
   levels and damage numbers and become three of the four lash-rung entries.
2. A spell VFX layer: cast, flight and impact, drawn from one baked sprite atlas, one draw call.
3. A procedural audio layer — the game currently has none — with a cast and an impact voice per
   element and per rung.
4. A visible staff. Staves render NOTHING today (`render/equipmentVisuals.ts` `GEAR_ASSET_GAPS`:
   there is no staff mesh in the 213-asset library), so a "basic staff" would be an invisible one.
5. A spellbook panel, because with sixteen spells the player needs to choose an element.

## 1. Contracts — ALREADY FROZEN, do not re-edit

`game/src/contracts.ts` now exports `SpellElement`, `SPELL_ELEMENTS`, `SpellRung`, `SPELL_RUNGS`,
and a sixteen-way `SpellId`. `game/src/content/index.ts` `SpellDef` now carries `element` and
`rung`, and `ContentRegistry` gained `spellsOfElement()` and `bestSpellOfElement()`.

## 2. The spell table — copy these numbers exactly

`maxHit = floor(baseMax + (magicLevel + gearMagicPower) / divisor)` — PRD 2.4, unchanged.

Every row costs **1 Essence Shard** and casts in **3000 ms**. Both are PRD section 0 decision 3 and
PRD 2.4 respectively, and both are held across all sixteen rows on purpose: scaling shard cost with
rung would need the gem-drop economy re-solved, and that is not what this wave is for. What
separates the rungs is required Magic level, damage and XP.

| id | name | element | rung | reqLevel | tier | baseMax | divisor | baseXp |
| -- | ---- | ------- | ---- | -------: | ---: | ------: | ------: | -----: |
| `emberlash`   | Emberlash   | fire  | lash  | 1  | 1  | 3  | 8   | 5   |
| `stonebrand`  | Stonebrand  | earth | lash  | 5  | 5  | 5  | 7   | 12  |
| `voltrend`    | Voltrend    | wind  | lash  | 10 | 10 | 8  | 6   | 22  |
| `rimewash`    | Rimewash    | water | lash  | 13 | 10 | 9  | 6   | 28  |
| `skirlbolt`   | Skirlbolt   | wind  | bolt  | 17 | 10 | 11 | 5.5 | 36  |
| `sleetbolt`   | Sleetbolt   | water | bolt  | 23 | 20 | 13 | 5.2 | 47  |
| `shalebolt`   | Shalebolt   | earth | bolt  | 29 | 20 | 15 | 5.0 | 59  |
| `cinderbolt`  | Cinderbolt  | fire  | bolt  | 35 | 30 | 17 | 4.8 | 71  |
| `galeburst`   | Galeburst   | wind  | burst | 41 | 40 | 19 | 4.6 | 84  |
| `spateburst`  | Spateburst  | water | burst | 47 | 40 | 21 | 4.4 | 97  |
| `cragburst`   | Cragburst   | earth | burst | 53 | 50 | 23 | 4.2 | 111 |
| `pyreburst`   | Pyreburst   | fire  | burst | 59 | 50 | 25 | 4.0 | 125 |
| `squallsurge` | Squallsurge | wind  | surge | 62 | 60 | 27 | 3.8 | 133 |
| `tidesurge`   | Tidesurge   | water | surge | 65 | 60 | 29 | 3.6 | 141 |
| `scarpsurge`  | Scarpsurge  | earth | surge | 68 | 60 | 31 | 3.5 | 149 |
| `kilnsurge`   | Kilnsurge   | fire  | surge | 70 | 70 | 33 | 3.4 | 155 |

`tier` is exactly `tierForLevel(reqLevel)` from `content/xp.ts`. The first draft of this table paired
tiers two rows at a time, which put `skirlbolt`, `shalebolt` and `scarpsurge` one step above the tier
their own unlock level reaches; W-CONTENT reported the contradiction instead of shipping it and the
root floored all three. `tests/spells.test.ts` now pins the invariant.

### Why the lash rung's element order differs from the other three

Rungs 2–4 run wind → water → earth → fire, weakest to strongest. The lash rung runs fire → earth →
wind → water because PRD 2.4 fixes Emberlash at Magic 1, Stonebrand at 5 and Voltrend at 10, and
those are load-bearing for the quest reference in `content/quests.ts:741` and the gate check in
`tools/gate-check.ts:561`. Rimewash was authored at 13 to complete the set. Do not renumber them.

### The rotation this produces, which is the design

The strongest spell a caster owns rotates by element as they level: wind leads at 10–12 and 41–46
and 62–64, water at 13–16 and 47–52 and 65–67, earth at 5–9 and 29–34 and 53–58 and 68–69, fire at
1–4 and 35–40 and 59–61 and 70+. So "I want to cast fire" costs a few points of max hit for part of
the climb and nothing for the rest, which is a real preference rather than a free one.

### Checkpoints a test must pin (tier-10 magic kit, `magicPower` 32)

Holding gear fixed at the tier 10 kit across all sixteen rows, which is what makes this a ladder
rather than sixteen unrelated readings:

`emberlash`@1 → 7, `stonebrand`@5 → 10, `voltrend`@10 → 15. The PRD's quoted 3 and 7 for the first
two are against the tier 1 and tier 5 kits a caster would actually own at those levels, and are
pinned separately; do not conflate the two columns, which the first draft of this spec did.
Then `rimewash`@13 → 16, `skirlbolt`@17 → 19,
`sleetbolt`@23 → 23, `shalebolt`@29 → 27, `cinderbolt`@35 → 30, `galeburst`@41 → 34,
`spateburst`@47 → 38, `cragburst`@53 → 43, `pyreburst`@59 → 47, `squallsurge`@62 → 51,
`tidesurge`@65 → 55, `scarpsurge`@68 → 59, `kilnsurge`@70 → 63.

## 3. Staves

The existing three staves already ARE the "wood from better trees" ladder and must not be
duplicated:

| staff | requires | wood | that log needs |
| ----- | -------- | ---- | -------------- |
| `palewood_staff`  | Magic 1  | Palewood  | Woodcutting 1  |
| `duskoak_staff`   | Magic 5  | Duskoak   | Woodcutting 5  |
| `cairnpine_staff` | Magic 10 | Cairnpine | Woodcutting 10 |

Each is already fletched from `3 x <wood> shaft + 1 x <tier gem>` in `content/recipes.ts`, and the
shafts come from logs, so the Woodcutting 5 / 10 gate is real and already enforced by the source of
the wood. What is MISSING and must be added:

* `worn_staff`, tier 0, no requirements, the mate of `worn_sword` — the basic staff the player
  starts with. Bonuses must sit below `palewood_staff`'s 6/4/1 so the first upgrade is worth buying:
  use `magicAccuracy 3, magicPower 2`, value 15, `attackSpeedMs` 3000.
* It goes in `STARTING_INVENTORY` (carried), NOT `STARTING_EQUIPMENT` — `worn_sword` holds
  `mainHand` and a hand holds one thing.

## 4. Frozen module APIs

Workers code against these signatures. Do not change them; report a mismatch instead.

### `game/src/render/spellVfx.ts`

```ts
export interface SpellVfxDeps {
  parent: THREE.Object3D;          // scene.overlayGroup
  camera: THREE.Camera;            // for billboarding
  groundHeightAt?(x: number, z: number): number;
}
export interface SpellCastRequest {
  id: string;                      // unique per cast, for dedupe
  element: SpellElement;
  rung: SpellRung;
  from: Vec3;                      // caster position (feet)
  to: Vec3;                        // target position (feet)
  hit: boolean;                    // a miss still flies, and fizzles instead of bursting
}
export class SpellVfx {
  constructor(deps: SpellVfxDeps);
  /** Total ms from `cast()` to the impact frame. `app/loop.ts` delays the damage number by this. */
  flightMs(rung: SpellRung): number;
  cast(request: SpellCastRequest, nowMs: number): void;
  update(nowMs: number): void;
  liveParticles(): number;
  drawCalls(): number;             // 0 when idle, 1 otherwise. Never more.
  dispose(): void;
}
```

### Audio — hook the system that already exists, do not build one

**This section was rewritten after rebasing onto main.** An earlier draft of this spec told a worker
to synthesise sound from WebAudio primitives because the repo had none. Main landed a full audio
stack in the meantime (`feat: add synchronized game audio`) and that draft is now void.

What exists on main and must be used:

* `game/src/audio/engine.ts` — buffer playback, three mix buses, per-cue concurrency and interval
  limits. `playCue(cue, { gain, playbackRate })` takes PER-PLAY overrides.
* `game/src/audio/corealmCatalog.ts` — the curated cue catalog. `combat.magic_cast` already points at
  four files (`magic-ember-cast-01/02`, `magic-stone-cast-01/02`) and `combat.magic_hit` at two
  (`magic-impact-01/02`). Those six .ogg files are the entire magic library on disk.
* `game/src/audio/gameAudio.ts` — `handlePlayerCombatMotion(hit, phase)`, already wired to the rig's
  measured swing and contact markers by `app/loop.ts`.

So the four elements are separated by MODULATING the six existing files per play, not by adding
files or cue ids. That is the same argument as the VFX atlas: one asset set, four identities, from
tint in one case and pitch and gain in the other. There is no wind or water recording to add, and
inventing one is not in scope.

Two gaps in the current behaviour that this wave closes:

1. Every element sounds identical, because `handlePlayerCombatMotion` plays a bare
   `combat.magic_cast`.
2. A magic MISS is silent — the handler is `hit.kind === "magic" && hit.hit`. Melee has
   `combat.melee_miss`; magic has nothing, so a missed cast reads as a bug.

### `game/src/audio/spellSound.ts` (new)

```ts
export interface SpellSoundShape { gain: number; playbackRate: number }
export function spellCastSound(element: SpellElement, rung: SpellRung): SpellSoundShape;
export function spellImpactSound(element: SpellElement, rung: SpellRung, hit: boolean): SpellSoundShape;
```

Element sets the pitch centre, rung shifts it down and the gain up as the spell gets bigger:

| element | pitch centre | reads as |
| ------- | -----------: | -------- |
| wind  | ~1.22 | fast, high, airy |
| water | ~1.06 | mid, rounded |
| earth | ~0.78 | slow, low, heavy |
| fire  | ~0.96 | full-bodied roar |

A miss is quieter, lower and duller than a hit — the audible half of the same information the VFX
layer carries when a bolt fizzles short.

## 5. Element palette — one source of truth

Lives in `render/spellVfx.ts` and is imported by the UI and the audio layer; nobody redefines it.

| element | core (hot centre) | edge (outer particles) | reads as |
| ------- | ----------------- | ---------------------- | -------- |
| wind  | `0xe8f0ff` | `0x7fa8e8` | pale storm blue-white, with arc sprites |
| water | `0xdff2ff` | `0x3d8fc4` | deep blue-cyan, flake and splat sprites |
| earth | `0xffe3ae` | `0x8a6b3c` | ochre and stone brown, shard and crack sprites |
| fire  | `0xfff0c4` | `0xe0621f` | white-hot centre into orange, scorch sprite |

Every element uses the SAME sprites and the SAME timing for its rung. Colour and the one signature
sprite per element are the only differences. That is the whole reason sixteen spells cost one atlas.

## 6. Rung envelope — "low level attacks are smaller and simpler"

Measured peaks per stage, stepped at 60 Hz by `tests/spell-vfx.test.ts` (a 12 m throw):

| rung | radius | at the caster | in flight | on impact | speed | extra layers |
| ---- | -----: | ------------: | --------: | --------: | ----: | ------------ |
| lash  | 0.18 m | 12 |  6 |  37 | 22 m/s | none — one dart, one small flash |
| bolt  | 0.26 m | 18 | 16 |  78 | 19 m/s | + trail ribbon, + ground ring |
| burst | 0.36 m | 29 | 22 | 141 | 16 m/s | + cast rune at the feet, + smoke settle |
| surge | 0.48 m | 40 | 27 | 228 | 14 m/s | + slash arc opener, + ground decal |

**Spark SIZE never scales — only quantity.** A spark is a fixed 1.8-4 cm whatever threw it, so a
surge is not a lash with bigger grains, it is the same grains and six times as many. Scaling size
with `radius` was the first attempt and produced 12 cm sparks stretched to 70 cm, which read as
flung debris rather than as sparks. `radius` still scales the flash, ring, decal and projectile.

Two properties matter more than the exact numbers, and both are asserted:

* **A FEW at the caster, a few in flight, A LOT on impact.** The landing is where a spell reads.
  Spreading the budget evenly makes a thrown spell look like a firework carried on a stick.
* **Density climbs hard with rung.** A surge's impact is 6.2x a lash's, not 1.5x. Detail is bought
  in velocity-stretched sparks because an instance is the cheap axis — same draw call, same
  material, same texture — where another layer is not.

Flight time is a SPEED, not a fixed duration, so a bolt across the room and one at the 15 m maximum
read the same. A lash must be legibly the small, cheap thing and a surge legibly the expensive one.

## 7. File ownership this wave

Concurrent workers never touch a file outside their own list.

DONE ALREADY, by the root — do not edit any of these:
`contracts.ts`, `content/index.ts`, `content/spells.ts`, `systems/combat.ts`, `state/store.ts`,
`persistence/migrate.ts`, `api/gameApi.ts`, `api/docs.ts`, `agent/tools.ts`, `app/loop.ts`,
`tests/spells.test.ts`, `tools/build-vfx-atlas.ts`, and the baked atlas under
`game/public/assets/vfx/`.

Remaining:

* **W-VFX** — `render/spellVfx.ts` (new)
* **W-AUDIO** — `audio/spellSound.ts` (new), `audio/gameAudio.ts`
* **W-STAFF** — `render/proceduralGear.ts` (new), `render/equipmentVisuals.ts`, `render/assets.ts`
* **W-GEAR** — `content/equipment.ts`, `content/items.ts`
* **W-UI** — `ui/spellbookPanel.ts` (new), `ui/styles/spellbook.css` (new)
* **ROOT** — `app/boot.ts`, `ui/panels.ts`, `render/renderer.ts`, integration, remaining tests

### UI idiom, post-redesign

Main redesigned the UI (`Redesign game UI: glass theme, panel slots, minimap, quest tracker`), so
copy the CURRENT shape, not an older screenshot. A panel is:

```ts
export class SpellbookPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  constructor(ctx: UiContext);
  refresh(force?: boolean): void;
  dispose(): void;
}
```

`ManagedPanel`, `PanelFrame`, `UiContext` all come from `./panels.js`. Panels declare a `group`:
`"side"` is the narrow 190 px tab slot above the dock, `"center"` is the one large window and
opening either vacates the other. Sixteen spells in four columns needs the large window, so use
`group: "center"` with a placement in the shape `ui/controlsPanel.ts` and `ui/bankPanel.ts` use.
Read state through `ctx.api.getSpellbook()` and write through `ctx.api.setPreferredSpell()` — both
already exist on `GameApi` and return the resolved rows; do NOT recompute max hits in the UI.

## 8. Budgets that must not move

* Spell VFX: **at most 1 draw call**, 0 when idle. Highcairn measures 397 against a 400 budget.
* Spell particles: hard cap **640** live, separate from Ambience's own 640. Raised from 320 with the
  spark stages — a surge now peaks near 228 against the 54 it used to, and 320 left room for barely
  one concurrent cast before one the player was watching started being evicted.
* No RNG stream draws anywhere in the VFX or audio layer — an acceptance check must not flap.
  Use the integer hash helpers `render/vfx.ts` already uses.
* No mid-session shader compile, via `SpellVfx.primeShader()`.

  Worth recording, because two plausible answers were wrong and only measurement settled it. three
  0.185.1 gathers materials with a plain `scene.traverse` (three.module.js:17426; only the LIGHT
  walks above it are visibility-filtered), so a hidden, zero-instance mesh already in the graph looks
  like it must be covered by `Renderer.warmup` automatically. It is not: `getMetrics().programs`
  reads 106 after boot and settling, and 107 on the FIRST cast of a session, with the second cast
  adding nothing. Routing the material through a one-instance proxy in `warmup({ materials })` did
  not fix it either — same material, same `customProgramCacheKey`, still a second compile. The layer
  now compiles its own program by DRAWING one zero-scale instance on its first idle frame, which is
  the only version that exercises the real mesh, geometry, attributes and material together. The
  proxy hook was removed rather than left as a second mechanism that does not work.
  `tools/verify-magic.ts` asserts the program count does not rise across each cast.
