# Magic ladder, Magic 1–70 — current frozen spec

Root-authored. Workers build against this and do not change it; a worker who finds it wrong stops
and reports the mismatch (AGENTS.md rule 5). This revision incorporates the August 30, 2026
magic-equipment amendment. It supersedes the earlier Essence Shard, `worn_staff`, and universal
3.0-second-cast rules.

## 0. What this wave adds

1. Sixteen attack spells covering Magic 1–70, in four elements (wind, water, earth, fire) and four
   escalating rungs (lash, bolt, burst, surge). The PRD's three existing spells keep their ids,
   levels and damage numbers and become three of the four lash-rung entries.
2. A spell VFX layer: cast, flight and impact, drawn from one baked sprite atlas, one draw call.
3. A procedural audio layer — the game currently has none — with a cast and an impact voice per
   element and per rung.
4. Visible wands and staffs imported from Blink's `FREE - RPG Weapons` Unity Asset Store pack, with
   unlit wood variants and glowing elemental weapon upgrades.
5. A spellbook panel, because with sixteen spells the player needs to choose an element.

## 1. Contracts — ALREADY FROZEN, do not re-edit

`game/src/contracts.ts` now exports `SpellElement`, `SPELL_ELEMENTS`, `SpellRung`, `SPELL_RUNGS`,
and a sixteen-way `SpellId`. `game/src/content/index.ts` `SpellDef` now carries `element` and
`rung`, and `ContentRegistry` gained `spellsOfElement()` and `bestSpellOfElement()`.

## 2. The spell table — copy these numbers exactly

`maxHit = floor(baseMax + (magicLevel + gearMagicPower) / divisor)` — PRD 2.4, unchanged.

Every row costs **one unit of matching fuel**. A matching elemental weapon spends one stored charge
first; a plain or empty weapon spends one carried Essence. The equipped weapon owns cadence: a wand
casts in **2200 ms** and a staff in **3000 ms**. A spell row retains `castMs: 3000` only as the
unresolved static fallback. Fire rows remain visible but cannot launch until Fire Essence and Fire
weapons release. Required Magic level, damage and XP separate the rungs.

| id | name | element | rung | reqLevel | tier | baseMax | divisor | baseXp |
| -- | ---- | ------- | ---- | -------: | ---: | ------: | ------: | -----: |
| `voltrend`    | Voltrend    | wind  | lash  | 1  | 1  | 3  | 8   | 5   |
| `stonebrand`  | Stonebrand  | earth | lash  | 5  | 5  | 5  | 7   | 12  |
| `rimewash`    | Rimewash    | water | lash  | 10 | 10 | 8  | 6   | 22  |
| `emberlash`   | Emberlash   | fire  | lash  | 15 | 10 | 9  | 6   | 30  |
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

### Why the lash rung follows region order

The entry rung is the region-boss handoff: Air at Magic 1, Earth at 5, Water at 10, then future Fire
at 15. Those levels match the regional Essence sequence, while each boss Orb upgrades that region's
wood weapon. The later rungs retain their authored rotations and numbers.

### The rotation this produces, which is the design

The strongest newly unlocked row rotates by element: wind leads at 1–4, 17–22, 41–46 and 62–64;
earth at 5–9, 29–34, 53–58 and 68–69; water at 10–14, 23–28, 47–52 and 65–67; fire at 15–16,
35–40, 59–61 and 70+. A caster still needs matching released fuel, so the visible Fire rows do not
enter automatic selection in the current release.

### Checkpoints a test must pin (tier-10 magic kit, `magicPower` 32)

Holding gear fixed at the tier 10 kit across all sixteen rows, which is what makes this a ladder
rather than sixteen unrelated readings:

`voltrend`@1 → 7, `stonebrand`@5 → 10, `rimewash`@10 → 15, and `emberlash`@15 → 16. The PRD's
lower entry values use the tier kit a caster actually owns at each unlock and are pinned separately;
do not conflate the two columns. Then `skirlbolt`@17 → 19,
`sleetbolt`@23 → 23, `shalebolt`@29 → 27, `cinderbolt`@35 → 30, `galeburst`@41 → 34,
`spateburst`@47 → 38, `cragburst`@53 → 43, `pyreburst`@59 → 47, `squallsurge`@62 → 51,
`tidesurge`@65 → 55, `scarpsurge`@68 → 59, `kilnsurge`@70 → 63.

## 3. Wands, staffs, and elemental upgrades

Both weapon families follow the same wood ladder. Wands are one-handed, weaker, and cast every
2200 ms. Staffs are two-handed, stronger, and cast every 3000 ms. Orbs are one-use altar keys and
there is no separate Orb equipment slot.

| tier | wand | staff | wood | wood requirement |
| ---: | ---- | ----- | ---- | ---------------- |
| 0 | `basic_wooden_wand` | `basic_wooden_staff` | plain wood | none |
| 1 | `palewood_wand` | `palewood_staff` | Palewood | Woodcutting 1 |
| 5 | `duskoak_wand` | `duskoak_staff` | Duskoak | Woodcutting 5 |
| 10 | `cairnpine_wand` | `cairnpine_staff` | Cairnpine | Woodcutting 10 |

Wands use two matching shafts and staffs use three. The fresh character starts with
`basic_wooden_wand` equipped and 50 Air Essence, enough to cast Voltrend directly.
`basic_wooden_staff` is the tier-0 two-handed alternative. Legacy `worn_staff` saves migrate to
`basic_wooden_staff` and safely displace any ordinary offhand item.

Air, Earth, and Water Orbs release at tiers 1, 5, and 10. Each is consumed once to awaken the
matching altar at its Essence Cache. Dormant altar ruins keep a subtle non-emissive elemental hue;
awakening colours the full ruin structure and lights a sparse altar sigil, an under-top line, and
the circular emblem. Each ruin stands on a fully leveled regional-stone court with no grass, plants,
or loose litter inside the court perimeter. Its exact imported geometry is walkable and solid: open
arches remain passable, platforms support the player, and paths route around walls and monuments. An
awakened altar makes both matching wood weapon types into
`air_*`, `earth_*`, or `water_*`; each finished weapon starts at 1,000 charges and falls back to
carried Essence when empty. Later boss kills do not replace an Orb already used on its altar. Fire
outputs are authored at tier 15 but remain unavailable.

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

## 7. File ownership of the original ladder wave (historical)

This section records the completed original ladder wave; it is not a current implementation plan.
The August 30 amendment replaced its procedural-staff assignment with the pack-backed wand/staff,
weapon charge, Essence, cache, altar, persistence, and UI work specified above and in the PRD.

Concurrent workers never touch a file outside their own list.

DONE ALREADY, by the root — do not edit any of these:
`contracts.ts`, `content/index.ts`, `content/spells.ts`, `systems/combat.ts`, `state/store.ts`,
`persistence/migrate.ts`, `api/gameApi.ts`, `api/docs.ts`, `agent/tools.ts`, `app/loop.ts`,
`tests/spells.test.ts`, `tools/build-vfx-atlas.ts`, and the baked atlas under
`game/public/assets/vfx/`.

Remaining:

* **W-VFX** — `render/spellVfx.ts` (new)
* **W-AUDIO** — `audio/spellSound.ts` (new), `audio/gameAudio.ts`
* **W-STAFF (superseded)** — the procedural proxy was removed. The shipped implementation uses
  Blink's pack-backed meshes through `render/equipmentVisuals.ts` and `render/assets.ts`.
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
