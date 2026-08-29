/**
 * Derives the terrain spec from canonical content.
 *
 * Round 1 shipped two descriptions of where the regions are: the authored one in
 * `content/regions.ts` and a hand-written one in `render/scene.ts`. They disagreed, which would
 * have put every entity on the wrong terrain. `content/regions.ts` wins, because the route-flip
 * arithmetic that makes Agility matter is measured against those exact coordinates.
 *
 * So the terrain spec is *derived*, not authored twice. There is one source of truth for where the
 * world is, and the renderer consumes it.
 *
 * FROZEN. Only the root edits this file.
 */
import type { RegionId } from "../contracts.js";
import { REGIONS, type RegionDef, type SettlementDef } from "../content/regions.js";
import type { FlatSpot, RegionTerrainSpec, WorldTerrainSpec, Rect } from "../render/scene.js";
import { WATER_BASIN_DEPTH, waterBasinForCluster } from "../world/waterBodies.js";

// Kept here as a re-export because boot and its existing callers already own this import path.
export { WATER_BASIN_DEPTH };

function rectOf(region: RegionDef): Rect {
  return {
    minX: region.bounds.min[0],
    maxX: region.bounds.max[0],
    minZ: region.bounds.min[1],
    maxZ: region.bounds.max[1],
  };
}

function characterOf(regionId: RegionId): RegionTerrainSpec["character"] {
  switch (regionId) {
    case "vellenwood": return "woodland";
    case "karrowmoor": return "highlands";
    case "gravelmaw": return "cavern";
    default: return "plains";
  }
}

/**
 * Metres of flat ground beyond the outermost thing a settlement places.
 *
 * Roofs overhang their footprint by up to 1.5 m in this kit, and the player has to be able to
 * stand at a door without the ground already sloping away, so this is deliberately generous. Cost
 * is a wider blend on the terrain, which is invisible; the alternative is a house with one corner
 * in the air, which is not.
 */
const SETTLEMENT_PAD_MARGIN = 8;

/**
 * Settlements, banks, and stations need buildable ground. Noise does not provide it, so every
 * settlement centre and every named location gets a flattened pad.
 *
 * Fishing clusters do not use this list. `buildWorldTerrainSpec` gives them dedicated basins after
 * it derives ordinary flats, because water needs both a depressed floor and a closed raised bank.
 * A flat pad can provide the floor but has no way to guarantee the bank.
 */
function flatSpotsFor(region: RegionDef): FlatSpot[] {
  const flats: FlatSpot[] = [];

  const settlement = region.settlement;
  if (settlement) {
    // The pad is sized from what actually stands on it, not from a round number.
    //
    // A fixed 34 m radius left the outer ring of Coldbrace and Highcairn straddling the blend:
    // every part of one building shares the origin's ground height (a building has to be level),
    // so a house whose far corner sat 40 cm up the falloff had that corner buried and the opposite
    // one hanging in the air. That is the "wall panels float at an angle, roof sections rest on
    // grass" finding — the assembly was right and the ground under it was not.
    // A rectangular pad when the settlement asks for one, a circle otherwise.
    //
    // A circle cannot hold a terrace. Highcairn is authored around an 18 m riser and its circular
    // pad erased the whole thing — measured, its north and south walls shared y = 26.810, so the
    // one piece of designed verticality in Karrowmoor became a disc of uniform grey. A rectangle
    // whose long axis runs ALONG the terrace flattens the building ground and leaves the riser
    // above and below it alone. `padShape` is authored per settlement; `settlementRadius` still
    // sizes the falloff sweep, because the falloff has to clear whatever the pad's corners reach.
    const padShape = settlement.padShape;
    flats.push(padShape
      ? {
          x: settlement.centre[0],
          z: settlement.centre[1],
          radius: Math.hypot(padShape.halfX, padShape.halfZ),
          blend: 26,
          halfExtents: [padShape.halfX, padShape.halfZ] as const,
          rotationY: padShape.rotationY,
        }
      : {
          x: settlement.centre[0],
          z: settlement.centre[1],
          radius: settlementRadius(settlement),
          blend: 26,
        });
  }

  // Named locations are where the player stands still: banks, seams, camps, gates. A 7 m pad keeps
  // an interaction from happening on a slope steep enough to look broken. Water owns a separate
  // basin applied after every ordinary pad, so a generic location pad must not pull its floor back
  // toward the dry terrain.
  for (const location of region.locations) {
    if (location.kind === "water") continue;
    flats.push({ x: location.position[0], z: location.position[1], radius: 7, blend: 9 });
  }

  return flats;
}

/**
 * How far the flat ground has to reach: the furthest corner of anything the settlement places,
 * plus a margin for the eaves and the doorstep.
 *
 * A building's footprint is its wall grid; the roof overhangs it and the player has to be able to
 * stand at the door, so the margin is generous rather than tight. Walls and gatehouses count too —
 * a wall segment leaning out of a hillside reads exactly as broken as a house does.
 */
function settlementRadius(settlement: SettlementDef): number {
  let furthest = 0;
  const reach = (x: number, z: number): void => {
    furthest = Math.max(furthest, Math.hypot(x - settlement.centre[0], z - settlement.centre[1]));
  };

  for (const building of settlement.buildings) {
    // The footprint is authored in the building's own frame, so its half-diagonal covers any yaw.
    const half = Math.hypot(building.footprint[0], building.footprint[1]) / 2;
    reach(building.position[0] + half, building.position[1] + half);
    reach(building.position[0] - half, building.position[1] - half);
    reach(building.position[0] + half, building.position[1] - half);
    reach(building.position[0] - half, building.position[1] + half);
  }
  for (const station of settlement.stations) reach(station.position[0], station.position[1]);
  for (const shop of settlement.shops) reach(shop.position[0], shop.position[1]);
  for (const npc of settlement.npcs) reach(npc.position[0], npc.position[1]);
  reach(settlement.bank.position[0], settlement.bank.position[1]);

  // SETTLEMENT_PAD_MARGIN covers the roof overhang and a walkable step off the doorstep; the floor
  // keeps a small settlement from getting a pad tighter than its own square.
  return Math.max(24, Math.ceil(furthest + SETTLEMENT_PAD_MARGIN));
}

export function buildWorldTerrainSpec(): WorldTerrainSpec {
  const regions: RegionTerrainSpec[] = REGIONS.map((region) => {
    const spec: RegionTerrainSpec = {
      regionId: region.id,
      rect: rectOf(region),
      seed: region.terrainSeed,
      character: characterOf(region.id),
      baseHeight: region.baseHeight,
      amplitude: region.terrainAmplitude,
    };
    // Karrowmoor's terraces are authored as z-bands climbing toward -z.
    if (region.terraces && region.terraces.length > 0) {
      spec.terraceAxis = "-z";
      spec.terraceSteps = region.terraces.length;
    }
    return spec;
  });

  const flats = REGIONS.flatMap((region) => flatSpotsFor(region));
  const basins = REGIONS.flatMap((region) => region.clusters
    .filter((cluster) => cluster.archetype === "fishing_spot")
    .map(waterBasinForCluster));

  const minX = Math.min(...regions.map((region) => region.rect.minX));
  const maxX = Math.max(...regions.map((region) => region.rect.maxX));
  const minZ = Math.min(...regions.map((region) => region.rect.minZ));
  const maxZ = Math.max(...regions.map((region) => region.rect.maxZ));

  return {
    bounds: { minX, maxX, minZ, maxZ },
    chunkSize: 100,
    metresPerQuad: 2,
    // Narrower than the renderer's 45 m default: the regions meet at a T-junction here, and a wide
    // band would smear Karrowmoor's terrace risers into Vellenwood's mounds at the corner.
    blendMetres: 28,
    regions,
    flats,
    basins,
  };
}

/** The spawn point, taken from the starting region's authored value. */
export function startingSpawn(): { regionId: RegionId; x: number; z: number } {
  const region = REGIONS.find((candidate) => candidate.id === "fallowmarch") ?? REGIONS[0]!;
  return { regionId: region.id, x: region.spawnPoint[0], z: region.spawnPoint[1] };
}
