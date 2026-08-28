/**
 * Highcairn — the tier 10 settlement, in Karrowmoor, centred on (144,-66).
 *
 * Split out of `content/regions.ts` so the three settlements can be authored independently; the
 * file's only export is the data, and `regions.ts` imports it straight back into `KARROWMOOR`.
 * The types, the validation and the coordinate contract all still live in `regions.ts`.
 *
 * The bank at (150,-70) is load-bearing: it is one end of both legs of the route-optimisation flip
 * (187.9 m by road against 45.9 m over Sunder Ledge). See the DISTANCE LEDGER at the top of
 * `regions.ts` before moving it.
 *
 * Highcairn also sits on Karrowmoor's terrace steps. The terrace 2 / terrace 3 boundary is at
 * z = -76 with an authored 18 m riser (see `KARROWMOOR.terraces`), and the settlement's flat pad
 * currently spans it: `getDrawnBounds` measures `highcairn_wall_n#w0` and `highcairn_wall_s#w0`
 * both based at y = 26.810 while standing 30 m apart in z, i.e. the pad has erased the riser the
 * whole region is designed around. `SettlementDef.padShape` exists to fix that by making the pad a
 * rectangle inside one terrace instead of a disc across two.
 */
import type { SettlementDef } from "../regions.js";

export const HIGHCAIRN: SettlementDef = {
  id: "highcairn",
  name: "Highcairn",
  // Brick and cut stone to the eaves, brick piers, gable ends closed in stone, and the shallower
  // six-wide roof. A town built out of the quarry it works.
  kit: "stone",
  centre: [144, -66],
  respawnPointId: "highcairn",
  buildings: [
    { id: "highcairn_hut_1", name: "Crew Hut", prefab: "quarry_hut", position: [132, -58], rotationY: 0, footprint: [5, 4] },
    // Moved 4 m west and 2 m south of its round-1 spot: with the hut actually assembled, its 5x4
    // footprint enclosed the Highcairn furnace at (136,-72).
    { id: "highcairn_hut_2", name: "Foreman's Hut", prefab: "quarry_hut", position: [130, -74], rotationY: 0, footprint: [5, 4] },
    { id: "highcairn_hut_3", name: "Store Hut", prefab: "quarry_hut", position: [146, -56], rotationY: Math.PI, footprint: [5, 4] },
    { id: "highcairn_hut_4", name: "Watch Hut", prefab: "quarry_hut", position: [156, -68], rotationY: Math.PI / 2, footprint: [5, 4] },
    { id: "highcairn_hut_5", name: "Tool Hut", prefab: "quarry_hut", position: [142, -78], rotationY: 0, footprint: [5, 4] },
    { id: "highcairn_hut_6", name: "Long Hut", prefab: "quarry_hut", position: [126, -66], rotationY: -Math.PI / 2, footprint: [5, 4] },
    { id: "highcairn_gate", name: "Highcairn Gate", prefab: "gatehouse", position: [160, -58], rotationY: Math.PI / 2, footprint: [6, 3] },
    { id: "highcairn_wall_n", name: "North Wall", prefab: "wall_segment", position: [144, -52], rotationY: 0, footprint: [8, 1] },
    { id: "highcairn_wall_s", name: "South Wall", prefab: "wall_segment", position: [144, -82], rotationY: 0, footprint: [8, 1] },
    { id: "highcairn_wall_w", name: "West Wall", prefab: "wall_segment", position: [122, -68], rotationY: Math.PI / 2, footprint: [8, 1] },
  ],
  stations: [
    { id: "highcairn_furnace", name: "Highcairn Furnace", kind: "furnace", skill: "smithing", position: [136, -72], rotationY: 0, assetId: "cauldron", recipeIds: [] },
    { id: "highcairn_anvil", name: "Highcairn Anvil", kind: "anvil", skill: "smithing", position: [140, -72], rotationY: 0, assetId: "anvil", recipeIds: [] },
    { id: "highcairn_range", name: "Highcairn Cooking Range", kind: "range", skill: "cooking", position: [148, -76], rotationY: 0, assetId: "cooking_pot", scale: 1.6, recipeIds: [] },
  ],
  bank: { id: "highcairn_bank_counter", name: "Highcairn Bank", position: [150, -70], rotationY: Math.PI, assetId: "chest_wood" },
  shops: [
    { id: "highcairn_general", name: "Highcairn Camp Store", shopKind: "general", position: [138, -62], rotationY: Math.PI / 2, assetId: "market_stall" },
    { id: "highcairn_smith", name: "Quarry Smith", shopKind: "smith", position: [152, -60], rotationY: -Math.PI / 2, assetId: "market_stall_cart" },
  ],
  npcs: [
    { id: "npc_foreman_arden", name: "Foreman Arden", position: [144, -60], facingRad: Math.PI, assetId: "base_male", dialogueRootId: "arden_root", questIds: [] },
    { id: "npc_quarrier_vess", name: "Quarrier Vess", position: [148, -66], facingRad: -Math.PI / 2, assetId: "base_female", dialogueRootId: "vess_root", questIds: [] },
    { id: "npc_cairnkeeper_ode", name: "Cairnkeeper Ode", position: [138, -68], facingRad: Math.PI / 2, assetId: "base_female", dialogueRootId: "ode_root", questIds: [] },
    { id: "npc_watcher_hale", name: "Watcher Hale", position: [152, -74], facingRad: 0, assetId: "base_male", dialogueRootId: "hale_root", questIds: [] },
  ],
};
