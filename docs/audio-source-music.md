# Corealm music source ledger

This ledger covers the music copied for the shipped Phase 1 regions. The supplied source library is
`C:\Users\Borg\Music\corealm`; the browser-served destination is
`game/public/audio/music/`.

## Shipped mappings

Fallowmarch has two eligible plains tracks in its music pool. The game may choose either as a
regional variant; they are not intended for any other region.

| Region mapping | Supplied source | Shipped destination | Size (bytes) | Duration (s) | SHA-256 (source = destination) |
| --- | --- | --- | ---: | ---: | --- |
| Fallowmarch - plains variant | `C:\Users\Borg\Music\corealm\Starter Plains.mp3` | `game/public/audio/music/starter-plains.mp3` | 2,943,873 | 124.373500 | `4ab0b2615e306d3af639cb7b412f90209aa769d3ddec4a438abc386f9152c251` |
| Fallowmarch - plains variant | `C:\Users\Borg\Music\corealm\Distant Plains.mp3` | `game/public/audio/music/distant-plains.mp3` | 3,473,739 | 143.733500 | `77fd9289f3c1edd63d78a4199e0192333f8b9cb796e738d4abd98491fad78f16` |
| Vellenwood | `C:\Users\Borg\Music\corealm\Deep Woodland.mp3` | `game/public/audio/music/deep-woodland.mp3` | 2,913,502 | 124.613500 | `a592c847e36a94dec8e2752d0ac076be0ee8f428b131dd224e1dab8231f38789` |
| Karrowmoor | `C:\Users\Borg\Music\corealm\Stone city.mp3` | `game/public/audio/music/stone-city.mp3` | 2,440,565 | 107.493500 | `21cfd425eed058030b9731a3ede916c4ccd46e825306f5890f84bf7fd69c17f2` |

Durations were read with `ffprobe` from the supplied MP3s. Every destination hash matches its
source hash, so the files were copied as supplied without transcoding or other audio changes. The
destination names are lowercase kebab case.

## Source and rights information

The four copied files contain these embedded tags:

| Track | Embedded title | Embedded artist | Embedded comment |
| --- | --- | --- | --- |
| `starter-plains.mp3` | `Starter Plains` | `phreesplox` | `made with suno; created=2026-08-28T02:54:02Z; id=f7f5731a-7350-455e-aa45-1b5070573b0e` |
| `distant-plains.mp3` | `Distant Plains` | `phreesplox` | `made with suno; created=2026-08-28T02:25:52Z; id=4019751a-22f8-455f-9843-933e7b7fb62f` |
| `deep-woodland.mp3` | `Deep Woodland` | `phreesplox` | `made with suno; created=2026-08-28T02:54:01Z; id=56e18f3d-0274-4aac-864f-550c271b6db0` |
| `stone-city.mp3` | `Stone city` | `phreesplox` | `made with suno; created=2026-06-08T02:26:42Z; id=302a7517-e41e-43ee-9c50-32129adcf3ca` |

The repository owner supplied these files from their local library and explicitly directed this
run to include them in Corealm, which is the project authorization for this integration. No
separate ownership statement, copyright holder, license name, license URL, or reusable permission
record was present in the source directory or embedded tags. The only attribution information
discoverable here is the embedded artist value `phreesplox` and the comments above. This ledger
therefore does not claim that the tracks are CC0, royalty-free, or available for reuse outside
Corealm; anyone distributing the project still needs to retain the owner's applicable rights
record separately.

## Intentionally not copied

The supplied library also contains `Desert.mp3`, `Jungle.mp3`, `Goblin Village.mp3`, `Mire Swamp.mp3`,
and `Swamp.mp3`. They are reserved for future regions and are not used by Phase 1.
There is no supplied Gravelmaw-matching track, so Gravelmaw intentionally has no music asset.
