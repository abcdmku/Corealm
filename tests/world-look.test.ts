import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_PALETTES,
  architectureMaterialRole,
  MaterialLibrary,
} from "../game/src/render/materials.js";
import { DAYLIGHT_LOOK } from "../game/src/render/renderer.js";
import { MOVEMENT, PLAYER_SPEED } from "../game/src/app/config.js";

function channels(hex: number): readonly [number, number, number] {
  return [(hex >>> 16) & 0xff, (hex >>> 8) & 0xff, hex & 0xff];
}

function srgbLuminance(hex: number): number {
  const [r, g, b] = channels(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function isBrightOrange(hex: number): boolean {
  const [red, green, blue] = channels(hex).map((value) => value / 255) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return hue <= 45 && saturation >= 0.55 && max >= 0.50;
}

describe("regional architecture look", () => {
  it("classifies only stable Medieval Village material families", () => {
    expect(architectureMaterialRole("MI_RoundTiles")).toBe("roof");
    expect(architectureMaterialRole("MI_Plaster")).toBe("plaster");
    expect(architectureMaterialRole("MI_UnevenBrick")).toBe("stone");
    expect(architectureMaterialRole("MI_WoodTrim")).toBe("timber");
    expect(architectureMaterialRole("MI_Vine@architecture:vellenwood:moss")).toBe("moss");
    expect(architectureMaterialRole("MI_Leaves")).toBeNull();
  });

  it("uses distinct muted roofs and readable dark framing", () => {
    const palettes = Object.values(ARCHITECTURE_PALETTES);
    expect(new Set(palettes.map((palette) => palette.roof)).size).toBe(palettes.length);
    for (const palette of palettes) {
      expect(isBrightOrange(palette.roof)).toBe(false);
      expect(srgbLuminance(palette.plaster) - srgbLuminance(palette.timber)).toBeGreaterThan(0.16);
    }
  });

  it("reuses source texture detail while isolating regional shaders", () => {
    const library = new MaterialLibrary();
    const texture = new THREE.DataTexture(new Uint8Array([180, 80, 45, 255]), 1, 1);
    const source = new THREE.MeshStandardMaterial({ map: texture });
    source.name = "MI_RoundTiles";

    const woodland = library.architecture(source, "vellenwood", "roof") as THREE.MeshStandardMaterial;
    const highlands = library.architecture(source, "karrowmoor", "roof") as THREE.MeshStandardMaterial;
    expect(woodland.map).toBe(texture);
    expect(highlands.map).toBe(texture);
    expect(woodland).not.toBe(highlands);
    expect(woodland.customProgramCacheKey()).not.toBe(highlands.customProgramCacheKey());
    expect(architectureMaterialRole(highlands.name)).toBe("roof");

    library.dispose();
    source.dispose();
    texture.dispose();
  });
});

describe("warm daytime lighting", () => {
  it("keeps a lower diagonal sun without dimming the calibrated sky exposure", () => {
    const { x, y, z } = DAYLIGHT_LOOK.sunOffset;
    const horizontal = Math.hypot(x, z);
    const elevation = THREE.MathUtils.radToDeg(Math.atan2(y, horizontal));
    expect(elevation).toBeGreaterThanOrEqual(22);
    expect(elevation).toBeLessThanOrEqual(29);
    expect(horizontal / y).toBeGreaterThanOrEqual(1.8);
    expect(horizontal / y).toBeLessThanOrEqual(2.5);
    expect(Math.abs(x) / horizontal).toBeGreaterThan(0.3);
    expect(Math.abs(z) / horizontal).toBeGreaterThan(0.3);
    expect(DAYLIGHT_LOOK.toneMappingExposure).toBe(1);
    expect(DAYLIGHT_LOOK.sunIntensity * DAYLIGHT_LOOK.toneMappingExposure).toBeLessThan(2.8);
  });

  it("uses a warm daylight key rather than orange sunset light", () => {
    const [red, green, blue] = channels(DAYLIGHT_LOOK.sunColour);
    expect(green / red).toBeGreaterThanOrEqual(0.78);
    expect(green / red).toBeLessThanOrEqual(0.95);
    expect(blue / red).toBeGreaterThanOrEqual(0.60);
    expect(blue / red).toBeLessThanOrEqual(0.85);
  });
});

describe("player run presentation", () => {
  it("keeps the requested ground speed while using a brisk authored cadence", () => {
    expect(PLAYER_SPEED).toBe(4.2);
    expect(MOVEMENT.runSpeed).toBe(PLAYER_SPEED);
    expect(MOVEMENT.runPlaybackRate).toBe(1.2);
    expect(MOVEMENT.runMinPlaybackRate).toBeGreaterThanOrEqual(0.9);
  });
});
