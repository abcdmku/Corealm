/**
 * The source of truth for item icon geometry.
 *
 * ItemDef stays a gameplay contract. Icon art belongs to the render layer, so this table resolves
 * every current item id to either an existing GLB or one small procedural model family. There is
 * deliberately no category fallback: adding an item without deciding what it looks like fails at
 * module load and in tests instead of silently shipping the wrong picture.
 */
import type { ItemDef, ItemId } from "../contracts.js";
import { ALL_ITEMS } from "../content/items.js";
import { gearAppearanceParts } from "./equipmentVisuals.js";
import { paletteForTier } from "./materials.js";

export type ItemIconPrimitive =
  | "amulet"
  | "antler"
  | "claw"
  | "dagger"
  | "essence"
  | "egg"
  | "feather"
  | "fish"
  | "handle"
  | "gland"
  | "hide"
  | "horn"
  | "ingot"
  | "log"
  | "orb"
  | "meat"
  | "ring"
  | "rod"
  | "seed"
  | "shaft"
  | "staff";

export interface ItemIconAssetPart {
  kind: "asset";
  assetId: string;
  colour?: number;
  accent?: number;
  scale?: number;
}

export interface ItemIconPrimitivePart {
  kind: "primitive";
  primitive: ItemIconPrimitive;
  colour: number;
  accent?: number;
}

export type ItemIconPart = ItemIconAssetPart | ItemIconPrimitivePart;

export interface ItemIconAppearance {
  itemId: ItemId;
  parts: readonly ItemIconPart[];
  /** Extra empty space around this item after the common projected-bounds fit. */
  frameScale?: number;
  /** Corrects an authored model's pose while leaving the shared camera fixed. */
  rotation?: readonly [number, number, number];
}

const APPEARANCES = new Map<ItemId, ItemIconAppearance>();
const BY_ID = new Map(ALL_ITEMS.map((item) => [item.id, item] as const));

function def(id: ItemId): ItemDef {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown item icon id: ${id}`);
  return item;
}

function put(
  itemId: ItemId,
  parts: readonly ItemIconPart[],
  options: Pick<ItemIconAppearance, "frameScale" | "rotation"> = {},
): void {
  if (APPEARANCES.has(itemId)) throw new Error(`Duplicate item icon appearance: ${itemId}`);
  if (parts.length === 0) throw new Error(`Item icon appearance has no parts: ${itemId}`);
  APPEARANCES.set(itemId, { itemId, parts, ...options });
}

function asset(assetId: string, colour?: number, scale?: number): ItemIconAssetPart {
  return { kind: "asset", assetId, ...(colour === undefined ? {} : { colour }), ...(scale === undefined ? {} : { scale }) };
}

function primitive(
  shape: ItemIconPrimitive,
  colour: number,
  accent?: number,
): ItemIconPrimitivePart {
  return { kind: "primitive", primitive: shape, colour, ...(accent === undefined ? {} : { accent }) };
}

function tierMetal(id: ItemId): number {
  return paletteForTier(def(id).tier).metal;
}

function tierBody(id: ItemId): number {
  return paletteForTier(def(id).tier).body;
}

function tierAccent(id: ItemId): number {
  return paletteForTier(def(id).tier).accent;
}

const WOOD: Readonly<Record<number, number>> = {
  0: 0x68472f,
  1: 0xb99a6b,
  5: 0x51372a,
  10: 0x765238,
  20: 0x4a3a30,
};

/** Exact solid colours used by the worn Blink meshes in equipmentVisuals.ts. */
const MAGIC_WOOD: Readonly<Record<number, number>> = {
  0: 0x8a5a32,
  1: 0xd7bd8e,
  5: 0x53341f,
  10: 0x596162,
  20: 0x40322b,
};

function wood(id: ItemId): number {
  return WOOD[def(id).tier] ?? WOOD[1]!;
}

function magicWood(id: ItemId): number {
  return MAGIC_WOOD[def(id).tier] ?? MAGIC_WOOD[1]!;
}

// Currency and gathered resources.
put("marks", [asset("coin", 0xd6a83f)], { rotation: [0.22, 0, -0.15] });
put("grithe_ore", [asset("ore_crystal_pink", tierMetal("grithe_ore"))]);
put("march_stone", [asset("rock_small_2", 0xb8aa91)]);
put("corven_ore", [asset("ore_crystal_green", tierMetal("corven_ore"))]);
put("kaldite_ore", [asset("ore_crystal_blue", tierMetal("kaldite_ore"))]);
put("emberite_ore", [asset("ore_crystal_pink", tierMetal("emberite_ore"))]);
put("kilnstone", [asset("rock_small_1", 0x4a443c)]);

for (const id of ["palewood_log", "duskoak_log", "cairnpine_log", "cinderpine_log"] as const) {
  put(id, [primitive("log", wood(id), tierBody(id))], { rotation: [0, 0, -0.2] });
}

put("silt_minnow", [primitive("fish", 0x7f98a3, 0xc4d4d7)]);
put("bramble_trout", [primitive("fish", 0x4f5962, 0x9d6d54)]);
put("cragfin", [primitive("fish", 0x53697b, 0xb9c4c5)]);
put("ashfin", [primitive("fish", 0x574a44, 0xd88a56)]);
put("bittergrain", [asset("grass_wispy_tall", 0xc6a75a)]);
put("duskberry", [asset("bush_common", 0x644477)]);
put("cairnleaf", [asset("plant_broad_large", 0x8e978d)]);
put("coalroot", [primitive("gland", 0x352c26, 0x6b4a34)]);

// Processed resources and components.
for (const id of ["grithe_bar", "corven_bar", "kaldite_bar", "emberite_bar"] as const) {
  put(id, [primitive("ingot", tierMetal(id), tierBody(id))]);
}

put("pale_quartz", [asset("ore_crystal_blue", 0xe3ded2)]);
put("vell_amber", [asset("ore_crystal_green", 0xc47b2b)]);
put("cairn_garnet", [asset("ore_crystal_pink", 0x8e2337)]);
put("fire_opal", [asset("ore_crystal_pink", 0xe57a2e)]);
for (const id of ["palewood_shaft", "duskoak_shaft", "cairnpine_shaft", "cinderpine_shaft"] as const) {
  put(id, [primitive("shaft", wood(id), tierMetal(id))], { rotation: [0, 0, -0.25] });
}
for (const id of ["palewood_handle", "duskoak_handle", "cairnpine_handle", "cinderpine_handle"] as const) {
  put(id, [primitive("handle", wood(id), tierBody(id))], { rotation: [0, 0, -0.3], frameScale: 1.08 });
}
put("coarse_hide", [primitive("hide", 0x9a7654, 0x5b4432)]);
put("bramble_hide", [primitive("hide", 0x65503d, 0x362d26)]);
put("cairn_pelt", [primitive("hide", 0x8b7f70, 0x4c443c)]);
put("charhide", [primitive("hide", 0x574840, 0x2e2622)]);

/** Element colour stays consistent between the loose essence and the boss-won orb. */
const ELEMENT_COLOURS = {
  air: { body: 0x78cce8, glow: 0xd8f7ff },
  earth: { body: 0x668c43, glow: 0xb9d66b },
  water: { body: 0x327fc2, glow: 0xa9e6ff },
  fire: { body: 0xe06428, glow: 0xffcf9e },
} as const;

for (const element of ["air", "earth", "water", "fire"] as const) {
  const colours = ELEMENT_COLOURS[element];
  put(`${element}_essence`, [primitive("essence", colours.body, colours.glow)], { frameScale: 1.2 });
}

// Animal trophies, one per family. Colour is the only thing separating several of these, so each
// one is picked off the animal's own texture rather than from a palette: a coyote fang is bone
// against a bear claw's horn-brown, and the two horn shapes differ in silhouette as well.
put("hen_feather", [primitive("feather", 0xb08a5a, 0x6d5433)]);
put("hen_egg", [primitive("egg", 0xefe3cc, 0xa89070)]);
put("curl_horn", [primitive("horn", 0xa89676, 0x6b5c44)]);
put("ox_horn", [primitive("horn", 0xd8cdb6, 0x8a7f68)]);
put("coney_foot", [primitive("claw", 0xcfc3b0, 0x8d7f6b)]);
put("marsh_gland", [primitive("gland", 0x9fc08a, 0x5f7a4e)]);
put("viper_skin", [primitive("hide", 0x8d8f6b, 0x4a4a33)]);
put("venom_gland", [primitive("gland", 0xb7d46a, 0x63803a)]);
put("stag_antler", [primitive("antler", 0xa38f6d, 0x6b5b42)]);
put("curved_tusk", [primitive("horn", 0xe0d3ae, 0x93855f)]);
put("coyote_fang", [primitive("claw", 0xe6ddc8, 0x9a8f76)]);
put("bear_claw", [primitive("claw", 0x6f5b45, 0x3a2d21)]);
put("boar_bristle", [primitive("hide", 0x4a4038, 0x231d18)]);
put("ibex_horn", [primitive("horn", 0x7d6a4f, 0x453a2b)]);
put("aurochs_horn", [primitive("horn", 0xc8b995, 0x6f6349)]);
// A tail is a curled taper, not a stick. `shaft` gave it two metal bands and read as a dowel.
put("rat_tail", [primitive("horn", 0x9b7f74, 0x5c4a42)]);
put("scorpion_stinger", [primitive("claw", 0xc9a24a, 0x6f5620)]);
put("crab_claw", [primitive("claw", 0xc4552f, 0x71291a)]);
put("ashback_claw", [primitive("claw", 0x8a8378, 0x4d463d)]);
put("cinder_tusk", [primitive("horn", 0x5a4c40, 0x2e2520)]);
put("emberhorn", [primitive("horn", 0x8a5a44, 0x53301f)]);
put("kiln_fang", [primitive("claw", 0xb5764a, 0x6e3a1e)]);

// Game meat. Raw, cooked and burnt share one model; colour carries preparation state, exactly the
// convention the fish line below already uses.
put("raw_game_meat", [primitive("meat", 0xbe6a63, 0xe8ddc6)]);
put("roast_game", [primitive("meat", 0x8d5330, 0xe0d4bc)]);
put("burnt_game", [primitive("meat", 0x37302b, 0x6a625a)]);
put("raw_venison", [primitive("meat", 0x8f4a48, 0xe4d8c1)]);
put("roast_venison", [primitive("meat", 0x6f3d26, 0xd8ccb3)]);
put("burnt_venison", [primitive("meat", 0x2f2926, 0x615a53)]);
put("raw_haunch", [primitive("meat", 0xa1544d, 0xe8ddc6)]);
put("roast_haunch", [primitive("meat", 0x7d4527, 0xdcd0b7)]);
put("burnt_haunch", [primitive("meat", 0x2a2422, 0x585149)]);
put("raw_ember_haunch", [primitive("meat", 0xa8524a, 0xf0e2c8)]);
put("roast_ember_haunch", [primitive("meat", 0x84431f, 0xe2d3b6)]);
put("burnt_ember_haunch", [primitive("meat", 0x241f1d, 0x4f4841)]);

// Seeds and food. Raw and cooked fish share a model, while colour carries preparation state.
put("bittergrain_seed", [primitive("seed", 0xc9a65a, 0x765829)]);
put("duskberry_seed", [primitive("seed", 0x6a477e, 0x9d7ab0)]);
put("cairnleaf_seed", [primitive("seed", 0x9aa397, 0x56645e)]);
put("coalroot_seed", [primitive("seed", 0x453a30, 0x8a6a3e)]);
put("seared_minnow", [primitive("fish", 0xc58a54, 0xf0c781)]);
put("burnt_minnow", [primitive("fish", 0x3b3029, 0x72533d)]);
put("seared_trout", [primitive("fish", 0xa76a48, 0xdfad70)]);
put("burnt_trout", [primitive("fish", 0x312925, 0x654837)]);
put("seared_cragfin", [primitive("fish", 0x9e704f, 0xe3b877)]);
put("burnt_cragfin", [primitive("fish", 0x282322, 0x59443a)]);
put("seared_ashfin", [primitive("fish", 0xa06342, 0xe8ab6a)]);
put("burnt_ashfin", [primitive("fish", 0x231f1e, 0x4f3c32)]);

// Tools use the authored meshes where the library has them. Fishing rods are purpose-built.
for (const id of ["worn_pickaxe", "grithe_pickaxe", "corven_pickaxe", "kaldite_pickaxe", "emberite_pickaxe"] as const) {
  put(id, [asset("pickaxe", id === "worn_pickaxe" ? 0x6d6256 : tierMetal(id))], { rotation: [0, 0, -0.28] });
}
for (const id of ["worn_hatchet", "grithe_hatchet", "corven_hatchet", "kaldite_hatchet", "emberite_hatchet"] as const) {
  put(id, [asset("axe", id === "worn_hatchet" ? 0x6d6256 : tierMetal(id))], { rotation: [0, 0, -0.28] });
}
for (const id of ["worn_rod", "palewood_rod", "duskoak_rod", "cairnpine_rod", "cinderpine_rod"] as const) {
  put(id, [primitive("rod", wood(id), id === "worn_rod" ? 0x77716a : tierMetal(id))], { rotation: [0, 0, -0.18] });
}

for (const item of ALL_ITEMS.filter((entry) => entry.orb !== undefined)) {
  const element = item.orb!.element === "wind" ? "air" : item.orb!.element;
  if (!(element in ELEMENT_COLOURS)) {
    throw new Error(`Released orb ${item.id} has no icon palette for ${element}`);
  }
  const colours = ELEMENT_COLOURS[element as keyof typeof ELEMENT_COLOURS];
  put(item.id, [primitive("orb", colours.body, colours.glow)], {
    frameScale: item.orb!.released ? 1 : 1.06,
  });
}

// Equipment normally reuses the same appearance the character rig wears. Magic weapons are
// explicit here because their silhouettes come from Blink's FREE - RPG Weapons pack. The wood
// tint carries the log tier while the absent accent keeps an unequipped weapon visibly unlit.
/**
 * The rare miniboss staves carry `magicWeapon` but must NOT take the shared Blink rpg silhouette:
 * their look is the imported miniboss staff mesh with the regional tint, which
 * `gearAppearanceParts` already resolves. Listing them here routes them down that branch.
 */
const RARE_MINIBOSS_WEAPONS = new Set<ItemId>([
  "galeskin_sword", "galeskin_staff", "mossbound_sword", "mossbound_staff",
  "tideworn_sword", "tideworn_staff", "cinderwake_sword", "cinderwake_staff",
]);

for (const item of ALL_ITEMS.filter((entry) => entry.category === "equipment")) {
  const id = item.id;
  if (item.magicWeapon && !RARE_MINIBOSS_WEAPONS.has(id)) {
    const assetId = item.magicWeapon.kind === "staff" ? "rpg_weapon_staff" : "rpg_weapon_wand";
    put(id, [asset(assetId, magicWood(id))], { rotation: [0, 0, -0.2] });
    continue;
  }
  if (/_dagger$/.test(id)) {
    put(id, [primitive("dagger", tierMetal(id), tierBody(id))], { rotation: [0, 0, -0.32] });
    continue;
  }
  if (/_ring$/.test(id)) {
    put(id, [primitive("ring", tierMetal(id), tierAccent(id))]);
    continue;
  }
  if (/_pendant$|_charm$/.test(id)) {
    put(id, [primitive("amulet", tierMetal(id), tierAccent(id))]);
    continue;
  }

  const gear = gearAppearanceParts(id);
  if (gear.length === 0) throw new Error(`Equipment icon has neither worn geometry nor a proxy: ${id}`);
  put(
    id,
    gear.map((part) => ({
      kind: "asset" as const,
      assetId: part.assetId,
      ...(part.tint === undefined ? {} : { colour: part.tint }),
      ...(part.accent === undefined ? {} : { accent: part.accent }),
      ...(part.scale === undefined ? {} : { scale: part.scale }),
    })),
    {
      rotation: item.equip?.slot === "mainHand" ? [0, 0, -0.22] : undefined,
    },
  );
}

const missing = ALL_ITEMS.filter((item) => !APPEARANCES.has(item.id)).map((item) => item.id);
if (missing.length > 0) throw new Error(`Items without icon appearances: ${missing.join(", ")}`);
if (APPEARANCES.size !== ALL_ITEMS.length) {
  throw new Error(`Item icon appearance count ${APPEARANCES.size} does not match item count ${ALL_ITEMS.length}`);
}

export const ITEM_ICON_APPEARANCE_IDS: readonly ItemId[] = [...APPEARANCES.keys()];

export function itemIconAppearance(itemId: ItemId): ItemIconAppearance {
  const appearance = APPEARANCES.get(itemId);
  if (!appearance) throw new Error(`No item icon appearance for ${itemId}`);
  return appearance;
}

export function itemIconAssetIds(): readonly string[] {
  const ids = new Set<string>();
  for (const appearance of APPEARANCES.values()) {
    for (const part of appearance.parts) if (part.kind === "asset") ids.add(part.assetId);
  }
  return [...ids].sort();
}
