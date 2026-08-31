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
import { resourceDef } from "../content/resources.js";
import type { FlatSpot, RegionTerrainSpec, WorldTerrainSpec, Rect } from "../render/scene.js";
import { seedFromText, type OrganicBiomeSpec } from "../world/organicFields.js";
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

/**
 * Visual biomes follow climate and authored places, never the semantic region rectangles. Round
 * intents protect important hubs. Corridors loosely connect related places. The two broad climate
 * channels decide the unclaimed land, so borders can fork, double back, and reach the coast.
 */
const COREALM_BIOMES: OrganicBiomeSpec<RegionId> = {
  warp: {
    seed: seedFromText("corealm:biome-warp"),
    scale: 180,
    strength: 52,
  },
  climate: {
    seed: seedFromText("corealm:biome-climate"),
    scales: [310, 112],
    strength: 0.72,
  },
  edgeScale: 76,
  edgeStrength: 0.5,
  temperature: 0.5,
  fields: [
    {
      id: "fallowmarch",
      seed: seedFromText("corealm:biome:fallowmarch"),
      climateTarget: [-0.12, -0.4],
      climateTolerance: [0.68, 0.62],
      bias: 0.07,
      anchors: [
        { id: "coldbrace", centre: [-160, -80], radius: 48, strength: 1.65 },
        { id: "bracken-pit", centre: [-160, 80], radius: 38, strength: 1.25 },
        { id: "palewood-copse", centre: [-334, -64], radius: 34, strength: 1.4 },
        { id: "marchfield", centre: [-96, -22], radius: 36, strength: 1.3 },
        { id: "redsill-shallows", centre: [-40, -60], radius: 34, strength: 1.15 },
        { id: "open-march", centre: [-250, 30], radius: 44, strength: 1.1 },
        { id: "corven-ford", centre: [-72, -146], radius: 32, strength: 1.05 },
        { id: "south-march", centre: [-250, -150], radius: 40, strength: 1.0 },
        { id: "west-bluff", centre: [-395, -20], radius: 26, strength: 1.0 },
        { id: "west-headland", centre: [-430, 35], radius: 26, strength: 1.0 },
        { id: "western-rise", centre: [-345, 45], radius: 34, strength: 1.0 },
        { id: "corven-lowland", centre: [-130, -165], radius: 34, strength: 1.0 },
      ],
      corridors: [
        { from: [-160, -80], to: [-250, 30], halfWidth: 30, strength: 0.64 },
        { from: [-250, 30], to: [-160, 80], halfWidth: 28, strength: 0.58 },
        { from: [-160, -80], to: [-96, -22], halfWidth: 24, strength: 0.56 },
        { from: [-395, -20], to: [-430, 35], halfWidth: 16, strength: 0.5 },
        { from: [-250, -150], to: [-330, -230], halfWidth: 20, strength: 0.55 },
      ],
    },
    {
      id: "vellenwood",
      seed: seedFromText("corealm:biome:vellenwood"),
      climateTarget: [0.36, -0.2],
      climateTolerance: [0.64, 0.64],
      bias: 0.03,
      anchors: [
        { id: "marchgate-fold", centre: [-26, 118], radius: 30, strength: 1.45 },
        { id: "rootfall", centre: [60, 120], radius: 46, strength: 1.6 },
        { id: "duskoak-stand", centre: [14, 166], radius: 36, strength: 1.4 },
        { id: "blackwater-pools", centre: [128, 84], radius: 40, strength: 1.45 },
        { id: "gorge-ford", centre: [230, 44], radius: 34, strength: 1.35 },
        { id: "thornline", centre: [196, 152], radius: 40, strength: 1.3 },
        { id: "earth-essence-cache", centre: [262, 176], radius: 34, strength: 1.2 },
        { id: "cairn-gate", centre: [250, 24], radius: 28, holdRadius: 5, strength: 1.45 },
        { id: "gorge-head", centre: [104, 192], radius: 32, strength: 1.2 },
        { id: "rainfold", centre: [-45, 245], radius: 26, strength: 1.05 },
        { id: "north-hollow", centre: [20, 270], radius: 24, strength: 1.0 },
      ],
      corridors: [
        { from: [-26, 118], to: [60, 120], halfWidth: 25, strength: 0.68 },
        { from: [60, 120], to: [128, 84], halfWidth: 28, strength: 0.64 },
        { from: [128, 84], to: [230, 44], halfWidth: 25, strength: 0.56 },
        { from: [230, 44], to: [196, 152], halfWidth: 24, strength: 0.52 },
        { from: [196, 152], to: [262, 176], halfWidth: 20, strength: 0.5 },
        { from: [-45, 245], to: [20, 270], halfWidth: 16, strength: 0.5 },
      ],
    },
    {
      id: "karrowmoor",
      seed: seedFromText("corealm:biome:karrowmoor"),
      climateTarget: [-0.5, 0.08],
      climateTolerance: [0.58, 0.7],
      bias: 0.1,
      anchors: [
        { id: "moorgate", centre: [256, 4], radius: 28, holdRadius: 5, strength: 1.55 },
        { id: "lower-quarry", centre: [60, -16], radius: 40, strength: 1.4 },
        { id: "highcairn", centre: [144, -66], radius: 46, strength: 1.65 },
        { id: "upper-seam", centre: [194, -132], radius: 40, strength: 1.35 },
        { id: "great-cairn", centre: [140, -176], radius: 32, strength: 1.2 },
        { id: "cairn-tarns", centre: [206, -88], radius: 34, strength: 1.25 },
        { id: "ridge-pines", centre: [250, -96], radius: 36, strength: 1.25 },
        { id: "far-tarn", centre: [284, -110], radius: 34, strength: 1.2 },
        { id: "south-ridge", centre: [170, -214], radius: 38, strength: 1.0 },
        { id: "far-uplift", centre: [310, -180], radius: 40, strength: 1.0 },
        { id: "southwest-foot", centre: [0, -245], radius: 26, strength: 1.0 },
        { id: "south-spur", centre: [45, -290], radius: 26, strength: 1.0 },
      ],
      corridors: [
        { from: [60, -16], to: [144, -66], halfWidth: 28, strength: 0.64 },
        { from: [144, -66], to: [194, -132], halfWidth: 30, strength: 0.66 },
        { from: [194, -132], to: [140, -176], halfWidth: 24, strength: 0.52 },
        { from: [206, -88], to: [284, -110], halfWidth: 26, strength: 0.58 },
        { from: [0, -245], to: [45, -290], halfWidth: 16, strength: 0.5 },
      ],
    },
  ],
};

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
    .filter((cluster) => resourceDef(cluster.resourceId).archetype === "fishing_spot")
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
    biomes: COREALM_BIOMES,
    // The gameplay bounds above stay put. This only describes the rendered land edge and ocean.
    coast: {
      seed: seedFromText("corealm:coast"),
      collar: 210,
      shoreline: [18, 190] as const,
      seaLevel: -5.25,
      floorDepth: 3,
      // Match the terrain lattice at the inner seam so the render-only collar cannot form cracks.
      gridStep: 2,
      oceanSize: 2400,
    },
  };
}

/** The spawn point, taken from the starting region's authored value. */
export function startingSpawn(): { regionId: RegionId; x: number; z: number } {
  const region = REGIONS.find((candidate) => candidate.id === "fallowmarch") ?? REGIONS[0]!;
  return { regionId: region.id, x: region.spawnPoint[0], z: region.spawnPoint[1] };
}
