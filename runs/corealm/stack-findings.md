# Stack and asset findings (root, verified before the foundation)

Everything here was measured, not assumed. Specialists should treat it as settled.

## 1. The runtime stack works in headless Chromium

A throwaway probe booted Three.js, Rapier, and Recast together in the same page under the same
Playwright/Chromium/SwiftShader configuration the harness uses:

```json
{ "three": "185", "rapierY": 0.49993, "navSuccess": true, "pathPoints": 2, "pathSuccess": true }
```

with **zero console errors**. Meaning:

- `three@0.185` renders under SwiftShader with `--enable-unsafe-swiftshader` (the flag the harness
  driver already passes).
- `@dimforge/rapier3d-compat@0.20` initializes via `await RAPIER.init()` and simulates correctly —
  a dynamic ball dropped onto a fixed cuboid settled at y≈0.4999 for a 0.5 radius, i.e. exact.
- `@recast-navigation/core@0.43` initializes via `await init()`, and
  `threeToSoloNavMesh(meshes, config)` from `@recast-navigation/three` builds a navmesh from plain
  Three.js meshes. `NavMeshQuery.findClosestPoint` and `computePath` both succeed.

No WASM asset copying, no Vite `optimizeDeps` tweaking, and no special headers were needed. Both
libraries are `-compat` / inlined-WASM builds and work under a stock Vite dev server.

**Init order that works:** `await RAPIER.init()` and `await initRecast()` must both complete before
any world building. Do them in the boot sequence, before the first frame, and only flip
`getState().ready` to `true` afterwards.

**Navmesh API to use:** `threeToSoloNavMesh` for Phase 1. It takes an array of Three.js meshes, so
the walkable-surface meshes must exist in the scene graph before navmesh generation. Config keys
that mattered: `cs`, `ch`, `walkableRadius`, `walkableClimb`, `walkableHeight`. Note
`walkableRadius`/`walkableClimb`/`walkableHeight` are in **voxels**, not metres — they get
multiplied by `cs`/`ch`. Tiled generation (`threeToTiledNavMesh`) exists if Phase 2 needs streaming.

## 2. One universal skeleton across every character pack

This is the single most useful finding. Bone-set comparison of the glTF `skins[0].joints`:

| A | B | bones | shared |
| --- | --- | --- | --- |
| UAL1_Standard.glb | UAL2_Standard.glb | 65 / 65 | **65** |
| UAL1_Standard.glb | Universal Base Characters (Superhero_Male_FullBody) | 65 / 65 | **65** |
| UAL1_Standard.glb | Modular Outfits Fantasy (Male_Ranger) | 65 / 65 | **65** |
| UAL1_Standard.glb | Modular Outfits Fantasy (Male_Ranger_Body part) | 65 / 65 | **65** |

Identical names, identical count. Bone names are Unreal-style: `root`, `pelvis`, `spine_01..03`,
`neck_01`, `Head`, `clavicle_l/r`, `upperarm_l/r`, `lowerarm_l/r`, `hand_l/r`, `index_01_l`, etc.

**Consequences:**

- **No retargeting work is required.** Load the UAL GLBs once, keep their `AnimationClip`s, and play
  them on any character's `AnimationMixer`. Clips are shared across every NPC and the player.
- **Modular equipment is straightforward.** Outfit parts are skinned to the same skeleton, so
  equipping armour means attaching a part's `SkinnedMesh` to the shared skeleton and swapping the
  visible body part — not rebuilding a character.
- Load the animation libraries **once** as a shared clip library. Do not load them per character.

## 3. Available animation clips

86 clips across the two libraries. The ones Phase 1 needs already exist:

| Need | Clip | Library |
| --- | --- | --- |
| idle | `Idle_Loop`, `Idle_FoldArms_Loop`, `Idle_Shield_Loop` | UAL1 / UAL2 |
| walk / run | `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop` | UAL1 |
| melee attack | `Sword_Attack`, `Sword_Regular_A/B/C`, `Sword_Regular_Combo`, `Melee_Hook`, `Punch_Jab` | UAL1 / UAL2 |
| block | `Sword_Block`, `Idle_Shield_Loop` | UAL2 |
| magic | `Spell_Simple_Enter/Idle_Loop/Shoot/Exit` | UAL1 |
| take a hit | `Hit_Chest`, `Hit_Head`, `Hit_Knockback` | UAL1 / UAL2 |
| death | `Death01` | UAL1 |
| woodcutting | `TreeChopping_Loop` | UAL2 |
| mining | `TreeChopping_Loop` reused as a pickaxe swing | UAL2 |
| farming | `Farm_PlantSeed`, `Farm_Watering`, `Farm_Harvest` | UAL2 |
| eating food | `Consume` | UAL2 |
| agility climb | `ClimbUp_1m`, `NinjaJump_Start/Idle_Loop/Land`, `Slide_Start/Loop/Exit`, `Roll` | UAL1 / UAL2 |
| banking / looting | `Chest_Open`, `PickUp_Table`, `Interact` | UAL1 / UAL2 |
| production (smith/craft/cook) | `Fixing_Kneeling`, `Interact` | UAL1 |
| NPC idle / dialogue | `Idle_Talking_Loop`, `Idle_No_Loop`, `Yes`, `Sitting_*` | UAL1 / UAL2 |

**Gap:** there is no fishing clip. Use `Idle_Rail_Loop` (UAL2) or a held-rod idle as the substitute
and drive the visible feedback from a bobber/ripple effect instead of body motion.

## 4. Scale and orientation convention

Quaternius glTF exports are **metres, Y-up**. A character's shoulder accessors top out around
y ≈ 1.57, i.e. a roughly 1.8 m humanoid. This matches Three.js and Rapier defaults, so **no global
scale factor is needed anywhere**. Author the world in metres.

## 5. Licensing

Every pack used is **CC0-1.0** (public domain) by Quaternius. No attribution is legally required,
but the asset manifest records pack, author, source URL, and licence for each asset anyway.

## 6. WebMCP

See `webmcp-research.md`. Short version: the browser API is not available in this Chromium build, so
the canonical agent API is plain TypeScript on `window.corealm.agent`, and the WebMCP surface is a
thin adapter registered onto `document.modelContext` / `navigator.modelContext` when present.

## 7. Character rendering verified end to end in the browser

A second probe loaded `Male_Ranger.gltf` (Modular Outfits Fantasy) plus `UAL1_Standard.glb` with
`GLTFLoader`, built an `AnimationMixer` on the character, and played the `Walk_Loop` clip from the
*animation library* on the *outfit* rig with no retargeting code at all:

```json
{
  "characterSize": { "x": 1.799, "y": 1.869, "z": 0.373 },
  "characterClipsOwn": [],
  "libraryClips": 43,
  "skinnedMeshes": 10,
  "foundWalk": true, "hasHead": true, "hasHandR": true,
  "handMovedBy": 0.6929,
  "drawCalls": 10, "triangles": 26982
}
```

The right hand moved 0.69 m through the clip, so the animation genuinely drives the outfit's
skeleton. A screenshot confirmed correct textures, materials, and silhouette — the stylized look is
already on target for Corealm without custom shading work.

Two practical numbers to design around:

- **`hand_r` and `Head` exist as real nodes**, so weapons/tools attach by parenting to `hand_r` and
  helmets by parenting to `Head`. No socket authoring needed.
- **One fully-dressed character is ~27 k triangles across 10 skinned meshes** (each modular part is
  its own `SkinnedMesh`). That is expensive at scale: 20 visible NPCs would be ~540 k triangles and
  200 draw calls. Budget accordingly — cap simultaneously visible full characters, use simpler
  outfits for background NPCs, and merge parts where an NPC never changes equipment.
