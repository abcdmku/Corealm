/**
 * Rootfall — the tier 5 settlement, in Vellenwood, centred on (60,120).
 *
 * Split out of `content/regions.ts` so the three settlements can be authored independently; the
 * file's only export is the data, and `regions.ts` imports it straight back into `VELLENWOOD`.
 * The types, the validation and the coordinate contract all still live in `regions.ts`.
 *
 * Two coordinates here are load-bearing and are measured, not chosen. The bank chest at (60,128)
 * is 38.0 m from the Hollowcut Seam, which is the tier-5 half of the route-optimisation flip in
 * the DISTANCE LEDGER at the top of `regions.ts`. The Root Tunnel entrance at (76,134) and the
 * Canopy Walk entrance at (40,138) are Agility obstacles authored in `regions.ts`; a building
 * footprint that swallows either one deletes a shortcut, which is how `rootfall_house_7` ended up
 * 5 m south of where round 1 put it.
 */
import type { SettlementDef } from "../regions.js";

export const ROOTFALL: SettlementDef = {
  id: "rootfall",
  name: "Rootfall",
  // Exposed frame, a felled log along every ridge, dormers in the roof. A logging town.
  kit: "timber",
  centre: [60, 120],
  respawnPointId: "rootfall",
  buildings: [
    { id: "rootfall_house_1", name: "Stumpside House", prefab: "cottage", position: [46, 132], rotationY: -Math.PI / 2, footprint: [6, 4] },
    { id: "rootfall_house_2", name: "Woodward's House", prefab: "cottage", position: [46, 118], rotationY: -Math.PI / 2, footprint: [6, 4] },
    { id: "rootfall_house_3", name: "Trapper's House", prefab: "cottage", position: [48, 108], rotationY: 0, footprint: [6, 4] },
    { id: "rootfall_house_4", name: "Cook House", prefab: "cottage", position: [60, 106], rotationY: 0, footprint: [6, 4] },
    { id: "rootfall_house_5", name: "Root House", prefab: "cottage", position: [72, 108], rotationY: 0, footprint: [6, 4] },
    { id: "rootfall_house_6", name: "Seamer's House", prefab: "cottage", position: [74, 118], rotationY: Math.PI / 2, footprint: [6, 4] },
    // Pulled 5 m south of its round-1 spot: assembled, its 6x4 footprint swallowed the Root
    // Tunnel entrance at (76,134), whose 155 m saving is measured from that exact coordinate.
    { id: "rootfall_house_7", name: "Warden's House", prefab: "cottage", position: [74, 127], rotationY: Math.PI / 2, footprint: [6, 4] },
    { id: "rootfall_house_8", name: "North House", prefab: "cottage", position: [62, 140], rotationY: Math.PI, footprint: [6, 4] },
    { id: "rootfall_shed", name: "Drying Shed", prefab: "shed", position: [50, 140], rotationY: Math.PI, footprint: [4, 4] },
  ],
  stations: [
    { id: "rootfall_range", name: "Rootfall Cooking Range", kind: "range", skill: "cooking", position: [54, 112], rotationY: 0, assetId: "cooking_pot", scale: 1.6, recipeIds: [] },
    { id: "rootfall_anvil", name: "Rootfall Anvil", kind: "anvil", skill: "smithing", position: [68, 112], rotationY: 0, assetId: "anvil", recipeIds: [] },
  ],
  bank: { id: "rootfall_bank_chest", name: "Rootfall Bank Chest", position: [60, 128], rotationY: Math.PI, assetId: "chest_wood" },
  shops: [
    { id: "rootfall_general", name: "Rootfall Trade Post", shopKind: "general", position: [52, 126], rotationY: Math.PI / 2, assetId: "market_stall" },
  ],
  npcs: [
    { id: "npc_woodward_ansel", name: "Woodward Ansel", position: [56, 122], facingRad: Math.PI / 2, assetId: "base_male", dialogueRootId: "ansel_root", questIds: [] },
    { id: "npc_seamer_juno", name: "Seamer Juno", position: [64, 126], facingRad: -Math.PI / 2, assetId: "base_female", dialogueRootId: "juno_root", questIds: [] },
    { id: "npc_trapper_mott", name: "Trapper Mott", position: [66, 116], facingRad: Math.PI, assetId: "base_male", dialogueRootId: "mott_root", questIds: [] },
  ],
};
