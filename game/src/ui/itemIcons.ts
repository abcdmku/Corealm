/**
 * Item icons, drawn rather than shipped.
 *
 * Phase 1 put two letters of the item's name in a coloured square, which is legible and tells you
 * nothing: at 40 px a bank of 28 slots was 28 tiles of text, and "GO" for Grithe Ore reads no
 * faster than "GB" for Grithe Bar. No icon art exists in any of the CC0 packs the game uses, and
 * commissioning 102 sprites is not a Phase 1 job — so the icons are vector shapes authored here,
 * one per role, on a 24x24 grid.
 *
 * A shape is chosen by what the item DOES, in this order:
 *
 *   1. The equipment slot it goes in — a sword, a shield, a helm, a boot. Equipment is the largest
 *      category and the one where "which of these am I looking at" matters most.
 *   2. What it heals, plants, buys or builds — food, seed, currency, tool, component.
 *   3. Its raw category, for anything left over.
 *
 * Colour still comes from `itemGlyphColour`, so tier and category hue are unchanged; the shape is
 * what is new. Every path is a filled outline with no strokes, which stays readable at 26 px in the
 * shop list and at 44 px in the bank.
 */
import type { EquipSlot, ItemCategory, ItemDef } from "../contracts.js";

export type IconShape =
  | "helm" | "cuirass" | "greaves" | "boot" | "glove" | "sword" | "shield" | "ring"
  | "ore" | "bar" | "food" | "tool" | "seed" | "scroll" | "coin" | "shard" | "log";

/** Filled paths on a 24x24 viewBox. Two paths where a silhouette needs a cut-out or a second mass. */
const PATHS: Record<IconShape, string[]> = {
  helm: [
    "M12 2.5c-4.6 0-8 3.6-8 8.2V19h5.2v-4.2h5.6V19H20v-8.3c0-4.6-3.4-8.2-8-8.2z",
    "M9.4 8.6h5.2v3.1H9.4z",
  ],
  cuirass: [
    "M8.6 3 4 6.2v13.6h16V6.2L15.4 3 12 5.6z",
    "M10.4 9h3.2v7.4h-3.2z",
  ],
  greaves: [
    "M6.6 3h10.8v6.4l-1.9 11.6h-3.1L12 13.6l-1.4 7.4H7.5L6.6 9.4z",
  ],
  boot: [
    "M7 3h5.2v9.4l7.8 4.3V21H7z",
  ],
  glove: [
    "M6 10.6V5.4a1.5 1.5 0 0 1 3 0v3.8h.9V4.2a1.5 1.5 0 0 1 3 0v5h.9V6.1a1.5 1.5 0 0 1 3 0v9.2A5.7 5.7 0 0 1 11.1 21H10a4 4 0 0 1-4-4z",
  ],
  sword: [
    "M17.6 2.2 20 4.6 10.8 15.4 8.4 13z",
    "M7.5 13.9 10.1 16.5 7.9 18.7 9 19.8 7.6 21.2 3 16.6 4.4 15.2 5.5 16.3z",
  ],
  shield: [
    "M12 2.2 20 5v6.6c0 5.1-3.9 8.4-8 10.2-4.1-1.8-8-5.1-8-10.2V5z",
  ],
  ring: [
    "M12 6.6a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2zm0 3.2a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z",
    "M12 1.8 15 5.4 12 8 9 5.4z",
  ],
  ore: [
    "M8.6 3.6 16 4.8l3.6 6.4-4.4 8.2-8.8-1.4L3 10.4z",
    "M10.4 8.2h3.8l1.2 3.6-2.8 3-3-2.2z",
  ],
  bar: [
    "M6.2 8h11.6l2.6 3.6H3.6z",
    "M4.2 13.4h15.6l2.4 3.6H1.8z",
  ],
  food: [
    "M2.4 12c3.8-5.6 11.4-5.6 15.2 0-3.8 5.6-11.4 5.6-15.2 0z",
    "M17.8 12 22 7.8v8.4z",
  ],
  tool: [
    "M2.6 8.4c6.2-4.4 12.6-4.4 18.8 0-6.2 1.2-12.6 1.2-18.8 0z",
    "M10.6 8.2h2.8l1 12.8h-4.8z",
  ],
  seed: [
    "M12.9 21h-1.8v-7.2c3.4.1 6.6-2.2 7.6-5.7-3.9-.7-7.3 1.6-7.6 5V21z",
    "M11.1 13.2C10.5 10.3 7.7 8.4 4.8 8.9c.4 2.9 3 5 5.9 4.8z",
  ],
  scroll: [
    "M5.4 2.6h13.2v18.8H5.4z",
    "M7.8 6.6h8.4v1.8H7.8zm0 4h8.4v1.8H7.8zm0 4h5.6v1.8H7.8z",
  ],
  coin: [
    "M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 0 0 0-18.8zm0 3a6.4 6.4 0 1 1 0 12.8 6.4 6.4 0 0 1 0-12.8z",
    "M10.6 8.4h2.8v7.2h-2.8z",
  ],
  shard: [
    "M12 1.8 18.4 9.6 12 22.2 5.6 9.6z",
  ],
  log: [
    "M4 7.4h11.6a4.6 4.6 0 0 1 0 9.2H4z",
    "M4 7.4a4.6 4.6 0 0 0 0 9.2 4.6 4.6 0 0 0 0-9.2zm0 3a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
  ],
};

const BY_EQUIP_SLOT: Record<EquipSlot, IconShape> = {
  head: "helm",
  body: "cuirass",
  legs: "greaves",
  feet: "boot",
  hands: "glove",
  mainHand: "sword",
  offHand: "shield",
  accessory1: "ring",
  accessory2: "ring",
};

const BY_CATEGORY: Record<ItemCategory, IconShape> = {
  resource: "ore",
  bar: "bar",
  equipment: "sword",
  food: "food",
  tool: "tool",
  seed: "seed",
  quest: "scroll",
  currency: "coin",
  component: "shard",
};

/** Ids whose category is too broad to pick a shape from. Woodcutting drops are not ore. */
const LOG_ITEM = /_log$|_plank|_shaft$/;

export function iconShapeFor(def: ItemDef | undefined): IconShape {
  if (!def) return "shard";
  if (def.equip) return BY_EQUIP_SLOT[def.equip.slot];
  if (def.category === "resource" && LOG_ITEM.test(def.id)) return "log";
  return BY_CATEGORY[def.category] ?? "shard";
}

/**
 * The icon as an inline SVG string.
 *
 * Returned as markup rather than as elements because every caller drops it into a slot that is
 * rebuilt wholesale on refresh, and building four DOM nodes per slot across a 400-slot bank is
 * measurably slower than one `innerHTML` write per slot.
 */
export function itemIconSvg(def: ItemDef | undefined): string {
  const paths = PATHS[iconShapeFor(def)]
    .map((d) => `<path d="${d}" />`)
    .join("");
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
}
