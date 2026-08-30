/**
 * What worn gear looks like: the 59 equippable ids in `content/equipment.ts` mapped onto the assets
 * that actually exist — and, for the staff line alone, onto one that had to be built — plus the
 * hand sockets and the tier tints.
 *
 * This file exists because the render half of equipment was never written. Measured before this
 * landed: `getSceneStats().totalObjects` read 1077 naked, 1077 in a full tier-10 Kaldite kit and
 * 1077 in a full Wightshroud kit — the player's rig children never changed
 * (runs/corealm/diagnosis/equipment.md, finding 1).
 *
 * THE LIBRARY IS SMALLER THAN THE LADDER, so the mapping is 59 ids onto 2 outfit sets x 6 tints
 * rather than 59 meshes. Measured from game/public/assets/manifest.json: the outfit category holds
 * 20 modular parts in exactly four sets (male/female x peasant/ranger) and the weapon category
 * holds exactly four GLBs — axe, pickaxe, shield, sword. There is no staff, dagger, bow, helm,
 * ring or pendant mesh anywhere in the 213 assets.
 *
 * The consequences of that, decided explicitly rather than papered over:
 *
 *   - Daggers are `weapon/sword` at 0.62 and foci are `weapon/shield` at 0.40. Both read as what
 *     they are at the default camera pitch, and both are the diagnosis's own recommendation.
 *   - The four STAFFS (worn_staff, palewood_staff, duskoak_staff, cairnpine_staff) are the one
 *     place this file stops mapping and starts BUILDING. They rendered nothing for the whole of
 *     Phase 1, and at the time that was the honest answer rather than an oversight: there is no
 *     staff mesh in the library, a sword in a mage's hand is a lie about what the player is
 *     holding, and the nearest pole-shaped props (`torch` 0.65 m, `candle_stand` 1.31 m with a
 *     floor base) read as what they are. What changed is that the magic ladder added `worn_staff`
 *     to the starting inventory, so the gap stopped being a missing nice-to-have at tier 1 and
 *     became the FIRST weapon a caster is ever handed — "the basic staff" would have been an
 *     invisible one on the very character it is given to.
 *
 *     So the mesh is generated instead of loaded. `render/proceduralGear.ts` builds each staff from
 *     a tapered shaft, two grip rings, a butt ferrule and a faceted gem, merges it down to two draw
 *     calls, and `AssetRegistry.registerBuilt` publishes it under a `proc_staff_*` id in the same
 *     cache `load()` reads first. Nothing downstream changed: `characterRig.attachBoneSlot`, the
 *     socket table below and the appearance rows all treat it as any other bone attachment and none
 *     of them knows the difference. Building won on the alternatives' own terms — 7 to 9 primitives
 *     and 212-344 triangles is no download, no pack licence and no draw-call budget worth arguing
 *     about, and unlike a proxy it reports what is actually held. Staff rows deliberately carry no
 *     `tint` and no `accent`: the colour is already in the built material, and
 *     `applyGearAppearance` would flatten the gem to the shaft's colour. (The diagnosis says "6
 *     staffs"; the content table has 4 — 11 mainHand rows are 2 worn, 3 daggers, 3 swords, 3
 *     tiered staffs.)
 *   - Helms borrow the ranger HOOD, the library's only skinned head part (the peasant set has
 *     four parts and no head at all). Rings and pendants stay invisible: accessory1 and
 *     accessory2 are not in `VISIBLE_EQUIP_SLOTS`, because a ring is about a pixel at gameplay
 *     distance and the nearest proxy would cost a draw call to show nothing.
 *
 * TIER READS THROUGH MATERIAL, NOT GEOMETRY. All four weapon GLBs are single-material and tagged
 * `recolour` in the manifest (sword/axe/pickaxe are MI_Trim_Props_Vertex, shield is three trims);
 * every outfit part is MI_Ranger or MI_Peasant. So one tint per line-and-tier plus
 * `tierSilhouetteScale` gives the whole ladder three readable looks per line for the cost of a
 * material clone per attachment. Tinting is done here, on attach, rather than in
 * `render/materials.ts`, so nothing else has to know that equipment exists.
 *
 * Nothing in this file touches game state; it is a pure lookup plus one Three.js material helper.
 */
import * as THREE from "three";
import type { EquipSlot, ItemId } from "../contracts.js";
import { tierSilhouetteScale } from "./materials.js";
// One direction only: this file imports proceduralGear.ts and never the reverse. Both build their
// tables at module scope, so a cycle would leave one of them reading the other's constants in the
// temporal dead zone, and which one would depend on load order. `registerProceduralGear` and
// `isProceduralGearAsset` are therefore imported from there by boot and by the test, not re-exported
// through here.
import { PROCEDURAL_GEAR_ASSETS, staffAssetId } from "./proceduralGear.js";

/** Which base body the parts are resolved against. `boot.ts` builds the player as `base_male`. */
export type CharacterBody = "male" | "female";

export interface GearAppearance {
  assetId: string;
  slot: EquipSlot;
  /**
   * `skin` parts are skinned meshes that must be rebound to the body's skeleton
   * (`render/skinning.ts rebindSkinnedPart`); `bone` parts are rigid meshes parented to a bone with
   * the transform from `weaponSocket`.
   */
  attach: "bone" | "skin";
  tint?: number;
  /**
   * Uniform scale for a `bone` part. Always undefined for `skin` parts: a skinned mesh follows the
   * body's bones, so scaling it detaches the silhouette from the skeleton driving it.
   */
  scale?: number;
  /**
   * Emissive accent, additive to the frozen interface. Kaldite is "black with a garnet accent" and
   * the weapon GLBs carry ONE material, so the accent has nowhere to live except emissive.
   */
  accent?: number;
}

/**
 * Slots the rig can show. `accessory1` / `accessory2` are deliberately absent — see the header.
 * This is the list the loop should iterate, so adding a slot is one edit here.
 */
export const VISIBLE_EQUIP_SLOTS: readonly EquipSlot[] = [
  "head", "body", "legs", "feet", "hands", "mainHand", "offHand",
] as const;

// ------------------------------------------------------------------------ tints

/**
 * ## What a tint can and cannot do here, measured
 *
 * Every asset in this ladder is textured AND vertex-coloured: parsing the GLBs, sword, axe and
 * pickaxe are one `MI_Trim_Props_Vertex` primitive with a `baseColorTexture` and a `COLOR_0`
 * attribute; shield has three trim materials, all textured and vertex-coloured; the ranger and
 * peasant parts are `MI_Ranger` / `MI_Peasant`, both textured. `MeshStandardMaterial.color`
 * MULTIPLIES both of those, so a tint can darken and it can shift hue, and it can never lighten.
 *
 * That was tested rather than assumed: dropping `map` on the bone-attached weapons and re-shooting
 * the tier-1 kit turned the sword GOLD, not grey, because `COLOR_0` carries the bronze too
 * (runs/corealm/screenshots/rig2-tier-t1-crop.png at that revision). Killing both would leave a
 * flat, unlit-looking silhouette. So the ladder is a DARKENING ladder with a hue push, and the
 * PRD's colour words are approximated in the only direction the assets allow.
 *
 * The numbers below were then re-picked from what the screenshots actually showed. The first pass
 * had Corven 0x434a52 (29% luminance) against Kaldite 0x24222a (14%), and at gameplay light both
 * kits read as one flat black — see the near-identical rig2-tier-t5-crop.png and
 * rig2-tier-t10-crop.png at that revision. Tier 5 is now 43% and pushed to blue steel, which is
 * three times Kaldite's luminance and a different hue family, so the two separate.
 */

/** Tier 0. Old iron with rust in it: warmer and darker than Grithe, so the upgrade reads. */
const WORN = 0x6f6257;
/** Grithe: "dull grey". A near-neutral cool multiply — this is the undyed end of the ladder. */
const GRITHE = 0x8d9298;
/** Corven: "dark and slightly oily to the touch". Blue steel, deliberately NOT black. */
const CORVEN = 0x5a6b7c;
/** Kaldite: "black Kaldite", garnet rivets. The accent is the garnet. */
const KALDITE = 0x24222a;
const KALDITE_GARNET = 0x5c1522;
/** Marchhide: cured wolf hide. */
const MARCHHIDE = 0x8a6a4a;
/** Bramblehide: heavy hide, waxed. Lifted off Wightshroud's black for the same separation reason. */
const BRAMBLEHIDE = 0x6a5943;
/** Wightshroud: shroud cloth that "does not take dye" — so the tint is close to a no-op, correctly. */
const WIGHTSHROUD = 0xa9a89c;

/** The three off-hand stones, so the magic line's shield-proxy focus is not three grey discs. */
const QUARTZ = 0xd8d4cc;
const AMBER = 0xc98a2a;
const GARNET = 0x7a1a2c;

// ------------------------------------------------------------------------ the ladder

type OutfitKit = "ranger" | "peasant";
type OutfitPart = "hood" | "chest" | "legs" | "boots" | "gloves" | "pauldron";
type WeaponAsset = "sword" | "shield";

/**
 * A resolved part before the body variant is chosen. One item can be more than one part.
 *
 * `built` carries no tint: a generated mesh already has its colours, and `applyGearAppearance`
 * paints every material in the graph with the same one, which would turn the gem into wood.
 */
type PartSpec =
  | { kind: "outfit"; kit: OutfitKit; part: OutfitPart; tint: number; accent?: number }
  | { kind: "weapon"; assetId: WeaponAsset; tint: number; accent?: number; scale: number }
  | { kind: "built"; assetId: string };

interface GearVisual {
  slot: EquipSlot;
  /** Empty when the id is covered but has no mesh: staffs, rings, pendants. */
  parts: readonly PartSpec[];
}

interface LadderTier {
  tier: number;
  kit: OutfitKit;
  /** Tint for every armour part in this kit. */
  cloth: number;
  clothAccent?: number;
  /** Tint for the main-hand weapon. */
  weapon: number;
  weaponAccent?: number;
  /** Tint for the off-hand shield or focus. */
  offHandTint: number;
  /**
   * `sword` covers both dagger and sword geometry; `built` means `render/proceduralGear.ts` makes
   * the mesh. `scale` is only meaningful for a library GLB — a built staff is authored at its true
   * length, so there is nothing to fit.
   */
  mainHand: readonly { id: ItemId; asset: WeaponAsset | "built"; scale?: number }[];
  offHand: { id: ItemId; scale: number };
  head: ItemId;
  body: ItemId;
  legs: ItemId;
  feet: ItemId;
  hands: ItemId;
  accessories: readonly ItemId[];
}

/**
 * Every id in `content/equipment.ts`, grouped the way the content file groups them. A pauldron is
 * added to the tier 5 and tier 10 body pieces so the silhouette grows with tier as well as
 * changing colour; tiers 1 has none, which is the whole point of the growth.
 */
const LADDER: readonly LadderTier[] = [
  {
    tier: 1, kit: "ranger", cloth: GRITHE, weapon: GRITHE, offHandTint: 0x8a6f4d,
    mainHand: [
      { id: "grithe_dagger", asset: "sword", scale: 0.62 },
      { id: "grithe_sword", asset: "sword", scale: 1 },
    ],
    offHand: { id: "palewood_shield", scale: 1 },
    head: "grithe_helm", body: "grithe_cuirass", legs: "grithe_greaves",
    feet: "grithe_boots", hands: "grithe_gloves",
    accessories: ["grithe_ring", "grithe_pendant"],
  },
  {
    tier: 5, kit: "ranger", cloth: CORVEN, weapon: CORVEN, offHandTint: 0x5c4a33,
    mainHand: [
      { id: "corven_dagger", asset: "sword", scale: 0.62 },
      { id: "corven_sword", asset: "sword", scale: 1 },
    ],
    offHand: { id: "duskoak_shield", scale: 1 },
    head: "corven_helm", body: "corven_plate", legs: "corven_greaves",
    feet: "corven_boots", hands: "corven_gauntlets",
    accessories: ["corven_ring", "corven_pendant"],
  },
  {
    tier: 10, kit: "ranger", cloth: KALDITE, clothAccent: KALDITE_GARNET,
    weapon: KALDITE, weaponAccent: KALDITE_GARNET, offHandTint: KALDITE,
    mainHand: [
      { id: "kaldite_dagger", asset: "sword", scale: 0.62 },
      { id: "kaldite_sword", asset: "sword", scale: 1 },
    ],
    offHand: { id: "cairnpine_shield", scale: 1 },
    head: "kaldite_helm", body: "kaldite_plate", legs: "kaldite_greaves",
    feet: "kaldite_boots", hands: "kaldite_gauntlets",
    accessories: ["kaldite_ring", "kaldite_pendant"],
  },
  {
    tier: 1, kit: "peasant", cloth: MARCHHIDE, weapon: MARCHHIDE, offHandTint: QUARTZ,
    mainHand: [{ id: "palewood_staff", asset: "built" }],
    offHand: { id: "quartz_focus", scale: 0.4 },
    head: "marchhide_hood", body: "marchhide_robe", legs: "marchhide_leggings",
    feet: "marchhide_boots", hands: "marchhide_wraps",
    accessories: ["ember_ring", "ember_charm"],
  },
  {
    tier: 5, kit: "peasant", cloth: BRAMBLEHIDE, weapon: BRAMBLEHIDE, offHandTint: AMBER,
    mainHand: [{ id: "duskoak_staff", asset: "built" }],
    offHand: { id: "amber_focus", scale: 0.4 },
    head: "bramblehide_hood", body: "bramblehide_robe", legs: "bramblehide_leggings",
    feet: "bramblehide_boots", hands: "bramblehide_wraps",
    accessories: ["stone_ring", "stone_charm"],
  },
  {
    tier: 10, kit: "peasant", cloth: WIGHTSHROUD, weapon: WIGHTSHROUD, offHandTint: GARNET,
    mainHand: [{ id: "cairnpine_staff", asset: "built" }],
    offHand: { id: "garnet_focus", scale: 0.4 },
    head: "wightshroud_hood", body: "wightshroud_robe", legs: "wightshroud_leggings",
    feet: "wightshroud_boots", hands: "wightshroud_wraps",
    accessories: ["storm_ring", "storm_charm"],
  },
];

/**
 * Ids that are covered but have no mesh, and why.
 *
 * EMPTY, and the empty table is the point rather than dead code. It held the three staffs from the
 * day this file was written until the magic ladder landed, and it did the job it was there for: the
 * gap was a value in the program instead of a note in a file nobody reads, so when a fourth staff
 * arrived the cost of leaving it open was visible. `render/proceduralGear.ts` then closed it by
 * building the mesh, and nothing else in the 59 rows resolves to an empty visible slot.
 *
 * It stays exported because the test that reads it is the tripwire: it asserts these are the ONLY
 * visible-slot ids resolving to nothing, so a future item that would render as an empty hand fails
 * CI instead of shipping, and whoever adds it has to either give it a mesh or write down here why
 * it has none. Rings and pendants are not in it and never were — they are excluded one level up, by
 * `VISIBLE_EQUIP_SLOTS`.
 */
export const GEAR_ASSET_GAPS: Readonly<Record<ItemId, string>> = {};

function outfitPart(kit: OutfitKit, part: OutfitPart, tint: number, accent?: number): PartSpec {
  return accent === undefined
    ? { kind: "outfit", kit, part, tint }
    : { kind: "outfit", kit, part, tint, accent };
}

function weaponPart(assetId: WeaponAsset, tint: number, scale: number, accent?: number): PartSpec {
  return accent === undefined
    ? { kind: "weapon", assetId, tint, scale }
    : { kind: "weapon", assetId, tint, scale, accent };
}

function builtPart(assetId: string): PartSpec {
  return { kind: "built", assetId };
}

function buildTable(): Map<ItemId, GearVisual> {
  const table = new Map<ItemId, GearVisual>();

  // Tier 0, outside the LADDER because it is one weapon and no kit. `tierSilhouetteScale(0)` clamps
  // to the tier-1 value of 0.900, so the worn blade would draw exactly as big as a Grithe sword;
  // 0.86 of that keeps it visibly the smaller weapon, which is the only signal a player gets before
  // they open the Worn panel. WORN is a browner, duller multiply than GRITHE's cool grey — this is
  // old iron with rust in it, not clean steel.
  table.set("worn_sword", {
    slot: "mainHand",
    parts: [weaponPart("sword", WORN, round3(tierSilhouetteScale(1) * 0.86))],
  });

  // The starting staff, tier 0 and outside the LADDER for the same reason worn_sword is. It needs
  // none of the tier-0 scale fudge above: that one exists because `tierSilhouetteScale(0)` clamps to
  // tier 1, so the only way to make the worn blade smaller than a Grithe one is to multiply the
  // shared GLB. A built staff carries its own length — `STAFF_LOOKS.worn_staff` is 1.32 m against
  // palewood's 1.48 — so the tier reads out of the geometry with nothing to cancel.
  table.set("worn_staff", { slot: "mainHand", parts: [builtPart(staffAssetId("worn_staff"))] });

  for (const row of LADDER) {
    const silhouette = tierSilhouetteScale(row.tier);
    for (const hand of row.mainHand) {
      table.set(hand.id, {
        slot: "mainHand",
        parts: [hand.asset === "built"
          ? builtPart(staffAssetId(hand.id))
          : weaponPart(hand.asset, row.weapon, (hand.scale ?? 1) * silhouette, row.weaponAccent)],
      });
    }
    table.set(row.offHand.id, {
      slot: "offHand",
      parts: [weaponPart("shield", row.offHandTint, row.offHand.scale * silhouette)],
    });

    // The peasant set has no head part in the library (measured: 4 parts, chest/legs/boots/gloves),
    // so both lines borrow the ranger hood. It is the only skinned head mesh that exists.
    table.set(row.head, {
      slot: "head",
      parts: [outfitPart("ranger", "hood", row.cloth, row.clothAccent)],
    });

    const bodyParts: PartSpec[] = [outfitPart(row.kit, "chest", row.cloth, row.clothAccent)];
    if (row.tier >= 5) bodyParts.push(outfitPart("ranger", "pauldron", row.cloth, row.clothAccent));
    table.set(row.body, { slot: "body", parts: bodyParts });

    table.set(row.legs, { slot: "legs", parts: [outfitPart(row.kit, "legs", row.cloth, row.clothAccent)] });
    table.set(row.feet, { slot: "feet", parts: [outfitPart(row.kit, "boots", row.cloth, row.clothAccent)] });
    table.set(row.hands, { slot: "hands", parts: [outfitPart(row.kit, "gloves", row.cloth, row.clothAccent)] });

    for (const [index, id] of row.accessories.entries()) {
      table.set(id, { slot: index === 0 ? "accessory1" : "accessory2", parts: [] });
    }
  }
  return table;
}

const GEAR_VISUALS = buildTable();

/** Every id this file covers. 59 today, and the test asserts it equals the content table exactly. */
export const GEAR_APPEARANCE_IDS: readonly ItemId[] = [...GEAR_VISUALS.keys()];

/**
 * Every distinct FILE-BACKED asset the 59 rows can ask for, so a rig can warm them before the
 * player equips.
 *
 * This exists because of a measured stall, not a hunch. Instrumenting `CharacterRig.attachBoneSlot`
 * with `performance.now()` in a headless run: `applyEquipment` fired 1 ms after the equip landed in
 * the store, and then `assets.load("sword")` took 3366 ms and `assets.load("shield")` 5918 ms on
 * first request. For those seconds the player equips a sword and their hand stays empty, which
 * reads exactly like the render seam still being unwired. Second request: 3 ms, from the cache.
 *
 * Eight ids for a male character, of which six (the ranger set) are already loaded for the NPCs and
 * two (sword, shield) are not — 269 KB combined.
 *
 * The four built staves are NOT in here, and that is not an omission. Warming means "fetch and
 * parse the GLB before the player needs it"; a built staff has no fetch and no parse, it is already
 * in the cache from `registerProceduralGear`, and asking for one before boot registers it would
 * throw an "Unknown asset id" that `preloadGear` would then swallow. Every id this returns has a
 * file behind it, which is the only useful promise the function can make.
 */
export function gearAssetIds(body: CharacterBody = "male"): readonly string[] {
  const ids = new Set<string>();
  for (const visual of GEAR_VISUALS.values()) {
    for (const spec of visual.parts) {
      if (spec.kind === "built") continue;
      ids.add(resolve(spec, visual.slot, body).assetId);
    }
  }
  return [...ids];
}

function resolve(spec: PartSpec, slot: EquipSlot, body: CharacterBody): GearAppearance {
  // Scale 1, not `tierSilhouetteScale`: the staff line's tier growth is BUILT IN (1.32 m worn to
  // 1.74 m cairnpine), so scaling on top would double-count it and thicken the shaft and the gem
  // along with it. A Cairnpine staff is a longer staff, not a fatter one.
  if (spec.kind === "built") return { assetId: spec.assetId, slot, attach: "bone", scale: 1 };
  if (spec.kind === "weapon") {
    const appearance: GearAppearance = {
      assetId: spec.assetId, slot, attach: "bone", tint: spec.tint, scale: round3(spec.scale),
    };
    if (spec.accent !== undefined) appearance.accent = spec.accent;
    return appearance;
  }
  const appearance: GearAppearance = {
    assetId: `outfit_${body}_${spec.kit}_${spec.part}`, slot, attach: "skin", tint: spec.tint,
  };
  if (spec.accent !== undefined) appearance.accent = spec.accent;
  return appearance;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The appearance for an item, or null when it has no mesh (staffs and accessories — see
 * `GEAR_ASSET_GAPS`) or is not equipment at all.
 *
 * `body` is optional so the frozen one-argument call site keeps working; it defaults to male
 * because that is what `boot.ts` builds the player as today. When an item resolves to more than one
 * part (tier 5 and 10 body pieces carry a pauldron) this returns the FIRST — call
 * `gearAppearanceParts` to get all of them.
 */
export function gearAppearance(itemId: ItemId, body: CharacterBody = "male"): GearAppearance | null {
  const parts = gearAppearanceParts(itemId, body);
  return parts[0] ?? null;
}

/** Every part an item contributes, in attach order. Empty for a covered id with no mesh. */
export function gearAppearanceParts(itemId: ItemId, body: CharacterBody = "male"): readonly GearAppearance[] {
  const visual = GEAR_VISUALS.get(itemId);
  if (!visual) return [];
  return visual.parts.map((spec) => resolve(spec, visual.slot, body));
}

// ------------------------------------------------------------------------ hand sockets

/**
 * Where a rigid weapon sits in its hand bone.
 *
 * Every number here is measured off game/public/assets/models/character/base_male.glb and the four
 * weapon GLBs, not guessed. In `hand_r` local space the finger roots run along +Y (middle_01_r at
 * (-0.005, 0.115, +0.015)), the knuckle line is the Z axis (index_01_r z +0.041, pinky_01_r z
 * -0.035) and the palm normal is -X (thumb_03_r at x -0.064). A closed fist therefore grips along
 * LOCAL Z, and its centre is about (-0.010, 0.085, 0.000). `hand_l` is the exact mirror (thumb at
 * +X), so the shield's face normal must leave along -X to sit on the back of the hand.
 *
 * Euler XYZ in Three composes as Rx*Ry*Rz (verified numerically against THREE.Quaternion), so:
 *   (PI/2, 0, 0)     maps asset +Y -> local +Z and asset +X -> local +X
 *   (PI/2, PI/2, 0)  maps asset +Y -> local +Z and asset +X -> local +Y
 *   (PI/2, -PI/2, 0) maps asset +Y -> local +Z and asset +Z -> local -X
 *
 * Asset bounds, decoded from the quantised POSITION accessors with the node transform applied:
 *   sword    y [-0.208, +0.924], origin at the guard, grip centre y = -0.10
 *   axe      y [-0.381, +0.446] after its -90 deg Z node rotation, grip centre y = -0.25
 *   pickaxe  y [-0.494, +0.704], head spread across x [-0.410, +0.403], grip centre y = -0.15
 *   shield   face in XY, boss toward +Z, grip bar at z [-0.001, +0.044], centre z = +0.022
 * The offset is `fistCentre - R * gripCentre`, which is where each Z component below comes from.
 *
 * The built staves are the one entry with a ZERO grip offset, and that is the whole reason
 * `render/proceduralGear.ts` puts its origin at the grip instead of at the butt: a generated mesh
 * gets to choose where its origin is, so it chooses the one point that makes the correction below
 * unnecessary. They take the sword's rotation because a staff and a sword are gripped the same way
 * — asset +Y along local +Z — which also means every pose the rig already animates a sword through
 * applies unchanged.
 *
 * The previous shared constant (characterRig.ts: rotation (PI/2,0,0), position (0, 0.03, 0.04))
 * put the sword's entire 21 cm grip and pommel outside the fist with only the guard touching it.
 *
 * `scale` is the fit scale of the ASSET and is 1 for all four: the GLBs are already at metre scale.
 * The final size is `socket.scale * appearance.scale`. Because a scaled child shrinks toward its
 * own origin, the grip half of the offset has to shrink with it: at the dagger's smallest applied
 * scale (0.62 * 0.900 = 0.558) an uncompensated socket puts the grip centre 4.4 cm from the fist
 * centre, past the fist's 3.8 cm half-span, i.e. visibly floating off the pommel end. That is what
 * `weaponAttachment` exists for; `weaponSocket` is the frozen scale-1 form.
 */
interface WeaponSocket {
  bone: string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: number;
}

/** Fist centre in hand-bone local space. `hand_l` is the mirror of `hand_r` about X. */
const FIST_RIGHT: readonly [number, number, number] = [-0.010, 0.085, 0.000];
const FIST_LEFT: readonly [number, number, number] = [0.010, 0.085, 0.000];

interface SocketParts {
  bone: string;
  fist: readonly [number, number, number];
  grip: readonly [number, number, number];
  rotation: readonly [number, number, number];
}

/**
 * Every built staff shares one socket: the MAIN hand, same grip axis as the sword, no grip offset.
 *
 * A staff is a `mainHand` item and is held in the right hand like every other weapon. The animation
 * was the thing that had to move, not the weapon: the library's only cast raises the LEFT hand, so
 * `render/assets.ts` registers a mirrored copy and `characterRig.ts` plays that. Measured on the
 * mirrored clip with the staff attached here, the crown reaches 0.377 m ABOVE the head with 0.684 m
 * of reach — identical to the original clip's left-hand figures, because the rig's bind pose is
 * symmetric.
 *
 * An earlier pass socketed staves LEFT to match the unmirrored clip. That worked visually and was
 * wrong: it put a main-hand weapon in the off hand and collided with the off-hand focus.
 */
const STAFF_SOCKET: SocketParts = {
  bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0], rotation: [Math.PI / 2, 0, 0],
};

/** Where the grip centre lands relative to the asset origin AFTER `rotation`, at scale 1. */
const SOCKET_PARTS: Readonly<Record<string, SocketParts>> = {
  sword: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.100], rotation: [Math.PI / 2, 0, 0] },
  axe: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.250], rotation: [Math.PI / 2, 0, 0] },
  pickaxe: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.150], rotation: [Math.PI / 2, Math.PI / 2, 0] },
  shield: { bone: "hand_l", fist: FIST_LEFT, grip: [0.022, 0, 0], rotation: [Math.PI / 2, -Math.PI / 2, 0] },
  // Spread rather than four literal `proc_staff_*` keys, so the ids stay derived from
  // `staffAssetId` in exactly one place and a fifth staff cannot arrive with no socket.
  ...Object.fromEntries(PROCEDURAL_GEAR_ASSETS.map((asset) => [asset.assetId, STAFF_SOCKET])),
};

function socketAt(assetId: string, scale: number): WeaponSocket | null {
  const parts = SOCKET_PARTS[assetId];
  if (!parts) return null;
  return {
    bone: parts.bone,
    position: [
      round3(parts.fist[0] + parts.grip[0] * scale),
      round3(parts.fist[1] + parts.grip[1] * scale),
      round3(parts.fist[2] + parts.grip[2] * scale),
    ],
    rotation: parts.rotation,
    scale: 1,
  };
}

/** The socket at the asset's own scale. Prefer `weaponAttachment` when the part is scaled. */
export function weaponSocket(assetId: string): WeaponSocket | null {
  return socketAt(assetId, 1);
}

/**
 * The socket with the grip offset corrected for an applied scale, and `scale` already multiplied
 * out. This is what a rig should call: pass the `GearAppearance` it is about to attach.
 */
export function weaponAttachment(appearance: GearAppearance): WeaponSocket | null {
  const scale = appearance.scale ?? 1;
  const socket = socketAt(appearance.assetId, scale);
  if (!socket) return null;
  return { ...socket, scale: round3(socket.scale * scale) };
}

// ------------------------------------------------------------------------ tinting

/**
 * Recolours an attached part in place.
 *
 * The material is CLONED first: every part comes out of `AssetRegistry.load`, which hands back the
 * same cached GLTF scene to every caller, so tinting in place would repaint every other user of
 * that asset — including the NPCs wearing the same peasant set. Dispose the clones with
 * `skinning.disposeGraph(part, { materials: true })` when the slot is swapped.
 *
 * Cloning a material does not cost a draw call; two meshes with different materials were already
 * two draws.
 */
export function applyGearAppearance(object: THREE.Object3D, appearance: GearAppearance): void {
  if (appearance.tint === undefined && appearance.accent === undefined) return;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => tintedMaterial(material, appearance))
      : tintedMaterial(mesh.material, appearance);
  });
}

function tintedMaterial(material: THREE.Material, appearance: GearAppearance): THREE.Material {
  const clone = material.clone();
  const shaded = clone as Partial<THREE.MeshStandardMaterial>;
  if (appearance.tint !== undefined && shaded.color instanceof THREE.Color) {
    shaded.color.setHex(appearance.tint);
  }
  if (appearance.accent !== undefined && shaded.emissive instanceof THREE.Color) {
    shaded.emissive.setHex(appearance.accent);
    // None of these materials carries an emissiveMap, so the accent is a UNIFORM lift, not a glow
    // on the rivets. That is why it is 0.15: enough to give Kaldite's near-black a garnet cast
    // under the region's fog, low enough that the plate still reads as metal rather than as a
    // light source. Raising this past ~0.3 makes the whole armour glow.
    shaded.emissiveIntensity = 0.15;
  }
  return clone;
}
