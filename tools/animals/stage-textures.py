"""Stages the pack's base-colour TGAs into .asset-cache/animal-pack/tex as 512px RGB PNGs.

ALPHA IS DISCARDED, AND THAT IS THE WHOLE POINT OF THIS FILE.

These are Unity legacy `_col_unity` maps: RGB is albedo and the alpha channel carries a specular /
gloss mask, not transparency. Keeping it costs nothing until the GLB is optimized, at which point
`textureCompress` converts PNG to JPEG, JPEG has no alpha, and sharp flattens the image onto a
black background first. Mean alpha on the cattle map is 67/255, so that flatten multiplied the
whole albedo by about 0.26 and every animal shipped as a near-silhouette.

Proof it is a gloss mask rather than premultiplied colour: under premultiplication RGB <= A for
every channel, but 38% of the cattle map's pixels have RGB > A, and the RGB/A ratio spreads from
0.64 at the median to 3.27 at the 95th percentile. Un-premultiplying would be wrong; dropping it
is right.
"""
import os
import glob
from PIL import Image

SRC = os.path.join(
    os.path.expanduser("~"), ".t3", "tmp", "animalpack",
    "extracted", "Assets", "Animal pack deluxe", "Textures",
)
OUT = os.path.join(".asset-cache", "animal-pack", "tex")
# Matches the 512 px base-colour ceiling tools/build-assets.ts applies to every other pack.
LIMIT = 512

os.makedirs(OUT, exist_ok=True)
written = 0
for path in sorted(glob.glob(os.path.join(SRC, "*"))):
    stem, _ = os.path.splitext(os.path.basename(path))
    if "_col" not in stem.lower():
        continue
    image = Image.open(path)
    # convert("RGB") composites nothing: it takes the three colour channels and drops the fourth.
    image = image.convert("RGB")
    if max(image.size) > LIMIT:
        image = image.resize((LIMIT, LIMIT), Image.LANCZOS)
    image.save(os.path.join(OUT, f"{stem}.png"), "PNG", optimize=True)
    written += 1

print(f"staged {written} base-colour textures to {OUT} at {LIMIT}px, RGB only")
