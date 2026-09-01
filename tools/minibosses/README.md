# Miniboss asset pipeline

Turns the **Fantasy Monster 3D Model 02** Unity package into the four miniboss variants Corealm
ships, and two Blink weapon packages into the rare drops they guard.

This is `tools/bosses/` with different source packs. Read `tools/animals/README.md` first — the
conversion, the clip-naming contract, the root-motion trap and the tier-tint exemption are all the
same and none of it is repeated here — then `tools/bosses/README.md` for the one-rig-many-skins
reasoning, which applies verbatim. What follows is only what differs.

## One rig, four palettes

Galeskin (air), Mossbound (earth), Tideworn (water) and Cinderwake (fire) are one Monster02 rig
wearing four of the pack's own colour maps. Unlike the bosses there is no recolouring pass:
PixeliusVita shipped every palette as a finished PNG, so `catalog.mjs` points each id at its file
and there is no `stage-textures.py` in this directory because there is nothing to stage.

## Licence

Not CC0, same framing as the animal and boss packs: all three sources are Unity Asset Store
products used under the Standard Unity Asset Store EULA, recorded as such in the manifest, with
per-file `sha256` on every asset row instead of an archive hash. Package identities and hashes are
ledgered in `game/public/assets/UNITY_ASSET_SOURCES.md`. The product URLs in `catalog.mjs` are
store searches, not permanent package ids — same TODO as the boss pack.

## Prepare the source

Three `.unitypackage` files, extracted the usual way (each `<guid>/asset` written to the path in
`<guid>/pathname`), rooted at:

```
.asset-cache/miniboss-pack/raw/   <- Fantasy Monster 3D Model 02 - Game Ready (PixeliusVita)
.asset-cache/sword-pack/raw/      <- FREE - Low Poly Swords - RPG Weapons (Blink)
.asset-cache/staff-pack/raw/      <- FREE - Stylized Weapons (Blink)
```

The monster textures are used raw - plain RGB, no legacy alpha-gloss channel to strip (checked,
unlike the animal pack). The weapon base-colour and emissive maps need one staging pass:

```bash
python tools/minibosses/stage-textures.py    # hue-neutralizes into .asset-cache/weapon-tex/
```

## Build

```bash
npx tsx tools/build-minibosses.ts                          # all six, updates manifest.json
npx tsx tools/build-minibosses.ts --only miniboss_galeskin
npx tsx tools/build-minibosses.ts --keep-raw
```

Outputs go to `game/public/assets/models/miniboss/`, entries merge into
`game/public/assets/manifest.json`, and the durable copy lives in `tools/data/miniboss-assets.json`.

## Check the result

```bash
npx tsx tools/minibosses/audit.mjs     # clips, root-motion, bounds, textures, of the shipped GLBs
```

## Judgement calls this pipeline recorded

**Named takes instead of files.** The rig ships ONE FBX carrying eleven named AnimStacks, which is
why `tools/animals/convert.js` grew its `take` selector: each catalog clip entry is
`{ take: "Monster02_Idle", name: "Idle" }` and the converter resolves the AnimStack by name. A
missing take fails that clip's build outright — no fallback to `animations[0]`, whose order in
this file is not the authored order (measured: Idle, Attack02, Stunned, Die, ...). The builder
also re-checks the OPTIMIZED file carries exactly the six canonical clips, because the failure
mode of a leaked `Shoot` or `Stunned` is invisible until an entity plays it.

**Units are centimetres, unverified claims aside.** The rig measures 199.7 source units tall;
plain `CM_TO_M` lands it at 2.00 m, which sits where a miniboss belongs — above `animal_bear`
territory, below the 2.63 m orb boss. No RHINO-style 0.1 correction needed. Measured with
`probeFbx` before the first build, not assumed.

**Material names carry a `boss_` prefix on top of the id.** `render/entityViews.ts` exempts
`/^(animal|boss)_/i` materials from the tier tint, and `miniboss_galeskin_mat` starts with
neither, so the authored palettes would be pulled 45% toward Kaldite blue-black at depth. The
materials are named `boss_miniboss_<variant>_mat`: redundant to read, but it satisfies the regex
contract without touching the renderer and keeps the full asset id greppable from the material
name. Weapons are equipment the tint never sees; they follow the `rpg_weapon_staff_material`
convention as `miniboss_<kind>_material`.

**`Hit` ships even though the renderer cannot play it yet.** `Monster02_GetHit` is 0.67 s and a
few kilobytes; carrying it costs nothing and a future flinch reaction needs no rebuild.

**Weapon scale is measured per source, like `RHINO_EXTRA_SCALE`.** The sword file is 2.35 m long
at plain `CM_TO_M` — a display piece — and ships at 1.25 m (x0.5325). The staff file is 0.94 m and
ships at 1.75 m (x1.8585). Both sit inside the real-world bands the rpg_* weapons established.

**Weapon pivots are authored grips and are kept; only the sword's X is fixed.** Both meshes are
authored head-up along +Y with the origin at the grip (the sword's crossguard sits exactly at
y=0; the staff's grip is just below its crystal, matching how `rpg_weapon_staff` keeps its Unity
pivot at 60% height). The sword mesh is ALSO parked ~2.4 units up +X — its slot in the artist's
lineup scene — which the converter's `recenterXZ` discards while leaving the grip height alone.
Verified by rendering both meshes before the first build, not inferred from vertex statistics.

**The sword ships the Iron variant.** Sword15 has Earth/Frost/Iron/Lava material variants; Iron is
the neutral metal-and-leather read, and per-item elemental tinting happens in-engine later, so the
base must not pre-commit to an element.

**Weapon maps are hue-neutralized, because the runtime accent owns the hue.** Four regional rare
drops share each geometry, and `render/equipmentVisuals.ts: tintedMaterial` recolours a drop by
REPLACING `material.color` and `material.emissive` with the region's accent - which the shader
then multiplies against the maps, and a multiply cannot overrule a saturated texel. Shipped with
Blink's authored orange crystal and ember emissives, all four regional staves glowed fire-coloured
in the lab: cyan times orange is orange. `stage-textures.py` therefore greys the albedos'
strongly-saturated regions to light grey (with a gamma lift, since a multiply can only darken) and
converts both emissive maps to normalized grayscale. The emissive factor ships white at
`KHR_materials_emissive_strength` 1.2 - the intensity `tintedMaterial` forces whenever an emissive
map is present - so the level the authored `_EmissionColor` strengths (2.83 / 6.06) used to carry
now lives in the map. Verified by re-rendering under simulated cyan/moss/cobalt/ember accents:
each accent reads as its own colour on crystal, runes and glow.

**Weapons keep normal maps, drop metallic/AO.** The imported `rpg_weapon_*` GLBs ship their normal
maps and an equipped item is inspected close-up, so the baked detail earns its bytes. Metallic and
AO would need repacking into one ORM image for glTF, which is not worth it for stylized props
whose albedo already paints the metal — scalar roughness/metalness per weapon instead, recorded in
`catalog.mjs`.

**The staff mesh is resolved through the prefab's GUID chain, not its filename.** `Staff2_2_6`
names a material and a prefab; the mesh lives in `STAFF_EVO_02_V2.fbx`, found by following the
prefab's mesh GUID (`ed131d73eb72abe4b8f101dd0e896ad8`) to the FBX `.meta`. The file holds a
single mesh (`STAFF_02_V2`), so the prefab's sub-asset fileID needs no further resolution.
