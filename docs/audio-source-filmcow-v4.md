# Corealm SFX source ledger — FilmCow Vol. 4

This ledger covers the small Hits & Crunches subset copied to
`game/public/audio/sfx/filmcow-v4/`. The full FilmCow archive was downloaded only to a temporary
directory for curation and extraction; it is not part of the repository.

## Source and license evidence

- Source page: <https://filmcow.itch.io/filmcow-sfx-4> (FilmCow, *FilmCow Royalty Free Sound
  Effects Library Vol. 4*; accessed 2026-08-29).
- The page describes Vol. 4 as more than 2,000 WAV files and identifies **Hits & Crunches** as
  803 sounds. It lists the freely downloadable `FilmCow SFX - Hits & Crunches 48kHz.zip` and
  says the sounds are royalty-free for personal or commercial projects, with no credit required.
- The page's stated restrictions are national-government projects, law-enforcement projects, and
  projects produced by a group categorized as a hate group by the SPLC or CAHN.
- The page also supplies `license.pdf`. The downloaded PDF is the **FilmCow Royalty Free SFX
  Library License Agreement** between Licensee and Jason Steele (Licensor). It grants a worldwide,
  non-exclusive, perpetual, royalty-free license for media including games and commercial projects.
  It prohibits claiming authorship of the sounds or re-selling the sounds, and repeats the three
  project restrictions above. The PDF also says the license terminates automatically on breach and
  is governed by United States law. This project does not claim authorship of the source sounds and
  does not re-sell them.
- The page states that attribution is not required. Corealm may still credit FilmCow in project
  materials as a courtesy; that is not a condition of this license.

The exact downloaded source records are retained outside the repository for auditability:

| Record | Name | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Source archive | `FilmCow SFX - Hits & Crunches 48kHz.zip` | 180,659,233 | `99042ecf50a6abbe54a9e89fd19c2e190eb06897a3121ef166671e035c0817b4` |
| License evidence | `license.pdf` | 30,703 | `bda56a077aa8ba8e053ae916dd4c19038baa12cd33d10209658646ac9351b73f` |

The archive was obtained through itch.io's free “No thanks, just take me to the downloads” flow;
no payment or account was required. Temporary working paths were under
`C:\Users\Borg\AppData\Local\Temp\corealm-filmcow-v4\` and are not shipped.

## Transcode policy

The accepted WAVs are 48,000 Hz, 24-bit, stereo. Each was converted with FFmpeg to Ogg Vorbis
quality 5, retaining 48,000 Hz stereo and stripping container metadata:

```text
ffmpeg -i <source.wav> -vn -map_metadata -1 -c:a libvorbis -q:a 5 <destination.ogg>
```

There was no time crop, pitch shift, normalization, reverb, layering, or other sound-design
change. Output durations below are from `ffprobe` on the shipped Ogg files. Source names are kept
verbatim in the table so every shipped file can be traced back to the archive.

## Accepted set

The role labels are Corealm curation labels, not claims about FilmCow's original recording
context. The source pack has no explicit “tree break” group, so a full-bodied `wood hit` variant
is assigned that role for a restrained tree-fall/branch-break cue.

| Corealm role | Shipped file | Original archive entry | Source WAV bytes | Duration (s) | Source WAV SHA-256 | Ogg bytes | Shipped Ogg SHA-256 |
| --- | --- | --- | ---: | ---: | --- | ---: | --- |
| Melee body impact | `melee-body-impact-01.ogg` | `FilmCow SFX - Hits & Crunches/punch clothes 3.wav` | 154,706 | 0.536854 | `b1e754404ee216249de1b6d2b962e63bee6663a9142179542b2398354b17d213` | 8,592 | `31174222e1843630a5f0be2abc636552c643c624713c5da43c35dd7bc71becd8` |
| Armour hit | `armour-hit-01.ogg` | `FilmCow SFX - Hits & Crunches/metal hit 1.wav` | 213,830 | 0.742146 | `5523ecaeec4112dead5d41591ff51ab0f2d173930ad2a5cdd0661ee8d37ba656` | 11,659 | `20c3c0084ff88d50d88f6bf59017c2d48126ccce64468933818cbef5f1b84a5e` |
| Shield / metal strike | `shield-metal-strike-01.ogg` | `FilmCow SFX - Hits & Crunches/metal hit 5.wav` | 318,344 | 1.105042 | `44e7ff89e04b1325595fed6740301950bdd56b0c286482c8c40b712c288d0739` | 12,860 | `ef17373c08fac1886e0fc76b1a9450083f4b8882bb1bbf335fd32055fb82845d` |
| Shield / metal strike | `shield-metal-strike-02.ogg` | `FilmCow SFX - Hits & Crunches/metal hit 10.wav` | 243,032 | 0.843542 | `c3591d97126a9945d520035bd529c9fe44146bdbfb083060a21b760d285de1c2` | 11,861 | `15f6847e8371af66d951692ddb21389f74c190b4b49a372299f6f82a4331e0ab` |
| Rock / mining impact | `mining-rock-impact-01.ogg` | `FilmCow SFX - Hits & Crunches/brick hit 10.wav` | 110,036 | 0.381750 | `30ec7f6ceccc5b9c364db4ccdca8fcd74c37994715c45be47342a43eb42ddb54` | 11,075 | `7b53c61f5f73d7d7f1db4b3b0d3e485cc7a8f801df19ec891606b3f159292b2b` |
| Rock / mining impact | `mining-rock-impact-02.ogg` | `FilmCow SFX - Hits & Crunches/brick hit 15.wav` | 201,302 | 0.698646 | `8ebfbc8f9209317d6ef0b5f8f3c162e606faafe51fc7fc9dfa528fdc946f97a1` | 9,595 | `bf154199bf6dcac6d47b9647c561e2d1f20df4a635e393a5022288273399760d` |
| Wood chopping impact | `wood-chop-impact-01.ogg` | `FilmCow SFX - Hits & Crunches/wood hit 7.wav` | 199,436 | 0.692167 | `1bd9ad2169f9322d324451234daa96ad5d7b04e40073fd772ea9e712705c6ceb` | 17,633 | `c13b0d38527e410de1a27e024a878c709c218150aee52e949d689107844b0c65` |
| Wood chopping impact | `wood-chop-impact-02.ogg` | `FilmCow SFX - Hits & Crunches/wood hit 20.wav` | 137,774 | 0.478063 | `67a8f182859b25882fc2b48f72b939a8b72a8e44cd083ce531c7c66482baecda` | 9,803 | `43b63751152abeff6351205383fc0bf824732a5d024045abadbe10a786df7d16` |
| Tree / wood break | `tree-wood-break-01.ogg` | `FilmCow SFX - Hits & Crunches/wood hit 15.wav` | 162,266 | 0.563104 | `bc2f0763d0dc807142d4d2cb94539b4c00ba2429934e4216b0da488504330b73` | 10,883 | `9ea6e34d92d2194f251bbaa190737f159d6fb15c27089ff5a949923e1edd535c` |
| Enemy / player damage | `damage-body-impact-01.ogg` | `FilmCow SFX - Hits & Crunches/punch clothes 6.wav` | 159,296 | 0.552792 | `a00b74edc46eb4098b1fc0ed83287d726671c2dba551d8691bcbdea6c6b5acf5` | 8,933 | `4ac608f5657af50dc94e01fd157e6b0df9e0db985ef37cda357e2b3a41d4404d` |
| Enemy / player damage | `damage-body-impact-02.ogg` | `FilmCow SFX - Hits & Crunches/punch clothes 8.wav` | 196,694 | 0.682646 | `95ceaf7530933f9a85830bb6f0c191dfc43af1cd54afdd111246eece9dfa8c68` | 9,250 | `363ff2f88b3de9c8f2e32e04b5fce4ead2cdfd2d0278c1f317025b744cdbb7d3` |
| Special boss impact | `boss-ground-impact-01.ogg` | `FilmCow SFX - Hits & Crunches/ground thump 4.wav` | 158,612 | 0.550417 | `0c0bc69413c5d14a63c407bc297929ff89bffab144f10a77a01346a9f79c0cae` | 9,726 | `91f3eb440217a491018f73f30638c82aafaf24e4602ad014e4f0890b07a7ecff` |

## Rejected material and rationale

The 12 shipped files are deliberately small and acoustic. The rest of the curation was rejected
at the source-family level when its name or expected context did not fit Corealm's restrained
medieval-fantasy sound palette:

| Source family / archive | Decision | Rationale |
| --- | --- | --- |
| `punch flesh *.wav` | Reject | Body-material label carries wet/gore risk; the cleaner `punch clothes` family covers readable damage without implying gore-heavy squelch. |
| `resonating metal hit *.wav` | Reject | Roughly 3.5–5.4 second ringing tails are too long and dominant for normal shield/armour feedback; they can read as stylized or electronic rather than a tight medieval strike. |
| `metal beam hit *.wav` | Reject | Construction/industrial context is outside the grounded medieval-fantasy set. |
| `metal briefcase`, `metal pan`, `silicon`, `cooler`, `thermos`, `spatula`, `umbrella`, `flip flop` families | Reject | Household, modern, or novelty object identities do not belong in Corealm's world. |
| `can crunch`, `cardboard*`, `cereal crunch`, `glass bottle`, `paper crunch`, `plastic*` families | Reject | Modern packaging, food, glass, or synthetic-material crunches; not rock, wood, armour, or restrained body impacts. |
| `fronds crunch` / `fronds hit` | Reject | Foliage rustle/crunch is not a tree-break or wood-impact cue and is unnecessary for this subset. |
| `Toons` archive | Reject | Explicitly cartoon/comedy-oriented and outside the audio brief. |
| `Writing & Typing` archive | Reject | Office/typing source material is unrelated to this combat and gathering subset. |

No firearm, explosion, vehicle, modern-destruction, sci-fi/electronic, or gore-heavy squelch clip
was accepted. The full archive remains outside the repository; only the 12 Ogg files above are
intended for Corealm's audio manifest/runtime.
