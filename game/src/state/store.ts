/**
 * The single canonical game state.
 *
 * FROZEN SHAPE. Only the root edits this file. Systems mutate through the exported reducers so that
 * persistence, the debug API, and the agent surface all see one shape.
 *
 * Everything here is plain JSON-safe data: no class instances, no Map/Set, no cycles. The harness
 * serialises this straight through `JSON.parse(JSON.stringify(...))`.
 */
import type {
  EntityId, EquipSlot, InventorySlot, ItemId, ItemStack, RecipeId,
  RegionId, SkillId, SpellId, Vec3,
} from "../contracts.js";
import { EQUIP_SLOTS, SKILL_IDS } from "../contracts.js";
import { levelForXp, totalXpAt } from "../content/xp.js";
import { STARTING_EQUIPMENT, STARTING_INVENTORY } from "../content/items.js";

export const INVENTORY_SLOTS = 28;
export const BANK_CAPACITY = 400;
export const SAVE_VERSION = 1;

export type ActivityState =
  | {
      kind: "gathering"; skill: SkillId; entityId: EntityId; nodeTier: number;
      startedAtMs: number; nextRollAtMs: number; yieldsThisSession: number;
    }
  | {
      kind: "production"; skill: SkillId; recipeId: RecipeId; stationId: EntityId;
      remaining: number; completed: number; nextCompleteAtMs: number;
    }
  | { kind: "traversing"; obstacleId: EntityId; endsAtMs: number }
  | { kind: "farming"; op: "rake" | "plant" | "harvest"; plotId: string; endsAtMs: number }
  | { kind: "eating"; itemId: ItemId; endsAtMs: number };

export interface FarmPlotState {
  plotId: string;
  regionId: RegionId;
  cropId: ItemId | null;
  stage: number;
  stageCount: number;
  /** Wall clock, so crops keep growing between sessions. */
  stageStartedAtMs: number;
  state: "empty" | "raked" | "growing" | "ready";
}

export interface GameState {
  meta: {
    saveVersion: number;
    createdAtMs: number;
    lastSavedAtMs: number;
    playSeconds: number;
    seed: number;
  };
  player: {
    id: EntityId;
    name: string;
    position: Vec3;
    facingRad: number;
    regionId: RegionId;
    health: number;
    maxHealth: number;
    respawnPointId: string;
    movement: {
      mode: "idle" | "path" | "direct";
      path: Vec3[] | null;
      pathIndex: number;
      destination: Vec3 | null;
      destinationEntityId: EntityId | null;
    };
  };
  skills: Record<SkillId, { xp: number; level: number }>;
  inventory: { slots: (InventorySlot | null)[] };
  equipment: Record<EquipSlot, ItemStack | null>;
  bank: { slots: ItemStack[]; filter: string };
  currency: number;
  activity: ActivityState | null;
  combat: {
    targetId: EntityId | null;
    inCombatUntilMs: number;
    nextAttackAtMs: number;
    activeSpellId: SpellId | null;
    engagedBy: EntityId[];
  };
  quests: Record<string, {
    status: "unstarted" | "active" | "complete";
    stage: number;
    counters: Record<string, number>;
    flags: Record<string, boolean>;
  }>;
  dialogue: {
    npcId: EntityId;
    nodeId: string;
    text: string;
    speaker: string;
    options: { id: string; text: string; enabled: boolean; disabledReason?: string }[];
  } | null;
  farming: Record<string, FarmPlotState>;
  world: {
    nodes: Record<EntityId, { remaining: number; state: "available" | "depleted"; respawnAtMs: number | null }>;
    enemies: Record<EntityId, {
      health: number;
      state: "idle" | "aggro" | "dead" | "returning";
      spawnPos: Vec3;
      respawnAtMs: number | null;
      bossPhase?: number;
    }>;
    obstaclesUsed: Record<EntityId, number>;
    lootPiles: Record<EntityId, { position: Vec3; items: ItemStack[]; expiresAtMs: number; ownerOnly: boolean }>;
    recoveryCache: {
      id: EntityId; position: Vec3; regionId: RegionId; items: ItemStack[]; expiresAtMs: number;
    } | null;
  };
  discovery: {
    entities: Record<EntityId, number>;
    locations: Record<string, number>;
    regions: RegionId[];
  };
  settings: {
    cameraDistance: number;
    cameraPitchRad: number;
    overlaysVisible: boolean;
    uiScale: number;
  };
}

export const DEFAULT_SPAWN: Vec3 = [0, 0, 0];
export const DEFAULT_REGION: RegionId = "fallowmarch";

export function createInitialState(seed = 1337, nowMs = 0): GameState {
  const skills = {} as Record<SkillId, { xp: number; level: number }>;
  for (const id of SKILL_IDS) skills[id] = { xp: 0, level: 1 };

  const equipment = {} as Record<EquipSlot, ItemStack | null>;
  for (const slot of EQUIP_SLOTS) equipment[slot] = null;
  // The starter kit, from one list in `content/items.ts` so a fresh game, a `__gameDebug.reset()`
  // and the docs cannot drift apart. Copied rather than referenced: the state is mutated in place
  // every tick, and handing out the content table's own object would let a stack count change the
  // canonical content.
  for (const [slot, stack] of Object.entries(STARTING_EQUIPMENT)) {
    equipment[slot as EquipSlot] = { ...stack };
  }

  const startingSlots = new Array<InventorySlot | null>(INVENTORY_SLOTS).fill(null);
  for (const [index, stack] of STARTING_INVENTORY.entries()) {
    if (index >= INVENTORY_SLOTS) break;
    startingSlots[index] = { ...stack, slotIndex: index };
  }

  return {
    meta: { saveVersion: SAVE_VERSION, createdAtMs: nowMs, lastSavedAtMs: 0, playSeconds: 0, seed },
    player: {
      id: "player",
      name: "Wanderer",
      position: [...DEFAULT_SPAWN] as unknown as Vec3,
      facingRad: 0,
      regionId: DEFAULT_REGION,
      health: 23,
      maxHealth: 23,
      respawnPointId: "coldbrace",
      movement: { mode: "idle", path: null, pathIndex: 0, destination: null, destinationEntityId: null },
    },
    skills,
    inventory: { slots: startingSlots },
    equipment,
    bank: { slots: [], filter: "" },
    currency: 0,
    activity: null,
    combat: { targetId: null, inCombatUntilMs: 0, nextAttackAtMs: 0, activeSpellId: null, engagedBy: [] },
    quests: {},
    dialogue: null,
    farming: {},
    world: { nodes: {}, enemies: {}, obstaclesUsed: {}, lootPiles: {}, recoveryCache: null },
    discovery: { entities: {}, locations: {}, regions: [DEFAULT_REGION] },
    settings: { cameraDistance: 18, cameraPitchRad: 0.72, overlaysVisible: true, uiScale: 1 },
  };
}

/**
 * Holds the canonical state and notifies subscribers when it changes.
 *
 * Deliberately not immutable — systems mutate in place for speed on a 100 ms tick — but every read
 * that leaves the game (debug API, agent surface, persistence) goes through a JSON clone.
 */
export class Store {
  private state: GameState;
  private listeners = new Set<() => void>();
  private dirty = false;

  constructor(seed = 1337, nowMs = 0) {
    this.state = createInitialState(seed, nowMs);
  }

  /** Live reference. Systems use this. Never hand it outside the game. */
  get(): GameState {
    return this.state;
  }

  /** JSON-safe deep copy, for the debug API, the agent surface, and persistence. */
  snapshot(): GameState {
    return JSON.parse(JSON.stringify(this.state)) as GameState;
  }

  replace(next: GameState): void {
    this.state = next;
    this.markDirty();
    this.notify();
  }

  reset(seed = this.state.meta.seed, nowMs = 0): void {
    this.state = createInitialState(seed, nowMs);
    this.markDirty();
    this.notify();
  }

  markDirty(): void {
    this.dirty = true;
  }

  consumeDirty(): boolean {
    const was = this.dirty;
    this.dirty = false;
    return was;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }
}

// ------------------------------------------------------------- skill helpers

/** Adds XP through the real level-up path. Returns the levels gained, if any. */
export function addSkillXp(state: GameState, skill: SkillId, amount: number): { levelsGained: number; newLevel: number } {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { levelsGained: 0, newLevel: state.skills[skill].level };
  }
  const entry = state.skills[skill];
  const before = entry.level;
  entry.xp = Math.min(entry.xp + amount, totalXpAt(99));
  entry.level = levelForXp(entry.xp);
  return { levelsGained: entry.level - before, newLevel: entry.level };
}

export function setSkillLevel(state: GameState, skill: SkillId, level: number): void {
  const clamped = Math.max(1, Math.min(99, Math.floor(level)));
  state.skills[skill] = { xp: totalXpAt(clamped), level: clamped };
}

/**
 * Derived max health, per PRD 2.3:
 *   vitalityLevel = max(1, floor((melee + magic) / 2))
 *   maxHealth     = 20 + 3 * vitalityLevel + equipped vitality
 */
export function computeMaxHealth(state: GameState, equipmentVitality: number): number {
  const vitalityLevel = Math.max(1, Math.floor((state.skills.melee.level + state.skills.magic.level) / 2));
  return 20 + 3 * vitalityLevel + equipmentVitality;
}
