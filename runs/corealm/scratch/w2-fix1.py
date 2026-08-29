import io
p = 'game/src/content/settlements/coldbrace.ts'
s = io.open(p, encoding='utf-8').read()


def sub(a, b):
    global s
    assert a in s, a[:90]
    s = s.replace(a, b, 1)


sub('{ id: "coldbrace_bank_porch", name: "Vault Counter", prefab: "porch", position: [-163, -89], rotationY: Math.PI / 2, footprint: [4, 3] },',
    '{ id: "coldbrace_bank_porch", name: "Vault Counter", prefab: "porch", position: [-163, -89], rotationY: Math.PI / 2, footprint: [6, 3] },')

sub('''    // The bank counter: a walk-under roof on the vault tower's east face, looking down the bank
    // court. `porch` collides as its back wall plus two 0.4 m posts, so there is no doorway to
    // pinch the navmesh shut. The back wall draws at x -164.7..-164.5 and the tower's own east
    // panel draws out to x = -164.908, which is 0.21 m of clearance: close enough to read as built
    // against it, far enough not to z-fight.''',
    '''    // The bank counter: a walk-under roof on the vault tower's east face, looking down the bank
    // court. `porch` collides as its back wall plus two 0.4 m posts, so there is no doorway to
    // pinch the navmesh shut. Three bays, because two put the chest and the counter on top of each
    // other. The back panel draws at x -164.72..-164.28 and the tower's own east panel draws out to
    // x = -164.898 - both at the 1.111x every prefab part is currently emitted at - so they clear
    // by 0.18 m. The tower's spire, 7.34 m across at y >= 6.25 m, overhangs this canopy's 3.36 m by
    // 0.39 m, which is a tower with eaves over its own counter, not an interpenetration.''')

sub('{ id: "coldbrace_furnace", name: "Coldbrace Furnace", kind: "furnace", skill: "smithing", position: [-144.6, -87.4], rotationY: -Math.PI / 2, assetId: "cauldron", scale: 1.8, recipeIds: [], attachedTo: "coldbrace_forge_shed" },',
    '{ id: "coldbrace_furnace", name: "Coldbrace Furnace", kind: "furnace", skill: "smithing", position: [-144.8, -87.2], rotationY: -Math.PI / 2, assetId: "cauldron", scale: 1.6, recipeIds: [], attachedTo: "coldbrace_forge_shed" },')

sub('{ id: "coldbrace_anvil", name: "Coldbrace Anvil", kind: "anvil", skill: "smithing", position: [-146.8, -85.4], rotationY: -Math.PI / 2, assetId: "anvil", scale: 1.4, recipeIds: [], attachedTo: "coldbrace_forge_shed" },',
    '{ id: "coldbrace_anvil", name: "Coldbrace Anvil", kind: "anvil", skill: "smithing", position: [-146.6, -85.6], rotationY: -Math.PI / 2, assetId: "anvil", scale: 1.4, recipeIds: [], attachedTo: "coldbrace_forge_shed" },')

sub('''    // Inside the forge, against the back wall. `cauldron` at 1.8 draws 1.78 x 1.70 m, which leaves
    // 0.31 m to the back wall and 0.15 m to the side; the interior is 4.4 x 4.8 m and the mouth is
    // 4.4 m wide. A player standing at (-146.2,-86.6) is 1.79 m from this and 1.34 m from the
    // anvil, so one stand serves both inside `INTERACT_RANGE` 2.4 m.''',
    '''    // Inside the forge, against the back wall. The forge's three collision boxes leave a
    // 4.4 x 4.8 m interior, open along its whole 4.4 m west mouth. `cauldron` at 1.6 draws
    // 1.58 x 1.51 m, keeping 0.41 m to the back wall and 0.44 m to the side wall and leaving a
    // 2.4 x 1.95 m pocket of floor in front of it - 1.5 x 1.05 m after the navmesh erodes 0.45 m
    // per side, so the floor survives and is reachable straight in through the mouth. A player
    // standing in it at (-146.5,-86.9) is 1.72 m from this and 1.30 m from the anvil, so one stand
    // serves both inside `INTERACT_RANGE` 2.4 m. gate-check's smithing line and the Cold Iron
    // quest both walk `moveTo({ entityId })` to these two ids, so this is load-bearing.''')

sub('{ id: "coldbrace_bank", name: "Coldbrace Bank", position: [-163.9, -89.4], rotationY: Math.PI / 2, assetId: "chest_wood", attachedTo: "coldbrace_bank_porch" },',
    '{ id: "coldbrace_bank", name: "Coldbrace Bank", position: [-163.75, -90.4], rotationY: Math.PI / 2, assetId: "chest_wood", attachedTo: "coldbrace_bank_porch" },')

sub('''  // Behind the counter, under the porch roof, with the vault tower at its back. The player comes in
  // at the porch's south end - the counter's south end is at z = -89.92 - so a stand at
  // (-163.5,-90.8) is 1.5 m from the chest, inside `INTERACT_RANGE` 2.4 m.''',
    '''  // In the porch's south bay, against the back wall, with the vault tower behind it and the
  // counter in the next bay north. Measured: the chest collides x -164.13..-163.37 and the porch's
  // own back box ends at x = -164.19, so they clear by 0.06 m; the counter's collider ends at
  // z = -89.22 and the chest's starts at z = -89.76, so they clear by 0.54 m; and a stand at
  // (-162.0,-90.4), clear of the counter and of both porch posts, is 1.75 m from the chest, inside
  // `INTERACT_RANGE` 2.4 m. gate-check banks with `moveTo({ entityId })` on this id.''')

sub('{ id: "npc_warden_ilse", name: "Warden Ilse", position: [-159.4, -71.2], facingRad: Math.PI, assetId: "base_female", dialogueRootId: "ilse_root", questIds: [] },',
    '{ id: "npc_warden_ilse", name: "Warden Ilse", position: [-159.4, -72], facingRad: Math.PI, assetId: "base_female", dialogueRootId: "ilse_root", questIds: [] },')

sub('{ id: "npc_pitmaster_dorn", name: "Pitmaster Dorn", position: [-163.6, -87.6], facingRad: Math.PI / 2, assetId: "base_male", dialogueRootId: "dorn_root", questIds: [] },',
    '{ id: "npc_pitmaster_dorn", name: "Pitmaster Dorn", position: [-162.2, -88.5], facingRad: -Math.PI / 2, assetId: "base_male", dialogueRootId: "dorn_root", questIds: [] },')

sub('{ id: "npc_smith_harrow", name: "Harrow the Smith", position: [-147.2, -83.9], facingRad: -Math.PI / 2, assetId: "base_male", dialogueRootId: "harrow_root", questIds: [] },',
    '{ id: "npc_smith_harrow", name: "Harrow the Smith", position: [-147.4, -87.4], facingRad: -Math.PI / 2, assetId: "base_male", dialogueRootId: "harrow_root", questIds: [] },')

sub('''  // Every one of these stands on a doorstep, behind a counter or at a work face now, looking at
  // something. They were spread across 575 m2 of empty grass facing nothing.''',
    '''  // Every one of these stands on a doorstep, at a counter or at a work face now, looking at
  // something. They were spread across 575 m2 of empty grass facing nothing. Measured nearest
  // collider for each: Ilse 1.00 m off the hall's front wall on the square's north kerb, Dorn
  // 0.85 m in front of the bank counter, Harrow 1.81 m from the furnace inside the forge mouth,
  // Syb 1.80 m off the Rope House, Bel 2.57 m from the crates by the wagon.''')

sub('{ id: "coldbrace_prop_gate_crate_1", assetId: "crate_village", position: [-164.6, -99.4], rotationY: 0.6, solid: true },',
    '{ id: "coldbrace_prop_gate_crate_1", assetId: "crate_village", position: [-165.4, -98.2], rotationY: 0.6, solid: true },')

sub('{ id: "coldbrace_prop_gate_barrel", assetId: "barrel", position: [-164.8, -98], rotationY: 0, solid: true },',
    '{ id: "coldbrace_prop_gate_barrel", assetId: "barrel", position: [-163.6, -97.6], rotationY: 0, solid: true },')

sub('{ id: "coldbrace_prop_forge_barrel_s", assetId: "barrel", position: [-149.4, -89.4], rotationY: 0, solid: true },',
    '{ id: "coldbrace_prop_forge_barrel_s", assetId: "barrel", position: [-149.4, -90.2], rotationY: 0, solid: true },')

sub('{ id: "coldbrace_prop_vault_barrel", assetId: "barrel", position: [-165.2, -94.6], rotationY: 0, solid: true },',
    '{ id: "coldbrace_prop_vault_barrel", assetId: "barrel", position: [-165.2, -94.2], rotationY: 0, solid: true },')

sub('{ id: "coldbrace_prop_bank_counter", assetId: "table_large", position: [-162.7, -88.5], rotationY: Math.PI / 2, solid: true },',
    '{ id: "coldbrace_prop_bank_counter", assetId: "table_large", position: [-163.6, -87.8], rotationY: Math.PI / 2, solid: true },')

sub('{ id: "coldbrace_prop_bank_lamp", assetId: "lamp_wall", position: [-164.25, -90.4], rotationY: Math.PI / 2, dy: 1.4 },',
    '{ id: "coldbrace_prop_bank_lamp", assetId: "lamp_wall", position: [-164.2, -89], rotationY: Math.PI / 2, dy: 1.4 },')

sub('''    // ---- The bank counter. `table_large` is 2.85 x 1.10 and solid: the player deals over it and
    // walks round its south end to the chest.''',
    '''    // ---- The bank counter, in the porch's middle bay with the chest in the south bay beside it.
    // `table_large` is 2.85 x 1.10 and solid: the player deals over it, and the 0.54 m between its
    // south end and the chest is what stops either of them boxing the other in.''')

sub('''    // The back-lane fence between the Rope House and the Old Surveyor's House.''',
    '''    // The drovers' lane between houses 3 and 4. Houses 2, 4 and 7 open onto lanes rather than
    // pavement - measured doorstep to nearest paving 5.8 / 7.7 / 5.0 m - which is what a back lane
    // in a village is, so the lanes get dressed rather than paved.
    { id: "coldbrace_prop_lane_crate", assetId: "crate_wood", position: [-145.6, -101], rotationY: 0.7, solid: true },
    { id: "coldbrace_prop_lane_barrel", assetId: "barrel", position: [-145.4, -102.6], rotationY: 0, solid: true },
    { id: "coldbrace_prop_lane_fence_1", assetId: "fence_wood_single", position: [-145, -99.5], rotationY: 0 },
    { id: "coldbrace_prop_lane_fence_2", assetId: "fence_wood_single", position: [-143, -99.5], rotationY: 0 },
    { id: "coldbrace_prop_lane_sack", assetId: "sack", position: [-177.4, -81.6], rotationY: 0.5 },
    // The back-lane fence between the Rope House and the Old Surveyor's House.''')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
