import io
p = 'game/src/content/settlements/coldbrace.ts'
s = io.open(p, encoding='utf-8').read()


def sub(a, b):
    global s
    assert a in s, a[:90]
    s = s.replace(a, b, 1)


# Both stations move to the forge's back wall so the whole front half of the interior stays open.
sub('{ id: "coldbrace_furnace", name: "Coldbrace Furnace", kind: "furnace", skill: "smithing", position: [-144.8, -87.2], rotationY: -Math.PI / 2, assetId: "cauldron", scale: 1.6, recipeIds: [], attachedTo: "coldbrace_forge_shed" },',
    '{ id: "coldbrace_furnace", name: "Coldbrace Furnace", kind: "furnace", skill: "smithing", position: [-144.6, -87], rotationY: -Math.PI / 2, assetId: "cauldron", scale: 1.6, recipeIds: [], attachedTo: "coldbrace_forge_shed" },')

sub('{ id: "coldbrace_anvil", name: "Coldbrace Anvil", kind: "anvil", skill: "smithing", position: [-146.6, -85.6], rotationY: -Math.PI / 2, assetId: "anvil", scale: 1.4, recipeIds: [], attachedTo: "coldbrace_forge_shed" },',
    '{ id: "coldbrace_anvil", name: "Coldbrace Anvil", kind: "anvil", skill: "smithing", position: [-144.8, -84.6], rotationY: -Math.PI / 2, assetId: "anvil", scale: 1.4, recipeIds: [], attachedTo: "coldbrace_forge_shed" },')

sub('''    // Inside the forge, against the back wall. The forge's three collision boxes leave a
    // 4.4 x 4.8 m interior, open along its whole 4.4 m west mouth. `cauldron` at 1.6 draws
    // 1.58 x 1.51 m, keeping 0.41 m to the back wall and 0.44 m to the side wall and leaving a
    // 2.4 x 1.95 m pocket of floor in front of it - 1.5 x 1.05 m after the navmesh erodes 0.45 m
    // per side, so the floor survives and is reachable straight in through the mouth. A player
    // standing in it at (-146.5,-86.9) is 1.72 m from this and 1.30 m from the anvil, so one stand
    // serves both inside `INTERACT_RANGE` 2.4 m. gate-check's smithing line and the Cold Iron
    // quest both walk `moveTo({ entityId })` to these two ids, so this is load-bearing.''',
    '''    // Both smithing stations stand along the forge's back wall, and the front half of the
    // interior is kept clear, because the navmesh erodes 0.45 m per side and a 0.5 m object
    // therefore blocks 1.4 m of floor. The first arrangement of this forge put the anvil mid-floor
    // and `getNavPath` to the furnace came back NULL and to the anvil stopped 3.17 m short - the
    // two stations plus the whetstone had sealed their own doorway. Measured now: the forge's
    // three collision boxes leave an interior of x [-148,-143.6] by z [-88.4,-83.6], the two
    // stations occupy x >= -145.4, and the free floor in front of them is 2.16 x 3.90 m after
    // erosion, connected to the yard by the whole 3.9 m eroded mouth. A player at (-146.4,-85.6)
    // is 1.89 m from the anvil and 2.28 m from the furnace, both inside `INTERACT_RANGE` 2.4 m.
    // gate-check's smithing line and Cold Iron stages 2 and 3 walk `moveTo({ entityId })` to these
    // two ids, so this is load-bearing and is verified by
    // runs/corealm/scenarios/SETC-coldbrace.json, not assumed.''')

# The forge yard clears the mouth: nothing solid inside the 2 m band straight out from the opening.
sub('{ id: "coldbrace_smith", name: "Harrow\'s Metal", shopKind: "smith", position: [-149.6, -87.6], rotationY: -Math.PI / 2, assetId: "market_stall_cart", attachedTo: "coldbrace_forge_shed" },',
    '{ id: "coldbrace_smith", name: "Harrow\'s Metal", shopKind: "smith", position: [-150.6, -89.2], rotationY: -Math.PI / 2, assetId: "market_stall_cart", attachedTo: "coldbrace_forge_shed" },')

sub('''    // 1.6 m in front of the forge mouth, which is where a smith who does not own the forge sells.''',
    '''    // 2.6 m off the forge's south-west corner. `market_stall_cart` is 3.02 x 1.06 m and grows to
    // 3.92 x 1.96 m once the navmesh erodes around it, so parked square in the mouth it walls the
    // forge off; parked here it leaves a 3.19 m eroded corridor into the opening.''')

sub('{ id: "coldbrace_prop_whetstone", assetId: "whetstone", position: [-149.4, -84.4], rotationY: 0.5, solid: true },',
    '{ id: "coldbrace_prop_whetstone", assetId: "whetstone", position: [-150.6, -90.6], rotationY: 0.5, solid: true },')

sub('{ id: "coldbrace_prop_forge_crate", assetId: "crate_metal", position: [-150.6, -83.4], rotationY: 0.9, solid: true },',
    '{ id: "coldbrace_prop_forge_crate", assetId: "crate_metal", position: [-152.4, -83.4], rotationY: 0.9, solid: true },')

sub('''    // ---- The forge yard, on the pavement outside the forge mouth. The rack hangs on the forge's
    // north wall with 0.21 m of clearance.''',
    '''    // ---- The forge yard, on the pavement outside the forge mouth. Everything solid here is kept
    // out of the band z [-86.6,-84.1] straight out from the opening, because that band is the only
    // way into the forge and each of these props eats 0.9 m of navmesh on every side. The rack
    // hangs on the forge's north wall with 0.21 m of clearance and is not solid.''')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
