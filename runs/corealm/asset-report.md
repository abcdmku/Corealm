# Corealm asset pipeline report

Owner: asset-pipeline specialist. Files: `tools/fetch-assets.ts`, `tools/build-assets.ts`,
`game/public/assets/**`, this report.

The original 213-asset Quaternius set is **CC0-1.0**. The current asset tree is not all CC0.
It also contains six GLBs imported from three packages in the user's Unity Asset Store cache. Those
files remain subject to the Unity Asset Store EULA; a local cache does not prove entitlement, so the
project owner must confirm it before shipping. Do not redistribute the source packages or describe
the Unity-derived files as CC0. Package hashes and conversion details
live in `game/public/assets/UNITY_ASSET_SOURCES.md`.

Current manifest total: 228 GLBs across 13 packs, plus one recorded VFX atlas artifact. Of those,
222 GLBs are CC0 Quaternius outputs, including the 213 historical assets described by the legacy
pipeline sections below. The six Unity-derived magic assets total 39,842,824 bytes and bring the
models tree to 77,613,808 bytes. Hovl Studio's atlas is recorded separately.

## Commands

```
npx tsx tools/fetch-assets.ts <itch-slug> [...]   # download packs into .asset-cache/ (gitignored)
npx tsx tools/build-assets.ts                     # incremental build -> game/public/assets/
npx tsx tools/build-assets.ts --force             # rebuild everything
npx tsx tools/build-assets.ts --check             # check the legacy Quaternius catalogue
npx tsx tools/build-assets.ts --verify            # verify all 228 GLBs and the recorded atlas
npx tsx tools/build-assets.ts --preservation-check # prove a legacy rebuild retains imported rows
npx tsx tools/import-unity-magic-assets.ts         # audit the six Unity-derived magic GLBs
```

## Packs used

| Pack | Source | Licence | Assets taken |
|---|---|---|---|
| Fantasy Props MegaKit | https://quaternius.itch.io/fantasy-props-megakit | CC0-1.0 | 57 |
| Medieval Village MegaKit | https://quaternius.itch.io/medieval-village-megakit | CC0-1.0 | 54 |
| Stylized Nature MegaKit | https://quaternius.itch.io/stylized-nature-megakit | CC0-1.0 | 52 |
| Modular Character Outfits - Fantasy | https://quaternius.itch.io/modular-character-outfits-fantasy | CC0-1.0 | 24 |
| Ultimate Platformer Pack | https://quaternius.itch.io/ultimate-platformer-pack | CC0-1.0 | 16 |
| Universal Base Characters | https://quaternius.itch.io/universal-base-characters | CC0-1.0 | 8 |
| Universal Animation Library | https://quaternius.itch.io/universal-animation-library | CC0-1.0 | 1 |
| Universal Animation Library 2 | https://quaternius.itch.io/universal-animation-library-2 | CC0-1.0 | 1 |
| FREE - RPG Weapons | https://assetstore.unity.com/packages/3d/props/weapons/free-rpg-weapons-199738 | Unity Asset Store EULA; owner confirmation required | 2 |
| Rocks FREE pack | https://assetstore.unity.com/packages/3d/props/exterior/rocks-free-pack-98219 | Unity Asset Store EULA; owner confirmation required | 2 |
| Magic Effects FREE | https://assetstore.unity.com/packages/vfx/particles/spells/magic-effects-free-247933 | Unity Asset Store EULA; owner confirmation required | 1 atlas artifact |

The first eight rows use the original zip-to-GLB pipeline. Blink and DEXSOFT use the separate Unity
importer so prefab transforms, FBX scale, normals, UVs, and the selected rock LOD remain intact.
Hovl contributes the source sprites for the one generated atlas recorded under `artifacts`.

Ultimate Platformer Pack is the odd one out stylistically — flatter, more Mario than
Synty. It is used only where the fantasy kits have nothing at all (cliffs, bridges,
animated enemies, crystal ore). Every asset from it carries the tag
**`placeholder-style`** so an art pass can find and replace the lot with one query.

## Packs downloaded and rejected

`tools/fetch-assets.ts` was fixed (see below) and successfully pulled all nine older
slugs from the brief. **All nine ship OBJ/FBX/BLEND only — zero glTF or GLB**, so per
instructions they were skipped rather than converted:

`lowpoly-modular-dungeon-pack`, `lowpoly-medieval-weapons`, `lowpoly-animated-monsters`,
`animated-easy-enemies`, `lowpoly-animated-fish`, `lowpoly-farm-buildings`,
`lowpoly-animated-animals`, `150-lowpoly-nature-models`, `textured-lowpoly-trees`.

Those zips are still in `.asset-cache/` if someone wants to run them through Blender
offline. They are the direct cause of most of the art gaps below: they contain exactly
the monsters, fish, animals, dungeon kit, farm buildings and extra weapons Phase 1 wants.

I also scraped the full Quaternius itch catalogue (35 projects). Apart from what is
already in, the only remaining glTF-era packs are sci-fi, downtown-city, guns, cars,
spaceships and a 3D card kit — nothing usable for a medieval fantasy RPG.

## fetch-assets.ts fix

The old code clicked `.buy_btn` on the project page. On older Quaternius pages that
element is hidden, so the click silently did nothing and no `a.download_btn[data-upload_id]`
ever appeared. The fix navigates straight to `https://quaternius.itch.io/<slug>/purchase`,
clicks "No thanks, just take me to the downloads", then collects the upload buttons. The
old project-page flow is kept as a fallback. Verified against ten older slugs and the
existing modern packs.

## Legacy Quaternius pipeline size

The table below covers the original 213 Quaternius GLBs only. Nine later CC0 rig and animation
outputs plus the six Unity-derived magic assets bring the current models tree to 77,613,808 bytes.

| | bytes |
|---|---|
| Source read from zips (only what is used) | 740.6 MB |
| Output `game/public/assets/models/` | **37.58 MB** |
| Reduction | 94.9% |

Full uncompressed size of the seven cached MegaKit zips is ~2.5 GB; the 740 MB figure is
the subset the pipeline actually reads. Textures are 28% of the output; geometry is the rest.

| Category | Count | Bytes | Avg |
|---|---|---|---|
| animation | 2 | 4.65 MB | 2270 KB |
| building | 42 | 3.34 MB | 78 KB |
| character | 12 | 2.65 MB | 215 KB |
| dungeon | 6 | 0.29 MB | 47 KB |
| farm | 4 | 0.66 MB | 160 KB |
| nature | 41 | 7.83 MB | 186 KB |
| outfit | 24 | 9.97 MB | 406 KB |
| prop | 56 | 6.60 MB | 115 KB |
| rock | 22 | 1.19 MB | 53 KB |
| weapon | 4 | 0.41 MB | 101 KB |
| **total** | **213** | **37.58 MB** | |

**Historical budget: met.** The 37.58 MB Quaternius set stayed under its ~40 MB target. The current
52.24 MB tree includes the later requested magic assets, so the old budget result does not apply to
the current total.

Five environment GLBs exceed the ~400 KB target, all of them the densest foliage:
`tree_twisted_1..5` at 475-519 KB. They are leaf-card geometry, not texture (their
textures are 42 KB combined). Simplifying them would visibly change the silhouette, so I
left them; if the budget tightens, drop the twisted set to two variants instead of five.

## Legacy Quaternius pipeline

Per asset, read straight out of the zip (nothing is unpacked to disk):

1. **Strip every map except base colour.** Normal / metallicRoughness / occlusion /
   emissive are cleared, `metallicFactor` forced to 0, low roughness clamped to 0.85.
   Non-base-colour images are never even read from the zip — a 1x1 stand-in is
   substituted and `prune()` deletes the texture. This alone accounts for most of the
   94.9% reduction and it also works around a broken reference in Universal Base
   Characters, whose glTF points at `T_Hair_1_Normal_png.png` / `T_Eye_Normal_png.png`,
   neither of which exists in the zip.
2. `dedup()`, `prune({keepAttributes:false})`, `weld()`, `resample()`.
3. `quantize()` (KHR_mesh_quantization, 14-bit position). **Skipped for skinned meshes** —
   see the correctness note below.
4. `textureCompress()` pass 1 → JPEG q85, capped 512x512. It automatically skips any
   texture whose channel mask still needs alpha, which is exactly the cut-out foliage.
5. `textureCompress()` pass 2 → PNG for whatever is still PNG (the alpha textures),
   also capped 512x512, then a sharp palette-quantization pass kept only when smaller.
6. Write a single self-contained `.glb`.

Measured result for the legacy set: max texture edge across all 213 assets is **512** (295 at 512x512, 5 at
512x498, 2 at 256x256).

### Correctness note: quantization and skinned meshes

`quantize()` normalizes vertex positions and compensates with a node scale. For a
**skinned** mesh it cannot do that — the node matrix is ignored during skinning — so it
folds the correction into the inverse-bind matrices instead. That renders correctly, but
it leaves the raw vertex data in normalized space, which made `getBounds()` report
`base_male` as `2 x 1.958 x 0.603` instead of its real `1.859 x 1.82 x 0.291`.

Two changes came out of that:

- `size` is now measured on the **untouched source document**, before any transform. Every
  manifest `size` was checked against the raw POSITION accessor min/max in the source
  glTF and matches to 3 decimals.
- Quantization is disabled for any document containing a skin. Costs ~3 MB across
  characters and outfits; removes all doubt about the player, NPCs and equipment.

### Animation libraries

UAL1 and UAL2 keep **all 43 clips each**, verified by comparing clip names and per-clip
channel counts before and after. The mannequin mesh, materials and textures are stripped;
if the clip check ever fails the pipeline falls back to passing the source GLB through
untouched. 7.62 MB → 2.25 MB and 8.09 MB → 2.40 MB, clips intact.

### Idempotency

State lives in `.asset-cache/build-assets-state.json`. Each asset records an input
fingerprint built from the **zip central-directory CRC-32 and uncompressed size** of every
entry it reads — so the incremental check never inflates a byte — plus an options hash
covering the pipeline version, texture limit, category, tags and pack.

Verified:

- Run 1 (cold): 213 built, 0 failed, 37.58 MB.
- Run 2: `213 built/valid, 213 reused from cache, 0 failed` in **1.0 s**.
- The SHA-256 of the whole models tree is byte-identical across runs, and stayed identical
  across an internal refactor of the loader — the transform is deterministic.
- Corruption test: truncating `tree_common_1.glb` to half its length caused exactly that
  one asset to rebuild on the next run (the recorded byte count is the integrity check);
  everything else was reused and `--verify` passed afterwards.
- Stale outputs from an earlier catalogue revision are swept from `models/`, but only when
  the run had zero failures, so a partial failure can never delete good assets.
- Current builds copy the complete models tree into a sibling transaction directory and build there.
  Only a zero-failure run swaps that directory into place, so a failed conversion cannot alter the
  published GLBs or manifest. Imported Unity models are copied through and merged back by pack ID.

## Verification

- In the recorded legacy run, `--verify` loaded all 213 Quaternius GLBs with
  `@gltf-transform/core`, checked the byte
  count against the manifest, and required ≥1 mesh (or ≥1 animation for the libraries).
  **Result: 213/213 parsed and non-empty. Zero failures.**
- In that same run, `--check` confirmed all 213 catalogue source paths resolved inside their zips.
  Result: 213/213.
- Manifest id uniqueness and `^[a-z0-9_]+$` are asserted at build time.
- The current `--verify` run parses all 217 GLBs and enforces the byte counts plus recorded SHA-256
  values for the four imported models and the atlas artifact. `--preservation-check` confirms that a
  legacy rebuild retains four imported GLBs, one artifact, and three external pack records.
- `tools/import-unity-magic-assets.ps1` checks the Blink and DEXSOFT package hashes before opening
  Unity. `npx tsx tools/import-unity-magic-assets.ts` does not open the packages; it audits the four
  committed GLBs, enforcing their output hashes, structure, meshes, textures, finite bounds,
  expected scale, and zero material emission. `build-assets.ts --verify` enforces the Hovl atlas hash.

### Scale convention

**Quaternius packs are metres, Y-up, right-handed — confirmed, not assumed.** Spot checks
against raw source accessors:

| Asset | Measured size (m) |
|---|---|
| `tree_common_1` | 4.311 x 7.265 x 4.578 |
| `tree_pine_1` | 4.945 x 7.317 x 4.538 |
| `base_male` | 1.859 x 1.820 x 0.291 (1.82 m tall, T-pose arm span 1.86 m) |
| `anvil` | 1.082 x 0.556 x 0.402 |
| `sword` | 0.267 x 1.132 x 0.065 |
| `wall_plaster_straight` | 2.0 x 3.125 x 0.406 |
| `floor_wood` | 2.0 x 0.02 x 2.0 |
| `rock_medium_1` | 3.225 x 2.260 x 2.989 |

**The Medieval Village MegaKit grid is 2 m.** Walls, floors and roofs snap on a 2 m module
with a 3.125 m storey height. Build the town on that grid.

**Caveat: the Ultimate Platformer Pack is not on the same scale.** Its enemies are
1.4-2.9 m across and its rock platforms are 5-7 m. The `enemy_*` meshes need roughly
0.6-0.8x scaling to sit next to a 1.82 m player. Their manifest `size` values are honest —
scale at instantiation.

## Manifest

`game/public/assets/manifest.json`, 228 GLB assets, one atlas artifact, and 13 packs. Ten packs and
222 assets are CC0 Quaternius imports. Three source packs cover the six Unity-derived GLBs; the
Unity-derived VFX atlas is described above.
The manifest shape matches the frozen contract
exactly: `generatedAt`, `packs[{id,name,author,source,license}]`,
`assets[{id,file,pack,category,is,tags,bytes,size:{x,y,z},animations,materials}]`.

Categories in use: `nature`, `rock`, `building`, `prop`, `farm`, `dungeon`, `character`,
`outfit`, `weapon`, `animation`. **`water` is unused — nothing in the free library provides
water.**

### `is` versus `tags`

`is` is what the mesh IS: one word, the subject of the model, and always the first tag.
Everything after the first tag is an ASSOCIATION — what the mesh contains, what it stands
on, what it is used for, how it should be recoloured.

The distinction is published as its own field because Phase 1 shipped without it and it
cost a round. `anvil_log` is tagged
`["anvil", "log", "stump", "smithing", "forge", "crafting"]` because it is an anvil standing
on a cut log. Somebody read "stump" off that list, and every felled tree in the world plus
the landmark Rootfall is built around became a blacksmith's anvil at five times scale.
Nothing in the manifest was wrong; the reading was.

So: `assets.byIs("stump")` for identity, `assets.byTags("farm", "tier10")` for "anything to
do with". Tags are still deliberately redundant — a use/region tag (`plains`, `dungeon`,
`market`, `tier10`) and hints like `modular`, `recolour`, `minable`, `animated`,
`placeholder-style` — and they are still the right query for composition code. They are
never the right query for "what is this".

`category` is the folder and is single-valued; cross-use is carried by tags. Brick walls
live in `building` but are tagged `dungeon`.

## Coverage table

| Phase 1 need | Got it? | Assets |
|---|---|---|
| common trees | yes | `tree_common_1..5` (5) |
| pine trees | yes | `tree_pine_1..5` (5) |
| dead trees | yes | `tree_dead_1..5` (5) |
| gnarled/deep-woodland trees | yes | `tree_twisted_1..5` (5) |
| bushes | thin | `bush_common`, `bush_flowering` (2) |
| ferns | thin | `fern_1` (1) — plus `plant_leafy_*`, `plant_broad_*` (4) |
| grass | yes | `grass_common_short/tall`, `grass_wispy_short/tall` (4) |
| flowers | yes | `flower_a_single/group`, `flower_b_single/group`, `clover_1/2` (6) |
| rocks, several sizes | yes | `rock_medium_1..3`, `rock_small_1..2`, `pebble_round_1..2` (7) |
| boulders | substitute | `boulder_large`, `boulder_medium`, `cliff_tall` (platformer pack) |
| cliffs | substitute | `cliff_step_1..3`, `cliff_tall` (platformer pack) |
| mushrooms | yes | `mushroom_common`, `mushroom_bracket` (2) |
| logs, stumps | **gap** | `anvil_log`, `roof_log` only |
| ore nodes (2-4 recolourable meshes) | yes | Standard ore uses `rock_medium_1..3`, `rock_small_1..2`, and `ore_crystal_blue/green/pink`; elemental essence uses DEXSOFT's `rocks_free_essence_cache` and `rocks_free_essence_node` |
| paths / roads | yes | `path_rock_*` (6), `floor_brick`, `floor_cobble`, `kerb_straight/corner` |
| houses, cottages | modular only | 42 `building` pieces — walls, corners, doors, windows, roofs, floors, stairs, balconies. **No prebuilt house.** |
| walls | yes | `wall_plaster_*` (5), `wall_brick_*` (3), `wall_bottom_trim` |
| fences | yes | `fence_wood_single/extension`, `fence_metal`, `fence_metal_ornate` |
| gates | substitute | `fence_metal_ornate`, `wall_arch` |
| wells | **gap** | `bucket_wood`, `bucket_metal` only |
| signs | **gap** | none |
| bridges | substitute | `bridge_small`, `bridge_modular_end`, `bridge_modular_center` (platformer pack) |
| towers | modular only | `roof_tower` + `wall_brick_straight` + `corner_brick` |
| market stalls | yes | `market_stall`, `market_stall_cart` |
| barrels, crates, sacks | yes | `barrel`, `barrel_apples`, `barrel_rack`, `crate_wood`, `crate_metal`, `crate_village`, `sack`, `sack_large` |
| anvil | yes | `anvil`, `anvil_log` |
| furnace / forge | **gap** | `cauldron` + `anvil` + `torch` as a set dressing |
| cooking pot / campfire | partial | `cooking_pot`, `cauldron` — **no fire/campfire mesh** |
| workbench | yes | `workbench`, `workbench_drawers` |
| bank chest | yes | `chest_wood` — **ships Chest_Open/Close/Opened/Closed clips** |
| shop counter | yes | `market_stall`, `table_large`, `shelf`, `shelf_bottles` |
| lamps | yes | `lamp_wall`, `torch`, `candle_stand`, `chandelier` |
| banners | yes | `banner_1`, `banner_2` (tagged `recolour`) |
| farm: fence | yes | `fence_wood_single/extension` |
| farm: crops | thin | `crop_carrot`, `farm_crate_carrot/apple/empty` |
| farm: plot / soil | **gap** | none |
| farm: scarecrow | **gap** | none |
| farm: barn / silo | **gap** | none — build from the modular village kit |
| fishing: docks / piers | substitute | `floor_wood`, `floor_wood_light`, `support_beam` (tagged `dock`/`pier`) |
| fishing: boats | **gap** | none |
| fishing: barrels | yes | `barrel`, `crate_wood`, `rope_coil` |
| dungeon: stone arch | yes | `wall_arch` |
| dungeon: stone walls | yes | `wall_brick_straight/door/window`, `corner_brick` |
| dungeon: pillars | thin | `support_beam` |
| dungeon: stairs | yes | `stairs_stone`, `stairs_exterior` |
| dungeon: rubble | yes | `rubble_brick_1..4`, `rubble_vase` |
| dungeon: ruins | yes | rubble + `vine_1/2` + `tree_dead_*` |
| dungeon: braziers | substitute | `torch`, `lamp_wall`, `candle_stand` |
| dungeon: gates | substitute | `cage`, `fence_metal_ornate`, `wall_arch` |
| characters: 1-2 humanoid bases | yes | `base_male`, `base_female` (rigged) + 5 hair + eyebrows |
| outfits: chest/legs/boots/gloves | yes | 20 modular parts, peasant + ranger, M and F |
| outfits: helmets | thin | `outfit_*_ranger_hood` only — **no metal helm** |
| outfits: full sets | yes | `outfit_male/female_peasant`, `outfit_male/female_ranger` |
| humanoid enemies | yes | reuse `base_*` + ranger outfit (tagged `bandit`) |
| non-humanoid monsters | substitute | `enemy_blob`, `enemy_crab`, `enemy_bee`, `enemy_skull` (animated, `placeholder-style`) |
| boss | substitute | `enemy_skull` (tagged `boss`, `tier10`) |
| weapons: sword, axe, pickaxe, shield | yes | `sword`, `axe`, `pickaxe`, `shield` (all tagged `recolour`) |
| weapons: bow | **gap** | none |
| weapons: staff | yes | Blink `rpg_weapon_staff`, tinted at runtime for Basic Wood, Palewood, Duskoak, and Cairnpine |
| weapons: wand | yes | Blink `rpg_weapon_wand`, with the same four runtime wood variants |
| tools: fishing rod | **gap** | none |
| tools: hammer | **gap** | none |
| animations | yes | `animation_library_1` + `animation_library_2`, 86 clips total |
| water | **gap** | none |

## Art gaps, and what to use instead

Ordered by how much they hurt Phase 1.

1. **No non-humanoid monster meshes in the fantasy kits.** `lowpoly-animated-monsters` and
   `animated-easy-enemies` are OBJ/FBX only.
   *Substitute:* `enemy_blob`, `enemy_crab`, `enemy_bee`, `enemy_skull` from the platformer
   pack. They are rigged and animated (Idle, Walk, Bite_Front, Bite_InPlace, Jump, Death,
   HitRecieve, Dance, Yes, No — `enemy_bee` has only Bite_Front, Flying, Death,
   HitRecieve). Untextured flat materials, so recolouring per tier is trivial. Scale to
   ~0.7x. Style does not match the megakits; tagged `placeholder-style`.
2. **Standard ore still uses shared rock meshes.** `rock_medium_1..3` and
   `rock_small_1..2` remain the recoloured standard ore nodes. Elemental essence no longer uses
   that substitute. DEXSOFT's `rocks_free_essence_cache` is the large centre cache and
   `rocks_free_essence_node` supplies its four satellites. Runtime materials combine the retained
   source rock textures with a separate glowing vein mask for Air, Earth, or Water.
3. **No fish, and no boats.** `lowpoly-animated-fish` is OBJ/FBX only.
   *Substitute:* for the catch, reuse `crop_carrot` or a tinted `coin` as a caught-item
   icon until a fish mesh exists. For docks, lay `floor_wood` tiles on `support_beam`
   posts (both tagged `dock`/`pier`) — that gives a proper pier on the 2 m grid. No boat
   substitute exists; leave boats out of Phase 1.
4. **No prebuilt house or cottage.** The Medieval Village kit is strictly modular.
   *Substitute:* this is a composition job, not an asset gap. A minimal cottage is
   4x `wall_plaster_straight` + `wall_plaster_door` + 2x `wall_plaster_window` +
   4x `corner_wood` + `roof_tiles_6x8` + `roof_gable_brick` + `chimney` + `door_round_1`,
   all on the 2 m / 3.125 m grid. Build it once as a prefab and reuse it with variation.
5. **No farm buildings (barn, silo), no soil plot, no scarecrow.**
   `lowpoly-farm-buildings` is OBJ/FBX only.
   *Substitute:* barn = `wall_plaster_timber` walls + `roof_wood_plank`, scaled up. Plot =
   a flat quad with a dirt material bordered by `fence_wood_single`. Scarecrow =
   `training_dummy` (a post with a stuffed torso — reads correctly at distance).
6. **The physical weapon set now includes a wand and staff.** Blink's `FREE - RPG Weapons`
   supplies `rpg_weapon_wand` and `rpg_weapon_staff`; the torch substitute is retired. Runtime
   materials produce the four solid wood bases. Altar-crafted elemental weapon variants add the
   glowing socket; the Orb itself is never equipped. The Quaternius set still has no bow, hammer,
   or fishing rod. Hammer can reuse the
   axe mesh; fishing can keep the empty-hand `Idle_Rail_Loop`; bow still has no suitable substitute.
7. **No armour above ranger leather.** No metal helm, plate chest, gauntlets or greaves.
   *Substitute:* the ranger set is the top tier for Phase 1. Tint the ranger pieces cooler
   and darker for higher tiers. `outfit_*_ranger_hood` stands in for the helmet slot.
8. **No dedicated dungeon kit.** `lowpoly-modular-dungeon-pack` (48 pieces) is OBJ/FBX only.
   *Substitute:* the Medieval Village brick set carries it. `wall_brick_straight`,
   `wall_brick_door`, `corner_brick`, `floor_brick`, `floor_cobble`, `stairs_stone`,
   `wall_arch` for the gateway, `support_beam` as a pillar, `rubble_brick_1..4` +
   `rubble_vase` for debris, `vine_1/2` + `tree_dead_*` for the overgrown ruin read,
   `torch`/`lamp_wall` as braziers, `cage` as a portcullis. Light it dark and it works.
9. **No cliff or boulder meshes in the Stylized Nature MegaKit.** Its largest rock is
   `rock_medium_1` at 3.2 m — far too small for tier-10 highlands.
   *Substitute:* the platformer pack's `cliff_step_1..3`, `cliff_tall`, `boulder_large`,
   `boulder_medium` (5-7 m). Single `Rock` material, so tint them to match the nature kit's
   rock palette and the style clash mostly disappears.
10. **No water surface, no water assets at all.** The `water` manifest category is defined
    but empty.
    *Substitute:* this is shader work, not an asset. A plane with a scrolling normal /
    colour shader written in `game/src/` covers rivers, the fishing spot and the coast.
    Nothing to fetch.
11. **No wells, signs, campfire/fire mesh, or forge.**
    *Substitute:* well = `wall_brick_straight` scaled down into a ring + `roof_log` cross
    beam + `bucket_wood` on `rope_coil`. Sign = `banner_1` or a scaled `crate_wood` plank
    with a text texture. Campfire = `cooking_pot` over `roof_log` pieces plus a particle
    effect. Forge = `cauldron` + `anvil` + `torch` grouped.
12. **No animal meshes** (cows, chickens, sheep for the farm).
    `lowpoly-animated-animals` is OBJ/FBX only. No substitute. Leave livestock out of
    Phase 1, or reuse `enemy_crab`/`enemy_blob` as ambient critters.
13. **Trees have no LODs and no wind.** 41 nature assets, 20 of them trees at 7-7.3 m and
    150-520 KB each. At 60 FPS on a mid-range desktop these must be instanced
    (`InstancedMesh`) and distance-culled, not placed as individual meshes. Same for grass
    and flowers.

## Animation clips

Both libraries are humanoid, in-place (root motion variants exist in the zips as `_RM` and
were deliberately not shipped). Retarget onto `base_male` / `base_female` by node name.

### `animation_library_1` — UAL1, 43 clips, 2.25 MB

`A_TPose`, `Crouch_Fwd_Loop`, `Crouch_Idle_Loop`, `Dance_Loop`, `Death01`, `Driving_Loop`,
`Fixing_Kneeling`, `Hit_Chest`, `Hit_Head`, `Idle_Loop`, `Idle_Talking_Loop`,
`Idle_Torch_Loop`, `Interact`, `Jog_Fwd_Loop`, `Jump_Land`, `Jump_Loop`, `Jump_Start`,
`PickUp_Table`, `Pistol_Aim_Down`, `Pistol_Aim_Neutral`, `Pistol_Aim_Up`,
`Pistol_Idle_Loop`, `Pistol_Reload`, `Pistol_Shoot`, `Punch_Cross`, `Punch_Jab`,
`Push_Loop`, `Roll`, `Sitting_Enter`, `Sitting_Exit`, `Sitting_Idle_Loop`,
`Sitting_Talking_Loop`, `Spell_Simple_Enter`, `Spell_Simple_Exit`,
`Spell_Simple_Idle_Loop`, `Spell_Simple_Shoot`, `Sprint_Loop`, `Swim_Fwd_Loop`,
`Swim_Idle_Loop`, `Sword_Attack`, `Sword_Idle`, `Walk_Formal_Loop`, `Walk_Loop`

### `animation_library_2` — UAL2, 43 clips, 2.40 MB

`A_TPose`, `Chest_Open`, `ClimbUp_1m`, `Consume`, `Farm_Harvest`, `Farm_PlantSeed`,
`Farm_Watering`, `Hit_Knockback`, `Idle_FoldArms_Loop`, `Idle_Lantern_Loop`,
`Idle_No_Loop`, `Idle_Rail_Call`, `Idle_Rail_Loop`, `Idle_Shield_Break`,
`Idle_Shield_Loop`, `Idle_TalkingPhone_Loop`, `LayToIdle`, `Melee_Hook`, `Melee_Hook_Rec`,
`NinjaJump_Idle_Loop`, `NinjaJump_Land`, `NinjaJump_Start`, `OverhandThrow`, `Shield_Dash`,
`Shield_OneShot`, `Slide_Exit`, `Slide_Loop`, `Slide_Start`, `Sword_Block`, `Sword_Dash`,
`Sword_Heavy_Combo`, `Sword_Regular_A`, `Sword_Regular_A_Rec`, `Sword_Regular_B`,
`Sword_Regular_B_Rec`, `Sword_Regular_C`, `Sword_Regular_Combo`, `TreeChopping_Loop`,
`Walk_Carry_Loop`, `Yes`, `Zombie_Idle_Loop`, `Zombie_Scratch`, `Zombie_Walk_Fwd_Loop`

### Mapping to Corealm skills

| Need | Clip |
|---|---|
| idle / walk / run / sprint | UAL1 `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop` |
| melee combat | UAL2 `Sword_Regular_A/B/C`, `Sword_Regular_Combo`, `Sword_Heavy_Combo`, `Sword_Block`; UAL1 `Sword_Attack`, `Sword_Idle` |
| take damage / die | UAL1 `Hit_Chest`, `Hit_Head`, `Death01`; UAL2 `Hit_Knockback` |
| woodcutting | UAL2 `TreeChopping_Loop` |
| **mining** | **no clip** — reuse `TreeChopping_Loop` or UAL2 `Melee_Hook` |
| **fishing** | **no clip** — UAL2 `Idle_Rail_Loop` is the closest read |
| farming | UAL2 `Farm_PlantSeed`, `Farm_Watering`, `Farm_Harvest` |
| cooking / eating | UAL2 `Consume`; UAL1 `Fixing_Kneeling` for crafting |
| looting / banking | UAL2 `Chest_Open`; UAL1 `PickUp_Table`, `Interact` |
| magic | UAL1 `Spell_Simple_Enter/Idle_Loop/Shoot/Exit` |
| NPC idles | UAL1 `Idle_Talking_Loop`, `Sitting_*`, `Dance_Loop`; UAL2 `Idle_FoldArms_Loop`, `Idle_Lantern_Loop` |
| undead / dungeon enemy | UAL2 `Zombie_Idle_Loop`, `Zombie_Walk_Fwd_Loop`, `Zombie_Scratch` |
| swimming | UAL1 `Swim_Fwd_Loop`, `Swim_Idle_Loop` |
| unusable | UAL1 `Pistol_*` (6 clips), `Driving_Loop`; UAL2 `Idle_TalkingPhone_Loop` |

## Notes for the root

- `game/public/assets/manifest.json` remains the asset contract. The legacy Quaternius builder and
  Unity magic importer are separate pipelines that write compatible pack and asset records.
- **Glean:** `chest_wood` is animated — `Chest_Open`, `Chest_Close`, `Chest_Opened`,
  `Chest_Closed`. Use it for the bank rather than faking a lid.
- Output GLBs use **KHR_mesh_quantization** on unskinned meshes. three.js `GLTFLoader`
  reads this natively with no decoder setup. No Draco, no Meshopt, no KTX2 — deliberately,
  so nothing extra has to be wired into the loader.
- Foliage materials use `alphaMode: MASK` with `alphaCutoff` around 0.2 and are
  double-sided. Do not force `alphaTest: 0` or the leaves turn into solid cards.
- `outfit_female_peasant_chest` ships a stray `Jog_Fwd_Loop` clip in its source glTF. It is
  harmless and was left alone; ignore it.
- Every asset from Ultimate Platformer Pack is tagged `placeholder-style`. That is the
  query for a future art pass.
- At the time of the original Phase 1 asset run, `npm run typecheck` reported errors in
  `game/src/render/camera.ts` and an `EventBus` type mismatch. That note is historical and does not
  describe the current build status.
  `tools/build-assets.ts` and `tools/fetch-assets.ts` typecheck clean.
- Not added to `package.json`: nothing. The pipeline uses only the already-installed
  `@gltf-transform/*` and `sharp`, plus a ~120-line ZIP reader written into
  `tools/build-assets.ts` because the repo has no declared zip dependency and I may not
  add one.
