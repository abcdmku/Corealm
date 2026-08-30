# Corealm Nox audio source ledger

This ledger covers the small Nox_Sound_Design set copied into the browser audio library. The
source is the [Essentials Series asset page](https://nox-sound-design.itch.io/essentials-series-sfx-nox-sound),
retrieved on 2026-08-29.

## Source and rights

The page lists one free download, `Essentials_Series_NOX_SOUND.zip`, reported as 988 MB. The
downloaded archive was 1,036,374,981 bytes and had this SHA-256:

`0df9a98cc8d0499787cb3c29f3e278fdacd75ca3e94106828ea8b5c115ae8d3d`

The page grants personal and commercial use and identifies the sounds as CC0, with no attribution
restriction. The archive also contains `Essentials_Series_NOX_SOUND/Essentials_Series_README.pdf`,
which says, "All these sounds are under CC0 license." The extracted README was 44,453 bytes with
SHA-256 `c1a46c29dfe5a03dcf0f033396aa5ec6cb1761300ff3bde1212a53247a5cba84`.

The archive paths below are the exact upstream filenames. Source hashes are SHA-256 hashes of the
24-bit WAV entries. Shipped hashes are SHA-256 hashes of the generated Ogg files.

## Shipped footsteps

The source records footsteps at 48 kHz, 24-bit PCM, mono. Each pair is a walk variant. The
`forest` pair uses the source's leaves surface, `stone` uses gravel, and `cave` uses rock because
the pack has no separate cave-footstep recording.

| Shipped file | Exact upstream filename | Duration (s) | Source SHA-256 | Shipped SHA-256 |
| --- | --- | ---: | --- | --- |
| `game/public/audio/sfx/nox/footstep-grass-01.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Grass/Footsteps_Grass_Walk/Footsteps_Walk_Grass_Mono_01.wav` | 0.562792 | `a452be5e6489743a6b9218b1a1e13c82af5e4a2f5c8317c5aed7890ffdd74b6f` | `7c9bfa2caea42ac208d313cc368586706ccf5d723a142273b07949c3c8b81dea` |
| `game/public/audio/sfx/nox/footstep-grass-02.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Grass/Footsteps_Grass_Walk/Footsteps_Walk_Grass_Mono_02.wav` | 0.541938 | `a6e4e427da32c2fb3ebcd80d413d614db94859ec4997516f9b388e49ce9aa0b3` | `02a4eaf0f2d6db628d6b64c1d04379287e93cadce404209fe8a9378c03f390ba` |
| `game/public/audio/sfx/nox/footstep-forest-01.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Leaves/Footsteps_Leaves_Walk/Footsteps_Leaves_Walk_01.wav` | 0.698479 | `42a2a2d2f3d80792bcc3a37bf06fe5d127a70b23de935d46ff6e8a3a40b23c6b` | `7e0d066e00aef9e3e4f315281f787760070d7bc89c610e7e3ee111743502b9b1` |
| `game/public/audio/sfx/nox/footstep-forest-02.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Leaves/Footsteps_Leaves_Walk/Footsteps_Leaves_Walk_02.wav` | 0.483292 | `bf17fde9102b6fe3b1fa39f98cad3029e45be49fa81afa271ecc8ddfa34c84dc` | `747ba1c3bd74455f7e46d94c4449abb2006b687c4452ad4237120cccdaa8e511` |
| `game/public/audio/sfx/nox/footstep-stone-01.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Gravel/Footsteps_Gravel_Walk/Footsteps_Gravel_Walk_01.wav` | 0.753688 | `bcfc3d7966423f71ba89917944961299802403bd4c1af7f1839e7df4ba0d9cde` | `efddbe48edc5fec5cc32bbd1a11ad30ab2b88a5f402a88432917361c2b06817e` |
| `game/public/audio/sfx/nox/footstep-stone-02.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Gravel/Footsteps_Gravel_Walk/Footsteps_Gravel_Walk_02.wav` | 0.610750 | `f42d3b6e6afc5854a83788a63e6d936144026481fbcd50e82fff10fb659c4f36` | `3f7582006b1b7666962b1456682ca88e378a68795991c04714e70041289ef64b` |
| `game/public/audio/sfx/nox/footstep-cave-01.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Rock/Footsteps_Rock_Walk/Footsteps_Rock_Walk_01.wav` | 0.436104 | `156069957f17b89d191497184a409b7f12ac7ff1c64596256bcfcd5922f7bd4e` | `95b180daefa41505b9707f0c49fa499557dd6ee1eb75caf26e6c34ffac741f05` |
| `game/public/audio/sfx/nox/footstep-cave-02.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Rock/Footsteps_Rock_Walk/Footsteps_Rock_Walk_02.wav` | 0.420125 | `8a50ae1e8a324dea229d736277f8f99616295ce596bb9359cff269723fd1b65f` | `5f34ac86705a86c5ccc83c48cf1663ed5dd5c27df7b4615f76e918b2d6a2f00c` |
| `game/public/audio/sfx/nox/footstep-wood-01.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Wood/Footsteps_Wood_Walk/Footsteps_Wood_Walk_01.wav` | 0.448208 | `ced3c3e067d9e9e7d46075a5cfdcc8063153c0099c076fdfa27cd171f16f18d6` | `c0984b6839a2d0a340cbaede52cf75884bdd9018d3ce0d175c5d1d8d75361451` |
| `game/public/audio/sfx/nox/footstep-wood-02.ogg` | `Essentials_Series_NOX_SOUND/Footsteps_Essentials_NOX_SOUND/Footsteps_Wood/Footsteps_Wood_Walk/Footsteps_Wood_Walk_02.wav` | 0.472208 | `0fbf01e67ceeefa6489d3b82d070c3b03df67ea4daf12503da7aa46a97c9b03b` | `d65eb3423b04493a91d3d7196cb7f10d90ba7bdd3c637270aab8d99f6c669e48` |

## Shipped region loops

The source page describes the Nature Essentials files as looped stereo ambience at 48 kHz, 24-bit
PCM. The source durations are retained. No silence was trimmed, and no loop points were moved.

| Shipped file | Exact upstream filename | Duration (s) | Source SHA-256 | Shipped SHA-256 |
| --- | --- | ---: | --- | --- |
| `game/public/audio/ambience/nox/open-plains-wind.ogg` | `Essentials_Series_NOX_SOUND/Nature_Essentials_NOX_SOUND/Ambiance_Wind_Calm_Loop_Stereo.wav` | 29.852083 | `5ccce3e44482edb3ae65e6cf1662e208e90a182181664f7ac6b05778e8671baa` | `a1d96297b9e8d5e9a91573e8253d3afd510fcc9064fb2b641687bba978deabb3` |
| `game/public/audio/ambience/nox/rocky-highlands-wind.ogg` | `Essentials_Series_NOX_SOUND/Nature_Essentials_NOX_SOUND/Ambiance_Wind_Calm_Loop_Stereo.wav` | 29.852083 | `5ccce3e44482edb3ae65e6cf1662e208e90a182181664f7ac6b05778e8671baa` | `a1d96297b9e8d5e9a91573e8253d3afd510fcc9064fb2b641687bba978deabb3` |
| `game/public/audio/ambience/nox/deep-woodland-wind.ogg` | `Essentials_Series_NOX_SOUND/Nature_Essentials_NOX_SOUND/Ambiance_Wind_Forest_Loop_Stereo.wav` | 29.919021 | `e2ec7e5d2e74db52bc21a5b1830c2b983ec8270e976d6b0ef393912f6d383133` | `15a1f6a730b68499ee9d829a04a3125ace2c2a75a7310df99264b3ce3a475056` |
| `game/public/audio/ambience/nox/deep-woodland-birds.ogg` | `Essentials_Series_NOX_SOUND/Nature_Essentials_NOX_SOUND/Ambiance_Forest_Birds_Loop_Stereo.wav` | 29.067563 | `98b1d9ea7542b496d97a182fcee828bc5d0df39b857ef3b7323c592912e1d372` | `13c227dc2549e122be121acb4bcb6d571241cc8dd8cb3d94f92369589acb704b` |
| `game/public/audio/ambience/nox/cave-room-tone.ogg` | `Essentials_Series_NOX_SOUND/Nature_Essentials_NOX_SOUND/Ambiance_Cave_Deep_Loop_Stereo.wav` | 30.002229 | `87fc00d603a386edb41816bbfc2e0bf96c85e393ef8c37f77db33df787eb1c7f` | `705e51c90e435cb4f6c9dcd2f7c60e708cbc19627391797431d876233eebeb28` |

`rocky-highlands-wind.ogg` is a byte-for-byte copy of the encoded plains wind. The pack has one
generic calm-wind recording and no separate highland or mountain wind. Keeping the alias makes that
limitation visible to the catalog instead of pretending that a different field recording exists.

## Shipped cooking cue

The cooking completion cue is a compact window from the pack's literal small-campfire recording.
It uses seconds 0.7 through 2.1, where several clear crackle transients occur, with a 150 ms
fade-out so the excerpt does not cut abruptly.

| Shipped file | Exact upstream filename | Source duration (s) | Shipped duration (s) | Source SHA-256 | Shipped SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| `game/public/audio/sfx/nox/campfire-crackle-01.ogg` | `Essentials_Series_NOX_SOUND/Nature_Essentials_NOX_SOUND/Ambiance_Firecamp_Small_Loop_Mono.wav` | 9.722813 | 1.400000 | `54e84f0d4cda818248a9ea2a970330f53757354a93ce8b1fbab2e5d7937121c6` | `b63501bea76c46f8c6361d4fa57d644ef2fa41b89d6695f59b5ef5ea8c212795` |

The source is 1,400,870 bytes, 48 kHz, 24-bit PCM mono. The shipped Vorbis file is 20,954 bytes,
48 kHz mono. It is used only for cooking, not as a success chime or a region loop.

## Conversion

The source WAVs were converted with ffmpeg 8.1.1 using libvorbis quality 5:

```text
ffmpeg -i input.wav -map_metadata -1 -c:a libvorbis -q:a 5 output.ogg
```

The conversion stripped source tags and kept the native 48 kHz sample rate and channel count. The
footsteps and region loops did not receive gain, EQ, resampling, silence removal, or time
stretching. The cooking excerpt is the one documented trim and fade above. All resulting files
decode as Vorbis in Chromium-friendly Ogg containers. The long ambience entries remain the
creator's loop recordings rather than shortened snippets.

## Curation decisions

The selected set covers the shipped region surfaces and the wood floors, bridges, and timber work
that appear in settlements. Fallowmarch gets grass and open wind. Vellenwood gets leaves, forest
wind, and birds. Karrowmoor gets gravel and the generic calm wind alias. Gravelmaw gets rock steps
and the deep cave loop. Wood steps remain available for timber interiors and raised paths.

The following source groups were reviewed but not shipped:

- `Electromagnetic_NOX_SOUND`: modern electronic devices, so it does not belong in Corealm's
  medieval-fantasy sound bed.
- `Vehicle_NOX_SOUND`: cars, trucks, horns, engines, and related vehicle sounds.
- `Voices_Essentials_NOX_SOUND`: vocal efforts and reactions are outside this small regional
  footstep and ambience set.
- Footstep surfaces for dirty ground, metal, mud, sand, snow, hard snow, tile, and water: no
  current Phase 1 region needs them, and adding every surface would turn a curated set into the
  full pack.
- Nature loops for cave dark, cave drips, cicadas, night, rain, river, sea, stream, and waterfalls:
  they are not needed by the current region selector. The campfire is the sole exception and is
  shipped only as the documented short cooking cue.

No modern, electronic, cartoon, firearm, vehicle, or horror-stinger recording was accepted.
