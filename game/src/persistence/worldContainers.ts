/** Rebuilds runtime-only semantic entities for containers held in canonical save state. */
import type { EntityId, RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import type { GameState } from "../state/store.js";

export const RECOVERY_CACHE_VIEW: NonNullable<SemanticEntity["view"]> = {
  assetId: "crate_wood",
  scale: 1.1,
  labelHeight: 1.4,
};

export const LOOT_PILE_VIEW: NonNullable<SemanticEntity["view"]> = {
  assetId: "crate_wood",
  scale: 0.72,
  labelHeight: 1.05,
};

export interface WorldContainerEntityPort {
  all(): SemanticEntity[];
  add(entity: SemanticEntity): void;
  remove(id: EntityId): boolean;
}

export interface RehydrateOptions {
  /** Fallback for old or hand-edited piles whose source entity cannot be recovered from the id. */
  regionAt?: (position: Vec3) => RegionId;
}

export interface RehydrateResult {
  recoveryCaches: number;
  lootPiles: number;
}

/**
 * `GameState.world` owns container contents and deadlines. `EntityStore` owns whether a player or
 * agent can see and interact with them. A save replacement must restore both halves.
 */
export function rehydrateWorldContainers(
  state: GameState,
  entities: WorldContainerEntityPort,
  options: RehydrateOptions = {},
): RehydrateResult {
  const staticEntities = entities.all().filter((entity) =>
    entity.archetype !== "recovery_cache" && entity.archetype !== "loot");

  // Safe when called more than once. A debug load can replace one save with another in place.
  for (const entity of entities.all()) {
    if (entity.archetype === "recovery_cache" || entity.archetype === "loot") {
      entities.remove(entity.id);
    }
  }

  let recoveryCaches = 0;
  const cache = state.world.recoveryCache;
  if (cache && cache.items.length > 0) {
    entities.add({
      id: cache.id,
      archetype: "recovery_cache",
      name: "Recovery Cache",
      tier: 1,
      regionId: cache.regionId,
      position: clonePosition(cache.position),
      state: "available",
      interactions: ["inspect", "loot"],
      view: RECOVERY_CACHE_VIEW,
      meta: {
        blurb: "Everything you were carrying when you died. It will not wait forever.",
        expiresAtMs: cache.expiresAtMs,
        itemCount: cache.items.length,
      },
    });
    recoveryCaches = 1;
  }

  let lootPiles = 0;
  for (const [pileId, pile] of Object.entries(state.world.lootPiles)) {
    if (!pile || pile.items.length === 0) continue;
    const source = sourceEntityForPile(pileId, staticEntities);
    const position = clonePosition(pile.position);
    const regionId = source?.regionId
      ?? options.regionAt?.(position)
      ?? state.player.regionId;
    entities.add({
      id: pileId,
      archetype: "loot",
      name: source ? `${source.name}'s drop` : "Loot pile",
      tier: source?.tier ?? 1,
      regionId,
      position,
      state: "available",
      interactions: ["inspect", "loot"],
      view: LOOT_PILE_VIEW,
      meta: {
        ...(source ? { droppedBy: source.id } : {}),
        expiresAtMs: pile.expiresAtMs,
      },
    });
    lootPiles += 1;
  }

  return { recoveryCaches, lootPiles };
}

/** Loot ids are `loot_${enemyId}_${sequence}`. Longest-first avoids prefix collisions. */
function sourceEntityForPile(
  pileId: EntityId,
  candidates: readonly SemanticEntity[],
): SemanticEntity | undefined {
  return [...candidates]
    .sort((a, b) => b.id.length - a.id.length)
    .find((entity) => {
      const prefix = `loot_${entity.id}_`;
      if (!pileId.startsWith(prefix)) return false;
      const suffix = pileId.slice(prefix.length);
      return /^\d+$/.test(suffix);
    });
}

function clonePosition(position: Vec3): Vec3 {
  return [position[0], position[1], position[2]];
}
