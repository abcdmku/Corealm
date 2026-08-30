import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  LEVEL_UP_COLOURS, LEVEL_UP_DURATION_MS, LevelUpVfx,
} from "../game/src/render/levelUpVfx.js";

describe("level-up VFX", () => {
  it("draws warm Magic Effects FREE layers and ends at the configured duration", () => {
    const parent = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    const effect = new LevelUpVfx({ parent, camera, playerPosition: () => [2, 3, 4] });

    effect.burst(500, 7);
    effect.update(520);
    expect(effect.activeBursts()).toBe(1);
    expect(effect.liveParticles()).toBeGreaterThan(0);
    expect(effect.drawCalls()).toBe(5);

    effect.update(500 + LEVEL_UP_DURATION_MS * 0.8);
    expect(effect.activeBursts()).toBe(1);
    expect(effect.liveParticles()).toBeGreaterThan(0);

    effect.update(500 + LEVEL_UP_DURATION_MS);
    expect(effect.activeBursts()).toBe(0);
    expect(effect.liveParticles()).toBe(0);
    expect(effect.drawCalls()).toBe(0);
    expect(LEVEL_UP_COLOURS).toEqual({ core: 0xfff8dc, edge: 0xf2d27a });

    effect.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it("keeps a burst born just after the current animation-frame timestamp", () => {
    const parent = new THREE.Group();
    const effect = new LevelUpVfx({
      parent,
      camera: new THREE.PerspectiveCamera(),
      playerPosition: () => [0, 0, 0],
    });

    effect.burst(1002, 7);
    effect.update(1000);
    expect(effect.activeBursts()).toBe(1);

    effect.update(1016);
    expect(effect.liveParticles()).toBeGreaterThan(0);
    expect(effect.drawCalls()).toBe(5);

    effect.dispose();
  });
});
