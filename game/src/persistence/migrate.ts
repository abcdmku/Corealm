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
  if (!Number.isSafeInteger(version) || version < 1) {
    return { ok: false, reason: `Unsupported save version: ${String(version)}` };
  }
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

  // v2 -> v3: one portable campfire is now persisted against played time. Null preserves every
  // v2 world exactly and, unlike a wall-clock deadline, never decays while the game is closed.
  // Node respawn deadlines also became played-time deadlines. V2 saved only a session-clock
  // absolute with no clock origin, so an exact remainder cannot be recovered. Making legacy
  // depleted nodes immediately due is safer than trapping them behind a prior session's uptime.
  if (state.meta.saveVersion < 3) {
    const nodes = Object.fromEntries(Object.entries(state.world?.nodes ?? {}).map(([id, node]) => [
      id,
      node.state === "depleted"
        ? { ...withNodeCapacity(node), respawnAtMs: state.meta.playSeconds * 1_000 }
        : { ...withNodeCapacity(node), respawnAtMs: null },
    ]));
    state = {
      ...state,
      world: { ...state.world, nodes, campfire: null },
      meta: { ...state.meta, saveVersion: 3 },
    };
  }

  // Early v3 builds did not persist a node's freshly rolled capacity. Keep `migrate()` truthful
  // for direct callers as well as SaveService: a successful result always has canonical v3 node
  // records, even when the input already claimed version 3.
  if (state.meta.saveVersion === 3 && state.world?.nodes) {
    state = {
      ...state,
      world: {
        ...state.world,
        nodes: Object.fromEntries(Object.entries(state.world.nodes).map(([id, node]) => [
          id,
          withNodeCapacity(node),
        ])),
      },
    };
  }

  if (state.meta.saveVersion === SAVE_VERSION) return { ok: true, state, fromVersion: version };

  return { ok: false, reason: `No migration path from v${version}`, fromVersion: version };
}

function withNodeCapacity(
  node: GameState["world"]["nodes"][string],
): GameState["world"]["nodes"][string] {
  const remaining = Number.isFinite(node.remaining) ? Math.max(0, Math.floor(node.remaining)) : 0;
  const savedMaximum = Number.isFinite(node.maxYields)
    ? Math.max(0, Math.floor(node.maxYields))
    : remaining;
  return { ...node, remaining, maxYields: Math.max(remaining, savedMaximum) };
}
