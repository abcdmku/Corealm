/**
 * Item-to-model mappings, hand sockets, and per-item material treatment for worn gear.
 *
 * Magic weapons use the staff and wand meshes from Blink's FREE - RPG Weapons pack. Every wood
 * tier keeps the same silhouette and changes only its unlit base colour. Orb-crafted elemental
 * weapons add one small faceted mesh at the crown.
 */
import * as THREE from "three";
import type { EquipSlot, ItemId } from "../contracts.js";
import { tierSilhouetteScale } from "./materials.js";

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
  /** The crafted elemental socket drawn at the weapon head. The weapon material itself remains non-emissive. */
  orb?: GearOrbAppearance;
}

export type GearOrbElement = "wind" | "earth" | "water" | "fire";

export interface GearOrbAppearance {
  element: GearOrbElement;
  charged: boolean;
  colour: number;
  emissive: number;
  position: readonly [number, number, number];
  radius: number;
}

/** The render-only focus state passed from the loop. Exact charge count does not change the mesh. */
export interface GearFocusPresentation {
  itemId: ItemId | null;
  charged: boolean;
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

/** Magic tiers share geometry. Their unlit wood colour is the only tier-specific treatment. */
const BASIC_WOOD = 0x8a5a32;
const PALEWOOD = 0xd7bd8e;
const DUSKOAK = 0x53341f;
const CAIRNPINE = 0x596162;

/** Source bounds are 2.212 m for the staff and 0.985 m for the wand. */
const MAGIC_STAFF_SCALE = 0.82;
const MAGIC_WAND_SCALE = 0.80;

// ------------------------------------------------------------------------ the ladder

type OutfitKit = "ranger" | "peasant";
type OutfitPart = "hood" | "chest" | "legs" | "boots" | "gloves" | "pauldron";
type WeaponAsset = "sword" | "shield" | "axe" | "pickaxe" | "rpg_weapon_staff" | "rpg_weapon_wand";

/**
 * A resolved part before the body variant is chosen. One item can be more than one part.
 *
 * Every weapon entry is file-backed. Magic variants deliberately reuse one mesh per weapon kind.
 */
type PartSpec =
  | { kind: "outfit"; kit: OutfitKit; part: OutfitPart; tint: number; accent?: number }
  | { kind: "weapon"; assetId: WeaponAsset; tint: number; accent?: number; scale: number };

interface GearVisual {
  slot: EquipSlot;
  /** Empty when the id is covered but has no direct mesh, such as an orb or accessory. */
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
   * `sword` covers both dagger and sword geometry. Magic variants use the pack staff or wand.
   */
  mainHand: readonly { id: ItemId; asset: WeaponAsset; scale?: number; fixedScale?: boolean }[];
  offHand?: { id: ItemId; scale: number };
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
    tier: 1, kit: "peasant", cloth: MARCHHIDE, weapon: PALEWOOD, offHandTint: QUARTZ,
    mainHand: [
      { id: "palewood_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "palewood_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
      { id: "air_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "air_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
    ],
    head: "marchhide_hood", body: "marchhide_robe", legs: "marchhide_leggings",
    feet: "marchhide_boots", hands: "marchhide_wraps",
    accessories: ["ember_ring", "ember_charm"],
  },
  {
    tier: 5, kit: "peasant", cloth: BRAMBLEHIDE, weapon: DUSKOAK, offHandTint: AMBER,
    mainHand: [
      { id: "duskoak_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "duskoak_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
      { id: "earth_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "earth_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
    ],
    head: "bramblehide_hood", body: "bramblehide_robe", legs: "bramblehide_leggings",
    feet: "bramblehide_boots", hands: "bramblehide_wraps",
    accessories: ["stone_ring", "stone_charm"],
  },
  {
    tier: 10, kit: "peasant", cloth: WIGHTSHROUD, weapon: CAIRNPINE, offHandTint: GARNET,
    mainHand: [
      { id: "cairnpine_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "cairnpine_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
      { id: "water_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "water_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
    ],
    head: "wightshroud_hood", body: "wightshroud_robe", legs: "wightshroud_leggings",
    feet: "wightshroud_boots", hands: "wightshroud_wraps",
    accessories: ["storm_ring", "storm_charm"],
  },
];

/** Visible-slot ids that still lack a mesh. Focus orbs and accessories are intentionally indirect. */
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

  // Both starter weapons are plain brown and unlit.
  table.set("basic_wooden_wand", {
    slot: "mainHand",
    parts: [weaponPart("rpg_weapon_wand", BASIC_WOOD, MAGIC_WAND_SCALE)],
  });
  table.set("basic_wooden_staff", {
    slot: "mainHand",
    parts: [weaponPart("rpg_weapon_staff", BASIC_WOOD, MAGIC_STAFF_SCALE)],
  });

  for (const row of LADDER) {
    const silhouette = tierSilhouetteScale(row.tier);
    for (const hand of row.mainHand) {
      table.set(hand.id, {
        slot: "mainHand",
        parts: [weaponPart(
          hand.asset,
          row.weapon,
          (hand.scale ?? 1) * (hand.fixedScale ? 1 : silhouette),
          row.weaponAccent,
        )],
      });
    }
    if (row.offHand) {
      table.set(row.offHand.id, {
        slot: "offHand",
        parts: [weaponPart("shield", row.offHandTint, row.offHand.scale * silhouette)],
      });
    }

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

/** Carried gathering tools shown only while their activity is running. */
const GATHERING_TOOL_APPEARANCES = new Map<ItemId, GearAppearance>([
  ["worn_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: WORN, scale: 0.84 }],
  ["grithe_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: GRITHE, scale: tierSilhouetteScale(1) }],
  ["corven_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: CORVEN, scale: tierSilhouetteScale(5) }],
  ["kaldite_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: KALDITE, scale: tierSilhouetteScale(10), accent: KALDITE_GARNET }],
  ["worn_hatchet", { assetId: "axe", slot: "mainHand", attach: "bone", tint: WORN, scale: 0.84 }],
  ["grithe_hatchet", { assetId: "axe", slot: "mainHand", attach: "bone", tint: GRITHE, scale: tierSilhouetteScale(1) }],
  ["corven_hatchet", { assetId: "axe", slot: "mainHand", attach: "bone", tint: CORVEN, scale: tierSilhouetteScale(5) }],
  ["kaldite_hatchet", { assetId: "axe", slot: "mainHand", attach: "bone", tint: KALDITE, scale: tierSilhouetteScale(10), accent: KALDITE_GARNET }],
]);

/** Appearance of a carried pickaxe or hatchet while gathering, if the item is one. */
export function gatheringToolAppearance(itemId: ItemId): GearAppearance | null {
  return GATHERING_TOOL_APPEARANCES.get(itemId) ?? null;
}

/** Every equipment id this file covers. The equipment test compares it with the content table. */
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
 * Both pack weapon GLBs are included so a starter wand and a later staff do not appear late.
 */
export function gearAssetIds(body: CharacterBody = "male"): readonly string[] {
  const ids = new Set<string>();
  for (const visual of GEAR_VISUALS.values()) {
    for (const spec of visual.parts) {
      ids.add(resolve(spec, visual.slot, body).assetId);
    }
  }
  for (const appearance of GATHERING_TOOL_APPEARANCES.values()) ids.add(appearance.assetId);
  return [...ids];
}

function resolve(spec: PartSpec, slot: EquipSlot, body: CharacterBody): GearAppearance {
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

interface OrbPalette {
  element: GearOrbElement;
  colour: number;
  emissive: number;
}

const ORB_PALETTES: Readonly<Record<string, OrbPalette>> = {
  air_wand: { element: "wind", colour: 0xd6fbff, emissive: 0x79edff },
  air_staff: { element: "wind", colour: 0xd6fbff, emissive: 0x79edff },
  earth_wand: { element: "earth", colour: 0xd5b558, emissive: 0x83bd50 },
  earth_staff: { element: "earth", colour: 0xd5b558, emissive: 0x83bd50 },
  water_wand: { element: "water", colour: 0x6cbcff, emissive: 0x197ce8 },
  water_staff: { element: "water", colour: 0x6cbcff, emissive: 0x197ce8 },
};

/**
 * Root-local sockets derived from the source FBX bounds.
 *
 * The staff spans y -1.335..0.877 m and the wand -0.319..0.666 m. These points sit at 94–95% of
 * each +Y extent, just inside the modeled crown. The root integration screenshot is the final check
 * because the Unity-to-GLB export may add a wrapper transform around the original mesh node.
 */
const ORB_SOCKETS: Readonly<Record<string, {
  position: readonly [number, number, number];
  radius: number;
}>> = {
  rpg_weapon_staff: { position: [0, 0.744, 0], radius: 0.092 },
  rpg_weapon_wand: { position: [-0.052, 0.617, 0], radius: 0.070 },
};

/** Adds the crafted elemental core to a magic weapon. */
export function gearAppearancePartsWithFocus(
  itemId: ItemId,
  focus: GearFocusPresentation,
  body: CharacterBody = "male",
): readonly GearAppearance[] {
  const parts = gearAppearanceParts(itemId, body);
  const palette = focus.itemId ? ORB_PALETTES[focus.itemId] : undefined;
  if (!palette) return parts;
  return parts.map((part) => {
    const socket = ORB_SOCKETS[part.assetId];
    if (!socket) return part;
    return {
      ...part,
      orb: {
        ...palette,
        charged: focus.charged,
        position: socket.position,
        radius: socket.radius,
      },
    };
  });
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
 * The pack weapons also point along asset +Y. Their grip offsets use a point 12% above the lower
 * bound, which keeps a short butt below the fist and most of the shaft above it.
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

/** Where the grip centre lands relative to the asset origin AFTER `rotation`, at scale 1. */
const SOCKET_PARTS: Readonly<Record<string, SocketParts>> = {
  sword: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.100], rotation: [Math.PI / 2, 0, 0] },
  axe: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.250], rotation: [Math.PI / 2, 0, 0] },
  pickaxe: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.150], rotation: [Math.PI / 2, Math.PI / 2, 0] },
  shield: { bone: "hand_l", fist: FIST_LEFT, grip: [0.022, 0, 0], rotation: [Math.PI / 2, -Math.PI / 2, 0] },
  rpg_weapon_staff: {
    // Hand-local -Y points up the relaxed arm. Keep the shaft on that axis and hold it at the
    // measured 12%-of-height grip point so the crown stays upright instead of trailing behind.
    bone: "hand_r", fist: FIST_RIGHT, grip: [0, -1.070, 0], rotation: [Math.PI, 0, 0],
  },
  rpg_weapon_wand: {
    bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.200], rotation: [Math.PI / 2, 0, 0],
  },
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
  if (appearance.tint !== undefined || appearance.accent !== undefined) {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => tintedMaterial(material, appearance))
        : tintedMaterial(mesh.material, appearance);
    });
  }
  if (appearance.orb) object.add(focusOrbMesh(appearance.orb));
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
  if (isMagicWeaponAsset(appearance.assetId)) {
    // The source FBXs each use one material, so there is no safe sub-material to recolour. Removing
    // the albedo and vertex-colour multipliers makes the authored normal detail read in exactly one
    // wood colour. It also removes the basic staff texture's green accent. The model stays unlit.
    shaded.map = null;
    shaded.emissiveMap = null;
    shaded.vertexColors = false;
    if (shaded.emissive instanceof THREE.Color) shaded.emissive.setHex(0x000000);
    shaded.emissiveIntensity = 0;
    shaded.metalness = 0.04;
    shaded.roughness = 0.72;
    clone.needsUpdate = true;
  }
  return clone;
}

function isMagicWeaponAsset(assetId: string): boolean {
  return assetId === "rpg_weapon_staff" || assetId === "rpg_weapon_wand";
}

/** One shared 20-triangle shape. Each attachment owns only its tiny material. */
const FOCUS_ORB_GEOMETRY = new THREE.IcosahedronGeometry(1, 0);

function focusOrbMesh(appearance: GearOrbAppearance): THREE.Mesh {
  const charged = appearance.charged;
  const material = new THREE.MeshStandardMaterial({
    color: charged ? appearance.colour : 0x181b1c,
    emissive: charged ? appearance.emissive : 0x000000,
    emissiveIntensity: charged ? 2.1 : 0,
    metalness: charged ? 0.05 : 0.18,
    roughness: charged ? 0.24 : 0.58,
    transparent: true,
    opacity: charged ? 0.94 : 0.42,
    depthWrite: charged,
  });
  const orb = new THREE.Mesh(FOCUS_ORB_GEOMETRY, material);
  orb.name = `magic-weapon-socket-${appearance.element}-${charged ? "charged" : "empty"}`;
  orb.position.set(...appearance.position);
  orb.rotation.set(0.34, 0.51, 0.18);
  orb.scale.setScalar(appearance.radius);
  orb.castShadow = false;
  orb.receiveShadow = false;
  return orb;
}
