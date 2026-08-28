/**
 * Part E: how far under the ground does click-to-move put the player?
 *
 * Replicates the diagnosis probe (21 samples along the longest segment, linear corner Y against
 * the navmesh surface Y) on a synthetic terraced slope, then WALKS the same path with the real
 * `Movement.followPath` and records the deviation actually experienced.
 */
import * as THREE from "three";
import { Navigation } from "../../../game/src/systems/navigation.js";
import { Movement } from "../../../game/src/systems/movement.js";
import { EventBus } from "../../../game/src/core/events.js";
import { createInitialState } from "../../../game/src/state/store.js";
import type { RegionId, Vec3 } from "../../../game/src/contracts.js";

/** Four 8 m terraces climbing 5 m each, the shape Karrowmoor has. */
function terraceHeight(x: number, z: number): number {
  const t = (x + 40) / 20;
  const stair = Math.floor(t);
  const frac = t - stair;
  const rise = frac < 0.35 ? (frac / 0.35) * 5 : 5;
  return Math.max(0, stair * 5 + rise) + Math.sin(z * 0.12) * 0.6;
}

async function main(): Promise<void> {
  await Navigation.initLibrary();

  const geometry = new THREE.PlaneGeometry(80, 80, 160, 160);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    position.setY(i, terraceHeight(position.getX(i), position.getZ(i)));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  ground.updateMatrixWorld(true);

  const nav = new Navigation();
  nav.build([ground], "solo");
  console.log("terraced navmesh polys", nav.getDiagnostics().polyCount, "climb", terraceHeight(-38, 0).toFixed(2), "->", terraceHeight(38, 0).toFixed(2), "m");

  const start: Vec3 = [-36, terraceHeight(-36, -20), -20];
  const end: Vec3 = [36, terraceHeight(36, 20), 20];
  const raw = nav.findPath(start, end);
  if (!raw) { console.log("no path"); return; }
  console.log("raw Detour corners:", raw.length);

  // BEFORE: linear Y between the raw corners, sampled 21 times along the longest segment.
  let worstBefore = 0;
  let longest = 0;
  let li = 1;
  for (let i = 1; i < raw.length; i += 1) {
    const d = Math.hypot(raw[i]![0] - raw[i - 1]![0], raw[i]![2] - raw[i - 1]![2]);
    if (d > longest) { longest = d; li = i; }
  }
  const a = raw[li - 1]!; const b = raw[li]!;
  for (let s = 0; s <= 20; s += 1) {
    const t = s / 20;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    const linearY = a[1] + (b[1] - a[1]) * t;
    const surface = nav.closestPoint([x, linearY, z]);
    if (!surface) continue;
    const gap = linearY - surface[1];
    if (Math.abs(gap) > Math.abs(worstBefore)) worstBefore = gap;
  }
  console.log(`BEFORE  longest segment ${longest.toFixed(1)} m, worst linear-Y deviation ${worstBefore.toFixed(3)} m (negative = under the ground)`);

  // AFTER: walk the smoothed, subdivided, re-snapped, terrain-grounded path.
  const events = new EventBus();
  const heightAt = (_region: RegionId, x: number, z: number): number => terraceHeight(x, z);
  for (const grounded of [false, true]) {
    const movement = new Movement(nav, events, grounded ? { heightAt } : {});
    const state = createInitialState(1337, 0);
    state.player.position = nav.closestPoint(start) ?? start;
    movement.startPath(state, end, null, 0);
    const corners = state.player.movement.path?.length ?? 0;
    let worstNav = 0;
    let worstTerrain = 0;
    let ticks = 0;
    while (state.player.movement.mode === "path" && ticks < 400) {
      ticks += 1;
      movement.update(state, 100, ticks * 100);
      const p = state.player.position;
      const surface = nav.closestPoint([p[0], p[1], p[2]]);
      if (surface) {
        const gap = p[1] - surface[1];
        if (Math.abs(gap) > Math.abs(worstNav)) worstNav = gap;
      }
      const groundGap = p[1] - terraceHeight(p[0], p[2]);
      if (Math.abs(groundGap) > Math.abs(worstTerrain)) worstTerrain = groundGap;
    }
    console.log(
      `AFTER   heightAt ${grounded ? "ON " : "OFF"}: ${corners} corners, ${ticks} ticks,` +
      ` worst deviation from navmesh ${worstNav.toFixed(3)} m, worst from DRAWN terrain ${worstTerrain.toFixed(3)} m`,
    );
  }
}
void main();
