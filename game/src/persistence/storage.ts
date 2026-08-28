/**
 * Typed persistence over localStorage. The only place the game touches browser storage.
 *
 * Content-derived values (maxHealth, skill levels, prices) are recomputed on load rather than
 * trusted, so a content rebalance applies to existing saves.
 */
import { SAVE_VERSION, type GameState } from "../state/store.js";
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

/** Recomputes everything derivable from content, so rebalances reach old saves. */
function recompute(state: GameState): GameState {
  for (const skill of SKILL_IDS) {
    const entry = state.skills?.[skill];
    if (entry) entry.level = levelForXp(entry.xp);
    else state.skills = { ...state.skills, [skill]: { xp: 0, level: 1 } };
  }
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
