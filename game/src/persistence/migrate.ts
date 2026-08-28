import { SAVE_VERSION, type GameState } from "../state/store.js";

export interface MigrationResult {
  ok: boolean;
  state?: GameState;
  reason?: string;
  fromVersion?: number;
}

/**
 * Save migrations. An unmigratable save is never silently wiped — the caller offers an export and a
 * fresh start instead.
 */
export function migrate(raw: unknown): MigrationResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "Save is not an object" };
  const candidate = raw as Partial<GameState>;
  const version = candidate.meta?.saveVersion;

  if (typeof version !== "number") return { ok: false, reason: "Save has no version" };
  if (version > SAVE_VERSION) {
    return { ok: false, reason: `Save is from a newer build (v${version} > v${SAVE_VERSION})`, fromVersion: version };
  }

  // v1 is the first shipped version; nothing to migrate yet. Future steps chain here.
  if (version === SAVE_VERSION) return { ok: true, state: candidate as GameState, fromVersion: version };

  return { ok: false, reason: `No migration path from v${version}`, fromVersion: version };
}
