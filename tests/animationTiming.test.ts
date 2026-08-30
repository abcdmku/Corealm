import { describe, expect, it } from "vitest";
import {
  crossedAnimationMarker,
  gatheringActionPhase,
  motionMarkerPhases,
} from "../game/src/render/characterRig.js";

describe("character animation timing", () => {
  it("places the chopping contact frame on every gathering deadline", () => {
    expect(gatheringActionPhase(1_800, 1_800)).toBeCloseTo(0.22);
    expect(gatheringActionPhase(900, 1_800)).toBeCloseTo(0.72);
    expect(gatheringActionPhase(0, 1_800)).toBeCloseTo(0.22);
    expect(crossedAnimationMarker(0.17, 0.27, 0.22)).toBe(true);
    expect(crossedAnimationMarker(0.21999999999999997, 0.225, 0.22)).toBe(false);
  });

  it("keeps measured foot contacts half a locomotion cycle apart", () => {
    expect(motionMarkerPhases("Walk_Loop", "footstep")).toEqual([0.10, 0.60]);
    expect(motionMarkerPhases("Jog_Fwd_Loop", "footstep")).toEqual([0.10, 0.60]);
  });

  it("detects markers across a loop wrap without firing unrelated markers", () => {
    expect(crossedAnimationMarker(0.95, 0.05, 0.02)).toBe(true);
    expect(crossedAnimationMarker(0.95, 0.05, 0.40)).toBe(false);
    expect(crossedAnimationMarker(0.30, 0.30, 0.30)).toBe(false);
  });

  it("separates sword and spell wind-up from contact", () => {
    expect(motionMarkerPhases("Sword_Attack", "swing")).toEqual([0.18]);
    expect(motionMarkerPhases("Sword_Attack", "impact")).toEqual([0.30]);
    expect(motionMarkerPhases("Spell_Simple_Shoot", "swing")).toEqual([0.32]);
    expect(motionMarkerPhases("Spell_Simple_Shoot", "impact")).toEqual([0.42]);
  });
});
