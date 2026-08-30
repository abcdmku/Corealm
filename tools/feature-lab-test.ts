/**
 * Fast browser acceptance gate for the real-engine actor lab.
 *
 * Setup uses the narrow FeatureLabApi. Gameplay proof deliberately does not: target selection and
 * movement are driven through real pointer input on the production canvas.
 */
import { chromium, type Page } from "playwright";
import {
  EQUIP_SLOTS,
  SKILL_IDS,
  type EquipSlot,
  type FeatureLabCatalog,
  type FeatureLabState,
  type ItemId,
} from "../game/src/contracts.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue } from "./lib/paths.js";

const TOTAL_BUDGET_MS = 45_000;
const READY_BUDGET_MS = 15_000;
const ACTION_BUDGET_MS = 8_000;
const POLL_MS = 50;

interface Point {
  x: number;
  y: number;
}

interface CanvasBox extends Point {
  width: number;
  height: number;
}

interface EquipmentProof {
  slot: EquipSlot;
  itemId: ItemId;
}

interface PickerProof {
  slot: EquipSlot;
  expected: string[];
  actual: string[];
}

interface ActionProof {
  before: FeatureLabState;
  after: FeatureLabState;
  sawParticles?: boolean;
}

const started = performance.now();
const clearDeadline = installTestDeadline("real-engine feature lab gate", TOTAL_BUDGET_MS);
const baseUrl = argValue(process.argv.slice(2), "--base") ?? "http://127.0.0.1:4174";
const labUrl = new URL("/game/index.html?mode=actors", ensureUrl(baseUrl));
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));

let lastState: FeatureLabState | null = null;

try {
  const response = await page.goto(labUrl.href, {
    waitUntil: "domcontentloaded",
    timeout: READY_BUDGET_MS,
  });
  if (!response?.ok()) {
    throw new Error(`Feature lab returned HTTP ${response?.status() ?? "no response"}: ${labUrl.href}`);
  }

  const ready = await waitForState(page, "production feature lab readiness", (state) => (
    state.ready
    && state.engine === "corealm-production"
    && state.world === "empty-flat"
    && state.target !== null
    && state.target.screen !== null
  ), READY_BUDGET_MS);
  lastState = ready;
  const catalog = await readCatalog(page);
  const catalogChecks = validateCatalog(catalog);

  // Every skill and equipment slot is configured through the setup API. Equipping still uses the
  // production InventorySystem and EquipmentSystem in the browser; this merely avoids 99 UI clicks.
  const levels = await page.evaluate((skillIds) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    for (const skillId of skillIds) api.setLevel(skillId, 99);
    return api.getState();
  }, [...SKILL_IDS]);
  const levelChecks = Object.fromEntries(
    SKILL_IDS.map((skillId) => [skillId, levels.levels[skillId] === 99]),
  );

  const equipmentProof: EquipmentProof[] = [];
  for (const group of catalog.equipment) {
    const item = group.items.at(-1);
    if (!item) continue;
    const state = await page.evaluate(async ({ slot, itemId }) => {
      const api = window.__featureLab;
      if (!api) throw new Error("window.__featureLab is unavailable");
      return api.equipPlayer(slot, itemId);
    }, { slot: group.slot, itemId: item.id });
    if (state.equipment[group.slot] === item.id) {
      equipmentProof.push({ slot: group.slot, itemId: item.id });
    }
  }

  // Fresh low-tier creature, then a literal pointer click at the renderer-published screen point.
  const creaturePreset = catalog.targets.creature[0];
  if (!creaturePreset) throw new Error("Feature lab has no creature presets");
  const targetBase = await page.evaluate(async ({ id }) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("reset-player");
    return api.spawnTarget("creature", id);
  }, { id: creaturePreset.id });
  lastState = targetBase;
  const canvas = page.locator("#viewport");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Production canvas has no visible bounds");
  const targetPoint = screenPoint(targetBase, canvasBox);
  await page.mouse.click(targetPoint.x, targetPoint.y);

  let targetPathObserved = false;
  const targetClicked = await waitForState(page, "pointer target selection and navigation", (state) => {
    targetPathObserved ||= state.movement.mode !== "idle";
    return state.selectedEntityId === targetBase.target?.entityId
      && state.counters.navigationStarted > targetBase.counters.navigationStarted
      && (targetPathObserved
        || state.counters.navigationCompleted > targetBase.counters.navigationCompleted);
  });
  lastState = targetClicked;

  // Click bare ground through that same canvas and prove the player's semantic position changes.
  const groundBefore = await page.evaluate(async () => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    return api.perform("reset-player");
  });
  const groundPoint = chooseGroundPoint(canvasBox, targetPoint);
  await page.mouse.click(groundPoint.x, groundPoint.y);
  let groundPathObserved = false;
  const groundMoved = await waitForState(page, "canvas ground-click movement", (state) => {
    groundPathObserved ||= state.movement.mode !== "idle";
    return state.counters.navigationStarted > groundBefore.counters.navigationStarted
      && distanceXZ(groundBefore.playerPosition, state.playerPosition) >= 0.15
      && (groundPathObserved
        || state.counters.navigationCompleted > groundBefore.counters.navigationCompleted);
  });
  lastState = groundMoved;

  // Use a fresh target for each real combat path so a click-to-attack cannot consume the health
  // evidence intended for the explicit attack/cast controls.
  const meleeWeapon = findItem(catalog, "mainHand", /sword|blade|axe|mace/i);
  if (meleeWeapon) {
    await page.evaluate(async (itemId) => {
      const api = window.__featureLab;
      if (!api) throw new Error("window.__featureLab is unavailable");
      await api.equipPlayer("mainHand", itemId);
    }, meleeWeapon);
  }
  const meleeBefore = await page.evaluate(async ({ id }) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("reset-player");
    return api.spawnTarget("creature", id);
  }, { id: creaturePreset.id });
  await page.evaluate(async () => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("attack");
  });
  const meleeAfter = await waitForState(page, "production melee hit", (state) => (
    state.counters.combatStarted > meleeBefore.counters.combatStarted
    && healthFell(meleeBefore, state)
  ));
  const melee: ActionProof = { before: meleeBefore, after: meleeAfter };
  lastState = meleeAfter;

  const magicWeapon = findItem(catalog, "mainHand", /staff|wand|focus/i);
  if (magicWeapon) {
    await page.evaluate(async (itemId) => {
      const api = window.__featureLab;
      if (!api) throw new Error("window.__featureLab is unavailable");
      await api.equipPlayer("mainHand", itemId);
    }, magicWeapon);
  }
  const spell = catalog.spells.at(-1);
  if (!spell) throw new Error("Feature lab has no spell presets");
  const castBefore = await page.evaluate(async ({ targetId, spellId }) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("reset-player");
    await api.spawnTarget("creature", targetId);
    api.setSpell(spellId);
    return api.getState();
  }, { targetId: creaturePreset.id, spellId: spell.id });
  await page.evaluate(async () => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("cast");
  });
  let sawParticles = false;
  const castAfter = await waitForState(page, "production spell launch and hit", (state) => {
    sawParticles ||= state.liveSpellParticles > 0;
    return state.counters.spellLaunched > castBefore.counters.spellLaunched
      && sawParticles
      && healthFell(castBefore, state);
  });
  const cast: ActionProof = { before: castBefore, after: castAfter, sawParticles };
  lastState = castAfter;

  // Open the real in-game Worn panel. Every slot must expose exactly its catalog (plus None), and
  // an actual picker click must flow back through the production equipment state.
  await page.keyboard.press("e");
  const equipmentPanel = page.locator("#panel-equipment");
  await equipmentPanel.waitFor({ state: "visible", timeout: 2_000 });
  const pickerProof: PickerProof[] = [];
  for (const group of catalog.equipment) {
    await equipmentPanel.locator(`[data-equip-slot="${group.slot}"]`).click();
    const chooser = equipmentPanel.locator(".equip-chooser:not([hidden])");
    await chooser.waitFor({ state: "visible", timeout: 1_000 });
    const actual = await chooser.locator("[data-equipment-item]").evaluateAll((nodes) => (
      nodes.map((node) => (node as HTMLElement).dataset["equipmentItem"] ?? "<missing>")
    ));
    pickerProof.push({
      slot: group.slot,
      expected: ["", ...group.items.map((item) => item.id)],
      actual,
    });
  }

  const mainHandGroup = catalog.equipment.find((group) => group.slot === "mainHand");
  const uiItem = mainHandGroup?.items[0];
  if (!uiItem) throw new Error("Main-hand picker has no production items");
  await equipmentPanel.locator('[data-equip-slot="mainHand"]').click();
  await equipmentPanel.locator('[data-equipment-item=""]').click();
  await waitForState(page, "Worn-panel unequip", (state) => state.equipment.mainHand === null, 2_000);
  await equipmentPanel.locator(`[data-equipment-item="${uiItem.id}"]`).click();
  const uiEquipped = await waitForState(
    page,
    "Worn-panel equipment selection",
    (state) => state.equipment.mainHand === uiItem.id,
    2_000,
  );
  lastState = uiEquipped;
  const gridItem = await equipmentPanel.locator('[data-equip-slot="mainHand"]').getAttribute("data-item");

  const checks = {
    realEngineEmptyWorld: ready.ready
      && ready.engine === "corealm-production"
      && ready.world === "empty-flat",
    catalogsAreComplete: Object.values(catalogChecks).every(Boolean),
    everyLevelCanBeSet: Object.values(levelChecks).every(Boolean),
    everyEquipmentSlotEquips: equipmentProof.length === EQUIP_SLOTS.length
      && sameMembers(equipmentProof.map((row) => row.slot), [...EQUIP_SLOTS]),
    monsterCanvasClickSelects: targetClicked.selectedEntityId === targetBase.target?.entityId,
    monsterCanvasClickNavigates: targetClicked.counters.navigationStarted > targetBase.counters.navigationStarted
      && (targetPathObserved
        || targetClicked.counters.navigationCompleted > targetBase.counters.navigationCompleted),
    groundCanvasClickRuns: distanceXZ(groundBefore.playerPosition, groundMoved.playerPosition) >= 0.15
      && groundMoved.counters.navigationStarted > groundBefore.counters.navigationStarted,
    realMeleeDamagesTarget: melee.after.counters.combatStarted > melee.before.counters.combatStarted
      && healthFell(melee.before, melee.after),
    realSpellLaunchesParticlesAndDamages: cast.after.counters.spellLaunched > cast.before.counters.spellLaunched
      && cast.sawParticles === true
      && healthFell(cast.before, cast.after),
    productionWornPickerCatalogs: pickerProof.length === EQUIP_SLOTS.length
      && pickerProof.every((proof) => sameMembers(proof.actual, proof.expected)),
    productionWornPickerEquips: uiEquipped.equipment.mainHand === uiItem.id
      && gridItem === uiItem.id,
    noRuntimeErrors: lastState.errors.length === 0
      && consoleErrors.length === 0
      && pageErrors.length === 0,
    under45Seconds: performance.now() - started < TOTAL_BUDGET_MS,
  };
  const passed = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({
    passed,
    elapsedMs: Math.round(performance.now() - started),
    url: labUrl.href,
    checks,
    catalogChecks,
    levelChecks,
    evidence: {
      targetPointer: {
        presetId: creaturePreset.id,
        entityId: targetBase.target?.entityId,
        screen: targetBase.target?.screen,
        click: targetPoint,
        selectedEntityId: targetClicked.selectedEntityId,
        navigationStarted: [targetBase.counters.navigationStarted, targetClicked.counters.navigationStarted],
        navigationCompleted: [targetBase.counters.navigationCompleted, targetClicked.counters.navigationCompleted],
      },
      groundPointer: {
        click: groundPoint,
        before: groundBefore.playerPosition,
        after: groundMoved.playerPosition,
      },
      melee: {
        health: [melee.before.target?.health, melee.after.target?.health],
        combatStarted: [melee.before.counters.combatStarted, melee.after.counters.combatStarted],
      },
      cast: {
        spellId: spell.id,
        health: [cast.before.target?.health, cast.after.target?.health],
        spellLaunched: [cast.before.counters.spellLaunched, cast.after.counters.spellLaunched],
        sawParticles,
      },
      equipment: equipmentProof,
      wornPicker: pickerProof,
      wornPickerSelected: { itemId: uiItem.id, gridItem },
    },
    errors: {
      lab: lastState.errors,
      console: consoleErrors,
      page: pageErrors,
    },
  }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (cause) {
  lastState = await readState(page).catch(() => lastState);
  console.error(JSON.stringify({
    passed: false,
    elapsedMs: Math.round(performance.now() - started),
    url: labUrl.href,
    failure: cause instanceof Error ? cause.stack ?? cause.message : String(cause),
    lastState,
    errors: { console: consoleErrors, page: pageErrors },
  }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => undefined);
  clearDeadline();
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
  while (performance.now() < deadline) {
    state = await readState(targetPage);
    if (predicate(state)) return state;
    await targetPage.waitForTimeout(POLL_MS);
  }
  throw new Error(`${label} did not complete in ${timeoutMs}ms; last state: ${JSON.stringify(state)}`);
}

function validateCatalog(catalog: FeatureLabCatalog): Record<string, boolean> {
  const equipmentSlots = catalog.equipment.map((group) => group.slot);
  const skillIds = catalog.skills.map((skill) => skill.id);
  return {
    creatures: catalog.targets.creature.length > 0,
    npcs: catalog.targets.npc.length > 0,
    spells: catalog.spells.length > 0,
    everyEquipmentSlot: sameMembers(equipmentSlots, [...EQUIP_SLOTS]),
    everyEquipmentSlotHasItems: catalog.equipment.every((group) => group.items.length > 0),
    equipmentItemsUniquePerSlot: catalog.equipment.every((group) => (
      new Set(group.items.map((item) => item.id)).size === group.items.length
    )),
    everySkill: sameMembers(skillIds, [...SKILL_IDS]),
  };
}

function screenPoint(state: FeatureLabState, canvas: CanvasBox): Point {
  const screen = state.target?.screen;
  if (!screen) throw new Error("Spawned target has no renderer screen coordinate");
  const [rawX, rawY] = screen;
  const isAbsolute = rawX >= canvas.x
    && rawX <= canvas.x + canvas.width
    && rawY >= canvas.y
    && rawY <= canvas.y + canvas.height;
  const point = isAbsolute
    ? { x: rawX, y: rawY }
    : { x: canvas.x + rawX, y: canvas.y + rawY };
  if (point.x < canvas.x || point.x > canvas.x + canvas.width
    || point.y < canvas.y || point.y > canvas.y + canvas.height) {
    throw new Error(`Target screen point ${screen.join(",")} is outside the production canvas`);
  }
  return point;
}

function chooseGroundPoint(canvas: CanvasBox, target: Point): Point {
  const candidates = [
    { x: canvas.x + canvas.width * 0.22, y: canvas.y + canvas.height * 0.72 },
    { x: canvas.x + canvas.width * 0.32, y: canvas.y + canvas.height * 0.64 },
  ];
  return candidates.sort((a, b) => distance2d(b, target) - distance2d(a, target))[0]
    ?? { x: canvas.x + canvas.width * 0.25, y: canvas.y + canvas.height * 0.7 };
}

function findItem(
  catalog: FeatureLabCatalog,
  slot: EquipSlot,
  pattern: RegExp,
): ItemId | null {
  const group = catalog.equipment.find((candidate) => candidate.slot === slot);
  return group?.items.find((item) => pattern.test(item.label))?.id ?? null;
}

function healthFell(before: FeatureLabState, after: FeatureLabState): boolean {
  const prior = before.target?.health;
  const current = after.target?.health;
  return typeof prior === "number" && typeof current === "number" && current < prior;
}

function distanceXZ(
  before: readonly [number, number, number],
  after: readonly [number, number, number],
): number {
  return Math.hypot(after[0] - before[0], after[2] - before[2]);
}

function distance2d(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sameMembers<T>(actual: readonly T[], expected: readonly T[]): boolean {
  if (actual.length !== expected.length) return false;
  const values = new Set(actual);
  return values.size === actual.length && expected.every((value) => values.has(value));
}

function ensureUrl(value: string): URL {
  try {
    return new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    throw new Error(`--base must be an absolute URL, received: ${value}`);
  }
}
