"""Stages the two miniboss weapon textures into .asset-cache/weapon-tex, hue-NEUTRALIZED.

THE RUNTIME OWNS THE HUE, so the shipped maps must not. One sword and one staff geometry serve
every regional rare drop, and `render/equipmentVisuals.ts: tintedMaterial` recolours them by
REPLACING `material.color` and `material.emissive` with the region's accent - both of which the
shader then MULTIPLIES against the textures. A multiply cannot fight a saturated texel: cyan times
Blink's authored orange crystal is still orange, which is exactly the bug this staging fixes (all
four regional staves glowed fire-coloured in the lab). The albedo's hot regions and the whole
emissive map are therefore pushed to light neutral grey, and the accent colour arrives at runtime.

WHY LIGHT grey, both maps: the same multiply can only darken. An accent over a mid-grey crystal
lands muddy; over ~0.75 grey it reads as a pale saturated glow. The emissive map is additionally
normalized against its own brightest pixels because the sources are authored for strengths of
2.83-6.06 that no longer ship - `tintedMaterial` forces emissiveIntensity to 1.2 whenever an
emissive map is present, so the map itself must carry the level that used to live in the factor.

Only the base-colour and emissive maps are staged. The normal maps are vector data with no hue to
neutralize and the build reads them raw.

Usage: python tools/minibosses/stage-textures.py
"""
import os

import numpy as np
from PIL import Image

SWORD_DIR = os.path.join(
    ".asset-cache", "sword-pack", "raw", "Assets", "Blink", "Art", "Weapons",
    "LowPoly", "FreeSwords", "Sword15", "Textures",
)
STAFF_DIR = os.path.join(
    ".asset-cache", "staff-pack", "raw", "Assets", "Blink", "Art", "Weapons",
    "Stylized", "Staves", "Textures_Staves",
)
OUT = os.path.join(".asset-cache", "weapon-tex")

# Matches the 512 px ceiling the build applies anyway; staging at target size keeps the numpy work
# a sixteenth of what the 2048 px sources would cost.
LIMIT = 512

# Saturation band over which a pixel transitions from "keep, mildly greyed" to "this is the
# authored accent colour, replace with light grey". The staff crystal and the sword's ember runes
# sit above 0.5; leather, wood grain and steel all sit below 0.3.
SATURATION_LO = 0.30
SATURATION_HI = 0.50

# Every pixel loses this much of its remaining colour, so wood stays wood-shaped but cannot argue
# with a tint multiply; and the whole map gets a gamma lift because the multiply can only darken.
GLOBAL_DESATURATION = 0.35
VALUE_GAMMA = 0.78

# Light-grey target for replaced regions: 0.62 + 0.35 * value keeps the authored shading gradient
# inside the crystal instead of flattening it to one tone.
GREY_BASE = 0.62
GREY_GAIN = 0.35

# The emissive mask's brightest authored texels land here after normalization. High enough that
# accent x map x 1.2 reads as a glow, below 1.0 so the mask keeps its own falloff headroom.
EMISSIVE_PEAK = 0.85


def smoothstep(lo: float, hi: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def neutralize_albedo(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB")).astype(np.float32) / 255.0
    value = rgb.max(axis=2)
    saturation = np.where(value > 0, (value - rgb.min(axis=2)) / np.maximum(value, 1e-6), 0.0)

    lifted = rgb ** VALUE_GAMMA
    grey = lifted.max(axis=2)[..., None]
    mild = lifted * (1.0 - GLOBAL_DESATURATION) + grey * GLOBAL_DESATURATION

    light_grey = np.clip(GREY_BASE + GREY_GAIN * value, 0.0, 1.0)[..., None]
    hot = smoothstep(SATURATION_LO, SATURATION_HI, saturation)[..., None]
    out = mild * (1.0 - hot) + light_grey * hot
    return Image.fromarray((np.clip(out, 0.0, 1.0) * 255.0).round().astype(np.uint8), "RGB")


def neutralize_emissive(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB")).astype(np.float32) / 255.0
    luminance = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    # Normalize against the map's own bright end, not its absolute max: a single stray pixel must
    # not decide the level the whole glow ships at.
    peak = float(np.percentile(luminance, 99.9))
    if peak <= 0.0:
        raise SystemExit("emissive map is entirely black; nothing to normalize")
    grey = np.clip(luminance / peak * EMISSIVE_PEAK, 0.0, 1.0)
    out = np.repeat(grey[..., None], 3, axis=2)
    return Image.fromarray((out * 255.0).round().astype(np.uint8), "RGB")


def main() -> None:
    jobs = [
        (os.path.join(SWORD_DIR, "Sword15_Albedo_Iron.png"), "miniboss_sword_basecolor.png", neutralize_albedo),
        (os.path.join(SWORD_DIR, "Sword15_Emission_Iron.png"), "miniboss_sword_emissive.png", neutralize_emissive),
        (os.path.join(STAFF_DIR, "Staff2_2_6_S06_BaseColor.png"), "miniboss_staff_basecolor.png", neutralize_albedo),
        (os.path.join(STAFF_DIR, "Staff2_2_6_S06_Emissive.png"), "miniboss_staff_emissive.png", neutralize_emissive),
    ]
    os.makedirs(OUT, exist_ok=True)
    for source, name, transform in jobs:
        if not os.path.isfile(source):
            raise SystemExit(f"Staged source missing at {source}. See tools/minibosses/README.md.")
        image = Image.open(source).convert("RGB").resize((LIMIT, LIMIT), Image.LANCZOS)
        out_path = os.path.join(OUT, name)
        transform(image).save(out_path)
        print(f"wrote {out_path}")
    print(f"4 maps staged into {OUT}")


if __name__ == "__main__":
    main()
