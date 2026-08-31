"""Stages the Fantasy Rhino TGAs into .asset-cache/boss-pack/tex, recoloured per element.

THE SOURCE IS ALREADY ONE ELEMENT. The rhino ships a blue-violet hide with ice-blue glowing seams
and plates, which is the water boss with nothing done to it. Air and earth are the same maps hue-
rotated onto their own element colour, so all three bosses read as one creature wearing three
different powers rather than as three unrelated models.

WHY HUE-ROTATE RATHER THAN TINT. A flat multiply by an element colour crushes everything the map
already says: the albedo's dark hide and its bright plates both end up the same hue at different
brightnesses, and the emissive's cool core-to-rim falloff disappears. Rotating hue and leaving
value alone keeps the plate structure, the falloff and the contrast that make the glow read as
glow, and only changes what colour it is.

SATURATION IS RAISED, NOT PRESERVED. The source is a muted, almost desaturated blue at the low end.
Carried straight onto earth's green it reads as mould rather than as something imbued. The floor
below lifts the weakly-coloured pixels toward the element without touching the neutral ones, which
is what keeps the teeth and the bone white instead of dyeing the whole animal.

Usage: python tools/bosses/stage-textures.py
"""
import colorsys
import os

import numpy as np
from PIL import Image

SRC = os.path.join(".asset-cache", "boss-pack", "raw", "Assets", "Rhino", "Texture")
OUT = os.path.join(".asset-cache", "boss-pack", "tex")

# Matches the 512 px ceiling tools/build-assets.ts applies to every other pack. These are 2048 px
# sources and a boss is one entity on screen, but a 2 MB texture per boss buys nothing at the
# distance the camera actually sits.
LIMIT = 512

# Hue and saturation floor per element, in HSV. The hues are the same ones
# `render/itemIconAppearances.ts` gives the essences and orbs, so the boss that drops an Air Orb is
# the colour of the orb it drops.
#
#   air    0x78cce8 -> hue 0.545   earth  0x668c43 -> hue 0.257   water  0x327fc2 -> hue 0.577
#
# AIR AND WATER ARE 0.03 APART IN HUE, and that is the palette's decision, not an accident: both
# element colours are blue. What separates them in the icons is VALUE — air is 0x78cce8, a pale
# bright cyan, and water is 0x327fc2, a deep saturated blue — so the same split is applied here.
# Rendered side by side without it the two bosses were the same animal in two shades of the same
# blue; with it, one is bright and one is dark, which is how the orbs already read.
ELEMENTS = {
    "air": {"hue": 0.545, "saturation_floor": 0.40, "value_gain": 1.30, "value_floor": 0.16},
    "earth": {"hue": 0.257, "saturation_floor": 0.50, "value_gain": 1.00, "value_floor": 0.00},
    "water": {"hue": 0.577, "saturation_floor": 0.55, "value_gain": 0.82, "value_floor": 0.00},
}

# Which maps get recoloured. Anything not listed is not shipped: the build makes one lit material
# with base colour and emission, so AO, metallic and normal have nowhere to go.
MAPS = {"Rhinoceros_Albedo.tga": "albedo", "Rhinoceros_Emissive.tga": "emissive"}

# Below this saturation a pixel is treated as neutral and left alone. Teeth, bone and the white of
# the eye sit here; the hide and every glowing plate sit well above it.
NEUTRAL_SATURATION = 0.06


def recolour(
    image: Image.Image,
    hue: float,
    saturation_floor: float,
    value_gain: float,
    value_floor: float,
) -> Image.Image:
    """Rotates every coloured pixel onto one hue, then re-grades saturation and value.

    `value_floor` lifts the darks and is what makes air read as pale rather than merely lighter:
    the hide is nearly black in the source, and scaling a near-zero value by any gain leaves it
    near-zero. It is applied only to coloured pixels, so it does not fog the black background of
    the emissive map into a glow across the whole body.
    """
    rgb = np.asarray(image.convert("RGB")).astype(np.float32) / 255.0
    flat = rgb.reshape(-1, 3)

    maximum = flat.max(axis=1)
    minimum = flat.min(axis=1)
    value = maximum
    chroma = maximum - minimum
    # Guard the divide rather than the result: value 0 is pure black, where saturation is undefined
    # and any hue produces the same pixel anyway.
    saturation = np.where(value > 0, chroma / np.maximum(value, 1e-6), 0.0)

    coloured = saturation > NEUTRAL_SATURATION
    lifted = np.maximum(saturation, saturation_floor)
    target_saturation = np.where(coloured, lifted, saturation)
    target_hue = np.where(coloured, hue, 0.0)

    graded = np.clip(value * value_gain, 0.0, 1.0)
    if value_floor > 0:
        graded = np.where(coloured, value_floor + graded * (1.0 - value_floor), graded)
    target_value = np.where(coloured, graded, value)

    out = np.empty_like(flat)
    # colorsys is scalar-only, so this is the one loop. 512x512 is a quarter of a million pixels and
    # runs in about a second; the alternative is hand-rolling HSV->RGB in numpy for no real gain.
    for index in range(flat.shape[0]):
        out[index] = colorsys.hsv_to_rgb(
            float(target_hue[index]), float(target_saturation[index]), float(target_value[index])
        )
    return Image.fromarray((out.reshape(rgb.shape) * 255.0).round().astype(np.uint8), "RGB")


def main() -> None:
    if not os.path.isdir(SRC):
        raise SystemExit(f"Staged source missing at {SRC}. See tools/bosses/README.md.")
    os.makedirs(OUT, exist_ok=True)

    written = 0
    for filename, kind in MAPS.items():
        source = os.path.join(SRC, filename)
        if not os.path.isfile(source):
            raise SystemExit(f"Missing source map: {source}")
        # Resize BEFORE recolouring: the per-pixel loop below is the slow part, and a 2048 px map is
        # sixteen times the work for a texture that ships at 512.
        image = Image.open(source).convert("RGB").resize((LIMIT, LIMIT), Image.LANCZOS)
        for element, settings in ELEMENTS.items():
            out_path = os.path.join(OUT, f"boss_rhino_{element}_{kind}.png")
            recolour(
                image,
                settings["hue"],
                settings["saturation_floor"],
                settings["value_gain"],
                settings["value_floor"],
            ).save(out_path)
            print(f"wrote {out_path}")
            written += 1
    print(f"{written} maps staged into {OUT}")


if __name__ == "__main__":
    main()
