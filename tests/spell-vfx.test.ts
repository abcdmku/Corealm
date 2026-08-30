import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SpellVfx } from "../game/src/render/spellVfx.js";
import { SPELL_RUNGS } from "../game/src/contracts.js";
import type { SpellRung } from "../game/src/contracts.js";

/**
 * The spell effect layer, stepped frame by frame with no browser.
 *
 * This runs headlessly because it has to. `tools/verify-magic.ts` can only sample
 * `liveParticles()` between rendered frames, and on the software rasteriser the harness uses those
 * are seconds apart — so it catches random moments of a cast and almost never the impact peak. It
 * measured a surge at 16 particles that this measures at 143. Stepping the layer directly at 60 Hz
 * sees every frame, which is the only way these counts can be asserted at all.
 *
 * `render/spellVfx.ts` guards its texture load against a missing `document`, so the constructor is
 * safe here; the atlas is simply never fetched and only the pixels are absent.
 */

const DISTANCE_M = 12;

function harness(): SpellVfx {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
  camera.position.set(0, 12, 18);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  return new SpellVfx({ parent: new THREE.Group(), camera, groundHeightAt: () => 0 });
}

/** Peak live instances in each stage of one cast, plus the worst draw-call count seen. */
function sweep(vfx: SpellVfx, rung: SpellRung, hit = true): {
  charge: number; flight: number; impact: number; overall: number; draws: number;
} {
  const total = vfx.flightMs(rung, DISTANCE_M);
  vfx.cast({ id: `t-${rung}-${hit}`, element: "fire", rung, from: [0, 1.1, 0], to: [DISTANCE_M, 0, 0], hit }, 0);
  const stage = { charge: 0, flight: 0, impact: 0 };
  let overall = 0;
  let draws = 0;
  for (let t = 0; t <= total + 1200; t += 16) {
    vfx.update(t);
    const live = vfx.liveParticles();
    overall = Math.max(overall, live);
    draws = Math.max(draws, vfx.drawCalls());
    const which = t < total * 0.4 ? "charge" : t < total ? "flight" : "impact";
    stage[which] = Math.max(stage[which], live);
  }
  vfx.update(total + 6000);
  return { ...stage, overall, draws };
}

/**
 * Every instance's un-stretched width at the peak of a cast, read back off the instance matrices.
 *
 * A spark is scaled `(width * stretch, width, width)`, so the SMALLEST of the three scale components
 * is the spark's true width whatever direction it was rolled to. Reading it back is the only way to
 * assert a size that nothing else exposes.
 */
function instanceWidths(vfx: SpellVfx, parent: THREE.Group, rung: SpellRung): number[] {
  const total = vfx.flightMs(rung, DISTANCE_M);
  vfx.cast({ id: `w-${rung}`, element: "fire", rung, from: [0, 1.1, 0], to: [DISTANCE_M, 0, 0], hit: true }, 0);
  let best: number[] = [];
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  for (let t = 0; t <= total + 1200; t += 16) {
    vfx.update(t);
    const live = vfx.liveParticles();
    if (live <= best.length) continue;
    const mesh = parent.children.find((child) => (child as THREE.InstancedMesh).isInstancedMesh);
    if (!mesh) continue;
    const widths: number[] = [];
    for (let index = 0; index < live; index += 1) {
      (mesh as THREE.InstancedMesh).getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      widths.push(Math.min(scale.x, scale.y, scale.z));
    }
    best = widths;
  }
  vfx.update(total + 6000);
  return best;
}

describe("spark size", () => {
  it("is the same at every rung — only the count scales", () => {
    // The requirement in one assertion: a surge is not a lash with bigger grains. An earlier pass
    // scaled spark width off the rung radius and produced 12 cm sparks stretched to 70 cm on a
    // surge, which read as flung debris rather than sparks.
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
    camera.position.set(0, 12, 18);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);
    const parent = new THREE.Group();
    const vfx = new SpellVfx({ parent, camera, groundHeightAt: () => 0 });
    try {
      const smallest = (rung: SpellRung): number => Math.min(...instanceWidths(vfx, parent, rung));
      const lash = smallest("lash");
      const surge = smallest("surge");
      // 1.8 cm is `SPARK_WIDTH_MIN`; the tolerance covers the per-particle hash landing on a
      // slightly different draw of the 1.8-4.0 cm range between the two casts.
      expect(lash).toBeGreaterThan(0.015);
      expect(lash).toBeLessThan(0.045);
      expect(surge).toBeGreaterThan(0.015);
      expect(surge).toBeLessThan(0.045);
      expect(Math.abs(surge - lash)).toBeLessThan(0.01);
    } finally {
      vfx.dispose();
    }
  });
});

describe("spell effect density", () => {
  it("reserves the production cap of 640 live particle instances", () => {
    const parent = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
    const vfx = new SpellVfx({ parent, camera, groundHeightAt: () => 0 });
    try {
      const mesh = parent.children.find((child) => (child as THREE.InstancedMesh).isInstancedMesh);
      expect(mesh, "particle mesh").toBeDefined();
      expect((mesh as THREE.InstancedMesh).instanceMatrix.count).toBe(640);
    } finally {
      vfx.dispose();
    }
  });

  it("spends its particles a few at the caster, a few in flight, and a lot on impact", () => {
    const vfx = harness();
    try {
      for (const rung of SPELL_RUNGS) {
        const peak = sweep(vfx, rung);
        // The shape the effect is designed around: the landing is where a spell reads, so the
        // impact has to dominate both of the stages that lead into it. Spreading the budget evenly
        // makes a thrown spell look like a firework carried on a stick.
        expect(peak.impact, `${rung} impact vs charge`).toBeGreaterThan(peak.charge * 2);
        expect(peak.impact, `${rung} impact vs flight`).toBeGreaterThan(peak.flight * 2);
        expect(peak.charge, `${rung} charge is not empty`).toBeGreaterThan(0);
        expect(peak.flight, `${rung} flight is not empty`).toBeGreaterThan(0);
      }
    } finally {
      vfx.dispose();
    }
  });

  it("gets markedly denser up the ladder", () => {
    const vfx = harness();
    try {
      const peaks = SPELL_RUNGS.map((rung) => ({ rung, ...sweep(vfx, rung) }));
      for (let index = 1; index < peaks.length; index += 1) {
        const previous = peaks[index - 1]!;
        const current = peaks[index]!;
        expect(current.impact, `${current.rung} vs ${previous.rung}`).toBeGreaterThan(previous.impact * 1.4);
      }
      // A surge is the most expensive spell in the game and has to look like it against a lash.
      expect(peaks[peaks.length - 1]!.impact).toBeGreaterThan(peaks[0]!.impact * 4);
    } finally {
      vfx.dispose();
    }
  });

  it("stays inside one draw call and reaps everything", () => {
    const vfx = harness();
    try {
      for (const rung of SPELL_RUNGS) {
        const peak = sweep(vfx, rung);
        // The budget the whole layer is built around: Highcairn measures 397 draw calls against 400.
        expect(peak.draws, `${rung} draw calls`).toBe(1);
        expect(peak.overall, `${rung} within the 640 buffer`).toBeLessThanOrEqual(640);
      }
      expect(vfx.liveParticles()).toBe(0);
      expect(vfx.drawCalls()).toBe(0);
    } finally {
      vfx.dispose();
    }
  });

  it("spends far less on a miss than on a hit", () => {
    const vfx = harness();
    try {
      const hit = sweep(vfx, "surge", true);
      const miss = sweep(vfx, "surge", false);
      // A miss has to be legible AND cheap; a fizzle throwing a full impact's worth of sparks is
      // neither, and would read as a hit that failed to do damage.
      expect(miss.impact).toBeLessThan(hit.impact * 0.5);
      expect(miss.impact).toBeGreaterThan(0);
    } finally {
      vfx.dispose();
    }
  });
});
