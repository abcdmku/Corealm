/**
 * How big may a SolidVolume be before its own entity becomes unreachable?
 *
 * Run at the LARGE-WORLD cell size the real game uses (cs 0.45, chosen in navigation.ts because
 * the world extent is 700 m) with NAV_CONFIG.walkableRadius 1. For each carve radius, walks
 * click-to-move at the volume centre and reports how close the walk actually gets.
 * INTERACT_RANGE is 2.4 m; anything above that line breaks moveTo({entityId}).
 */
import * as THREE from "three";
import { Navigation, solidObstacleMeshes } from "../../../game/src/systems/navigation.js";
import { Solids } from "../../../game/src/systems/solids.js";
import { Movement } from "../../../game/src/systems/movement.js";
import { EventBus } from "../../../game/src/core/events.js";
import { createInitialState } from "../../../game/src/state/store.js";
import { INTERACT_RANGE } from "../../../game/src/app/config.js";
import type { EntityId, SolidVolume, Vec3 } from "../../../game/src/contracts.js";

async function main(): Promise<void> {
  await Navigation.initLibrary();
  const events = new EventBus();

  for (const cs of [0.3, 0.45]) {
    console.log("");
    console.log("cell size " + cs + " (the real world uses 0.45)");
    console.log("  carve r   nearest walkable   reach<=2.4");
    for (const radius of [0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4]) {
      const geometry = new THREE.PlaneGeometry(60, 60, 120, 120);
      geometry.rotateX(-Math.PI / 2);
      const ground = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      ground.updateMatrixWorld(true);
      const volume: SolidVolume = { kind: "cylinder", id: "v", position: [0, 0, 0], radius, height: 3 };
      const nav = new Navigation();
      nav.build([ground, ...solidObstacleMeshes([volume])], "solo", { cs });

      const movement = new Movement(nav, events, { solids: new Solids([volume]) });
      const state = createInitialState(1337, 0);
      const start: Vec3 = [0, 0, -12];
      state.player.position = nav.closestPoint(start) ?? start;
      const started = movement.startPath(state, [0, 0, 0], "target" as EntityId, 0);
      let gap = Number.NaN;
      if (started) {
        let ticks = 0;
        while (state.player.movement.mode === "path" && ticks < 300) {
          ticks += 1;
          movement.update(state, 100, ticks * 100);
        }
        gap = Math.hypot(state.player.position[0], state.player.position[2]);
      }
      console.log(
        "  " + radius.toFixed(2).padStart(6) +
        (Number.isNaN(gap) ? "   REFUSED        " : ("   " + gap.toFixed(2).padStart(6) + " m         ")) +
        (gap <= INTERACT_RANGE ? "yes" : "NO"),
      );
    }
  }
}
void main();
