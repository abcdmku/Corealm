/**
 * Step response of the occlusion spring, on a stubbed clock.
 *
 * `OrbitCamera.update` reads `performance.now()`, so overriding it drives the real class at an
 * exact 60 Hz without a browser. The scripted probe is what a blocker looks like to the camera:
 * clear, blocked for N frames, clear. 12 frames is a fence post at walking pace; 60 is a wall.
 */
let clockMs = 0;
(globalThis as unknown as { performance: { now: () => number } }).performance = { now: () => clockMs };

const THREE = await import("three");
const { OrbitCamera } = await import("../../../game/src/render/camera.js");

const BLOCK_AT = 5.0;
const BLOCK_FROM = 60;

for (const blockFrames of [6, 12, 30, 60]) {
  const camera = new THREE.PerspectiveCamera(55, 1.78, 0.1, 280);
  const rig = new OrbitCamera(camera);
  rig.setPose(0, 0.52, 18);
  let blocked = false;
  rig.setOcclusionProbe(() => (blocked ? BLOCK_AT : null));
  // Far from any settlement, so the overhead-cover slabs never enter this.
  clockMs = 0;
  rig.update(0, 0, 0, true);

  const d: number[] = [];
  const blockTo = BLOCK_FROM + blockFrames;
  for (let frame = 0; frame < 420; frame += 1) {
    blocked = frame >= BLOCK_FROM && frame < blockTo;
    clockMs += 16.667;
    rig.update(0, 0, 0);
    d.push(rig.snapshot().distance);
  }
  const closest = Math.min(...d);
  const backTo90 = d.findIndex((v, i) => i > blockTo && v > 18 - (18 - closest) * 0.1);
  const backToFull = d.findIndex((v, i) => i > blockTo && v > 17.99);
  let reversals = 0;
  let sign = 0;
  for (let i = 1; i < d.length; i += 1) {
    const delta = d[i]! - d[i - 1]!;
    if (Math.abs(delta) < 0.005) continue;
    const next = delta > 0 ? 1 : -1;
    if (sign !== 0 && next !== sign) reversals += 1;
    sign = next;
  }
  console.log(
    `block ${String(blockFrames).padStart(2)} frames (${String(Math.round(blockFrames * 16.667)).padStart(4)} ms)`
    + `  closest=${closest.toFixed(2)} m`
    + `  90% back after ${String(Math.round((backTo90 - blockTo) * 16.667)).padStart(4)} ms`
    + `  full back after ${String(Math.round((backToFull - blockTo) * 16.667)).padStart(4)} ms`
    + `  reversals=${reversals}`,
  );
}
