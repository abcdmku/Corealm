/**
 * Item-to-model mappings, hand sockets, and per-item material treatment for worn gear.
 *
 * Melee armour uses Quaternius' Knight set and magic armour uses the hooded Ranger set. Magic
 * weapons use the staff and wand meshes from Blink's FREE - RPG Weapons pack. Every wood tier
 * keeps the same silhouette and changes only its unlit base colour. Altar-crafted elemental
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
  /** Emissive accent used by the remaining gem-treated weapon materials. */
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

/** Render-only weapon charge state. Exact charge count does not change the mesh. */
export interface GearWeaponChargePresentation {
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
 * knight parts are `MI_Ranger` / `MI_Knight`, both textured. `MeshStandardMaterial.color`
 * MULTIPLIES both of those, so a tint can darken and it can shift hue, and it can never lighten.
 *
 * That was tested rather than assumed: dropping `map` on the bone-attached weapons and re-shooting
 * the tier-1 kit turned the sword GOLD, not grey, because `COLOR_0` carries the bronze too
 * (runs/corealm/screenshots/rig2-tier-t1-crop.png at that revision). Killing both would leave a
 * flat, unlit-looking silhouette. Knight keeps that textured multiply. Ranger's almost-black
 * albedo also gets the small uniform colour lift in `tintedMaterial`, so its full outfit can read
 * blue and green without throwing away the painted seams and buckles.
 *
 * The armour colours below are the authored gameplay ladder. Melee moves from bronze to dark iron
 * to bright steel. Magic moves from blue to dark green to black. The Knight and Ranger silhouettes
 * keep the two combat styles distinct when their palettes happen to have similar luminance.
 */

/** Tier 0. Old iron with rust in it: warmer and darker than Grithe, so the upgrade reads. */
const WORN = 0x6f6257;
/** Melee tier 1: bronze over the Knight's authored plate texture. */
const GRITHE = 0xb77a3f;
/** Melee tier 5: medium neutral grey, separated clearly from both bronze and bright steel. */
const CORVEN = 0x7f8589;
/** Melee tier 10: full-white multiply, the brightest the textured source steel can render. */
const KALDITE = 0xffffff;
const KALDITE_GARNET = 0x5c1522;
/**
 * Melee tier 20: kiln steel. A multiply can never lighten, so Emberite cannot be "brighter than
 * Kaldite"; instead it is as bright as the texture allows with a warm cast, against Kaldite's
 * neutral white — heat against cold, at equal value.
 */
const EMBERITE = 0xffc9a0;
const EMBERITE_OPAL = 0xb8481e;
/** Magic tier 1: blue. */
const MARCHHIDE = 0x416f9d;
/** Magic tier 5: dark green. */
const BRAMBLEHIDE = 0x2f4f3b;
/** Magic tier 10: charcoal black, light enough to keep seams visible under gameplay lighting. */
const WIGHTSHROUD = 0x4a4d52;
/** Magic tier 20: seared warm grey-brown, the charhide read against the tier 10 cold charcoal. */
const CHARHIDE = 0x5c4a3c;

/** Magic tiers share geometry. Their unlit wood colour is the only tier-specific treatment. */
const BASIC_WOOD = 0x8a5a32;
const PALEWOOD = 0xd7bd8e;
const DUSKOAK = 0x53341f;
const CAIRNPINE = 0x596162;
const CINDERPINE = 0x40322b;

/**
 * The four rare miniboss weapon tints, from the Phase 2 amendment: one shared imported sword and
 * staff geometry, identified per region purely by material tint through this production path and
 * the icon path. Applied over the Blink meshes' own textures, so each stays a real object with a
 * regional colour identity rather than four recolour-flat silhouettes.
 */
const GALESKIN_TINT = 0xaadfe4;   // Fallowmarch: pale cyan.
const MOSSBOUND_TINT = 0x6f8f4a;  // Vellenwood: moss green...
const MOSSBOUND_OCHRE = 0xc09a4a; // ...and ochre.
const TIDEWORN_TINT = 0x3556b0;   // Karrowmoor: cobalt...
const TIDEWORN_TEAL = 0x2f9ba0;   // ...and teal.
const CINDERWAKE_TINT = 0xd86a2e; // Kilnhalt: ember orange...
const CINDERWAKE_CRIMSON = 0x9c2420; // ...and crimson.

/** Source bounds are 2.212 m for the staff and 0.985 m for the wand. */
const MAGIC_STAFF_SCALE = 0.82;
const MAGIC_WAND_SCALE = 0.80;

// ------------------------------------------------------------------------ the ladder

type OutfitKit = "ranger" | "knight";
type OutfitPart = "helmet" | "hood" | "chest" | "legs" | "boots" | "gloves" | "pauldron" | "scarf";
type WeaponAsset =
  | "sword" | "shield" | "axe" | "pickaxe" | "rpg_weapon_staff" | "rpg_weapon_wand"
  | "miniboss_sword" | "miniboss_staff";

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
  /** Tint for the off-hand shield. */
  offHandTint?: number;
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
 * Every id in `content/equipment.ts`, grouped the way the content file groups them. All tiers keep
 * their class silhouette and change palette, stats, names, and weapon scale.
 */
const LADDER: readonly LadderTier[] = [
  {
    tier: 1, kit: "knight", cloth: GRITHE, weapon: GRITHE, offHandTint: 0x8a6f4d,
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
    tier: 5, kit: "knight", cloth: CORVEN, weapon: CORVEN, offHandTint: 0x5c4a33,
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
    tier: 10, kit: "knight", cloth: KALDITE,
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
    tier: 1, kit: "ranger", cloth: MARCHHIDE, weapon: PALEWOOD,
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
    tier: 5, kit: "ranger", cloth: BRAMBLEHIDE, weapon: DUSKOAK,
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
    tier: 10, kit: "ranger", cloth: WIGHTSHROUD, weapon: CAIRNPINE,
    mainHand: [
      { id: "cairnpine_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "cairnpine_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
      { id: "water_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "water_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
    ],
    head: "cairnpelt_hood", body: "cairnpelt_robe", legs: "cairnpelt_leggings",
    feet: "cairnpelt_boots", hands: "cairnpelt_wraps",
    accessories: ["storm_ring", "storm_charm"],
  },
  {
    tier: 20, kit: "knight", cloth: EMBERITE,
    weapon: EMBERITE, weaponAccent: EMBERITE_OPAL, offHandTint: EMBERITE,
    mainHand: [
      { id: "emberite_dagger", asset: "sword", scale: 0.62 },
      { id: "emberite_sword", asset: "sword", scale: 1 },
    ],
    offHand: { id: "cinderpine_shield", scale: 1 },
    head: "emberite_helm", body: "emberite_plate", legs: "emberite_greaves",
    feet: "emberite_boots", hands: "emberite_gauntlets",
    accessories: ["emberite_ring", "emberite_pendant"],
  },
  {
    tier: 20, kit: "ranger", cloth: CHARHIDE, weapon: CINDERPINE,
    mainHand: [
      { id: "cinderpine_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "cinderpine_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
      { id: "fire_wand", asset: "rpg_weapon_wand", scale: MAGIC_WAND_SCALE, fixedScale: true },
      { id: "fire_staff", asset: "rpg_weapon_staff", scale: MAGIC_STAFF_SCALE, fixedScale: true },
    ],
    head: "charhide_hood", body: "charhide_robe", legs: "charhide_leggings",
    feet: "charhide_boots", hands: "charhide_wraps",
    accessories: ["cinder_ring", "cinder_charm"],
  },
];

/**
 * The eight rare miniboss weapons: one shared imported sword mesh and one shared staff mesh, four
 * regional tints. The Blink meshes are authored at real-world size with grips at the origin, so
 * the staves take no extra scale and the swords take only the tier silhouette factor.
 */
const RARE_WEAPON_VISUALS: readonly {
  id: ItemId; asset: WeaponAsset; tier: number; tint: number; accent?: number;
}[] = [
  { id: "galeskin_sword", asset: "miniboss_sword", tier: 1, tint: GALESKIN_TINT, accent: GALESKIN_TINT },
  { id: "galeskin_staff", asset: "miniboss_staff", tier: 1, tint: GALESKIN_TINT, accent: GALESKIN_TINT },
  { id: "mossbound_sword", asset: "miniboss_sword", tier: 5, tint: MOSSBOUND_TINT, accent: MOSSBOUND_OCHRE },
  { id: "mossbound_staff", asset: "miniboss_staff", tier: 5, tint: MOSSBOUND_TINT, accent: MOSSBOUND_OCHRE },
  { id: "tideworn_sword", asset: "miniboss_sword", tier: 10, tint: TIDEWORN_TINT, accent: TIDEWORN_TEAL },
  { id: "tideworn_staff", asset: "miniboss_staff", tier: 10, tint: TIDEWORN_TINT, accent: TIDEWORN_TEAL },
  { id: "cinderwake_sword", asset: "miniboss_sword", tier: 20, tint: CINDERWAKE_TINT, accent: CINDERWAKE_CRIMSON },
  { id: "cinderwake_staff", asset: "miniboss_staff", tier: 20, tint: CINDERWAKE_TINT, accent: CINDERWAKE_CRIMSON },
];

/** Visible-slot ids that still lack a mesh. Accessories are intentionally indirect. */
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
        parts: [weaponPart("shield", row.offHandTint ?? row.weapon, row.offHand.scale * silhouette)],
      });
    }

    const headPart: OutfitPart = row.kit === "knight" ? "helmet" : "hood";
    table.set(row.head, {
      slot: "head",
      parts: [outfitPart(row.kit, headPart, row.cloth, row.clothAccent)],
    });

    const bodyParts: PartSpec[] = [outfitPart(row.kit, "chest", row.cloth, row.clothAccent)];
    bodyParts.push(outfitPart(row.kit, "pauldron", row.cloth, row.clothAccent));
    if (row.kit === "knight") bodyParts.push(outfitPart("knight", "scarf", row.cloth, row.clothAccent));
    table.set(row.body, { slot: "body", parts: bodyParts });

    table.set(row.legs, { slot: "legs", parts: [outfitPart(row.kit, "legs", row.cloth, row.clothAccent)] });
    table.set(row.feet, { slot: "feet", parts: [outfitPart(row.kit, "boots", row.cloth, row.clothAccent)] });
    table.set(row.hands, { slot: "hands", parts: [outfitPart(row.kit, "gloves", row.cloth, row.clothAccent)] });

    for (const [index, id] of row.accessories.entries()) {
      table.set(id, { slot: index === 0 ? "accessory1" : "accessory2", parts: [] });
    }
  }

  for (const rare of RARE_WEAPON_VISUALS) {
    const swordScale = round3(tierSilhouetteScale(rare.tier));
    table.set(rare.id, {
      slot: "mainHand",
      parts: [weaponPart(
        rare.asset,
        rare.tint,
        rare.asset === "miniboss_staff" ? 1 : swordScale,
        rare.accent,
      )],
    });
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
  ["emberite_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: EMBERITE, scale: tierSilhouetteScale(20), accent: EMBERITE_OPAL }],
  ["emberite_hatchet", { assetId: "axe", slot: "mainHand", attach: "bone", tint: EMBERITE, scale: tierSilhouetteScale(20), accent: EMBERITE_OPAL }],
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
 * The appearance for an item, or null when it has no mesh (accessories — see
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
export function gearAppearancePartsWithCharge(
  itemId: ItemId,
  charge: GearWeaponChargePresentation,
  body: CharacterBody = "male",
): readonly GearAppearance[] {
  const parts = gearAppearanceParts(itemId, body);
  const palette = charge.itemId ? ORB_PALETTES[charge.itemId] : undefined;
  if (!palette) return parts;
  return parts.map((part) => {
    const socket = ORB_SOCKETS[part.assetId];
    if (!socket) return part;
    return {
      ...part,
      orb: {
        ...palette,
        charged: charge.charged,
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
    // Hold the source mesh at its midpoint. The first turn follows the diagonal through the fist;
    // the small second turn pushes the shaft away from the torso when viewed from above.
    bone: "hand_r", fist: FIST_RIGHT, grip: [0.043, -0.021, 0.224],
    rotation: [Math.PI * 0.53, 0, -Math.PI * 0.06],
  },
  rpg_weapon_wand: {
    bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.200], rotation: [Math.PI / 2, 0, 0],
  },
  // The imported rare weapons keep their authored grip pivots: the sword's crossguard sits exactly
  // on its origin (grip centre a hand-width down the handle), and the staff's grip is its origin.
  // Verified in the feature lab, like every other socket in this table.
  miniboss_sword: {
    // Rx(-90) rather than the CC0 sword's Rx(+90): the imported blade runs +Y from a crossguard
    // origin, and the first lab sweep showed +90 hanging it point-down into the ground. With the
    // flip the handle (-Y) lands at +Z, so the grip centre sits a hand-width up the handle.
    bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.100], rotation: [-Math.PI / 2, 0, 0],
  },
  miniboss_staff: {
    // The mesh origin sits at the authored grip just under the crystal, i.e. near the TOP of the
    // 1.75 m shaft. Holding the origin put the crystal at fist height with the foot dragging the
    // ground (first lab sweep); 0.55 m down the shaft holds it mid-staff like the pack staffs,
    // crystal above the shoulder, foot clear of the ground.
    bone: "hand_r", fist: FIST_RIGHT, grip: [0.043, -0.021, 0.55],
    rotation: [Math.PI * 0.53, 0, -Math.PI * 0.06],
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
  if (appearance.orb) object.add(magicOrbMesh(appearance.orb));
}

function tintedMaterial(material: THREE.Material, appearance: GearAppearance): THREE.Material {
  const clone = material.clone();
  const shaded = clone as Partial<THREE.MeshStandardMaterial>;
  if (appearance.tint !== undefined && shaded.color instanceof THREE.Color) {
    shaded.color.setHex(appearance.tint);
  }
  if (appearance.accent !== undefined && shaded.emissive instanceof THREE.Color) {
    shaded.emissive.setHex(appearance.accent);
    // On a material with no emissive map this is a restrained uniform gem cast rather than a
    // localized glow, so it stays faint. The imported rare weapons DO carry an authored emissive
    // map (the staff crystal, the sword's edge line); there the accent recolours that authored
    // glow and must stay bright enough to read as one at gameplay distance.
    shaded.emissiveIntensity = shaded.emissiveMap ? 1.2 : 0.15;
  }
  if (isRangerOutfitAsset(appearance.assetId)
    && appearance.tint !== undefined
    && shaded.color instanceof THREE.Color) {
    applyRangerTierColour(clone, appearance.tint);
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

function isRangerOutfitAsset(assetId: string): boolean {
  return assetId.startsWith("outfit_male_ranger_") || assetId.startsWith("outfit_female_ranger_");
}

/**
 * Rehues Ranger's nearly black albedo without using emissive light.
 *
 * A uniform emissive lift made every normal face equally bright, which erased the hood folds,
 * chest planes, straps, and boot shape. This fragment pass reads the authored texture and vertex
 * colour luminance, maps that value into the tier hue, then leaves Three's normal PBR lighting to
 * shade the result. The 0.26 floor makes the dark cloth accept blue or green. Expanding the
 * source's first 0.22 luminance into the remaining range keeps its low-contrast detail readable.
 */
function applyRangerTierColour(material: THREE.Material, tint: number): void {
  const shaded = material as Partial<THREE.MeshStandardMaterial>;
  if (!(shaded.color instanceof THREE.Color)) return;

  // The shader below owns the tier colour. White lets it measure the unmodified source albedo.
  shaded.color.setHex(0xffffff);
  if (shaded.emissive instanceof THREE.Color) {
    shaded.emissive.setHex(0x000000);
    shaded.emissiveIntensity = 0;
  }

  const colour = new THREE.Color(tint);
  const colourLiteral = `vec3(${colour.r.toFixed(6)}, ${colour.g.toFixed(6)}, ${colour.b.toFixed(6)})`;
  const inheritedCompile = material.onBeforeCompile;
  const inheritedCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer): void => {
    inheritedCompile.call(material, shader, renderer);
    const marker = "#include <color_fragment>";
    if (!shader.fragmentShader.includes(marker)) return;
    shader.fragmentShader = shader.fragmentShader.replace(marker, `${marker}
      float gearTierSourceLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float gearTierValue = mix(0.26, 1.0, smoothstep(0.0, 0.22, gearTierSourceLuma));
      diffuseColor.rgb = ${colourLiteral} * gearTierValue;
    `);
  };
  material.customProgramCacheKey = (): string => (
    `${inheritedCacheKey()}|ranger-tier-colour:${tint.toString(16)}`
  );
  material.needsUpdate = true;
}

/** One shared 20-triangle shape. Each attachment owns only its tiny material. */
const MAGIC_ORB_GEOMETRY = new THREE.IcosahedronGeometry(1, 0);

function magicOrbMesh(appearance: GearOrbAppearance): THREE.Mesh {
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
  const orb = new THREE.Mesh(MAGIC_ORB_GEOMETRY, material);
  orb.name = `magic-weapon-socket-${appearance.element}-${charged ? "charged" : "empty"}`;
  orb.position.set(...appearance.position);
  orb.rotation.set(0.34, 0.51, 0.18);
  orb.scale.setScalar(appearance.radius);
  orb.castShadow = false;
  orb.receiveShadow = false;
  return orb;
}
