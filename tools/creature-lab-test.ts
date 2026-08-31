/**
 * Real-Chromium acceptance gate for what a player can DO to a creature, and what it does back.
 *
 * Four interactions, one production boot: aggro, attack, disengage by running, kill, and respawn.
 * `tools/feature-lab-test.ts` proves the lab boots, renders and lands one hit; this proves the
 * creature loop. It is a separate shard because that file is already at its 60-second ceiling and
 * these tests spend most of their time waiting on a 100 ms sim tick rather than on the browser.
 *
 * Nothing here simulates anything. Every actor is a production `SemanticEntity`, every swing goes
 * through `CorealmGameApi`, and `systems/enemyAI.ts` and `systems/combat.ts` own every transition
 * asserted below. The lab only chooses which creature stands where.
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type { FeatureLabCatalog, FeatureLabState } from "../game/src/contracts.js";
import { LEASH_METRES } from "../game/src/systems/enemyAI.js";
import { ENEMY_RESPAWN_MS } from "../game/src/systems/combat.js";
import { installTestDeadline } from "./lib/deadline.js";
import { repoRoot } from "./lib/paths.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

const TOTAL_BUDGET_MS = Number(process.env["CREATURE_LAB_BUDGET_MS"] ?? 120_000);
const READY_BUDGET_MS = 20_000;
const ACTION_BUDGET_MS = 12_000;
const POLL_MS = 40;

/**
 * The three behaviours in `content/enemies.ts`, one representative each, chosen for what they prove
 * rather than for flavour:
 *
 *  - the hen is the smallest aggro radius in the game (3 m), so a spawn at 8 m is unambiguously
 *    outside it and "it did not move" means passive rather than "it had not noticed yet";
 *  - the billy goat is aggressive at 8 m, so the SAME 6 m spawn that leaves a hen idle must make
 *    the goat charge, and the pair is the actual test;
 *  - the cow is territorial with 16 health, the largest tier 1 pool that is not a boss, which
 *    leaves room to provoke it and still run before it dies.
 */
const CREATURES = {
  passive: { presetId: "marchfield_hens", label: "Marchfield Hen", aggroRadius: 3 },
  aggressive: { presetId: "open_march_goats", label: "Open March Billy", aggroRadius: 8 },
  territorial: { presetId: "redsill_cattle", label: "Redsill Cow", aggroRadius: 5 },
  /** 12 health, the largest passive pool in the game. It survives long enough to be seen reacting. */
  tough: { presetId: "blackwater_frogs", label: "Blackwater Frog", aggroRadius: 4 },
} as const;

/** Inside the goat's 8 m radius and well outside the hen's 3 m. One distance, opposite outcomes. */
const AGGRO_PROBE_DISTANCE = 6;

/** A blade, any tier. At the combat level below it kills a tier 1 animal in a swing or two. */
const KILL_WEAPON = /kaldite_sword|corven_sword|grithe_sword/;

/**
 * Combat level for the damage tests, deliberately NOT the lab's default 99.
 *
 * Two reasons, both discovered by this gate failing at 99. `state/store.ts: addSkillXp` clamps xp
 * to `totalXpAt(99)`, so a character already at the cap gains literally nothing from a kill and
 * "did that pay XP?" is unanswerable — the lab sets every skill to 99 during setup. And a level 99 swing one-shots every tier 1 animal, which
 * leaves no tick in which to watch a passive creature decide to fight back.
 */
const COMBAT_TEST_LEVEL = 20;

interface AggroEvidence {
  label: string;
  behaviour: string | undefined;
  aggroRadius: number | undefined;
  spawnedAtMetres: number | undefined;
  observedStates: string[];
  closedDistance: boolean;
  engaged: boolean;
}

interface AttackEvidence {
  label: string;
  weaponId: string | null;
  startedAtFullHealth: boolean;
  health: [number | null | undefined, number | null | undefined];
  combatStarted: [number, number];
  becameAggro: boolean;
  motionAdvanced: boolean;
}

interface FleeEvidence {
  label: string;
  provokedToAggro: boolean;
  maxDistanceFromSpawn: number;
  leashMetres: number;
  chasedPastLeash: boolean;
  observedStates: string[];
  returned: boolean;
  cameHome: boolean;
  finalDistanceFromSpawn: number;
  /** First sample, last sample, and how many distinct distances the walk home produced. */
  returnTrace: [number | null, number | null, number];
}

interface KillEvidence {
  label: string;
  swings: number;
  entityState: string | undefined;
  aiState: string | undefined;
  health: number | null | undefined;
  respawnScheduledMs: number | null;
  expectedRespawnMs: number;
  xpGained: number;
}

interface RespawnEvidence {
  label: string;
  skippedSeconds: number;
  aiState: string | undefined;
  entityState: string | undefined;
  health: number | null | undefined;
  maxHealth: number | null | undefined;
  backAtSpawn: boolean;
  distanceFromSpawn: number;
  respawnCleared: boolean;
}

const started = performance.now();
const clearDeadline = installTestDeadline("creature interaction lab gate", TOTAL_BUDGET_MS);
const screenshotDir = path.join(repoRoot, "test-results", "creature-lab");
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const screenshots: string[] = [];
let server: RunningGameServer | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let stage = "startup";

try {
  await mkdir(screenshotDir, { recursive: true });
  server = await startGameServer({ logLevel: "error" });
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--mute-audio"],
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`[${stage}] ${message.text()}`);
  });
  page.on("pageerror", (error) => pageErrors.push(`[${stage}] ${error.stack ?? error.message}`));

  stage = "boot";
  const url = new URL("/index.html?mode=combat", ensureUrl(server.url));
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: READY_BUDGET_MS });
  if (!response?.ok()) {
    throw new Error(`combat lab returned HTTP ${response?.status() ?? "no response"}: ${url.href}`);
  }
  const ready = await waitForState(page, "combat lab readiness", (state) => (
    state.ready
    && state.engine === "corealm-production"
    && state.mode === "combat"
    && state.target !== null
    && state.playerMotion?.liveRig === true
  ), READY_BUDGET_MS);

  const catalog = await readCatalog(page);
  const presetChecks = Object.fromEntries(
    Object.entries(CREATURES).map(([behaviour, creature]) => [
      behaviour,
      catalog.targets.creature.some((preset) => preset.id === creature.presetId),
    ]),
  );
  const missingPresets = Object.entries(presetChecks)
    .filter(([, present]) => !present)
    .map(([behaviour]) => `${behaviour}:${CREATURES[behaviour as keyof typeof CREATURES].presetId}`);
  if (missingPresets.length > 0) {
    throw new Error(`Feature lab catalog is missing creature presets: ${missingPresets.join(", ")}`);
  }

  const weapon = catalog.equipment
    .find((row) => row.slot === "mainHand")?.items
    .find((item) => KILL_WEAPON.test(item.id))?.id ?? null;
  if (!weapon) throw new Error("Feature lab has no melee weapon to kill with");

  // ---------------------------------------------------------------- 1. aggro
  //
  // Same spawn distance for both, opposite expected outcomes. Running them as a pair is the point:
  // a lone "the goat charged" could be any creature charging, and a lone "the hen did not" could be
  // an AI that never ticked.
  stage = "aggro";
  const aggressiveAggro = await observeAggro(page, CREATURES.aggressive, AGGRO_PROBE_DISTANCE);
  await capture(page, path.join(screenshotDir, "aggro-aggressive.png"));
  const passiveAggro = await observeAggro(page, CREATURES.passive, AGGRO_PROBE_DISTANCE);

  // --------------------------------------------------------------- 2. attack
  //
  // Bare-handed and at a modest level on purpose: a passive creature only reveals itself by what it
  // does AFTER the first hit, and a one-shot kill skips that entirely.
  stage = "attack";
  await setCombatLevels(page, COMBAT_TEST_LEVEL);
  await equipMainHand(page, null);
  const attack = await observeAttack(page, CREATURES.tough);
  await capture(page, path.join(screenshotDir, "attack-melee.png"));

  // ----------------------------------------------------------------- 3. flee
  stage = "flee";
  await equipMainHand(page, weapon);
  const flee = await observeFlee(page, CREATURES.territorial);
  await capture(page, path.join(screenshotDir, "flee-leash.png"));

  // ------------------------------------------------------- 4. kill and respawn
  stage = "kill";
  await equipMainHand(page, weapon);
  const kill = await observeKill(page, CREATURES.passive);
  await capture(page, path.join(screenshotDir, "kill-corpse.png"));

  stage = "respawn";
  const respawn = await observeRespawn(page, CREATURES.passive);
  await capture(page, path.join(screenshotDir, "respawn.png"));

  const final = await readState(page);

  const checks = {
    labBootedProductionCombat: ready.engine === "corealm-production" && ready.mode === "combat",
    everyBehaviourHasAPreset: Object.values(presetChecks).every(Boolean),

    aggressiveChargesUnprovoked: aggressiveAggro.engaged && aggressiveAggro.closedDistance,
    aggressiveReportsItsAuthoredRadius:
      aggressiveAggro.aggroRadius === CREATURES.aggressive.aggroRadius
      && aggressiveAggro.behaviour === "aggressive",
    passiveIgnoresThePlayerAtTheSameDistance: !passiveAggro.engaged,
    passiveReportsItsAuthoredRadius:
      passiveAggro.aggroRadius === CREATURES.passive.aggroRadius
      && passiveAggro.behaviour === "passive",

    attackDamagesTheCreature:
      attack.startedAtFullHealth && numericFell(attack.health)
      && attack.combatStarted[1] > attack.combatStarted[0],
    attackMakesAPassiveFightBack: attack.becameAggro,
    attackPlaysTheSwingAnimation: attack.motionAdvanced,

    fleeIsPrecededByARealChase: flee.provokedToAggro && flee.chasedPastLeash,
    fleeMakesTheCreatureGiveUp: flee.returned,
    fleeSendsItHomeToItsSpawn: flee.cameHome,

    killLeavesACorpse: kill.entityState === "dead" && kill.aiState === "dead" && kill.health === 0,
    killPaysCombatXp: kill.xpGained > 0,
    killSchedulesTheAuthoredRespawn: kill.respawnScheduledMs !== null
      && kill.respawnScheduledMs > kill.expectedRespawnMs * 0.9
      && kill.respawnScheduledMs <= kill.expectedRespawnMs,

    respawnBringsItBackAlive: respawn.aiState === "idle" && respawn.entityState === "alive",
    respawnRestoresFullHealth: respawn.health !== null && respawn.health === respawn.maxHealth,
    respawnPutsItBackAtItsSpawn: respawn.backAtSpawn && respawn.respawnCleared,

    screenshotsCaptured: screenshots.length >= 5,
    noRuntimeErrors: final.errors.length === 0
      && consoleErrors.length === 0 && pageErrors.length === 0,
    withinBudget: performance.now() - started < TOTAL_BUDGET_MS,
  };
  const passed = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({
    passed,
    elapsedMs: Math.round(performance.now() - started),
    url: server.url,
    checks,
    evidence: {
      aggro: { aggressive: aggressiveAggro, passive: passiveAggro },
      attack,
      flee,
      kill,
      respawn,
    },
    screenshots,
    errors: { runtime: final.errors, console: consoleErrors, page: pageErrors },
  }, null, 2));
  process.exitCode = passed ? 0 : 1;
} catch (cause) {
  console.error(JSON.stringify({
    passed: false,
    stage,
    elapsedMs: Math.round(performance.now() - started),
    error: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
    errors: { console: consoleErrors, page: pageErrors },
    screenshots,
  }, null, 2));
  process.exitCode = 1;
} finally {
  clearDeadline();
  await page?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
}

// ------------------------------------------------------------------- the four interactions

/**
 * Spawns one creature at a fixed distance and watches it for a beat WITHOUT touching it.
 *
 * The whole assertion is what happens when the player does nothing, so this deliberately samples
 * over a window rather than reading once: an aggressive creature needs a tick to notice and a few
 * more to cover ground, and reading immediately after the spawn would call every creature idle.
 */
async function observeAggro(
  targetPage: Page,
  creature: { presetId: string; label: string; aggroRadius: number },
  distance: number,
): Promise<AggroEvidence> {
  const spawned = await spawn(targetPage, creature.presetId, distance);
  const spawnedAtMetres = spawned.target?.ai?.distanceFromPlayer;
  const observedStates: string[] = [];
  let closest = spawnedAtMetres ?? Number.POSITIVE_INFINITY;
  let engaged = false;
  const settled = await sample(targetPage, 3_000, (state) => {
    const ai = state.target?.ai;
    if (!ai) return;
    if (observedStates.at(-1) !== ai.state) observedStates.push(ai.state);
    if (ai.state === "aggro") engaged = true;
    closest = Math.min(closest, ai.distanceFromPlayer);
  });
  return {
    label: creature.label,
    behaviour: settled.target?.ai?.behaviour,
    aggroRadius: settled.target?.ai?.aggroRadius,
    spawnedAtMetres,
    observedStates,
    // Half a metre, not zero: an idle creature still drifts a few centimetres as separation and
    // ground snapping settle it, and calling that "closed the distance" would pass on noise.
    closedDistance: spawnedAtMetres !== undefined && closest < spawnedAtMetres - 0.5,
    engaged,
  };
}

/** One swing at a creature that would never have started the fight, and what it costs it. */
async function observeAttack(
  targetPage: Page,
  creature: { presetId: string; label: string },
): Promise<AttackEvidence> {
  const before = await spawn(targetPage, creature.presetId, 6);
  const weaponId = before.equipment.mainHand;
  await perform(targetPage, "attack");
  let motionAdvanced = false;
  let becameAggro = false;
  const after = await waitForState(targetPage, "melee damage on a passive creature", (state) => {
    motionAdvanced ||= motionMoved(before.playerMotion, state.playerMotion)
      && /attack|melee/i.test(state.playerMotion?.clip ?? "");
    becameAggro ||= state.target?.ai?.state === "aggro";
    return state.counters.combatStarted > before.counters.combatStarted
      && healthFell(before, state)
      && motionAdvanced;
  });
  return {
    label: creature.label,
    weaponId,
    startedAtFullHealth: before.target?.health !== null
      && before.target?.health === before.target?.maxHealth,
    health: [before.target?.health, after.target?.health],
    combatStarted: [before.counters.combatStarted, after.counters.combatStarted],
    becameAggro,
    motionAdvanced,
  };
}

/**
 * Provokes a territorial creature, then runs, and follows it all the way home.
 *
 * This is the interaction with the most moving parts and the one most worth having: `enemyAI.ts`
 * claims a player outruns a pursuer (4.2 m/s against about 3.1) and that everything leashes 28 m
 * from its own spawn. Both halves are asserted here from the AI's own runtime rather than inferred
 * from positions, and the creature is followed past "gave up" to "standing where it started".
 */
async function observeFlee(
  targetPage: Page,
  creature: { presetId: string; label: string },
): Promise<FleeEvidence> {
  await spawn(targetPage, creature.presetId, 5);
  await perform(targetPage, "attack");
  const provoked = await waitForState(targetPage, "provoking a territorial creature", (state) => (
    state.target?.ai?.state === "aggro"
  ));

  await perform(targetPage, "flee");
  const observedStates: string[] = [];
  let maxDistanceFromSpawn = provoked.target?.ai?.distanceFromSpawn ?? 0;
  let chasedPastLeash = false;
  let returned = false;
  const chased = await waitForState(targetPage, "creature chases then leashes", (state) => {
    const ai = state.target?.ai;
    if (!ai) return false;
    if (observedStates.at(-1) !== ai.state) observedStates.push(ai.state);
    maxDistanceFromSpawn = Math.max(maxDistanceFromSpawn, ai.distanceFromSpawn);
    // Half a metre of slack. `enemyAI` flips to `returning` on the same tick it passes the leash,
    // so the sample that would read exactly 28 m is the one the AI has already replaced. What is
    // being asserted is "it chased the full leash", not "a poll caught the crossing frame".
    chasedPastLeash ||= ai.distanceFromSpawn >= LEASH_METRES - 0.5;
    returned ||= ai.state === "returning";
    return returned;
  }, ACTION_BUDGET_MS * 2);

  // Walking home is a fixed 3.6 m/s from wherever it gave up, so ~8 s from the leash. Trace the
  // distance rather than only the outcome: "it never arrived" and "it never moved" are different
  // bugs, and the trace is what tells them apart.
  const returnTrace: number[] = [];
  const home = await waitForState(targetPage, "creature walks home and settles", (state) => {
    const ai = state.target?.ai;
    if (!ai) return false;
    if (observedStates.at(-1) !== ai.state) observedStates.push(ai.state);
    if (returnTrace.at(-1) !== ai.distanceFromSpawn) returnTrace.push(ai.distanceFromSpawn);
    return ai.state === "idle" && ai.distanceFromSpawn < 1.5;
  }, ACTION_BUDGET_MS * 3).catch(() => readState(targetPage));

  const finalDistanceFromSpawn = home.target?.ai?.distanceFromSpawn ?? Number.POSITIVE_INFINITY;
  return {
    label: creature.label,
    provokedToAggro: provoked.target?.ai?.state === "aggro",
    maxDistanceFromSpawn: Math.round(maxDistanceFromSpawn * 100) / 100,
    leashMetres: LEASH_METRES,
    chasedPastLeash,
    observedStates,
    returned,
    cameHome: home.target?.ai?.state === "idle" && finalDistanceFromSpawn < 1.5,
    finalDistanceFromSpawn,
    returnTrace: [returnTrace.at(0) ?? null, returnTrace.at(-1) ?? null, returnTrace.length],
  };
}

/** Swings until the health bar reaches zero, and reads what the death left behind. */
async function observeKill(
  targetPage: Page,
  creature: { presetId: string; label: string },
): Promise<KillEvidence> {
  const before = await spawn(targetPage, creature.presetId, 5);
  const xpBefore = await readCombatXp(targetPage);
  let swings = 0;
  let state = before;
  // Auto-attack keeps swinging on its own; re-issuing covers the case where the creature stepped
  // out of reach between ticks and the player gave up pursuing.
  while (state.target?.state !== "dead" && swings < 12) {
    await perform(targetPage, "attack");
    swings += 1;
    state = await waitForState(targetPage, "creature dies", (next) => (
      next.target?.state === "dead" || next.target?.ai?.state === "dead"
    ), 4_000).catch(() => readState(targetPage));
  }
  const dead = await waitForState(targetPage, "death is committed to the runtime", (next) => (
    next.target?.ai?.state === "dead" && next.target?.ai?.respawnInMs !== null
  ), ACTION_BUDGET_MS).catch(() => state);
  return {
    label: creature.label,
    swings,
    entityState: dead.target?.state,
    aiState: dead.target?.ai?.state,
    health: dead.target?.health,
    respawnScheduledMs: dead.target?.ai?.respawnInMs ?? null,
    expectedRespawnMs: ENEMY_RESPAWN_MS,
    xpGained: (await readCombatXp(targetPage)) - xpBefore,
  };
}

/**
 * Skips the sim clock past the corpse timer and waits for the creature to stand back up.
 *
 * `__gameDebug.advanceGameTime` jumps `SimClock.elapsedMs` without simulating the frames between,
 * which is exactly right here: `enemyAI.respawnDead` compares the deadline against the clock on its
 * next ordinary tick, so the respawn that follows is the production one and not a forced reset.
 */
async function observeRespawn(
  targetPage: Page,
  creature: { presetId: string; label: string },
): Promise<RespawnEvidence> {
  const skippedSeconds = Math.ceil(ENEMY_RESPAWN_MS / 1_000) + 1;
  await targetPage.evaluate((seconds) => {
    const debug = (window as unknown as {
      __gameDebug?: { advanceGameTime?: (value: number) => void };
    }).__gameDebug;
    if (!debug?.advanceGameTime) throw new Error("__gameDebug.advanceGameTime is unavailable");
    debug.advanceGameTime(seconds);
  }, skippedSeconds);

  const alive = await waitForState(targetPage, "creature respawns", (state) => (
    state.target?.ai?.state === "idle" && state.target?.state === "alive"
  ), ACTION_BUDGET_MS);
  const ai = alive.target?.ai;
  return {
    label: creature.label,
    skippedSeconds,
    aiState: ai?.state,
    entityState: alive.target?.state,
    health: alive.target?.health,
    maxHealth: alive.target?.maxHealth,
    backAtSpawn: (ai?.distanceFromSpawn ?? Number.POSITIVE_INFINITY) < 0.5,
    distanceFromSpawn: ai?.distanceFromSpawn ?? Number.POSITIVE_INFINITY,
    respawnCleared: ai?.respawnInMs === null,
  };
}

// ------------------------------------------------------------------------------ browser helpers

async function spawn(targetPage: Page, presetId: string, distance: number): Promise<FeatureLabState> {
  await targetPage.evaluate(async ({ id, metres }) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.spawnTarget("creature", id, { distance: metres });
  }, { id: presetId, metres: distance });
  // The AI registers the creature on its next tick, so its runtime is not readable the instant the
  // spawn resolves. Waiting for it here keeps every caller from re-deriving that.
  return waitForState(targetPage, `creature ${presetId} enters the simulation`, (state) => (
    state.target?.presetId === presetId && state.target?.ai !== null
  ));
}

async function perform(targetPage: Page, action: "attack" | "cast" | "flee" | "reset-player"): Promise<void> {
  await targetPage.evaluate(async (value) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform(value as never);
  }, action);
}

/** Drops the two combat skills off the lab's default 99 so damage and XP are both observable. */
async function setCombatLevels(targetPage: Page, level: number): Promise<void> {
  await targetPage.evaluate((value) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    for (const skill of ["melee", "magic"] as const) api.setLevel(skill, value);
  }, level);
}

async function equipMainHand(targetPage: Page, itemId: string | null): Promise<void> {
  await targetPage.evaluate(async (value) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.equipPlayer("mainHand", value as never);
  }, itemId);
}

async function readState(targetPage: Page): Promise<FeatureLabState> {
  return targetPage.evaluate(() => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    return api.getState();
  });
}

async function readCatalog(targetPage: Page): Promise<FeatureLabCatalog> {
  return targetPage.evaluate(() => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    return api.getCatalog();
  });
}

async function waitForState(
  targetPage: Page,
  label: string,
  predicate: (state: FeatureLabState) => boolean,
  timeoutMs = ACTION_BUDGET_MS,
): Promise<FeatureLabState> {
  const deadline = performance.now() + timeoutMs;
  let state: FeatureLabState | null = null;
  let lastReadError: string | null = null;
  while (performance.now() < deadline) {
    try {
      state = await readState(targetPage);
      lastReadError = null;
      if (predicate(state)) return state;
    } catch (cause) {
      lastReadError = cause instanceof Error ? cause.message : String(cause);
    }
    await targetPage.waitForTimeout(POLL_MS);
  }
  throw new Error(
    `${label} did not complete in ${timeoutMs}ms; last target: ${JSON.stringify(state?.target ?? null)}; `
    + `last read error: ${lastReadError ?? "none"}`,
  );
}

/** Polls for a fixed window and returns the final state. Used when NOT happening is the assertion. */
async function sample(
  targetPage: Page,
  windowMs: number,
  observe: (state: FeatureLabState) => void,
): Promise<FeatureLabState> {
  const deadline = performance.now() + windowMs;
  let state = await readState(targetPage);
  observe(state);
  while (performance.now() < deadline) {
    await targetPage.waitForTimeout(POLL_MS);
    state = await readState(targetPage);
    observe(state);
  }
  return state;
}

async function capture(targetPage: Page, filePath: string): Promise<void> {
  await targetPage.screenshot({ path: filePath, animations: "disabled", timeout: 5_000 });
  screenshots.push(path.relative(repoRoot, filePath));
}

/**
 * Combat XP straight out of the store, via `__gameDebug`.
 *
 * `FeatureLabState.levels` cannot answer this: the lab sets every skill to 99 during setup, so a
 * kill that pays XP moves no level and the lab's own view of skills does not change at all.
 */
async function readCombatXp(targetPage: Page): Promise<number> {
  return targetPage.evaluate(() => {
    const debug = (window as unknown as {
      __gameDebug?: { getState?: () => { skills?: Record<string, { xp?: number }> } };
    }).__gameDebug;
    const skills = debug?.getState?.().skills;
    if (!skills) throw new Error("__gameDebug.getState().skills is unavailable");
    return ["melee", "magic"].reduce((total, id) => total + (skills[id]?.xp ?? 0), 0);
  });
}

function healthFell(before: FeatureLabState, after: FeatureLabState): boolean {
  return numericFell([before.target?.health, after.target?.health]);
}

function numericFell(pair: [number | null | undefined, number | null | undefined]): boolean {
  const [before, after] = pair;
  return typeof before === "number" && typeof after === "number" && after < before;
}

function motionMoved(
  before: FeatureLabState["playerMotion"],
  after: FeatureLabState["playerMotion"],
): boolean {
  if (!before || !after) return false;
  if (after.clip !== before.clip) return true;
  return typeof before.time === "number" && typeof after.time === "number"
    && Math.abs(after.time - before.time) > 1e-3;
}

function ensureUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
