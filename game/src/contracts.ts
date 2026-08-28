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
  meta?: Record<string, string | number | boolean>;
}

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
  inCombat: boolean;
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

export interface QuestSummary {
  id: QuestId;
  name: string;
  regionId: RegionId;
  status: "unstarted" | "active" | "complete";
  stage: number;
  stageCount: number;
  currentObjective: string | null;
  requirements: Partial<Record<SkillId, number>>;
}

export interface DialogueView {
  npcId: EntityId;
  speaker: string;
  text: string;
  options: { id: string; text: string; enabled: boolean; disabledReason?: string }[];
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
