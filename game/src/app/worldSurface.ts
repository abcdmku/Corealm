/**
 * Builds the ground features shared by the playable world and the build-time map renderer.
 *
 * This belongs in the app composition layer: roads depend on authored content and the resolved
 * heightfield, while water asks the render scene to solve its exact shoreline.
 */
import type { Vec3 } from "../contracts.js";
import { REGIONS, type PavingAssetId } from "../content/regions.js";
import { resourceDef } from "../content/resources.js";
import {
  WorldScene, pavingStampFromRect,
  type PavingStamp, type PavingSurface, type RoadStamp, type WaterStamp,
} from "../render/scene.js";
import { WATER_FILL_DEPTH, waterBasinForCluster } from "../world/waterBodies.js";

export const DEFAULT_WORLD_SEED = 1337;

export interface PreparedWorldSurface {
  roadCount: number;
  pavingCount: number;
  waterCount: number;
}

/** Applies every terrain stamp and builds every authored water surface in canonical boot order. */
export function prepareWorldSurface(
  scene: WorldScene,
  seed = DEFAULT_WORLD_SEED,
): PreparedWorldSurface {
  const roads = collectRoadStamps(scene);
  const paving = collectPavingStamps();
  const water = collectWaterStamps(scene);
  scene.setGroundStamps({ roads, paving, water, seed });
  const waterCount = buildWaterBodies(scene);
  return { roadCount: roads.length, pavingCount: paving.length, waterCount };
}

/**
 * Resolves authored links through actual gates. The scene's visual curve is also the line consumed
 * by foliage exclusions and the map; semantic navigation keeps the authored link unchanged.
 */
export function collectRoadStamps(scene: WorldScene): RoadStamp[] {
  const stamps: RoadStamp[] = [];
  for (const region of REGIONS) {
    const locationById = new Map(region.locations.map((location) => [location.id, location]));
    for (const road of region.roads) {
      const from = locationById.get(road.from);
      const to = locationById.get(road.to);
      if (!from || !to) continue;

      const waypoints = [from.position];
      const settlement = region.settlement;
      const gates = settlement?.buildings.filter((building) => building.prefab === "gatehouse") ?? [];
      if (settlement && gates.length > 0) {
        const distanceToCentre = (point: readonly [number, number]): number =>
          Math.hypot(point[0] - settlement.centre[0], point[1] - settlement.centre[1]);
        const perimeter = Math.max(...gates.map((gate) => distanceToCentre(gate.position)));
        const fromInside = distanceToCentre(from.position) < perimeter - 1;
        const toInside = distanceToCentre(to.position) < perimeter - 1;
        if (fromInside !== toInside) {
          const gate = gates.reduce((best, candidate) => {
            const routeLength = (entry: typeof candidate): number =>
              Math.hypot(entry.position[0] - from.position[0], entry.position[1] - from.position[1]) +
              Math.hypot(to.position[0] - entry.position[0], to.position[1] - entry.position[1]);
            return routeLength(candidate) < routeLength(best) ? candidate : best;
          });
          // Hold the centreline on the gate's opening axis for a few metres on either side. The
          // curve pass returns to every one of these controls, so its meander cannot graze a pier.
          let outwardX = Math.sin(gate.rotationY);
          let outwardZ = Math.cos(gate.rotationY);
          const gateFromCentreX = gate.position[0] - settlement.centre[0];
          const gateFromCentreZ = gate.position[1] - settlement.centre[1];
          if (outwardX * gateFromCentreX + outwardZ * gateFromCentreZ < 0) {
            outwardX *= -1;
            outwardZ *= -1;
          }
          const travelSign = fromInside ? 1 : -1;
          const travelX = outwardX * travelSign;
          const travelZ = outwardZ * travelSign;
          const approach = Math.min(
            5,
            Math.hypot(gate.position[0] - from.position[0], gate.position[1] - from.position[1]) * 0.35,
            Math.hypot(to.position[0] - gate.position[0], to.position[1] - gate.position[1]) * 0.35,
          );
          if (approach > 0.5) {
            waypoints.push(
              [gate.position[0] - travelX * approach, gate.position[1] - travelZ * approach],
              gate.position,
              [gate.position[0] + travelX * approach, gate.position[1] + travelZ * approach],
            );
          } else {
            waypoints.push(gate.position);
          }
        }
      }
      waypoints.push(to.position);

      // Do not fill the link with straight six-metre samples here. Each sample becomes a hard
      // control in `curveRoadPolyline`, which used to suppress the meander entirely.
      const points: Vec3[] = waypoints.map(([x, z]) => [x, scene.heightAt(region.id, x, z), z]);
      stamps.push({ points, width: 3.2 });
    }
  }
  return stamps;
}

/**
 * What each paving asset means as a stamped surface.
 *
 * The authored vocabulary is still an asset id, because that is also what `audio/surface.ts` reads
 * for footsteps and what a settlement author is choosing between. The ground draws the courses
 * itself now, so the id only has to say which of the three figures it is.
 */
const PAVING_SURFACES: Record<PavingAssetId, PavingSurface> = {
  floor_cobble: "stone",
  floor_brick: "brick",
  floor_wood: "plank",
  floor_wood_light: "plank",
};

export function collectPavingStamps(): PavingStamp[] {
  const stamps: PavingStamp[] = [];
  for (const region of REGIONS) {
    for (const paving of region.settlement?.paving ?? []) {
      stamps.push(pavingStampFromRect(paving.rect, {
        surface: PAVING_SURFACES[paving.assetId],
        kerb: paving.kerb,
      }));
    }
  }
  return stamps;
}

export function collectWaterStamps(scene: WorldScene): WaterStamp[] {
  const stamps: WaterStamp[] = [];
  for (const region of REGIONS) {
    for (const cluster of region.clusters) {
      if (resourceDef(cluster.resourceId).archetype !== "fishing_spot") continue;
      const [x, z] = cluster.centre;
      const basin = waterBasinForCluster(cluster);
      stamps.push({
        centre: [x, z],
        radius: basin.crestRadius,
        level: scene.heightAt(region.id, x, z) + WATER_FILL_DEPTH,
        shape: basin.shape,
      });
    }
  }
  return stamps;
}

export function buildWaterBodies(scene: WorldScene): number {
  let built = 0;
  for (const region of REGIONS) {
    for (const cluster of region.clusters) {
      if (resourceDef(cluster.resourceId).archetype !== "fishing_spot") continue;
      const [x, z] = cluster.centre;
      const half = waterBasinForCluster(cluster).crestRadius;
      const floor = scene.heightAt(region.id, x, z);
      scene.buildWater(
        { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half },
        floor + WATER_FILL_DEPTH,
        region.id,
      );
      built += 1;
    }
  }
  return built;
}
