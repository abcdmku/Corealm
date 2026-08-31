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
  | "dagger"
  | "essence"
  | "fish"
  | "handle"
  | "hide"
  | "ingot"
  | "log"
  | "orb"
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
};

/** Exact solid colours used by the worn Blink meshes in equipmentVisuals.ts. */
const MAGIC_WOOD: Readonly<Record<number, number>> = {
  0: 0x8a5a32,
  1: 0xd7bd8e,
  5: 0x53341f,
  10: 0x596162,
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

for (const id of ["palewood_log", "duskoak_log", "cairnpine_log"] as const) {
  put(id, [primitive("log", wood(id), tierBody(id))], { rotation: [0, 0, -0.2] });
}

put("silt_minnow", [primitive("fish", 0x7f98a3, 0xc4d4d7)]);
put("bramble_trout", [primitive("fish", 0x4f5962, 0x9d6d54)]);
put("cragfin", [primitive("fish", 0x53697b, 0xb9c4c5)]);
put("bittergrain", [asset("grass_wispy_tall", 0xc6a75a)]);
put("duskberry", [asset("bush_common", 0x644477)]);
put("cairnleaf", [asset("plant_broad_large", 0x8e978d)]);

// Processed resources and components.
for (const id of ["grithe_bar", "corven_bar", "kaldite_bar"] as const) {
  put(id, [primitive("ingot", tierMetal(id), tierBody(id))]);
}

put("pale_quartz", [asset("ore_crystal_blue", 0xe3ded2)]);
put("vell_amber", [asset("ore_crystal_green", 0xc47b2b)]);
put("cairn_garnet", [asset("ore_crystal_pink", 0x8e2337)]);
for (const id of ["palewood_shaft", "duskoak_shaft", "cairnpine_shaft"] as const) {
  put(id, [primitive("shaft", wood(id), tierMetal(id))], { rotation: [0, 0, -0.25] });
}
for (const id of ["palewood_handle", "duskoak_handle", "cairnpine_handle"] as const) {
  put(id, [primitive("handle", wood(id), tierBody(id))], { rotation: [0, 0, -0.3], frameScale: 1.08 });
}
put("coarse_hide", [primitive("hide", 0x9a7654, 0x5b4432)]);
put("bramble_hide", [primitive("hide", 0x65503d, 0x362d26)]);
put("wight_shroud", [primitive("hide", 0xb6b4aa, 0x686b70)]);

/** Element colour stays consistent between the loose essence and the boss-won orb. */
const ELEMENT_COLOURS = {
  air: { body: 0x78cce8, glow: 0xd8f7ff },
  earth: { body: 0x668c43, glow: 0xb9d66b },
  water: { body: 0x327fc2, glow: 0xa9e6ff },
} as const;

for (const element of ["air", "earth", "water"] as const) {
  const colours = ELEMENT_COLOURS[element];
  put(`${element}_essence`, [primitive("essence", colours.body, colours.glow)], { frameScale: 1.2 });
}

// Seeds and food. Raw and cooked fish share a model, while colour carries preparation state.
put("bittergrain_seed", [primitive("seed", 0xc9a65a, 0x765829)]);
put("duskberry_seed", [primitive("seed", 0x6a477e, 0x9d7ab0)]);
put("cairnleaf_seed", [primitive("seed", 0x9aa397, 0x56645e)]);
put("seared_minnow", [primitive("fish", 0xc58a54, 0xf0c781)]);
put("burnt_minnow", [primitive("fish", 0x3b3029, 0x72533d)]);
put("seared_trout", [primitive("fish", 0xa76a48, 0xdfad70)]);
put("burnt_trout", [primitive("fish", 0x312925, 0x654837)]);
put("seared_cragfin", [primitive("fish", 0x9e704f, 0xe3b877)]);
put("burnt_cragfin", [primitive("fish", 0x282322, 0x59443a)]);

// Tools use the authored meshes where the library has them. Fishing rods are purpose-built.
for (const id of ["worn_pickaxe", "grithe_pickaxe", "corven_pickaxe", "kaldite_pickaxe"] as const) {
  put(id, [asset("pickaxe", id === "worn_pickaxe" ? 0x6d6256 : tierMetal(id))], { rotation: [0, 0, -0.28] });
}
for (const id of ["worn_hatchet", "grithe_hatchet", "corven_hatchet", "kaldite_hatchet"] as const) {
  put(id, [asset("axe", id === "worn_hatchet" ? 0x6d6256 : tierMetal(id))], { rotation: [0, 0, -0.28] });
}
for (const id of ["worn_rod", "palewood_rod", "duskoak_rod", "cairnpine_rod"] as const) {
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
for (const item of ALL_ITEMS.filter((entry) => entry.category === "equipment")) {
  const id = item.id;
  if (item.magicWeapon) {
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
