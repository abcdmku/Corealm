/**
 * Headless proof for systems/{solids,navigation,movement}.ts.
 *
 * Builds a REAL Recast navmesh in node over a synthetic 80 x 80 m ground plane plus the
 * open-topped carve rings `solidObstacleMeshes` produces, then drives the REAL `Movement` against
 * it. Nothing is faked except the terrain, so every number below is the same code path the game
 * runs; only the world is small enough to reason about.
 */
import * as THREE from "three";
import { Navigation, solidObstacleMeshes } from "../../../game/src/systems/navigation.js";
import { Solids } from "../../../game/src/systems/solids.js";
import { Movement } from "../../../game/src/systems/movement.js";
import { EventBus } from "../../../game/src/core/events.js";
import { createInitialState } from "../../../game/src/state/store.js";
import type { SolidVolume, Vec3 } from "../../../game/src/contracts.js";

const COTTAGE_Z = 0;
const volumes: SolidVolume[] = [
  { kind: "box", id: "cottage", position: [0, 0, COTTAGE_Z], size: [6, 5, 4], rotationY: 0 },
  { kind: "cylinder", id: "trunk", position: [16, 0, 0], radius: 0.6, height: 6 },
  { kind: "box", id: "fence", position: [-16, 0, 0], size: [6, 1.1, 0.3], rotationY: 0 },
  { kind: "box", id: "chest", position: [0, 0, 20], size: [1.2, 0.9, 0.8], rotationY: 0 },
  { kind: "box", id: "anvil", position: [10, 0, 20], size: [1.1, 1.0, 0.7], rotationY: 0 },
];

async function main(): Promise<void> {
  await Navigation.initLibrary();

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80, 80, 80), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.updateMatrixWorld(true);

  const carves = solidObstacleMeshes(volumes);

  const bare = new Navigation();
  bare.build([ground], "solo");
  console.log("navmesh WITHOUT carves:", JSON.stringify({ polys: bare.getDiagnostics().polyCount, ms: bare.getDiagnostics().buildMs }));

  const nav = new Navigation();
  const ok = nav.build([ground, ...carves], "solo");
  const diag = nav.getDiagnostics();
  console.log("navmesh WITH carves:   ", JSON.stringify({ ok, polys: diag.polyCount, ms: diag.buildMs, cs: diag.cellSize, tris: diag.sourceTriangles }));

  // --- A. roof island: probing above the cottage must not snap to a roof.
  const roofProbe = nav.closestPoint([0, 5, COTTAGE_Z]);
  console.log("closestPoint above cottage roof (0,5,0) ->", roofProbe?.map((v) => +v.toFixed(3)));

  // --- B. findPath must not fabricate a leg through the cottage.
  const through = nav.findPath([0, 0, COTTAGE_Z], [0, 0, 20]);
  console.log("findPath from INSIDE the cottage to (0,0,20) ->", through === null ? "null" : JSON.stringify(through.map((p) => p.map((v) => +v.toFixed(2)))));
  const around = nav.findPath([0, 0, -10], [0, 0, 10]);
  console.log("findPath around the cottage (0,0,-10)->(0,0,10) ->", around === null ? "null" : JSON.stringify(around.map((p) => p.map((v) => +v.toFixed(2)))));

  // --- C. drive the real Movement into each volume.
  const solids = new Solids(volumes);
  const events = new EventBus();
  const movement = new Movement(nav, events, { solids });

  const rows: string[] = [];
  function drive(label: string, start: Vec3, forward: number, strafe: number, ticks: number, target: Vec3): void {
    const state = createInitialState(1337, 0);
    state.player.position = nav.closestPoint(start) ?? start;
    const from: Vec3 = [...state.player.position] as Vec3;
    movement.setDirectInput({ forward, strafe, cameraYaw: 0 });
    let atMs = 0;
    for (let i = 0; i < ticks; i += 1) {
      atMs += 100;
      movement.update(state, 100, atMs);
    }
    const end = state.player.position;
    const dx = end[0] - target[0];
    const dz = end[2] - target[2];
    rows.push([
      label.padEnd(26),
      `start (${from[0].toFixed(2)}, ${from[2].toFixed(2)})`.padEnd(24),
      `end (${end[0].toFixed(2)}, ${end[2].toFixed(2)})`.padEnd(24),
      `travelled ${Math.hypot(end[0] - from[0], end[2] - from[2]).toFixed(2)} m`.padEnd(18),
      `centre gap ${Math.hypot(dx, dz).toFixed(2)} m`,
    ].join(" "));
  }

  // cameraYaw 0 => forward -1 walks toward +z, forward +1 toward -z, strafe +1 toward +x.
  drive("cottage wall (W, +z)", [0, 0, -8], -1, 0, 60, [0, 0, COTTAGE_Z]);
  drive("cottage wall (W+A diag)", [-6, 0, -8], -1, 1, 60, [0, 0, COTTAGE_Z]);
  drive("tree trunk", [16, 0, -8], -1, 0, 60, [16, 0, 0]);
  drive("fence", [-16, 0, -8], -1, 0, 60, [-16, 0, 0]);
  drive("bank chest", [0, 0, 12], -1, 0, 60, [0, 0, 20]);
  drive("anvil", [10, 0, 12], -1, 0, 60, [10, 0, 20]);
  drive("open ground control", [30, 0, -20], -1, 0, 60, [30, 0, 20]);
  for (const row of rows) console.log(row);

  // --- D. acceleration: distance covered by short holds, against the old flat 0.4202 m quantum.
  for (const ticks of [1, 2, 3, 5, 10, 20]) {
    const state = createInitialState(1337, 0);
    state.player.position = nav.closestPoint([30, 0, -20]) ?? [30, 0, -20];
    const from: Vec3 = [...state.player.position] as Vec3;
    movement.setDirectInput({ forward: -1, strafe: 0, cameraYaw: 0 });
    let atMs = 0;
    const steps: number[] = [];
    let previous: Vec3 = from;
    for (let i = 0; i < ticks; i += 1) {
      atMs += 100;
      movement.update(state, 100, atMs);
      steps.push(+Math.hypot(state.player.position[0] - previous[0], state.player.position[2] - previous[2]).toFixed(4));
      previous = [...state.player.position] as Vec3;
    }
    // Release and coast.
    movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: 0 });
    let coast = 0;
    for (let i = 0; i < 10; i += 1) {
      atMs += 100;
      const before: Vec3 = [...state.player.position] as Vec3;
      movement.update(state, 100, atMs);
      coast += Math.hypot(state.player.position[0] - before[0], state.player.position[2] - before[2]);
    }
    console.log(
      `hold ${String(ticks * 100).padStart(4)} ms -> ${Math.hypot(state.player.position[0] - from[0], state.player.position[2] - from[2]).toFixed(3)} m total,` +
      ` coast after release ${coast.toFixed(3)} m, per-tick steps [${steps.slice(0, 8).join(", ")}]`,
    );
  }

  // --- E. facing: how far can one tick turn?
  {
    const state = createInitialState(1337, 0);
    state.player.position = nav.closestPoint([30, 0, -20]) ?? [30, 0, -20];
    state.player.facingRad = 0;
    movement.setDirectInput({ forward: 0, strafe: 1, cameraYaw: 0 });
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      movement.update(state, 100, (i + 1) * 100);
      seen.push(+state.player.facingRad.toFixed(3));
    }
    console.log("facing per tick from 0 toward +x:", seen.join(" -> "), "max step", Math.max(...seen.map((v, i) => Math.abs(v - (seen[i - 1] ?? 0)))).toFixed(3), "rad");
  }

  // --- F. path corners and Y: subdivision.
  {
    const state = createInitialState(1337, 0);
    state.player.position = nav.closestPoint([-30, 0, -30]) ?? [-30, 0, -30];
    const started = movement.startPath(state, [30, 0, 30], null, 0);
    console.log("startPath across the world:", JSON.stringify(started), "corners", state.player.movement.path?.length);
  }
  // --- G. click into the cottage must be refused, not walked.
  {
    const state = createInitialState(1337, 0);
    state.player.position = nav.closestPoint([0, 0, -10]) ?? [0, 0, -10];
    const started = movement.startPath(state, [0, 0, COTTAGE_Z], null, 0);
    console.log("startPath INTO the cottage centre:", started === null ? "refused (navigation.failed)" : JSON.stringify(started));
  }
}

void main();
