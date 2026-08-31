import { describe, expect, it } from "vitest";
import { ENEMY_BLOCKS, enemyBlockFor } from "../game/src/content/enemies.js";
import { REGIONS } from "../game/src/content/regions.js";
import { ENEMY_SPEED_MPS } from "../game/src/systems/enemyAI.js";
import MANIFEST from "../game/public/assets/manifest.json" with { type: "json" };

/**
 * A creature's authored speed and its walk cycle have to agree, or it skates.
 *
 * `render/entityViews.ts: motionTimeScale` divides the creature's `moveSpeedMps` by the speed its
 * own cycle implies and plays the clip at the result, which is what plants the feet. That whole
 * mechanism is skipped when `moveSpeedMps` is undefined: the clip runs at its authored tempo while
 * `systems/enemyAI.ts` moves the body at the shared 3.1 m/s default, and the faster the creature
 * the worse it reads.
 *
 * That is not hypothetical. The three orb bosses shipped without one and `tools/creature-walk-probe.ts`
 * measured 61% foot slide on them — the largest, slowest-moving, most-looked-at creature in each
 * region, sliding. Nothing catches it at build time, so it is caught here.
 */

const ASSET_BY_ID = new Map(MANIFEST.assets.map((asset) => [asset.id, asset] as const));

interface Group {
  groupId: string;
  assetId: string;
  family: string;
  tier: number;
}

const GROUPS: Group[] = REGIONS.flatMap((region) => [
  ...region.enemyGroups.map((group) => ({
    groupId: group.id, assetId: group.assetId, family: group.family, tier: group.tier,
  })),
  ...(region.dungeon?.enemyGroups ?? []).map((group) => ({
    groupId: group.id, assetId: group.assetId, family: group.family, tier: group.tier,
  })),
]);

/**
 * Below this the rig has no stride worth matching and the clamp in `motionTimeScale` owns it.
 *
 * A viper measures 0.02 m/s and a rat 0.06: a snake glides and a rodent scurries, neither plants a
 * foot the eye can follow, so no playback rate fixes them and none is demanded here. Anything with
 * a real gait is above this by an order of magnitude — the smallest is the hog at 0.29.
 */
const MEASURABLE_STRIDE_MPS = 0.25;

describe("creature gait", () => {
  it("gives every creature with a measurable stride an authored move speed", () => {
    const offenders: string[] = [];
    for (const group of GROUPS) {
      const asset = ASSET_BY_ID.get(group.assetId) as { impliedWalkMps?: number } | undefined;
      const implied = asset?.impliedWalkMps;
      if (implied === undefined || implied < MEASURABLE_STRIDE_MPS) continue;
      const block = enemyBlockFor(group.groupId, group.family, group.tier);
      if (block?.moveSpeedMps === undefined) {
        offenders.push(
          `${group.groupId} (${group.assetId}, cycle implies ${implied} m/s) has no moveSpeedMps,`
          + ` so it walks at the ${ENEMY_SPEED_MPS} m/s default with its clip at authored tempo`,
        );
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  /**
   * Creatures whose authored speed the playback clamp provably cannot reach.
   *
   * Listed rather than hidden, because each is a real residual slide a player can see and none is
   * fixed by anything this test could assert. `tools/animals/gait.ts` prints the current number for
   * every rig and is the place to check whether one of these has been dealt with.
   *
   * `bramble_hogs` needs rate 4.48 against a 3.2 ceiling and slides about 32% (measured by
   * `tools/creature-walk-probe.ts`). The cause is the SOURCE CLIP, not the content: `animal_hog`
   * comes off one of the pack's `_exp` rigs, whose motions are sub-ranges of a single long take,
   * and the range picked for its walk implies 0.29 m/s — a fifth of what a boar that size moves at,
   * and far below every other four-legged animal here (the next slowest is the deer at 1.16).
   * Re-cutting that range in `tools/animals/catalog.mjs` is the fix; dropping the hog's speed to
   * 0.93 m/s to match the bad clip would make a tier 5 aggressive animal slower than a coney.
   */
  const UNREACHABLE_RATE = new Set(["bramble_hogs"]);

  it("keeps every authored gait inside the playback rate the renderer can reach", () => {
    // `WALK_RATE_MIN` 0.6 and `WALK_RATE_MAX` 3.2 in `render/entityViews.ts`. A speed outside what
    // the clamp can deliver is a creature that slides no matter what the clip does, so the content
    // has to stay inside the range rather than the range chase the content.
    const offenders: string[] = [];
    for (const group of GROUPS) {
      const asset = ASSET_BY_ID.get(group.assetId) as { impliedWalkMps?: number } | undefined;
      const implied = asset?.impliedWalkMps;
      const block = enemyBlockFor(group.groupId, group.family, group.tier);
      const speed = block?.moveSpeedMps;
      if (implied === undefined || implied < MEASURABLE_STRIDE_MPS || speed === undefined) continue;
      if (UNREACHABLE_RATE.has(group.groupId)) continue;
      const rate = speed / implied;
      if (rate < 0.6 || rate > 3.2) {
        offenders.push(
          `${group.groupId} needs playback rate ${rate.toFixed(2)} (${speed} / ${implied}),`
          + " which the clamp cannot deliver",
        );
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("keeps the known-unreachable list honest", () => {
    // An exception that has been fixed should stop being an exception, and one whose creature was
    // renamed should fail loudly rather than silently stop covering anything.
    for (const groupId of UNREACHABLE_RATE) {
      const group = GROUPS.find((candidate) => candidate.groupId === groupId);
      expect(group, `${groupId} is listed as unreachable but is not an enemy group`).toBeDefined();
      const asset = ASSET_BY_ID.get(group!.assetId) as { impliedWalkMps?: number } | undefined;
      const block = enemyBlockFor(group!.groupId, group!.family, group!.tier);
      const rate = (block?.moveSpeedMps ?? ENEMY_SPEED_MPS) / (asset?.impliedWalkMps ?? 1);
      expect(rate, `${groupId} is now reachable; take it off the list`).toBeGreaterThan(3.2);
    }
  });

  it("never lets a creature outrun the player", () => {
    // 4.2 m/s, from `systems/movement.ts`. `systems/enemyAI.ts` states outright that disengaging by
    // running is meant to be a real option, and the flee half of `npm run lab:creatures` tests
    // exactly that; a creature faster than the player would silently make that test a coin flip.
    const PLAYER_SPEED_MPS = 4.2;
    for (const block of ENEMY_BLOCKS) {
      const speed = block.moveSpeedMps ?? ENEMY_SPEED_MPS;
      expect(speed, `${block.id} pursuit speed`).toBeLessThan(PLAYER_SPEED_MPS);
    }
  });
});
