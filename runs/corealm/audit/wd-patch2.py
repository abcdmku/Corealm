import io

p = 'game/src/render/buildings.ts'
s = io.open(p, encoding='utf-8').read()

# ---------------------------------------------------------------- farmstead prefab
anchor = '/**\n * How a gatehouse of a given footprint width divides into two piers'
assert anchor in s

farmstead = r'''/**
 * A barn. One tall storey of solid wall under the kit's LARGE roof, cart doors on the entry face,
 * and the yard clutter a working farm leaves outside them.
 *
 * WHY IT EXISTS. `marchfield_farm`'s stated shot intent is "plots, fence, and a building that reads
 * as a farmstead" and the library ships no farm building at all - the asset report's gap 5. What it
 * does ship is the same modular kit every other building here is made of, so a barn is a `hall`
 * plan (long roof, one storey) with the hall's civic dressing taken off and a cart, crates, sacks
 * and a fodder barrel put in front of the doors instead. `roofLarge` rather than `roofSmall` is the
 * whole read: at a [10,6] footprint the plaster kit draws a 13.7 m ridge over a 10 m building,
 * which is a barn silhouette and not a cottage one.
 *
 * The door is on side 2, which is LOCAL -Z, exactly like `cottage`, `hall`, `shed` and
 * `quarry_hut`, so a settlement author points a farmstead at a yard with the same `rotationY` they
 * would use for a house. (The open-fronted prefabs - `forge`, `porch`, `arcade` - use +Z for their
 * mouth instead, which is the file's one standing inconsistency and is not mine to change here.)
 *
 * Windows are seeded at 0.3 and go through `ringWindows`, so no window ever faces the cart doors:
 * a barn is the deepest building in the settlement and a hole straight through it would be seen
 * from further away than any cottage's.
 */
function farmstead(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  const windows = ringWindows(sides, rng, 0.3, (s, index) => s === 2 && index === doorIndex);
  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      const assetId = isDoor
        ? kit.wallDoor
        : windows[s]![index] === true ? kit.wallWindow : kit.wall;
      wallModule(out, `${s}_${index}`, assetId, side, count, index, kit);
    }
    jointStuds(out, `j${s}_`, side, count, kit);
  }
  corners(out, width, depth, kit.corner, 0, 1, "c");

  const roof = largeRoof(kit, width, depth);
  out.push(loose("roof", kit.roofLarge, 0, STOREY_METRES, 0, roof.rotationY, roof.scale));
  addRoofline(out, width, depth, roof, kit);
  out.push(part("door", kit.door, onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET), entry.yaw));
  out.push(part("lamp", "lamp_wall", onSide(entry, entryCount, doorIndex, 2.1, 0.08, 1.35), entry.yaw, 1.15));

  // The yard side. Everything here sits OUTSIDE the footprint, so it is outside the prefab's own
  // collision box and stays walk-through dressing, the same way `shed` puts its crate at
  // -depth / 2 - 0.65. The door module is the middle of the entry face, so the load is stacked to
  // one side of it and the cart is parked at the far corner rather than across the threshold.
  const front = -depth / 2;
  const load = width * 0.3;
  // `wagon` is 1.95 x 1.53 x 4.02 with its bed running along local Z, so a quarter turn lays it
  // along the front of the barn instead of pointing at the doors.
  out.push(loose("wagon", "wagon", -width / 2 + 1.2, 0, front - 2.4, Math.PI / 2 + rng.float(-0.12, 0.12), 1));
  out.push(loose("crate", "crate_village", load, 0, front - 1.0, rng.float(0, Math.PI)));
  out.push(loose("crate_apple", "farm_crate_apple", load + 0.95, 0, front - 1.5, rng.float(0, Math.PI)));
  out.push(loose("crate_carrot", "farm_crate_carrot", load - 0.85, 0, front - 1.7, rng.float(0, Math.PI)));
  out.push(loose("sack_l", "sack", load - 0.2, 0, front - 2.3, rng.float(0, Math.PI)));
  out.push(loose("sack_r", "sack", load + 0.5, 0, front - 2.5, rng.float(0, Math.PI)));
  out.push(loose("barrel", "barrel", -width / 2 + 0.55, 0, front - 0.75, rng.float(0, Math.PI)));
  // Two panels of the same fence the yard uses, running off each gable end, so the barn reads as
  // part of an enclosure even when it is placed on its own.
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(
      `fence${index}`, "fence_wood_single",
      (width / 2 + 1.03) * sx, -0.1, front + 0.4, 0,
    ));
  }

  return out;
}

'''

s = s.replace(anchor, farmstead + anchor, 1)

# ---------------------------------------------------------------- farm_yard composition
anchor2 = '// -------------------------------------------------------------- collision'
assert anchor2 in s

farmyard = r'''/**
 * A whole farmstead as ONE placeable composition: a paddock fence, a barn at the back of it, and
 * the yard between them.
 *
 * This is the answer to `marchfield_farm`, which is six crop frames on open grass. Marchfield is a
 * resource cluster, not a settlement, so `RegionDef.settlement.buildings` cannot reach it and the
 * only hook the content layer has there is a landmark with a `composition`. A composition that
 * emits only dressing would still leave the farm without a farm, so this one emits the barn too,
 * through `buildPrefab("farmstead", ...)` rotated half a turn so its cart doors face the yard.
 *
 * SIZED TO THE GROUND IT STANDS ON, measured at Marchfield (-96, -22) with
 * `__gameDebug.groundHeight`: dead level out to 4 m, +-0.21 m at 8 m, and -0.62..+1.26 m at 12 m.
 * `emitParts` places every part at `origin.y + dy` with no terrain sample of its own, so a 12 m
 * enclosure would float one corner by 0.6 m and bury the opposite one to the top rail. The ring is
 * therefore radius 7.9 m - 24 panels of `fence_wood_single`, whose 2.064 m length is within 0.01 m
 * of the arc it has to cover at that radius - and the barn sits at local z -6.4, on the one bearing
 * that measures +-0.06 m at 12 m. Every part is inside 9.1 m of the origin.
 *
 * The six Marchfield plots reach 6.55 m from the cluster centre, so they all fall inside the ring
 * with the barn clear of the nearest by 0.5 m. Local +Z is the way in: five panels are left out
 * there for a 10 m gate, and three more behind, where the barn closes the ring itself.
 */
function farmYard(rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const panels = 24;
  const radius = 7.9;
  // Left out: the gate on local +Z, and the run the barn stands in.
  const gate = new Set([5, 6, 7, 17, 18, 19]);
  for (let index = 0; index < panels; index += 1) {
    if (gate.has(index)) continue;
    const angle = (index / panels) * Math.PI * 2;
    // A part's rotationY turns its local +X toward (cos, -sin); the tangent at `angle` is
    // (-sin, cos), and -angle - PI/2 is the rotation that lands one on the other.
    out.push(loose(
      `fence${index}`, "fence_wood_single",
      Math.cos(angle) * radius, -0.1, Math.sin(angle) * radius,
      -angle - Math.PI / 2,
    ));
  }
  // Gate posts at the two ends of the +Z opening. `kit.corner` is 3.0-3.02 m tall, so 0.4 is a
  // 1.2 m post: a head taller than the 0.84 m fence and not a fifth of the barn.
  for (const [index, step] of [4, 8].entries()) {
    const angle = (step / panels) * Math.PI * 2;
    out.push(loose(
      `post${index}`, kit.corner,
      Math.cos(angle) * radius, 0, Math.sin(angle) * radius, -angle, 0.4,
    ));
  }

  // The barn, turned to face the yard. (-dx, -dz) with PI added to the yaw is a half turn about the
  // composition origin; the translation then puts its centre at local (0, -6.4).
  for (const placement of buildPrefab("farmstead", [7, 4], rng.int(1, 1_000_000), kit.id)) {
    out.push({
      tag: `barn_${placement.tag}`,
      assetId: placement.assetId,
      dx: r3(-placement.dx),
      dy: placement.dy,
      dz: r3(-placement.dz - 6.4),
      rotationY: r4(placement.rotationY + Math.PI),
      scale: placement.scale,
    });
  }

  // The yard. `training_dummy` is a post with a stuffed body and outstretched arms - the closest
  // thing in the library to the scarecrow the asset report lists as gap 5.
  out.push(loose("scarecrow", "training_dummy", -3.4, 0, 2.6, rng.float(0, Math.PI * 2), 1.15));
  out.push(loose("trough", "barrel_rack", 3.9, 0, -2.2, rng.float(2.9, 3.4), 1.1));
  out.push(loose("yard_crate", "farm_crate_empty", 2.4, 0, -3.4, rng.float(0, Math.PI)));
  out.push(loose("yard_sack", "sack", 1.6, 0, -3.9, rng.float(0, Math.PI)));
  out.push(loose("yard_barrel", "barrel", -2.2, 0, -3.6, rng.float(0, Math.PI)));
  return out;
}

'''

s = s.replace(anchor2, farmyard + anchor2, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
