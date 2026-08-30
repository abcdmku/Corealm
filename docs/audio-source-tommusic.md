# Corealm SFX source ledger — TomMusic Fantasy 200

This ledger covers the compact Corealm subset copied to
`game/public/audio/sfx/tommusic/`. The full TomMusic archive was downloaded only to a temporary
directory for curation and extraction; it is not part of the repository.

## Source and license evidence

- Source page: <https://tommusic.itch.io/free-fantasy-200-sfx-pack> (TomMusic, *Free Fantasy 200
  SFX Pack*; accessed 2026-08-29).
- The page says the pack contains over 200 fantasy SFX, including bow and sword sounds, spell
  variations, doors/chests/gates, chopping/mining, and rivers/waterfalls/streams. It says the
  supplied game formats are OGG and WAV.
- Exact license evidence on the source page: **“Royalty-free! You can use this in your projects,
  commercial or otherwise, credit is not mandatory but appreciated. The asset is not to be up for
  resale or redistribution.”** Corealm does not resell or redistribute the source pack; it ships
  selected files as part of the game and credits TomMusic in `game/public/audio/CREDITS.md`.
- The author's public reply in the page comments also says: **“Absolutely! You can use these in
  any commercial project! I simply ask you credit me when you use them!”** Corealm will therefore
  include TomMusic in its audio credits even though the page description says credit is optional.
- For this project, “not ... up for resale or redistribution” is treated as the standard
  prohibition on offering the pack or its files as a standalone asset. The selected cues are
  included only in the playable Corealm build, not repackaged as an audio download.
- The archive was obtained through itch.io's zero-price **“No thanks, just take me to the
  downloads”** flow. The page listed `Free Fantasy SFX Pack By TomMusic.zip` at 317 MB; the
  generated upload was HTTP 200 and measured 332,824,971 bytes.

The exact downloaded source record was retained outside the repository for auditability:

| Record | Name | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Source archive | `Free Fantasy SFX Pack By TomMusic.zip` | 332,824,971 | `cad6fe15a55c1169567509e96a22707eecd688c3b7ef4879287b911ff20304e5` |

The temporary working path was under
`C:\Users\Borg\AppData\Local\Temp\corealm-tommusic\` and is not shipped. The itch.io upload
was addressed by page game id `2177975` and upload id `15588091`; signed CDN URLs are short-lived
and are intentionally not recorded as permanent source URLs.

## Transforms and format

The selected files came from the archive's OGG tree. Every shipped file is Ogg Vorbis, 44,100 Hz,
stereo, and passed an `ffmpeg -v error` decode check. The source OGG bytes were copied bit-for-bit;
the only transformation was a lowercase kebab-case destination filename. There was no trim, gain
change, pitch shift, time stretch, layering, denoise, resampling, metadata edit, or transcoding.
Thus the source and shipped SHA-256 values are identical. Durations below are `ffprobe` format
durations from the shipped files.

## Accepted set

The role labels are Corealm curation labels, not claims about TomMusic's original recording
context. The two fishing labels are deliberately conservative: the pack has no fishing-labelled
recording, so short water-landing sounds are used for cast/retrieve splashes and the source context
is retained here.

| Cue family | Shipped file | Original archive entry | Transform | Duration (s) | Ogg bytes | SHA-256 (source = shipped) | Acceptance rationale |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| Fishing / water splash | `fishing-splash-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Footsteps/Water/Water Land.ogg` | Copy + rename | 0.465896 | 31,719 | `13f9c12b99fbedffb70a2ce14f2ac334702e6ace72bcd2fba830577b55972396` | Water landing splash repurposed for a cast/retrieve interaction; no fishing-labelled file exists. |
| Fishing / water splash | `fishing-splash-02.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Footsteps/Water/Water Chain Land.ogg` | Copy + rename | 0.465896 | 29,843 | `6158ec5122f0208a7964889491f90c36415e225252800f5de9c81c516e456d7b` | Second water-landing variant for a fishing cast/retrieve interaction; source context retained. |
| Sword swing | `sword-swing-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 1.ogg` | Copy + rename | 0.500000 | 34,423 | `30f752c8bbaac9ee4f575a5e34612a8c87ea393371b482059ca7fe1909d30efb` | Explicit sword attack; readable melee swing variant. |
| Sword swing | `sword-swing-02.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 2.ogg` | Copy + rename | 0.500000 | 33,848 | `1e6f03e1cd618b7d466392c8612cc09043b04ff07be694a7cf4a7b7b38f9bd48` | Second explicit sword attack variant. |
| Sword impact | `sword-impact-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 1.ogg` | Copy + rename | 0.499819 | 38,714 | `3f3bdd7f3637e9bfe7d14a4cabed00f0e195eda95bdeb260233705e7e012d9c3` | Explicit sword impact for a successful melee hit. |
| Sword impact | `sword-impact-02.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 2.ogg` | Copy + rename | 0.500000 | 37,598 | `ff6d72fa1a32ac5352ee65ff1945fa30951d6d1eb69e3f223b9a4cd69c825147` | Second sword impact variant for repetition control. |
| Weapon draw | `weapon-unsheathe-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Attacks/Sword Attacks Hits and Blocks/Sword Unsheath 1.ogg` | Copy + rename | 0.750000 | 48,092 | `dfd8e426a9ee2615d63e36d93dbb7e5beb4bb396566d8b61582f64fa426b7707` | Useful equipment/combat-start interaction. |
| Weapon stow | `weapon-sheathe-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Attacks/Sword Attacks Hits and Blocks/Sword Sheath 1.ogg` | Copy + rename | 1.000000 | 62,841 | `df2575e32a774cc7a8e334c93a421819b079437f30f67ce4f54cd6956580c060` | Useful equipment/combat-end interaction. |
| Ember spell cast | `magic-ember-cast-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Spells/Fireball 1.ogg` | Copy + rename | 1.218503 | 82,297 | `7b515ce1c85396b7ebabb9dc9876e892a0f642c8d696cf03aa69aa83cb6f30d3` | Fantasy fire cast mapped to Phase 1 Emberlash. |
| Ember spell cast | `magic-ember-cast-02.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Spells/Fireball 2.ogg` | Copy + rename | 1.160998 | 72,596 | `e587c4fab796fcfcc190cb10a71384c506b19718aebcda50282712ba88b6a57c` | Second Emberlash-compatible cast variant. |
| Stone spell cast | `magic-stone-cast-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Spells/Rock Meteor Throw 1.ogg` | Copy + rename | 0.500000 | 38,430 | `435a606d16ed4fb2081918de4915f904d1cfb89d86dc7decde8c7ff8453bc151` | Grounded rock cast mapped to Phase 1 Stonebrand. |
| Stone spell cast | `magic-stone-cast-02.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Spells/Rock Meteor Throw 2.ogg` | Copy + rename | 0.500000 | 37,238 | `84c6c56ac71d012993508194fc362b36764727a092e054c4f821cc781c0878cc` | Second stone cast variant. |
| Magic impact | `magic-impact-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Spells/Spell Impact 1.ogg` | Copy + rename | 0.371519 | 28,713 | `962097dd786567097c471ad4ce5f0a42dddb6c2f334b1f147edfd3f688c20b96` | Short generic spell impact suitable for a successful cast. |
| Magic impact | `magic-impact-02.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Spells/Spell Impact 2.ogg` | Copy + rename | 0.307664 | 23,205 | `c3baeb69100a0ef666c16a757a992f7e00347f5dc4e4fbac6ab4b7ecaae1b0a4` | Second generic spell impact variant. |
| Chest open | `chest-open-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Doors Gates and Chests/Chest Open 1.ogg` | Copy + rename | 1.500000 | 79,411 | `1ec2fdc0b4b430e25cd48bbc7b1fb7d6cf65f3a00418190578a54b7da5a22eaf` | Explicit chest-open cue for loot containers. |
| Chest open | `chest-open-02.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Doors Gates and Chests/Chest Open 2.ogg` | Copy + rename | 1.500000 | 87,866 | `f12ab7e53b38c3ea80cb6498b4f6effa23232e5c7da96e1af875fc3a65e10ea7` | Second chest-open variant. |
| Door open | `door-open-01.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Doors Gates and Chests/Door Open 1.ogg` | Copy + rename | 1.500000 | 78,709 | `d2ff6b9cfeb590722a9a17909bae5421bd8fe31a54746f98a47495c7e4adfc11` | Explicit door-open cue for town/interior transitions. |
| Door open | `door-open-02.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Doors Gates and Chests/Door Open 2.ogg` | Copy + rename | 1.500000 | 72,397 | `d8879649bec44de7659b5e20aef3906a912d675428fcc3f59ba5e7966ca89232` | Second door-open variant. |
| Lock / loot | `lock-unlock.ogg` | `Free Fantasy SFX Pack By TomMusic/OGG Files/SFX/Doors Gates and Chests/Lock Unlock.ogg` | Copy + rename | 1.002676 | 67,114 | `668ce971fb0f26ea6bea13e4c61cb4bacae1f49618e2e6fa8b3dcae9d1ba0af9` | Useful lock/loot confirmation; only generic UI-adjacent cue with a clear medieval object identity. |

## Rejected material and rationale

The source page grants broad reuse rights, but the audio amendment still requires a restrained,
grounded medieval-fantasy palette. The following source families stayed in temporary extraction
space only:

| Source family / archive entries | Decision | Rationale |
| --- | --- | --- |
| WAV tree and every WAV duplicate of an OGG | Reject | The archive already supplies browser-friendly Ogg Vorbis counterparts; shipping both formats would double the set without adding content. |
| Bow, parry, close-only door/chest/gate, mining/chopping, torch, river, stream, and waterfall files previously reviewed | Reject from shipped build | These clips remain theme-compatible upstream, but no shipped cue references them. Removing unused loose files keeps the public project subset compact and avoids redistributing material that is not part of the playable game. |
| `OGG Files/BGS Loops/Beach/*`, `Sea/*`, `Forest Day/*`, `Forest Night/*`, `Interior Day/*`, `Interior Night/*`, and `Cave/*` | Reject | These are broad 60-second background loops, not interaction SFX. Region ambience is curated in a separate layer; existing dedicated ambience assets cover the Phase 1 regions and Gravelmaw. |
| `SFX/Chopping and Mining/mine 3.ogg`, `mine 5.ogg`, and `chop 2.ogg` | Reject | Clearly labelled but redundant short variants; three mining and three woodcutting hits already provide enough repetition control for the compact set. |
| `SFX/Footsteps/*` other than `Water Land.ogg` and `Water Chain Land.ogg` | Reject | Dirt/stone/wood/water walk and run families are duplicate footstep coverage handled by the other curated SFX sources. The two water-land files are retained only as the conservative fishing-splash substitute because this archive has no fishing-labelled cue. |
| Bow blocked variants, `Bow Impact Hit 3.ogg`, `Bow Put Away 1.ogg`, `Bow Take Out 1.ogg` | Reject | Blocked feedback and bow equipment transitions are secondary to the requested compact bow attack/impact set; selected sword draw/stow covers the shared equipment interaction. |
| `Sword Attack 3.ogg`, sword blocked variants, `Sword Impact Hit 3.ogg`, `Sword Parry 2.ogg`, `Sword Parry 3.ogg`, `Sword Sheath 2.ogg`, `Sword Unsheath 2.ogg` | Reject | Redundant variants; two swings and two impacts plus one parry are sufficient, with one draw/stow pair for equipment. |
| `SFX/Spells/Fireball 3.ogg`, `Firebuff 1.ogg`, `Firebuff 2.ogg`, `Firespray 1.ogg`, `Firespray 2.ogg` | Reject | The Phase 1 spell table has Emberlash but no buff or spray spell. The selected fireball pair is enough for the Emberlash cast family. |
| `Ice Barrage *`, `Ice Freeze *`, `Ice Throw *`, `Ice Wall *` | Reject | No Phase 1 ice spell exists; the frozen-north tier is future content. |
| `Rock Meteor Swarm *`, `Rock Wall *` | Reject | The names imply large area/boss effects rather than the compact cast cue needed for Phase 1 Stonebrand; the shorter Rock Meteor Throw pair is a better fit. Voltrend has no suitable lightning/charge cast in this pack. |
| `Waterspray *`, `Wave Attack *` | Reject | No water spell is shipped in Phase 1, and the long wave effects are too dominant for ordinary casts. |
| `SFX/Doors Gates and Chests/Portcullis Gate.ogg` | Reject | A 12-second mechanism recording is too long and dominant for normal gate feedback; the concise Gate Open/Gate Close pair is sufficient. |
| `SFX/Torch/Light Torch 1.ogg`, `Light Torch 2.ogg` | Reject | The game has no direct torch-lighting action, and these ignition sounds are not valid cooking or smelting substitutes. |
| `Light Torch with Starting Loop *`, `Torch Loop.ogg` | Reject | 10-second/looping torch beds belong to ambience and are unnecessary beside the dedicated dungeon ambience layer. |
| `Torch Attack Strike *`, `Torch Impact *` | Reject | Torch combat is not a shipped weapon family and is semantically less clear than the selected sword/bow cues. |
| Cover image, `.DS_Store`, and `ReadMe.txt` | Reject | Non-audio archive material; not copied. |

No explicit generic UI confirmation, item pickup, tree-fall, farming, smithing, smelting, crafting,
cooking, fletching, banking, shop, dialogue, portal, agility, damage, or death cue exists in this
pack. Chest-open/close and lock/unlock cover the clear loot-container interactions; the remaining
families must come from other licensed sources or remain deliberately silent. No unsupported cue
was fabricated from an ambiguous recording.

## Integrity summary

- Destination contains 19 lowercase kebab-case `.ogg` files under
  `game/public/audio/sfx/tommusic/`.
- All 19 files are Ogg Vorbis, 44,100 Hz, stereo, and passed an FFmpeg decode check.
- Every accepted file is a bit-for-bit copy of its upstream OGG entry; source and shipped hashes
  match.
- No source ZIP, WAV, MP3, cover image, or code/manifests were added or changed by this curation.
