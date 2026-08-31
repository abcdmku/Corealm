import { describe, expect, it } from "vitest";
import { ENEMY_BLOCKS, enemyBlockFor } from "../game/src/content/enemies.js";
import { REGIONS } from "../game/src/content/regions.js";
import { ENEMY_RETURN_SPEED_MPS, ENEMY_SPEED_MPS } from "../game/src/systems/enemyAI.js";
import { MOVING_EPSILON } from "../game/src/render/entityViews.js";
import { SIM_TICK_MS } from "../game/src/core/time.js";
import MANIFEST from "../game/public/assets/manifest.json" with { type: "json" };

/**
 * A creature's speed and the cycle it is playing have to be the same gait, or it looks wrong.
 *
 * THREE ways to look wrong, and this file exists because the first two were each fixed in a way
 * that caused the next.
 *
 * Too slow a playback rate and the feet slide. `render/entityViews.ts: motionTimeScale` divides the
 * creature's speed by the speed its cycle implies to close that, and skipping it is what left the
 * orb bosses at 61% slide.
 *
 * Too HIGH a rate and the legs race. Driving slide to zero means cranking the rate, so a roster
 * tuned only against slide reached three and four leg cycles a second at 0% slide.
 *
 * And underneath both: the WRONG CLIP. Every creature used to play its RUN cycle while walking,
 * because the catalog mapped `_Run` to "Walk" for the whole pack. A gallop is a gallop at any
 * playback rate, so no amount of retiming could fix it and both of the fixes above were rearranging
 * timing on top of the wrong poses. Each creature now ships both cycles and the renderer picks by
 * whether it is pursuing, so each gait is checked against its own speed here.
 */

const ASSET_BY_ID = new Map(MANIFEST.assets.map((asset) => [asset.id, asset] as const));

/** `MAX_WALK_CADENCE_HZ` in `render/entityViews.ts`. Duplicated so a change there has to be meant. */
const MAX_WALK_CADENCE_HZ = 2.4;
/**
 * `MAX_RUN_CADENCE_HZ` there, same reasoning. Separate from the walk cap because a gallop
 * legitimately cycles faster than any walk; sharing 2.4 forced pursuit speeds to sit exactly on
 * the cap and left a leash return (1.16x pursuit) with its legs shaved 14% under the ground.
 */
const MAX_RUN_CADENCE_HZ = 3.0;
/** `returnSpeed` in `systems/enemyAI.ts`: a leashed creature hurries home at this multiple. */
const RETURN_SPEED_RATIO = ENEMY_RETURN_SPEED_MPS / ENEMY_SPEED_MPS;
/** `WALK_RATE_MIN` and `WALK_RATE_MAX`, same reasoning. */
const WALK_RATE_MIN = 0.6;
const WALK_RATE_MAX = 3.2;
/** Assertion messages join on this. */
const NEWLINE = String.fromCharCode(10);

/**
 * Below this the rig has no stride worth matching and the clamp owns it.
 *
 * A viper measures hundredths of a metre per second and a rat 0.06: a snake glides and a rodent
 * scuttles, neither plants a foot the eye can follow, so no playback rate fixes them and none is
 * demanded here.
 */
const MEASURABLE_STRIDE_MPS = 0.15;

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

interface Gait {
  groupId: string;
  gait: "walk" | "run" | "return";
  impliedMps: number;
  clipSeconds: number;
  speedMps: number;
  /** The rate the renderer will actually apply, both clamps included. */
  rate: number;
  cadenceHz: number;
  /** The ceiling this gait plays under. Runs and returns get the run cap. */
  capHz: number;
  slide: number;
}

/**
 * Every creature gait with a stride worth matching, carrying the numbers the renderer will use.
 *
 * A creature contributes up to two rows, one per cycle it ships. Anything whose rig has no run
 * cycle contributes only a walk, and pursues on it.
 */
function gaits(): Gait[] {
  const out: Gait[] = [];
  for (const group of GROUPS) {
    const asset = ASSET_BY_ID.get(group.assetId) as {
      impliedWalkMps?: number; walkClipSeconds?: number;
      impliedRunMps?: number; runClipSeconds?: number;
    } | undefined;
    const block = enemyBlockFor(group.groupId, group.family, group.tier);
    if (!asset || !block) continue;
    const pursuit = block.moveSpeedMps ?? ENEMY_SPEED_MPS;
    const rows: [Gait["gait"], number | undefined, number | undefined, number][] = [
      ["walk", asset.impliedWalkMps, asset.walkClipSeconds, block.walkSpeedMps ?? 0],
      ["run", asset.impliedRunMps, asset.runClipSeconds, pursuit],
      // The third speed every creature actually moves at: hurrying home after a leash. The
      // renderer retimes it off the published live gait speed, so it plays under the same rate
      // and cadence clamps as the pursuit and has to satisfy the same assertions.
      ["return", asset.impliedRunMps, asset.runClipSeconds, pursuit * RETURN_SPEED_RATIO],
    ];
    for (const [gait, implied, clip, speed] of rows) {
      if (implied === undefined || clip === undefined || clip <= 0) continue;
      if (implied < MEASURABLE_STRIDE_MPS || speed <= 0) continue;
      const capHz = gait === "walk" ? MAX_WALK_CADENCE_HZ : MAX_RUN_CADENCE_HZ;
      const rate = Math.min(
        Math.min(WALK_RATE_MAX, Math.max(WALK_RATE_MIN, speed / implied)),
        capHz * clip,
      );
      out.push({
        groupId: group.groupId,
        gait,
        impliedMps: implied,
        clipSeconds: clip,
        speedMps: speed,
        rate,
        cadenceHz: rate / clip,
        capHz,
        slide: Math.abs(1 - (implied * rate) / speed),
      });
    }
  }
  return out;
}

describe("creature gait", () => {
  it("ships a real walk cycle for everything that walks", () => {
    // The defect underneath all of this. The pack ships a `_Walk` for every animal and the catalog
    // used the `_Run` instead, so the whole roster walked with a running gait.
    const missing = GROUPS
      .filter((group) => /^animal_/.test(group.assetId))
      .filter((group) => {
        const asset = ASSET_BY_ID.get(group.assetId) as { animations?: string[] } | undefined;
        return !asset?.animations?.some((name) => /^walk$/i.test(name));
      })
      .map((group) => `${group.groupId} (${group.assetId}) has no Walk clip`);
    expect([...new Set(missing)], missing.join(NEWLINE)).toEqual([]);
  });

  it("gives every creature with a measurable stride an authored speed for that gait", () => {
    const offenders: string[] = [];
    for (const group of GROUPS) {
      const asset = ASSET_BY_ID.get(group.assetId) as { impliedWalkMps?: number } | undefined;
      const implied = asset?.impliedWalkMps;
      if (implied === undefined || implied < MEASURABLE_STRIDE_MPS) continue;
      const block = enemyBlockFor(group.groupId, group.family, group.tier);
      if (block?.moveSpeedMps === undefined) {
        offenders.push(`${group.groupId} has no moveSpeedMps, so it pursues at the shared default`);
      }
      if (block?.walkSpeedMps === undefined) {
        offenders.push(`${group.groupId} has no walkSpeedMps, so it potters at a pursuit speed`);
      }
    }
    expect(offenders, offenders.join(NEWLINE)).toEqual([]);
  });

  it("never lets any creature's legs race, in either gait", () => {
    const racing = gaits()
      .filter((row) => row.cadenceHz > row.capHz + 1e-6)
      .map((row) => `${row.groupId} ${row.gait} runs at ${row.cadenceHz.toFixed(2)} Hz`);
    expect(racing, racing.join(NEWLINE)).toEqual([]);
  });

  it("keeps the feet planted in either gait", () => {
    // Both failure modes at once: with each cycle paired to its own speed, neither clamp should be
    // doing any work, so slide should be essentially zero everywhere it can be measured.
    const sliding = gaits()
      .filter((row) => row.slide > 0.05)
      .map((row) => `${row.groupId} ${row.gait} slides ${Math.round(row.slide * 100)}% `
        + `(${row.speedMps} m/s against a cycle implying ${row.impliedMps})`);
    expect(sliding, sliding.join(NEWLINE)).toEqual([]);
  });

  it("keeps a cadence that reads as an animal rather than a machine", () => {
    // A floor as well as a ceiling: half a cycle a second is slow motion just as badly as four is
    // sped-up film. A walk sits near 1 Hz and a run near 2, which is what these bounds allow.
    for (const row of gaits()) {
      expect(row.cadenceHz, `${row.groupId} ${row.gait} cadence`).toBeGreaterThan(0.6);
      expect(row.cadenceHz, `${row.groupId} ${row.gait} cadence`)
        .toBeLessThanOrEqual(row.capHz + 1e-6);
    }
  });

  it("potters more slowly than it pursues", () => {
    // A creature whose amble is as fast as its charge has nothing left to escalate to, and the two
    // gaits stop being distinguishable to a player.
    for (const block of ENEMY_BLOCKS) {
      if (block.walkSpeedMps === undefined || block.moveSpeedMps === undefined) continue;
      expect(block.walkSpeedMps, `${block.id} walk vs pursuit`)
        .toBeLessThanOrEqual(block.moveSpeedMps);
    }
  });

  it("moves far enough per tick for the renderer to notice", () => {
    // `render/entityViews.ts: updateMoving` treats anything under `MOVING_EPSILON` between syncs as
    // standing still, and `syncMotion` only advances a record's drawn target inside that same test.
    // A creature slower than one epsilon per sim tick therefore does not merely animate late — its
    // drawn position advances in doubled jumps and its motion flips walk-idle-walk around each one,
    // crossfading a fresh action from zero every time. Reported as "the animation resets many many
    // times a second", and caused by pottering speeds dropping to what the walk cycles depict.
    const tickSeconds = SIM_TICK_MS / 1000;
    const offenders: string[] = [];
    for (const block of ENEMY_BLOCKS) {
      for (const [gait, speed] of [["walk", block.walkSpeedMps], ["run", block.moveSpeedMps]] as const) {
        if (speed === undefined) continue;
        const perTick = speed * tickSeconds;
        if (perTick <= MOVING_EPSILON) {
          offenders.push(
            `${block.id} ${gait} covers ${(perTick * 100).toFixed(1)} cm per tick, at or under the`
            + ` ${(MOVING_EPSILON * 100).toFixed(1)} cm the renderer needs to call it moving`,
          );
        }
      }
    }
    expect(offenders, offenders.join(NEWLINE)).toEqual([]);
  });

  it("keeps a real margin under the slowest gait, not a coincidental one", () => {
    // Sitting just barely above the threshold is the same bug waiting for the next speed change.
    const tickSeconds = SIM_TICK_MS / 1000;
    const speeds = ENEMY_BLOCKS.flatMap((block) =>
      [block.walkSpeedMps, block.moveSpeedMps].filter((s): s is number => s !== undefined));
    const slowestPerTick = Math.min(...speeds) * tickSeconds;
    expect(
      slowestPerTick / MOVING_EPSILON,
      `slowest gait is only ${(slowestPerTick / MOVING_EPSILON).toFixed(1)}x the movement threshold`,
    ).toBeGreaterThan(3);
  });

  it("never lets a creature outrun the player", () => {
    // 4.2 m/s, from `systems/movement.ts`. `systems/enemyAI.ts` states outright that disengaging by
    // running is meant to be a real option, and the flee half of `npm run lab:creatures` tests it.
    const PLAYER_SPEED_MPS = 4.2;
    for (const block of ENEMY_BLOCKS) {
      const speed = block.moveSpeedMps ?? ENEMY_SPEED_MPS;
      expect(speed, `${block.id} pursuit speed`).toBeLessThan(PLAYER_SPEED_MPS);
    }
  });
});
