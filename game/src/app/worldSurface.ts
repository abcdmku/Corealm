/**
 * Builds the ground features shared by the playable world and the build-time map renderer.
 *
 * This belongs in the app composition layer: roads depend on authored content and the resolved
 * heightfield, while water asks the render scene to solve its exact shoreline.
 */
import type { Vec3 } from "../contracts.js";
import { REGIONS } from "../content/regions.js";
import {
  WorldScene, pavingStampFromRect,
  type PavingStamp, type RoadStamp, type WaterStamp,
} from "../render/scene.js";
import { WATER_FILL_DEPTH } from "../world/waterBodies.js";

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

/** Resolves authored links through actual gates and samples their controls on the terrain. */
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
          waypoints.push(gate.position);
        }
      }
      waypoints.push(to.position);

      const points: Vec3[] = [];
      for (let segment = 0; segment < waypoints.length - 1; segment += 1) {
        const a = waypoints[segment]!;
        const b = waypoints[segment + 1]!;
        const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6));
        for (let step = 0; step < steps; step += 1) {
          const t = step / steps;
          const x = a[0] + (b[0] - a[0]) * t;
          const z = a[1] + (b[1] - a[1]) * t;
          points.push([x, scene.heightAt(region.id, x, z), z]);
        }
      }
      const final = waypoints[waypoints.length - 1]!;
      points.push([final[0], scene.heightAt(region.id, final[0], final[1]), final[1]]);
      stamps.push({ points, width: 3.2 });
    }
  }
  return stamps;
}

export function collectPavingStamps(): PavingStamp[] {
  const stamps: PavingStamp[] = [];
  for (const region of REGIONS) {
    for (const paving of region.settlement?.paving ?? []) {
      stamps.push(pavingStampFromRect(paving.rect));
    }
  }
  return stamps;
}

export function collectWaterStamps(scene: WorldScene): WaterStamp[] {
  const stamps: WaterStamp[] = [];
  for (const region of REGIONS) {
    for (const cluster of region.clusters) {
      if (cluster.archetype !== "fishing_spot") continue;
      const [x, z] = cluster.centre;
      stamps.push({
        centre: [x, z],
        radius: cluster.radius + 14,
        level: scene.heightAt(region.id, x, z) + WATER_FILL_DEPTH,
      });
    }
  }
  return stamps;
}

export function buildWaterBodies(scene: WorldScene): number {
  let built = 0;
  for (const region of REGIONS) {
    for (const cluster of region.clusters) {
      if (cluster.archetype !== "fishing_spot") continue;
      const [x, z] = cluster.centre;
      const half = cluster.radius + 14;
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
