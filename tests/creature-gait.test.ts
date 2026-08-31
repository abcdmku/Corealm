import { describe, expect, it } from "vitest";
import { ENEMY_BLOCKS, enemyBlockFor } from "../game/src/content/enemies.js";
import { REGIONS } from "../game/src/content/regions.js";
import { ENEMY_SPEED_MPS } from "../game/src/systems/enemyAI.js";
import MANIFEST from "../game/public/assets/manifest.json" with { type: "json" };

/**
 * A creature's authored speed and its walk cycle have to agree, or it looks wrong — and there are
 * TWO ways to look wrong, which is the thing this file exists to remember.
 *
 * Too slow a playback rate and the feet slide: the cycle covers less ground than the body does.
 * `render/entityViews.ts: motionTimeScale` divides `moveSpeedMps` by the speed the cycle implies to
 * close that, and skipping it entirely is what left the orb bosses at 61% slide.
 *
 * Too HIGH a rate and the legs race, which is the failure that reads worse and the one that was
 * shipped. Driving slide to zero means cranking the rate, so a roster tuned only against slide ends
 * up with a coney completing 3.94 leg cycles a second, a frog 3.62 and a goat 3.35 — every one of
 * them at 0% slide, and every one reported from play as "their feet move rapidly and they are
 * jittery". Both halves of that report are the same cause: at 3.9 Hz, 60 fps leaves fifteen frames
 * to draw a whole cycle and the legs snap between poses instead of sweeping.
 *
 * So the invariant is on CADENCE, in cycles per second, which is what the eye judges and which a
 * rate ceiling cannot express — the same rate is 3.4 Hz on the goat's 0.47 s cycle and 1.2 Hz on
 * the hog's 1.33 s one.
 */

const ASSET_BY_ID = new Map(MANIFEST.assets.map((asset) => [asset.id, asset] as const));

/** `MAX_WALK_CADENCE_HZ` in `render/entityViews.ts`. Duplicated so a change there has to be meant. */
const MAX_WALK_CADENCE_HZ = 2.4;
/** Assertion messages join on this. */
const NEWLINE = String.fromCharCode(10);
/** `WALK_RATE_MIN` and `WALK_RATE_MAX`, same reasoning. */
const WALK_RATE_MIN = 0.6;
const WALK_RATE_MAX = 3.2;

interface Gait {
  groupId: string;
  assetId: string;
  impliedWalkMps: number;
  walkClipSeconds: number;
  moveSpeedMps: number;
  /** The rate the renderer will actually apply, both clamps included. */
  rate: number;
  /** Leg cycles per second at that rate. */
  cadenceHz: number;
  slide: number;
}

/** Every creature whose rig has a stride worth matching, with the numbers the renderer will use. */
function measurableGaits(): Gait[] {
  const out: Gait[] = [];
  for (const group of GROUPS) {
    const asset = ASSET_BY_ID.get(group.assetId) as
      { impliedWalkMps?: number; walkClipSeconds?: number } | undefined;
    const implied = asset?.impliedWalkMps;
    const clip = asset?.walkClipSeconds;
    const block = enemyBlockFor(group.groupId, group.family, group.tier);
    if (implied === undefined || clip === undefined || clip <= 0) continue;
    if (implied < MEASURABLE_STRIDE_MPS) continue;
    const speed = block?.moveSpeedMps ?? ENEMY_SPEED_MPS;
    const rate = Math.min(
      Math.min(WALK_RATE_MAX, Math.max(WALK_RATE_MIN, speed / implied)),
      MAX_WALK_CADENCE_HZ * clip,
    );
    out.push({
      groupId: group.groupId,
      assetId: group.assetId,
      impliedWalkMps: implied,
      walkClipSeconds: clip,
      moveSpeedMps: speed,
      rate,
      cadenceHz: rate / clip,
      slide: Math.abs(1 - (implied * rate) / speed),
    });
  }
  return out;
}

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

  it("never lets any creature's legs race", () => {
    // THE regression. Cadence, not rate, because the same rate is a different cadence on a
    // different clip, and cadence is what a player sees.
    const racing = measurableGaits()
      .filter((gait) => gait.cadenceHz > MAX_WALK_CADENCE_HZ + 1e-6)
      .map((gait) => `${gait.groupId} runs its cycle at ${gait.cadenceHz.toFixed(2)} Hz`);
    expect(racing, racing.join(NEWLINE)).toEqual([]);
  });

  it("tunes speeds so the cadence cap never has to bite", () => {
    // The cap is a safety net. If it is doing the work, a creature is authored faster than its own
    // gait supports and the cap is buying smooth legs by paying in foot slide — the same bad trade
    // as before, in the other direction. The fix when this fails is to lower `moveSpeedMps` to
    // `MAX_WALK_CADENCE_HZ * impliedWalkMps * walkClipSeconds`, not to raise the cap.
    const clamped = measurableGaits()
      .filter((gait) => !UNREACHABLE_RATE.has(gait.groupId))
      .filter((gait) => gait.slide > 0.05)
      .map((gait) => {
        const supported = MAX_WALK_CADENCE_HZ * gait.impliedWalkMps * gait.walkClipSeconds;
        return `${gait.groupId} is authored at ${gait.moveSpeedMps} m/s but its cycle supports`
          + ` ${supported.toFixed(2)} m/s, so it slides ${Math.round(gait.slide * 100)}%`;
      });
    expect(clamped, clamped.join(NEWLINE)).toEqual([]);
  });

  it("keeps a cadence that reads as an animal rather than a machine", () => {
    // A floor as well as a ceiling. Real quadruped walks and trots sit between about 1.5 and 2.5 Hz,
    // and a creature crawling along at half a cycle a second reads as slow motion just as badly as
    // one at four reads as sped-up film.
    for (const gait of measurableGaits()) {
      expect(gait.cadenceHz, `${gait.groupId} cadence`).toBeGreaterThan(1);
      expect(gait.cadenceHz, `${gait.groupId} cadence`).toBeLessThanOrEqual(MAX_WALK_CADENCE_HZ + 1e-6);
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
