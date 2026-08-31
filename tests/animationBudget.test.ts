import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { orderAnimationBudget } from "../game/src/render/entityViews.js";

/**
 * Only ten skinned mixers are ticked per frame, and which ten decides whether a crowd animates.
 *
 * The bug this covers was reported from play as "nearly all creatures fail at walking smoothly" and
 * is invisible everywhere else: the feature lab spawns ONE creature, and one is always under the
 * cap. Measured in the Gravelmaw, where 17 stand within 40 m, ten animated and five stood frozen
 * mid-stride while sliding toward the player.
 *
 * Two earlier fixes degenerated straight back into it, both because they ranked the contested half
 * of the budget by a quantity that SATURATES — a starvation threshold in seconds, then clamped owed
 * time. On a slow machine one frame's delta exceeds either, every starved rig ties, and the sort
 * falls through to distance. Neither failure was visible without measuring a live crowd, which is
 * why the policy is a pure function now and why the frame-rate cases below exist.
 */

interface Rig {
  id: string;
  position: THREE.Vector3;
  lastTickedFrame: number;
}

function rigs(count: number, spacing = 2): Rig[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `rig-${index}`,
    position: new THREE.Vector3(index * spacing, 0, 0),
    lastTickedFrame: 0,
  }));
}

/** Runs the policy for `frames` frames and reports how many times each rig was ticked. */
function run(all: Rig[], cap: number, frames: number, viewer?: THREE.Vector3): Map<string, number> {
  const ticks = new Map<string, number>(all.map((rig) => [rig.id, 0]));
  // The sequence is bumped PER RIG, mirroring `EntityViews.update`. Stamping every rig ticked in
  // one frame with the same number leaves ties that a stable sort settles by array position, and
  // that position is distance — see the evenness case below.
  let sequence = 0;
  for (let frame = 1; frame <= frames; frame += 1) {
    const ranked = [...all];
    orderAnimationBudget(ranked, cap, viewer);
    for (const rig of ranked.slice(0, cap)) {
      sequence += 1;
      rig.lastTickedFrame = sequence;
      ticks.set(rig.id, (ticks.get(rig.id) ?? 0) + 1);
    }
  }
  return ticks;
}

describe("animation budget", () => {
  const viewer = new THREE.Vector3(0, 0, 0);

  it("ticks everything when the crowd fits under the cap", () => {
    const all = rigs(6);
    const ticks = run(all, 10, 20, viewer);
    for (const rig of all) expect(ticks.get(rig.id), rig.id).toBe(20);
  });

  it("keeps the nearest rigs on every single frame", () => {
    // Whatever else rotates, the creature the player is fighting must never skip a frame.
    const all = rigs(20);
    const ticks = run(all, 10, 40, viewer);
    // NEAREST_ANIMATION_SHARE is 0.5, so ceil(10 * 0.5) = 5 reserved slots.
    for (const rig of all.slice(0, 5)) expect(ticks.get(rig.id), rig.id).toBe(40);
  });

  it("never freezes a rig, however long the crowd outnumbers the budget", () => {
    // The actual regression. Every rig inside the radius has to advance sometimes.
    const all = rigs(17);
    const ticks = run(all, 10, 60, viewer);
    for (const rig of all) {
      expect(ticks.get(rig.id), `${rig.id} never animated`).toBeGreaterThan(0);
    }
  });

  it("shares the contested half of the budget evenly", () => {
    // 17 rigs, 10 slots, 5 of them reserved for the nearest. The other 12 share 5 slots, so each
    // should land close to 60 * 5 / 12 = 25 ticks. Even sharing is what makes the reduced refresh
    // rate uniform rather than leaving one unlucky rig refreshing half as often as its neighbour,
    // which is what a per-FRAME counter produced: ties settled by array position, so the nearest of
    // the contested rigs took every one of them.
    const all = rigs(17);
    const ticks = run(all, 10, 60, viewer);
    const contested = all.slice(5).map((rig) => ticks.get(rig.id) ?? 0);
    const lowest = Math.min(...contested);
    const highest = Math.max(...contested);
    expect(highest - lowest, `spread ${lowest}..${highest}`).toBeLessThanOrEqual(1);
  });

  it("holds at every crowd size, not just the one that was measured", () => {
    // Both previous fixes were correct at 60 fps and wrong at 7, and the reason was that their
    // ordering key depended on elapsed time. This one reads no clock at all, so frame rate cannot
    // enter into it — what is worth checking instead is that the guarantee survives any ratio of
    // crowd to budget, including the pathological one where the crowd is many times the cap.
    for (const crowd of [11, 17, 24, 40, 120]) {
      const all = rigs(crowd);
      const frames = crowd * 4;
      const ticks = run(all, 10, frames, viewer);
      for (const rig of all) {
        expect(ticks.get(rig.id), `crowd ${crowd}: ${rig.id} never animated`).toBeGreaterThan(0);
      }
      const contested = all.slice(5).map((rig) => ticks.get(rig.id) ?? 0);
      expect(
        Math.max(...contested) - Math.min(...contested),
        `crowd ${crowd} refresh spread`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("rotates the whole budget when there is no viewer to be near", () => {
    // Without a camera there is no "nearest", so nothing is reserved and every rig shares equally.
    const all = rigs(15);
    const ticks = run(all, 10, 60);
    const counts = all.map((rig) => ticks.get(rig.id) ?? 0);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("leaves the order alone when it is not over budget", () => {
    // Under the cap the policy must be exactly the old nearest-first sort, so a change here cannot
    // quietly alter which rig the renderer picks in the common case.
    const all = rigs(4);
    all[0]!.lastTickedFrame = 99;
    const ranked = [all[3]!, all[1]!, all[0]!, all[2]!];
    orderAnimationBudget(ranked, 10, viewer);
    expect(ranked.map((rig) => rig.id)).toEqual(["rig-0", "rig-1", "rig-2", "rig-3"]);
  });
});
