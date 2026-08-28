/**
 * Typed persistence over localStorage. The only place the game touches browser storage.
 *
 * Content-derived values (maxHealth, skill levels, prices) are recomputed on load rather than
 * trusted, so a content rebalance applies to existing saves.
 */
import { SAVE_VERSION, createInitialState, type GameState } from "../state/store.js";
import { levelForXp } from "../content/xp.js";
import { SKILL_IDS } from "../contracts.js";
import { migrate, type MigrationResult } from "./migrate.js";

const SAVE_KEY = "corealm.save.v1";

export interface LoadOutcome {
  status: "loaded" | "empty" | "failed";
  state?: GameState;
  reason?: string;
}

export class SaveService {
  private available: boolean;

  constructor() {
    this.available = detectStorage();
  }

  isAvailable(): boolean {
    return this.available;
  }

  save(state: GameState, nowMs: number): boolean {
    if (!this.available) return false;
    try {
      const payload = JSON.parse(JSON.stringify(state)) as GameState;
      payload.meta.saveVersion = SAVE_VERSION;
      payload.meta.lastSavedAtMs = nowMs;
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  load(): LoadOutcome {
    if (!this.available) return { status: "empty" };
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch {
      return { status: "failed", reason: "localStorage read failed" };
    }
    if (!raw) return { status: "empty" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: "failed", reason: "Save is not valid JSON" };
    }

    const result: MigrationResult = migrate(parsed);
    if (!result.ok || !result.state) return { status: "failed", reason: result.reason ?? "Migration failed" };

    return { status: "loaded", state: recompute(result.state) };
  }

  /** The raw JSON that would be written. Used by the debug API and the export-on-failure path. */
  serialize(state: GameState): string {
    return JSON.stringify(state);
  }

  clear(): void {
    if (!this.available) return;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* nothing useful to do */
    }
  }
}

/**
 * Recomputes everything derivable from content, so a rebalance reaches existing saves.
 *
 * Also repairs shape: a save written by an older build can be missing a slice entirely, and a
 * missing slice must not crash the boot that loads it. Every gap falls back to the fresh-state
 * default rather than to undefined.
 */
function recompute(state: GameState): GameState {
  const fresh = createInitialState(state.meta?.seed ?? 1337, Date.now());

  state.skills = state.skills ?? fresh.skills;
  for (const skill of SKILL_IDS) {
    const entry = state.skills[skill];
    if (entry && typeof entry.xp === "number") entry.level = levelForXp(entry.xp);
    else state.skills[skill] = { xp: 0, level: 1 };
  }

  // Slices added after a save was written.
  state.world = state.world ?? fresh.world;
  state.world.nodes = state.world.nodes ?? {};
  state.world.enemies = state.world.enemies ?? {};
  state.world.obstaclesUsed = state.world.obstaclesUsed ?? {};
  state.world.lootPiles = state.world.lootPiles ?? {};
  state.world.recoveryCache = state.world.recoveryCache ?? null;
  state.discovery = state.discovery ?? fresh.discovery;
  state.discovery.entities = state.discovery.entities ?? {};
  state.discovery.locations = state.discovery.locations ?? {};
  state.discovery.regions = state.discovery.regions ?? fresh.discovery.regions;
  state.farming = state.farming ?? {};
  state.quests = state.quests ?? {};
  state.bank = state.bank ?? fresh.bank;
  state.bank.slots = state.bank.slots ?? [];
  state.equipment = { ...fresh.equipment, ...(state.equipment ?? {}) };
  state.combat = state.combat ?? fresh.combat;
  state.settings = { ...fresh.settings, ...(state.settings ?? {}) };

  // A conversation does not survive a reload.
  //
  // `state.dialogue` is serialised with everything else, and the window that draws it is raised by
  // the `dialogue.opened` event — which a load does not emit. So saving mid-conversation and
  // reloading left the game silently inside an open dialogue: nothing on screen, and the next
  // `talk` behaving oddly because one was already running. The node is re-derivable by talking to
  // the NPC again, so dropping it costs nothing and closes the gap between the state and the
  // events that are supposed to describe it.
  state.dialogue = null;
  state.currency = typeof state.currency === "number" ? state.currency : 0;

  // The inventory must be exactly 28 slots, or every index-based operation is off by however
  // many an older build wrote.
  const slots = Array.isArray(state.inventory?.slots) ? state.inventory.slots : [];
  slots.length = fresh.inventory.slots.length;
  for (let index = 0; index < slots.length; index += 1) {
    if (slots[index] === undefined) slots[index] = null;
  }
  state.inventory = { slots };

  return state;
}

function detectStorage(): boolean {
  try {
    const probe = "__corealm_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
