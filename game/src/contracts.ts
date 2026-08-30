/**
 * Corealm frozen contracts.
 *
 * FROZEN. Only the root agent edits this file. A worker who needs a change here stops and reports
 * the exact mismatch (AGENTS.md rule 5); the root changes the contract and its callers together.
 *
 * Source of truth: runs/corealm/PRD.md section 7.2, with the corrections in
 * runs/corealm/architecture.md section 1.
 */

// ---------------------------------------------------------------- primitives

/** World-space point in metres, Y-up. Tuple form, per the brief's semantic-entity example. */
export type Vec3 = readonly [number, number, number];

export type SkillId =
  | "melee" | "magic"
  | "mining" | "woodcutting" | "fishing" | "farming"
  | "smithing" | "crafting" | "cooking" | "fletching"
  | "agility";

export const SKILL_IDS: readonly SkillId[] = [
  "melee", "magic",
  "mining", "woodcutting", "fishing", "farming",
  "smithing", "crafting", "cooking", "fletching",
  "agility",
] as const;

export type RegionId = "fallowmarch" | "vellenwood" | "karrowmoor" | "gravelmaw";

// ------------------------------------------------------------------- audio

/** Independent client-side mix buses. These are preferences, never simulation state. */
export type AudioBus = "music" | "ambient" | "sfx";

/** Linear gain values in the inclusive 0..1 range. */
export interface AudioVolumes {
  music: number;
  ambient: number;
  sfx: number;
}

/** Material weights shared by the terrain renderer and terrain-aware presentation systems. */
export interface GroundSurfaceSample {
  grass: number;
  dry: number;
  rock: number;
  gravel: number;
  dirt: number;
  mud: number;
  cobble: number;
  wet: number;
}

/**
 * Semantic cue vocabulary and its runtime list, so catalog coverage is testable. Gameplay
 * publishes meaning; the audio layer chooses one of the cue's curated file variants.
 */
export const AUDIO_CUE_IDS = [
  "ui.click", "ui.confirm", "ui.cancel", "ui.error", "ui.level_up",
  "movement.footstep_grass", "movement.footstep_dirt", "movement.footstep_forest",
  "movement.footstep_stone", "movement.footstep_wood", "movement.footstep_cave",
  "gather.mining_swing", "gather.mining_impact", "gather.rock_break",
  "gather.wood_swing", "gather.wood_impact", "gather.tree_fall",
  "gather.fishing_cast", "gather.fishing_reel", "gather.fishing_catch",
  "farm.rake", "farm.plant", "farm.harvest",
  "production.smith", "production.smelt", "production.craft",
  "production.cook", "production.fletch",
  "combat.melee_swing", "combat.melee_hit", "combat.melee_miss",
  "combat.magic_cast", "combat.magic_hit", "combat.special",
  "combat.player_hit", "combat.enemy_death", "combat.player_death",
  "interaction.door_open", "interaction.portal", "interaction.climb",
  "interaction.vault", "interaction.loot", "interaction.equip", "interaction.consume",
  "interaction.bank", "interaction.trade", "interaction.dialogue_open",
  "interaction.dialogue_close", "interaction.activity_stop",
] as const;

export type AudioCueId = (typeof AUDIO_CUE_IDS)[number];

export type EquipSlot =
  | "head" | "body" | "legs" | "feet" | "hands"
  | "mainHand" | "offHand" | "accessory1" | "accessory2";

export const EQUIP_SLOTS: readonly EquipSlot[] = [
  "head", "body", "legs", "feet", "hands",
  "mainHand", "offHand", "accessory1", "accessory2",
] as const;

export type EntityId = string;
export type ItemId = string;
export type RecipeId = string;
export type SpellId = "emberlash" | "stonebrand" | "voltrend";
export type QuestId = string;

export type Archetype =
  | "ore" | "tree" | "fishing_spot" | "farm_plot"
  | "enemy" | "boss" | "npc" | "station" | "bank" | "shop"
  | "obstacle" | "door" | "portal" | "loot" | "recovery_cache" | "landmark";

export type InteractionId =
  | "inspect" | "mine" | "chop" | "fish" | "rake" | "plant" | "harvest"
  | "attack" | "cast" | "talk" | "open" | "enter" | "climb" | "vault"
  | "loot" | "take" | "produce" | "bank" | "trade" | "equip" | "unequip";

// ---------------------------------------------------------- items, equipment

export interface ItemStack { itemId: ItemId; quantity: number }
export interface InventorySlot extends ItemStack { slotIndex: number }

export interface EquipmentBonuses {
  accuracy: number;
  power: number;
  armour: number;
  magicAccuracy: number;
  magicPower: number;
  magicArmour: number;
  vitality: number;
}

export type ItemCategory =
  | "resource" | "bar" | "equipment" | "food" | "tool"
  | "seed" | "quest" | "currency" | "component";

export interface ItemDef {
  id: ItemId;
  name: string;
  tier: number;
  description: string;
  stackable: boolean;
  /** Shop buy price. Sell price is round(value * 0.6). */
  value: number;
  category: ItemCategory;
  equip?: {
    slot: EquipSlot;
    bonuses: EquipmentBonuses;
    attackSpeedMs?: number;
    requires: Partial<Record<SkillId, number>>;
  };
  food?: { healAmount: number };
  tool?: { skill: SkillId; gatherBonus: number };
  seed?: { cropId: ItemId };
}

// ------------------------------------------------------- the semantic entity

export interface SemanticEntity {
  id: EntityId;
  archetype: Archetype;
  name: string;
  tier: number;
  regionId: RegionId;
  position: Vec3;
  /** Archetype-specific, e.g. "available" | "depleted" | "alive" | "dead". */
  state: string;
  requirements?: Partial<Record<SkillId, number>>;
  interactions: InteractionId[];
  resource?: { remaining: number; maxYields: number; respawnSeconds: number; itemId: ItemId };
  combat?: { health: number; maxHealth: number; level: number; aggroRadius: number };
  npc?: { dialogueRootId: string; questIds: QuestId[] };
  station?: { skill: SkillId; recipeIds: RecipeId[] };
  /** Agility shortcut. Traversal is a route-graph edge, not a navmesh off-mesh link. */
  obstacle?: { reqLevel: number; exitPosition: Vec3; durationMs: number; savesMeters: number };
  /**
   * How this entity is drawn. The seam between the world layer (which owns semantics) and the
   * render layer (which owns meshes). `assetId` refers to an id in assets/manifest.json.
   * The render layer never invents an appearance; the world layer never touches Three.js.
   */
  view?: {
    assetId: string;
    /** Uniform scale. Assets are authored in metres, so this is usually near 1. */
    scale?: number;
    rotationY?: number;
    /** Swapped in when `state` is "depleted" or "dead". Falls back to a desaturated material. */
    depletedAssetId?: string;
    /**
     * Draw only the lowest fraction of the mesh, 0..1. Used to cut a tree down to a stump.
     *
     * The asset library ships no stump, and Phase 1 substituted `anvil_log` — an anvil that
     * happens to stand on a log — which put a blacksmith's anvil wherever a stump belonged.
     * Clipping a real tree's own trunk is the honest version and costs one geometry per group.
     */
    clipFraction?: number;
    /** Tier palette override. Defaults to the entity's own tier. */
    materialTier?: number;
    /** Metres above `position` for the interaction label and highlight ring. */
    labelHeight?: number;
    /**
     * Skinned parts layered onto `assetId`'s skeleton. NOT a replacement for `assetId`.
     *
     * Every NPC in Phase 1 was literally headless. `world/regionBuilder.ts` `dressedAssetFor()`
     * swapped an NPC's body for a full outfit GLB, and the outfit files are not bodies:
     * `outfit_male_peasant.glb` holds exactly four meshes (Arms, Body, Feet, Legs), tops out at
     * y = 1.559 against `base_male`'s 1.810, and carries no Head, Eyes or Eyebrows — measured by
     * structural dump of the GLB. The fix is body + parts, so `assetId` stays `base_male` /
     * `base_female` (which carry the face) and the clothing arrives here.
     *
     * `render/skinning.ts` binds each part to the BODY's `Bone` objects while keeping the PART's
     * own `boneInverses` — that is what makes cross-file mixing correct. It is safe because all
     * four humanoid rigs in the 213-asset library carry the same 65 joints in the same order
     * (verified name-by-name: root, pelvis, spine_01..03, neck_01, Head, clavicle/upperarm/
     * lowerarm/hand + 5 fingers x 4 per side, thigh/calf/foot/ball per side). They differ only in
     * bind pose; the residual is 0 mm for the female set and <= 23.7 mm for the male set, and it
     * sits inside the clothing everywhere except the wrists. Do NOT retarget: the joint lists
     * already match, so retargeting can only add error.
     *
     * A part whose skeleton fails to bind must be DROPPED, not drawn. An unbound part renders
     * forever in bind pose — that is the T-posed tunic lying across the player's shoulders in
     * runs/corealm/screenshots/RIG-town-player.png — which reads far worse than a missing sleeve.
     */
    partAssetIds?: readonly string[];
    /**
     * Terrain normal under this entity: UNIT LENGTH, WORLD SPACE, Y-up.
     *
     * Computed in the WORLD layer from a central difference on the same `heightAt` port that
     * places the entity (no Three.js in `world/`), and clamped to about 20 degrees off vertical.
     * Nothing tilted to the ground in Phase 1: `writeSlot` composed its matrix from a Y-axis
     * rotation only, and 34 of 159 surface entities stand on ground steeper than 10 degrees —
     * worst case `lower_quarry_kaldite_3`, a 5.3 m ore rock on a 48.9-degree slope with 3.02 m of
     * daylight under one edge.
     *
     * `render/` must SLERP toward this, scaled by `tiltStrength`, not apply it raw. A tree laid
     * over at the full slope of the hill reads worse than a tree standing plumb; a pebble does not.
     */
    groundNormal?: readonly [number, number, number];
    /**
     * 0..1, how much of `groundNormal` to apply. Per-archetype defaults live in `render/`, not
     * here, because they are a look decision: trees want about 0.10, pebbles and flat plants 1.0.
     * Set it per entity only to override that table.
     */
    tiltStrength?: number;
  };
  meta?: Record<string, string | number | boolean>;
}

// ----------------------------------------------------------------- solids

/**
 * A volume the player must not walk into.
 *
 * This type sits in contracts rather than in either layer that touches it, because both do: the
 * world layer PRODUCES the list while it builds a region (it is the only layer that knows a
 * gatehouse has two piers and a gap between them), and `systems/solids.ts` CONSUMES it to clamp
 * movement and to carve the navmesh. Neither may import the other, and neither owns the shape.
 *
 * Why this exists at all, measured before it was written: the whole world had 40 colliders — one
 * terrain heightfield and 39 boxes derived from the 36 authored buildings. 892 semantic entities
 * registered no volume whatsoever, so the player walked through the bank chest, the anvil, both
 * market stalls, an NPC, an enemy, a resource tree, an ore rock, the region gate arch, and across
 * a pond floor 0.50 m under the water plane.
 *
 * Two rules that are not obvious and are load-bearing:
 *
 *  - `radius`, or half the diagonal of a box, must stay under `INTERACT_RANGE` (2.4 m). A volume
 *    wider than the interaction reach makes its own entity unreachable: `moveTo({ entityId })`
 *    walks to the surface of the carve and can then never get close enough to click the thing.
 *    Seven gate-check lines depend on that reach.
 *  - `y` is the volume's BASE, not its centre, because everything that produces one knows where
 *    the ground is and not where the middle of the mesh ended up.
 */
export type SolidVolume =
  | {
      kind: "box";
      /** Owning entity or building part, for debugging and for skipping a volume when it is removed. */
      id: string;
      /** Centre in XZ; `y` is the base of the box. */
      position: Vec3;
      /** Full extents in the box's own frame, before `rotationY`. */
      size: readonly [number, number, number];
      rotationY: number;
    }
  | {
      kind: "cylinder";
      id: string;
      /** Centre in XZ; `y` is the base of the cylinder. */
      position: Vec3;
      radius: number;
      height: number;
    };

// ------------------------------------------------------------- observation

export type ObservationScope = "visible" | "known";

export interface ObservedEntity {
  id: EntityId;
  archetype: Archetype;
  name: string;
  tier: number;
  regionId: RegionId;
  position: Vec3;
  /** Path distance in metres, not straight line. */
  distance: number;
  /**
   * The route-graph place this row stands at, when it is one.
   *
   * `id` is the ENTITY's id, and for a place backed by an entity the two differ: the Coldbrace bank
   * comes back as `coldbrace_bank` at the location `bank_interior`, the Gravelmaw's mouth as
   * `gravelmaw_mouth_portal` at `gravelmaw_entrance`. So `id` cannot be handed to
   * `moveTo({ locationId })`, and every caller that wanted to was reduced to matching positions.
   * This is that join, stated rather than guessed.
   */
  locationId?: string;
  state: string;
  interactions: InteractionId[];
  requirementsMet: boolean;
  blockedBy?: string;
}

export interface ObserveFilter {
  scope?: ObservationScope;
  /** Default 40, max 140. */
  radius?: number;
  archetypes?: Archetype[];
  interaction?: InteractionId;
  requirementsMet?: boolean;
  regionId?: RegionId;
  /** Default 25, max 100. */
  limit?: number;
}

// ------------------------------------------------------------------ errors

export type GameErrorCode =
  | "NOT_FOUND" | "OUT_OF_RANGE" | "NOT_REACHABLE" | "REQUIREMENTS_NOT_MET"
  | "INVENTORY_FULL" | "BUSY" | "INVALID_ARGUMENT" | "DEAD" | "DEPLETED"
  | "NOT_ENOUGH_CURRENCY" | "NOT_ENOUGH_ITEMS" | "NO_DIALOGUE"
  | "TIMEOUT" | "UNAVAILABLE";

export interface GameError { code: GameErrorCode; message: string; entityId?: EntityId }

export type Result<T> = { ok: true; value: T } | { ok: false; error: GameError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(code: GameErrorCode, message: string, entityId?: EntityId): Result<T> {
  return { ok: false, error: entityId ? { code, message, entityId } : { code, message } };
}

// ------------------------------------------------------------------ events

export type GameEventType =
  | "navigation.started" | "navigation.completed" | "navigation.failed"
  | "activity.started" | "activity.stopped"
  | "resource.depleted" | "inventory.full"
  | "item.received" | "item.lost"
  /**
   * Gear moving between the pack and a worn slot. These exist so an agent that reconstructs its
   * inventory from `item.received`/`item.lost` does not read an equip as "I lost my weapon":
   * neither of those two fires for the piece being worn or taken off. A swap emits one
   * `item.equipped` carrying `replaced`, and the displaced piece's return to the pack is part of
   * that event rather than a separate `item.received`.
   */
  | "item.equipped" | "item.unequipped"
  | "combat.started" | "combat.ended"
  | "health.low" | "player.died"
  | "level.gained" | "production.completed"
  | "quest.updated" | "dialogue.opened" | "dialogue.closed"
  | "entity.discovered";

export interface GameEvent {
  /** Monotonic, never reused. */
  seq: number;
  type: GameEventType;
  /** Sim clock milliseconds. */
  atMs: number;
  entityId?: EntityId;
  data: Record<string, unknown>;
}

// ------------------------------------------------------------- state views

export interface PlayerView {
  position: Vec3;
  regionId: RegionId;
  health: number;
  maxHealth: number;
  /** Which way the player is facing, radians, 0 = +Z (north), increasing toward +X. */
  facingRad: number;
  /**
   * A fight is happening right now: the player has a target, or an enemy has engaged them.
   * It clears on the frame the last enemy dies or disengages, so `waitFor(() => !inCombat)` is a
   * safe way for an agent to wait out a kill. The eight-second no-regen window is a different
   * question — read `regenBlocked` for that.
   */
  inCombat: boolean;
  /** The PRD 2.3 no-regen window: true for eight seconds after the last blow in either direction. */
  regenBlocked: boolean;
  /** Live target, or null. Non-null implies `inCombat`. */
  targetId: EntityId | null;
  /** Enemies that have engaged the player and are still alive. */
  engagedBy: EntityId[];
  dead: boolean;
  moving: boolean;
  activityKind: string | null;
  combatLevelEstimate: number;
}

export interface SkillView { level: number; xp: number; xpToNext: number }

export interface ActivitySummary {
  kind: string;
  skill?: SkillId;
  entityId?: EntityId;
  recipeId?: RecipeId;
  /** 0..1 for the current unit of work. */
  progress: number;
  completed: number;
  remaining: number;
}

/**
 * One id a quest objective points at.
 *
 * Objective prose is prose: it names the Bracken Pit, not `bracken_pit`. Everything actionable in
 * a sentence appears here instead, because `moveTo`, `interact` and `getInventory` all take ids and
 * a player's journal should never print one.
 */
export type QuestObjectiveRef =
  | { kind: "item"; id: ItemId }
  | { kind: "entity"; id: EntityId }
  | { kind: "location"; id: string }
  | { kind: "enemyFamily"; id: string }
  | { kind: "recipe"; id: RecipeId }
  | { kind: "spell"; id: SpellId };

export interface QuestSummary {
  id: QuestId;
  name: string;
  regionId: RegionId;
  status: "unstarted" | "active" | "complete";
  stage: number;
  stageCount: number;
  /** Player-facing prose. Never contains an id. */
  currentObjective: string | null;
  /**
   * Every id the current objective refers to, in the order the sentence names them. Empty when the
   * quest is not active. An agent reads this instead of parsing `currentObjective`.
   */
  currentObjectiveRefs: QuestObjectiveRef[];
  requirements: Partial<Record<SkillId, number>>;
}

export interface DialogueView {
  npcId: EntityId;
  speaker: string;
  text: string;
  options: { id: string; text: string; enabled: boolean; disabledReason?: string }[];
}

/**
 * The sim clock, as a value.
 *
 * Every deadline the game hands out — a recovery cache's expiry, a crop's growth, a respawn — is
 * stamped in SIM milliseconds, and until this existed there was no way to read the sim clock
 * through the API at all. A caller holding `expiresAtMs` could only guess at "how long is left" by
 * anchoring off `GameEvent.atMs` and coasting at wall rate between events, which is wrong whenever
 * the clock is paused or rescaled and silently wrong in a world that happens to be quiet.
 *
 * `paused` and `timeScale` are here because a countdown that ignores them is a countdown that
 * lies, and both the death report and an agent planning around a deadline need to know.
 */
export interface TimeView {
  /** Sim milliseconds since boot. The frame every `*AtMs` field in the game is expressed in. */
  simMs: number;
  /** Whole sim ticks elapsed. `simMs / SIM_TICK_MS`, without the rounding question. */
  tick: number;
  /** Sim milliseconds per real millisecond. 1 in normal play. */
  timeScale: number;
  paused: boolean;
}

export interface BankView { slots: ItemStack[]; usedSlots: number; capacity: number }

export interface ShopView {
  shopId: EntityId;
  stock: { itemId: ItemId; name: string; buyPrice: number; sellPrice: number; quantity: number }[];
  currency: number;
}

export interface DocHit { docId: string; title: string; section: string; snippet: string; score: number }

export interface OverlaySpec {
  id: string;
  kind: "highlight" | "path" | "marker" | "label";
  entityId?: EntityId;
  position?: Vec3;
  path?: Vec3[];
  text?: string;
  /** "#rrggbb" */
  colour?: string;
  /** Default 0, meaning until cleared. */
  ttlMs?: number;
}

export type MoveTarget = { entityId: EntityId } | { position: Vec3 } | { locationId: string };

// --------------------------------------------------------------- the API

/**
 * The canonical game API. This is the ONLY write path into the world.
 *
 * `ui/*`, `agent/tools.ts`, and `debug/gameDebug.ts` all route through this interface. There is no
 * second path. Agent parity depends on it: a human click and a WebMCP call reach the same function.
 *
 * Nothing here throws across the boundary. Failures come back as `Result<T>`.
 */
export interface GameApi {
  // state
  getPlayer(): PlayerView;
  getSkills(): Record<SkillId, SkillView>;
  getInventory(): { slots: (InventorySlot | null)[]; freeSlots: number };
  getEquipment(): { slots: Record<EquipSlot, ItemStack | null>; totals: EquipmentBonuses };
  getActivity(): ActivitySummary | null;
  getQuests(): QuestSummary[];
  getCurrency(): number;
  /** The sim clock. Compare any `*AtMs` deadline against `simMs`, never against wall time. */
  getTime(): TimeView;

  // observation
  observe(filter: ObserveFilter): ObservedEntity[];
  inspect(entityId: EntityId): Result<SemanticEntity>;
  searchDocs(query: string, limit?: number): DocHit[];

  // movement
  moveTo(target: MoveTarget): Result<{ pathLength: number; etaMs: number }>;
  stop(): Result<{ stopped: string[] }>;

  // interaction
  interact(entityId: EntityId, interaction: InteractionId): Result<{ started: string }>;
  useItem(itemId: ItemId, target?: { itemId: ItemId } | { entityId: EntityId }): Result<{ effect: string }>;
  equipItem(itemId: ItemId): Result<{ slot: EquipSlot; replaced: ItemId | null }>;
  unequipItem(slot: EquipSlot): Result<{ itemId: ItemId }>;
  produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }>;

  // combat
  attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }>;
  cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }>;

  // npc, bank, shop
  dialogue(op: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null>;
  bank(
    op: "list" | "deposit" | "withdraw" | "depositAll",
    args?: { itemId?: ItemId; quantity?: number; filter?: string },
  ): Result<BankView>;
  shop(
    op: "list" | "buy" | "sell",
    args?: { shopId?: EntityId; itemId?: ItemId; quantity?: number },
  ): Result<ShopView>;

  // overlays
  overlay(op: "set" | "clear", spec?: OverlaySpec): Result<{ activeCount: number }>;

  // events
  events(
    sinceSeq: number,
    filter?: GameEventType[],
    timeoutMs?: number,
  ): Promise<{ events: GameEvent[]; nextSeq: number }>;
}
