/**
 * Curates the downloaded Quaternius CC0 packs in .asset-cache/ into optimized,
 * self-contained GLB files under game/public/assets/models/<category>/, plus
 * game/public/assets/manifest.json which the game reads at runtime.
 *
 * Design notes:
 * - Reads straight out of the zips. Nothing is unpacked to disk, so a re-run
 *   costs nothing when the outputs are already current.
 * - No zip dependency: a minimal central-directory reader lives in this file,
 *   because the repo has no declared zip package and this tool may not add one.
 * - Optimization is aggressive on purpose. The source packs ship 1-4 MB PBR
 *   normal/roughness/ORM maps; this art style only needs base colour, so every
 *   other map is dropped and base colour is capped at 512x512.
 * - Idempotent: a state file records the inputs and options that produced each
 *   GLB. Unchanged entries are reused and their measured metadata is replayed
 *   into the manifest, so nothing is rebuilt or corrupted on a second run.
 *
 * Usage:
 *   npx tsx tools/build-assets.ts            build (incremental)
 *   npx tsx tools/build-assets.ts --force    rebuild everything
 *   npx tsx tools/build-assets.ts --check    confirm every catalog source exists
 *   npx tsx tools/build-assets.ts --verify   parse every manifest GLB and report
 *   npx tsx tools/build-assets.ts --probe <zip-key> <substring>   inspect sources
 */
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { open, mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { Document, Logger, NodeIO, type JSONDocument } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, resample, quantize, textureCompress, getBounds } from "@gltf-transform/functions";
import sharp from "sharp";
import { repoRoot, gameRoot } from "./lib/paths.js";

// ---------------------------------------------------------------------------
// Minimal ZIP reader (central directory + per-entry inflate, ZIP64 aware)
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  /** CRC-32 from the central directory: a free content fingerprint. */
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;

class ZipArchive {
  private constructor(
    readonly file: string,
    private readonly handle: FileHandle,
    readonly entries: Map<string, ZipEntry>,
  ) {}

  static async open(file: string): Promise<ZipArchive> {
    const handle = await open(file, "r");
    try {
      const size = (await handle.stat()).size;
      const tailLength = Math.min(size, 66_560);
      const tail = Buffer.alloc(tailLength);
      await handle.read(tail, 0, tailLength, size - tailLength);

      let eocd = -1;
      for (let i = tail.length - 22; i >= 0; i -= 1) {
        if (tail.readUInt32LE(i) === SIG_EOCD) {
          eocd = i;
          break;
        }
      }
      if (eocd < 0) throw new Error(`Not a zip file (no end-of-central-directory): ${file}`);

      let count = tail.readUInt16LE(eocd + 10);
      let centralOffset = tail.readUInt32LE(eocd + 16);
      let centralSize = tail.readUInt32LE(eocd + 12);

      if (count === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
        let locator = -1;
        for (let i = eocd - 20; i >= 0; i -= 1) {
          if (tail.readUInt32LE(i) === SIG_EOCD64_LOCATOR) {
            locator = i;
            break;
          }
        }
        if (locator < 0) throw new Error(`ZIP64 archive without a locator: ${file}`);
        const eocd64Offset = Number(tail.readBigUInt64LE(locator + 8));
        const header = Buffer.alloc(56);
        await handle.read(header, 0, 56, eocd64Offset);
        if (header.readUInt32LE(0) !== SIG_EOCD64) throw new Error(`Bad ZIP64 record: ${file}`);
        count = Number(header.readBigUInt64LE(32));
        centralSize = Number(header.readBigUInt64LE(40));
        centralOffset = Number(header.readBigUInt64LE(48));
      }

      const central = Buffer.alloc(centralSize);
      await handle.read(central, 0, centralSize, centralOffset);

      const entries = new Map<string, ZipEntry>();
      let cursor = 0;
      for (let i = 0; i < count; i += 1) {
        if (central.readUInt32LE(cursor) !== SIG_CENTRAL) break;
        const method = central.readUInt16LE(cursor + 10);
        const crc = central.readUInt32LE(cursor + 16);
        let compressedSize = central.readUInt32LE(cursor + 20);
        let uncompressedSize = central.readUInt32LE(cursor + 24);
        const nameLength = central.readUInt16LE(cursor + 28);
        const extraLength = central.readUInt16LE(cursor + 30);
        const commentLength = central.readUInt16LE(cursor + 32);
        let localHeaderOffset = central.readUInt32LE(cursor + 42);
        const name = central.toString("utf8", cursor + 46, cursor + 46 + nameLength);

        // ZIP64 extended information overrides the 0xFFFFFFFF placeholders.
        const extraStart = cursor + 46 + nameLength;
        let extra = extraStart;
        while (extra + 4 <= extraStart + extraLength) {
          const fieldId = central.readUInt16LE(extra);
          const fieldSize = central.readUInt16LE(extra + 2);
          if (fieldId === 0x0001) {
            let field = extra + 4;
            if (uncompressedSize === 0xffffffff) {
              uncompressedSize = Number(central.readBigUInt64LE(field));
              field += 8;
            }
            if (compressedSize === 0xffffffff) {
              compressedSize = Number(central.readBigUInt64LE(field));
              field += 8;
            }
            if (localHeaderOffset === 0xffffffff) localHeaderOffset = Number(central.readBigUInt64LE(field));
          }
          extra += 4 + fieldSize;
        }

        if (!name.endsWith("/")) {
          entries.set(name, { name, method, crc, compressedSize, uncompressedSize, localHeaderOffset });
        }
        cursor = extraStart + extraLength + commentLength;
      }
      return new ZipArchive(file, handle, entries);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async read(name: string): Promise<Buffer> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Missing zip entry: ${name} (in ${path.basename(this.file)})`);
    const local = Buffer.alloc(30);
    await this.handle.read(local, 0, 30, entry.localHeaderOffset);
    const nameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const raw = Buffer.alloc(entry.compressedSize);
    await this.handle.read(raw, 0, entry.compressedSize, dataOffset);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`Unsupported zip compression method ${entry.method} for ${name}`);
  }

  close(): Promise<void> {
    return this.handle.close();
  }
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

interface PackDef {
  id: string;
  name: string;
  author: string;
  source: string;
  license: string;
  zip: string;
  /** Directory inside the zip that holds the .gltf files, used for catalog paths. */
  root: string;
}

const PACKS: PackDef[] = [
  {
    id: "stylized-nature-megakit",
    name: "Stylized Nature MegaKit",
    author: "Quaternius",
    source: "https://quaternius.itch.io/stylized-nature-megakit",
    license: "CC0-1.0",
    zip: "Stylized_Nature_MegaKit[Standard].zip",
    root: "glTF/",
  },
  {
    id: "medieval-village-megakit",
    name: "Medieval Village MegaKit",
    author: "Quaternius",
    source: "https://quaternius.itch.io/medieval-village-megakit",
    license: "CC0-1.0",
    zip: "Medieval_Village_MegaKit[Standard].zip",
    root: "Medieval Village MegaKit[Standard]/glTF/",
  },
  {
    id: "fantasy-props-megakit",
    name: "Fantasy Props MegaKit",
    author: "Quaternius",
    source: "https://quaternius.itch.io/fantasy-props-megakit",
    license: "CC0-1.0",
    zip: "Fantasy_Props_MegaKit[Standard].zip",
    root: "Exports/glTF/",
  },
  {
    id: "universal-base-characters",
    name: "Universal Base Characters",
    author: "Quaternius",
    source: "https://quaternius.itch.io/universal-base-characters",
    license: "CC0-1.0",
    zip: "Universal_Base_Characters[Standard].zip",
    root: "Universal Base Characters[Standard]/",
  },
  {
    id: "modular-character-outfits-fantasy",
    name: "Modular Character Outfits - Fantasy",
    author: "Quaternius",
    source: "https://quaternius.itch.io/modular-character-outfits-fantasy",
    license: "CC0-1.0",
    zip: "Modular_Character_Outfits_-_Fantasy[Standard].zip",
    root: "Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/",
  },
  {
    id: "ultimate-platformer-pack",
    name: "Ultimate Platformer Pack",
    author: "Quaternius",
    source: "https://quaternius.itch.io/ultimate-platformer-pack",
    license: "CC0-1.0",
    zip: "Ultimate_Platformer_Pack_by_Quaternius.zip",
    root: "Ultimate Platformer Pack - Dec 2021/",
  },
  {
    id: "universal-animation-library",
    name: "Universal Animation Library",
    author: "Quaternius",
    source: "https://quaternius.itch.io/universal-animation-library",
    license: "CC0-1.0",
    zip: "Universal_Animation_Library[Standard].zip",
    root: "Universal Animation Library[Standard]/Unreal-Godot/",
  },
  {
    id: "universal-animation-library-2",
    name: "Universal Animation Library 2",
    author: "Quaternius",
    source: "https://quaternius.itch.io/universal-animation-library-2",
    license: "CC0-1.0",
    zip: "Universal_Animation_Library_2[Standard].zip",
    root: "Universal Animation Library 2[Standard]/Unreal-Godot/",
  },
];

const PACK_BY_ID = new Map(PACKS.map((pack) => [pack.id, pack]));

type Category =
  | "nature"
  | "rock"
  | "building"
  | "prop"
  | "farm"
  | "dungeon"
  | "character"
  | "outfit"
  | "weapon"
  | "animation"
  | "water";

interface Pick {
  id: string;
  pack: string;
  /** Path relative to the pack root, without extension. */
  file: string;
  category: Category;
  tags: string[];
  /** Animation clip libraries keep their animations and lose their mesh. */
  animationLibrary?: boolean;
  /** Max texture edge; defaults to 512. */
  textureLimit?: number;
}

// ---------------------------------------------------------------------------
// Catalog
//
// Every entry below was chosen against the Phase 1 needs list.
//
// TAG ORDER IS A CONTRACT. The FIRST tag is what the mesh IS, and it is
// published separately as the manifest's `is` field. Every tag after it is an
// association: what the mesh contains, what it stands on, what it is used for,
// how it should be recoloured.
//
// This distinction cost a full round to learn. `anvil_log` is
// ["anvil", "log", "stump", ...] because it is an anvil standing on a cut log.
// Phase 1 read "stump" off that list, and every felled tree in the world plus
// the landmark Rootfall is built around became a blacksmith's anvil. Adding a
// tag that describes a PART of the mesh is fine and useful; putting it first,
// or reading anything but the first as identity, is the bug.
//
// Look things up with `assets.byIs("stump")`, never `assets.byTags("stump")`.
// ---------------------------------------------------------------------------

const nature = (file: string, id: string, tags: string[], category: Category = "nature"): Pick => ({
  id,
  pack: "stylized-nature-megakit",
  file,
  category,
  tags,
});
const village = (file: string, id: string, category: Category, tags: string[]): Pick => ({
  id,
  pack: "medieval-village-megakit",
  file,
  category,
  tags,
});
const props = (file: string, id: string, category: Category, tags: string[]): Pick => ({
  id,
  pack: "fantasy-props-megakit",
  file,
  category,
  tags,
});
const platformer = (file: string, id: string, category: Category, tags: string[]): Pick => ({
  id,
  pack: "ultimate-platformer-pack",
  file,
  category,
  tags,
});

const CATALOG: Pick[] = [
  // --- nature: trees -------------------------------------------------------
  nature("CommonTree_1", "tree_common_1", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("CommonTree_2", "tree_common_2", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("CommonTree_3", "tree_common_3", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("CommonTree_4", "tree_common_4", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("CommonTree_5", "tree_common_5", ["tree", "broadleaf", "common", "forest", "plains"]),
  nature("Pine_1", "tree_pine_1", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("Pine_2", "tree_pine_2", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("Pine_3", "tree_pine_3", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("Pine_4", "tree_pine_4", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("Pine_5", "tree_pine_5", ["tree", "pine", "conifer", "woodland", "highlands"]),
  nature("DeadTree_1", "tree_dead_1", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("DeadTree_2", "tree_dead_2", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("DeadTree_3", "tree_dead_3", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("DeadTree_4", "tree_dead_4", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("DeadTree_5", "tree_dead_5", ["tree", "dead", "bare", "woodland", "dungeon"]),
  nature("TwistedTree_1", "tree_twisted_1", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),
  nature("TwistedTree_2", "tree_twisted_2", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),
  nature("TwistedTree_3", "tree_twisted_3", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),
  nature("TwistedTree_4", "tree_twisted_4", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),
  nature("TwistedTree_5", "tree_twisted_5", ["tree", "twisted", "gnarled", "woodland", "deep-woodland"]),

  // --- nature: undergrowth -------------------------------------------------
  nature("Bush_Common", "bush_common", ["bush", "shrub", "undergrowth"]),
  nature("Bush_Common_Flowers", "bush_flowering", ["bush", "shrub", "flower", "undergrowth"]),
  nature("Fern_1", "fern_1", ["fern", "undergrowth", "woodland"]),
  nature("Plant_1", "plant_leafy_small", ["plant", "leafy", "undergrowth"]),
  nature("Plant_1_Big", "plant_leafy_large", ["plant", "leafy", "undergrowth"]),
  nature("Plant_7", "plant_broad_small", ["plant", "broadleaf", "undergrowth"]),
  nature("Plant_7_Big", "plant_broad_large", ["plant", "broadleaf", "undergrowth"]),
  nature("Grass_Common_Short", "grass_common_short", ["grass", "ground-cover", "plains"]),
  nature("Grass_Common_Tall", "grass_common_tall", ["grass", "ground-cover", "plains"]),
  nature("Grass_Wispy_Short", "grass_wispy_short", ["grass", "ground-cover", "plains"]),
  nature("Grass_Wispy_Tall", "grass_wispy_tall", ["grass", "ground-cover", "plains"]),
  nature("Clover_1", "clover_1", ["clover", "ground-cover", "plains"]),
  nature("Clover_2", "clover_2", ["clover", "ground-cover", "plains"]),
  nature("Flower_3_Single", "flower_a_single", ["flower", "ground-cover", "plains"]),
  nature("Flower_3_Group", "flower_a_group", ["flower", "ground-cover", "plains"]),
  nature("Flower_4_Single", "flower_b_single", ["flower", "ground-cover", "plains"]),
  nature("Flower_4_Group", "flower_b_group", ["flower", "ground-cover", "plains"]),
  nature("Mushroom_Common", "mushroom_common", ["mushroom", "forage", "woodland", "gatherable"]),
  nature("Mushroom_Laetiporus", "mushroom_bracket", ["mushroom", "forage", "woodland", "gatherable"]),

  // --- rock: loose stone, boulders, ore hosts ------------------------------
  nature("Rock_Medium_1", "rock_medium_1", ["rock", "stone", "ore", "ore-node", "minable", "recolour"], "rock"),
  nature("Rock_Medium_2", "rock_medium_2", ["rock", "stone", "ore", "ore-node", "minable", "recolour"], "rock"),
  nature("Rock_Medium_3", "rock_medium_3", ["rock", "stone", "ore", "ore-node", "minable", "recolour"], "rock"),
  nature("Pebble_Square_1", "rock_small_1", ["rock", "stone", "pebble", "small", "ore-node", "recolour"], "rock"),
  nature("Pebble_Square_4", "rock_small_2", ["rock", "stone", "pebble", "small", "ore-node", "recolour"], "rock"),
  nature("Pebble_Round_2", "pebble_round_1", ["rock", "stone", "pebble", "scatter"], "rock"),
  nature("Pebble_Round_5", "pebble_round_2", ["rock", "stone", "pebble", "scatter"], "rock"),
  nature("RockPath_Round_Wide", "path_rock_round_wide", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Round_Thin", "path_rock_round_thin", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Square_Wide", "path_rock_square_wide", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Square_Thin", "path_rock_square_thin", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Round_Small_1", "path_rock_small_1", ["path", "road", "ground", "stone"], "rock"),
  nature("RockPath_Square_Small_2", "path_rock_small_2", ["path", "road", "ground", "stone"], "rock"),

  // --- rock: cliffs and boulders (platformer pack; chunkier silhouettes) ----
  platformer("Nature/glTF/RockPlatforms_Large", "boulder_large", "rock", [
    "boulder", "cliff", "rock", "highlands", "large", "placeholder-style",
  ]),
  platformer("Nature/glTF/RockPlatforms_Medium", "boulder_medium", "rock", [
    "boulder", "cliff", "rock", "highlands", "placeholder-style",
  ]),
  platformer("Nature/glTF/RockPlatform_Tall", "cliff_tall", "rock", [
    "cliff", "boulder", "rock", "highlands", "tall", "placeholder-style",
  ]),
  platformer("Nature/glTF/RockPlatforms_1", "cliff_step_1", "rock", ["cliff", "rock", "highlands", "placeholder-style"]),
  platformer("Nature/glTF/RockPlatforms_2", "cliff_step_2", "rock", ["cliff", "rock", "highlands", "placeholder-style"]),
  platformer("Nature/glTF/RockPlatforms_3", "cliff_step_3", "rock", ["cliff", "rock", "highlands", "placeholder-style"]),
  platformer("Level and Mechanics/glTF/Bridge_Small", "bridge_small", "building", [
    "bridge", "crossing", "water", "river", "wood", "placeholder-style",
  ]),
  platformer("Level and Mechanics/glTF/Bridge_Modular", "bridge_modular_end", "building", [
    "bridge", "crossing", "water", "river", "wood", "modular", "placeholder-style",
  ]),
  platformer("Level and Mechanics/glTF/Bridge_Modular_Center", "bridge_modular_center", "building", [
    "bridge", "crossing", "water", "river", "wood", "modular", "placeholder-style",
  ]),
  platformer("Powerups and Pickups/glTF/Gem_Blue", "ore_crystal_blue", "rock", [
    "ore", "ore-node", "crystal", "gem", "minable", "recolour", "placeholder-style",
  ]),
  platformer("Powerups and Pickups/glTF/Gem_Green", "ore_crystal_green", "rock", [
    "ore", "ore-node", "crystal", "gem", "minable", "recolour", "placeholder-style",
  ]),
  platformer("Powerups and Pickups/glTF/Gem_Pink", "ore_crystal_pink", "rock", [
    "ore", "ore-node", "crystal", "gem", "minable", "recolour", "placeholder-style",
  ]),

  // --- building: modular village shell -------------------------------------
  village("Wall_Plaster_Straight", "wall_plaster_straight", "building", ["wall", "plaster", "house", "modular", "village"]),
  village("Wall_Plaster_Straight_Base", "wall_plaster_base", "building", ["wall", "plaster", "house", "modular", "village"]),
  village("Wall_Plaster_Door_Round", "wall_plaster_door", "building", ["wall", "door", "plaster", "house", "modular"]),
  village("Wall_Plaster_Window_Wide_Round", "wall_plaster_window", "building", ["wall", "window", "plaster", "house", "modular"]),
  village("Wall_Plaster_WoodGrid", "wall_plaster_timber", "building", ["wall", "timber", "plaster", "house", "modular"]),
  village("Wall_UnevenBrick_Straight", "wall_brick_straight", "building", ["wall", "brick", "stone", "modular", "dungeon", "tower"]),
  village("Wall_UnevenBrick_Door_Round", "wall_brick_door", "building", ["wall", "door", "brick", "stone", "modular", "dungeon"]),
  village("Wall_UnevenBrick_Window_Wide_Round", "wall_brick_window", "building", ["wall", "window", "brick", "stone", "modular"]),
  village("Wall_Arch", "wall_arch", "dungeon", ["arch", "stone", "gate", "gateway", "dungeon", "ruins", "modular"]),
  village("Wall_BottomCover", "wall_bottom_trim", "building", ["wall", "trim", "modular"]),
  village("Corner_Exterior_Brick", "corner_brick", "building", ["corner", "brick", "stone", "modular", "dungeon"]),
  village("Corner_Exterior_Wood", "corner_wood", "building", ["corner", "timber", "modular"]),
  village("Corner_Interior_Small", "corner_interior", "building", ["corner", "interior", "modular"]),
  village("Door_1_Round", "door_round_1", "building", ["door", "entrance", "house"]),
  village("Door_4_Round", "door_round_2", "building", ["door", "entrance", "house", "shop"]),
  village("Door_8_Flat", "door_flat_1", "building", ["door", "entrance", "house"]),
  village("DoorFrame_Round_WoodDark", "door_frame_round", "building", ["door", "frame", "entrance", "modular"]),
  village("Window_Wide_Round1", "window_wide", "building", ["window", "house", "modular"]),
  village("Window_Thin_Round1", "window_thin", "building", ["window", "house", "modular"]),
  village("WindowShutters_Wide_Round_Open", "window_shutters", "building", ["window", "shutters", "house"]),
  village("Roof_RoundTiles_6x8", "roof_tiles_6x8", "building", ["roof", "tiles", "house", "modular"]),
  village("Roof_RoundTiles_6x12", "roof_tiles_6x12", "building", ["roof", "tiles", "house", "modular"]),
  village("Roof_RoundTiles_4x6", "roof_tiles_4x6", "building", ["roof", "tiles", "cottage", "modular"]),
  village("Roof_Front_Brick6", "roof_gable_brick", "building", ["roof", "gable", "brick", "modular"]),
  village("Roof_Wooden_2x1", "roof_wood_plank", "building", ["roof", "wood", "shed", "stall", "modular"]),
  village("Roof_Tower_RoundTiles", "roof_tower", "building", ["roof", "tower", "spire", "tiles"]),
  village("Roof_Dormer_RoundTile", "roof_dormer", "building", ["roof", "dormer", "house"]),
  village("Roof_Log", "roof_log", "building", ["log", "beam", "timber", "roof"]),
  village("Floor_WoodDark", "floor_wood", "building", ["floor", "wood", "plank", "dock", "pier", "modular"]),
  village("Floor_WoodLight", "floor_wood_light", "building", ["floor", "wood", "plank", "dock", "pier", "modular"]),
  village("Floor_Brick", "floor_brick", "building", ["floor", "brick", "road", "path", "modular", "dungeon"]),
  village("Floor_UnevenBrick", "floor_cobble", "building", ["floor", "cobble", "road", "path", "modular", "dungeon"]),
  village("Balcony_Simple_Straight", "balcony_straight", "building", ["balcony", "railing", "modular"]),
  village("Balcony_Simple_Corner", "balcony_corner", "building", ["balcony", "railing", "modular"]),
  village("Stairs_Exterior_Straight", "stairs_exterior", "building", ["stairs", "steps", "modular"]),
  village("Stair_Interior_Solid", "stairs_stone", "building", ["stairs", "steps", "stone", "dungeon", "modular"]),
  village("Overhang_Roof_UnevenBricks", "overhang_brick", "building", ["overhang", "brick", "trim", "modular"]),
  village("Overhang_Plaster_Long", "overhang_plaster", "building", ["overhang", "plaster", "trim", "modular"]),

  // --- village props from the village kit ----------------------------------
  village("Prop_WoodenFence_Single", "fence_wood_single", "prop", ["fence", "wood", "farm", "village"]),
  village("Prop_WoodenFence_Extension1", "fence_wood_extension", "prop", ["fence", "wood", "farm", "village"]),
  village("Prop_MetalFence_Simple", "fence_metal", "prop", ["fence", "metal", "railing", "village"]),
  village("Prop_MetalFence_Ornament", "fence_metal_ornate", "prop", ["fence", "metal", "gate", "railing", "village"]),
  village("Prop_Wagon", "wagon", "prop", ["wagon", "cart", "market", "village"]),
  village("Prop_Crate", "crate_village", "prop", ["crate", "box", "storage", "village"]),
  village("Prop_Chimney", "chimney", "prop", ["chimney", "roof", "house"]),
  village("Prop_Support", "support_beam", "prop", ["beam", "post", "pillar", "support", "dock", "pier", "dungeon"]),
  village("Prop_Brick1", "rubble_brick_1", "dungeon", ["rubble", "brick", "debris", "ruins", "dungeon"]),
  village("Prop_Brick2", "rubble_brick_2", "dungeon", ["rubble", "brick", "debris", "ruins", "dungeon"]),
  village("Prop_Brick3", "rubble_brick_3", "dungeon", ["rubble", "brick", "debris", "ruins", "dungeon"]),
  village("Prop_Brick4", "rubble_brick_4", "dungeon", ["rubble", "brick", "debris", "ruins", "dungeon"]),
  village("Prop_Vine1", "vine_1", "nature", ["vine", "ivy", "overgrowth", "ruins", "dungeon"]),
  village("Prop_Vine5", "vine_2", "nature", ["vine", "ivy", "overgrowth", "ruins", "dungeon"]),
  village("Prop_ExteriorBorder_Straight1", "kerb_straight", "building", ["kerb", "border", "road", "path", "modular"]),
  village("Prop_ExteriorBorder_Corner", "kerb_corner", "building", ["kerb", "border", "road", "path", "modular"]),

  // --- props: town, crafting, shop -----------------------------------------
  props("Anvil", "anvil", "prop", ["anvil", "smithing", "forge", "crafting", "station"]),
  props("Anvil_Log", "anvil_log", "prop", ["anvil", "log", "stump", "smithing", "forge", "crafting"]),
  props("Workbench", "workbench", "prop", ["workbench", "crafting", "station", "carpentry"]),
  props("Workbench_Drawers", "workbench_drawers", "prop", ["workbench", "crafting", "station", "carpentry"]),
  props("Cauldron", "cauldron", "prop", ["cauldron", "cooking", "pot", "campfire", "station", "alchemy"]),
  props("Pot_1", "cooking_pot", "prop", ["pot", "cooking", "campfire", "kitchen"]),
  // Ships Chest_Open/Close/Opened/Closed clips, so it works as a real bank UI prop.
  props("Chest_Wood", "chest_wood", "prop", ["chest", "bank", "storage", "loot", "container", "animated"]),
  props("Stall_Empty", "market_stall", "prop", ["stall", "market", "shop", "vendor", "counter"]),
  props("Stall_Cart_Empty", "market_stall_cart", "prop", ["stall", "cart", "market", "shop", "vendor"]),
  props("Table_Large", "table_large", "prop", ["table", "counter", "shop", "tavern", "furniture"]),
  props("Bench", "bench", "prop", ["bench", "seat", "furniture", "village"]),
  props("Stool", "stool", "prop", ["stool", "seat", "furniture"]),
  props("Chair_1", "chair", "prop", ["chair", "seat", "furniture"]),
  props("Barrel", "barrel", "prop", ["barrel", "storage", "container", "village", "dock", "fishing"]),
  props("Barrel_Apples", "barrel_apples", "prop", ["barrel", "apples", "food", "market", "farm"]),
  props("Barrel_Holder", "barrel_rack", "prop", ["barrel", "rack", "storage", "tavern"]),
  props("Crate_Wooden", "crate_wood", "prop", ["crate", "box", "storage", "container", "dock"]),
  props("Crate_Metal", "crate_metal", "prop", ["crate", "box", "storage", "container", "dungeon"]),
  props("Bag", "sack", "prop", ["sack", "bag", "storage", "market", "farm"]),
  props("Pouch_Large", "sack_large", "prop", ["sack", "pouch", "storage", "market", "farm"]),
  props("Bucket_Wooden_1", "bucket_wood", "prop", ["bucket", "well", "water", "farm"]),
  props("Bucket_Metal", "bucket_metal", "prop", ["bucket", "well", "water", "farm"]),
  props("Banner_1", "banner_1", "prop", ["banner", "flag", "heraldry", "village", "recolour"]),
  props("Banner_2", "banner_2", "prop", ["banner", "flag", "heraldry", "village", "recolour"]),
  props("Lantern_Wall", "lamp_wall", "prop", ["lamp", "lantern", "light", "wall", "village", "dungeon"]),
  props("Torch_Metal", "torch", "prop", ["torch", "brazier", "light", "fire", "dungeon"]),
  props("CandleStick_Stand", "candle_stand", "prop", ["candle", "light", "interior", "dungeon"]),
  props("Chandelier", "chandelier", "prop", ["chandelier", "light", "interior", "tavern"]),
  props("Bookcase_2", "bookcase", "prop", ["bookcase", "shelf", "library", "interior"]),
  props("Shelf_Simple", "shelf", "prop", ["shelf", "storage", "shop", "interior"]),
  props("Shelf_Small_Bottles", "shelf_bottles", "prop", ["shelf", "bottles", "shop", "alchemy", "interior"]),
  props("Cabinet", "cabinet", "prop", ["cabinet", "storage", "furniture", "interior"]),
  props("Bed_Twin1", "bed", "prop", ["bed", "inn", "furniture", "interior"]),
  props("Dummy", "training_dummy", "prop", ["dummy", "training", "combat", "village"]),
  props("WeaponStand", "weapon_rack", "prop", ["weapon", "rack", "stand", "shop", "smithing"]),
  props("Whetstone", "whetstone", "prop", ["whetstone", "smithing", "sharpening", "crafting"]),
  props("Rope_1", "rope_coil", "prop", ["rope", "dock", "fishing", "ship"]),
  props("Chain_Coil", "chain_coil", "prop", ["chain", "dungeon", "dock"]),
  props("Cage_Small", "cage", "prop", ["cage", "prison", "dungeon"]),
  props("Coin", "coin", "prop", ["coin", "gold", "currency", "loot"]),
  props("Coin_Pile", "coin_pile", "prop", ["coin", "gold", "currency", "loot", "treasure"]),
  props("Key_Metal", "key", "prop", ["key", "dungeon", "quest", "loot"]),
  props("Potion_1", "potion_1", "prop", ["potion", "flask", "alchemy", "loot", "recolour"]),
  props("Potion_2", "potion_2", "prop", ["potion", "flask", "alchemy", "loot", "recolour"]),
  props("Scroll_1", "scroll", "prop", ["scroll", "quest", "magic", "loot"]),
  props("Book_Stack_1", "book_stack", "prop", ["book", "library", "magic", "interior"]),
  props("Vase_Rubble_Medium", "rubble_vase", "dungeon", ["rubble", "debris", "pottery", "ruins", "dungeon"]),
  props("Bottle_1", "bottle", "prop", ["bottle", "tavern", "interior"]),
  props("Mug", "mug", "prop", ["mug", "tankard", "tavern", "interior"]),

  // --- farm ----------------------------------------------------------------
  props("FarmCrate_Empty", "farm_crate_empty", "farm", ["crate", "farm", "harvest", "container"]),
  props("FarmCrate_Carrot", "farm_crate_carrot", "farm", ["crate", "farm", "harvest", "carrot", "crop"]),
  props("FarmCrate_Apple", "farm_crate_apple", "farm", ["crate", "farm", "harvest", "apple", "crop"]),
  props("Carrot", "crop_carrot", "farm", ["carrot", "crop", "farm", "plant", "gatherable"]),

  // --- weapons and tools ---------------------------------------------------
  props("Sword_Bronze", "sword", "weapon", ["sword", "melee", "blade", "equip", "recolour"]),
  props("Axe_Bronze", "axe", "weapon", ["axe", "melee", "woodcutting", "tool", "equip", "recolour"]),
  props("Pickaxe_Bronze", "pickaxe", "weapon", ["pickaxe", "mining", "tool", "equip", "recolour"]),
  props("Shield_Wooden", "shield", "weapon", ["shield", "offhand", "defence", "equip"]),

  // --- characters ----------------------------------------------------------
  {
    id: "base_male",
    pack: "universal-base-characters",
    file: "Base Characters/Godot - UE/Superhero_Male_FullBody",
    category: "character",
    tags: ["character", "base", "humanoid", "male", "player", "npc", "rigged"],
  },
  {
    id: "base_female",
    pack: "universal-base-characters",
    file: "Base Characters/Godot - UE/Superhero_Female_FullBody",
    category: "character",
    tags: ["character", "base", "humanoid", "female", "player", "npc", "rigged"],
  },
  {
    id: "hair_short",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted",
    category: "character",
    tags: ["hair", "head", "customisation", "recolour"],
  },
  {
    id: "hair_long",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long",
    category: "character",
    tags: ["hair", "head", "customisation", "recolour"],
  },
  {
    id: "hair_buns",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buns",
    category: "character",
    tags: ["hair", "head", "customisation", "recolour"],
  },
  {
    id: "hair_buzzed",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buzzed",
    category: "character",
    tags: ["hair", "head", "customisation", "recolour"],
  },
  {
    id: "hair_beard",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Beard",
    category: "character",
    tags: ["hair", "beard", "face", "customisation", "recolour"],
  },
  {
    id: "eyebrows",
    pack: "universal-base-characters",
    file: "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Eyebrows_Regular",
    category: "character",
    tags: ["eyebrows", "face", "customisation"],
  },

  // --- enemies (animated, untextured; style is more cartoon than the kits) --
  platformer("Enemies/glTF/Enemy", "enemy_blob", "character", [
    "enemy", "monster", "animated", "tier1", "placeholder-style",
  ]),
  platformer("Enemies/glTF/Crab", "enemy_crab", "character", [
    "enemy", "monster", "animated", "crab", "tier1", "placeholder-style",
  ]),
  platformer("Enemies/glTF/Bee", "enemy_bee", "character", [
    "enemy", "monster", "animated", "flying", "insect", "tier5", "placeholder-style",
  ]),
  platformer("Enemies/glTF/Skull", "enemy_skull", "character", [
    "enemy", "monster", "animated", "undead", "skull", "dungeon", "tier10", "boss", "placeholder-style",
  ]),

  // --- outfits: full sets --------------------------------------------------
  {
    id: "outfit_male_peasant",
    pack: "modular-character-outfits-fantasy",
    file: "Outfits/Male_Peasant",
    category: "outfit",
    tags: ["outfit", "full", "peasant", "villager", "male", "npc", "starter"],
  },
  {
    id: "outfit_female_peasant",
    pack: "modular-character-outfits-fantasy",
    file: "Outfits/Female_Peasant",
    category: "outfit",
    tags: ["outfit", "full", "peasant", "villager", "female", "npc", "starter"],
  },
  {
    id: "outfit_male_ranger",
    pack: "modular-character-outfits-fantasy",
    file: "Outfits/Male_Ranger",
    category: "outfit",
    tags: ["outfit", "full", "ranger", "armour", "male", "player", "bandit"],
  },
  {
    id: "outfit_female_ranger",
    pack: "modular-character-outfits-fantasy",
    file: "Outfits/Female_Ranger",
    category: "outfit",
    tags: ["outfit", "full", "ranger", "armour", "female", "player", "bandit"],
  },
];

// Modular outfit parts, generated so the slot naming stays consistent.
const OUTFIT_PARTS: Array<[string, string, string[]]> = [
  ["Male_Peasant_Body", "outfit_male_peasant_chest", ["torso", "peasant", "male"]],
  ["Male_Peasant_Arms", "outfit_male_peasant_gloves", ["arms", "gloves", "peasant", "male"]],
  ["Male_Peasant_Legs", "outfit_male_peasant_legs", ["legs", "peasant", "male"]],
  ["Male_Peasant_Feet", "outfit_male_peasant_boots", ["feet", "boots", "peasant", "male"]],
  ["Male_Ranger_Body", "outfit_male_ranger_chest", ["torso", "ranger", "armour", "male"]],
  ["Male_Ranger_Arms", "outfit_male_ranger_gloves", ["arms", "gloves", "ranger", "armour", "male"]],
  ["Male_Ranger_Legs", "outfit_male_ranger_legs", ["legs", "ranger", "armour", "male"]],
  ["Male_Ranger_Feet_Boots", "outfit_male_ranger_boots", ["feet", "boots", "ranger", "armour", "male"]],
  ["Male_Ranger_Head_Hood", "outfit_male_ranger_hood", ["head", "helmet", "hood", "ranger", "male"]],
  ["Male_Ranger_Acc_Pauldron", "outfit_male_ranger_pauldron", ["shoulder", "pauldron", "ranger", "armour", "male"]],
  ["Female_Peasant_Body", "outfit_female_peasant_chest", ["torso", "peasant", "female"]],
  ["Female_Peasant_Arms", "outfit_female_peasant_gloves", ["arms", "gloves", "peasant", "female"]],
  ["Female_Peasant_Legs", "outfit_female_peasant_legs", ["legs", "peasant", "female"]],
  ["Female_Peasant_Feet", "outfit_female_peasant_boots", ["feet", "boots", "peasant", "female"]],
  ["Female_Ranger_Body", "outfit_female_ranger_chest", ["torso", "ranger", "armour", "female"]],
  ["Female_Ranger_Arms", "outfit_female_ranger_gloves", ["arms", "gloves", "ranger", "armour", "female"]],
  ["Female_Ranger_Legs", "outfit_female_ranger_legs", ["legs", "ranger", "armour", "female"]],
  ["Female_Ranger_Feet", "outfit_female_ranger_boots", ["feet", "boots", "ranger", "armour", "female"]],
  ["Female_Ranger_Head_Hood", "outfit_female_ranger_hood", ["head", "helmet", "hood", "ranger", "female"]],
  ["Female_Ranger_Acc_Pauldrons", "outfit_female_ranger_pauldron", ["shoulder", "pauldron", "ranger", "armour", "female"]],
];

for (const [file, id, tags] of OUTFIT_PARTS) {
  CATALOG.push({
    id,
    pack: "modular-character-outfits-fantasy",
    file: `Modular Parts/${file}`,
    category: "outfit",
    tags: ["outfit", "modular", "equip", ...tags],
  });
}

CATALOG.push(
  {
    id: "animation_library_1",
    pack: "universal-animation-library",
    file: "UAL1_Standard",
    category: "animation",
    tags: ["animation", "clips", "humanoid", "locomotion", "combat", "library", "in-place"],
    animationLibrary: true,
  },
  {
    id: "animation_library_2",
    pack: "universal-animation-library-2",
    file: "UAL2_Standard",
    category: "animation",
    tags: ["animation", "clips", "humanoid", "gathering", "crafting", "library", "in-place"],
    animationLibrary: true,
  },
);

// ---------------------------------------------------------------------------
// Manifest types (frozen contract, see runs/corealm/asset-report.md)
// ---------------------------------------------------------------------------

interface ManifestAsset {
  id: string;
  file: string;
  pack: string;
  category: Category;
  /** What the mesh IS. Always `tags[0]`; see the catalog note above the pick helpers. */
  is: string;
  tags: string[];
  bytes: number;
  size: { x: number; y: number; z: number };
  animations: string[];
  materials: string[];
}

interface Manifest {
  generatedAt: string;
  packs: Array<{ id: string; name: string; author: string; source: string; license: string }>;
  assets: ManifestAsset[];
}

interface BuildRecord {
  inputHash: string;
  optionsHash: string;
  sourceBytes: number;
  asset: ManifestAsset;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(repoRoot, ".asset-cache");
const OUT_DIR = path.join(gameRoot, "public", "assets");
const MODELS_DIR = path.join(OUT_DIR, "models");
const STATE_FILE = path.join(CACHE_DIR, "build-assets-state.json");

/** Bump when the transform pipeline changes so cached outputs are invalidated. */
const PIPELINE_VERSION = "1.3.0";
const TEXTURE_LIMIT = 512;
/** Categories the "no GLB over ~400 KB" budget applies to. */
const ENVIRONMENT_CATEGORIES = new Set<Category>(["nature", "rock", "building", "prop", "farm", "dungeon", "weapon"]);

// Quiet: textureCompress warns for every alpha texture it skips, by design.
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));

function sha1(...parts: Array<Buffer | string>): string {
  const hash = createHash("sha1");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const archives = new Map<string, ZipArchive>();
async function archive(packId: string): Promise<ZipArchive> {
  const pack = PACK_BY_ID.get(packId);
  if (!pack) throw new Error(`Unknown pack: ${packId}`);
  let existing = archives.get(packId);
  if (!existing) {
    existing = await ZipArchive.open(path.join(CACHE_DIR, pack.zip));
    archives.set(packId, existing);
  }
  return existing;
}

/** basename -> full entry path, for resolving relative .bin / texture URIs. */
const basenameIndex = new Map<string, Map<string, string[]>>();
function indexFor(packId: string, zip: ZipArchive): Map<string, string[]> {
  let index = basenameIndex.get(packId);
  if (index) return index;
  index = new Map();
  for (const name of zip.entries.keys()) {
    const base = name.slice(name.lastIndexOf("/") + 1);
    const list = index.get(base);
    if (list) list.push(name);
    else index.set(base, [name]);
  }
  basenameIndex.set(packId, index);
  return index;
}

function resolveResource(zip: ZipArchive, index: Map<string, string[]>, dir: string, uri: string): string | null {
  const decoded = decodeURIComponent(uri);
  const direct = `${dir}${decoded}`;
  if (zip.entries.has(direct)) return direct;
  const base = decoded.slice(decoded.lastIndexOf("/") + 1);
  const candidates = index.get(base);
  if (!candidates || candidates.length === 0) return null;
  // Prefer the shallowest path, and never a "Normals ..." variant folder.
  const ranked = [...candidates].sort((a, b) => {
    const penalty = (value: string) => (/Normals?[ _-]/i.test(value) ? 1 : 0);
    return penalty(a) - penalty(b) || a.split("/").length - b.split("/").length || a.length - b.length;
  });
  return ranked[0] ?? null;
}

/** 1x1 transparent PNG, used to stand in for maps this pipeline discards. */
const PLACEHOLDER_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function listUris(json: Record<string, unknown>, key: "buffers" | "images"): string[] {
  const list = json[key];
  if (!Array.isArray(list)) return [];
  const uris: string[] = [];
  for (const item of list) {
    const uri = (item as { uri?: string }).uri;
    if (typeof uri === "string" && uri && !uri.startsWith("data:")) uris.push(uri);
  }
  return [...new Set(uris)];
}

/** Image indices reachable through a material's baseColorTexture. */
function baseColorImageIndices(json: Record<string, unknown>): Set<number> {
  const textures = Array.isArray(json.textures) ? (json.textures as Array<{ source?: number }>) : [];
  const materials = Array.isArray(json.materials) ? (json.materials as Array<Record<string, unknown>>) : [];
  const indices = new Set<number>();
  for (const material of materials) {
    const pbr = material.pbrMetallicRoughness as { baseColorTexture?: { index?: number } } | undefined;
    const textureIndex = pbr?.baseColorTexture?.index;
    if (typeof textureIndex !== "number") continue;
    const source = textures[textureIndex]?.source;
    if (typeof source === "number") indices.add(source);
  }
  return indices;
}

interface LoadedSource {
  document: Document;
  inputHash: string;
  sourceBytes: number;
}

/** World-space bounding-box extent of a document's default scene, in metres. */
function measure(document: Document): { x: number; y: number; z: number } {
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return { x: 0, y: 0, z: 0 };
  const bounds = getBounds(scene);
  if (![...bounds.min, ...bounds.max].every((value) => Number.isFinite(value))) return { x: 0, y: 0, z: 0 };
  return {
    x: round(bounds.max[0] - bounds.min[0]),
    y: round(bounds.max[1] - bounds.min[1]),
    z: round(bounds.max[2] - bounds.min[2]),
  };
}

/**
 * What a single asset needs out of its zip: the glTF/GLB entry plus, for glTF,
 * every buffer and base-colour image it references. Resources that resolve to
 * null are the maps this pipeline discards; they get a 1x1 stand-in.
 */
interface SourcePlan {
  entry: string;
  binary: boolean;
  json?: Record<string, unknown>;
  resources: Array<{ uri: string; entry: string | null }>;
}

async function planSource(pick: Pick): Promise<{ zip: ZipArchive; plan: SourcePlan }> {
  const pack = PACK_BY_ID.get(pick.pack);
  if (!pack) throw new Error(`Unknown pack ${pick.pack} for ${pick.id}`);
  const zip = await archive(pick.pack);
  const index = indexFor(pick.pack, zip);

  const glbEntry = `${pack.root}${pick.file}.glb`;
  if (zip.entries.has(glbEntry)) {
    return { zip, plan: { entry: glbEntry, binary: true, resources: [] } };
  }

  const gltfEntry = `${pack.root}${pick.file}.gltf`;
  if (!zip.entries.has(gltfEntry)) throw new Error(`Missing source: ${gltfEntry} in ${pack.zip}`);
  const json = JSON.parse((await zip.read(gltfEntry)).toString("utf8")) as Record<string, unknown>;
  const dir = gltfEntry.slice(0, gltfEntry.lastIndexOf("/") + 1);

  const resources: Array<{ uri: string; entry: string | null }> = [];
  const seen = new Set<string>();

  for (const uri of listUris(json, "buffers")) {
    const resolved = resolveResource(zip, index, dir, uri);
    if (!resolved) throw new Error(`Cannot resolve buffer "${uri}" for ${pick.id} (${gltfEntry})`);
    resources.push({ uri, entry: resolved });
    seen.add(uri);
  }

  // Only base colour images are ever loaded. Normal/ORM/roughness maps are
  // stripped later anyway, so reading them would cost several MB per asset for
  // nothing -- and some packs (Universal Base Characters) reference normal maps
  // that are not actually in the zip. A 1x1 stand-in keeps the glTF readable,
  // and prune() removes the texture straight after.
  const baseColorImages = baseColorImageIndices(json);
  const images = Array.isArray(json.images) ? (json.images as Array<{ uri?: string }>) : [];
  for (let i = 0; i < images.length; i += 1) {
    const uri = images[i]?.uri;
    if (typeof uri !== "string" || !uri || uri.startsWith("data:") || seen.has(uri)) continue;
    seen.add(uri);
    resources.push({ uri, entry: baseColorImages.has(i) ? resolveResource(zip, index, dir, uri) : null });
  }

  return { zip, plan: { entry: gltfEntry, binary: false, json, resources } };
}

/**
 * Content fingerprint from central-directory CRCs, so the incremental check
 * never has to inflate a single byte. Derived from exactly the entries
 * materialize() will read, so the two can never disagree.
 */
function fingerprintSource(zip: ZipArchive, plan: SourcePlan): string {
  const parts: string[] = [plan.entry];
  const stamp = (name: string) => {
    const entry = zip.entries.get(name);
    return entry ? `${name}:${entry.crc}:${entry.uncompressedSize}` : `${name}:missing`;
  };
  parts.push(stamp(plan.entry));
  for (const resource of plan.resources) {
    parts.push(resource.entry ? `${resource.uri}=${stamp(resource.entry)}` : `${resource.uri}=placeholder`);
  }
  return sha1(parts.join("|"));
}

async function materialize(zip: ZipArchive, plan: SourcePlan): Promise<{ document: Document; sourceBytes: number }> {
  if (plan.binary) {
    const bytes = await zip.read(plan.entry);
    return { document: await io.readBinary(new Uint8Array(bytes)), sourceBytes: bytes.length };
  }
  let sourceBytes = zip.entries.get(plan.entry)?.uncompressedSize ?? 0;
  const resources: Record<string, Uint8Array> = {};
  for (const resource of plan.resources) {
    if (!resource.entry) {
      resources[resource.uri] = PLACEHOLDER_PNG;
      continue;
    }
    const bytes = await zip.read(resource.entry);
    resources[resource.uri] = new Uint8Array(bytes);
    sourceBytes += bytes.length;
  }
  const document = await io.readJSON({ json: plan.json!, resources } as unknown as JSONDocument);
  return { document, sourceBytes };
}

async function loadSource(pick: Pick): Promise<LoadedSource> {
  const { zip, plan } = await planSource(pick);
  const { document, sourceBytes } = await materialize(zip, plan);
  return { document, inputHash: fingerprintSource(zip, plan), sourceBytes };
}

/**
 * Drops every map except base colour and flattens the PBR response.
 * Quaternius ships 1-4 MB normal/ORM maps that cost more than they add at this
 * silhouette-first art scale.
 */
function stripExtraMaps(document: Document): void {
  for (const material of document.getRoot().listMaterials()) {
    material.setNormalTexture(null);
    material.setMetallicRoughnessTexture(null);
    material.setOcclusionTexture(null);
    material.setEmissiveTexture(null);
    material.setMetallicFactor(0);
    if (material.getRoughnessFactor() < 0.6) material.setRoughnessFactor(0.85);
  }
}

async function optimizeMesh(document: Document, limit: number): Promise<void> {
  stripExtraMaps(document);
  // Foliage is geometry-bound, not texture-bound: a twisted tree is ~800 KB of
  // leaf cards. KHR_mesh_quantization roughly halves that and three.js
  // GLTFLoader reads it with no decoder setup.
  //
  // Skinned meshes are left alone on purpose. For those, quantize cannot put the
  // de-normalizing scale on the node (the node matrix is ignored when skinning),
  // so it folds the correction into the inverse-bind matrices instead. That
  // renders correctly but leaves the raw vertex data in normalized space, which
  // is a needless risk on the player, NPCs and outfits for ~3 MB.
  const skinned = document.getRoot().listSkins().length > 0;
  await document.transform(
    dedup(),
    prune({ keepAttributes: false, keepLeaves: false, keepSolidTextures: false }),
    weld(),
    resample(),
    ...(skinned
      ? []
      : [quantize({ pattern: /.*/, quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 })]),
    // Pass 1: opaque base colour becomes JPEG, roughly 8x smaller than PNG for
    // these textures. textureCompress skips any texture whose channel mask
    // still needs alpha, which is exactly the cut-out foliage and cloth.
    textureCompress({ encoder: sharp, targetFormat: "jpeg", resize: [limit, limit], quality: 85 }),
    // Pass 2: whatever is still PNG genuinely needs alpha; resize and re-encode
    // it. Pass 1's output is image/jpeg, so the format filter leaves it alone.
    textureCompress({
      encoder: sharp,
      targetFormat: "png",
      resize: [limit, limit],
      quality: 90,
      effort: 100,
      formats: /image\/png/,
    }),
  );
  await palettizePNGs(document);
}

/**
 * Quantizes the surviving PNGs (cut-out foliage and cloth) to an indexed
 * palette. These are flat-shaded atlases, so 256 colours is visually free and
 * typically cuts a 512x512 RGBA leaf atlas by 4-6x. Kept only when smaller.
 */
async function palettizePNGs(document: Document): Promise<void> {
  for (const texture of document.getRoot().listTextures()) {
    if (texture.getMimeType() !== "image/png") continue;
    const source = texture.getImage();
    if (!source) continue;
    try {
      const encoded = await sharp(Buffer.from(source))
        .png({ palette: true, colours: 256, quality: 90, effort: 10 })
        .toBuffer();
      if (encoded.byteLength < source.byteLength) texture.setImage(new Uint8Array(encoded));
    } catch {
      /* keep the unquantized image */
    }
  }
}

/**
 * Animation libraries keep every clip. The mannequin mesh and its materials are
 * dead weight for a clip library, so they are removed and the result is checked
 * against the original clip/channel counts before it is accepted.
 */
async function optimizeAnimationLibrary(document: Document): Promise<{ ok: boolean }> {
  const root = document.getRoot();
  const before = root.listAnimations().map((animation) => ({
    name: animation.getName(),
    channels: animation.listChannels().length,
  }));

  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const material of root.listMaterials()) material.dispose();
  for (const texture of root.listTextures()) texture.dispose();

  await document.transform(dedup(), resample());
  // keepLeaves is essential: every joint is now an empty leaf node, and the
  // clips target those nodes by name.
  await document.transform(prune({ keepLeaves: true, keepAttributes: true }));

  const after = root.listAnimations().map((animation) => ({
    name: animation.getName(),
    channels: animation.listChannels().length,
  }));
  const ok =
    after.length === before.length &&
    before.every((entry, index) => after[index]?.name === entry.name && after[index]?.channels === entry.channels);
  return { ok };
}

function readableSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function loadState(): Promise<Record<string, BuildRecord>> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as Record<string, BuildRecord>;
  } catch {
    return {};
  }
}

async function buildOne(
  pick: Pick,
  state: Record<string, BuildRecord>,
  force: boolean,
): Promise<{ asset: ManifestAsset; sourceBytes: number; reused: boolean; note?: string }> {
  const relative = `models/${pick.category}/${pick.id}.glb`;
  const outFile = path.join(OUT_DIR, relative);
  const limit = pick.textureLimit ?? TEXTURE_LIMIT;
  const optionsHash = sha1(
    PIPELINE_VERSION,
    String(limit),
    pick.animationLibrary ? "anim" : "mesh",
    relative,
    pick.tags.join(","),
    pick.category,
    pick.pack,
  );

  const { zip, plan } = await planSource(pick);
  const inputHash = fingerprintSource(zip, plan);

  const cached = state[pick.id];
  if (!force && cached && cached.optionsHash === optionsHash && cached.inputHash === inputHash) {
    let onDisk = -1;
    try {
      onDisk = (await stat(outFile)).size;
    } catch {
      onDisk = -1;
    }
    // The recorded byte count is the integrity check: a truncated or
    // half-written GLB never matches, so it is rebuilt instead of trusted.
    if (onDisk === cached.asset.bytes) {
      return { asset: cached.asset, sourceBytes: cached.sourceBytes, reused: true };
    }
  }

  const { document, sourceBytes } = await materialize(zip, plan);
  // Measured on the untouched source: quantization rewrites skinned vertex data
  // into normalized space, so post-transform bounds would lie for characters.
  const size = measure(document);
  let note: string | undefined;

  if (pick.animationLibrary) {
    const { ok } = await optimizeAnimationLibrary(document);
    if (!ok) {
      // Stripping cost us a clip or a channel, so ship the source untouched.
      note = "clip check failed, passed through unmodified";
      const original = await materialize(zip, plan);
      const glb = await io.writeBinary(original.document);
      await mkdir(path.dirname(outFile), { recursive: true });
      await writeFile(outFile, glb);
      const asset = describe(pick, relative, glb.byteLength, original.document, size);
      state[pick.id] = { inputHash, optionsHash, sourceBytes, asset };
      return { asset, sourceBytes, reused: false, note };
    }
  } else {
    await optimizeMesh(document, limit);
  }

  const glb = await io.writeBinary(document);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, glb);

  const asset = describe(pick, relative, glb.byteLength, document, size);
  state[pick.id] = { inputHash, optionsHash, sourceBytes, asset };
  return { asset, sourceBytes, reused: false, note };
}

function describe(
  pick: Pick,
  relative: string,
  bytes: number,
  document: Document,
  size: { x: number; y: number; z: number },
): ManifestAsset {
  const root = document.getRoot();
  return {
    id: pick.id,
    file: relative.replace(/\\/g, "/"),
    pack: pick.pack,
    category: pick.category,
    // The first tag is the subject and the rest are associations. Publishing the subject as its
    // own field is what stops a reader — human or agent — taking "stump" off the tag list of an
    // anvil that happens to stand on one, which is exactly what Phase 1 did.
    is: pick.tags[0] ?? pick.category,
    tags: pick.tags,
    bytes,
    size,
    animations: root.listAnimations().map((animation) => animation.getName()),
    materials: root.listMaterials().map((material) => material.getName()),
  };
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let items: Dirent[];
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) total += await directorySize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

async function verify(): Promise<number> {
  const manifest = JSON.parse(await readFile(path.join(OUT_DIR, "manifest.json"), "utf8")) as Manifest;
  let failures = 0;
  for (const asset of manifest.assets) {
    const file = path.join(OUT_DIR, asset.file);
    try {
      const bytes = await readFile(file);
      if (bytes.byteLength !== asset.bytes) throw new Error(`size ${bytes.byteLength} != manifest ${asset.bytes}`);
      const document = await io.readBinary(new Uint8Array(bytes));
      const meshes = document.getRoot().listMeshes().length;
      const animations = document.getRoot().listAnimations().length;
      if (asset.category === "animation") {
        if (animations === 0) throw new Error("animation library has no clips");
      } else if (meshes === 0) {
        throw new Error("no meshes");
      }
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${asset.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`verify: ${manifest.assets.length - failures}/${manifest.assets.length} GLBs parsed and non-empty`);
  return failures;
}

async function probe(zipKey: string, needle: string): Promise<void> {
  const pack = PACKS.find((entry) => entry.id === zipKey);
  const file = pack ? path.join(CACHE_DIR, pack.zip) : path.join(CACHE_DIR, zipKey);
  const zip = await ZipArchive.open(file);
  const matches = [...zip.entries.keys()].filter((name) => name.toLowerCase().includes(needle.toLowerCase()));
  for (const name of matches.slice(0, 40)) {
    console.log(name, zip.entries.get(name)!.uncompressedSize);
  }
  console.log(`(${matches.length} matches)`);
  await zip.close();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--probe") {
    await probe(args[1]!, args[2] ?? "");
    return;
  }
  if (args[0] === "--check") {
    let missing = 0;
    for (const pick of CATALOG) {
      const pack = PACK_BY_ID.get(pick.pack)!;
      const zip = await archive(pick.pack);
      const gltf = `${pack.root}${pick.file}.gltf`;
      const glb = `${pack.root}${pick.file}.glb`;
      if (!zip.entries.has(gltf) && !zip.entries.has(glb)) {
        missing += 1;
        console.error(`MISSING ${pick.id}: ${gltf}`);
      }
    }
    for (const zip of archives.values()) await zip.close();
    console.log(`check: ${CATALOG.length - missing}/${CATALOG.length} source entries present`);
    process.exitCode = missing === 0 ? 0 : 1;
    return;
  }
  if (args[0] === "--verify") {
    process.exitCode = (await verify()) === 0 ? 0 : 1;
    return;
  }

  const force = args.includes("--force");
  const ids = new Set<string>();
  for (const pick of CATALOG) {
    if (ids.has(pick.id)) throw new Error(`Duplicate asset id: ${pick.id}`);
    if (!/^[a-z0-9_]+$/.test(pick.id)) throw new Error(`Bad asset id (lowercase snake_case only): ${pick.id}`);
    ids.add(pick.id);
  }

  const state = await loadState();
  const assets: ManifestAsset[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  let totalSource = 0;
  let totalOut = 0;
  let reusedCount = 0;
  const oversize: ManifestAsset[] = [];

  console.log(`building ${CATALOG.length} assets from ${PACKS.length} packs${force ? " (forced)" : ""}\n`);

  for (const pick of CATALOG) {
    try {
      const result = await buildOne(pick, state, force);
      assets.push(result.asset);
      totalSource += result.sourceBytes;
      totalOut += result.asset.bytes;
      if (result.reused) reusedCount += 1;
      if (ENVIRONMENT_CATEGORIES.has(pick.category) && result.asset.bytes > 400_000) {
        oversize.push(result.asset);
      }
      const ratio = result.sourceBytes ? `${((1 - result.asset.bytes / result.sourceBytes) * 100).toFixed(0)}%` : "-";
      const tag = result.reused ? "cached " : "built  ";
      console.log(
        `${tag}${pick.id.padEnd(34)} ${readableSize(result.sourceBytes).padStart(10)} -> ${readableSize(
          result.asset.bytes,
        ).padStart(10)}  (-${ratio})${result.note ? `  [${result.note}]` : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: pick.id, error: message });
      console.error(`FAILED ${pick.id}: ${message}`);
    }
  }

  // Drop stale outputs from earlier catalog revisions.
  const expected = new Set(assets.map((asset) => path.join(OUT_DIR, asset.file)));
  const removed: string[] = [];
  const sweep = async (dir: string): Promise<void> => {
    let items: Dirent[];
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await sweep(full);
      else if (full.endsWith(".glb") && !expected.has(full)) {
        await rm(full);
        removed.push(path.relative(OUT_DIR, full));
      }
    }
  };
  if (failures.length === 0) await sweep(MODELS_DIR);
  for (const id of Object.keys(state)) {
    if (!ids.has(id)) delete state[id];
  }

  const usedPacks = new Set(assets.map((asset) => asset.pack));
  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    packs: PACKS.filter((pack) => usedPacks.has(pack.id)).map(({ id, name, author, source, license }) => ({
      id,
      name,
      author,
      source,
      license,
    })),
    assets: assets.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id)),
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

  for (const zip of archives.values()) await zip.close();

  const byCategory = new Map<string, { count: number; bytes: number }>();
  for (const asset of assets) {
    const entry = byCategory.get(asset.category) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += asset.bytes;
    byCategory.set(asset.category, entry);
  }

  console.log("\n== summary");
  console.log(`assets        ${assets.length} built/valid, ${reusedCount} reused from cache, ${failures.length} failed`);
  console.log(`source bytes  ${readableSize(totalSource)}`);
  console.log(`output bytes  ${readableSize(totalOut)} (${((1 - totalOut / totalSource) * 100).toFixed(1)}% smaller)`);
  console.log(`models dir    ${readableSize(await directorySize(MODELS_DIR))}`);
  if (removed.length) console.log(`removed stale ${removed.length}: ${removed.slice(0, 8).join(", ")}`);
  console.log("\ncategory        count      bytes");
  for (const [category, entry] of [...byCategory].sort()) {
    console.log(`${category.padEnd(14)} ${String(entry.count).padStart(5)} ${readableSize(entry.bytes).padStart(10)}`);
  }
  if (oversize.length) {
    console.log(`\n${oversize.length} environment GLB(s) over the 400 KB target:`);
    for (const asset of oversize) console.log(`  ${asset.id} ${readableSize(asset.bytes)}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    for (const failure of failures) console.log(`  ${failure.id}: ${failure.error}`);
    process.exitCode = 1;
  }
}

await main();
