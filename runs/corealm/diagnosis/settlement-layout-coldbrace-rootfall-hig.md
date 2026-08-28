# settlement layout — Coldbrace, Rootfall, Highcairn

## Summary

The three settlements are not laid out; they are scattered. The single loudest defect is that every building's door faces the wrong way: 11 of 11 doored buildings in Coldbrace, 4 of 9 in Rootfall and 3 of 6 in Highcairn present a blank rear wall to their own square, and two of Highcairn's huts open onto a wall panel 2 m away. That leaves a 575 m² / 621 m² / 315 m² void in the middle of each town, which the 46 m scatter-exclusion circle in boot.ts guarantees will contain no grass, no pebbles and no dressing at all — so the bank chest (a 1.28 x 0.72 m box), the anvil (1.08 x 0.40 m) and the cooking pot (0.86 x 0.78 m at scale 1.6) sit alone in it. Second: the walls are decoration. Coldbrace has 44 m of wall on a 212 m circuit (79% open, largest single gap 46 m), Highcairn 30 m on 139 m, Rootfall none at all, and all four corners are open in both. Third, and worse than cosmetic: all three gatehouse arches are physically impassable — prefabCollision leaves a 2 m gap, the navmesh erodes by 0.90 m per side at a 0.45 m cell, and measured nav paths detour 4-5 m around every single gate. The content layer has no vocabulary to fix any of this: SettlementDef has no props array, no wall-run type, no paving, and buildings.ts has no open-fronted or roofed-but-open prefab, so there is literally nowhere to author a barrel or a covered forge. Building footing itself is fine (checkBuildingFooting reports worst = 0 for all 36) and building collision is wired; nothing else in a settlement has a collider at all.

## Evidence

- **runs/corealm/screenshots/SET-bank.png (preset 'bank')** — The Coldbrace bank is a lone 1.28 m wooden chest on bare grass with the player standing inside it (no collider). The anvil and cauldron sit loose 8 m to the left on grass, a market cart 12 m to the right on grass. Zero paving, zero enclosure, zero props between them.
- **runs/corealm/screenshots/SET-town_center.png (preset 'town_center')** — The lower two thirds of the frame is empty grass crossed by two brown alpha road smears. The March Company Hall fills the right edge showing a continuous window band and NO door — confirming the hall's entrance faces north, away from the square.
- **runs/corealm/screenshots/SET-town_entrance.png (preset 'town_entrance')** — The south gatehouse arch stands free with open grass on both sides; one 8 m wall stub is visible to the right abutting a cottage and stopping. Verbatim 'a random gate without a wall'.
- **runs/corealm/screenshots/SET-highcairn.png (preset 'highcairn')** — The 8 m north wall stub stands alone mid-plateau connecting nothing. Ground is a featureless flat grey disc (the 35 m pad) with a visible hard edge against the rolling green terrain behind. Bank chest, cauldron and cooking pot all loose on bare slate. The stone-kit huts read as open pavilions — you see straight through them into hollow shells.
- **runs/corealm/screenshots/SET-rootfall.png (preset 'rootfall')** — The house ring is the best of the three, but the interior is 621 m² of bare grass containing only a black mangled stump, a chest on grass, an anvil on grass and one stall on grass. No wall, no gate, no paving, no light.
- **__gameDebug.getNavPath through all three gate arches (runs/corealm/test-results/play-settlement-audit2.json)** — South gate (-160,-112)->(-160,-100): path detours to x=-164.15, around the west pier. East gate (-128,-80)->(-140,-80): detours to z=-75.8, north of the gatehouse. Highcairn gate (166,-58)->(150,-58): detours to z=-62.3, south of it. All three gate openings are non-walkable.
- **__gameDebug.checkBuildingFooting()** — worst = 0 for all 36 buildings across the three settlements. Refutes 'buildings not grounded' for settlements specifically.
- **__gameDebug.getDrawnBounds on Highcairn wall_n#w0 and wall_s#w0** — Both bases at y = 26.810, 30 m apart in z, spanning the terrace-2/terrace-3 boundary at z=-76 where the authored riser is 18 m. The pad erases the terrain feature the region is built on.
- **__gameDebug.getEntity on highcairn_plot_beds_1..4** — Plot 1 lands at (129.80, -57.93). highcairn_hut_1's collision box is x[129.5,134.5] z[-60,-56]. One of four farm plots spawns inside a building.
- **__gameDebug.getDrawnBounds rootfall_stump / rootfall_stump#step_1 / #step_3** — Stump drawn y 6.43..10.15 (3.72 m tall, 3.72 m wide). step_1 base y = 8.10 (= ground), so the hero mesh is buried 1.67 m and stands only 2.05 m proud; step_3 tops out at y = 11.62, i.e. 1.47 m of staircase above the top of the stump, and step_1 sits at z 122.6..124.5, entirely clear of the stump's z 118.1..121.9.
- **Offline geometry pass over content/regions.ts + prefabCollision + buildPrefab (script at /tmp/cor/plan2.ts)** — Coldbrace 11/11 doors face away from centre (dot -0.61..-1.00); empty plaza 25.0 x 23.0 m = 575 m². Rootfall 4/9 face away; plaza 23.0 x 27.0 = 621 m²; 0 m of wall. Highcairn 3/6 face away; plaza 18.5 x 17.0 = 315 m²; 30 m of wall on 141 m of perimeter.
- **Prop AABB clash pass against the manifest sizes** — coldbrace_range (cooking_pot @1.6) overlaps march_vault_tower#torch_l by 0.22 x 0.59 m and #banner_l by 0.42 m. coldbrace_house_5 and _6 roofs interpenetrate over 1.57 x 1.51 m. highcairn_crane#jib overlaps its own brace_r, drum and rope.
- **__gameDebug.getMetrics + getSceneStats** — drawCalls 276 of a 400 budget, 140 instanced entity groups, entityCount 892. Room for roughly 45-70 new (assetId, tier) groups before the budget bites; a whole paved plaza is one group.
- **Manifest scan of game/public/assets/manifest.json** — overhang_plaster (2 x 3.028 x 2.2) and overhang_brick (2 x 0.266 x 2.022) exist and are used nowhere — these are the covered-porch/arcade modules. floor_cobble/brick/wood are 2.00 x 0.02 x 2.00 (exactly the module grid). table_large, bench, stool, chair, bed, bookcase, cabinet, barrel_rack, barrel_apples, farm_crate_* all exist unused. There is NO well asset — it has to be composed.

## Findings

### 1. [critical/confirmed] All three gatehouse arches are impassable; the navmesh routes around every gate

`game/src/render/buildings.ts:912`

**Root cause.** prefabCollision('gatehouse') hardcodes a 2 m pier gap (`const pier = (width - 2) / 2`). NAV_CONFIG.walkableRadius is 2 voxels and the world is 700 m wide so navigation.ts:245 picks LARGE_WORLD_CELL_SIZE 0.45 — 0.90 m of erosion per side. A 2 m arch erodes to 0.20 m, under one 0.45 m cell, so Recast never keeps it.

**Evidence.** getNavPath(-160,-112 -> -160,-100) returns [-160,-112],[-163.25,-110.45],[-164.15,-110],[-164.15,-106.85],[-163.7,-105.5],[-160,-100] — a 4 m sidestep around the west pier. Same at the Coldbrace east gate (detours to z=-75.8) and the Highcairn gate (detours to z=-62.3). PLAYER_RADIUS is only 0.35 m (app/config.ts:4), so the inset is 2.6x the player.

**Fix.** Two independent changes, do both. (1) buildings.ts: introduce `const GATE_GAP = 4`, use it in gatehouse() for pierX and archScale and in prefabCollision, and author all gatehouses with footprint [8,3]. (2) app/config.ts:46: walkableRadius 2 -> 1 (0.45 m inset, still 0.10 m clear of PLAYER_RADIUS 0.35). Verify with getNavPath straight through each arch after.

### 2. [critical/confirmed] Every building's door faces away from its own square

`game/src/content/regions.ts:578`

**Root cause.** Prefabs put the door on side index 2 (local -Z), so world facing = rotationY + PI. The authored rotationY values were chosen so buildings look right from outside the town, which points every entrance outward. Nothing checks it.

**Evidence.** Measured dot(door facing, direction to settlement centre): Coldbrace 11 of 11 negative (-0.61 to -1.00), including the March Company Hall at exactly -1.00 and the Forge Shed at -0.94. Rootfall 4 of 9 negative. Highcairn 3 of 6 negative, and hut_3's door at (145.45,-53.98) plus hut_5's at (142.55,-80.02) each open onto a wall_segment panel 2 m away. Visible in SET-town_center.png as the hall's doorless window band.

**Fix.** Re-author rotationY per the layouts below so every door's facing dot with (centre - door) is > 0.5, and add a gate-check assertion that computes exactly that. The rule is rotationY = atan2(centre.x - pos.x, centre.z - pos.z) + PI, snapped to the nearest quarter turn.

### 3. [critical/confirmed] The walls are four disconnected stubs; 79-100% of every perimeter is open and all corners are missing

`game/src/content/regions.ts:591`

**Root cause.** There is no wall-run content type. A wall is authored as individual `wall_segment` buildings with an 8 m footprint, so four of them is 32 m of wall for a town whose circuit is 212 m.

**Evidence.** Coldbrace: 4 walls (32 m) + 2 gatehouses (12 m) = 44 m of a 212 m circuit; gaps of 6, 9, 23, 8, 9, 23, 44 and 46 m, four open corners. Highcairn: 30 m of 139 m, gate 15 m from the nearest wall along the circuit. Rootfall: 0 m, no gate. Worse, the stubs are net-negative — getNavPath(144,-40 -> 144,-90) detours to x=149.5 to walk around Highcairn's two free-standing stubs in open moor.

**Fix.** Add `WallRunDef { id, name, from: Spot, to: Spot, openings: {at, width}[] }` and `walls: WallRunDef[]` on SettlementDef. regionBuilder walks it in MODULE_METRES steps, skips modules inside an opening, emits kit.wall + wall_bottom_trim per module and one 0.5 m thick BuildingBox per module, with kit.corner posts at both ends. Then author one run per side with the gatehouse position as the opening.

### 4. [critical/confirmed] The bank chest, anvil, furnace, range and both shops are sub-metre props standing loose on open ground because there is no way to author them otherwise

`game/src/content/regions.ts:599`

**Root cause.** SettlementDef has stations/bank/shops but no `props` array and no structure to attach them to. buildings.ts has no open-fronted or roofed-but-open prefab, so there is no forge, no porch and no arcade to put anything under.

**Evidence.** Measured drawn footprints: chest_wood 1.28 x 0.76 m, anvil 1.08 x 0.40 m, cauldron 0.99 x 0.94 m, cooking_pot @1.6 0.86 x 0.78 m, workbench_drawers @1.6 0.68 x 0.48 m (a 68 cm drawer unit alone on grass 6 m from anything). Nearest building surface: coldbrace_bank 5.0 m, rootfall_bank_chest 10.0 m, coldbrace_general 8.6 m, coldbrace_smith 8.56 m. Screenshot SET-bank.png.

**Fix.** Add `props: PropDef[]` (id, assetId, position, rotationY, scale?, dy?, solid?) to SettlementDef and emit them from regionBuilder alongside the building parts. Add three prefabs — `forge` (three walls + roof + posts, front face open, collision = 3 thin boxes), `porch` (2-3 overhang_plaster/overhang_brick modules on two corner posts, collision = 2 post boxes only), `arcade` (n overhang modules over a back wall) — and put every station and the bank under one of them, per the layouts below.

### 5. [critical/confirmed] Each town centre is a 315-621 m² void that the scatter system is explicitly forbidden to dress

`game/src/app/boot.ts:1076`

**Root cause.** registerExclusions adds a 46 m radius circle around every settlement centre, so no grass, clover, pebble, flower or bush is placed anywhere in or near a town. Combined with the flat pad and the untextured vertex-coloured ground material, the result is a plain.

**Evidence.** 46 m radius = 6,648 m² of forbidden ground per settlement. Measured empty rectangles around each centre with nothing in them at all: Coldbrace 25.0 x 23.0 m (575 m²), Rootfall 23.0 x 27.0 m (621 m²), Highcairn 18.5 x 17.0 m (315 m²). Flat pad radii from worldSpec.settlementRadius(): 48 / 35 / 35 m with a 26 m blend. Visible as the grey disc in SET-highcairn.png.

**Fix.** Replace the settlement circle with per-building exclusions (footprint half-diagonal + 2 m) plus the authored paving rects, so scatter runs right up to the walls and between the houses. Then add paving: `PavingDef { rect, assetId, kerb }` on SettlementDef, tiled on the 2 m grid at ground+0.02 with kerb_straight along the edge and kerb_corner at the corners. floor_cobble/floor_brick/floor_wood are exactly 2.00 x 0.02 x 2.00 and cost one instanced group.

### 6. [high/confirmed] Nothing in a settlement except the buildings has a collider — the player walks through the bank chest, the anvil, the stalls, the NPCs and the gate arch

`game/src/app/boot.ts:219`

**Root cause.** physics.addStaticBox is called only for built.buildings (the prefab collision boxes). Stations, the bank, shops, NPCs, landmarks, gates and every scatter prop are never registered. physics.addStaticCylinder has zero callers anywhere in the repo.

**Evidence.** grep -rn 'addStaticBox|addStaticCylinder' game/src returns exactly one call site, boot.ts:220, inside the `for (const box of built.buildings)` loop. SET-bank.png shows the player standing on top of the bank chest, feet inside the lid.

**Fix.** After the buildings loop, add a cylinder or box collider for every station, shop, bank and landmark whose drawn bounds exceed ~0.6 m, driven off a new `solid?: boolean` on those defs (default true for bank/station/shop, false for ground-level dressing like kerbs and paving). Keep them out of the navmesh input or make them nav obstacles too, whichever the movement domain prefers.

### 7. [high/confirmed] Town walls, gatehouses, the vault tower and ruins ignore BuildingKit — a plaster village and a timber logging town both get brick walls

`game/src/render/buildings.ts:689`

**Root cause.** wallSegment(width) and gatehouse(width, depth) take no kit parameter (buildPrefab calls them without one at lines 374-375) and hardcode wall_brick_straight + corner_brick. tower() and ruin() do the same.

**Evidence.** buildings.ts:690-696 emits 'wall_brick_straight' and 'corner_brick' unconditionally; buildings.ts:667-676 the same for gatehouse piers and posts. Coldbrace is kit 'plaster' and Rootfall is kit 'timber', and both would render a brick town wall. Visible in SET-town_entrance.png: grey brick gate piers next to lime-plaster cottages.

**Fix.** Thread the kit through: wallSegment(width, kit) using kit.wall / kit.corner, gatehouse(width, depth, kit), tower(width, depth, rng, kit), ruin(width, depth, rng, kit). prefabPartAssetIds() already probes every kit so the manifest check will cover the new ids for free.

### 8. [high/confirmed] Highcairn's flat pad erases the 18 m terrace riser the whole region is designed around

`game/src/app/worldSpec.ts:112`

**Root cause.** settlementRadius() returns a single disc radius from the furthest authored thing, and Highcairn's south wall (144,-82) and hut_5 (142,-78) sit south of the terrace-2/terrace-3 boundary at z=-76, so the 35 m pad plus 26 m blend flattens the riser.

**Evidence.** getDrawnBounds(highcairn_wall_n#w0) base y = 26.810 at z=-52; getDrawnBounds(highcairn_wall_s#w0) base y = 26.810 at z=-82. Identical across 30 m of z, in a region whose terraces (regions.ts:956-961) are 18 m apart. SET-highcairn.png shows the resulting grey table with a hard edge.

**Fix.** Move every Highcairn building into z ∈ [-74,-46] (layout below) and add `padShape?: { halfX, halfZ, rotationY }` to SettlementDef, consumed by flatSpotsFor, so the pad is a 44 x 28 rectangle inside terrace two rather than a disc. Then the south wall stands on the lip and the 18 m drop becomes the town's rampart. worldSpec.ts is root-only; render/scene.ts FlatSpot needs a rect variant.

### 9. [high/confirmed] The Forge Shed's only door faces away from the anvil and furnace it serves

`game/src/content/regions.ts:588`

**Root cause.** coldbrace_forge_shed sits at (-152,-98) with rotationY 0, so its door lands on the -Z face at (-152.45,-100.02). The furnace (-150,-94) and anvil (-154,-94) are on the +Z side, 2 m behind the building.

**Evidence.** buildPrefab door part world position (-152.45,-100.02) facing PI (south); stations at z=-94, 6 m north of the door on the opposite face. The player interacts with a smithing station standing in the shed's back yard.

**Fix.** Replace `shed` with the new open-fronted `forge` prefab, placed so the open face looks at the square, and move both stations under its roof. Coldbrace layout below places it at (-146,-86) rotY -PI/2 with the furnace at (-147.6,-84.2) and the anvil at (-148.0,-86.2).

### 10. [medium/confirmed] The Coldbrace cooking range interpenetrates the vault-door torch and banner

`game/src/content/regions.ts:601`

**Root cause.** coldbrace_range (cooking_pot, scale 1.6) is at (-166,-94), 1 m off the vault tower's south wall, in the middle of the march_vault_tower landmark composition's approach.

**Evidence.** AABB overlap against manifest sizes: range x torch_l (at -166.5,-93.7) 0.22 x 0.59 m; range x banner_l (at -165.1,-93.55) 0.42 x 0.04 m. The composition also self-clashes: torch_r x banner_r 0.98 x 0.46 m and the hero door_frame_round x banner_r 0.64 x 0.26 m.

**Fix.** Move the range under a cookhouse lean-to per the layout (-149.4,-70.4) and pull the vault_door composition's banners out from ±1.3/-2.9 to ±2.6 so they clear the torches and the door frame.

### 11. [medium/confirmed] Coldbrace houses 5 and 6 have interpenetrating roofs

`game/src/content/regions.ts:583`

**Root cause.** coldbrace_house_5 (-182,-64) and coldbrace_house_6 (-176,-68) are placed corner-to-corner exactly (gapX = gapZ = 0.00 on the collision boxes), but roof_tiles_4x6 overhangs the 6x4 footprint by 0.79 m in X and 0.76 m in Z.

**Evidence.** Roof AABBs: house_5 x[-185.79,-178.21] z[-66.76,-61.24]; house_6 x[-179.79,-172.21] z[-70.76,-65.24]. Overlap 1.57 x 1.51 m of interpenetrating tile.

**Fix.** Never place two buildings closer than footprint + 1.8 m. The Coldbrace layout below puts house_6 at (-176,-84) and house_5 at (-176,-70), 8-14 m apart. Add a gate-check assertion on roof AABB overlap, not just footprint overlap.

### 12. [medium/confirmed] Rootfall's town square landmark is buried and its staircase climbs into thin air

`game/src/render/buildings.ts:847`

**Root cause.** rootfallStump() was re-authored against a stump assumed to be 3.7 m tall standing on the ground. The hero mesh (tree_twisted_2 @2.0, clipFraction 0.24) actually draws from 1.67 m BELOW ground to 2.05 m above it.

**Evidence.** getDrawnBounds(rootfall_stump) y 6.430..10.150; getDrawnBounds(rootfall_stump#step_1) base y 8.100 (= ground, dy 0) at z 122.60..124.53, entirely outside the stump's z 118.14..121.86; getDrawnBounds(#step_3) top y 11.620, i.e. 1.47 m above the top of the stump. Visible in SET-rootfall.png as a black clump with steps and mushrooms jutting out of it.

**Fix.** Either raise clipFraction from 0.24 to ~0.40 so the stump stands 3.5 m proud, or re-author the flights to dy 0 / 0.65 / 1.30 and dz 2.6 / 1.4 / 0.2 so three flights climb the 2.05 m that is actually visible. Measure the result with getDrawnBounds, do not derive it from the manifest size.

### 13. [medium/confirmed] A Highcairn farm plot spawns inside the Crew Hut

`game/src/world/regionBuilder.ts:669`

**Root cause.** buildCluster places nodes on a deterministic spiral within cluster.radius and never tests the settlement's BuildingBoxes, and highcairn_plots is authored at (128,-58) radius 6, overlapping highcairn_hut_1 at (132,-58).

**Evidence.** getEntity('highcairn_plot_beds_1') position [129.80, 26.81, -57.93]; highcairn_hut_1's collision box is x[129.5,134.5] z[-60,-56]. One of four plots is inside a solid building; the player cannot reach it.

**Fix.** Move the plots to (127,-53) radius 5 per the Highcairn layout, and make buildCluster reject a spiral spot that falls inside any BuildingBox of the same region (re-roll along the spiral).

### 14. [medium/confirmed] Rootfall is half a settlement: three NPCs, two stations, one shop, no wall, no gate, no crafting bench, no light source

`game/src/content/regions.ts:804`

**Root cause.** The tier-5 settlement was authored with a thinner content set than the tier-1 one and never filled in.

**Evidence.** Coldbrace: 5 stations, 2 shops, 5 NPCs, 4 walls, 2 gatehouses, 12 buildings. Highcairn: 3 stations, 2 shops, 4 NPCs, 3 walls, 1 gatehouse. Rootfall: 2 stations (range + anvil), 1 shop, 3 NPCs, 0 walls, 0 gatehouses, 9 buildings, and no lamp_wall or torch anywhere in the settlement — a logging town in a region whose fogStart is 55 m.

**Fix.** Per the Rootfall layout: add a palisade run with three gates, an open-front forge with a smith shop and a fourth NPC, a sawpit with crafting_table + fletching_bench, lamp_wall on the four green-facing walls, torches at the bank counter, and a covered bank counter cut into the stump so the blurb ('One chest, set into the stump') is true.

## Recommendations

1. PLAN VIEW 1 — COLDBRACE AS BUILT (1 char = 2 m, north up, east right; x -192..-127, z -116..-48). Legend: A=hall(12x6,rotY PI) B=vault tower(6x6) C..F=houses 1-4 G..J=houses 5-8 K=forge shed #=wall_segment ^=gatehouse d=door 1.5 m out $=bank chest a=anvil f=furnace r=range c=crafting t=fletching S/G=shops @=NPC *=route node !=landmark .=road
  -53 |              #####               <- north wall stub, connects nothing
  -55 |                d                 <- hall door, faces NORTH away from town
  -57 |             AAAAAAA             .
  -59 |     d       AAAAAAA        d    .
  -61 |    GGGG     AAAAAAA       JJJJ ..
  -63 |    GGGGd    AAAAAAA    d  JJJJ . 
  -65 |    GGGHHHH            IIIIJJJJ .   <- G and H roofs overlap 1.57x1.51 m
  -67 |       HHHH            IIII    . .
  -69 |       HHHH            IIII    ...
  -71 |....                           .. 
  -73 |   ....@        @             ... 
  -75 |       ....                   ..  
  -77 |          ....              ^^^   
  -79 |   #    G     ..*.......S...^*^   <- 25x23 m EMPTY square, 575 m2
  -81 |   #            .           ^^^   
  -83 |   #            .      @    ^^^   
  -85 |   #         @  .                 
  -87 |   #       BBBB *                 <- bank chest 5 m outside the vault
  -89 |           BBBB .                 
  -91 |        t cBBBB .            #    
  -93 |           B!rB .  a f       #    <- range clashes the vault torch 0.22x0.59 m
  -95 |            d   .  KKK       #    
  -97 |                .  KKK       #    
  -99 |                .  KKK       #    <- anvil+furnace are BEHIND the shed
 -101 |    CCCC DDDD   .@  d EEEE FFFF   
 -103 |    CCCC DDDD   .     EEEE FFFF   
 -105 |    CCCC DDDD  ^^^^   EEEE FFFF   
 -107 |     d####d    ^*^^    d    d     <- doors 1&2 open onto the wall, 2 m
 -109 |               ^^^^.              
Wall audit: circuit x[-186,-134] z[-108,-54] = 212 m. Built 44 m (4 stubs x 8 + 2 gates x 6) = 20%. Gaps 6/9/23 m south, 8/9/23 m east, 44 m north, 46 m west, all four corners open. All 11 doors face away from the centre. The town_center->west_track road leaves at (-186,-72.6), 7 m past the end of the west stub, through nothing.

2. PLAN VIEW 2 — ROOTFALL AS BUILT (x 38..82, z 98..148). A/B=houses 1-2 C/D/E=houses 3-5 F/G=houses 6-7 H=house 8 I=drying shed !=stump $=bank chest a=anvil r=range G=shop @=NPC
  144 |     d      d     ..   
  142 |     III   HHHH  ..    
  140 |     III   HHHH  .    .
  138 |     III   HHHH ..  ...
  136 |   AAA          . ...  
  134 |   AAA         ....    
  132 |   AAAd       ...      
  130 |   AAA      ...  GGG   
  128 |           *...  GGG   <- bank chest 10 m from any building, 6 m of grass to the stump
  126 |       G   . @  dGGG   
  124 |           ..    GGG   
  122 |   BBB   @ ..    FFF   
  120 |...BBB.....!.    FFF   <- stump buried 1.67 m, only 2.05 m proud
  118 |   BBBd     ... dFFF   
  116 |   BBB        @. FFF   
  114 |                ..     
  112 |        r      a  ..   <- anvil and range loose on grass
  110 |    CCCC        EEEE.. 
  108 |    CCCC  DDDD  EEEE  .
  106 |    CCCC  DDDD  EEEE   
  104 |     d    DDDD   d     <- C, D, E doors all face SOUTH, away from the green
  102 |           d           
Wall audit: 0 m of wall, 0 gatehouses, 140 m of open perimeter. Empty green 23 x 27 m = 621 m2. Houses 3,4,5,8 and the shed (5 of 9) present blank rear walls to the green.

3. PLAN VIEW 3 — HIGHCAIRN AS BUILT (x 116..168, z -88..-46). A=hut1 B=hut2 C=hut3 D=hut4 E=hut5 F=hut6 ^=gatehouse #=wall !=crane
  -52 |  ..        ###d#.         <- hut_3's door opens onto the north wall, 2 m
  -54 |    ..        CCC.   ^^^   <- gatehouse, 15 m along the circuit from the nearest wall
  -56 |     ..AAA    CCC    ^^^   
  -58 |      *AAA    CCC    ^^^   <- highcairn_plots node; plot 1 spawns INSIDE hut A
  -60 |       AAA.   @.. S  ^^^   
  -62 |        d .G.  .           
  -64 |   #FFF    .....    !      <- crane 2 m off hut D's wall, self-clashing
  -66 |   #FFFd      *.@  DDD     
  -68 |   #FFF    @   ...dDDD     
  -70 |   #          ...* DDD     <- bank chest on bare slate, 4 m from hut D
  -72 |   #  BBB.f.a..       ...  <- furnace and anvil loose, 4 m apart, no structure
  -74 |    ..BBB.        @     ...
  -76 |..... BBB   EEE r          <== TERRACE 2/3 BOUNDARY, authored 18 m riser
  -78 |       d    EEE            
  -80 |            EEE            
  -82 |            #d###          <- south wall stub, hut_5's door opens onto it
Wall audit: 30 m of a 139 m circuit = 21%; north and south stubs are free-standing in open moor and getNavPath detours 5 m around them. The whole south third sits over the terrace lip, and getDrawnBounds proves wall_n and wall_s share y = 26.810, so the 18 m riser is flattened.

4. REPLACEMENT LAYOUT — COLDBRACE (fallowmarch, kit plaster, centre -160,-80). Walled rectangle x[-186,-134] z[-108,-56], perimeter 208 m, all four corners closed. The route nodes spawn(-160,-118), town_entrance(-160,-108), town_center(-160,-80), bank_interior(-160,-88), coldbrace_east_gate(-134,-80) and the wall_vault obstacle at (-160,-56) are all preserved, so the distance ledger does not move.

WALL RUNS (new WallRunDef type): W (-186,-108)->(-186,-56) opening at z=-80 w=8 | N (-186,-56)->(-134,-56) no opening (this is the wall the wall_vault obstacle vaults at x=-160) | E (-134,-56)->(-134,-108) opening at z=-80 w=8 | S (-186,-108)->(-134,-108) opening at x=-160 w=8. Corner piers corner_wood @1.8 at all four corners.
GATEHOUSES (footprint [8,3], 4 m arch): coldbrace_gate_south (-160,-108) rotY 0 | coldbrace_gate_east (-134,-80) rotY PI/2 | coldbrace_gate_west (-186,-80) rotY -PI/2. Add a non-routeNode location coldbrace_west_gate at (-186,-80) kind 'gate' and split the road town_center->west_track into town_center->coldbrace_west_gate->west_track (72.8 m becomes 73.2 m, no Dijkstra change).

PAVING (floor_cobble, kerb_straight edges, kerb_corner corners): SQUARE rect x[-170,-150] z[-90,-74] (20x16) | GATE STREET x[-162,-158] z[-108,-100] | WEST FORK x[-170,-158] z[-100,-96] then x[-170,-166] z[-96,-90] | EAST FORK x[-162,-150] z[-100,-96] then x[-154,-150] z[-96,-90] | EAST STREET x[-150,-134] z[-82,-78] | WEST STREET x[-186,-170] z[-82,-78]. Total ~150 tiles = one instanced group. Walking in the south gate you get 8 m of walled street, the vault tower dead ahead, the street forks around it, and both branches open onto the square.

BUILDINGS (id, prefab, position, rotationY, footprint):
coldbrace_vault      tower   (-160,-94)  PI     [6,6]   door +Z at (-160.55,-91.0), porch over z[-91,-89]
coldbrace_hall       hall    (-160,-70)  0      [12,6]  door -Z at (-159.55,-73.0), 1 m off the square's north kerb
coldbrace_forge      forge*  (-146,-86)  -PI/2  [6,5]   open face at x=-149, 1 m off the square's east kerb
coldbrace_cookhouse  shed    (-152,-70)  -PI/2  [4,4]   with a porch on the +X face
coldbrace_workshed   forge*  (-176,-96)  -PI/2  [4,4]   open face east, holds crafting + fletching
coldbrace_house_5    cottage (-176,-70)  0      [6,4]   door (-175.45,-73.0) -> square NW
coldbrace_house_8    cottage (-144,-70)  0      [6,4]   door (-143.45,-73.0) -> square NE
coldbrace_house_6    cottage (-176,-84)  -PI/2  [6,4]   door (-173.0,-83.45) -> square west kerb
coldbrace_house_7    cottage (-176,-90)  -PI/2  [6,4]   door (-173.0,-89.45)
coldbrace_house_3    cottage (-144,-78)  PI/2   [6,4]   door (-146.0,-78.55) -> square east kerb
coldbrace_house_4    cottage (-144,-94)  PI/2   [6,4]   door (-146.0,-94.55) -> east fork
coldbrace_house_1    cottage (-176,-100) PI     [6,4]   door (-176.55,-98.0) -> west fork
coldbrace_house_2    cottage (-168,-104) PI     [6,4]   door (-168.55,-102.0) -> west fork
coldbrace_stall_1    stall   (-152,-94)  -PI/2
coldbrace_stall_2    stall   (-152,-98)  -PI/2
(*forge = new open-fronted prefab, see the vocabulary item.)

BANK: the chest stays at bank_interior's coordinate frame. bank (-160,-89.6) rotY 0, under a `porch` composition on the vault tower's north face — two corner_wood posts at (-162,-88.6)/(-158,-88.6), two overhang_plaster modules at (-161,-89.6) and (-159,-89.6), a table_large counter at (-160,-88.6) rotY 0, lamp_wall x2, banner_1 x2, and move the existing vault_door torches to (-162.4,-88.4)/(-157.6,-88.4). bank_interior (-160,-88) then stands on the porch step.
STATIONS: coldbrace_furnace cauldron @1.8 (-147.6,-84.2) rotY -PI/2 (inside the forge) | coldbrace_anvil anvil @1.4 (-148.0,-86.2) rotY -PI/2 (forge mouth) | coldbrace_range cooking_pot @2.2 (-149.4,-70.4) rotY -PI/2 (under the cookhouse porch) | coldbrace_crafting workbench (-174.4,-95.2) rotY -PI/2 (in the work shed) | coldbrace_fletching workbench_drawers @3.5 (-174.4,-96.8) rotY -PI/2 (scale 1.6 draws a 68 cm box; 3.5 gives a 1.48 m bench).
SHOPS: coldbrace_general market_stall (-168,-88) rotY -PI/2 (square SW, facing east) | coldbrace_smith market_stall_cart (-150.5,-88.5) rotY -PI/2 (in front of the forge).
NPCS: npc_warden_ilse (-160.0,-75.5) facing PI (hall doorstep, looking down the square) | npc_pitmaster_dorn (-162.0,-88.6) facing PI/2 (at the bank counter) | npc_smith_harrow (-150.0,-86.0) facing -PI/2 (forge mouth) | npc_ranger_syb (-173.5,-83.0) facing PI/2 (house_6 doorstep) | npc_carter_bel (-158.5,-103.0) facing 0 (by the wagon inside the south gate).
PROPS (new props array): well composition (-160,-82) at the centre of the square | bench (-164,-80) rotY PI/2 and (-156,-80) rotY -PI/2 | wagon (-157,-104) rotY 0.2 with barrel (-155.2,-103), crate_village (-154,-101.5), sack (-153,-104) | forge yard: whetstone (-148.6,-88.4), weapon_rack (-147.0,-84.2) rotY -PI/2, barrel (-149.2,-83.0) and (-149.2,-89.4), training_dummy (-152.5,-90.5) rotY 0.4 | market: crate_wood (-153.0,-95.4), sack (-153.2,-97.6), barrel_apples (-152.8,-92.6), farm_crate_carrot (-167.5,-87.2), farm_crate_apple (-166.8,-89.0) | woodpile: roof_log @0.26 dy -1.00 at (-177.5,-96.5),(-177.5,-95.8),(-177.2,-96.1) against house_1's gable | gardens (fence_wood_single, 2 m modules): (-180,-66)->(-172,-66)->(-172,-60), (-148,-66)->(-140,-66)->(-140,-60), (-180,-104)->(-172,-104) | lamp_wall at y 2.4 on (-173.3,-84), (-146.3,-78), (-149.3,-88), (-166.7,-73) | banner_1 x2 on the south gatehouse, x2 on the vault porch.

5. REPLACEMENT LAYOUT — ROOTFALL (vellenwood, kit timber, centre 60,120). rootfall_bank stays at (60,128) — it is 38.0 m from hollowcut_seam and that number is the route-optimisation pillar. root_tunnel (76,134) and canopy_walk (40,138) entrances stay clear.

PALISADE (WallRunDef, timber kit): W (44,102)->(44,144) opening at z=120 w=8 | N (44,144)->(78,144) opening at x=66 w=6 | E (78,144)->(78,102) openings at z=134 w=4 (root tunnel postern) and z=110 w=6 | S (78,102)->(44,102) opening at x=60 w=6. 152 m circuit, ~128 m of built palisade, corner_wood corner posts @2.2.
GATEHOUSES: rootfall_gate_west (44,120) rotY -PI/2 [8,3] | rootfall_gate_south (60,102) rotY 0 [8,3] | rootfall_gate_ne (66,144) rotY PI [8,3].
PAVING (floor_wood plank decking, a logging town): GREEN rect x[52,68] z[114,128] | LOG ROAD x[44,52] z[118,122] | CART ROAD x[56,64] z[106,114] then x[64,78] z[108,112].

BUILDINGS (only rotations change on five of them):
rootfall_house_1 cottage (48,132) -PI/2 door (50.0,132.55) -> green NW
rootfall_house_2 cottage (48,118) -PI/2 door (50.0,118.55) -> green W
rootfall_house_3 cottage (52,108) PI    door (51.45,110.0) -> green S  [was rotY 0, faced away]
rootfall_house_4 cottage (62,108) PI    door (61.45,110.0) -> green S  [was rotY 0]
rootfall_house_5 cottage (72,110) PI    door (71.45,112.0) -> green SE [was rotY 0]
rootfall_house_6 cottage (72,118) PI/2  door (70.0,118.55) -> green E
rootfall_house_7 cottage (72,127) PI/2  door (70.0,127.55) -> green NE
rootfall_house_8 cottage (62,138) 0     door (62.55,136.0) -> green N  [was rotY PI]
rootfall_shed    shed    (50,140) 0     door (50.55,138.0) -> green NW [was rotY PI]
rootfall_forge   forge*  (68,136) PI    [6,5] open face SOUTH onto the green
rootfall_sawpit  arcade* (54,136) PI    [6,3] open work bay facing the green

BANK: chest stays at (60,128) rotY PI, behind a new `bank_counter` composition cut into the stump's north face — corner_wood posts (58.6,129.4) and (61.4,129.4), roof_wood_plank canopy at (60,129.2) dy 2.6, table_large counter (60,128.9) rotY 0, torch @2.6 at (57.6,129.6) and (62.4,129.6), lamp_wall x2, banner_2. That makes the blurb 'One chest, set into the stump' literally true.
FIX THE STUMP FIRST: raise clipFraction 0.24 -> 0.40 (or re-author the flights to dy 0/0.65/1.30, dz 2.6/1.4/0.2). As it stands the hero mesh is 1.67 m below ground and the stairs end 1.47 m above it.
STATIONS: rootfall_range cooking_pot @2.2 (65.6,108.6) rotY PI under a lean-to on house_4's east gable, with a cauldron at (65.6,110.2) and table_large at (66.4,106.6) | rootfall_anvil anvil @1.4 (68.0,134.2) rotY PI inside the forge | NEW rootfall_crafting workbench (54.4,135.0) rotY -PI/2 at the sawpit | NEW rootfall_fletching workbench_drawers @3.5 (54.4,137.0) rotY -PI/2.
SHOPS: rootfall_general market_stall (53.0,124.0) rotY PI/2 on the green's west kerb | NEW rootfall_smith market_stall_cart (66.4,133.0) rotY PI at the forge.
NPCS: npc_woodward_ansel (57.6,124.6) facing 2.4 | npc_seamer_juno (62.4,127.4) facing -PI/2 (behind the bank counter) | npc_trapper_mott (70.2,118.6) facing -PI/2 (house_6 doorstep) | NEW npc_smith (67.4,134.8) facing PI/2 at the forge — Rootfall currently has three NPCs against Coldbrace's five.
PROPS: well composition (56,116) | bench (58,115.4) rotY 0 and (62,115.4) rotY 0 on the green's south kerb | wagon (70,112) rotY 1.2 loaded, on the cart road | woodpile roof_log @0.28 dy -1.08 at (52.4,131.0),(52.4,130.2),(52.7,130.6),(52.5,129.8) against house_1's gable | sawpit: support_beam trestles (53.0,134.6) and (55.0,134.6), crate_village x2 (52.6,138.0),(55.4,138.4), sack x3 | gardens fence_wood_single (46,136)->(52,136)->(52,142) and (74,112)->(74,122) | lamp_wall y 2.4 at (50.3,131.0),(50.3,118.0),(69.7,118.0),(69.7,127.0) — Rootfall currently has no light source at all in a region with fogStart 55.

6. REPLACEMENT LAYOUT — HIGHCAIRN (karrowmoor, kit stone, centre 144,-66). highcairn_bank stays at (150,-70): it carries the 187.9 m road / 45.9 m Sunder Ledge flip. Every building moves into z ∈ [-74,-46] so the pad stops erasing the terrace-2/3 riser at z=-76, and the south wall stands ON the lip so the 18 m drop becomes the rampart.

WALL RUNS: S (122,-74)->(162,-74) no opening (this is the cliff edge) | E (162,-74)->(162,-48) opening at z=-58 w=8 | N (162,-48)->(122,-48) no opening | W (122,-48)->(122,-74) opening at z=-58 w=8. 132 m circuit, 118 m built, corner_brick piers @1.8 at all four corners.
GATEHOUSES: highcairn_gate (162,-58) rotY PI/2 [8,3] (the quarry road) | highcairn_postern (122,-58) rotY -PI/2 [8,3] (onto the plots and ramp two).
PAD: needs padShape { halfX: 22, halfZ: 14, rotationY: 0 } centred (142,-60) so the flat area is 44 x 28 and stays wholly inside terrace two.
PAVING (floor_brick — the quarry town paves in its own stone): YARD rect x[132,156] z[-70,-54] | GATE ROAD x[156,162] z[-60,-56] | WEST TRACK x[122,132] z[-60,-56].

BUILDINGS:
highcairn_hut_1  quarry_hut (136,-51) 0      [5,4] door (136.55,-53.02) -> yard
highcairn_hut_3  quarry_hut (148,-51) 0      [5,4] door (148.55,-53.02) -> yard
highcairn_hut_5  quarry_hut (136,-71) PI     [5,4] door (135.45,-69.0)  -> yard
highcairn_hut_2  quarry_hut (154,-71) PI     [5,4] door (153.45,-69.0)  -> yard
highcairn_hut_6  quarry_hut (128,-62) -PI/2  [5,4] door (130.5,-61.45)  -> west track
highcairn_hut_4  quarry_hut (158,-66) PI/2   [5,4] door (155.5,-66.55)  -> yard, watching the gate
highcairn_forge  forge*     (144,-71) PI     [6,5] open face NORTH onto the yard
highcairn_arcade arcade*    (154,-58) PI/2   [6,3] covered market row on the yard's east side

BANK: chest stays at (150,-70) rotY PI, under a `bank_counter` composition — corner_brick piers (148,-68.6) and (152,-68.6), two overhang_brick modules at (149,-69.4) and (151,-69.4), table_large counter (150,-68.8) rotY 0, lamp_wall x2, banner_1. Occupies x[148,152] z[-72,-68], clear of the forge (x<=147) and hut_2 (x>=151.5).
STATIONS: highcairn_furnace cauldron @2.0 (142.6,-70.2) rotY PI inside the forge | highcairn_anvil anvil @1.4 (144.0,-69.6) rotY PI at the forge mouth | highcairn_range cooking_pot @2.2 (136.6,-69.4) rotY PI under a lean-to on hut_5's north gable.
SHOPS: highcairn_general market_stall (153.0,-57.0) rotY -PI/2 under the arcade | highcairn_smith market_stall_cart (147.0,-67.4) rotY PI at the forge.
NPCS: npc_foreman_arden (150.0,-68.2) facing 0 (behind the bank counter) | npc_quarrier_vess (145.0,-67.6) facing PI (at the forge) | npc_cairnkeeper_ode (130.6,-61.6) facing PI/2 (long hut door, by the plots) | npc_watcher_hale (155.4,-66.0) facing -PI/2 (watch hut door, facing the gate).
FARM: move highcairn_plots to (127,-53) radius 5 so no bed lands inside hut_1, and fence it with fence_wood_single (122,-49)->(132,-49) and (132,-49)->(132,-58).
LANDMARK: move highcairn_crane from (156,-64) — where it is 2 m off hut_4's wall and its own jib, drum and rope interpenetrate — to (140,-60), the middle of the north yard, where the 9 m jib clears every roof. Add a spoil heap (rock_medium_2 at 1.2, rock_medium_3 at 0.9) and put the wagon under the jib.
PROPS: wagon (139,-62) rotY 1.6 under the crane | crate_metal (137.4,-63.2),(138.6,-64.0),(136.2,-64.4) | barrel (151.0,-57.0),(152.2,-58.4) and sack x3 at the arcade | bench (143,-56) rotY 0 and (147,-56) rotY 0 | training_dummy (158.0,-61.0) rotY PI/2 by the watch hut | weapon_rack (146.6,-72.2) rotY PI, whetstone (142.0,-72.0) at the forge | torch @3.0 on the south wall's inner face at (128,-73),(138,-73),(152,-73),(160,-73) — the wall stands on an 18 m drop, light it | lamp_wall x6 at y 2.4 on the yard-facing walls | path_rock_square_wide x8 on the unpaved margin so the pad is not bare slate.

7. BUILDING INTERIORS — the honest answer is NO for houses, YES for open-fronted structures, and the gate bug must be fixed either way. Measured: the navmesh cell size is 0.45 m (navigation.ts:245 picks LARGE_WORLD_CELL_SIZE because the world extent 700 m exceeds LARGE_WORLD_EXTENT 320) and walkableRadius is 2 voxels = 0.90 m of erosion per side. A 6x4 cottage with 0.406 m walls has a 5.19 x 3.19 m interior, which erodes to a 3.39 x 1.39 m polygon = 4.7 m², comfortably over minRegionArea (4 cells² = 0.81 m²) — so the floor would exist. But it would be an unreachable ISLAND: a 2 m doorway erodes to 0.20 m, under one cell, so Recast never connects it. That is not a prediction; it is already happening to all three gatehouses (getNavPath detours 4-5 m around each 2 m arch). Options, in order: (1) set NAV_CONFIG.walkableRadius from 2 to 1 (0.45 m inset, still 0.10 m more than PLAYER_RADIUS 0.35) — this makes a 2 m arch a 1.10 m corridor and fixes every gate for free, and is the change to make regardless of interiors; (2) author 4 m openings, which reads as a barn door on a cottage; (3) do not open the cottages. Even after (1), a real interior costs: prefabCollision must emit four wall boxes per building instead of one body box (36 buildings x 4 = 144 physics colliders and 144 invisible nav-obstacle meshes, up from ~40), a floor_wood/floor_cobble tile grid inside every enterable shell (9 tiles per cottage, one instanced group), furniture (bed/table_large/chair/stool/bookcase/cabinet all exist in the library), and a roof-fade in camera.ts that does not exist today (there is an occlusion probe, no fade). RECOMMENDED: do not open the cottages. Build the three open-front prefabs instead — `forge` (three walls, roof, posts, whole front face open), `porch`/`bank_counter` (roofed, walk-under, no walls at all), `arcade` (roofed market row over a single back wall). All three are walkable at the CURRENT nav config because they have no doorway to pinch shut, and they solve the entire complaint: the bank chest gets a roof and a counter, the anvil gets a forge, the stalls get an arcade. Then take fix (1) anyway so the gates work.

8. NEW VOCABULARY TO BUILD BEFORE AUTHORING THE DATA. Content types on SettlementDef in content/regions.ts: (a) `walls: WallRunDef[]` where WallRunDef = { id, name, from: Spot, to: Spot, openings: { at: number /* metres along the run */, width: number }[] } — regionBuilder steps it in MODULE_METRES, skips modules inside an opening, emits kit.wall + wall_bottom_trim per module plus kit.corner at both ends, and pushes one 0.5 m thick BuildingBox per module. This one type replaces 'four 8 m stubs' with a closed circuit in four lines of data and is the single highest-value addition. (b) `paving: PavingDef[]` where PavingDef = { id, rect: {minX,minZ,maxX,maxZ}, assetId: 'floor_cobble'|'floor_brick'|'floor_wood', kerb?: boolean } — tiled on the 2 m grid at ground + 0.02, kerb_straight along each edge, kerb_corner at the corners, no collision, one instanced group per (asset, tier). (c) `props: PropDef[]` where PropDef = { id, assetId, position: Spot, rotationY, scale?, dy?, solid? } — there is currently nowhere in the whole content layer to author a barrel. (d) `attachedTo?: string` on StationDef/BankDef/ShopDef naming the building or structure it belongs to, so the gate check can assert every station is within 3 m of what it names. (e) `padShape?: { halfX, halfZ, rotationY }` on SettlementDef, consumed by worldSpec.flatSpotsFor, with a rect variant of FlatSpot in render/scene.ts — worldSpec.ts is root-only, so flag it. NEW PREFABS in render/buildings.ts (add to PrefabId, PREFAB_IDS, buildPrefab, prefabHeight, prefabCollision): `forge` — ring walls on sides 0,1,3 only, side 2 open, roofSmall scaled, two support_beam posts at the open corners with dy -1.211*scale, one lamp_wall on the back wall; prefabCollision emits THREE 0.6 m thick boxes (back, left, right) so the player walks in and stands at the anvil. `porch` — 2-3 overhang_plaster (plaster/timber kits) or overhang_brick (stone kit) modules at dy 0 on two kit.corner posts, one lamp_wall, one banner; collision = two 0.4 x 0.4 post boxes only, so the roof is walk-under. `arcade` — n overhang modules over a back wall of kit.wall; collision = back wall only. `market_row` — n market_stall pitches on a 3 m spacing with crate_wood/barrel/sack between them and kerb_straight along the front; one thin counter box per stall. `well` — 4 corner_brick at ±0.7 on a 1.4 m ring, wall_bottom_trim ring, 2 support_beam uprights, roof_wood_plank at y 2.4, bucket_wood, chain_coil; one 1.6 x 1.6 x 1.0 box. NEW COMPOSITIONS: `bank_counter` (posts + overhang + table_large + 2 lamp_wall + banner + kerb), `forge_yard` (whetstone, weapon_rack, 2 barrels, training_dummy, sack), `market_pitch` (crates, barrels, sacks around one stall), `wood_pile` (4 roof_log at 0.26 scale lying flat with dy -1.00), `garden` (fence_wood_single run + 2 farm crates + flower_a_group). FIXES to existing prefabs: thread BuildingKit through wallSegment/gatehouse/tower/ruin (all four hardcode brick today); change the gatehouse gap constant from 2 m to 4 m in both gatehouse() and prefabCollision(); re-register the rootfall_stump composition against the measured hero bounds.

9. ORDER OF WORK, and the budget. 1) app/config.ts:46 walkableRadius 2 -> 1, and buildings.ts GATE_GAP 2 -> 4 with all gatehouses at [8,3]. Verify with getNavPath straight through each of the three arches — this alone turns three decorative arches into functioning gates. 2) Add WallRunDef + the kit threading, author the four wall runs per settlement. The towns are now enclosed. 3) Add PropDef + PavingDef + the forge/porch/arcade prefabs, then re-author the three layouts above wholesale. 4) boot.ts:1076 — replace the 46 m settlement exclusion circle with per-building exclusions plus the paving rects so scatter dresses the streets. 5) boot.ts:219 — add colliders for stations, the bank, shops and landmarks so the player stops standing inside the bank chest. 6) worldSpec padShape for Highcairn's terrace. BUDGET: measured today 276 draw calls of a 400 cap, 140 instanced entity groups, 892 entities. The dressing above adds roughly 14-18 new (assetId, tier) groups per settlement; because the group key includes tier, sharing one prop vocabulary across all three towns still costs 3 groups per asset, so plan for about +45-70 groups and 330-350 draw calls. Paving is nearly free (one group per settlement, 80-150 instances). Re-measure with `npm run perf -- --run runs/corealm` and `getEntityViewStats` after step 3, and if it bites, cut the per-settlement prop vocabulary rather than the paving. VERIFICATION SCENARIOS already written and left in place: runs/corealm/_settlement-audit.json (footing, scene stats, plot positions, drawn bounds), _settlement-audit2.json (nav paths through all three gates), _settlement-audit3.json (terrace flattening, stump registration). Re-run all three after the change and diff.

## Files to edit

- game/src/content/regions.ts
- game/src/render/buildings.ts
- game/src/world/regionBuilder.ts
- game/src/app/config.ts
- game/src/app/boot.ts
- game/src/app/worldSpec.ts
- game/src/render/scene.ts
