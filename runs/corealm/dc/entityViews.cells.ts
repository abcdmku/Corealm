/**
 * Semantic entities -> Three.js objects.
 *
 * This is the render half of the seam the contract describes: the world layer owns what an entity
 * IS, this file owns what it LOOKS LIKE. It reads `SemanticEntity.view` and nothing else about
 * appearance, and it never writes gameplay state. If a value is not on `view`, it is not this
 * file's business to invent it.
 *
 * The performance shape that matters: entities are grouped by (assetId, materialTier, archetype)
 * and every group's parts are drawn out of a `BatchedMesh` shared by MATERIAL across the whole
 * world. Six hundred ore nodes across three regions are a handful of draw calls, not six hundred,
 * and so are the 29 different GLBs that all paint with `MI_WoodTrim`. Each entity owns a fixed slot
 * in its group and one batch instance per part per pose variant; changing state writes a matrix and
 * flips two visibility bits. No rebuild, no allocation, no reupload of anything but the matrices.
 *
 * Round 2 fixes two findings that both came down to this file:
 *
 *  - Tier was unreadable (finding 4). Tier now moves three things at once: the body colour (pulled
 *    hard toward the tier's `body` swatch), an added ore SEAM in the tier's brightened `metal`
 *    swatch, and the silhouette scale. See `APPEARANCE` and `seamGeometry`.
 *  - Nothing was animated (finding 6). 98 clips were loading and no `AnimationMixer` existed, so
 *    every character stood in bind pose with its arms out. Rigged entities now get a mixer with a
 *    per-entity idle clip and phase, and — this is the part that matters at scale — the ones that
 *    do NOT get a mixer are instanced from a CPU-baked idle pose rather than from bind pose, so a
 *    background NPC is a still character instead of a scarecrow.
 *
 * Round 4 fixes four more, all of them measured in the browser before and after:
 *
 *  - Every NPC in the world was headless. `view.assetId` was a clothes-only outfit GLB
 *    (`outfit_male_peasant.glb` = Arms/Body/Feet/Legs, top vertex y 1.559 against `base_male`'s
 *    1.810, no Head/Eyes/Eyebrows), so you could see the wall through the neck. Characters are now
 *    assembled through `render/skinning.ts`: a head-capped base body carrying its own Eyes and
 *    Eyebrows, the outfit layered on and rebound to the body's bones, and a deterministic hair
 *    asset on top. Measured mesh counts per character, offline against the real GLBs
 *    (runs/corealm/audit/ev-assemble.ts): male peasant 5 -> 6, female peasant 4 -> 6, male ranger
 *    10 -> 6, female ranger 10 -> 5. Across the world's 12 NPCs that is 92 -> 70 meshes, i.e. 44
 *    FEWER draw calls than the headless version cost.
 *  - No enemy in the world could ever be animated, because `NAMED_CHARACTER_RESERVE` (64) equalled
 *    the `maxUniqueDrawCalls` boot passes (64) and the non-npc ceiling was therefore exactly 0.
 *    The budget is now split into two independent pools; see `canAffordUnique`.
 *  - A rigged entity had one clip for its whole life. Enemies now select idle / walk / death from
 *    what their own GLB ships, and the instanced fallback bakes one pose per state instead of one
 *    pose full stop.
 *  - Nothing bedded into a slope. `writeSlot` now slerps the instance orientation toward
 *    `view.groundNormal` by `view.tiltStrength`, defaulted per archetype by `DEFAULT_TILT`.
 */
import * as THREE from "three";
import { clone as cloneRigged } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Archetype, EntityId, SemanticEntity, Vec3 } from "../contracts.js";
import type { AssetRegistry } from "./assets.js";
import type { WorldScene } from "./scene.js";
import type { PaletteSwatch } from "./materials.js";
import { Rng } from "../core/rng.js";
import { MaterialLibrary, tierSilhouetteScale } from "./materials.js";
import {
  assembleDressedCharacter,
  hairAssetFor,
  headCapHeightFor,
  type CharacterPartSource,
  type DressedCharacter,
} from "./skinning.js";

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * How a new `Batch` is sized, and how much it grows by.
 *
 * Both ceilings double on overflow and `BatchedMesh` copies the old buffers across, so these only
 * decide how many reallocations boot pays for. The vertex step is deliberately above 65,535: below
 * it `BatchedMesh` allocates a Uint16 index buffer and the first growth past the limit has to
 * convert every index one at a time.
 */
const BATCH_INSTANCE_STEP = 128;
const BATCH_VERTEX_STEP = 2_048;

/**
 * Edge of the square a batch covers, in metres.
 *
 * A batch shared by the whole 700x400 m world has a bounding sphere that touches every frustum, so
 * the renderer can never cull the OBJECT and every batch pays a full material bind and an
 * `onBeforeRender` pass over all its instances, twice per frame with the shadow map. Measured: 96
 * world-wide batches cost about 7 ms of CPU a frame at EVERY pose, including `palewood_copse`,
 * which draws 35 calls and 2 M triangles — median frame time went 3.0 ms -> 9.9 ms there with no
 * change in what was on screen.
 *
 * Cutting the batch key by a 128 m cell gets object-level culling back. It is a trade: two towns
 * that share `MI_WoodTrim` no longer share a draw, and a settlement that straddles a cell boundary
 * pays twice for the materials it spans. 128 m is wider than any settlement here (Coldbrace's wall
 * runs span 78 m) so most of them land in one or two cells.
 */
const BATCH_CELL_SIZE = 128;

/**
 * Archetypes that keep out of the cell split, because they walk.
 *
 * A cell is part of the group key, so an enemy that crosses a boundary would release its slot and
 * re-acquire in a different group mid-stride. There are ~60 of them in the world against ~3,300
 * static props, so parking them all in one world-wide cell costs a handful of unculled batches and
 * buys a mover that never pops.
 */
const CELL_FREE_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>([
  "enemy", "boss", "npc",
]);

// Module-scope scratch. `writeSlot` runs once per entity per sync over ~900 entities; a fresh
// Quaternion and Vector3 per call is garbage the collector walks during exactly the passes that are
// already the most expensive. Each of these is written and consumed within one synchronous call.
const SCRATCH_QUATERNION = new THREE.Quaternion();
const SCRATCH_SCALE = new THREE.Vector3();
const SCRATCH_NORMAL = new THREE.Vector3();
const SCRATCH_TILT = new THREE.Quaternion();
const SCRATCH_BLEND = new THREE.Quaternion();
const SCRATCH_PLACEMENT = new THREE.Matrix4();
const SCRATCH_TRANSFORM = new THREE.Matrix4();

/** States that render with the spent treatment. Everything else renders live. */
const SPENT_STATES = new Set(["depleted", "dead", "empty", "harvested", "closed", "spent"]);

/**
 * Archetypes whose tier is a gameplay ladder, and are therefore allowed to move their proportions.
 *
 * Round 1 scaled EVERYTHING by `tierSilhouetteScale`, so a Karrowmoor market stall was 12% larger
 * than the identical stall in Coldbrace purely because its region carries a higher tier. Tier is a
 * readability signal for things you gather from and fight; it is not a size rule for architecture.
 */
const TIERED_ARCHETYPES = new Set<Archetype>([
  "ore", "tree", "fishing_spot", "farm_plot", "enemy", "boss",
]);

/** How far a given archetype's art is pulled toward its tier palette, and toward which swatch. */
interface Appearance {
  swatch: PaletteSwatch;
  /** 0..1. Zero means "leave the authored art alone", and costs no material clone at all. */
  strength: number;
}

/**
 * The tier-legibility policy, in one table.
 *
 * Ore is the strong case and the one the PRD writes a contract for: at 0.88 a stock grey rock
 * texture actually lands on the tier's body colour, where round 1's 0.25 could not move it at all.
 * NPCs, buildings, props and landmarks are deliberately absent — they resolve to `NEUTRAL` and
 * render as authored, because tinting a shopkeeper toward "Kaldite blue-black" communicates
 * nothing and costs a cloned material.
 */
const APPEARANCE: Partial<Record<Archetype, Appearance>> = {
  ore: { swatch: "body", strength: 0.88 },
  tree: { swatch: "body", strength: 0.55 },
  fishing_spot: { swatch: "accent", strength: 0.7 },
  farm_plot: { swatch: "accent", strength: 0.45 },
  enemy: { swatch: "metal", strength: 0.45 },
  boss: { swatch: "metal", strength: 0.55 },
};

const NEUTRAL: Appearance = { swatch: "metal", strength: 0 };

/**
 * Archetypes whose tier is kept out of the instance-group key without looking at the art at all.
 *
 * `npc` and nothing else. It is a shortcut, not a separate rule: `EntityViews.groupTier` would
 * reach the same answer from the materials, and this only saves it the traverse on the one
 * archetype whose "materials" are six separately loaded part GLBs.
 */
const TIER_BLIND_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(["npc"]);

/** Canopy materials follow the tier ACCENT, not the rock body a trunk shares its swatch with. */
const LEAF_MATERIAL = /leaf|leaves|foliage|canopy/i;

/**
 * The pantile material every roof in the kit shares.
 *
 * Building parts are `landmark` archetype, which carries no tint at all, so every roof in the
 * world drew at the texture's authored orange: Highcairn's slate quarry town had the same fired
 * pantiles as the farming village three regions away. Roofs take the tier BODY swatch at a low
 * strength — enough to weather Karrowmoor's roofs toward its blue-grey and Vellenwood's toward its
 * bark brown, and not enough to lose the tile.
 *
 * The standing rule still applies: a tint multiplies against the texture, so this DARKENS an
 * orange toward slate. It cannot turn one into a blue. That is why the walls carry the region's
 * identity — brick against plaster against exposed frame — and the roof only shades it.
 */
const ROOF_MATERIAL = /roundtiles|rooftile/i;

/**
 * Materials a tier tint must never touch. Eyes, teeth and the pure black/white trims on the
 * monster packs are art direction, not tier: pulling them toward a palette colour flattens a face
 * into a smear and buys no legibility.
 */
const PROTECTED_MATERIAL = /eye|teeth|tongue|hair|white|black/i;

/**
 * Humanoid idles, from the shared 65-joint clip library.
 *
 * CORRECTION. The comment that stood here claimed "every character pack shares one skeleton", and
 * that claim is why the headless-NPC and bind-pose bugs got written. It is false. Hashing each GLB's
 * `inverseBindMatrices` buffer across models/character, models/outfit and models/animation finds
 * FOUR distinct 65-joint humanoid skeletons: `base_male` alone (ba5af210); `base_female` plus
 * hair_long/hair_buns plus every female outfit part (eea9805d); eyebrows plus
 * hair_short/hair_buzzed/hair_beard plus every male outfit part (3c715354); and both animation
 * libraries (0d2ac055). What they share is the JOINT LIST — 65 joints, identical names in identical
 * order — which is what makes a name-keyed rebind legal and a raw bone-array share illegal. The
 * residual is the rest-pose delta between two rigs: 0 mm for base_female + female parts, at most
 * 23.7 mm (foot) / 23.3 mm (hand) for base_male + male parts. See `render/skinning.ts`, which owns
 * the rebind and re-verified all of this across 17 files.
 *
 * Four idles, picked per entity, because a settlement where five NPCs breathe in unison reads worse
 * than five NPCs standing still.
 */
const HUMANOID_IDLES: readonly string[] = [
  "Idle_Loop", "Idle_Talking_Loop", "Idle_FoldArms_Loop", "Idle_No_Loop",
];

/**
 * What a character is doing, as far as this layer can tell from semantics alone.
 *
 * Deliberately narrow. `render/` reads `SemanticEntity` and nothing else, so it cannot see
 * `state.world.enemies[id].state` (idle/aggro/returning) — that lives in the store and belongs to
 * `systems/`. What it CAN see is `entity.state` (alive/dead) and whether `entity.position` moved
 * between syncs, and those two cover idle / walk / death. `attack` and `hit` are one-shots the
 * owner of the combat stream pushes in through `playAction`.
 */
export type CharacterMotion = "idle" | "walk" | "attack" | "hit" | "death";

/**
 * Clip names to try per motion for an asset that ships its OWN clips, best first.
 *
 * Measured from the manifest rather than assumed: enemy_crab, enemy_blob and enemy_skull each ship
 * ["Bite_Front", "Bite_InPlace", "Dance", "Death", "HitRecieve", "Idle", "Jump", "No", "Walk",
 * "Yes"]; enemy_bee ships ["Bite_Front", "Death", "Flying", "HitRecieve"] and has NO Idle and NO
 * Walk, which is why `Flying` appears in both of those rows — a bee that stops flapping when it
 * stops moving reads as dead.
 */
const OWN_CLIP_PATTERNS: Record<CharacterMotion, readonly RegExp[]> = {
  idle: [/^idle/i, /^flying/i],
  walk: [/^walk/i, /^flying/i, /^jump/i],
  attack: [/^bite_front/i, /^bite/i, /attack/i],
  hit: [/^hitrecieve/i, /^hit/i],
  death: [/^death/i],
};

/**
 * The same table against the shared 65-joint library, for anything built on a humanoid body.
 *
 * All of these resolve: `__gameDebug.listClips()` returns 85 names and every one of these is in it.
 * `Death01` is spelt without an underscore in the library; that is the file's spelling, not a typo.
 */
const HUMANOID_CLIPS: Record<CharacterMotion, readonly string[]> = {
  idle: HUMANOID_IDLES,
  walk: ["Walk_Loop", "Jog_Fwd_Loop"],
  attack: ["Sword_Attack", "Sword_Regular_A", "Punch_Jab"],
  hit: ["Hit_Chest", "Hit_Knockback"],
  death: ["Death01"],
};

/** Motions that play once and hand back to the entity's resting motion. */
const ONE_SHOT_MOTIONS: ReadonlySet<CharacterMotion> = new Set<CharacterMotion>(["attack", "hit"]);

/**
 * Which base body a clothes-only outfit GLB needs under it, and what its own part id is.
 *
 * This is the local fallback the rig diagnosis' recommendation 1 offers: `world/regionBuilder.ts`
 * is moving NPCs to `view.assetId = base_male|base_female` plus `view.partAssetIds`, but until that
 * lands `view.assetId` is one of these four clothes-only files, and drawing one as a whole body is
 * exactly the headless NPC. Keying the body off the outfit id here means the fix is live either way
 * and becomes dead weight — not a conflict — the day the world layer starts authoring parts.
 */
const OUTFIT_BODIES: Readonly<Record<string, string>> = {
  outfit_male_peasant: "base_male",
  outfit_male_ranger: "base_male",
  outfit_female_peasant: "base_female",
  outfit_female_ranger: "base_female",
};

/**
 * Outfits that already cover the skull, so hair is skipped.
 *
 * Male_Ranger_Head_Hood spans y 1.5253-1.8650 and hair_short spans 1.661-1.840, i.e. the hair sits
 * entirely inside the hood and pokes through its crown. A hooded NPC keeps the face it gets from
 * the head cap and goes without hair.
 */
const HOODED_PARTS: ReadonlySet<string> = new Set([
  "outfit_male_ranger", "outfit_female_ranger",
  "outfit_male_ranger_hood", "outfit_female_ranger_hood",
]);

const HAIR_PART = /^hair_/;

/**
 * How far each archetype beds into the terrain normal, 0..1, when the world layer supplies a normal
 * but no `view.tiltStrength`.
 *
 * THIS IS THE FALLBACK, NOT THE LIVE TABLE. `world/regionBuilder.ts:476` authors `tiltStrength` on
 * every tilt-eligible entity it emits, so in the shipped world this table is consulted for nothing:
 * measured live, ore reads 0.85, tree 0.12, obstacle 0.5, fishing_spot 1 and landmark 0.25 straight
 * off `view`. The numbers below are therefore kept EQUAL to the authored ones — two tables that
 * disagree is how a look silently changes the day one of them stops being written.
 *
 *   tree 0.12       A tree grows toward the light, not perpendicular to the hill.
 *   ore 0.85        A rock IS bedded into the hill it came out of.
 *   obstacle 0.50   Fallen logs and boulders: same argument as ore, less of it, because several are
 *                   authored as climbable and a hard tilt moves the climb line.
 *   fishing_spot,
 *   farm_plot 1.0   Flat things. A lily pad or a furrow that does not lie in the ground is not a
 *                   lily pad. This is the "flat plants and pebbles" row.
 *
 * Verified by measurement, not by argument (runs/corealm/audit/ev2-sink.ts). The world layer clamps
 * the normal it hands over to 20 degrees off vertical, so the applied tilt is
 * `min(slope, 20 deg) * strength` and is ALWAYS shallower than the ground the object stands on. At
 * footprint radius r the tilted base plane drops `r * sin(tilt)` while the terrain drops
 * `r * tan(slope)`, and the second is larger for every one of the eleven steepest-standing entities
 * in the world: lower_quarry_kaldite_5 0.97 m against 3.01 m, scree_slide 1.00 against 1.04,
 * fallen_duskoak 1.59 against 1.65, duskoak_stand_trees_9 1.20 against 1.27, ridge_pines_trees_6
 * 1.36 against 1.44. Nothing this table produces can put an object below the terrain under its own
 * footprint, and a tree at 0.12 leans by at most 2.4 degrees.
 *
 * That is also the whole of what `checkGrounding` is reporting when it flags these rows. It scores
 * `drawnBounds().min.y` — the DOWNHILL corner of a tilted AABB — against `groundHeight` sampled at
 * the entity's CENTRE, so on a slope a correctly bedded object must score negative. All 20 negative
 * over-tolerance rows are this; the remaining two are enemy_bee, which flies.
 *
 * Everything absent resolves to 0. That includes `landmark`, and it is not an oversight: building
 * parts are emitted as `landmark` entities (world/regionBuilder.ts:530), 36 buildings' worth of
 * them, and `checkBuildingFooting()` already returns worst 0 for every one. Tilting a wall segment
 * toward the ground normal would break the only part of the grounding audit that was already clean.
 * The world layer authors 0.25 on the standalone landmarks it does want tilted and hands building
 * parts no normal at all, so the fallback never has to make that distinction.
 */
const DEFAULT_TILT: Partial<Record<Archetype, number>> = {
  tree: 0.12,
  ore: 0.85,
  obstacle: 0.5,
  fishing_spot: 1,
  farm_plot: 1,
};

/**
 * Archetypes whose position is expected to change while the game runs.
 *
 * Only these are walked by `syncMotion`, which the render frame may call at full rate; everything
 * else is reconciled by `sync` at whatever cadence the loop chooses.
 */
const MOVING_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(["enemy", "boss", "npc"]);

/**
 * How many syncs a character keeps walking after the last observed position change.
 *
 * `EnemyAI.stepToward` writes a position every 100 ms sim tick while `sync` runs at 250 ms, so a
 * moving enemy shows a position change on most but not all syncs. Two syncs of hysteresis (~500 ms)
 * stops the walk pose flickering off between steps; the same 20-per-second idle/run thrash on the
 * player is what froze the player's run clip (animation diagnosis finding 2).
 */
const MOVING_HOLD_SYNCS = 2;

/** Metres of movement between syncs below which an entity counts as standing still. */
const MOVING_EPSILON = 0.03;

/** Shards in an ore seam. Five reads as a vein from any bearing and costs 40 triangles. */
const SEAM_SHARDS = 5;

/**
 * How much of a felled tree is left standing, as a fraction of its height.
 *
 * The nature kit ships one mesh per tree with the trunk and the canopy fused, and no stump asset at
 * all. Round 3 worked around that by swapping in `anvil_log` — which is an anvil that happens to
 * sit on a log — so every worked-out tree in the world turned into a blacksmith's anvil. Clipping
 * the tree's own geometry to its lowest sixth gives a real stump: same trunk, same material, same
 * place, obviously cut.
 */
const TREE_STUMP_FRACTION = 0.22;

/** Same trick for a harvested plot: the crop is cut back to stubble rather than swapped for a crate. */
const CROP_STUBBLE_FRACTION = 0.3;

/**
 * Fraction of the chosen clip to freeze at for the instanced fallback, per motion.
 *
 * Mid-clip for the looping ones, i.e. settled rather than at the loop seam. Death is the exception
 * and the reason this stopped being one number: a corpse baked at 35% of `Death` is a character
 * halfway to the floor, hanging in the air. 0.98 is the clip's final frame, which is the pose the
 * live one-shot clamps to, so an instanced corpse and an animated corpse match.
 */
const BAKE_PHASES: Record<CharacterMotion, number> = {
  idle: 0.35,
  walk: 0.28,
  attack: 0.5,
  hit: 0.5,
  death: 0.98,
};

/**
 * Share of `maxUniqueDrawCalls` reserved for named characters. The remainder is everything else's.
 *
 * The reserve exists because the budget is first-come and entity order is region order: forty
 * wilderness enemies would spend the whole allowance before the first shopkeeper in Coldbrace is
 * reached, so the characters the player stands in front of would be the statues.
 *
 * Round 3 wrote it as an absolute 64 subtracted from `maxUniqueDrawCalls`, and boot passes
 * `maxUniqueDrawCalls: 64`, so the ceiling for anything that is not an NPC was EXACTLY ZERO and
 * `uniqueDrawCalls + cost <= 0` could not be true at any spend including none. Measured
 * consequence: 872 entities produced `uniqueViews: 4`, all four of them NPCs, and
 * `animatedLastFrame` read 0 in every frame sampled outside Coldbrace square. No enemy in the game
 * had ever animated.
 *
 * A ratio alone does not fix it, which is the part worth writing down. With ONE shared counter and
 * a ceiling of `max - reserve`, the named characters are reached first and spend past that ceiling,
 * so every later enemy is still refused — the arithmetic changes and the outcome does not. The two
 * classes therefore get two independent counters below, and the split is a hard one.
 */
const NAMED_CHARACTER_SHARE = 0.6;

/**
 * How much further than `animationRadius` a character may drift before it gives its rig back.
 *
 * Two pools with hard ceilings fixed "no enemy can ever animate", and left a second bug behind it
 * that is just as visible: the pools are spent FIRST-COME in entity order, and entity order is
 * region order. Measured at f692015 with `maxUniqueDrawCalls: 96`, the named pool (58) went
 * entirely to the four Coldbrace NPCs and the other pool (38) to rill_skitterlings_1..3 plus
 * cairnwights_fields_1 — four of fifty enemies, picked by where they sit in the array. Stand in
 * Highcairn and all five of its characters are statues; fight anything but those four enemies and
 * `playAction` returns false, so no swing, no flinch and no death animation ever plays.
 *
 * So the pools are now allocated by DISTANCE from the camera, not by array order:
 * `canAffordUnique` refuses anything past `animationRadius`, `update` hands back the rigs of
 * characters that have drifted past `animationRadius * this`, and the same pass promotes instanced
 * characters that have come close enough. The budget is unchanged — the same 96 draw calls, spent
 * on the characters the player is actually standing in front of.
 *
 * 1.75 rather than 1.0 because a boundary with no hysteresis thrashes: a character parked at
 * exactly the radius would rebuild its skeleton and re-merge its geometry every frame. 40 m in,
 * 70 m out. Between the two it keeps its rig but stops being ticked (`update` already cuts at
 * `animationRadius`), so it holds its pose and costs nothing but its draw calls.
 */
const UNIQUE_RELEASE_FACTOR = 1.75;

/**
 * Characters promoted from their instanced pose to a live rig per frame.
 *
 * Capped at all because promoting a dressed NPC runs `assembleDressedCharacter` — a head cap cut
 * out of the body mesh, four to six outfit parts rebound to its bones, and a merge — and doing a
 * whole settlement roster in the frame the player crosses into it is a hitch.
 *
 * Four rather than one, measured: the named pool at `maxUniqueDrawCalls: 96` affords exactly four
 * dressed NPCs, so four per frame is "one frame of work when you walk into a town" rather than a
 * queue. One was tried first and is wrong in the harness, where headless GL runs the world at a few
 * frames a second: Highcairn took 4 seconds of wall clock to light its four NPCs, so every
 * screenshot and every 700 ms perf settle caught the town half animated.
 *
 * Demotion is deliberately NOT capped: it is a dispose, it is what frees the pool, and a promotion
 * that waits a frame for its budget is a character that stands still for a frame.
 */
const UNIQUE_PROMOTIONS_PER_FRAME = 4;

interface SourcePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  triangles: number;
}

/**
 * What a dressed humanoid is made of: a base body plus the parts layered onto its skeleton.
 *
 * Resolved from `view.partAssetIds` when the world layer authors them, and from `OUTFIT_BODIES`
 * when it still hands over a clothes-only outfit as the whole body.
 */
interface CharacterSpec {
  bodyAssetId: string;
  /** Layered onto the body's bones, in draw order. Includes the hair pick. */
  partAssetIds: string[];
  /** Stable identity for grouping and cost caching: body plus parts, in order. */
  key: string;
}

/**
 * One `BatchedMesh` holding every entity part in the world that draws under the same material.
 *
 * This is the draw-call fix. A group used to own one `InstancedMesh` per part, so the entity layer
 * submitted one draw per (asset, tier, part) pair whether or not two of them were the same paint.
 * Measured on the shipped world at f692015 + settlements: 356 `InstancedMesh`es, and with the
 * shadow pass that is 321 of the 385 draw calls at the `town_entrance` pose — the whole budget.
 *
 * The kits do not have 356 materials. Hashing every material in all 213 manifest GLBs by what the
 * renderer can actually see of it (name, texture names, colour/metallic/roughness factors, side,
 * alpha mode) gives 63 distinct materials, and `MI_WoodTrim` alone appears in 29 separate GLBs with
 * a byte-identical base-colour image (sha1 f02e4f9db3 in every one). See
 * runs/corealm/dc/matkey.mjs: that scan also reports ZERO cases of two materials sharing the
 * runtime key while carrying different texture bytes, which is the thing that would make this
 * unsafe.
 *
 * `BatchedMesh` is what lets those become one draw: many geometries, one material, one
 * `multiDrawElements`. It also culls PER INSTANCE, which plain instancing cannot — so unlike
 * merging instance groups by hand, sharing a batch between Coldbrace and Karrowmoor does not cost
 * the far region's triangles at the near region's camera.
 */
interface Batch {
  key: string;
  mesh: THREE.BatchedMesh;
  /** Allocated ceilings. All three grow by doubling; `BatchedMesh` copies its buffers across. */
  maxInstances: number;
  maxVertices: number;
  maxIndices: number;
  usedInstances: number;
  usedVertices: number;
  usedIndices: number;
  /** Geometry -> batch geometry id, so a geometry two parts share is uploaded once. */
  geometryIds: Map<THREE.BufferGeometry, number>;
  /** instanceId -> the group slot it draws, so a raycast hit can name an entity. */
  owners: ({ group: InstanceGroup; slot: number } | null)[];
}

/**
 * One part of one group's pose variant, drawn out of a shared `Batch`.
 *
 * Replaces the `InstancedMesh` a part used to own. It carries its own `SourcePart` rather than
 * relying on a parallel array, which is what used to force the live/walk bakes to line up
 * index-for-index.
 */
interface PartDraw {
  batch: Batch;
  geometryId: number;
  part: SourcePart;
  /** slot -> instanceId. Sparse: an instance is allocated the first time a slot draws this part. */
  instances: number[];
}

interface InstanceGroup {
  key: string;
  assetId: string;
  /** Which `BATCH_CELL_SIZE` cell this group's parts batch into. See `batchFor`. */
  cell: string;
  /** Set when this group draws a dressed humanoid rather than a single GLB. */
  character: CharacterSpec | null;
  depletedAssetId: string | null;
  archetype: Archetype;
  tier: number;
  /** slot -> entity, or null for a freed slot. */
  slots: (EntityId | null)[];
  free: number[];
  liveParts: SourcePart[];
  /** Built on first spent slot. See `ensureSpent`. */
  spentParts: SourcePart[] | null;
  /**
   * Built on the first slot that actually moves. See `ensureMoving`.
   *
   * Lazy for the same reason `spentParts` is: a second baked pose is a second set of geometries
   * uploaded into the batches, and nothing in the world moves at any of the 18 poses in
   * debug/shots.ts, so building it eagerly would spend buffer space nothing ever draws.
   */
  movingParts: SourcePart[] | null;
  live: PartDraw[];
  spent: PartDraw[];
  moving: PartDraw[];
  /** True when this group's parts came from a rigged asset baked into a pose. */
  posed: boolean;
  /** True when the asset is rigged but no baked pose was available when the group was built. */
  needsPose: boolean;
}

/** A live skeletal animation on one non-instanced entity. */
interface RigState {
  mixer: THREE.AnimationMixer;
  /** The node the mixer was built on: for a dressed character that is the BODY, not the group. */
  root: THREE.Object3D;
  action: THREE.AnimationAction;
  clipName: string;
  motion: CharacterMotion;
  /** Motion to fall back to when a one-shot finishes. */
  resting: CharacterMotion;
  /** Per-entity timescale jitter, reapplied on every clip switch. */
  timeScale: number;
}

interface ViewRecord {
  entityId: EntityId;
  archetype: Archetype;
  groupKey: string;
  slot: number;
  /** Non-instanced fallback for rigged characters. */
  unique: THREE.Object3D | null;
  /** Assembly backing `unique` when it is a dressed humanoid. Owns geometries; must be disposed. */
  dressed: DressedCharacter | null;
  /** Mixer driving `unique`, when this entity earned one. */
  rig: RigState | null;
  /** Meshes in `unique`, counted once at build rather than guessed. */
  uniqueMeshes: number;
  /** Draw calls `unique` costs, shadow pass included. Returned to the pool on release. */
  uniqueCost: number;
  /** True when this record's cost came out of the named pool. See `canAffordUnique`. */
  named: boolean;
  /** Set when a rigged entity was built before its skeleton source was available. */
  awaitingRig: boolean;
  /**
   * True when this entity's asset is skinned, so it is eligible for a mixer if the budget and the
   * camera distance ever allow one. Cached because `rebalanceUniques` asks it every frame and
   * `isRigged` walks a scene graph on a miss.
   */
  rigCandidate: boolean;
  /** Cheap change detection so a steady frame writes nothing. */
  signature: string;
  /** Where this entity is DRAWN. Equal to `target` unless `syncMotion` is interpolating. */
  position: THREE.Vector3;
  /** The last position semantics reported. */
  target: THREE.Vector3;
  /** The one before that, so a render frame can interpolate between the two. */
  previous: THREE.Vector3;
  rotationY: number;
  targetRotationY: number;
  previousRotationY: number;
  /** Syncs left before this entity stops counting as moving. See `MOVING_HOLD_SYNCS`. */
  movingTicks: number;
  scale: number;
  spent: boolean;
  /** Unit terrain normal from `view.groundNormal`, or null. */
  normal: readonly [number, number, number] | null;
  tilt: number;
  labelHeight: number;
  radius: number;
}

export interface EntityViewStats {
  entities: number;
  groups: number;
  /** Parts uploaded into a batch, across every group and pose variant. NOT a draw-call count. */
  instancedMeshes: number;
  uniqueViews: number;
  /** Unique views carrying a live `AnimationMixer`. */
  riggedViews: number;
  /** Mixers actually ticked on the most recent `update`, after the budget and radius cuts. */
  animatedLastFrame: number;
  /** Rigged assets whose instanced fallback runs from a baked idle pose, not bind pose. */
  bakedPoses: number;
  highlights: number;
  /** Of `instancedMeshes`, the ones with at least one occupied slot. The rest submit nothing. */
  drawnInstancedMeshes: number;
  /** `BatchedMesh`es allocated: one per (material, geometry attribute signature). See `Batch`. */
  batches: number;
  /**
   * Of those, the ones some occupied slot draws through. THIS is the submitted-draw unit.
   *
   * Measured on the shipped world after the settlements landed: 121 groups holding 251 parts
   * resolve to 43 batches, 43 of them drawn. That is the whole reason a `wall_plaster_window` in
   * Coldbrace and a `barrel_apples` in Rootfall now cost one draw between them.
   */
  drawnBatches: number;
  /**
   * Draw calls this layer would submit if the WHOLE WORLD were inside the camera frustum, shadow
   * pass included.
   *
   * IT IS NOT COMPARABLE TO `renderer.info.render.calls` AND IT NEVER WAS, which is the whole
   * history of this field. `renderer.info.render.calls` is ONE FRAME of the WHOLE SCENE after
   * frustum and shadow-frustum culling — terrain chunks, scatter, buildings, water, sky and the UI
   * pass included. This is every entity in a 700x400 m world at once, this layer only, nothing
   * culled. Reading 636 here against a measured 324 there and calling it a 236-call overspend was
   * subtracting two different quantities.
   *
   * Both halves of that are now measured rather than argued. Hiding this layer's root and
   * re-running the perf harness on a real GPU gives the rest of the scene at each pose:
   * town_entrance 64 draw calls, highcairn 86, hollowcut_seam 89, bracken_pit 47, palewood_copse
   * 31. So at the `town_entrance` pose, of 385 measured calls, 321 were this file and 64 were
   * everything else in the game put together. The renderer's number is not this number and it is
   * also not small.
   *
   * NOTHING IS BUDGETED OFF THIS. `canAffordUnique` spends `namedDrawCalls` and `otherDrawCalls`
   * against `maxUniqueDrawCalls`, both counted from real merged mesh counts at the moment each
   * character is built. This field has never been an input to a decision, only a report — the
   * budget logic was never deciding on it.
   *
   * What it counts is now the BATCH, not the part: `drawnBatches * 2 + uniqueMeshes * 2 +
   * highlights * 2`. Measured on the shipped world with the settlements in: 94 drawn batches, 6
   * unique character meshes, 0 highlights -> 200, against 728 for the same world before batching.
   *
   * It also used to over-count in a way that IS fixed: it charged for every `InstancedMesh` the
   * layer had allocated, including groups whose entities all took non-instanced rigs and spent or
   * walk variants nothing was in. Only variants with an occupied slot are charged now.
   */
  estimatedDrawCalls: number;
  /** Draw calls currently spent on the non-instanced character path, against its own budget. */
  uniqueDrawCalls: number;
  /** That total split by pool, because the two are budgeted separately. See `canAffordUnique`. */
  namedDrawCalls: number;
  otherDrawCalls: number;
  /** Unique views assembled from a base body plus layered parts rather than from one GLB. */
  dressedCharacters: number;
  /** Instance groups whose parts were baked from a dressed body-plus-parts assembly. */
  dressedGroups: number;
  /** Records currently drawn in their walk pose. */
  movingViews: number;
  triangles: number;
  missingAssets: string[];
}

export interface EntityViewOptions {
  /**
   * THE cap that matters, expressed in the unit the budget is written in.
   *
   * A rigged character cannot be instanced — its pose lives in its skeleton — so every one of them
   * is a straight per-mesh cost, doubled because they cast. A fully dressed character is 10 skinned
   * meshes (stack-findings.md section 7) and the Phase 1 base NPCs are 3-4, so a cap counted in
   * ENTITIES is off by a factor of three depending on which asset happens to be nearby. Counting
   * draw calls instead makes the ceiling mean the same thing whatever the art is.
   *
   * Off-screen characters are frustum-culled to nothing, so this is a world-wide allowance rather
   * than a per-frame one; the per-frame cost is whatever subset is actually in shot.
   */
  maxUniqueDrawCalls?: number;
  /** Hard ceiling on unique objects regardless of cost, so a cheap asset cannot flood the scene. */
  maxUniqueViews?: number;
  /**
   * Mixers ticked per frame, nearest first. Separate from `maxUniqueViews` because a mixer costs
   * CPU every frame while a unique object only costs draw calls when it is on screen.
   */
  maxAnimatedViews?: number;
  /** Metres past which a rig stops being ticked and holds its pose. Sits inside the fog start. */
  animationRadius?: number;
  /** Ring radius floor, so a small node is still clickable-looking at 12 m. */
  minHighlightRadius?: number;
}

export class EntityViews {
  private readonly groups = new Map<string, InstanceGroup>();
  private readonly records = new Map<EntityId, ViewRecord>();
  private readonly highlights = new Map<EntityId, THREE.Object3D>();
  /** Every `BatchedMesh` this layer draws through, keyed by material identity. See `Batch`. */
  private readonly batches = new Map<string, Batch>();
  private readonly batchOwners = new WeakMap<THREE.BatchedMesh, Batch>();
  private readonly missing = new Set<string>();
  private readonly group = new THREE.Group();
  private readonly highlightGroup = new THREE.Group();

  /**
   * The ORIGINAL loaded scene graph per asset id, not a clone.
   *
   * `AssetRegistry.instance()` hands out `source.clone(true)`, and `Object3D.clone` copies a
   * SkinnedMesh's `skeleton` BY REFERENCE — every plain clone deforms with the original's bones,
   * so animating one animates none of them. `SkeletonUtils.clone` fixes that, but only when it is
   * handed the true original, which is why this map exists.
   */
  private readonly sources = new Map<string, THREE.Object3D>();
  private readonly sourceRequests = new Set<string>();
  private sourcesChanged = false;

  private readonly riggedAssets = new Map<string, boolean>();
  /** `(assetKey, archetype)` -> does tier belong in the group key. See `groupTier`. */
  private readonly tierKeyed = new Map<string, boolean>();
  private readonly seamGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly bakedGeometries: THREE.BufferGeometry[] = [];
  /** Rigged records with a mixer. Kept as its own set so `update` never walks 600 ore nodes. */
  private readonly animated = new Set<ViewRecord>();
  private readonly animationOrder: ViewRecord[] = [];
  private animatedLastFrame = 0;
  /** Meshes per rigged asset, so the budget can be checked BEFORE paying for a skeleton clone. */
  private readonly meshCounts = new Map<string, number>();
  /**
   * Draw calls a fully assembled dressed character costs, keyed by `CharacterSpec.key`.
   *
   * Filled in by `bakedParts`, which assembles every character spec once while building its
   * instance group — and `ensureGroup` always runs before the unique decision in `acquire`, so by
   * the time the budget is checked the true merged cost is known rather than estimated.
   */
  private readonly characterCosts = new Map<string, number>();
  /** Resolved character specs, keyed by (entity, assetId, authored parts). See `characterFor`. */
  private readonly characterSpecs = new Map<string, CharacterSpec | null>();
  private uniqueDrawCalls = 0;
  private namedDrawCalls = 0;
  private otherDrawCalls = 0;
  /** Records currently holding a non-instanced object. See `countUnique`. */
  private uniqueViewCount = 0;

  private readonly maxUniqueDrawCalls: number;
  private readonly maxUniqueViews: number;
  private readonly maxAnimatedViews: number;
  private readonly animationRadiusSq: number;
  private readonly uniqueReleaseRadiusSq: number;
  private readonly minHighlightRadius: number;
  /**
   * Last camera position `update` was given, or null before the first frame.
   *
   * The unique/rig pools are allocated against this. Null means "nobody has told us where the
   * camera is", and the pools then behave exactly as they did before — first-come — which is what
   * the very first `sync` (boot runs one before the loop starts) needs.
   */
  private viewer: THREE.Vector3 | null = null;
  /** Records whose asset is skinned, instanced or not. Kept apart so the rebalance is ~60 rows. */
  private readonly rigCandidates = new Set<ViewRecord>();
  private ringGeometry: THREE.BufferGeometry | null = null;
  private pipGeometry: THREE.BufferGeometry | null = null;

  constructor(
    private readonly scene: WorldScene,
    private readonly assets: AssetRegistry,
    private readonly materials: MaterialLibrary,
    options: EntityViewOptions = {},
  ) {
    this.maxUniqueDrawCalls = options.maxUniqueDrawCalls ?? 96;
    this.maxUniqueViews = options.maxUniqueViews ?? 24;
    this.maxAnimatedViews = options.maxAnimatedViews ?? 10;
    const animationRadius = options.animationRadius ?? 40;
    this.animationRadiusSq = animationRadius ** 2;
    this.uniqueReleaseRadiusSq = (animationRadius * UNIQUE_RELEASE_FACTOR) ** 2;
    this.minHighlightRadius = options.minHighlightRadius ?? 0.9;
    this.group.name = "entity-views";
    this.highlightGroup.name = "entity-highlights";
    this.scene.entityGroup.add(this.group);
    this.scene.overlayGroup.add(this.highlightGroup);
  }

  // ------------------------------------------------------------- loading

  /**
   * Loads every GLB the given entities reference. Call once after the world layer has built its
   * entities and before the first `sync`; `sync` silently skips anything not loaded, so a missing
   * asset costs one invisible entity rather than a boot failure.
   *
   * Calling this is OPTIONAL — `sync` requests any source it is missing and upgrades the affected
   * entities on the next pass — but calling it means characters are rigged on their very first
   * frame instead of a quarter of a second later.
   */
  async prepare(entities: readonly SemanticEntity[]): Promise<{ loaded: number; missing: string[] }> {
    const wanted = new Set<string>();
    for (const entity of entities) {
      if (!entity.view) continue;
      wanted.add(entity.view.assetId);
      if (entity.view.depletedAssetId) wanted.add(entity.view.depletedAssetId);
      // A dressed character needs its body, every outfit part and its hair before the first sync,
      // or it is built from whatever HAS landed and re-acquired later — which is a visible pop.
      const character = characterSpecFor(entity.id, entity.view.assetId, entity.view.partAssetIds);
      if (!character) continue;
      wanted.add(character.bodyAssetId);
      for (const partId of character.partAssetIds) wanted.add(partId);
    }

    const ids = [...wanted].filter((id) => {
      if (this.assets.entry(id)) return true;
      this.missing.add(id);
      return false;
    });

    const results = await Promise.allSettled(ids.map((id) => this.assets.load(id)));
    let loaded = 0;
    for (const [index, result] of results.entries()) {
      const id = ids[index]!;
      if (result.status === "fulfilled") {
        loaded += 1;
        this.sources.set(id, result.value);
      } else {
        this.missing.add(id);
      }
    }
    return { loaded, missing: [...this.missing] };
  }

  /**
   * Grabs the true source graph for an asset, kicking off the (already-resolved) registry load the
   * first time it is asked for. Returns null until that microtask lands; callers degrade to the
   * static path and `sync` retries them once `sourcesChanged` flips.
   */
  private sourceOf(id: string): THREE.Object3D | null {
    const cached = this.sources.get(id);
    if (cached) return cached;
    if (!this.assets.isLoaded(id) || this.sourceRequests.has(id)) return null;
    this.sourceRequests.add(id);
    void this.assets
      .load(id)
      .then((group) => {
        this.sources.set(id, group);
        this.sourcesChanged = true;
      })
      .catch(() => {
        this.missing.add(id);
      });
    return null;
  }

  // ---------------------------------------------------------------- sync

  /**
   * Reconciles the drawn world with the semantic world.
   *
   * Cheap by design: an entity whose position, state, tier and asset are unchanged costs one string
   * comparison. Entities that vanished from the list release their slot; new ones take one.
   */
  sync(entities: readonly SemanticEntity[]): void {
    if (this.sourcesChanged) {
      this.sourcesChanged = false;
      this.dropUnposed();
    }

    const seen = new Set<EntityId>();

    for (const entity of entities) {
      if (!entity.view) continue;
      seen.add(entity.id);
      this.syncOne(entity);
    }

    for (const [entityId, record] of this.records) {
      if (seen.has(entityId)) continue;
      this.release(record);
      this.records.delete(entityId);
      this.clearHighlight(entityId);
    }
  }

  /**
   * Per-frame tick. The root calls this from the render frame:
   *
   *   entityViews.update(deltaSeconds, renderer.camera.position);
   *
   * `sync` is NOT this — it runs a few times a second and diffs semantics. Animation needs real
   * wall-clock delta every frame, which is why it is a separate entry point.
   *
   * The viewer position is optional. With it, rigs are ticked nearest-first and anything past
   * `animationRadius` stops being ticked at all; without it, the nearest-first ordering is skipped
   * and the budget alone applies. Either way an untickled rig FREEZES on its current pose rather
   * than snapping back to bind, so the fallback is a still character, never a T-pose.
   */
  update(deltaSeconds: number, viewer?: THREE.Vector3): void {
    this.animatedLastFrame = 0;
    if (viewer) {
      this.viewer = (this.viewer ?? new THREE.Vector3()).copy(viewer);
      // Before the tick, not after: a character promoted this frame should be ticked this frame,
      // or it renders one frame of its baked pose at the exact moment the player walks up to it.
      this.rebalanceUniques();
    }
    if (this.animated.size === 0) return;

    // A backgrounded tab hands back a delta of seconds. Fast-forwarding a crowd through 40 loops
    // of an idle clip costs real time and looks identical to not doing it.
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.25);

    // Reused rather than rebuilt: this runs every frame, and a fresh array per frame is garbage
    // the collector has to walk during exactly the frames that are already the most expensive.
    const ranked = this.animationOrder;
    ranked.length = 0;
    for (const record of this.animated) ranked.push(record);
    if (viewer && ranked.length > 1) {
      ranked.sort((a, b) =>
        a.position.distanceToSquared(viewer) - b.position.distanceToSquared(viewer));
    }

    for (const record of ranked) {
      if (this.animatedLastFrame >= this.maxAnimatedViews) break;
      if (viewer && record.position.distanceToSquared(viewer) > this.animationRadiusSq) break;
      record.rig?.mixer.update(delta);
      this.animatedLastFrame += 1;
    }
  }

  /**
   * Position-and-facing refresh for the archetypes that move, cheap enough to call every frame.
   *
   * CORRECTION: this said "OPT-IN and currently uncalled". `app/loop.ts:381` now calls it every
   * render frame with `this.renderAlpha`, and that is what the numbers below are measured against.
   * `sync` runs at 4 Hz (loop.ts:266 returns early until 250 ms have passed) while
   * `EnemyAI.stepToward` writes a position every 100 ms sim tick, so three of every four enemy
   * movement steps used to be invisible and the fourth a 40 cm jump. A moving entity is now drawn
   * between the last two ticks instead of at the last one.
   *
   * Structure — asset, tier, state, add and remove — is still `sync`'s job at whatever cadence the
   * loop likes. This only moves things that already exist, so calling it is always safe and never
   * allocates a group.
   *
   * `alpha` is clamped to 0..1. Passing 1 (the default) is "no interpolation, just the current
   * position at full rate", which on its own already removes three quarters of the stepping.
   */
  syncMotion(entities: readonly SemanticEntity[], alpha = 1): void {
    if (this.records.size === 0) return;
    const blend = Math.min(1, Math.max(0, alpha));

    for (const entity of entities) {
      if (!MOVING_ARCHETYPES.has(entity.archetype)) continue;
      const record = this.records.get(entity.id);
      if (!record) continue;

      const view = entity.view;
      const rotationY = view?.rotationY ?? record.targetRotationY;
      const dx = entity.position[0] - record.target.x;
      const dz = entity.position[2] - record.target.z;
      if (Math.hypot(dx, dz) > MOVING_EPSILON) {
        record.previous.copy(record.target);
        record.target.set(entity.position[0], entity.position[1], entity.position[2]);
        // Re-arm the hold here too. Without it, calling this every frame consumes the position
        // change before `sync` ever sees one, `updateMoving` decays the counter to zero, and the
        // walking pose could never latch for anything.
        record.movingTicks = MOVING_HOLD_SYNCS;
      }
      if (rotationY !== record.targetRotationY) {
        record.previousRotationY = record.targetRotationY;
        record.targetRotationY = rotationY;
      }

      record.position.lerpVectors(record.previous, record.target, blend);
      record.rotationY = shortestArc(record.previousRotationY, record.targetRotationY, blend);

      if (record.unique) {
        this.placeUnique(record);
        continue;
      }
      const group = this.groups.get(record.groupKey);
      if (!group) continue;
      this.writeSlot(group, record);
    }
  }

  private syncOne(entity: SemanticEntity): void {
    const view = entity.view!;
    if (this.missing.has(view.assetId) || !this.assets.isLoaded(view.assetId)) return;

    const tier = view.materialTier ?? entity.tier;
    const clip = view.clipFraction ?? 0;
    const character = this.characterFor(entity.id, view.assetId, view.partAssetIds);
    const groupKey = `${character?.key ?? view.assetId}|${view.depletedAssetId ?? "-"}|${this.groupTier(entity.archetype, tier, view.assetId, character)}|${entity.archetype}|${clip}|${batchCell(entity.archetype, entity.position)}`;
    const spent = SPENT_STATES.has(entity.state);
    const silhouette = TIERED_ARCHETYPES.has(entity.archetype) ? tierSilhouetteScale(tier) : 1;
    const scale = (view.scale ?? 1) * silhouette;
    const rotationY = view.rotationY ?? 0;
    const normal = view.groundNormal ?? null;
    const tilt = normal ? (view.tiltStrength ?? DEFAULT_TILT[entity.archetype] ?? 0) : 0;

    // Movement has to be decided BEFORE the signature, because it is part of it: an enemy that
    // stops walking stops changing position, so a signature built from position alone would never
    // notice the stop and the walk pose would stick forever.
    const moving = this.updateMoving(entity);
    const signature = `${groupKey}|${spent ? 1 : 0}|${moving ? 1 : 0}|${round(entity.position[0])},${round(entity.position[1])},${round(entity.position[2])}|${round(rotationY)}|${round(scale)}|${tiltKey(normal, tilt)}`;

    let existing = this.records.get(entity.id);

    // A rigged entity built before its skeleton arrived is holding a baked idle frame. Upgrade it
    // the moment the source is available, per entity, rather than waiting for the global
    // `sourcesChanged` sweep in `sync`: that sweep only fires when some OTHER asset finishes
    // loading, and anything that was not in the entity list on that exact pass never got a second
    // look. Ordrun is in the dungeon, the dungeon is not in the list until the player is inside
    // it, and so the boss of the game stood through a two-phase fight in bind-adjacent pose.
    if (existing?.awaitingRig && this.characterReady(view.assetId, character)) {
      this.release(existing);
      this.records.delete(entity.id);
      existing = undefined;
    }

    if (existing && existing.signature === signature) return;

    if (existing && existing.groupKey !== groupKey) {
      this.release(existing);
      this.records.delete(entity.id);
    }

    const record = this.records.get(entity.id) ?? this.acquire(entity, groupKey, tier, clip, character);
    if (!record) return;

    record.signature = signature;
    record.target.set(entity.position[0], entity.position[1], entity.position[2]);
    record.position.copy(record.target);
    record.previousRotationY = record.targetRotationY;
    record.targetRotationY = rotationY;
    record.rotationY = rotationY;
    record.scale = scale;
    record.spent = spent;
    record.normal = normal;
    record.tilt = tilt;
    record.labelHeight = view.labelHeight ?? 1.6;
    record.radius = Math.max(this.minHighlightRadius, this.assetRadius(view.assetId) * scale);

    const group = this.groups.get(groupKey);
    if (!group) return;

    this.setMotion(record, spent ? "death" : moving ? "walk" : "idle");

    if (record.unique) {
      this.placeUnique(record);
      this.applyUniqueState(record, tier);
    } else {
      this.writeSlot(group, record);
    }

    const highlight = this.highlights.get(entity.id);
    if (highlight) this.placeHighlight(highlight, record);
  }

  /**
   * Tracks whether an entity moved since the last sync, with hysteresis.
   *
   * Only `MOVING_ARCHETYPES` are tracked. Everything else in the world is placed once at boot and
   * never moves again, and paying a vector compare per ore node per sync buys nothing.
   */
  private updateMoving(entity: SemanticEntity): boolean {
    if (!MOVING_ARCHETYPES.has(entity.archetype)) return false;
    const record = this.records.get(entity.id);
    if (!record) return false;
    const dx = entity.position[0] - record.target.x;
    const dz = entity.position[2] - record.target.z;
    if (Math.hypot(dx, dz) > MOVING_EPSILON) {
      record.previous.copy(record.target);
      record.movingTicks = MOVING_HOLD_SYNCS;
    } else if (record.movingTicks > 0) {
      record.movingTicks -= 1;
    }
    return record.movingTicks > 0;
  }

  private acquire(
    entity: SemanticEntity,
    groupKey: string,
    tier: number,
    clip: number,
    character: CharacterSpec | null,
  ): ViewRecord | null {
    const view = entity.view!;
    const group = this.ensureGroup(
      groupKey, view.assetId, view.depletedAssetId ?? null, entity.archetype, tier,
      batchCell(entity.archetype, entity.position), clip, character,
    );
    if (!group) return null;

    // Rigged characters cannot be instanced with a live pose (their pose lives in the skeleton), so
    // a capped number of them get their own object and a mixer. The rest fall back to an instance
    // of the baked idle pose, which is cheap and — unlike bind pose — looks like a person.
    const rigged = group.liveParts.length === 0 || this.isRigged(view.assetId);
    const ready = rigged && this.characterReady(view.assetId, character);

    const record: ViewRecord = {
      entityId: entity.id,
      archetype: entity.archetype,
      groupKey,
      slot: -1,
      unique: null,
      dressed: null,
      rig: null,
      uniqueMeshes: 0,
      uniqueCost: 0,
      named: entity.archetype === "npc" || entity.archetype === "boss",
      // A rigged entity built before its skeleton source arrived is re-acquired on the next sync.
      awaitingRig: rigged && !ready,
      rigCandidate: rigged,
      signature: "",
      // Seeded from the entity rather than left at the origin: `buildUnique` allocates the rig pool
      // by distance from the camera, and a record reading (0,0,0) until `syncOne` writes it back
      // would be measured from the middle of the world.
      position: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      target: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      previous: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      rotationY: view.rotationY ?? 0,
      targetRotationY: view.rotationY ?? 0,
      previousRotationY: view.rotationY ?? 0,
      movingTicks: 0,
      scale: 1,
      spent: false,
      normal: null,
      tilt: 0,
      labelHeight: view.labelHeight ?? 1.6,
      radius: this.minHighlightRadius,
    };

    if (!ready || !this.buildUnique(record, group)) {
      const slot = this.takeSlot(group, entity.id);
      if (slot < 0) return null;
      record.slot = slot;
    }

    this.records.set(entity.id, record);
    if (rigged) this.rigCandidates.add(record);
    return record;
  }

  /**
   * Gives one record the non-instanced, mixer-driven copy of its character, if it can have one.
   *
   * Split out of `acquire` because `rebalanceUniques` needs the identical construction when a
   * character walks into range long after its group was built. Returns false and leaves the record
   * untouched when the source is not in, the budget is spent, or the entity is too far from the
   * camera to be worth a skeleton.
   */
  private buildUnique(record: ViewRecord, group: InstanceGroup): boolean {
    const assetId = group.assetId;
    const character = group.character;
    const source = this.sourceOf(assetId);
    if (!source) return false;
    if (!this.canAffordUnique(record.archetype, assetId, source, character, record.position)) {
      return false;
    }

    const dressed = character ? this.assembleCharacter(character) : null;
    const unique = dressed ? dressed.group : cloneRigged(source);
    const uniqueMeshes = dressed ? dressed.drawCalls : this.meshesIn(assetId, source);
    const entityId = record.entityId;
    unique.userData.entityId = entityId;
    unique.traverse((child) => {
      child.userData.entityId = entityId;
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Characters ground themselves with their own shadow. It is the second draw the budget is
      // counting, and a floating shadowless NPC reads as unfinished on its own.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Keep the authored material, so a live -> dead -> respawned entity re-derives its look
      // from the ART rather than from its own previous variant. Compounding variants is how a
      // node that respawns after being mined comes back permanently grey.
      mesh.userData.baseMaterial = mesh.material;
    });
    this.group.add(unique);

    record.unique = unique;
    record.dressed = dressed;
    record.uniqueMeshes = uniqueMeshes;
    record.uniqueCost = uniqueMeshes * 2;
    record.awaitingRig = false;
    this.uniqueViewCount += 1;
    this.spend(record.named, record.uniqueCost);

    record.rig = this.attachRig(entityId, dressed?.animationRoot ?? unique, assetId);
    if (record.rig) {
      this.animated.add(record);
      this.bindRigEvents(record);
    }
    return true;
  }

  /**
   * Moves the rig pools to whoever is standing in front of the camera, once per frame.
   *
   * Demote first, then promote, and in that order for a reason: the pool is what gates promotion,
   * so walking from Coldbrace to Highcairn can only light up Highcairn NPCs after the four in
   * Coldbrace have handed their 48 draw calls back. Both halves are no-ops until `update` has been
   * given a camera position, which is what makes the boot-time first sync behave as it always did.
   *
   * A demoted character does NOT vanish for the quarter second until the next `sync`: it takes an
   * instance slot in the same pass and is written into its group baked pose immediately.
   */
  private rebalanceUniques(): void {
    const viewer = this.viewer;
    if (!viewer || this.rigCandidates.size === 0) return;

    for (const record of this.rigCandidates) {
      // The boss is exempt in both directions. There is one of them, the fight is the climax of its
      // region, and an instanced boss is a rig frozen on one baked frame through a two-phase fight.
      if (!record.unique || record.archetype === "boss") continue;
      if (record.position.distanceToSquared(viewer) <= this.uniqueReleaseRadiusSq) continue;
      const group = this.groups.get(record.groupKey);
      if (!group) continue;
      const slot = this.takeSlot(group, record.entityId);
      if (slot < 0) continue;
      this.releaseUnique(record);
      record.slot = slot;
      this.writeSlot(group, record);
    }

    let promoted = 0;
    for (const record of this.rigCandidates) {
      if (promoted >= UNIQUE_PROMOTIONS_PER_FRAME) break;
      if (record.unique || record.slot < 0) continue;
      if (record.position.distanceToSquared(viewer) > this.animationRadiusSq) continue;
      const group = this.groups.get(record.groupKey);
      if (!group || !this.characterReady(group.assetId, group.character)) continue;
      const slot = record.slot;
      if (!this.buildUnique(record, group)) continue;
      promoted += 1;
      this.freeSlot(group, record.entityId, slot);
      record.slot = -1;
      this.placeUnique(record);
      this.applyUniqueState(record, group.tier);
      this.setMotion(record, record.spent ? "death" : record.movingTicks > 0 ? "walk" : "idle");
    }
  }

  private release(record: ViewRecord): void {
    this.rigCandidates.delete(record);
    if (record.unique) {
      this.releaseUnique(record);
      return;
    }
    const group = this.groups.get(record.groupKey);
    if (!group || record.slot < 0) return;
    this.freeSlot(group, record.entityId, record.slot);
    record.slot = -1;
  }

  /**
   * Tears down one non-instanced character: mixer, scene node, owned geometry, pooled draw calls.
   *
   * Separate from `release` because `rebalanceUniques` demotes a character to its instanced pose
   * without the record going away, and that path must not drop the record out of `rigCandidates`
   * (it is exactly the record that has to be promoted again when the player walks back).
   */
  private releaseUnique(record: ViewRecord): void {
    if (record.rig) {
      record.rig.action.stop();
      record.rig.mixer.stopAllAction();
      record.rig.mixer.uncacheRoot(record.rig.root);
      this.animated.delete(record);
      record.rig = null;
    }
    if (!record.unique) return;
    this.uniqueViewCount = Math.max(0, this.uniqueViewCount - 1);
    record.unique.removeFromParent();
    // `DressedCharacter.dispose` frees the head-cap and merged geometries this assembly allocated
    // and nothing else owns. The source geometries and materials are shared with the loaded asset
    // and are deliberately left alone.
    record.dressed?.dispose();
    record.dressed = null;
    record.unique = null;
    this.refund(record.named, record.uniqueCost);
    record.uniqueCost = 0;
    record.uniqueMeshes = 0;
  }

  /** Hands one instance slot back to its group and hides it in every pose variant. */
  private freeSlot(group: InstanceGroup, entityId: EntityId, slot: number): void {
    if (slot < 0 || group.slots[slot] !== entityId) return;
    group.slots[slot] = null;
    group.free.push(slot);
    for (const draw of group.live) hideInstance(draw, slot);
    for (const draw of group.spent) hideInstance(draw, slot);
    for (const draw of group.moving) hideInstance(draw, slot);
  }

  private spend(named: boolean, cost: number): void {
    if (named) this.namedDrawCalls += cost;
    else this.otherDrawCalls += cost;
    this.uniqueDrawCalls += cost;
  }

  private refund(named: boolean, cost: number): void {
    if (named) this.namedDrawCalls = Math.max(0, this.namedDrawCalls - cost);
    else this.otherDrawCalls = Math.max(0, this.otherDrawCalls - cost);
    this.uniqueDrawCalls = Math.max(0, this.uniqueDrawCalls - cost);
  }

  /**
   * Throws away everything that was built while a skeleton source was still in flight, so the next
   * sync pass rebuilds it properly: unique objects get a real rig, and instanced rigged groups get
   * their baked pose instead of bind pose.
   *
   * This runs at most once per boot in practice. `AssetRegistry.load` resolves from cache in a
   * single microtask, so the only pass that ever sees a missing source is the synchronous one boot
   * fires before the loop starts.
   */
  private dropUnposed(): void {
    const stale = new Set<string>();
    for (const [key, group] of this.groups) {
      if (group.needsPose && this.sources.has(group.assetId)) stale.add(key);
    }

    for (const [entityId, record] of [...this.records]) {
      const group = this.groups.get(record.groupKey);
      const sourceReady = group ? this.sources.has(group.assetId) : false;
      if (!stale.has(record.groupKey) && !(record.awaitingRig && sourceReady)) continue;
      this.release(record);
      this.records.delete(entityId);
    }

    for (const key of stale) {
      const group = this.groups.get(key);
      if (!group) continue;
      this.releaseDraws(group.live);
      this.releaseDraws(group.spent);
      this.releaseDraws(group.moving);
      this.groups.delete(key);
    }
  }

  // ------------------------------------------------------------- groups

  private ensureGroup(
    key: string,
    assetId: string,
    depletedAssetId: string | null,
    archetype: Archetype,
    tier: number,
    cell: string,
    clipFraction = 0,
    character: CharacterSpec | null = null,
  ): InstanceGroup | null {
    const existing = this.groups.get(key);
    if (existing) return existing;

    const rigged = this.isRigged(assetId);
    const ready = rigged && this.characterReady(assetId, character);
    let liveParts = ready
      ? this.bakedParts(assetId, character, archetype, tier, false, "idle")
      : this.collectParts(assetId, archetype, tier, false);

    // `view.clipFraction` keeps only the bottom of the mesh. One geometry per group, built once.
    if (clipFraction > 0 && clipFraction < 1) {
      const clipped = clipPartsBelow(liveParts, clipFraction);
      if (clipped.length > 0) liveParts = clipped;
    }

    // The ore seam. It is a separate part on the LIVE side only: losing the vein is half of what
    // makes a depleted node read as depleted.
    if (archetype === "ore" && liveParts.length > 0) {
      const seam = this.seamPart(assetId, tier, liveParts);
      if (seam) liveParts.push(seam);
    }

    const group: InstanceGroup = {
      key,
      assetId,
      cell,
      character,
      depletedAssetId,
      archetype,
      tier,
      slots: [],
      free: [],
      liveParts,
      spentParts: null,
      movingParts: null,
      live: [],
      spent: [],
      moving: [],
      posed: ready,
      needsPose: rigged && !ready,
    };
    group.live = this.buildDraws(group.liveParts, group.cell);
    this.groups.set(key, group);
    return group;
  }

  /**
   * Builds the spent variant on first use.
   *
   * Round 1 built it eagerly for every group, which doubled the instanced mesh count of the whole
   * entity layer for a state most nodes are never in. It costs less than it did — an unused spent
   * geometry sits in a batch with no visible instance and is left out of the multi-draw — but the
   * buffer space and the bake are still real, and most nodes are never spent.
   */
  private ensureSpent(group: InstanceGroup): void {
    if (group.spent.length > 0) return;
    if (!group.spentParts) group.spentParts = this.buildSpentParts(group);
    // A group with no spent geometry at all keeps its LIVE instance drawn under the spent
    // material rather than being hidden. `writeSlot` switches the live instance off only when it
    // has something to put in its place; a node that vanishes on depletion is worse than one that
    // only changes colour, and that vanishing is exactly what Phase 1 shipped.
    if (group.spentParts.length === 0) return;
    group.spent = this.buildDraws(group.spentParts, group.cell);
  }

  /**
   * Builds the walking variant on first use, for a rigged group only.
   *
   * The instanced path cannot animate — a batched draw ignores skinning entirely — but it can
   * hold a DIFFERENT baked pose depending on what the entity is doing, which is the difference
   * between fifty enemies that are all one frozen statue and fifty that at least stand differently
   * when they are chasing you. Only built when something in the group actually moves, so the 18
   * static poses in debug/shots.ts pay nothing for it.
   */
  private ensureMoving(group: InstanceGroup): void {
    if (group.moving.length > 0 || !group.posed) return;
    if (!group.movingParts) {
      group.movingParts = this.bakedParts(
        group.assetId, group.character, group.archetype, group.tier, false, "walk",
      );
    }
    // The live and walk bakes no longer have to line up part-for-part: a `PartDraw` carries its own
    // `SourcePart`, so `writeSlot` reads each variant's own geometry and transform instead of
    // indexing one array with the other's positions.
    if (group.movingParts.length === 0) return;
    group.moving = this.buildDraws(group.movingParts, group.cell);
  }

  /**
   * What a worked-out node looks like.
   *
   * The rule is that a spent node keeps the silhouette the player walked up to. Swapping in a
   * different, smaller asset reads as the node disappearing, because from ten metres up a
   * `rock_small_1` standing where a `rock_medium_1` stood is indistinguishable from nothing at all.
   * So the spent variant is derived from the LIVE geometry wherever the archetype gives us a
   * meaning for "spent":
   *
   *   ore        the rock, minus its vein. The vein is already a separate part (see `seamPart`),
   *              so dropping it is exactly the change the player made by mining it.
   *   tree       the trunk, clipped to `TREE_STUMP_FRACTION` of its height: a stump.
   *   farm_plot  the crop cut back to `CROP_STUBBLE_FRACTION`: stubble.
   *
   * Everything else falls back to `depletedAssetId` when content authored one, and to the live
   * geometry under the spent material when it did not.
   */
  private buildSpentParts(group: InstanceGroup): SourcePart[] {
    const live = this.spentMaterialParts(group);

    if (group.archetype === "ore") {
      // `ensureGroup` appends the seam as the LAST live part, so everything before it is the rock.
      const seamIndex = group.liveParts.length - 1;
      const rock = live.filter((_part, index) => index !== seamIndex || live.length === 1);
      if (rock.length > 0) return rock;
    }

    if (group.archetype === "tree" || group.archetype === "farm_plot") {
      const fraction = group.archetype === "tree" ? TREE_STUMP_FRACTION : CROP_STUBBLE_FRACTION;
      const clipped = clipPartsBelow(live, fraction);
      if (clipped.length > 0) return clipped;
    }

    if (group.depletedAssetId && this.assets.isLoaded(group.depletedAssetId)) {
      const rigged = this.isRigged(group.depletedAssetId);
      const source = rigged ? this.sourceOf(group.depletedAssetId) : null;
      const parts = rigged && source
        ? this.bakedParts(group.depletedAssetId, null, group.archetype, group.tier, true, "death")
        : this.collectParts(group.depletedAssetId, group.archetype, group.tier, true);
      if (parts.length > 0) return parts;
    }

    return live;
  }

  /**
   * The live parts again, re-materialised with the spent variant. Geometry is shared, not copied.
   *
   * For a rigged group the pose changes too: this is the corpse, and every one of the four enemy
   * packs ships a `Death` clip. Baking that clip's final frame is what turns a killed enemy from a
   * grey statue standing to attention into a body on the ground, at zero extra draw calls — the
   * spent variant already existed, it was just holding the idle pose.
   */
  private spentMaterialParts(group: InstanceGroup): SourcePart[] {
    const rigged = this.isRigged(group.assetId);
    const parts = rigged && this.characterReady(group.assetId, group.character)
      ? this.bakedParts(group.assetId, group.character, group.archetype, group.tier, true, "death")
      : this.collectParts(group.assetId, group.archetype, group.tier, true);
    if (group.archetype !== "ore" || parts.length === 0) return parts;

    // The ore seam is generated, not authored, so `collectParts` never returns it. Re-append it in
    // the same position the live side has it, or the index arithmetic above lines up with nothing.
    const seam = this.seamPart(group.assetId, group.tier, parts);
    if (seam) parts.push({ ...seam, material: this.materials.oreRock(group.tier, true) });
    return parts;
  }

  /**
   * Pulls (geometry, material, local transform) out of a loaded GLB and builds the tier variant of
   * each material. `MaterialLibrary.variant` keeps the source's base-colour texture and swaps only
   * colour/roughness/emissive, which is what stops tier ladders from fragmenting instancing
   * (architecture correction R6).
   */
  private collectParts(
    assetId: string,
    archetype: Archetype,
    tier: number,
    spent: boolean,
  ): SourcePart[] {
    if (!this.assets.isLoaded(assetId)) return [];
    const source = this.sources.get(assetId) ?? this.assets.instance(assetId);
    source.updateMatrixWorld(true);

    const parts: SourcePart[] = [];
    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!base) return;
      parts.push({
        geometry: mesh.geometry,
        material: this.variantFor(base, archetype, tier, spent),
        matrix: mesh.matrixWorld.clone(),
        triangles: triangleCount(mesh.geometry),
      });
    });
    return parts;
  }

  /**
   * The instanced fallback for a rigged asset: one frame of one clip, CPU-skinned into static
   * geometry.
   *
   * An `InstancedMesh` ignores skinning entirely, so instancing a skinned geometry raw draws it in
   * bind pose — the arms-straight-out look that was the single strongest "unfinished build" signal
   * in the round-1 screenshots. Baking costs a few milliseconds once per asset and nothing per
   * frame, and keeps forty background characters at four draw calls instead of a hundred and sixty.
   *
   * `motion` picks WHICH pose, so a group can hold an idle set, a walking set and a corpse set and
   * `writeSlot` chooses between them per slot. `character` makes the baked body a full dressed
   * humanoid — head, clothes and hair — rather than the clothes-only GLB that produced twelve
   * headless NPCs.
   *
   * Falls back to the raw (bind-pose) parts if anything about the rig is unexpected. A slightly
   * wrong pose is worth having; a boot failure over a cosmetic path is not.
   */
  private bakedParts(
    assetId: string,
    character: CharacterSpec | null,
    archetype: Archetype,
    tier: number,
    spent: boolean,
    motion: CharacterMotion,
  ): SourcePart[] {
    const source = this.sourceOf(assetId);
    if (!source) return this.collectParts(assetId, archetype, tier, spent);
    let dressed: DressedCharacter | null = null;
    // Set when a mesh could not be CPU-skinned and its SOURCE geometry was handed out instead. That
    // geometry may be one the assembly owns, so freeing the assembly would tear it out from under
    // the InstancedMesh that now points at it.
    let sharedGeometry = false;
    try {
      dressed = character ? this.assembleCharacter(character) : null;
      const posed = dressed ? dressed.group : cloneRigged(source);
      const animationRoot = dressed ? dressed.animationRoot : posed;
      const clip = this.firstFittingClip(assetId, this.clipCandidates(assetId, assetId, motion), animationRoot);
      if (clip) {
        const mixer = new THREE.AnimationMixer(animationRoot);
        mixer.clipAction(clip).play();
        mixer.setTime(clip.duration * BAKE_PHASES[motion]);
      }
      posed.updateMatrixWorld(true);

      const parts: SourcePart[] = [];
      posed.traverse((child) => {
        const skinned = child as THREE.SkinnedMesh;
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!base) return;
        const material = this.variantFor(base, archetype, tier, spent);

        if (skinned.isSkinnedMesh && skinned.skeleton) {
          const frozen = freezeSkin(skinned);
          if (frozen) {
            this.bakedGeometries.push(frozen);
            // `applyBoneTransform` returns positions in the mesh's bind space, so the bind matrix
            // is exactly the transform that puts them back where the bones live.
            parts.push({
              geometry: frozen,
              material,
              matrix: skinned.bindMatrix.clone(),
              triangles: triangleCount(frozen),
            });
            return;
          }
        }
        sharedGeometry = true;
        parts.push({
          geometry: mesh.geometry,
          material,
          matrix: mesh.matrixWorld.clone(),
          triangles: triangleCount(mesh.geometry),
        });
      });
      if (parts.length > 0) return parts;
    } catch {
      // fall through to the unposed path
    } finally {
      // `freezeSkin` clones every geometry it bakes, so the assembly's own merged and head-capped
      // geometries are dead the moment the bake is done and can be freed here.
      if (!sharedGeometry) dressed?.dispose();
      else dressed?.group.removeFromParent();
    }
    return this.collectParts(assetId, archetype, tier, spent);
  }

  // -------------------------------------------------------- characters

  /**
   * Resolves an entity's dressed-character spec, memoised on the resolved key.
   *
   * Memoised because `sync` runs a few times a second over every entity in the world and this
   * allocates an array and a string. The map is keyed by (entityId, assetId, parts) so a semantic
   * change to the outfit still re-resolves.
   */
  private characterFor(
    entityId: EntityId,
    assetId: string,
    partAssetIds: readonly string[] | undefined,
  ): CharacterSpec | null {
    const cacheKey = `${entityId}|${assetId}|${partAssetIds?.join("+") ?? ""}`;
    const cached = this.characterSpecs.get(cacheKey);
    if (cached !== undefined) return cached;
    const spec = characterSpecFor(entityId, assetId, partAssetIds);
    this.characterSpecs.set(cacheKey, spec);
    // Start the clothes loading the FIRST time this entity is seen, not when its instance group is
    // built. `boot.preloadEntityAssets` does not know about `view.partAssetIds`, so if the request
    // waits for `ensureGroup` the group is built undressed and only a later `dropUnposed` round can
    // fix it. Kicking it here means the parts are in flight during boot's own first sync.
    if (spec) this.characterReady(assetId, spec);
    return spec;
  }

  /**
   * Like `sourceOf`, but STARTS the load for an asset the registry was never asked for.
   *
   * `sourceOf` refuses anything `assets.isLoaded` says no to, which is right for `view.assetId`:
   * boot preloads those and a miss means a genuine content error. Outfit parts are different.
   * `boot.preloadEntityAssets` (boot.ts:1116) collects `view.assetId` and `view.depletedAssetId`
   * only — it has never heard of `view.partAssetIds` — so every one of the 4-6 clothing GLBs an NPC
   * needs is unloaded at first sync. Without this, `characterReady` is false forever and every NPC
   * in the world renders as a naked base body. Measured: 12 of 12, `meshes: 3`, no clothes.
   *
   * Bounded by construction: only character parts reach here, at most six per NPC across four
   * outfits, and `sourceRequests` makes each id one request. Setting `sourcesChanged` is what makes
   * `sync` rebuild the affected groups once the clothes land.
   */
  private requestSource(id: string): THREE.Object3D | null {
    const cached = this.sources.get(id);
    if (cached) return cached;
    if (this.missing.has(id)) return null;
    if (!this.assets.entry(id)) {
      this.missing.add(id);
      return null;
    }
    if (this.assets.isLoaded(id) || this.sourceRequests.has(id)) return this.sourceOf(id);
    this.sourceRequests.add(id);
    void this.assets
      .load(id)
      .then((group) => {
        this.sources.set(id, group);
        this.sourcesChanged = true;
      })
      .catch(() => {
        this.missing.add(id);
        // Flip it on failure too, or a character waiting on a part that will never arrive is never
        // rebuilt without it and stays naked for the session.
        this.sourcesChanged = true;
      });
    return null;
  }

  /**
   * Whether every GLB a character needs has landed. A half-dressed character is not worth building.
   *
   * Requests EVERY part before answering, rather than returning false at the first one that is not
   * in yet. That is not tidiness: `sourcesChanged` triggers one `dropUnposed` rebuild round per
   * batch of arrivals, so short-circuiting means one round per part file — thirty part files across
   * twelve NPCs, at a 250 ms sync cadence, is seven seconds of NPCs standing around in their
   * underwear. Asking for all of them at once collapses that to two rounds.
   */
  private characterReady(assetId: string, character: CharacterSpec | null): boolean {
    if (!character) return this.sourceOf(assetId) !== null;
    let ready = this.requestSource(character.bodyAssetId) !== null;
    for (const partId of character.partAssetIds) {
      // A part that failed to load, or that the manifest does not carry at all, is never going to
      // arrive; dress the character without it rather than waiting forever.
      if (this.missing.has(partId)) continue;
      if (!this.requestSource(partId)) ready = false;
    }
    return ready;
  }

  /**
   * Builds one dressed humanoid: head-capped body + outfit + hair, one skeleton, merged.
   *
   * `headCap: true` is the load-bearing flag and the counter-intuitive half of the fix. Outfit parts
   * are authored to REPLACE the body below the neck, not to cover it — measured in bind space, the
   * peasant trousers sit 5.4 mm INSIDE base_male's bare thigh and the boot is 27.5 mm narrower than
   * the bare foot — so layering clothes onto an intact body leaks skin through them. Cutting the
   * body to a head cap (base_male at y 1.55, base_female at 1.50) and layering that onto the full
   * outfit is the way round that works, and it keeps the body's own Eyes and Eyebrows meshes, which
   * sit entirely above the cut.
   */
  private assembleCharacter(character: CharacterSpec): DressedCharacter | null {
    const body = this.requestSource(character.bodyAssetId);
    if (!body) return null;
    const parts: CharacterPartSource[] = [];
    for (const assetId of character.partAssetIds) {
      const source = this.requestSource(assetId);
      if (source) parts.push({ assetId, source });
    }
    try {
      const dressed = assembleDressedCharacter({
        bodyAssetId: character.bodyAssetId,
        body,
        parts,
        headCap: true,
        merge: true,
        mergeOptions: { materialKey: characterMaterialKey },
        name: `character-${character.key}`,
      });
      this.characterCosts.set(character.key, dressed.drawCalls);
      return dressed;
    } catch {
      // A body with no SkinnedMesh throws by design. Falling back to the plain clone keeps the
      // entity on screen rather than dropping it, which is the right trade for a cosmetic path.
      return null;
    }
  }

  /** Which tier treatment a given source material on a given archetype gets. */
  private variantFor(
    base: THREE.Material,
    archetype: Archetype,
    tier: number,
    spent: boolean,
  ): THREE.Material {
    const look = this.appearanceFor(archetype, base);
    return this.materials.variant(base, {
      tier,
      state: spent ? "depleted" : "normal",
      strength: look.strength,
      swatch: look.swatch,
    });
  }

  private appearanceFor(archetype: Archetype, material: THREE.Material): Appearance {
    if (PROTECTED_MATERIAL.test(material.name)) return NEUTRAL;
    if (ROOF_MATERIAL.test(material.name)) return { swatch: "body", strength: 0.42 };
    if (archetype === "tree" && LEAF_MATERIAL.test(material.name)) {
      // Canopy stays close to its authored colour: species and scale carry a tree's region look,
      // and a heavy tint here fights the world layer rather than helping it.
      return { swatch: "accent", strength: 0.25 };
    }
    return APPEARANCE[archetype] ?? NEUTRAL;
  }

  /**
   * The tier component of the instance-group key: the real tier when tier changes what this asset
   * draws, and `"-"` when it provably does not.
   *
   * This is the draw-call fix for wave 2. The three settlements added 156 props and 10 buildings,
   * and every (asset, tier) pair was its own group even when the two groups held byte-identical
   * geometry under the identical material OBJECT. Measured over the shipped world: 184 groups /
   * 356 `InstancedMesh`es keyed by tier, against 119 groups / 244 meshes keyed this way — 112
   * fewer meshes, i.e. 224 fewer world-wide submitted draws with the shadow pass counted.
   *
   * It is safe because it asks the same question the renderer does. `MaterialLibrary.variant`
   * returns the SOURCE material instance, not a clone, whenever strength, glow and state are all
   * zero/normal — so a group whose every material resolves to `strength === 0` under
   * `appearanceFor` draws the same objects at tier 1 and tier 10. The tier's other two effects are
   * both accounted for: `tierSilhouetteScale` is a per-SLOT scale and only applies to
   * `TIERED_ARCHETYPES`, all six of which have a non-zero `APPEARANCE` row and are rejected on the
   * first line below; and the spent variant's `applyDepletion` clone is derived from the source
   * colour with no palette term in it, so it too is tier-independent at strength 0.
   *
   * `ore` is the one archetype the material scan cannot answer, because its seam is GENERATED in
   * `materials.oreRock(tier)` rather than shipped in the GLB.
   */
  private groupTier(
    archetype: Archetype,
    tier: number,
    assetId: string,
    character: CharacterSpec | null,
  ): number | string {
    if (archetype === "ore") return tier;
    if ((APPEARANCE[archetype]?.strength ?? 0) > 0) return tier;
    if (TIER_BLIND_ARCHETYPES.has(archetype)) return "-";

    const cacheKey = `${character?.key ?? assetId}|${archetype}`;
    const cached = this.tierKeyed.get(cacheKey);
    if (cached !== undefined) return cached ? tier : "-";

    const ids = character ? [character.bodyAssetId, ...character.partAssetIds] : [assetId];
    let keyed = false;
    let materials = 0;
    for (const id of ids) {
      // Undecidable until the GLB is in. Keep the tier in the key for now rather than caching a
      // guess: an asset that turns out to be roof tiles must not have been merged first.
      if (!this.assets.isLoaded(id)) return tier;
      const source = this.sources.get(id) ?? this.assets.instance(id);
      source.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!material) continue;
          materials += 1;
          if (this.appearanceFor(archetype, material).strength > 0) keyed = true;
        }
      });
    }
    if (materials === 0) return tier;
    this.tierKeyed.set(cacheKey, keyed);
    return keyed ? tier : "-";
  }

  // -------------------------------------------------------------- seams

  /**
   * The ore seam geometry for one asset: a ring of angular shards sunk into the upper half of the
   * rock so a tip pokes out on every bearing.
   *
   * Built from the ACTUAL bounding box of the collected parts, not the manifest's size, because the
   * manifest records extent and says nothing about where the origin sits — a seam placed off a
   * guessed origin floats beside its rock half the time.
   *
   * Cached per asset and shared across every tier of it, so this adds exactly one InstancedMesh per
   * ore group, not one per node.
   */
  private seamPart(assetId: string, tier: number, parts: readonly SourcePart[]): SourcePart | null {
    const geometry = this.seamGeometry(assetId, parts);
    if (!geometry) return null;
    return {
      geometry,
      material: this.materials.oreRock(tier, false),
      matrix: new THREE.Matrix4(),
      triangles: triangleCount(geometry),
    };
  }

  private seamGeometry(assetId: string, parts: readonly SourcePart[]): THREE.BufferGeometry | null {
    const cached = this.seamGeometries.get(assetId);
    if (cached) return cached;

    const box = new THREE.Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      const bounds = part.geometry.boundingBox;
      if (!bounds) continue;
      box.union(bounds.clone().applyMatrix4(part.matrix));
    }
    if (box.isEmpty()) return null;

    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;

    // Deterministic jitter, seeded from the asset id: the same rock always grows the same vein, in
    // every session and every screenshot.
    const rng = new Rng(hashString(assetId));
    const radius = Math.min(size.x, size.z) * 0.34;
    const shards: THREE.BufferGeometry[] = [];
    for (let index = 0; index < SEAM_SHARDS; index += 1) {
      const angle = (index / SEAM_SHARDS) * Math.PI * 2 + rng.float(-0.3, 0.3);
      const shard = new THREE.OctahedronGeometry(1, 0);
      shard.scale(size.x * 0.115, size.y * 0.2, size.z * 0.115);
      shard.rotateZ(rng.float(-0.55, 0.55));
      shard.rotateY(angle);
      shard.translate(
        centre.x + Math.sin(angle) * radius,
        centre.y + size.y * rng.float(-0.02, 0.28),
        centre.z + Math.cos(angle) * radius,
      );
      shards.push(shard);
    }

    const merged = mergeGeometries(shards, false);
    for (const shard of shards) shard.dispose();
    if (!merged) return null;
    merged.computeBoundingSphere();
    this.seamGeometries.set(assetId, merged);
    return merged;
  }

  // ---------------------------------------------------------- animation

  /**
   * Gives one rigged object a looping clip and a motion state machine.
   *
   * Two sources of variety, both deterministic from the entity id so a screenshot is reproducible:
   * WHICH idle clip (four humanoid idles, so a row of NPCs is not doing the same thing) and WHERE
   * in the clip it starts (so the two who did land on the same clip are not in lockstep). Timescale
   * is nudged +/-12% for the same reason — identical loop lengths resynchronise within a minute.
   */
  private attachRig(entityId: EntityId, root: THREE.Object3D, assetId: string): RigState | null {
    const rng = new Rng(hashString(entityId));
    const clip = this.firstFittingClip(assetId, this.clipCandidates(assetId, entityId, "idle"), root);
    if (!clip) return null;

    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    // setTime applies the pose as well as setting it, so the very first rendered frame is already
    // mid-idle. Without it the object holds bind pose until the first update() lands.
    mixer.setTime(rng.float(0, Math.max(0.001, clip.duration)));
    const timeScale = rng.float(0.88, 1.12);
    action.timeScale = timeScale;
    return {
      mixer, root, action, clipName: clip.name, motion: "idle", resting: "idle", timeScale,
    };
  }

  /**
   * Switches a rigged entity's clip when what it is doing changes.
   *
   * Crossfades rather than cutting, and — this is the guard the animation diagnosis asks for — does
   * nothing at all when the motion is unchanged. Re-selecting the same pose and calling
   * `action.reset()` for it is exactly what froze the player's run clip: the loop asked for it
   * twenty times a second and the clip never advanced past its first two milliseconds.
   *
   * Death is a one-way door: it plays once, clamps on its last frame, and the record leaves the
   * animated set so a corpse costs no mixer time. Nothing brings a rig back out of it except a
   * respawn, which rebuilds the record.
   */
  private setMotion(record: ViewRecord, motion: CharacterMotion): void {
    const rig = record.rig;
    if (!rig || !record.unique) return;
    if (rig.motion === motion) return;
    // Death is a one-way door while the entity is still dead, so a stray one-shot cannot stand a
    // corpse back up. `EnemyAI.respawnDead` writes `state: "alive"` back onto the entity, and that
    // is the one thing that reopens it — otherwise a respawned enemy would lie on the ground for
    // the rest of the session.
    if (rig.motion === "death" && (motion === "death" || record.spent)) return;
    if (!ONE_SHOT_MOTIONS.has(motion)) rig.resting = motion;
    // A swing or a flinch owns the rig until it finishes. `sync` runs while it is playing and would
    // otherwise ask for "idle" a quarter of a second in and cut it off; the `finished` listener is
    // what hands the rig back, to whatever resting motion was recorded in the meantime.
    if (ONE_SHOT_MOTIONS.has(rig.motion) && !ONE_SHOT_MOTIONS.has(motion) && motion !== "death") return;

    const assetId = this.groups.get(record.groupKey)?.assetId ?? "";
    const clip = this.firstFittingClip(
      assetId, this.clipCandidates(assetId, record.entityId, motion), rig.root,
    );
    // Two motions can resolve to the same clip — enemy_bee has neither Idle nor Walk and answers
    // `Flying` to both. Crossfading an action from itself zeroes its weight; record the state change
    // and leave the clip running.
    if (clip && clip.name === rig.clipName) {
      rig.motion = motion;
      return;
    }
    if (!clip) {
      // No death clip on this rig: hold the last live pose rather than idling as a corpse. This is
      // the old `action.paused = spent` behaviour, kept for exactly the case it was written for.
      if (motion === "death") {
        rig.action.paused = true;
        rig.motion = "death";
        this.animated.delete(record);
      }
      return;
    }

    const next = rig.mixer.clipAction(clip);
    const oneShot = ONE_SHOT_MOTIONS.has(motion) || motion === "death";
    next.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    next.clampWhenFinished = oneShot;
    next.timeScale = rig.timeScale;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    // 0.06 s for a one-shot, 0.18 s for locomotion. Hit_Chest is 0.333 s long; an 0.18 s crossfade
    // spends over half the clip getting into it and the flinch never reads.
    next.crossFadeFrom(rig.action, oneShot ? 0.06 : 0.18, false).play();

    rig.action = next;
    rig.clipName = clip.name;
    rig.motion = motion;
    // A dying rig stays in `animated` until the clip actually reaches its end — a corpse dropped
    // from the tick set the instant the crossfade starts freezes halfway into the fall. The
    // `finished` listener in `bindRigEvents` is what takes it out.
    this.animated.add(record);
  }

  /**
   * Wires a rig's `finished` events: one-shots hand back to the resting motion, and a finished
   * death clip drops the record out of the tick set for good.
   *
   * Attached here rather than in `attachRig` because it closes over the record, and the record does
   * not exist until after the rig is built.
   */
  private bindRigEvents(record: ViewRecord): void {
    const rig = record.rig;
    if (!rig) return;
    rig.mixer.addEventListener("finished", (event) => {
      // Fades leave old actions running for a moment; only the CURRENT action's end means anything.
      if (event.action !== rig.action) return;
      if (rig.motion === "death") {
        this.animated.delete(record);
        return;
      }
      this.setMotion(record, rig.resting);
    });
  }

  /**
   * Plays a one-shot on an entity's rig: a swing, or a flinch when it takes one.
   *
   * CORRECTION: this said "OPT-IN and currently uncalled". `app/loop.ts:493` calls it with
   * `("attack")` on the swinger and `:497` with `("hit")` on whatever it landed on, both off the
   * `CombatSystem.consumeHits()` stream that already drives the floating damage numbers. Verified
   * live against rill_skitterlings_1 (runs/corealm/audit/ev2-combat.ts): `getDrawnBounds` reports
   * `animated:Idle` at rest, `animated:HitRecieve` within 700 ms of the first swing and
   * `animated:Death` once it dies.
   *
   * Returns false when the entity has no live mixer. Before the rig pools were allocated by camera
   * distance that was the answer for 46 of the world's 50 enemies whatever you did to them; it is
   * now the answer only for enemies further away than `animationRadius`, which cannot be the one
   * you are fighting. An instanced character cannot play a one-shot at all, and pretending
   * otherwise would make the caller think it worked.
   */
  playAction(entityId: EntityId, motion: "attack" | "hit"): boolean {
    const record = this.records.get(entityId);
    if (!record?.rig || record.rig.motion === "death") return false;
    const before = record.rig.motion;
    this.setMotion(record, motion);
    return record.rig.motion !== before;
  }

  /**
   * Clip names to try for a motion, best first.
   *
   * An asset that ships its own clips uses them and nothing else: the monster packs are not the
   * 65-joint humanoid, so a humanoid clip would bind to bones that do not exist. Everything else
   * draws from the shared library; for `idle` that list is rotated by a seed so a row of NPCs is not
   * doing the same thing.
   *
   * The catch-all "then anything it ships" tail applies to `idle` only. For the other motions a
   * miss returns nothing and `setMotion` leaves the current clip alone, which is right: playing
   * whatever clip happened to be first because a pack has no Walk would make a bee dance across the
   * meadow.
   */
  private clipCandidates(assetId: string, varySeed: string, motion: CharacterMotion): string[] {
    const own = this.assets.entry(assetId)?.animations ?? [];
    if (own.length > 0) {
      const picked: string[] = [];
      for (const pattern of OWN_CLIP_PATTERNS[motion]) {
        for (const name of own) if (pattern.test(name) && !picked.includes(name)) picked.push(name);
      }
      if (motion !== "idle") return picked;
      for (const name of own) if (!picked.includes(name)) picked.push(name);
      return picked;
    }
    if (motion !== "idle") return [...HUMANOID_CLIPS[motion]];
    const start = new Rng(hashString(varySeed) ^ 0x51ed_27b1).int(0, HUMANOID_IDLES.length - 1);
    return [...HUMANOID_IDLES.slice(start), ...HUMANOID_IDLES.slice(0, start)];
  }

  /**
   * The first clip in `names` that this rig can actually play, or null.
   *
   * `assetId` is not decoration. `AssetRegistry` keeps the shared 65-joint library in one
   * name-keyed map and every pack's own clips in a SECOND map keyed `assetId:clipName`, precisely
   * because enemy_crab, enemy_blob and enemy_skull all export clips called `Idle`, `Walk` and
   * `Death` on three different skeletons. `assets.clip("Idle")` therefore returns undefined for a
   * monster pack — asking it alone means no enemy ever resolves a clip at all and every one of them
   * bakes from bind pose. Try the asset's own clip first, fall back to the shared library.
   */
  private firstFittingClip(
    assetId: string,
    names: readonly string[],
    root: THREE.Object3D,
  ): THREE.AnimationClip | null {
    for (const name of names) {
      const clip = this.assets.clipOf(assetId, name) ?? this.assets.clip(name);
      if (clip && clipFits(root, clip)) return clip;
    }
    return null;
  }

  /**
   * Whether this entity may take the non-instanced path, checked BEFORE the skeleton clone.
   *
   * Deciding after cloning would mean paying for ~50 rejected character clones at boot, which is
   * the kind of cost that only shows up as "the loading screen got slower" with nothing to blame.
   *
   * TWO POOLS, not one ceiling. `NAMED_CHARACTER_SHARE` explains why at length; the short version is
   * that a single counter plus a reserve cannot work, because entity order is region order and the
   * named characters are reached first, so they spend past the non-named ceiling and every enemy in
   * the world is refused regardless of what the ceiling is set to. That was the measured state:
   * `uniqueViews: 4`, all four NPCs, `animatedLastFrame: 0` everywhere else.
   */
  private canAffordUnique(
    archetype: Archetype,
    assetId: string,
    source: THREE.Object3D,
    character: CharacterSpec | null,
    position: THREE.Vector3,
  ): boolean {
    const cost = this.uniqueCostOf(assetId, source, character);
    if (cost === 0) return false;

    // A boss is never instanced. There is one of them, the fight is the climax of its region, and
    // the instanced fallback freezes a rig on a single baked idle frame — which is why Ordrun
    // stood through a two-phase fight in a pose that read as a bug. Twenty draw calls against a
    // budget with eighty to spare at the worst dungeon pose is the right trade.
    if (archetype === "boss") return true;
    if (this.countUnique() >= this.maxUniqueViews) return false;
    // Distance before budget. Both pools used to be spent first-come in entity order, which is
    // region order, so the four Coldbrace NPCs took the whole named pool and rill_skitterlings_1..3
    // took the whole other pool — measured, four of the world's fifty enemies, and none of them
    // necessarily anywhere near the player. See `UNIQUE_RELEASE_FACTOR`.
    if (this.viewer && position.distanceToSquared(this.viewer) > this.animationRadiusSq) return false;

    const named = archetype === "npc";
    const namedBudget = Math.round(this.maxUniqueDrawCalls * NAMED_CHARACTER_SHARE);
    return named
      ? this.namedDrawCalls + cost <= namedBudget
      : this.otherDrawCalls + cost <= this.maxUniqueDrawCalls - namedBudget;
  }

  /**
   * What one non-instanced copy of this entity costs in draw calls, shadow pass included.
   *
   * For a dressed character that is the MERGED mesh count, not the sum of the parts: `ensureGroup`
   * has already assembled this exact spec once to bake its instanced pose, and recorded the answer.
   * Measured against the real GLBs, merging matters — an unmerged male ranger is 13 meshes and a
   * merged one is 6.
   */
  private uniqueCostOf(
    assetId: string,
    source: THREE.Object3D,
    character: CharacterSpec | null,
  ): number {
    if (!character) return this.meshesIn(assetId, source) * 2;
    const known = this.characterCosts.get(character.key);
    if (known !== undefined) return known * 2;
    // No assembly has happened yet: charge the unmerged sum, which can only over-estimate.
    let meshes = this.countMeshesOf(character.bodyAssetId);
    for (const partId of character.partAssetIds) meshes += this.countMeshesOf(partId);
    return Math.max(2, meshes * 2);
  }

  private countMeshesOf(assetId: string): number {
    const source = this.sources.get(assetId);
    return source ? this.meshesIn(assetId, source) : 1;
  }

  private meshesIn(assetId: string, source: THREE.Object3D): number {
    const cached = this.meshCounts.get(assetId);
    if (cached !== undefined) return cached;
    let count = 0;
    source.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) count += 1;
    });
    this.meshCounts.set(assetId, count);
    return count;
  }

  private isRigged(assetId: string): boolean {
    const cached = this.riggedAssets.get(assetId);
    if (cached !== undefined) return cached;
    if (!this.assets.isLoaded(assetId)) return false;
    // Prefer the source graph: `AssetRegistry.instance()` deep-clones, and doing that per lookup
    // once cost a full character clone every time a group was resolved.
    const probe = this.sources.get(assetId) ?? this.assets.instance(assetId);
    let rigged = false;
    probe.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) rigged = true;
    });
    this.riggedAssets.set(assetId, rigged);
    return rigged;
  }

  // ------------------------------------------------------------- slots

  private takeSlot(group: InstanceGroup, entityId: EntityId): number {
    const reused = group.free.pop();
    if (reused !== undefined) {
      group.slots[reused] = entityId;
      return reused;
    }
    // No capacity ceiling any more: a `BatchedMesh` instance is allocated per (part, slot) on the
    // first write and the batch grows itself, so there is nothing to pre-size and nothing to
    // rebuild. The old `resize` path — throw away every instance buffer, rebuild, re-write every
    // slot — is gone with it.
    group.slots.push(entityId);
    return group.slots.length - 1;
  }

  // ----------------------------------------------------------- batching

  /**
   * The batch a part draws through, created on first use.
   *
   * Keyed by material identity AND geometry attribute signature. The second half is not optional:
   * `BatchedMesh` throws if an added geometry is missing an attribute the batch already carries,
   * and the kits ship both `COLOR_0,NORMAL,POSITION,TEXCOORD_0` (134 primitives) and
   * `NORMAL,POSITION,TEXCOORD_0` (126) under the same material names. Splitting on the signature
   * turns that from a crash into at most one extra batch per material, and it is also exactly the
   * split `vertexColors` needs — GLTFLoader compiles a separate material for a vertex-coloured
   * primitive, and those two must not share a draw.
   */
  private batchFor(part: SourcePart, cell: string): Batch | null {
    const position = part.geometry.getAttribute("position");
    if (!position) return null;
    const key = `${cell}||${materialBatchKey(part.material)}||${attributeSignature(part.geometry)}`;
    const existing = this.batches.get(key);
    if (existing) return existing;

    const vertices = position.count;
    const indices = part.geometry.getIndex()?.count ?? 0;
    const maxInstances = BATCH_INSTANCE_STEP;
    const maxVertices = Math.max(BATCH_VERTEX_STEP, vertices * 2);
    const maxIndices = Math.max(BATCH_VERTEX_STEP * 3, indices * 2);
    const mesh = new THREE.BatchedMesh(maxInstances, maxVertices, maxIndices, part.material);
    mesh.name = `entity-batch-${this.batches.size}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Per-INSTANCE culling is the whole reason this class is here, and it makes the object-level
    // test both redundant and wrong: a batch's bounding sphere spans every region that uses the
    // material, so it would never cull, while `onBeforeRender` (and `onBeforeShadow`) already drops
    // the instances outside the frustum and submits nothing at all when none survive.
    // Object-level culling is back on and it is the cheap half: one sphere test drops a whole
    // off-screen cell before the renderer touches its material or its instances. Per-instance
    // culling then trims what is left, which is what keeps the triangle count honest inside the
    // cell the camera is standing in.
    mesh.frustumCulled = true;
    mesh.perObjectFrustumCulled = true;
    // The per-frame instance sort only earns its cost when draw order changes the picture.
    mesh.sortObjects = part.material.transparent === true;
    const batch: Batch = {
      key,
      mesh,
      maxInstances,
      maxVertices,
      maxIndices,
      usedInstances: 0,
      usedVertices: 0,
      usedIndices: 0,
      geometryIds: new Map(),
      owners: [],
    };
    this.batches.set(key, batch);
    this.batchOwners.set(mesh, batch);
    this.group.add(mesh);
    return batch;
  }

  /** Uploads one geometry into a batch, growing its buffers first if it will not fit. */
  private addBatchGeometry(batch: Batch, geometry: THREE.BufferGeometry): number {
    const existing = batch.geometryIds.get(geometry);
    if (existing !== undefined) return existing;

    const vertices = geometry.getAttribute("position")?.count ?? 0;
    const indices = geometry.getIndex()?.count ?? 0;
    if (batch.usedVertices + vertices > batch.maxVertices
      || batch.usedIndices + indices > batch.maxIndices) {
      batch.maxVertices = Math.max(batch.maxVertices * 2, batch.usedVertices + vertices);
      batch.maxIndices = Math.max(batch.maxIndices * 2, batch.usedIndices + indices);
      batch.mesh.setGeometrySize(batch.maxVertices, batch.maxIndices);
    }
    const id = batch.mesh.addGeometry(geometry);
    batch.usedVertices += vertices;
    batch.usedIndices += indices;
    batch.geometryIds.set(geometry, id);
    return id;
  }

  /** The instance one slot draws this part through, allocated on first use. */
  private instanceFor(draw: PartDraw, group: InstanceGroup, slot: number): number {
    const existing = draw.instances[slot];
    if (existing !== undefined && existing >= 0) return existing;
    const batch = draw.batch;
    if (batch.usedInstances >= batch.maxInstances) {
      batch.maxInstances = Math.max(batch.maxInstances * 2, batch.usedInstances + 1);
      batch.mesh.setInstanceCount(batch.maxInstances);
    }
    const id = batch.mesh.addInstance(draw.geometryId);
    // `BatchedMesh` never invalidates its own bounds, and the object-level frustum test reads them.
    // A batch that keeps a sphere from when it held three instances culls away the other nine
    // hundred, which is the whole cell going missing from one camera angle and not another.
    batch.mesh.boundingSphere = null;
    batch.usedInstances += 1;
    batch.owners[id] = { group, slot };
    draw.instances[slot] = id;
    return id;
  }

  private buildDraws(parts: readonly SourcePart[], cell: string): PartDraw[] {
    const draws: PartDraw[] = [];
    for (const part of parts) {
      const batch = this.batchFor(part, cell);
      if (!batch) continue;
      draws.push({ batch, geometryId: this.addBatchGeometry(batch, part.geometry), part, instances: [] });
    }
    return draws;
  }

  /** Hands every instance a set of draws holds back to its batch. */
  private releaseDraws(draws: readonly PartDraw[]): void {
    for (const draw of draws) {
      for (const id of draw.instances) {
        if (id === undefined || id < 0) continue;
        draw.batch.mesh.deleteInstance(id);
        draw.batch.mesh.boundingSphere = null;
        draw.batch.owners[id] = null;
        draw.batch.usedInstances = Math.max(0, draw.batch.usedInstances - 1);
      }
      draw.instances.length = 0;
    }
  }

  /**
   * Writes one entity's instance matrix into whichever pose variant it is currently in.
   *
   * The orientation is where the terrain normal lands. Round 3 composed it from `rotationY` alone,
   * so nothing in the world bedded into a slope: 34 of 159 surface entities stand on ground steeper
   * than 10 degrees and the worst — a 5.3 m ore rock on a 48.9-degree face — had 3.02 m of daylight
   * under one edge. `view.groundNormal` is slerped in from vertical by `tilt`, applied OUTSIDE the
   * yaw so a rock still faces the bearing the world layer gave it.
   */
  private writeSlot(group: InstanceGroup, record: ViewRecord): void {
    const slot = record.slot;
    if (slot < 0) return;
    const moving = record.movingTicks > 0 && !record.spent;
    if (record.spent) this.ensureSpent(group);
    else if (moving) this.ensureMoving(group);

    // Module scratch, for the reason the quaternions above are: `syncMotion` calls this once per
    // moving entity per RENDER frame. Two fresh Matrix4s per call is garbage allocated in exactly
    // the frames that are already the tightest.
    const placement = SCRATCH_PLACEMENT.compose(
      record.position,
      orientation(record.rotationY, record.normal, record.tilt, SCRATCH_QUATERNION),
      SCRATCH_SCALE.setScalar(record.scale),
    );
    const transform = SCRATCH_TRANSFORM;

    // A spent group with no geometry of its own keeps drawing its LIVE parts rather than nothing.
    // Hiding the live instance without drawing a replacement is how a worked-out node used to
    // disappear from the world entirely. The walk variant works the same way.
    const spentReady = record.spent && group.spent.length > 0;
    const movingReady = !record.spent && moving && group.moving.length > 0;
    const active = spentReady ? group.spent : movingReady ? group.moving : group.live;

    for (const draw of active) {
      transform.multiplyMatrices(placement, draw.part.matrix);
      const instance = this.instanceFor(draw, group, slot);
      draw.batch.mesh.setMatrixAt(instance, transform);
      draw.batch.mesh.setVisibleAt(instance, true);
      draw.batch.mesh.boundingSphere = null;
    }
    // An instance that is not part of the current pose is switched off, not parked at a zero-scale
    // matrix. `BatchedMesh` leaves an invisible instance out of the multi-draw entirely, so the
    // pose the entity is NOT in costs nothing — where the old `InstancedMesh` pair still submitted
    // both draws and still counted every hidden instance's triangles.
    for (const variant of [group.live, group.spent, group.moving]) {
      if (variant === active) continue;
      for (const draw of variant) hideInstance(draw, slot);
    }
  }

  /** Applies a record's drawn transform to its non-instanced object. */
  private placeUnique(record: ViewRecord): void {
    if (!record.unique) return;
    record.unique.position.copy(record.position);
    record.unique.quaternion.copy(
      orientation(record.rotationY, record.normal, record.tilt, SCRATCH_QUATERNION),
    );
    record.unique.scale.setScalar(record.scale);
  }

  /**
   * Paints a non-instanced entity for its current state, always from the authored material.
   *
   * A dead character keeps its rig but stops being ticked, so it holds whatever pose it stopped in
   * rather than popping back to bind — which is the one thing that would put the arms-out silhouette
   * back on screen after all this. `setMotion` is what stops the ticking now: it switches the rig to
   * the pack's own `Death` clip, clamps on the last frame and drops the record out of `animated`.
   */
  private applyUniqueState(record: ViewRecord, tier: number): void {
    if (!record.unique) return;

    restoreBaseMaterials(record.unique);
    const look = APPEARANCE[record.archetype] ?? NEUTRAL;
    if (!record.spent) {
      this.materials.retint(record.unique, tier, look.strength, look.swatch, (material) =>
        !PROTECTED_MATERIAL.test(material.name));
      return;
    }
    record.unique.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // Death ignores the protected-material rule on purpose: a corpse with bright living eyes is
      // the wrong read, and this is the state the player most needs to see from across a clearing.
      const mapped = materials.map((material) =>
        this.materials.variant(material, { tier, state: "dead", strength: look.strength, swatch: look.swatch }));
      mesh.material = mapped.length === 1 ? mapped[0]! : mapped;
    });
  }

  // --------------------------------------------------- hover / selection

  /**
   * Ring plus an overhead pip. The ring says "this is the thing on the ground", the pip is what
   * you can still see when the thing is a 7 m tree. Colour is `#rrggbb`, matching `OverlaySpec`.
   */
  setHighlight(entityId: EntityId, colour: string | number = "#ffd98a"): boolean {
    const record = this.records.get(entityId);
    if (!record) return false;

    this.clearHighlight(entityId);
    const material = this.materials.highlight(colour);
    const marker = new THREE.Group();
    marker.name = `highlight-${entityId}`;

    const ring = new THREE.Mesh(this.ring(), material);
    ring.rotation.x = -Math.PI / 2;
    marker.add(ring);

    const pip = new THREE.Mesh(this.pip(), material);
    pip.name = "pip";
    marker.add(pip);

    this.highlightGroup.add(marker);
    this.highlights.set(entityId, marker);
    this.placeHighlight(marker, record);
    return true;
  }

  clearHighlight(entityId: EntityId): void {
    const existing = this.highlights.get(entityId);
    if (!existing) return;
    existing.removeFromParent();
    this.highlights.delete(entityId);
  }

  clearAllHighlights(): void {
    for (const entityId of [...this.highlights.keys()]) this.clearHighlight(entityId);
  }

  private placeHighlight(marker: THREE.Object3D, record: ViewRecord): void {
    marker.position.copy(record.position);
    marker.position.y += 0.06;
    marker.scale.setScalar(record.radius);
    const pip = marker.getObjectByName("pip");
    if (pip) pip.position.y = record.labelHeight / Math.max(0.001, record.radius);
  }

  private ring(): THREE.BufferGeometry {
    if (!this.ringGeometry) this.ringGeometry = new THREE.RingGeometry(0.86, 1.06, 28);
    return this.ringGeometry;
  }

  private pip(): THREE.BufferGeometry {
    if (!this.pipGeometry) this.pipGeometry = new THREE.OctahedronGeometry(0.16, 0);
    return this.pipGeometry;
  }

  // ------------------------------------------------------------ picking

  /**
   * Which entity a ray hits, or null. Handles both instanced entities (via `instanceId`) and the
   * rigged fallback objects (via `userData.entityId`). The input layer sets the ray; this file
   * does not know about the mouse.
   */
  pick(raycaster: THREE.Raycaster): EntityId | null {
    const hits = raycaster.intersectObject(this.group, true);
    for (const hit of hits) {
      const owned = this.ownerOf(hit);
      if (owned) return owned;
      if ((hit.object as THREE.BatchedMesh).isBatchedMesh) continue;
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const owner = node.userData.entityId;
        if (typeof owner === "string") return owner;
        node = node.parent;
      }
    }
    return null;
  }

  /** Distance-sorted pick, returning every entity under the ray. Right-click menus want this. */
  pickAll(raycaster: THREE.Raycaster): EntityId[] {
    const found: EntityId[] = [];
    for (const hit of raycaster.intersectObject(this.group, true)) {
      const entityId = this.ownerOf(hit);
      if (entityId && !found.includes(entityId)) found.push(entityId);
    }
    return found;
  }

  /**
   * The entity a raycast hit belongs to, or null when the hit is not one of this layer's instances.
   *
   * `BatchedMesh.raycast` reports which instance was hit as `intersection.batchId`, and the batch
   * remembers which (group, slot) it lent that instance to — which is the only mapping there is,
   * because one batch is shared by every group that paints with its material.
   */
  private ownerOf(hit: THREE.Intersection): EntityId | null {
    const mesh = hit.object as THREE.BatchedMesh;
    if (!mesh.isBatchedMesh) return null;
    const batchId = (hit as THREE.Intersection & { batchId?: number }).batchId;
    if (batchId === undefined) return null;
    const owner = this.batchOwners.get(mesh)?.owners[batchId];
    return owner ? owner.group.slots[owner.slot] ?? null : null;
  }

  /** World position an entity is drawn at. Used for overlays and camera framing. */
  positionOf(entityId: EntityId): THREE.Vector3 | null {
    const record = this.records.get(entityId);
    return record ? record.position.clone() : null;
  }

  has(entityId: EntityId): boolean {
    return this.records.has(entityId);
  }

  // -------------------------------------------------------------- stats

  private assetRadius(assetId: string): number {
    const entry = this.assets.entry(assetId);
    if (!entry) return this.minHighlightRadius;
    return Math.max(entry.size.x, entry.size.z) * 0.55;
  }

  /**
   * Kept as a counter rather than a walk of `this.records`.
   *
   * `canAffordUnique` asks for it, and `rebalanceUniques` asks `canAffordUnique` once per character
   * record per frame. Walking 1,203 records inside a loop over 62 candidates is 75,000 property
   * reads a frame to answer a question the layer already knows the answer to.
   */
  private countUnique(): number {
    return this.uniqueViewCount;
  }

  /**
   * The world-space box this layer actually draws for one entity, or null when it draws nothing.
   *
   * Written for the depleted-node bug: a screenshot showing an empty patch of grass cannot
   * distinguish "the spent mesh was never built" from "the spent mesh is a pebble" from "the live
   * mesh is hidden and nothing replaced it". Mesh counts cannot either — an `InstancedMesh` exists
   * whether or not any of its slots hold a visible matrix. This reads the matrix in the entity's
   * own slot, which is the only thing that answers the question.
   */
  drawnBounds(entityId: EntityId): { min: Vec3; max: Vec3; meshes: number; path: string } | null {
    const record = this.records.get(entityId);
    if (!record) return null;

    const box = new THREE.Box3();
    let meshes = 0;

    if (record.unique) {
      record.unique.updateMatrixWorld(true);
      box.setFromObject(record.unique);
      record.unique.traverse((child) => { if ((child as THREE.Mesh).isMesh) meshes += 1; });
      const path = record.rig ? `animated:${record.rig.clipName}` : "unique";
      return box.isEmpty() ? null : boxToBounds(box, meshes, path);
    }

    const group = this.groups.get(record.groupKey);
    if (!group || record.slot < 0) return null;
    const moving = record.movingTicks > 0 && !record.spent;
    const active = record.spent && group.spent.length > 0
      ? group.spent
      : moving && group.moving.length > 0 ? group.moving : group.live;
    const matrix = new THREE.Matrix4();
    for (const draw of active) {
      const instance = draw.instances[record.slot];
      // Absent and switched-off are both "this pose does not draw here", and both must not widen
      // the box. This is what makes a depleted node's bounds the STUMP rather than the tree.
      if (instance === undefined || instance < 0) continue;
      if (!draw.batch.mesh.getVisibleAt(instance)) continue;
      draw.batch.mesh.getMatrixAt(instance, matrix);
      draw.part.geometry.computeBoundingBox();
      const bounds = draw.part.geometry.boundingBox;
      if (!bounds) continue;
      box.union(bounds.clone().applyMatrix4(matrix));
      meshes += 1;
    }
    return box.isEmpty() ? null : boxToBounds(box, meshes, record.spent ? "instanced-spent" : "instanced");
  }

  stats(): EntityViewStats {
    // Which pose variant each group actually has something in. A group whose entities all took a
    // non-instanced rig has parts registered in a batch and no visible instance in any of them, and
    // an unused spent or walk variant is the same. Charging for those is what put 636 on a report
    // next to a renderer reading 321.
    const occupied = new Map<string, { live: boolean; spent: boolean; moving: boolean }>();
    for (const record of this.records.values()) {
      if (record.slot < 0) continue;
      const group = this.groups.get(record.groupKey);
      if (!group) continue;
      const flags = occupied.get(group.key) ?? { live: false, spent: false, moving: false };
      const moving = record.movingTicks > 0 && !record.spent;
      if (record.spent && group.spent.length > 0) flags.spent = true;
      else if (moving && group.moving.length > 0) flags.moving = true;
      else flags.live = true;
      occupied.set(group.key, flags);
    }

    let instancedMeshes = 0;
    let drawnInstancedMeshes = 0;
    let triangles = 0;
    let bakedPoses = 0;
    let dressedGroups = 0;
    const drawnBatches = new Set<Batch>();
    const charge = (draws: readonly PartDraw[]): void => {
      drawnInstancedMeshes += draws.length;
      for (const draw of draws) drawnBatches.add(draw.batch);
    };
    for (const group of this.groups.values()) {
      instancedMeshes += group.live.length + group.spent.length + group.moving.length;
      const flags = occupied.get(group.key);
      if (flags) {
        if (flags.live) charge(group.live);
        if (flags.spent) charge(group.spent);
        if (flags.moving) charge(group.moving);
      }
      if (group.posed) bakedPoses += 1;
      if (group.character) dressedGroups += 1;
      const active = group.slots.filter((slot) => slot !== null).length;
      for (const part of group.liveParts) triangles += part.triangles * active;
    }

    let unique = 0;
    let uniqueMeshes = 0;
    let uniqueTriangles = 0;
    let dressedCharacters = 0;
    let movingViews = 0;
    for (const record of this.records.values()) {
      if (record.movingTicks > 0) movingViews += 1;
      if (!record.unique) continue;
      unique += 1;
      if (record.dressed) dressedCharacters += 1;
      uniqueMeshes += record.uniqueMeshes;
      record.unique.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) uniqueTriangles += triangleCount(mesh.geometry);
      });
    }

    return {
      entities: this.records.size,
      groups: this.groups.size,
      instancedMeshes,
      drawnInstancedMeshes,
      uniqueViews: unique,
      riggedViews: this.animated.size,
      animatedLastFrame: this.animatedLastFrame,
      bakedPoses,
      highlights: this.highlights.size,
      batches: this.batches.size,
      drawnBatches: drawnBatches.size,
      // Counted, not guessed, and with the shadow pass in it. The unit is the BATCH now, not the
      // part: every part that shares a material shares one `multiDrawElements`. Unique character
      // meshes are still one draw each and cast, so two; highlights are unlit overlays that do not
      // cast, so a ring plus a pip is two. World-wide and unculled — see the field doc.
      estimatedDrawCalls: drawnBatches.size * 2 + uniqueMeshes * 2 + this.highlights.size * 2,
      uniqueDrawCalls: this.uniqueDrawCalls,
      namedDrawCalls: this.namedDrawCalls,
      otherDrawCalls: this.otherDrawCalls,
      dressedCharacters,
      dressedGroups,
      movingViews,
      triangles: Math.round(triangles + uniqueTriangles),
      missingAssets: [...this.missing],
    };
  }

  dispose(): void {
    this.clearAllHighlights();
    for (const record of this.records.values()) this.release(record);
    for (const batch of this.batches.values()) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
    }
    this.batches.clear();
    this.group.clear();
    this.groups.clear();
    this.records.clear();
    this.animated.clear();
    this.rigCandidates.clear();
    this.viewer = null;
    this.meshCounts.clear();
    this.characterCosts.clear();
    this.characterSpecs.clear();
    this.uniqueDrawCalls = 0;
    this.namedDrawCalls = 0;
    this.otherDrawCalls = 0;
    this.uniqueViewCount = 0;
    for (const geometry of this.seamGeometries.values()) geometry.dispose();
    for (const geometry of this.bakedGeometries) geometry.dispose();
    this.seamGeometries.clear();
    this.bakedGeometries.length = 0;
    this.sources.clear();
    this.sourceRequests.clear();
    this.riggedAssets.clear();
    this.tierKeyed.clear();
    this.ringGeometry?.dispose();
    this.pipGeometry?.dispose();
    this.ringGeometry = null;
    this.pipGeometry = null;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Resolves what a dressed humanoid is made of, or null when the entity is not one.
 *
 * Two inputs, in priority order. `view.partAssetIds` is the authored answer and the one the world
 * layer is moving to. Failing that, `OUTFIT_BODIES` recognises the four clothes-only outfit GLBs
 * that `view.assetId` still carries today and puts the right base body under them — without which
 * every NPC in the game renders with no head, no eyes and no eyebrows.
 *
 * Hair is appended here rather than authored upstream because it is a look decision and it must be
 * a pure function of the entity id: the harness calls `__gameDebug.reset({seed})` and diffs, so an
 * unseeded pick would make every screenshot flap. `hairAssetFor` is a fresh `Rng` per call and
 * consumes no shared stream, so adding this shifts nothing else.
 */
function characterSpecFor(
  entityId: EntityId,
  assetId: string,
  partAssetIds: readonly string[] | undefined,
): CharacterSpec | null {
  let bodyAssetId = assetId;
  let parts: string[] = partAssetIds ? [...partAssetIds] : [];

  if (parts.length === 0) {
    const implied = OUTFIT_BODIES[assetId];
    if (!implied) return null;
    bodyAssetId = implied;
    parts = [assetId];
  }

  // Only the two base bodies have a measured head-cap plane, and without one this assembly would
  // layer clothes over an intact body — the case that leaks bare skin through the trousers.
  if (headCapHeightFor(bodyAssetId) === null) return null;

  const hooded = parts.some((id) => HOODED_PARTS.has(id));
  const haired = parts.some((id) => HAIR_PART.test(id));
  if (!hooded && !haired) {
    parts.push(hairAssetFor(entityId, bodyAssetId === "base_female" ? "female" : "male"));
  }

  return { bodyAssetId, partAssetIds: parts, key: `${bodyAssetId}>${parts.join("+")}` };
}

/**
 * Material identity for a character part, ACROSS separately loaded GLBs.
 *
 * `mergeSkinnedMeshes` defaults to material UUID, which never merges two files: `world/regionBuilder`
 * dresses an NPC from four to six separate part GLBs, and two loads of MI_Peasant are two Material
 * instances holding two Texture instances. Measured effect of leaving it at the default: a dressed
 * male ranger is 11 meshes and a female ranger 11, against 6 for the same outfit shipped as one GLB.
 * With this key all four outfits land at 6 meshes — merges of 9->6, 12->6, 8->6 and 13->6.
 *
 * It is safe because the images really are the same image. sha1 over each GLB's embedded texture
 * bytes: T_Peasant_BaseColor is cbc36fd517 in _chest, _legs, _boots and _gloves alike, and
 * T_Ranger_BaseColor is add5a3c8ba across the ranger set; base_male's eyebrow material MI_Hair_1
 * carries T_Hair_1_BaseColor ffe6590578, byte-identical to hair_short's and hair_buzzed's. So the
 * merged mesh drawing under the FIRST material draws exactly the pixels the others would have.
 *
 * Name plus texture name plus colour, not name alone: a name collision between two unrelated packs
 * would otherwise silently paint one with the other's texture.
 */
function characterMaterialKey(material: THREE.Material): string {
  const standard = material as THREE.MeshStandardMaterial;
  const map = standard.map;
  return [
    material.name,
    material.type,
    map ? map.name : "-",
    standard.color ? standard.color.getHexString() : "-",
    standard.transparent ? "t" : "o",
    material.side,
  ].join("|");
}

/**
 * The orientation an entity is drawn at: its authored yaw, then tilted toward the ground normal.
 *
 * `setFromUnitVectors(UP, normal)` is the full lie-flat-on-the-hill rotation; slerping vertical
 * toward it by `strength` is what lets a tree take 10% of a slope and a lily pad take all of it.
 * Applied by premultiply, i.e. AFTER the yaw in local terms, so tilting never spins the model.
 */
function orientation(
  rotationY: number,
  normal: readonly [number, number, number] | null,
  strength: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  out.setFromAxisAngle(Y_AXIS, rotationY);
  if (!normal || strength <= 0) return out;
  SCRATCH_NORMAL.set(normal[0], normal[1], normal[2]);
  if (SCRATCH_NORMAL.lengthSq() < 1e-6) return out;
  SCRATCH_NORMAL.normalize();
  SCRATCH_TILT.setFromUnitVectors(Y_AXIS, SCRATCH_NORMAL);
  SCRATCH_BLEND.identity().slerp(SCRATCH_TILT, Math.min(1, strength));
  return out.premultiply(SCRATCH_BLEND);
}

/** Normal and tilt folded into the change-detection signature at 0.01 resolution. */
function tiltKey(normal: readonly [number, number, number] | null, strength: number): string {
  if (!normal || strength <= 0) return "-";
  return `${round(normal[0])},${round(normal[1])},${round(normal[2])}:${round(strength)}`;
}

/** Interpolates an angle the short way round, so a turn through north does not spin 350 degrees. */
function shortestArc(from: number, to: number, alpha: number): number {
  const delta = ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return from + delta * alpha;
}

/**
 * Cuts a set of parts off at a fraction of their COMBINED height.
 *
 * The fraction has to be measured across the whole asset, not per mesh. A tree ships as a trunk
 * mesh and a canopy mesh; cutting each at its own lowest quarter leaves a stub of trunk AND a ring
 * of leaves hanging in the air where the bottom of the canopy used to be. Measuring once across
 * both and cutting every part at that one world height is what actually produces a stump: the
 * trunk keeps its lower quarter and the canopy, which lives entirely above the cut, keeps nothing.
 *
 * Parts are returned identity-placed with their source transform baked in, so a rotated or offset
 * part still cuts along world Y. Runs once per group.
 */
function clipPartsBelow(parts: readonly SourcePart[], fraction: number): SourcePart[] {
  const boxes = parts.map((part) => {
    part.geometry.computeBoundingBox();
    const bounds = part.geometry.boundingBox;
    return bounds ? bounds.clone().applyMatrix4(part.matrix) : null;
  });

  const box = new THREE.Box3();
  for (const bounds of boxes) if (bounds) box.union(bounds);
  if (box.isEmpty()) return [];

  const height = box.max.y - box.min.y;
  const cut = box.min.y + height * fraction;
  // A part that does not reach the ground is foliage, not structure. Cutting it at the same height
  // leaves the underside of the canopy floating where the tree was — which is what the first
  // version of this did, and it read as a bush rather than a stump. Only parts that start at the
  // base survive the cut at all.
  const groundReach = box.min.y + height * 0.1;

  const out: SourcePart[] = [];
  for (const [index, part] of parts.entries()) {
    const bounds = boxes[index];
    if (bounds && bounds.min.y > groundReach) continue;
    const geometry = clipGeometryBelow(part.geometry, part.matrix, cut);
    if (!geometry) continue;
    out.push({
      geometry,
      material: part.material,
      matrix: new THREE.Matrix4(),
      triangles: triangleCount(geometry),
    });
  }
  return out;
}

/**
 * Keeps only the triangles below world height `cut`, with `matrix` baked in.
 *
 * A triangle is kept when its CENTROID is below the cut, which leaves a flat-ish top rather than
 * the ragged fringe an all-vertices test produces on low-poly geometry.
 *
 * Returns null when the cut keeps nothing — for a tree canopy that is the correct answer, and the
 * caller drops the part entirely.
 */
function clipGeometryBelow(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  cut: number,
): THREE.BufferGeometry | null {
  const baked = geometry.clone().applyMatrix4(matrix);
  const source = baked.getIndex() ? baked.toNonIndexed() : baked;
  const position = source.getAttribute("position");
  if (!position || position.count < 3) return null;

  const keep: number[] = [];
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    const centroid = (position.getY(triangle) + position.getY(triangle + 1) + position.getY(triangle + 2)) / 3;
    if (centroid <= cut) keep.push(triangle);
  }
  if (keep.length === 0) return null;

  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv", "color"] as const) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    const size = attribute.itemSize;
    const values = new Float32Array(keep.length * 3 * size);
    let write = 0;
    for (const triangle of keep) {
      for (let vertex = 0; vertex < 3; vertex += 1) {
        for (let component = 0; component < size; component += 1) {
          values[write] = attribute.getComponent(triangle + vertex, component);
          write += 1;
        }
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  out.computeBoundingSphere();
  return out;
}

function boxToBounds(
  box: THREE.Box3,
  meshes: number,
  path: string,
): { min: Vec3; max: Vec3; meshes: number; path: string } {
  return {
    min: [box.min.x, box.min.y, box.min.z] as unknown as Vec3,
    max: [box.max.x, box.max.y, box.max.z] as unknown as Vec3,
    meshes,
    path,
  };
}

/**
 * Which batch cell an entity belongs to.
 *
 * Part of the GROUP key as well as the batch key, because a group's parts are uploaded into one
 * cell's batches and every slot in it has to be inside that cell for the bounding sphere to mean
 * anything. `Math.floor` on a negative coordinate still lands in a consistent cell.
 */
function batchCell(archetype: Archetype, position: Vec3): string {
  if (CELL_FREE_ARCHETYPES.has(archetype)) return "*";
  const x = Math.floor(position[0] / BATCH_CELL_SIZE);
  const z = Math.floor(position[2] / BATCH_CELL_SIZE);
  return `${x}_${z}`;
}

/** Switches one slot's instance of a part off, if it ever had one. */
function hideInstance(draw: PartDraw, slot: number): void {
  const instance = draw.instances[slot];
  if (instance === undefined || instance < 0) return;
  draw.batch.mesh.setVisibleAt(instance, false);
}

/**
 * The geometry attributes a batch must agree on, as a comparable string.
 *
 * `BatchedMesh._validateGeometry` throws if an added geometry is missing an attribute the batch
 * already has, or disagrees on `itemSize`/`normalized`, or on whether there is an index at all.
 * This is that contract written down, so the key sorts geometries into compatible batches instead
 * of finding out at `addGeometry`.
 */
function attributeSignature(geometry: THREE.BufferGeometry): string {
  const names = Object.keys(geometry.attributes).sort();
  const parts = names.map((name) => {
    const attribute = geometry.getAttribute(name);
    return `${name}:${attribute.itemSize}${attribute.normalized ? "n" : ""}`;
  });
  parts.push(geometry.getIndex() ? "idx" : "noidx");
  return parts.join(",");
}

/**
 * Material identity ACROSS separately loaded GLBs, so one batch can serve every asset that paints
 * with the same material.
 *
 * The same problem `characterMaterialKey` solves for outfit parts, at world scale: two loads of the
 * medieval-village kit are two `Material` instances holding two `Texture` instances, and comparing
 * by UUID would mean 356 batches instead of 43. Everything the renderer can distinguish is in the
 * key — name, every map's name, colour, the PBR scalars, side, blending and alpha.
 *
 * It is safe because the textures really are the same texture. runs/corealm/dc/matkey.mjs hashes
 * the embedded image bytes of every material in all 213 manifest GLBs and groups them by this key:
 * 63 distinct keys, and ZERO keys carrying more than one image hash. `MI_WoodTrim` is one key
 * across 29 GLBs and one sha1 (f02e4f9db3) across all of them. If that ever stops being true the
 * scan says so, and the failure mode is one wrong texture rather than a crash.
 */
function materialBatchKey(material: THREE.Material): string {
  const standard = material as THREE.MeshStandardMaterial;
  const mapName = (map: THREE.Texture | null | undefined): string => (map ? map.name || map.uuid : "-");
  return [
    material.name || material.type,
    material.type,
    mapName(standard.map),
    mapName(standard.normalMap),
    mapName(standard.roughnessMap),
    mapName(standard.metalnessMap),
    mapName(standard.emissiveMap),
    mapName(standard.aoMap),
    mapName(standard.alphaMap),
    standard.color ? standard.color.getHexString() : "-",
    standard.emissive ? standard.emissive.getHexString() : "-",
    standard.emissiveIntensity ?? 1,
    standard.roughness ?? 1,
    standard.metalness ?? 0,
    standard.envMapIntensity ?? 1,
    material.side,
    material.transparent ? "t" : "o",
    material.opacity,
    material.alphaTest,
    material.depthWrite ? "dw" : "-",
    material.blending,
    standard.vertexColors ? "vc" : "-",
    standard.flatShading ? "flat" : "-",
    standard.wireframe ? "wire" : "-",
  ].join("|");
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.round(index.count / 3);
  const position = geometry.getAttribute("position");
  return position ? Math.round(position.count / 3) : 0;
}

/** Puts a unique object back on the materials its GLB shipped with, before a state is re-applied. */
function restoreBaseMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const base = mesh.userData.baseMaterial as THREE.Material | THREE.Material[] | undefined;
    if (base) mesh.material = base;
  });
}

/** FNV-1a. Deterministic per-entity seeds, so animation phase survives a reload unchanged. */
function hashString(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/**
 * Whether a clip's tracks address bones this object actually has.
 *
 * `AssetRegistry` keys its clip library by NAME across every pack, and the three monster packs all
 * export a clip called `Idle` on three different skeletons — so "the clip named Idle" is whichever
 * GLB loaded first, and playing it on the wrong rig silently animates nothing. Sampling the first
 * dozen tracks (which are the root and spine bones, i.e. the discriminating ones) is enough to
 * reject a mismatch before it becomes a character frozen in bind pose with no error anywhere.
 */
function clipFits(root: THREE.Object3D, clip: THREE.AnimationClip): boolean {
  let checked = 0;
  let matched = 0;
  for (const track of clip.tracks) {
    if (checked >= 12) break;
    try {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      if (!parsed.nodeName) continue;
      checked += 1;
      if (THREE.PropertyBinding.findNode(root, parsed.nodeName)) matched += 1;
    } catch {
      return false;
    }
  }
  return checked > 0 && matched / checked >= 0.75;
}

/**
 * CPU-skins one posed frame of a `SkinnedMesh` into a static geometry.
 *
 * The bone matrices come from the object's world matrices, so the caller must have posed the
 * skeleton and called `updateMatrixWorld` first. Skin attributes are dropped from the result: they
 * are dead weight on an instanced draw, and leaving them means Three.js still reports the geometry
 * as skinnable.
 *
 * Returns null rather than the source geometry when the mesh cannot be baked. The caller registers
 * whatever it gets back for disposal, and handing it the shared source geometry would mean
 * disposing the asset itself out from under every other user of it.
 */
function freezeSkin(mesh: THREE.SkinnedMesh): THREE.BufferGeometry | null {
  const source = mesh.geometry;
  const position = source.getAttribute("position");
  if (!position || !source.getAttribute("skinIndex") || !source.getAttribute("skinWeight")) {
    return null;
  }

  const baked = source.clone();
  const output = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    mesh.applyBoneTransform(index, vertex);
    output.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }

  baked.setAttribute("position", output);
  baked.deleteAttribute("skinIndex");
  baked.deleteAttribute("skinWeight");
  // Normals were authored for the bind pose; a bent elbow needs them recomputed or it lights flat.
  baked.computeVertexNormals();
  baked.computeBoundingSphere();
  return baked;
}
