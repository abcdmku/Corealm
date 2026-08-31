/**
 * Gear the asset library does not contain, BUILT from primitives instead of loaded from a file.
 *
 * This started with the staff line. Measured from game/public/assets/manifest.json the weapon
 * category holds four GLBs — axe, pickaxe, shield, sword — and there is no staff anywhere in the
 * 213-asset library, so `palewood_staff`, `duskoak_staff` and `cairnpine_staff` put NOTHING in the
 * player's hand: a mage held empty air. `worn_staff`, the staff a new character is handed, would
 * have been the fourth, i.e. the very first weapon in the magic line would have been invisible.
 *
 * Why build rather than proxy, and why build rather than buy:
 *   - a sword in a mage's hand misreports what is held, which is why `equipmentVisuals.ts` left the
 *     gap open rather than filling it with the nearest mesh, and the nearest pole-shaped props in
 *     the library read as what they are (`torch` 0.65 m; `candle_stand` 1.31 m standing on a floor
 *     base);
 *   - a staff is a tapered stick, a few rings and a gem. Built here it is 7 to 9 primitives and,
 *     measured on the four looks below, 212 to 344 triangles — with ZERO bytes on the wire, against
 *     the hundreds of KB and the pack-licence work an authored GLB costs. The two other in-repo
 *     answers to "the library has no such mesh" already
 *     went this way: `itemIconAppearances.ts` builds a staff, a ring and an amulet out of
 *     primitives for the icon pipeline, and `entityViews.ts` grows ore seams out of merged
 *     octahedra.
 *
 * ONE MERGED GEOMETRY PER MATERIAL, which is the constraint the rest of the file is written around.
 * Highcairn measures 397 draw calls against a 400 budget, so a staff assembled as a dozen small
 * meshes would spend 3% of the whole frame's call budget on a prop that is 2 cm wide on screen.
 * Merging gives TWO draws: the structure (shaft, bindings, ferrule, prongs or struts) and the gem.
 *
 * Two and not one, deliberately. The gem is the only part that glows and `emissive` is a material
 * uniform, not a vertex attribute, so a single material would cost the glow — and the glow is most
 * of what makes a 4 cm stone read as a magic weapon rather than a knot in the wood. The structure
 * still holds two COLOURS (wood and binding) in one material, carried by a baked `color` attribute
 * exactly the way the library's own weapon GLBs carry their trim (`MI_Trim_Props_Vertex` ships a
 * `COLOR_0`; see the header of `equipmentVisuals.ts`). One material, one draw, two colours.
 *
 * ORIGIN IS AT THE GRIP, and that is load-bearing rather than tidy. `characterRig.socketFor` applies
 * whatever `equipmentVisuals.weaponAttachment` returns to the object it just cloned, and that
 * function is `fistCentre + gripOffset * scale`: every library weapon needs a non-zero `gripOffset`
 * because its GLB origin sits somewhere else (the sword's at the guard, 10 cm off its grip), and
 * that offset has to be re-scaled with the part or the grip floats out past the pinky — measured at
 * the dagger's 0.558 applied scale, 4.4 cm from a fist whose half-span is 3.8 cm. Putting this
 * origin ON the grip makes that offset zero, so the staff sits in the fist at any scale by
 * construction and there is nothing left to get wrong.
 *
 * The staff is authored along +Y and is attached with the sword's rotation, (PI/2, 0, 0), which
 * maps asset +Y to hand-local +Z. That is the axis a closed fist grips along on this rig
 * (base_male.glb, measured in `equipmentVisuals.ts`: index_01_r z +0.041, pinky_01_r z -0.035,
 * finger roots along +Y, so the forearm leaves along -Y). The shaft therefore crosses the palm
 * PERPENDICULAR to the forearm, and the length below the grip — 32% of it, which is where a
 * two-handed grip actually sits — extends out past the pinky rather than through the arm.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface StaffLook {
  /** Shaft albedo. Literal, not a multiply — see the palette block below. */
  shaft: number;
  /** Grip rings and butt ferrule. Cord, hide or metal depending on the tier. */
  binding: number;
  /** Gem albedo. */
  gem: number;
  /** Gem emissive colour. The intensity is shared; brightness lives in this hex. */
  gemEmissive: number;
  /**
   * Shaft length in metres, butt to the base of the crown. The whole silhouette ladder is carried
   * here. The crown adds 12-19 cm on top, so overall height measures 1.44 m for the worn staff and
   * 1.85 m for the cairnpine one.
   */
  length: number;
  crown: "chip" | "cage" | "cluster";
}

/** A shorter one-handed magic weapon built from the same wood and gem palette as its staff. */
export interface WandLook {
  shaft: number;
  binding: number;
  gem: number;
  gemEmissive: number;
  /** Total shaft length in metres. The origin remains at the grip. */
  length: number;
}

/** A held fishing tool with its line and bobber baked into one painted mesh. */
export interface FishingRodLook {
  shaft: number;
  binding: number;
  line: number;
  bobber: number;
  /** Butt to tip, before the slight authored bend. */
  length: number;
  /** Sideways displacement of the tip in metres. */
  bend: number;
}

// ------------------------------------------------------------------------ palette

/**
 * ## These hexes are LITERAL albedo, which is not what the same numbers mean next door
 *
 * `equipmentVisuals.ts`'s tints are multipliers: every asset in that ladder is textured AND
 * vertex-coloured, so `MeshStandardMaterial.color` lands at roughly `texture * tint` and can only
 * darken. Nothing built here has a texture, so the same constant lands at its own face value —
 * always LIGHTER than the character part it is named after. That is why the numbers below are
 * re-derived rather than imported.
 *
 * Re-derived, not imported, for a second and harder reason: `equipmentVisuals.ts` imports the staff
 * asset ids from this file, so importing its tint constants back would close a module cycle, and
 * both `STAFF_LOOKS` here and `GEAR_VISUALS` there are built at module scope — whichever module
 * loaded second would read the other's constants in the temporal dead zone and throw. One direction
 * only: equipmentVisuals -> proceduralGear.
 *
 * WOOD comes from `itemIconAppearances.ts`'s private `WOOD` table (0: 0x66503c, 1: 0xb18b62,
 * 5: 0x604734, 10: 0x7a6046), which is already the authored colour of each of these four woods.
 * Matching it means the icon in the Worn panel and the mesh in the hand are the same stick, which
 * is a property a player can actually check. That table is module-private and in a file this worker
 * does not own, so it is re-stated here; if it ever moves, these follow.
 *
 * GEMS are `equipmentVisuals.ts`'s three off-hand stones, QUARTZ 0xd8d4cc / AMBER 0xc98a2a /
 * GARNET 0x7a1a2c. They land within a few percent of the icon pipeline's own gem colours
 * (pale_quartz 0xe3ded2, vell_amber 0xc47b2b, cairn_garnet 0x8e2337) and `content/recipes.ts`
 * fletches each staff from exactly that gem, so the stone on the staff is the stone that was spent.
 *
 * BINDINGS climb twine -> hide -> Corven steel -> Kaldite, using MARCHHIDE 0x8a6a4a, CORVEN
 * 0x5a6b7c and KALDITE 0x24222a from the same file. Tier 0 gets an authored cord instead of a metal
 * band: WORN 0x6f6257 against WORN_WOOD 0x66503c is 12.8% relative luminance against 8.9%, which is
 * not a separation at 3 cm and 12 m, and a stick the player found would be whipped with twine
 * anyway. Every other pair separates by at least 1.8x (palewood 28.7% / 16.2%, duskoak 7.2% /
 * 14.1%, cairnpine 12.9% / 1.7%).
 */
const WORN_WOOD = 0x66503c;
const PALEWOOD = 0xb18b62;
const DUSKOAK = 0x604734;
const CAIRNPINE = 0x7a6046;

const CORD = 0x3f382f;
const MARCHHIDE = 0x8a6a4a;
const CORVEN = 0x5a6b7c;
const KALDITE = 0x24222a;

const QUARTZ = 0xd8d4cc;
/** QUARTZ at 0.66 value: a chipped, clouded tier-0 chip must not outshine the tier-10 stone. */
const QUARTZ_DULL = 0x8f8c87;
const AMBER = 0xc98a2a;
const GARNET = 0x7a1a2c;

/**
 * Emissive strength, shared by all four gems.
 *
 * NOT the 0.15 that `equipmentVisuals.applyGearAppearance` uses for Kaldite's garnet accent. That
 * number is low because it is a UNIFORM lift over an entire suit of plate, where anything past ~0.3
 * turns the armour into a light source. This one covers a single stone a few centimetres across, so
 * the same value is invisible at gameplay distance.
 *
 * It also has to do work the albedo cannot. GARNET 0x7a1a2c is 5.1% relative luminance against the
 * cairnpine shaft's 12.9%: on albedo alone the tier-10 gem would be the DIMMEST thing on the
 * tier-10 staff. Emissive does not scale with the light, so it is also the only channel that keeps
 * the gem legible where a caster actually stands — in fog, indoors, and at the 40% haze this world
 * puts on anything 120 m out.
 */
const GEM_EMISSIVE_INTENSITY = 0.45;

// ------------------------------------------------------------------------ proportions

/**
 * 8 radial segments, everywhere.
 *
 * The shaft is 4.4-6.0 cm across. At the default camera pitch and distance that is a couple of
 * pixels wide, where the silhouette of an 8-gon and of a 32-gon are the same silhouette, and 8 is
 * what keeps a whole staff inside 212-344 triangles. The crown rings and struts use the same count
 * on purpose: a 6-sided ring against an 8-sided shaft shows its own facet count at the joint.
 */
const RADIAL_SEGMENTS = 8;
/** Tapered like a real cut pole: thinner at the tip than at the butt. */
const SHAFT_TIP_RADIUS = 0.022;
const SHAFT_BUTT_RADIUS = 0.030;
/** How far up the staff the hand sits, as a fraction of `length`. See the origin note in the header. */
const GRIP_FRACTION = 0.32;
/** Rings stand this far proud of the shaft, so they read as a wrap rather than as a colour band. */
const BINDING_PROUD = 0.006;
const BINDING_HEIGHT = 0.032;
/**
 * Where the two grip rings sit, in metres from the origin — ABSOLUTE, not a fraction of `length`.
 * They mark where the hand goes, and a hand is the same size on a 1.32 m staff and a 1.74 m one.
 */
const BINDING_OFFSETS: readonly number[] = [0.105, -0.085];
const FERRULE_HEIGHT = 0.055;

// ------------------------------------------------------------------------ the looks

/**
 * Keyed by item id, because the caller has an item and the asset id is derived from it
 * (`staffAssetId`).
 *
 * Length is the ladder. The melee line grows through `tierSilhouetteScale`, which scales one shared
 * sword GLB — it has no other lever. This line can be BUILT longer, which is the better signal: a
 * Cairnpine staff should be a longer staff, not a fatter one, and scaling the mesh would thicken
 * the shaft and the gem along with it. Steps are +12.1%, +8.1% and +8.8%, all inside the PRD's 20%
 * ceiling per authored step that `core/math.ts tierSilhouetteScale` is also built against, and the
 * 42 cm spread from end to end is a silhouette difference at gameplay distance.
 *
 * Crowns escalate in the same order the wave's other layers do: one wedged chip, then a caged
 * stone, then a cluster. `worn_staff` and `palewood_staff` share the "chip" crown because they are
 * one tier apart and the wood, the binding and 16 cm of length already separate them.
 */
export const STAFF_LOOKS: Readonly<Record<string, StaffLook>> = {
  worn_staff: {
    shaft: WORN_WOOD, binding: CORD, gem: QUARTZ_DULL, gemEmissive: 0x3a3630,
    length: 1.32, crown: "chip",
  },
  palewood_staff: {
    shaft: PALEWOOD, binding: MARCHHIDE, gem: QUARTZ, gemEmissive: 0x9ab0cc,
    length: 1.48, crown: "chip",
  },
  duskoak_staff: {
    shaft: DUSKOAK, binding: CORVEN, gem: AMBER, gemEmissive: 0xd08a20,
    length: 1.60, crown: "cage",
  },
  cairnpine_staff: {
    shaft: CAIRNPINE, binding: KALDITE, gem: GARNET, gemEmissive: 0xc4304a,
    length: 1.74, crown: "cluster",
  },
};

/**
 * Wands use the same material progression as their matching staffs. Their shorter shaft and single
 * grip ring keep the silhouette separate even when both weapons use the same gem.
 */
export const WAND_LOOKS: Readonly<Record<string, WandLook>> = {
  palewood_wand: {
    shaft: PALEWOOD, binding: MARCHHIDE, gem: QUARTZ, gemEmissive: 0x9ab0cc,
    length: 0.56,
  },
  duskoak_wand: {
    shaft: DUSKOAK, binding: CORVEN, gem: AMBER, gemEmissive: 0xd08a20,
    length: 0.62,
  },
  cairnpine_wand: {
    shaft: CAIRNPINE, binding: KALDITE, gem: GARNET, gemEmissive: 0xc4304a,
    length: 0.68,
  },
};

/**
 * Rods grow slightly with tier. The bobber repeats the tier gem color so the upgrade reads after
 * the thin wood shaft recedes against water.
 */
export const FISHING_ROD_LOOKS: Readonly<Record<string, FishingRodLook>> = {
  worn_rod: {
    shaft: WORN_WOOD, binding: CORD, line: 0x39332c, bobber: QUARTZ_DULL,
    length: 1.18, bend: 0.09,
  },
  palewood_rod: {
    shaft: PALEWOOD, binding: MARCHHIDE, line: 0x403a32, bobber: QUARTZ,
    length: 1.30, bend: 0.11,
  },
  duskoak_rod: {
    shaft: DUSKOAK, binding: CORVEN, line: 0x302e2b, bobber: AMBER,
    length: 1.42, bend: 0.13,
  },
  cairnpine_rod: {
    shaft: CAIRNPINE, binding: KALDITE, line: 0x29282a, bobber: GARNET,
    length: 1.54, bend: 0.15,
  },
};

/**
 * The asset id a built staff is registered under.
 *
 * Prefixed so it is obvious at a glance — in a stack trace, in `AssetRegistry.stats()`, in a dump of
 * the scene graph — that this id has no file behind it and no manifest entry to look up.
 * `tests/equipment.test.ts` checks every asset id the appearance table can produce against the
 * manifest; these are the declared exception, which is what `isProceduralGearAsset` is exported for.
 */
export function staffAssetId(itemId: string): string {
  return `proc_staff_${itemId.replace(/_staff$/, "")}`;
}

/** Asset id for one of the three functioning wand items. */
export function wandAssetId(itemId: string): string {
  return `proc_wand_${itemId.replace(/_wand$/, "")}`;
}

/** Asset id for a fishing rod, including its line and bobber. */
export function fishingRodAssetId(itemId: string): string {
  return `proc_rod_${itemId.replace(/_rod$/, "")}`;
}

export interface ProceduralGearAsset {
  /** What `AssetRegistry.load` will answer to. */
  assetId: string;
  /** The equipment or tool item that uses it. */
  itemId: string;
}

/**
 * The original staff-only export stays staff-only because equipmentVisuals and seedMagic use that
 * promise. New procedural families have their own lists below.
 */
export const PROCEDURAL_GEAR_ASSETS: readonly ProceduralGearAsset[] =
  Object.keys(STAFF_LOOKS).map((itemId) => ({ assetId: staffAssetId(itemId), itemId }));

export const PROCEDURAL_WAND_ASSETS: readonly ProceduralGearAsset[] =
  Object.keys(WAND_LOOKS).map((itemId) => ({ assetId: wandAssetId(itemId), itemId }));

export const PROCEDURAL_FISHING_ROD_ASSETS: readonly ProceduralGearAsset[] =
  Object.keys(FISHING_ROD_LOOKS).map((itemId) => ({ assetId: fishingRodAssetId(itemId), itemId }));

/** Every generated held asset registered during boot. */
export const ALL_PROCEDURAL_GEAR_ASSETS: readonly ProceduralGearAsset[] = [
  ...PROCEDURAL_GEAR_ASSETS,
  ...PROCEDURAL_WAND_ASSETS,
  ...PROCEDURAL_FISHING_ROD_ASSETS,
];

const PROCEDURAL_ASSET_IDS = new Set(ALL_PROCEDURAL_GEAR_ASSETS.map((asset) => asset.assetId));

/** True for an asset id that is built here, so it will never appear in the generated manifest. */
export function isProceduralGearAsset(assetId: string): boolean {
  return PROCEDURAL_ASSET_IDS.has(assetId);
}

/**
 * Picks the authored rod that matches a resource tier. The worn rod is the safe fallback when the
 * activity input has no tier yet.
 */
export function fishingRodItemForTier(tier: number | null | undefined): string {
  if (tier !== null && tier !== undefined && tier >= 10) return "cairnpine_rod";
  if (tier !== null && tier !== undefined && tier >= 5) return "duskoak_rod";
  if (tier !== null && tier !== undefined && tier >= 1) return "palewood_rod";
  return "worn_rod";
}

/**
 * The half of `AssetRegistry` this file needs, as a port.
 *
 * A structural interface rather than the class, for the same reason `characterRig.ts` declares
 * `GearVisualsPort`: it lets a test or a tool register into a two-line stub without standing up a
 * GLTFLoader and a manifest fetch. `AssetRegistry` satisfies it with no adapter.
 */
export interface BuiltAssetSink {
  registerBuilt(id: string, group: THREE.Group): void;
}

/**
 * Builds every procedural asset and registers it. Call once, at boot, BEFORE the player rig is
 * built — `CharacterRig.preloadGear` warms gear assets during `build()` and `attachBoneSlot` goes
 * through `AssetRegistry.load`, which is where these have to already be.
 *
 * Returns the ids it registered, so the caller can log or assert on them. The eleven current items
 * total 18 meshes and 2,668 triangles, with no file fetch or parse on the boot path.
 */
export function registerProceduralGear(sink: BuiltAssetSink): readonly string[] {
  const registered: string[] = [];
  for (const [itemId, look] of Object.entries(STAFF_LOOKS)) {
    const assetId = staffAssetId(itemId);
    sink.registerBuilt(assetId, buildStaff(look));
    registered.push(assetId);
  }
  for (const [itemId, look] of Object.entries(WAND_LOOKS)) {
    const assetId = wandAssetId(itemId);
    sink.registerBuilt(assetId, buildWand(look));
    registered.push(assetId);
  }
  for (const [itemId, look] of Object.entries(FISHING_ROD_LOOKS)) {
    const assetId = fishingRodAssetId(itemId);
    sink.registerBuilt(assetId, buildFishingRod(look));
    registered.push(assetId);
  }
  return registered;
}

// ------------------------------------------------------------------------ construction

/**
 * A staff, in metres, Y-up, origin at the grip.
 *
 * The returned group holds exactly two meshes, and nothing here is disposed for you: these live for
 * the session inside `AssetRegistry`, and `characterRig.attachBoneSlot` clones the group per equip,
 * which in Three shares both the geometry and the material rather than copying them.
 * `applyGearAppearance` is never called on a staff — its appearance deliberately carries no tint and
 * no accent, because the colour is already in the mesh — so nothing is cloned or repainted per
 * player either.
 */
export function buildStaff(look: StaffLook): THREE.Group {
  const tipY = look.length * (1 - GRIP_FRACTION);
  const buttY = -look.length * GRIP_FRACTION;
  const structure: THREE.BufferGeometry[] = [];
  const gems: THREE.BufferGeometry[] = [];

  const shaft = new THREE.CylinderGeometry(
    SHAFT_TIP_RADIUS, SHAFT_BUTT_RADIUS, look.length, RADIAL_SEGMENTS,
  );
  shaft.translate(0, (tipY + buttY) / 2, 0);
  structure.push(paint(shaft, look.shaft));

  for (const offset of BINDING_OFFSETS) {
    const radius = shaftRadiusAt(look, offset) + BINDING_PROUD;
    structure.push(paint(tube(radius, radius, BINDING_HEIGHT, offset), look.binding));
  }

  // The butt ferrule. Every look gets one: it is what "cairnpine with a Kaldite ferrule" names, it
  // keeps the geometry table uniform across the four, and it stops the shaft ending in a bare
  // 8-sided cap that flashes as a flat disc when the staff swings through the key light.
  const ferrule = tube(
    SHAFT_BUTT_RADIUS + 0.004, SHAFT_BUTT_RADIUS + 0.001, FERRULE_HEIGHT, buttY + FERRULE_HEIGHT / 2,
  );
  structure.push(paint(ferrule, look.binding));

  buildCrown(look, tipY, structure, gems);

  const group = new THREE.Group();
  group.name = "procedural-staff";
  group.add(mergedMesh(structure, structureMaterial(), "staff-structure"));
  group.add(mergedMesh(gems, gemMaterial(look), "staff-gem"));
  return group;
}

/**
 * A one-handed wand in metres, Y-up, with its origin at the grip. The whole model stays at two
 * draws: painted wood and binding in one merged mesh, then the emissive gem.
 */
export function buildWand(look: WandLook): THREE.Group {
  const gripFraction = 0.23;
  const tipY = look.length * (1 - gripFraction);
  const buttY = -look.length * gripFraction;
  const structure: THREE.BufferGeometry[] = [];
  const gems: THREE.BufferGeometry[] = [];

  const shaft = new THREE.CylinderGeometry(0.012, 0.019, look.length, RADIAL_SEGMENTS);
  shaft.translate(0, (tipY + buttY) / 2, 0);
  structure.push(paint(shaft, look.shaft));

  structure.push(paint(tube(0.023, 0.023, 0.036, -0.055), look.binding));
  structure.push(paint(tube(0.021, 0.019, 0.035, buttY + 0.0175), look.binding));

  // Three short claws make the gem read as mounted rather than glued to the cut end.
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2;
    const claw = new THREE.CylinderGeometry(0.004, 0.007, 0.072, 5);
    claw.translate(0, 0.036, 0);
    claw.rotateZ(0.20);
    claw.rotateY(angle);
    claw.translate(0, tipY - 0.008, 0);
    structure.push(paint(claw, look.binding));
  }
  gems.push(gem(0.031, 0, tipY + 0.050, 0));

  const group = new THREE.Group();
  group.name = "procedural-wand";
  group.add(mergedMesh(structure, structureMaterial("proc-wand-structure"), "wand-structure"));
  group.add(mergedMesh(gems, gemMaterial(look), "wand-gem"));
  return group;
}

/**
 * A rod, bowed line, and bobber in one vertex-painted mesh. The line is four-sided geometry rather
 * than a Three Line object, so the complete tool remains one draw and keeps a stable pixel width.
 */
export function buildFishingRod(look: FishingRodLook): THREE.Group {
  const buttY = -look.length * 0.18;
  const tipY = look.length * 0.82;
  const structure: THREE.BufferGeometry[] = [];
  const rodPoints = [
    new THREE.Vector3(0, buttY, 0),
    new THREE.Vector3(look.bend * 0.12, look.length * 0.14, 0),
    new THREE.Vector3(look.bend * 0.42, look.length * 0.48, 0),
    new THREE.Vector3(look.bend, tipY, 0),
  ];
  const radii = [0.020, 0.017, 0.012, 0.006];
  for (let index = 0; index < rodPoints.length - 1; index += 1) {
    const start = rodPoints[index];
    const end = rodPoints[index + 1];
    if (!start || !end) continue;
    structure.push(paint(
      segmentBetween(start, end, radii[index + 1] ?? 0.006, radii[index] ?? 0.020),
      look.shaft,
    ));
  }

  structure.push(paint(tube(0.024, 0.024, 0.035, -0.070), look.binding));
  structure.push(paint(tube(0.022, 0.022, 0.030, 0.045), look.binding));

  const tip = rodPoints[rodPoints.length - 1] ?? new THREE.Vector3(look.bend, tipY, 0);
  const linePoints = [
    tip.clone(),
    new THREE.Vector3(tip.x + 0.015, tip.y + 0.15, 0.16),
    new THREE.Vector3(tip.x + 0.010, tip.y + 0.29, 0.37),
    new THREE.Vector3(tip.x, tip.y + 0.34, 0.54),
  ];
  for (let index = 0; index < linePoints.length - 1; index += 1) {
    const start = linePoints[index];
    const end = linePoints[index + 1];
    if (!start || !end) continue;
    structure.push(paint(segmentBetween(start, end, 0.0024, 0.0024, 4), look.line));
  }

  const bobberPosition = linePoints[linePoints.length - 1] ?? tip;
  const bobber = new THREE.IcosahedronGeometry(0.035, 1);
  bobber.scale(0.82, 1.15, 0.82);
  bobber.translate(bobberPosition.x, bobberPosition.y, bobberPosition.z);
  structure.push(paint(bobber, look.bobber));

  const group = new THREE.Group();
  group.name = "procedural-fishing-rod";
  group.add(mergedMesh(structure, structureMaterial("proc-rod-painted"), "rod-line-bobber"));
  return group;
}

/**
 * The three crowns.
 *
 * Every gem is an `IcosahedronGeometry` at detail 0, which reads faceted for free: three's
 * `PolyhedronGeometry` (PolyhedronGeometry.js:66-68) calls `computeVertexNormals()` on a
 * non-indexed buffer at detail 0 and `normalizeNormals()` above it, so detail 0 already carries
 * FLAT per-face normals. That saves `flatShading: true`, which would otherwise force a second gem
 * material — the flag is a program-level define and a merged geometry cannot carry it per part.
 */
function buildCrown(
  look: StaffLook,
  tipY: number,
  structure: THREE.BufferGeometry[],
  gems: THREE.BufferGeometry[],
): void {
  if (look.crown === "chip") {
    // A split top: two prongs leaning apart with the stone wedged between them. At the gem's own
    // height the prong axes are 5.1 cm apart and the gem is 7.2 cm across, so they bite into it
    // rather than framing it politely — that overlap is what reads as wedged instead of balanced.
    const prongLength = 0.13;
    for (const side of [-1, 1]) {
      const prong = new THREE.CylinderGeometry(0.009, 0.016, prongLength, RADIAL_SEGMENTS);
      prong.translate(0, prongLength / 2, 0);
      prong.rotateZ(side * 0.2);
      prong.translate(side * 0.008, tipY - 0.005, 0);
      structure.push(paint(prong, look.shaft));
    }
    gems.push(gem(0.036, 0, tipY + prongLength * 0.62, 0));
    return;
  }

  if (look.crown === "cage") {
    // Three struts splay out and a ring closes them into a cup; the stone sits IN the cup, with its
    // lower quarter below the ring plane. Straight struts cannot curve back over a gem, and bending
    // each one into two segments would double the crown's triangles for a shape nobody can resolve
    // at this size, so the ring does the closing instead.
    // 0.155, not 0.19. The crown's reach is added ON TOP of `length`, and at 0.19 the cage put a
    // tier-5 duskoak staff at 1.854 m against a tier-10 cairnpine's 1.851 m — measured over the
    // built geometry — so the ladder INVERTED at the one step where the silhouette is supposed to
    // pay off. `tests/equipment.test.ts` now pins the built heights so it cannot invert again.
    const strutLength = 0.155;
    const lean = 0.18;
    for (let index = 0; index < 3; index += 1) {
      const strut = new THREE.CylinderGeometry(0.007, 0.011, strutLength, RADIAL_SEGMENTS);
      strut.translate(0, strutLength / 2, 0);
      strut.rotateZ(lean);
      strut.rotateY((index / 3) * Math.PI * 2);
      strut.translate(0, tipY - 0.005, 0);
      structure.push(paint(strut, look.binding));
    }
    const ringY = tipY + strutLength * Math.cos(lean);
    const ring = new THREE.TorusGeometry(strutLength * Math.sin(lean), 0.006, 5, 10);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, ringY, 0);
    structure.push(paint(ring, look.binding));
    gems.push(gem(0.048, 0, ringY + 0.026, 0));
    return;
  }

  // Cluster: one large stone and two smaller ones off-axis, on a collar. Three different radii
  // rather than three of one, because three equal stones at this size read as one lumpy stone.
  const collarY = tipY - 0.006;
  const collarRadius = shaftRadiusAt(look, collarY) + BINDING_PROUD;
  structure.push(paint(tube(collarRadius, collarRadius, 0.026, collarY), look.binding));
  // Stacked higher than the first pass, which topped out 11 cm over the shaft against the cage's
  // 26 cm and left the tier-10 staff shorter than the tier-5 one. The three stones still overlap
  // each other and the collar — a cluster has to read as one growth off the head, not as three
  // stones parked in a row.
  gems.push(gem(0.052, 0, tipY + 0.075, 0));
  gems.push(gem(0.034, 0.038, tipY + 0.042, 0.012));
  gems.push(gem(0.026, -0.03, tipY + 0.130, -0.014));
}

/**
 * One faceted stone. The two rotations are keyed off the radius so no two stones in a cluster
 * present the same facet to the camera, and they stay a pure function of the look — the acceptance
 * checks forbid an RNG draw anywhere in this wave's render path.
 */
function gem(radius: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, 0);
  geometry.rotateY(radius * 21);
  geometry.rotateZ(radius * 13);
  geometry.translate(x, y, z);
  return geometry;
}

/** A ring or a ferrule: a short cylinder centred on `centreY`. */
function tube(
  topRadius: number,
  bottomRadius: number,
  height: number,
  centreY: number,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, height, RADIAL_SEGMENTS);
  geometry.translate(0, centreY, 0);
  return geometry;
}

/** A low-sided cylinder aligned between two points. */
function segmentBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  topRadius: number,
  bottomRadius: number,
  radialSegments = RADIAL_SEGMENTS,
): THREE.BufferGeometry {
  const delta = end.clone().sub(start);
  const length = delta.length();
  const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, length, radialSegments);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  geometry.applyQuaternion(rotation);
  geometry.translate(
    (start.x + end.x) / 2,
    (start.y + end.y) / 2,
    (start.z + end.z) / 2,
  );
  return geometry;
}

/** The tapered shaft's radius at a height, so a ring fits the shaft it is wrapped around. */
function shaftRadiusAt(look: StaffLook, y: number): number {
  const buttY = -look.length * GRIP_FRACTION;
  const along = Math.min(1, Math.max(0, (y - buttY) / look.length));
  return SHAFT_BUTT_RADIUS + (SHAFT_TIP_RADIUS - SHAFT_BUTT_RADIUS) * along;
}

/**
 * Bakes a flat colour into a `color` attribute and hands back a geometry ready to merge.
 *
 * De-indexes first, and that is not cosmetic: `mergeGeometries` reads `geometries[0].index` and
 * REFUSES the whole merge — console error, returns null — the moment one input disagrees
 * (BufferGeometryUtils.js:135 and :156). Cylinders and tori are indexed, icosahedra are not, so a
 * mixed list is one edit away at all times. Normalising here makes that impossible rather than
 * merely unlikely, and the bill is 44 duplicated vertices per cylinder (52 -> 96, measured): 264 on
 * a whole chip-crowned staff, which is 5 KB.
 *
 * `THREE.Color` decodes the hex from sRGB into the linear working space, which is exactly what
 * `MeshStandardMaterial.color` does with the same number. Writing the raw 0-255 channels in here
 * instead would put the wood two stops too bright, which is the classic version of this bug.
 */
function paint(geometry: THREE.BufferGeometry, colour: number): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const position = flat.attributes["position"];
  if (!position) throw new Error("proceduralGear: geometry has no position attribute");

  const linear = new THREE.Color(colour);
  const channels = new Float32Array(position.count * 3);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    channels[vertex * 3] = linear.r;
    channels[vertex * 3 + 1] = linear.g;
    channels[vertex * 3 + 2] = linear.b;
  }
  flat.setAttribute("color", new THREE.Float32BufferAttribute(channels, 3));
  return flat;
}

function mergedMesh(
  parts: readonly THREE.BufferGeometry[],
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const merged = mergeGeometries([...parts], false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`proceduralGear: ${name} parts did not merge`);
  // Merged geometry carries no bounds. Three would compute them lazily on the first frustum test,
  // which is a mid-frame cost; this runs once, at boot.
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  return mesh;
}

/**
 * Wood and binding in one material, separated by the baked `color` attribute.
 *
 * One roughness and one metalness for both, which is the price of the single draw call: a ferrule
 * cannot be metalness 0.6 while the shaft it is wrapped around is 0. It reads as metal from its
 * cool hue and from standing 6 mm proud of the shaft, not from the BRDF, and splitting it out would
 * DOUBLE a held staff's draw calls for one 3 cm ring against a 397/400 budget.
 */
function structureMaterial(name = "proc-staff-structure"): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.74,
    metalness: 0.08,
  });
}

function gemMaterial(look: Pick<StaffLook, "gem" | "gemEmissive">): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: "proc-staff-gem",
    color: look.gem,
    emissive: look.gemEmissive,
    emissiveIntensity: GEM_EMISSIVE_INTENSITY,
    roughness: 0.24,
    metalness: 0,
  });
}
