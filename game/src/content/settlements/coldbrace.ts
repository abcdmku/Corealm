/**
 * Coldbrace — the tier 1 settlement, in Fallowmarch, centred on (-160,-80).
 *
 * Split out of `content/regions.ts` so the three settlements can be authored independently; the
 * file's only export is the data, and `regions.ts` imports it straight back into `FALLOWMARCH`.
 * The types, the validation and the coordinate contract all still live in `regions.ts` — this file
 * is data and the reasons behind it, nothing else.
 *
 * The route nodes this settlement is measured against (`coldbrace` at the square, `bank_interior`,
 * `town_entrance`, `coldbrace_east_gate`) are authored in `regions.ts` and are not repeated here.
 * Moving anything in this file that a route node names moves a number in the DISTANCE LEDGER at
 * the top of `regions.ts`, so check that ledger before moving the bank.
 */
import type { SettlementDef } from "../regions.js";

export const COLDBRACE: SettlementDef = {
  id: "coldbrace",
  name: "Coldbrace",
  // Lime-washed plaster, fired pantiles, a steep pitch. A river-plain farming village.
  kit: "plaster",
  centre: [-160, -80],
  respawnPointId: "coldbrace",
  buildings: [
    { id: "coldbrace_hall", name: "March Company Hall", prefab: "hall", position: [-160, -60], rotationY: Math.PI, footprint: [12, 6] },
    { id: "coldbrace_vault", name: "The Vault Tower", prefab: "tower", position: [-168, -90], rotationY: 0, footprint: [6, 6] },
    { id: "coldbrace_house_1", name: "Carter's House", prefab: "cottage", position: [-182, -104], rotationY: 0, footprint: [6, 4] },
    { id: "coldbrace_house_2", name: "Pitmaster's House", prefab: "cottage", position: [-172, -104], rotationY: 0, footprint: [6, 4] },
    { id: "coldbrace_house_3", name: "Weaver's House", prefab: "cottage", position: [-146, -104], rotationY: 0, footprint: [6, 4] },
    { id: "coldbrace_house_4", name: "Drover's House", prefab: "cottage", position: [-136, -104], rotationY: 0, footprint: [6, 4] },
    { id: "coldbrace_house_5", name: "Warden's House", prefab: "cottage", position: [-182, -64], rotationY: Math.PI, footprint: [6, 4] },
    { id: "coldbrace_house_6", name: "Rope House", prefab: "cottage", position: [-176, -68], rotationY: Math.PI, footprint: [6, 4] },
    { id: "coldbrace_house_7", name: "Old Surveyor's House", prefab: "cottage", position: [-144, -68], rotationY: Math.PI, footprint: [6, 4] },
    { id: "coldbrace_house_8", name: "Empty House", prefab: "cottage", position: [-136, -64], rotationY: Math.PI, footprint: [6, 4] },
    { id: "coldbrace_forge_shed", name: "Forge Shed", prefab: "shed", position: [-152, -98], rotationY: 0, footprint: [4, 4] },
    { id: "coldbrace_gate_south", name: "South Gatehouse", prefab: "gatehouse", position: [-160, -108], rotationY: 0, footprint: [6, 3] },
    { id: "coldbrace_gate_east", name: "East Gatehouse", prefab: "gatehouse", position: [-134, -80], rotationY: Math.PI / 2, footprint: [6, 3] },
    { id: "coldbrace_wall_w", name: "West Wall", prefab: "wall_segment", position: [-186, -84], rotationY: Math.PI / 2, footprint: [8, 1] },
    { id: "coldbrace_wall_n", name: "North Wall", prefab: "wall_segment", position: [-160, -54], rotationY: 0, footprint: [8, 1] },
    { id: "coldbrace_wall_e", name: "East Wall", prefab: "wall_segment", position: [-134, -96], rotationY: Math.PI / 2, footprint: [8, 1] },
    { id: "coldbrace_wall_s", name: "South Wall", prefab: "wall_segment", position: [-176, -108], rotationY: 0, footprint: [8, 1] },
  ],
  stations: [
    // No furnace or forge mesh exists (asset-report gap 11); a cauldron plus the anvil and a
    // torch reads as a forge at gameplay distance.
    { id: "coldbrace_furnace", name: "Coldbrace Furnace", kind: "furnace", skill: "smithing", position: [-150, -94], rotationY: 0, assetId: "cauldron", recipeIds: [] },
    { id: "coldbrace_anvil", name: "Coldbrace Anvil", kind: "anvil", skill: "smithing", position: [-154, -94], rotationY: 0, assetId: "anvil", recipeIds: [] },
    { id: "coldbrace_range", name: "Coldbrace Cooking Range", kind: "range", skill: "cooking", position: [-166, -94], rotationY: 0, assetId: "cooking_pot", scale: 1.6, recipeIds: [] },
    { id: "coldbrace_crafting", name: "Coldbrace Crafting Table", kind: "crafting_table", skill: "crafting", position: [-172, -92], rotationY: 0, assetId: "workbench", recipeIds: [] },
    { id: "coldbrace_fletching", name: "Coldbrace Fletching Bench", kind: "fletching_bench", skill: "fletching", position: [-177, -92], rotationY: 0, assetId: "workbench_drawers", scale: 1.6, recipeIds: [] },
  ],
  bank: { id: "coldbrace_bank", name: "Coldbrace Bank", position: [-160, -88], rotationY: 0, assetId: "chest_wood" },
  shops: [
    { id: "coldbrace_general", name: "Coldbrace General Supplies", shopKind: "general", position: [-176, -80], rotationY: Math.PI / 2, assetId: "market_stall" },
    { id: "coldbrace_smith", name: "Harrow's Metal", shopKind: "smith", position: [-144, -80], rotationY: -Math.PI / 2, assetId: "market_stall_cart" },
  ],
  npcs: [
    { id: "npc_warden_ilse", name: "Warden Ilse", position: [-160, -74], facingRad: Math.PI, assetId: "base_female", dialogueRootId: "ilse_root", questIds: [] },
    { id: "npc_pitmaster_dorn", name: "Pitmaster Dorn", position: [-166, -86], facingRad: Math.PI / 2, assetId: "base_male", dialogueRootId: "dorn_root", questIds: [] },
    { id: "npc_smith_harrow", name: "Harrow the Smith", position: [-146, -84], facingRad: -Math.PI / 2, assetId: "base_male", dialogueRootId: "harrow_root", questIds: [] },
    { id: "npc_ranger_syb", name: "Ranger Syb", position: [-178, -74], facingRad: 0, assetId: "base_female", dialogueRootId: "syb_root", questIds: [] },
    { id: "npc_carter_bel", name: "Carter Bel", position: [-158, -102], facingRad: 0, assetId: "base_male", dialogueRootId: "bel_root", questIds: [] },
  ],
};
