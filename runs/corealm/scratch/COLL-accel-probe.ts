/** Acceleration, coast and NPC push-out, each on a FRESH Movement so nothing carries over. */
import * as THREE from "three";
import { Navigation } from "../../../game/src/systems/navigation.js";
import { Solids } from "../../../game/src/systems/solids.js";
import { Movement, type MovementEntityPort } from "../../../game/src/systems/movement.js";
import { EventBus } from "../../../game/src/core/events.js";
import { createInitialState } from "../../../game/src/state/store.js";
import { SpatialIndex } from "../../../game/src/world/spatial.js";
import type { EntityId, SemanticEntity, Vec3 } from "../../../game/src/contracts.js";

async function main(): Promise<void> {
  await Navigation.initLibrary();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80, 80, 80), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.updateMatrixWorld(true);
  const nav = new Navigation();
  nav.build([ground], "solo");
  const events = new EventBus();

  console.log("-- hold/release sweep (fresh Movement each row) --");
  for (const ticks of [1, 2, 3, 5, 10, 20]) {
    const movement = new Movement(nav, events, { solids: new Solids([]) });
    const state = createInitialState(1337, 0);
    state.player.position = nav.closestPoint([0, 0, -20]) ?? [0, 0, -20];
    const from: Vec3 = [...state.player.position] as Vec3;
    movement.setDirectInput({ forward: -1, strafe: 0, cameraYaw: 0 });
    let atMs = 0;
    const steps: number[] = [];
    const speeds: number[] = [];
    let previous: Vec3 = from;
    for (let i = 0; i < ticks; i += 1) {
      atMs += 100;
      movement.update(state, 100, atMs);
      steps.push(+Math.hypot(state.player.position[0] - previous[0], state.player.position[2] - previous[2]).toFixed(4));
      speeds.push(+movement.getSpeedMps().toFixed(3));
      previous = [...state.player.position] as Vec3;
    }
    const held = Math.hypot(state.player.position[0] - from[0], state.player.position[2] - from[2]);
    movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: 0 });
    let coast = 0;
    let coastTicks = 0;
    for (let i = 0; i < 10; i += 1) {
      atMs += 100;
      const before: Vec3 = [...state.player.position] as Vec3;
      movement.update(state, 100, atMs);
      const moved = Math.hypot(state.player.position[0] - before[0], state.player.position[2] - before[2]);
      coast += moved;
      if (moved > 0) coastTicks += 1;
    }
    console.log(
      `hold ${String(ticks * 100).padStart(4)} ms: ${held.toFixed(3)} m held + ${coast.toFixed(3)} m coast over ${coastTicks} ticks | steps [${steps.slice(0, 6).join(", ")}] | speed m/s [${speeds.slice(0, 6).join(", ")}] | gait ${movement.getGait()}`,
    );
  }

  console.log("-- speed and gait published into state.player.movement --");
  {
    const movement = new Movement(nav, events, {});
    const state = createInitialState(1337, 0);
    state.player.position = [0, 0, -20];
    movement.setDirectInput({ forward: -1, strafe: 0, cameraYaw: 0 });
    for (let i = 1; i <= 4; i += 1) {
      movement.update(state, 100, i * 100);
      const written = state.player.movement as unknown as { speed?: number; gait?: string };
      console.log(`  tick ${i}: getSpeedMps ${movement.getSpeedMps().toFixed(3)} | state.player.movement.speed ${written.speed?.toFixed(3)} gait ${written.gait}`);
    }
  }

  console.log("-- NPC push-out --");
  {
    const npc: SemanticEntity = {
      id: "npc_carter_bel", archetype: "npc", name: "Carter Bel", tier: 1,
      regionId: "fallowmarch", position: [0, 0, 0], state: "idle", interactions: [],
    };
    const index = new SpatialIndex();
    index.insert(npc.id, npc.position);
    const entities: MovementEntityPort = {
      get: (id: EntityId) => (id === npc.id ? npc : undefined),
      index: () => index,
    };
    for (const withPort of [false, true]) {
      const movement = new Movement(nav, events, withPort ? { entities } : {});
      const state = createInitialState(1337, 0);
      state.player.position = nav.closestPoint([0, 0, -4]) ?? [0, 0, -4];
      movement.setDirectInput({ forward: -1, strafe: 0, cameraYaw: 0 });
      for (let i = 1; i <= 40; i += 1) movement.update(state, 100, i * 100);
      const end = state.player.position;
      const signed = end[2] - npc.position[2];
      console.log(`  entities port ${withPort ? "ON " : "OFF"}: end (${end[0].toFixed(2)}, ${end[2].toFixed(2)}), signed past NPC centre ${signed >= 0 ? "+" : ""}${signed.toFixed(2)} m`);
    }
  }
}
void main();
