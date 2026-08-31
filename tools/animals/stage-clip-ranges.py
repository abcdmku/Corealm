"""Extracts the animation clip frame ranges Unity stores beside each FBX.

WHY THIS EXISTS. Half the pack's animation files are not single clips. The `_exp` rigs (frog, hog,
rat, crab, and every fish) each ship ONE long take covering every motion, and the individual
motions are sub-ranges of it: `Iron_age_pig_idle` is frames 500-600 of a 660-frame timeline,
`Rat_walk` is 10-50, `Crab_run` is 100-115. Taking `animations[0]` whole, which is what the
converter did first, gave those animals four identical clips - a frog whose idle, walk, attack and
death were all the same 20.9 second take, so it never appeared to change animation at all.

The ranges are not guessable. They live in the `.meta` sidecar Unity writes next to each asset,
under `clipAnimations`, and a `.unitypackage` carries those as a separate `asset.meta` entry per
GUID directory. `stage-textures.py`'s sibling extraction skipped them because only the binary
assets were wanted; this pulls just the FBX ones.

Writes `.asset-cache/animal-pack/clip-ranges.json`, which `tools/build-animals.ts` reads.
"""
import json
import os
import re
import tarfile

SRC = os.path.join(
    os.environ.get("APPDATA", ""), "Unity", "Asset Store-5.x", "janpec",
    "3D ModelsCharactersAnimals", "Animal pack deluxe.unitypackage",
)
OUT = os.path.join(".asset-cache", "animal-pack", "clip-ranges.json")

pathnames: dict[str, str] = {}
metas: dict[str, bytes] = {}

with tarfile.open(SRC, "r:gz") as archive:
    for member in archive:
        if not member.isfile():
            continue
        parts = member.name.split("/")
        if len(parts) < 2:
            continue
        guid, kind = parts[0], parts[-1]
        if kind == "pathname":
            raw = archive.extractfile(member).read().decode("utf-8", "replace").strip()
            pathnames[guid] = raw.splitlines()[0].strip() if raw else ""
        elif kind == "asset.meta":
            metas[guid] = archive.extractfile(member).read()

# `firstFrame`/`lastFrame` follow the clip's `name` inside each clipAnimations entry. Only the
# first entry per file matters: every animation FBX in this pack defines exactly one clip.
PATTERN = re.compile(r"name:\s*(\S+)[\s\S]{0,400}?firstFrame:\s*([\d.]+)\s+lastFrame:\s*([\d.]+)")

ranges: dict[str, dict[str, object]] = {}
for guid, data in metas.items():
    path = pathnames.get(guid, "")
    if not path.lower().endswith(".fbx"):
        continue
    match = PATTERN.search(data.decode("utf-8", "replace"))
    if not match:
        continue
    name, first, last = match.groups()
    ranges[os.path.basename(path)] = {
        "clip": name,
        "first": float(first),
        "last": float(last),
    }

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as handle:
    json.dump(ranges, handle, indent=1, sort_keys=True)
    handle.write("\n")

print(f"wrote {len(ranges)} clip ranges to {OUT}")
