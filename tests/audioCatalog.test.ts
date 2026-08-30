import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIO_CUE_IDS } from "../game/src/contracts.js";
import type { GroundSurfaceSample } from "../game/src/contracts.js";
import {
  COREALM_AUDIO_CATALOG, FUTURE_REGION_MUSIC_FILES, cueForActivity, cueForMovement,
  footstepSurfaceAt, loopsForRegion,
} from "../game/src/audio/index.js";
import type { AudioVariant } from "../game/src/audio/index.js";

describe("Corealm audio catalog", () => {
  it("maps every frozen semantic cue to at least one local curated asset", async () => {
    expect(Object.keys(COREALM_AUDIO_CATALOG.cues).sort()).toEqual([...AUDIO_CUE_IDS].sort());

    const urls = new Set<string>();
    for (const definition of Object.values(COREALM_AUDIO_CATALOG.cues)) {
      expect(definition.variants.length).toBeGreaterThan(0);
      for (const variant of definition.variants as readonly (string | AudioVariant)[]) {
        const url = typeof variant === "string" ? variant : variant.url;
        expect(url).toMatch(/^\/audio\/sfx\/[a-z0-9-/]+\.ogg$/);
        urls.add(url);
      }
    }
    for (const definition of Object.values(COREALM_AUDIO_CATALOG.loops)) {
      expect(definition.url).toMatch(/^\/audio\/(?:music|ambience)\/[a-z0-9-/]+\.(?:mp3|ogg)$/);
      urls.add(definition.url);
    }

    await Promise.all([...urls].map((url) => access(fileURLToPath(
      new URL(`../game/public${url}`, import.meta.url),
    ))));
  });

  it("ships music only for current regions and leaves Gravelmaw without a fallback", () => {
    expect(loopsForRegion("fallowmarch", COREALM_AUDIO_CATALOG.regions, 0)).toEqual({
      music: "music.starter-plains",
      ambient: "ambient.open-plains",
    });
    expect(loopsForRegion("fallowmarch", COREALM_AUDIO_CATALOG.regions, 1).music)
      .toBe("music.distant-plains");
    expect(loopsForRegion("vellenwood", COREALM_AUDIO_CATALOG.regions).music)
      .toBe("music.deep-woodland");
    expect(loopsForRegion("karrowmoor", COREALM_AUDIO_CATALOG.regions).music)
      .toBe("music.stone-city");
    expect(loopsForRegion("gravelmaw", COREALM_AUDIO_CATALOG.regions)).toEqual({
      music: null,
      ambient: "ambient.cave",
    });

    const catalogText = JSON.stringify(COREALM_AUDIO_CATALOG).toLowerCase();
    for (const filename of FUTURE_REGION_MUSIC_FILES) expect(catalogText).not.toContain(filename);
    expect(catalogText).not.toContain("c:\\users\\");
  });

  it("keeps ambiguous farming, smelting, consumption, and traversal selections explicit", () => {
    expect(cueForActivity({ kind: "farming", op: "rake" })).toBe("farm.rake");
    expect(cueForActivity({ kind: "farming", op: "plant" })).toBe("farm.plant");
    expect(cueForActivity({ kind: "farming", op: "harvest" })).toBe("farm.harvest");
    expect(cueForActivity({ kind: "production", skill: "smithing", op: "smelt", phase: "started" })).toBeNull();
    expect(cueForActivity({ kind: "production", skill: "smithing", op: "smelt", phase: "completed" })).toBe("production.smelt");
    expect(cueForActivity({ kind: "production", skill: "smithing", op: "smith", phase: "completed" })).toBe("production.smith");
    expect(cueForActivity({ kind: "eating" })).toBe("interaction.consume");
    expect(cueForActivity({ kind: "traversing", op: "climb" })).toBe("interaction.climb");
    expect(cueForActivity({ kind: "traversing", op: "vault" })).toBe("interaction.vault");
  });

  it("maps visible ground materials to distinct footstep cues", () => {
    const ground = (surface: keyof GroundSurfaceSample): GroundSurfaceSample => ({
      grass: 0, dry: 0, rock: 0, gravel: 0, dirt: 0, mud: 0, cobble: 0, wet: 0,
      [surface]: 1,
    });

    expect(cueForMovement({
      regionId: "fallowmarch",
      surface: footstepSurfaceAt("fallowmarch", [-240, 0, -150], ground("grass")),
    })).toBe("movement.footstep_grass");
    expect(cueForMovement({
      regionId: "fallowmarch",
      surface: footstepSurfaceAt("fallowmarch", [-160, 0, -118], ground("dirt")),
    })).toBe("movement.footstep_dirt");
    expect(cueForMovement({
      regionId: "fallowmarch",
      surface: footstepSurfaceAt("fallowmarch", [-160, 0, -80], ground("dirt")),
    })).toBe("movement.footstep_stone");
    expect(cueForMovement({
      regionId: "vellenwood",
      surface: footstepSurfaceAt("vellenwood", [60, 0, 120], ground("grass")),
    })).toBe("movement.footstep_wood");
    expect(cueForMovement({
      regionId: "vellenwood",
      surface: footstepSurfaceAt("vellenwood", [20, 0, 120], ground("grass")),
    })).toBe("movement.footstep_forest");
    expect(cueForMovement({
      regionId: "karrowmoor",
      surface: footstepSurfaceAt("karrowmoor", [140, 0, -60], ground("grass")),
    })).toBe("movement.footstep_stone");
    expect(cueForMovement({
      regionId: "karrowmoor",
      surface: footstepSurfaceAt("karrowmoor", [230, 0, 80], ground("grass")),
    })).toBe("movement.footstep_grass");
    expect(cueForMovement({
      regionId: "gravelmaw",
      surface: footstepSurfaceAt("gravelmaw", [170, 12, 20], ground("grass")),
    })).toBe("movement.footstep_cave");
  });

  it("keeps grass, dirt, and stone footsteps balanced and dirt free of the sharp source", () => {
    const grass = COREALM_AUDIO_CATALOG.cues["movement.footstep_grass"];
    const dirt = COREALM_AUDIO_CATALOG.cues["movement.footstep_dirt"];
    const stone = COREALM_AUDIO_CATALOG.cues["movement.footstep_stone"];

    expect(grass.gain).toBe(0.5);
    expect(dirt).toMatchObject({ gain: 0.23, playbackRate: 0.82 });
    expect(stone.gain).toBe(0.22);
    expect(dirt.variants.map((variant) => typeof variant === "string" ? variant : variant.url))
      .toEqual([
        "/audio/sfx/oga/footstep-ground-01.ogg",
        "/audio/sfx/oga/footstep-ground-02.ogg",
      ]);
    expect(dirt.variants[1]).toEqual({
      url: "/audio/sfx/oga/footstep-ground-02.ogg",
      gain: 0.57,
    });
    expect(stone.variants[0]).toEqual({
      url: "/audio/sfx/nox/footstep-stone-01.ogg",
      gain: 0.57,
    });
  });
});
