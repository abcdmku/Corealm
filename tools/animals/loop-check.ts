/**
 * Measures how cleanly a looping clip joins back to its own start.
 *
 * `Walk` and `Idle` play on LoopRepeat, so the pose at t=duration is followed immediately by the
 * pose at t=0. If those two poses differ, every loop is a visible pop, and at a 0.5 s walk cycle
 * that is a pop twice a second - which is what "buggy and jittery" walking looks like.
 *
 * Reported as the worst per-track discontinuity: degrees for rotations, centimetres for
 * translations. A clean cycle is near zero because the animator authored the first and last frame
 * to match; a subclip that cut the range one frame short or long is not.
 */
import path from "node:path";
import { readdir } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { gameRoot } from "../lib/paths.js";

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const dir = path.join(gameRoot, "public", "assets", "models", "animal");
const files = (await readdir(dir)).filter((f) => f.endsWith(".glb")).sort();

function angleBetween(a: number[], b: number[]): number {
  const dot = Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

console.log("asset                    clip    wrap gap   wrap / typical frame");
const bad: string[] = [];
for (const file of files) {
  const id = file.replace(".glb", "");
  const doc = await io.read(path.join(dir, file));
  for (const anim of doc.getRoot().listAnimations()) {
    const name = anim.getName();
    if (name !== "Walk" && name !== "Idle") continue;

    // The wrap gap only means something next to the clip's OWN per-frame motion. A fast run moves
    // a leg tens of degrees per frame, so a large wrap gap can be perfectly correct: the cycle
    // simply ends one frame before it repeats. A gap several times the typical step is a real pop.
    let worstRot = 0;
    let worstPos = 0;
    let worstRatio = 0;
    let ratioTrack = "";
    for (const channel of anim.listChannels()) {
      const out = channel.getSampler()?.getOutput();
      const values = out?.getArray();
      if (!values || values.length === 0) continue;
      const stride = channel.getTargetPath() === "rotation" ? 4 : 3;
      if (values.length < stride * 2) continue;
      const first = Array.from(values.slice(0, stride), Number);
      const last = Array.from(values.slice(values.length - stride), Number);
      if (stride === 4) {
        const gap = angleBetween(first, last);
        worstRot = Math.max(worstRot, gap);
        const steps: number[] = [];
        for (let i = stride; i < values.length; i += stride) {
          steps.push(angleBetween(
            Array.from(values.slice(i - stride, i), Number),
            Array.from(values.slice(i, i + stride), Number),
          ));
        }
        steps.sort((a, b) => a - b);
        const median = steps.length ? steps[Math.floor(steps.length / 2)]! : 0;
        if (median > 0.5 && gap / median > worstRatio) {
          worstRatio = gap / median;
          ratioTrack = `${gap.toFixed(0)}deg vs ${median.toFixed(0)}deg/frame`;
        }
      }
      else if (channel.getTargetPath() === "translation") {
        worstPos = Math.max(worstPos, Math.hypot(last[0]! - first[0]!, last[1]! - first[1]!, last[2]! - first[2]!));
      }
    }
    // Three times the median frame step is the threshold: a clean cycle wraps within about one
    // frame of motion, a broken one jumps several frames' worth in a single display frame.
    const flag = worstRatio > 3 ? "   <== POPS" : "";
    if (flag) bad.push(`${id} ${name}: wrap is ${worstRatio.toFixed(1)}x a normal frame (${ratioTrack})`);
    console.log(`${id.padEnd(23)} ${name.padEnd(6)} ${worstRot.toFixed(1).padStart(8)} deg wrap  ${worstRatio.toFixed(1).padStart(5)}x frame${flag}`);
  }
}
console.log(`\n${bad.length} looping clip(s) that do not join up`);
for (const b of bad) console.log(`  ${b}`);
