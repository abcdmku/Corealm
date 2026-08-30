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

  let state = candidate as GameState;

  // v1 -> v2: the magic ladder grew from three spells to sixteen, and `state.combat` gained
  // `preferredSpellId` to hold the spellbook's standing choice.
  //
  // A v1 save has no such field, and `undefined` would flow straight into `preferredSpellId()` and
  // into the JSON clone the agent surface reads. It happens to be falsy, so the game would LOOK
  // fine — which is precisely why it is filled in here rather than left to luck. Null means "pick
  // the best spell for me", which is what a v1 character was already getting.
  if (version < 2) {
    state = {
      ...state,
      combat: { ...state.combat, preferredSpellId: state.combat?.preferredSpellId ?? null },
      meta: { ...state.meta, saveVersion: 2 },
    };
  }

  if (state.meta.saveVersion === SAVE_VERSION) return { ok: true, state, fromVersion: version };

  return { ok: false, reason: `No migration path from v${version}`, fromVersion: version };
}
