/**
 * The full walk-into table, headless, against a REAL Recast navmesh.
 *
 * Volume sizes are the real manifest sizes of the assets named in the diagnosis, so the standoffs
 * below are the standoffs the game will produce once `regionBuilder` emits the volumes and root
 * wires them. BEFORE = navmesh with no carves and a `Movement` with no ports, which is Phase 1.
 * AFTER = open-topped carves in the navmesh plus `Solids` and the entity port on `Movement`.
 */
import * as THREE from "three";
import { Navigation, solidObstacleMeshes } from "../../../game/src/systems/navigation.js";
import { Solids } from "../../../game/src/systems/solids.js";
import { Movement, type MovementEntityPort } from "../../../game/src/systems/movement.js";
import { EventBus } from "../../../game/src/core/events.js";
import { createInitialState } from "../../../game/src/state/store.js";
import { SpatialIndex } from "../../../game/src/world/spatial.js";
import { INTERACT_RANGE } from "../../../game/src/app/config.js";
import type { EntityId, SemanticEntity, SolidVolume, Vec3 } from "../../../game/src/contracts.js";

interface Case { label: string; centre: [number, number]; standoff: number; volume: SolidVolume | null }

const cases: Case[] = [
  { label: "cottage wall 6x4", centre: [0, 0], standoff: 8, volume: { kind: "box", id: "cottage", position: [0, 0, 0], size: [6, 5, 4], rotationY: 0 } },
  { label: "gatehouse pier 2x3", centre: [20, 0], standoff: 8, volume: { kind: "box", id: "pier", position: [20, 0, 0], size: [2, 4, 3], rotationY: 0 } },
  { label: "wall run 8x0.5", centre: [40, 0], standoff: 8, volume: { kind: "box", id: "wall", position: [40, 0, 0], size: [8, 2.6, 0.5], rotationY: 0 } },
  { label: "bank chest 1.28x0.76", centre: [60, 0], standoff: 8, volume: { kind: "box", id: "chest", position: [60, 0, 0], size: [1.276, 0.715, 0.755], rotationY: 0 } },
  { label: "anvil 1.08x0.40", centre: [80, 0], standoff: 8, volume: { kind: "box", id: "anvil", position: [80, 0, 0], size: [1.082, 0.556, 0.402], rotationY: 0 } },
  { label: "market stall 1.85x0.93", centre: [100, 0], standoff: 8, volume: { kind: "box", id: "stall", position: [100, 0, 0], size: [1.845, 2.627, 0.932], rotationY: 0 } },
  { label: "tree trunk r=0.45", centre: [120, 0], standoff: 8, volume: { kind: "cylinder", id: "trunk", position: [120, 0, 0], radius: 0.45, height: 7.3 } },
  { label: "boulder r=2.2 (capped)", centre: [140, 0], standoff: 8, volume: { kind: "cylinder", id: "boulder", position: [140, 0, 0], radius: 2.2, height: 3.6 } },
  { label: "fence 4x0.2 h=1.1", centre: [160, 0], standoff: 8, volume: { kind: "box", id: "fence", position: [160, 0, 0], size: [4, 1.1, 0.2], rotationY: 0 } },
  { label: "pond collar r=6", centre: [180, 0], standoff: 9, volume: { kind: "cylinder", id: "pond", position: [180, 0, 0], radius: 6, height: 2 } },
  { label: "npc (mover circle)", centre: [200, 0], standoff: 8, volume: null },
  { label: "enemy (mover circle)", centre: [220, 0], standoff: 8, volume: null },
];

const movers: SemanticEntity[] = [
  { id: "npc_carter_bel", archetype: "npc", name: "Carter Bel", tier: 1, regionId: "fallowmarch", position: [200, 0, 0], state: "idle", interactions: [] },
  { id: "rill_skitterlings_1", archetype: "enemy", name: "Skitterling", tier: 1, regionId: "fallowmarch", position: [220, 0, 0], state: "alive", interactions: [] },
];

async function main(): Promise<void> {
  await Navigation.initLibrary();

  const geometry = new THREE.PlaneGeometry(280, 60, 280, 60);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(110, 0, 0);
  const ground = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  ground.updateMatrixWorld(true);

  const volumes = cases.map((c) => c.volume).filter((v): v is SolidVolume => v !== null);

  const before = new Navigation();
  before.build([ground], "solo");
  const after = new Navigation();
  after.build([ground, ...solidObstacleMeshes(volumes)], "solo");
  const db = before.getDiagnostics();
  const da = after.getDiagnostics();
  console.log("navmesh polys: before " + db.polyCount + " (" + db.buildMs + " ms) -> after " + da.polyCount + " (" + da.buildMs + " ms); carve triangles " + (da.sourceTriangles - db.sourceTriangles) + " on top of " + db.sourceTriangles);

  const index = new SpatialIndex();
  for (const m of movers) index.insert(m.id, m.position);
  const entities: MovementEntityPort = {
    get: (id: EntityId) => movers.find((m) => m.id === id),
    index: () => index,
  };
  const events = new EventBus();

  function run(nav: Navigation, solids: Solids | null, useEntities: boolean, c: Case): { end: Vec3; travelled: number; gap: number } {
    const movement = new Movement(nav, events, {
      ...(solids ? { solids } : {}),
      ...(useEntities ? { entities } : {}),
    });
    const state = createInitialState(1337, 0);
    const start: Vec3 = [c.centre[0], 0, c.centre[1] - c.standoff];
    state.player.position = nav.closestPoint(start) ?? start;
    const from: Vec3 = [...state.player.position] as Vec3;
    movement.setDirectInput({ forward: -1, strafe: 0, cameraYaw: 0 });
    for (let i = 1; i <= 60; i += 1) movement.update(state, 100, i * 100);
    const end = state.player.position;
    return {
      end,
      travelled: Math.hypot(end[0] - from[0], end[2] - from[2]),
      gap: Math.hypot(end[0] - c.centre[0], end[2] - c.centre[1]),
    };
  }

  console.log("");
  console.log("target                        BEFORE end z  past centre   AFTER end z  stops at  reach<=2.4");
  for (const c of cases) {
    const b = run(before, null, false, c);
    const a = run(after, new Solids(volumes), true, c);
    const past = b.end[2] - c.centre[1];
    console.log(
      c.label.padEnd(29) +
      b.end[2].toFixed(2).padStart(12) +
      ((past >= 0 ? "+" : "") + past.toFixed(2)).padStart(14) +
      a.end[2].toFixed(2).padStart(13) +
      a.gap.toFixed(2).padStart(10) +
      (a.gap <= INTERACT_RANGE ? "  yes" : "  NO"),
    );
  }

  console.log("");
  console.log("-- diagonal slide, W+A into the cottage south face --");
  const slides: [string, Navigation, Solids | null][] = [["before", before, null], ["after", after, new Solids(volumes)]];
  for (const [name, nav, solids] of slides) {
    const movement = new Movement(nav, events, solids ? { solids } : {});
    const state = createInitialState(1337, 0);
    state.player.position = nav.closestPoint([-6, 0, -8]) ?? [-6, 0, -8];
    const from: Vec3 = [...state.player.position] as Vec3;
    movement.setDirectInput({ forward: -1, strafe: 1, cameraYaw: 0 });
    for (let i = 1; i <= 60; i += 1) movement.update(state, 100, i * 100);
    const end = state.player.position;
    console.log("  " + name + ": end (" + end[0].toFixed(2) + ", " + end[2].toFixed(2) + "), travelled " + Math.hypot(end[0] - from[0], end[2] - from[2]).toFixed(2) + " m");
  }

  console.log("");
  console.log("-- moveTo({entityId}) still reaches: click-to-move at each carved prop centre --");
  for (const c of cases) {
    if (!c.volume) continue;
    const movement = new Movement(after, events, { solids: new Solids(volumes) });
    const state = createInitialState(1337, 0);
    const start: Vec3 = [c.centre[0], 0, c.centre[1] - 12];
    state.player.position = after.closestPoint(start) ?? start;
    const started = movement.startPath(state, [c.centre[0], 0, c.centre[1]], "target" as EntityId, 0);
    if (!started) {
      console.log("  " + c.label.padEnd(29) + " REFUSED");
      continue;
    }
    let ticks = 0;
    while (state.player.movement.mode === "path" && ticks < 300) {
      ticks += 1;
      movement.update(state, 100, ticks * 100);
    }
    const end = state.player.position;
    const gap = Math.hypot(end[0] - c.centre[0], end[2] - c.centre[1]);
    console.log("  " + c.label.padEnd(29) + " walked to " + gap.toFixed(2) + " m from centre -> interact " + (gap <= INTERACT_RANGE ? "OK" : "OUT OF RANGE"));
  }
}
void main();
