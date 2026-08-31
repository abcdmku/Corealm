"""Stages the CC0 animal voice clips into game/public/audio/sfx/animals/.

Sources and licences are recorded in docs/audio-source-animals.md. Every page was checked to show
"License(s): CC0" linking to creativecommons.org/publicdomain/zero/1.0/.

SELECTION METHOD, stated plainly: these clips were chosen by their author-given LABEL and by file
inspection, not by listening to them. Where a source is a species recording the label is the whole
story (`sheep_baa`, `bear_01`, `croak_02`, `moo-notification`). Where it comes from rubberduck's
CC0 creature packs the label names the SOUND rather than the animal (`howl`, `grunt_03`, `roar_05`,
`bug_07`), and it is mapped to the animal whose voice that sound is. Anything needing a real ear to
separate is flagged in the ledger rather than guessed at.

Four frog croaks arrive as mp3 and the two real cow moos as wav. Everything is transcoded to Ogg
Vorbis at `-q:a 5` on the way in, because `tests/audioCatalog.test.ts` asserts every sfx URL ends in
`.ogg` and that convention is worth one re-encode of an already-lossy source.
"""
import os
import shutil
import subprocess
import zipfile
import hashlib

SRC = os.path.join(".asset-cache", "animal-audio")
OUT = os.path.join("game", "public", "audio", "sfx", "animals")

# destination name -> (kind, source)
#   ("file", relative path under .asset-cache/animal-audio)
#   ("zip",  archive name, member path)
PLAN = {
    # --- species recordings ------------------------------------------------------------------
    "frog-croak-01.mp3": ("file", "croak_01_0.mp3"),
    "frog-croak-02.mp3": ("file", "croak_02.mp3"),
    "frog-croak-03.mp3": ("file", "croak_03.mp3"),
    "frog-ribbit-01.mp3": ("file", "ribbit_01.mp3"),
    "goat-bleat-01.ogg": ("file", "sheep_baa_0.ogg"),
    "bear-growl-01.ogg": ("zip", "bear.zip", "ogg/bear_01.ogg"),
    "bear-growl-02.ogg": ("zip", "bear.zip", "ogg/bear_02.ogg"),
    "cow-moo-01.wav": ("zip", "qubodup-cow.zip", "qubodup-sci-fi-cow-alien-soundpack/moo-notification.wav"),
    "cow-moo-02.wav": ("zip", "qubodup-cow.zip", "qubodup-sci-fi-cow-alien-soundpack/moo-death.wav"),
    # --- rubberduck CC0 creature packs, mapped by sound label ---------------------------------
    "coyote-howl-01.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "howl.ogg"),
    "coyote-bark-01.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "barking_01.ogg"),
    "coyote-bark-02.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "barking_02.ogg"),
    "boar-grunt-01.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "grunt_01.ogg"),
    "boar-grunt-02.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "grunt_03.ogg"),
    "boar-grunt-03.ogg": ("zip", "80-CC0-creature-sfx-2.zip", "grunt_07.ogg"),
    "stag-bellow-01.ogg": ("zip", "80-CC0-creature-sfx-2.zip", "roar_04.ogg"),
    "stag-bellow-02.ogg": ("zip", "80-CC0-creature-sfx-2.zip", "roar_05.ogg"),
    "bear-roar-01.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "roar_02.ogg"),
    "serpent-hiss-01.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "breath.ogg"),
    "serpent-hiss-02.ogg": ("zip", "80-CC0-creature-sfx-2.zip", "breath_02.ogg"),
    "chitin-click-01.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "bug_02.ogg"),
    "chitin-click-02.ogg": ("zip", "80-CC0-creature-sfx-2.zip", "bug_07.ogg"),
    "chitin-click-03.ogg": ("zip", "80-CC0-creature-sfx-2.zip", "bug_11.ogg"),
    "rodent-squeak-01.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "cute_03.ogg"),
    "rodent-squeak-02.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "cute_07.ogg"),
    "hen-cluck-01.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "cute_01.ogg"),
    "hen-cluck-02.ogg": ("zip", "80-CC0-creature-SFX_0.zip", "cute_05.ogg"),
}

os.makedirs(OUT, exist_ok=True)
archives: dict[str, zipfile.ZipFile] = {}
rows = []
for dest, spec in PLAN.items():
    target = os.path.join(OUT, dest)
    if spec[0] == "file":
        source = os.path.join(SRC, spec[1])
        shutil.copyfile(source, target)
        origin = spec[1]
    else:
        _, archive_name, member = spec
        archive = archives.get(archive_name)
        if archive is None:
            archive = zipfile.ZipFile(os.path.join(SRC, archive_name))
            archives[archive_name] = archive
        with archive.open(member) as handle, open(target, "wb") as out:
            shutil.copyfileobj(handle, out)
        origin = f"{archive_name}!{member}"
    # Everything ships as .ogg. A source that already is one is left untouched.
    if not dest.endswith(".ogg"):
        encoded = f"{os.path.splitext(target)[0]}.ogg"
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", target,
             "-c:a", "libvorbis", "-qscale:a", "5", "-ar", "44100", encoded],
            check=True,
        )
        os.remove(target)
        target = encoded
        dest = os.path.basename(encoded)

    data = open(target, "rb").read()
    rows.append((dest, origin, len(data), hashlib.sha256(data).hexdigest()))

for archive in archives.values():
    archive.close()

width = max(len(row[0]) for row in rows)
for dest, origin, size, digest in rows:
    print(f"{dest.ljust(width)}  {size:>8} B  {digest[:16]}  <- {origin}")
print(f"\nstaged {len(rows)} animal voice clips to {OUT}")
