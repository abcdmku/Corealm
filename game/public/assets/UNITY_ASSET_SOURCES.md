# Unity Asset Store source ledger

Corealm publishes six GLBs and one texture atlas derived from four Unity Asset Store packages. These outputs are not CC0. The local package files and their hashes identify the exact inputs used on this machine, but they do not prove account ownership or a transferable licence. The project owner must confirm that the shipping project has the required Asset Store entitlement.

Do not redistribute the `.unitypackage` files. Use of the derived files remains subject to the [Standard Unity Asset Store EULA](https://unity.com/legal/as-terms).

## Package records

| Pack | Publisher | Official product page | Local package | Bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| FREE - RPG Weapons | Blink | [Unity Asset Store](https://assetstore.unity.com/packages/3d/props/weapons/free-rpg-weapons-199738) | `C:\Users\Borg\AppData\Roaming\Unity\Asset Store-5.x\Blink\3D ModelsPropsWeapons\FREE - RPG Weapons.unitypackage` | 206,662,212 | `22810F24F1D72CCBD3D1A091352E0E904A9A8A811235CF61A584750B83666717` |
| Rocks FREE pack | DEXSOFT | [Unity Asset Store](https://assetstore.unity.com/packages/3d/props/exterior/rocks-free-pack-98219) | `C:\Users\Borg\AppData\Roaming\Unity\Asset Store-5.x\DEXSOFT\3D ModelsPropsExterior\Rocks FREE pack.unitypackage` | 96,479,935 | `A81E0968A134F1720B028A534634377784A84F72294A95590B8361A8D176F5D2` |
| Altar Ruins Free | Underhill Labz | [Unity Asset Store](https://marketplace.unity.com/packages/3d/environments/fantasy/altar-ruins-free-109065) | `C:\Users\Borg\AppData\Roaming\Unity\Asset Store-5.x\Underhill Labz\3D ModelsEnvironmentsFantasy\Altar Ruins Free.unitypackage` | 1,227,562,495 | `FFFF7748CD1643D9A4F901E592836C7E09BACF3DB51B8C9BB7F704CF87D018D9` |
| Magic Effects FREE | Hovl Studio | [Unity Asset Store](https://assetstore.unity.com/packages/vfx/particles/spells/magic-effects-free-247933) | `C:\Users\Borg\AppData\Roaming\Unity\Asset Store-5.x\Hovl Studio\Particle SystemsMagic\Magic Effects FREE.unitypackage` | 38,212,995 | `2228DE7BA7F19934BE8B58C96E1D8CE50F20AC51777FCDAA7B4478EA64D0B44D` |

`tools/import-unity-magic-assets.ps1` checks the first three package hashes before it opens Unity. `tools/import-unity-magic-assets.ts` does not read the source packages. It normalizes the altar textures to a 2048 px maximum, audits the six exported GLBs, and enforces their recorded output hashes. The Hovl package hash is a reproduction record; `tools/build-assets.ts --verify` enforces the committed atlas hash recorded in `manifest.json`.

## Weapon and rock source paths

The staff uses:

- `Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/_PREFABS/Staff_Basic.prefab`
- `Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Staff/Staff.fbx`
- `Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Staff/Staff_Textures/Staff_Basic_BaseColor.png`
- `Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Staff/Staff_Textures/Staff_Basic_Normal.png`

The wand uses:

- `Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/_PREFABS/Wand_Basic.prefab`
- `Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Wand/Wand.fbx`
- `Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Wand/Wand_Textures/Wand_Basic_BaseColor.png`
- `Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Wand/Wand_Textures/Wand_Basic__Normal.png`

The large cache uses:

- `Assets/RockFREE/LODGroups/rock5_LOD0.prefab`
- `Assets/RockFREE/mesh/rock5_LOD0.fbx`
- `Assets/RockFREE/Materials/rock5_Albedo.mat`
- `Assets/RockFREE/Textures/rock5_Albedo.png`
- `Assets/RockFREE/Textures/rock5_Normal.png`

The satellite node uses:

- `Assets/RockFREE/LODGroups/rock2_LOD0.prefab`
- `Assets/RockFREE/mesh/rock2_LOD0.fbx`
- `Assets/RockFREE/Materials/rock2_Albedo.mat`
- `Assets/RockFREE/Textures/rock2_Albedo.png`
- `Assets/RockFREE/Textures/rock2_Normal.png`

The essence altar uses:

- `Assets/Altar_Ruins_FREE/Prefabs/Altar_2.prefab`
- `Assets/Altar_Ruins_FREE/Materials/Trim.mat`
- `Assets/Altar_Ruins_FREE/Textures/Trim_Sheet_Diffuse.jpg`
- `Assets/Altar_Ruins_FREE/Textures/Trim_Sheet_Normal.png`
- `Assets/Altar_Ruins_FREE/Textures/Trim_Sheet_AO.jpg`

The surrounding ruin site reuses the stone-kit prefab instances authored in `Assets/Altar_Ruins_FREE/Demo_Scenes/DemoScene.unity`. The converter excludes the terrain, vegetation, sky, lights, particles, and altar from this site file. The altar remains a separate semantic object so only it receives runtime elemental emission.

The Hovl atlas uses the sixteen source sprites listed in `vfx/ATTRIBUTION.md`. No Hovl prefab, material, shader, scene, or mesh is published. `tools/build-vfx-atlas.ts` converts those sprites into one greyscale 4x4 atlas for Corealm's Three.js particle renderer.

## Transactional GLB conversion

The converter uses a disposable Unity `6000.4.8f1` project and locally cached `com.unity.cloud.gltfast` `6.14.1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/import-unity-magic-assets.ps1
```

Unity imports all three packages before instantiating their prefabs and opening the ruin demo scene. This keeps Unity's FBX unit conversion, prefab transforms, normals, UVs, and orientation. The DEXSOFT prefabs named `rock*_LOD0.prefab` contain all four LODs, including a scaled built-in cube at the last rung. The exporter reads the `LODGroup` and keeps only its first registered renderer.

The wrapper exports into a sibling staging directory. The TypeScript audit normalizes the two altar GLBs, parses all six staged GLBs, matches their SHA-256 values, and prepares a merged manifest before publication begins. The wrapper then swaps the old magic directory to a backup, moves the staged directory into place, and replaces the manifest. Any publication error restores the prior directory. Export or validation errors never touch the live files.

The rock GLBs retain their source albedo and normal textures. Their materials have no emission. Runtime code applies the separate essence-vein mask and element colour. The Blink albedos are remapped by luminance onto a brown ramp, keeping their painted shading and normal maps while removing the green accent. Their materials also have zero emission.

## Output audit

Bounds are post-conversion glTF world-space axis-aligned bounds in metres. Vertex counts are glTF position-accessor counts.

| Manifest ID | File | Bytes | Size x/y/z | Base x/y/z | Vertices | Triangles | SHA-256 |
| --- | --- | ---: | --- | --- | ---: | ---: | --- |
| `rpg_weapon_staff` | `models/magic/rpg_weapon_staff.glb` | 5,529,124 | 0.219174 / 2.211488 / 0.219174 | -0.109587 / -1.334934 / -0.109587 | 2,865 | 2,616 | `989156E7BC8A8269E0848C40A15AD7C4D92A4E53370C2A831BF49099EB4ED31A` |
| `rpg_weapon_wand` | `models/magic/rpg_weapon_wand.glb` | 5,287,112 | 0.176500 / 0.984895 / 0.145459 | -0.140763 / -0.318648 / -0.074656 | 1,358 | 2,130 | `BBC7BC761773E658C4A0C8CCF30F175ADE391A11A87D85CC8E4866056328B929` |
| `rocks_free_essence_cache` | `models/magic/rocks_free_essence_cache.glb` | 1,866,916 | 30.604338 / 10.672737 / 17.552934 | -15.516834 / -1.861926 / -9.417816 | 676 | 1,030 | `AC63B7F26CD8E7A489223275193409507521DCF27234CC74A225766ECD4EEEC9` |
| `rocks_free_essence_node` | `models/magic/rocks_free_essence_node.glb` | 1,979,224 | 5.283702 / 5.158862 / 5.287107 | -2.462837 / -2.508910 / -2.477444 | 1,075 | 1,560 | `C1C3C2AF9EAED4027D80C84ED64422C9FB261EABC8BC275334A6A834FB541A1D` |
| `altar_ruins_altar` | `models/magic/altar_ruins_altar.glb` | 11,951,032 | 2.099449 / 0.946015 / 0.954679 | -1.049726 / 0.007741 / -0.477339 | 862 | 796 | `821047016861542C1244638237BA634D32BAA5D2DF3C15F069E7B8109E2CDF18` |
| `altar_ruins_site` | `models/magic/altar_ruins_site.glb` | 13,229,416 | 20.169445 / 9.601515 / 19.854203 | -10.271879 / -2.270430 / -9.288219 | 27,136 | 14,720 | `63BB98E1C5ED8714E5AEF1F282BBAD7DFC2B6642C978B891041DB38E71C288BA` |

| Artifact ID | File | Bytes | Dimensions | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `spell_vfx_atlas` | `vfx/spell-atlas.png` | 370,899 | 1024 x 1024 | `0A22D7EB356B42D217813F4A5F5704503120BEC77FE8295E6303C4E445336A95` |

Run the committed-output audits without launching Unity:

```powershell
npx tsx tools/import-unity-magic-assets.ts
npx tsx tools/build-assets.ts --verify
```
