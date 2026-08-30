# FilmCow Vol. 1 audio source report

Status: approved for Corealm game embedding.

## Source and license evidence

- Official source: [FilmCow Royalty Free Sound Effects Library](https://filmcow.itch.io/filmcow-sfx).
- The official page describes a name-your-price pack with a $0 download path. It lists a Recorded archive, a Designed archive, and `license.pdf`. This curation uses only individual files from the Recorded collection. The full archives are not in this repository.
- License copy retrieved from the official itch.io download flow: `license.pdf`, SHA-256 `bda56a077aa8ba8e053ae916dd4c19038baa12cd33d10209658646ac9351b73f`.
- The signed $0 download flow offered the license and the two pack archives without payment. That confirms the pack is downloadable without a paywall.
- The [individual-file mirror](https://github.com/mcdoolz/filmcow-recorded-sounds) is linked from the official page comments. Its README says it is the Recorded collection downloaded from itch.io and split into individual files. Retrieval used mirror commit `0c234faec13f4b021224c840eac38906421bbf02` so the selected source paths are reproducible.

For each row below, the source URL is `https://raw.githubusercontent.com/mcdoolz/filmcow-recorded-sounds/0c234faec13f4b021224c840eac38906421bbf02/<original-path>` with spaces URL-encoded. The SHA-256 value is for the downloaded WAV, not a Git blob hash.

The downloaded license names Jason Steele as licensor and grants a worldwide, non-exclusive, perpetual, royalty-free license. Section 2 expressly allows use in games and commercial projects. Section 3 forbids claiming authorship of the sounds, re-selling the sounds, and use in national-government projects, law-enforcement projects, or projects made by a group categorized as a hate group by the SPLC or CAHN. Credit is not required by the itch page. Corealm uses these files as embedded game audio and does not offer them as a standalone sound pack.

This is a source record, not legal advice. Re-check with the licensor before any future standalone audio distribution or a project that could fall within a restricted category.

## Transform and verification

The selected sources are mono, 48 kHz, 24-bit PCM WAV files. Each shipped file was converted to mono, 48 kHz Ogg Vorbis at encoder quality 4, with source metadata removed. A gain pass sets the measured source peak to -3 dBFS. No source was trimmed or time-stretched. Durations below come from `ffprobe` after conversion and match the source duration to the reported precision.

The shipped directory contains 18 Ogg files and no source archive. All files were checked as Ogg Vorbis, mono, 48 kHz streams.

| Shipped file | Cue family | Original FilmCow filename | Duration (s) | Gain (dB) | Source SHA-256 | Shipped SHA-256 |
| --- | --- | --- | ---: | ---: | --- | --- |
| `cloth-movement-01.ogg` | cloth/equipment | `C/clothing movement 14.wav` | 1.954979 | +11.9 | `b867e5be2923abf84cfe651a2f7853c27231f9e9cae818b6e804ef24150bb91c` | `77f1e53d7e2596e65bcef366eb61429a76a9e90dd6f90033db2f5e005280f6b0` |
| `cloth-ruffle-01.ogg` | cloth/equipment | `C/clothes ruffle 2.wav` | 2.257021 | +12.4 | `fa4d76faea79ad827eee9d26676a26b364768fd7dbd55b623d81c91497f01613` | `af8131ce6c31d3fa03de312a82cebdf0cc7cdc3840420a09d1b25fec29e294a1` |
| `loot-rocks-handle-01.ogg` | loot handling | `R/rocks handle 14.wav` | 1.208688 | -3.0 | `7bc6d3d82207247962ad09878b88d1dc9f970bb3b105daf23ff7a9bd856a2ac8` | `7e15c4da586883ad92d55db8db817811075188903c2cd6cb92d3adc7ad30de1e` |
| `loot-metal-drop-01.ogg` | loot handling | `M/metal hit floor small 4.wav` | 1.094625 | -1.0 | `80a055b7af92aa7842694908ff5c358fa634817cb309af80886cf9b048546a1b` | `0d46d3676899b1dfadba31a64a4273f6b1f463b6aac1d230cc38a3259547d6ce` |
| `chest-open-wood-01.ogg` | chest/bank open | `W/wood drawer opened 3.wav` | 0.648458 | +4.0 | `45b1c118040a6f4ad6802dae672779bd3c1f56e087da729b7c77685a8924e2cc` | `75d77e1916cd4343a415b9c316c4f93b6146d005cff72743da287e53c4a09263` |
| `chest-close-wood-01.ogg` | chest/bank close | `W/wood drawer closed 1.wav` | 1.045042 | +0.0 | `5212e352d44c99089960c8bb8ffef249f1de35ac2188a3343d1cef53fa474f38` | `4863b9cd6c568edbbcb8a380e1d54e24cff39232a7bac8cb480310658373e844` |
| `door-open-wood-01.ogg` | wooden door open | `D/door open 12.wav` | 0.538104 | -2.6 | `cef3323093bfd6f6be0e529b18fd495eb27eaa8edbe586c6af21eabfc061c68c` | `3fb7a5654b514fd0329afaf3e57e5d250b131d533fe264c7d44f21cafa1b320f` |
| `door-close-wood-01.ogg` | wooden door close | `D/door close 2.wav` | 0.774375 | -2.6 | `d7ced308f2a090de7e586b92e79a99d400ba57fc66df3e4bab5292dab6e5895a` | `482aa0c8f2fb8ca56aa04f2acb5aef03fd48696e0dc8318147afe721a6641cc7` |
| `door-latch-01.ogg` | door/chest latch | `M/metal latch 8.wav` | 0.718729 | -1.0 | `d00cfbf84b43242cb80cff37aa356bf33c1329b738a9384dcf670f710c0c4d6f` | `65ed21cf1388d2ba864f9170d505a186627da49a77a61bf7701dfcf57b687a55` |
| `footstep-dirt-01.ogg` | dirt/stone steps | `F/footstep dirt 18.wav` | 0.543396 | +5.3 | `a3da2e323f2c710d71e71ed70a70f09aa4f55bbbae8e3fd49d3072b847a18075` | `6438f1259ca3edf3271737f57127fc9681c289d244568ec5f47a2060ad8af3b9` |
| `footstep-grass-leaves-01.ogg` | grass/leaves steps | `F/footstep grass and leaves 13.wav` | 0.554771 | +4.2 | `3483be6f99b13480d1c4320e277b020e364cc381909a4a2fcb3b616e0d53c5a0` | `749e6d8f00e46e00eb5869a417528479f97d590590ab6633ee25eecdcef5ee61` |
| `footstep-wood-branch-01.ogg` | wood steps | `F/footstep on branch heavy.wav` | 0.571667 | +3.0 | `3a53725c31043aeefde9733dce2dc6cb53c399c886261858600162eede693c5c` | `0e59af6a3f19eaa1f7c15c5788908a6f98029ee4e15b9ec5ede89d5468020ab1` |
| `rake-wood-scrape-01.ogg` | rake/planting material proxy | `W/wood scrape 2.wav` | 3.121854 | +0.8 | `d56168cdf021531c1457c07d1c90f20b92f52877cdc79b18a9c02ce36d17327c` | `4acf70c29996b5258174cd5322d0408a3eb45735f04d9cea6d3f9e5f4a4067ee` |
| `fishing-fish-flop-01.ogg` | fishing catch | `F/fish 12.wav` | 0.410083 | -3.0 | `8935cc2eaaaba7aed855ddc79db5c0e9d2989463207e56eccc1bfedc8301925a` | `dd24fd17ada98598313c8dba82e76b8d28d4cd28c406d24ac431816fb93e3df4` |
| `fishing-splash-small-01.ogg` | fishing water | `W/water splashing small 9.wav` | 1.169167 | -1.0 | `891f6e2c9cbed22d8cd0e5a6bf4390ea0554d1565c8454be9c0a9b16a6ea7069` | `4ef53f0f786f5313a4b8a28e43653241ee1ac682e80639213813f210d24eb796` |
| `parchment-handle-01.ogg` | item/UI object handling | `P/paper handled 2.wav` | 1.402500 | -3.0 | `02cfdb9ded77b1b17b5d3143e153a3585cb68ca20bf48d429728df3dc7697489` | `ffa3bcf72acb230603f44d713c0ab3b57db5df748cc867ae6eb1e55dfe8b022c` |
| `ui-button-press-01.ogg` | UI feedback | `B/button pressed 8.wav` | 0.632271 | +1.4 | `e4d8f34e2437bdd2945331a9283c520edadebf2ec9a8b6fd8e6239b54b2f56bd` | `56a4e907f78e5b455f59a1e9ff0997789d55c0c5513f9ec7fd6d39ebcc725e98` |
| `wood-hit-light-01.ogg` | woodcutting/material | `W/wood hit 23.wav` | 0.260354 | -1.0 | `ee4b38476e3053fe71b3376b76a037061d6d64f9c606d63c425f02137690299e` | `fd45c71d91cdaa2d73bebdf668b5d8a7eb3f1fed5bd0bb08bacef2d7776d1717` |

## Curation decisions

Accepted clips fill the small grounded-foley gaps that can be covered without importing the pack. Cloth movement and ruffle cover equipment and inventory motion. Rock handling and a small metal drop cover loot pickup/drop. The two wood-drawer clips and the latch cover chest and bank feedback. Generic door open/close clips cover wooden doors; the names intentionally avoid vehicle or elevator door recordings. Dirt, grass/leaves, and branch steps cover surface and timber routes. The wood scrape is a material proxy for a rake or soil stroke, not a claim that the source recording is a literal rake. Fish and a small water splash cover the fishing loop. Paper handling gives parchment and item movement a dry cue. The button press is limited to UI feedback. The light wood hit covers a short woodcutting/material impact.

Rejected material was left out for both tone and scope. Modern appliances and office objects include air conditioners, printers, phones, keyboards, coffee pots, ovens, toasters, and elevators. Vehicles include sedan and Mazda doors, idling engines, motorcycles, and RC cars. Weapon and firearm recordings include guns, cleavers, knives, daggers, fencing hits, and stabs. Voices and comic character sounds include `oof`, screams, meows, coughs, and mouth sounds. Gore recordings include `stabs and gore`, `stabs wet`, and `gore into sink`. Electronic or science-fiction material includes lasers, beeps, power-on sounds, TV sounds, feedback, and novelty noisemakers. Contemporary food and packaging recordings such as cereal boxes, Capri Sun, plastic devices, and airpods were also excluded. `crate open` was rejected in favor of the cleaner wood-drawer cue because its source naming and cardboard association read as modern packaging. The long `metal many little hits` recording was rejected as an ambiguous nine-second effect rather than a focused loot cue.

## File location

The curated files live under `game/public/audio/sfx/filmcow-v1/`. No code, manifest, source archive, or other directory was changed by this curation.
