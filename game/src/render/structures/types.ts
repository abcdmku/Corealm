import type { StructureVariantDescriptor } from "../../contracts.js";
import type { BuildingKit, KitId, PartPlacement, PrefabId } from "../buildings.js";

/** Inputs shared by every curated recipe. Values are in the prefab's local frame. */
export interface StructureVariantContext {
  readonly prefab: PrefabId;
  readonly width: number;
  readonly depth: number;
  readonly seed: number;
  readonly kitId: KitId;
  readonly kit: BuildingKit;
  /** Closed rings enter at -Z, open work structures at +Z, and scenery-only prefabs use 0. */
  readonly entranceZ: -1 | 0 | 1;
}

/**
 * One curated, deterministic variation of an existing prefab.
 *
 * Recipes may replace the appearance of existing tagged parts and append `v_*` detail parts. They
 * must retain the prefab's footprint, entrance, solid mass, roof envelope and walk-under cover.
 */
export interface StructureVariantRecipe extends StructureVariantDescriptor<PrefabId> {
  readonly kits?: readonly KitId[];
  readonly fits?: (context: StructureVariantContext) => boolean;
  readonly build: (
    context: StructureVariantContext,
    base: readonly PartPlacement[],
  ) => PartPlacement[];
}
