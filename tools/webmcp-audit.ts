/**
 * End-to-end WebMCP gameplay audit.
 *
 * Every gameplay read and action goes through document.modelContext. The debug API is restricted
 * to resetting a deterministic fixture, accelerating the clock, and the predeclared boss fixture.
 * Long progression scenarios do not grant XP, items, currency, movement, or quest state.
 *
 * Usage:
 *   npx tsx tools/webmcp-audit.ts --run runs/corealm [--scenario mining-1-to-40] [--scale 100]
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun, repoRoot, safeName } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";
import type {} from "./lib/debug-api.js";

type JsonObject = Record<string, unknown>;

interface McpEnvelope {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface AuditScenarioResult {
  id: string;
  title: string;
  passed: boolean;
  wallClockSeconds: number;
  toolCalls: number;
  toolsCovered: string[];
  summary: JsonObject;
  fixture: string[];
  screenshot: string | null;
  errors: string[];
}

interface WebMcpAuditReport {
  startedAt: string;
  scale: number;
  binding: JsonObject | null;
  advertisedTools: string[];
  coveredTools: string[];
  uncoveredTools: string[];
  scenarios: AuditScenarioResult[];
  passed: boolean;
}

interface ScenarioContext {
  page: Page;
  mcp: WebMcpClient;
  scale: number;
  fixture: string[];
}

interface ScenarioDef {
  id: string;
  title: string;
  run(context: ScenarioContext): Promise<JsonObject>;
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected an object, got ${JSON.stringify(value)}`);
  }
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected an array, got ${JSON.stringify(value)}`);
  return value;
}

function numberAt(value: unknown, key: string): number {
  const found = asObject(value)[key];
  if (typeof found !== "number") throw new Error(`Expected numeric ${key}, got ${JSON.stringify(found)}`);
  return found;
}

function stringAt(value: unknown, key: string): string {
  const found = asObject(value)[key];
  if (typeof found !== "string") throw new Error(`Expected string ${key}, got ${JSON.stringify(found)}`);
  return found;
}

function errorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return typeof (value as JsonObject)["error"] === "string" ? String((value as JsonObject)["error"]) : null;
}

function expectOk<T>(value: T, label: string): T {
  const code = errorCode(value);
  if (code) throw new Error(`${label}: ${code}: ${String(asObject(value)["message"] ?? "")}`);
  return value;
}

function countStacks(value: unknown, itemId: string): number {
  const rows = Array.isArray(value) ? value : [];
  let total = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const stack = row as JsonObject;
    if (stack["itemId"] === itemId && typeof stack["quantity"] === "number") total += stack["quantity"];
  }
  return total;
}

function inventoryCount(inventory: unknown, itemId: string): number {
  return countStacks(asObject(inventory)["slots"], itemId);
}

function bankCount(bank: unknown, itemId: string): number {
  return countStacks(asObject(bank)["slots"], itemId);
}

async function resetFixture(page: Page, scale: number, seed = 1337): Promise<void> {
  await page.evaluate(({ chosenSeed }) => {
    const debug = window.__gameDebug as unknown as {
      reset(options?: { seed?: number; keepSave?: boolean }): void;
    };
    debug.reset({ seed: chosenSeed, keepSave: false });
  }, { chosenSeed: seed });
  await page.waitForTimeout(200);
  await page.evaluate(({ chosenScale }) => {
    const debug = window.__gameDebug as unknown as { setTimeScale(scale: number): void };
    debug.setTimeScale(chosenScale);
  }, { chosenScale: scale });
}

class WebMcpClient {
  calls = 0;
  cursor = 0;
  readonly covered = new Set<string>();

  constructor(readonly page: Page) {}

  async raw(name: string, args: JsonObject = {}): Promise<McpEnvelope> {
    this.calls += 1;
    this.covered.add(name);
    return this.page.evaluate(async ({ toolName, toolArgs }) => {
      interface BrowserTool {
        name: string;
        execute(args: Record<string, unknown>): Promise<unknown>;
      }
      interface BrowserContext {
        getTools(): Promise<BrowserTool[]> | BrowserTool[];
        executeTool?(tool: BrowserTool | string, args: Record<string, unknown>): Promise<unknown>;
      }
      const context = (document as unknown as { modelContext?: BrowserContext }).modelContext;
      if (!context) throw new Error("document.modelContext is missing");
      const tools = await context.getTools();
      const tool = tools.find((candidate) => candidate.name === toolName);
      if (!tool) throw new Error(`WebMCP did not advertise ${toolName}`);
      const envelope = context.executeTool
        ? await context.executeTool(tool, toolArgs)
        : await tool.execute(toolArgs);
      return envelope as McpEnvelope;
    }, { toolName: name, toolArgs: args });
  }

  async call<T = unknown>(name: string, args: JsonObject = {}): Promise<T> {
    const envelope = await this.raw(name, args);
    if ("structuredContent" in envelope) return envelope.structuredContent as T;
    const text = envelope.content?.find((block) => block.type === "text")?.text;
    if (text === undefined) throw new Error(`${name} returned no structuredContent or text block`);
    return JSON.parse(text) as T;
  }

  async startCursor(): Promise<void> {
    const current = expectOk(await this.call("corealm_events", { sinceSeq: 0, timeoutMs: 0 }), "event cursor");
    this.cursor = numberAt(current, "nextSeq");
  }

  async wait(types: string[], timeoutMs = 30_000): Promise<JsonObject[]> {
    const result = expectOk(await this.call("corealm_events", {
      sinceSeq: this.cursor,
      types,
      timeoutMs,
    }), `wait for ${types.join(", ")}`);
    this.cursor = numberAt(result, "nextSeq");
    return asArray(asObject(result)["events"]).map(asObject);
  }

  async moveTo(target: { entityId?: string; locationId?: string; position?: number[] }): Promise<void> {
    const started = expectOk(await this.call("corealm_move_to", target), `move ${JSON.stringify(target)}`);
    if (numberAt(started, "etaMs") <= 0) return;
    const events = await this.wait(["navigation.completed", "navigation.failed", "player.died"], 60_000);
    const failed = events.find((event) => event["type"] !== "navigation.completed");
    if (failed) throw new Error(`Navigation failed: ${JSON.stringify(failed)}`);
  }

  async interact(entityId: string, interaction: string): Promise<unknown> {
    const result = expectOk(await this.call("corealm_interact", { entityId, interaction }), `${interaction} ${entityId}`);
    if (!String(asObject(result)["started"] ?? "").startsWith("walking")) return result;
    const events = await this.wait(["navigation.completed", "navigation.failed", "player.died"], 60_000);
    const failed = events.find((event) => event["type"] !== "navigation.completed");
    if (failed) throw new Error(`Interaction approach failed: ${JSON.stringify(failed)}`);
    return result;
  }

  async talkChoose(npcId: string, suffixes: string[]): Promise<void> {
    await this.interact(npcId, "talk");
    let view = await this.call("corealm_dialogue", { op: "state" });
    if (errorCode(view) === "NO_DIALOGUE") {
      expectOk(await this.call("corealm_interact", { entityId: npcId, interaction: "talk" }), `talk ${npcId}`);
      view = await this.call("corealm_dialogue", { op: "state" });
    }
    expectOk(view, `dialogue ${npcId}`);
    for (const suffix of suffixes) {
      const current = expectOk(await this.call("corealm_dialogue", { op: "state" }), `dialogue state ${suffix}`);
      const options = asArray(asObject(current)["options"]).map(asObject);
      const option = options.find((row) => String(row["id"] ?? "").endsWith(`#${suffix}`) && row["enabled"] !== false);
      if (!option) throw new Error(`No enabled dialogue option ending #${suffix}: ${JSON.stringify(options)}`);
      expectOk(await this.call("corealm_dialogue", { op: "choose", optionId: option["id"] }), `choose ${suffix}`);
    }
  }

  async waitForIdleActivity(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const player = expectOk(await this.call("corealm_player"), "read player activity");
      if (asObject(player)["activityKind"] === null) return;
      await this.wait(["activity.stopped", "production.completed", "resource.depleted", "inventory.full"], timeoutMs);
    }
    throw new Error("Activity did not stop before the deadline");
  }

  async produce(stationId: string, recipeId: string, quantity: number): Promise<void> {
    await this.moveTo({ entityId: stationId });
    expectOk(await this.call("corealm_produce", { stationId, recipeId, quantity }), `produce ${recipeId}`);
    await this.waitForIdleActivity();
  }

  async inspectResourceRows(itemId: string, archetype: string): Promise<JsonObject[]> {
    const observed = expectOk(await this.call("corealm_observe", {
      scope: "visible",
      archetypes: [archetype],
      requirementsMet: true,
      radius: 140,
      limit: 100,
    }), `observe ${archetype}`);
    const matches: JsonObject[] = [];
    for (const row of asArray(observed).map(asObject)) {
      const detail = expectOk(await this.call("corealm_inspect", { entityId: row["id"] }), `inspect ${row["id"]}`);
      if (asObject(asObject(detail)["resource"])["itemId"] === itemId) matches.push(row);
    }
    return matches;
  }

  async workResource(entityId: string, interaction: string): Promise<void> {
    await this.interact(entityId, interaction);
    const player = expectOk(await this.call("corealm_player"), "player after gather start");
    if (asObject(player)["activityKind"] === null) {
      const detail = expectOk(await this.call("corealm_inspect", { entityId }), `inspect ${entityId} after approach`);
      if (asObject(detail)["state"] === "available") {
        expectOk(await this.call("corealm_interact", { entityId, interaction }), `${interaction} ${entityId} after approach`);
      }
    }
    await this.waitForIdleActivity(45_000);
  }

  async gatherIntoBank(options: {
    itemId: string;
    quantity: number;
    locationId: string;
    archetype: string;
    interaction: string;
    bankId: string;
  }): Promise<number> {
    let stored = 0;
    let guard = 0;
    while (stored < options.quantity && guard++ < 50) {
      await this.moveTo({ locationId: options.locationId });
      let nodes = await this.inspectResourceRows(options.itemId, options.archetype);
      nodes = nodes.filter((row) => row["state"] === "available");
      if (nodes.length === 0) {
        await this.page.waitForTimeout(500);
        continue;
      }
      await this.workResource(String(nodes[0]!["id"]), options.interaction);
      await this.moveTo({ entityId: options.bankId });
      expectOk(await this.call("corealm_bank", { op: "depositAll" }), "deposit gathered items");
      const bank = expectOk(await this.call("corealm_bank", { op: "list" }), "list bank");
      stored = bankCount(bank, options.itemId);
    }
    if (stored < options.quantity) throw new Error(`Only banked ${stored}/${options.quantity} ${options.itemId}`);
    return stored;
  }

  async kill(entityId: string, timeoutMs = 60_000): Promise<void> {
    let attack = await this.call("corealm_attack", { entityId });
    if (errorCode(attack) === "OUT_OF_RANGE") {
      await this.moveTo({ entityId });
      attack = await this.call("corealm_attack", { entityId });
    }
    expectOk(attack, `attack ${entityId}`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const events = await this.wait(["combat.ended", "player.died", "health.low"], timeoutMs);
      if (events.some((event) => event["type"] === "player.died")) throw new Error(`Player died fighting ${entityId}`);
      const ended = events.find((event) => event["type"] === "combat.ended");
      if (ended && asObject(ended["data"])["reason"] === "killed") return;
    }
    throw new Error(`Fight against ${entityId} timed out`);
  }
}

async function findByFamily(mcp: WebMcpClient, family: string, archetypes: string[] = ["enemy"]): Promise<JsonObject[]> {
  const observed = expectOk(await mcp.call("corealm_observe", {
    scope: "visible", archetypes, radius: 140, limit: 100,
  }), `observe ${family}`);
  const matches: JsonObject[] = [];
  for (const row of asArray(observed).map(asObject)) {
    if (row["state"] === "dead") continue;
    const detail = expectOk(await mcp.call("corealm_inspect", { entityId: row["id"] }), `inspect ${row["id"]}`);
    if (asObject(asObject(detail)["meta"])["family"] === family) matches.push(row);
  }
  return matches;
}

async function scenarioSurface({ page, mcp }: ScenarioContext): Promise<JsonObject> {
  const descriptors = await page.evaluate(async () => {
    const context = (document as unknown as { modelContext: { getTools(): Promise<unknown[]> | unknown[] } }).modelContext;
    return context.getTools();
  }) as JsonObject[];
  const names = descriptors.map((row) => String(row["name"]));
  if (names.length !== 22) throw new Error(`Expected 22 tools, got ${names.length}`);
  if (new Set(names).size !== names.length) throw new Error("WebMCP advertised duplicate tool names");
  for (const row of descriptors) {
    if (!row["description"] || asObject(row["inputSchema"])["type"] !== "object") {
      throw new Error(`Bad descriptor: ${JSON.stringify(row)}`);
    }
  }
  const useItem = descriptors.find((row) => row["name"] === "corealm_use_item");
  const useItemProperties = asObject(asObject(useItem)["inputSchema"])["properties"];
  if ("targetItemId" in asObject(useItemProperties)) {
    throw new Error("corealm_use_item advertises unsupported item-on-item combinations");
  }
  const playerEnvelope = await mcp.raw("corealm_player");
  if (playerEnvelope.isError || !playerEnvelope.content?.length || !playerEnvelope.structuredContent) {
    throw new Error(`Bad MCP success envelope: ${JSON.stringify(playerEnvelope)}`);
  }
  const errorEnvelope = await mcp.raw("corealm_inspect", { entityId: "missing_audit_entity" });
  if (!errorEnvelope.isError || errorCode(errorEnvelope.structuredContent) !== "NOT_FOUND") {
    throw new Error(`Bad MCP error envelope: ${JSON.stringify(errorEnvelope)}`);
  }
  const docs = expectOk(await mcp.call("corealm_search_docs", { query: "Grithe ore", limit: 3 }), "search docs");
  expectOk(await mcp.call("corealm_overlay", {
    op: "set", id: "audit_marker", kind: "marker", position: [-160, 0, -80], colour: "#ffcc66",
  }), "set overlay");
  expectOk(await mcp.call("corealm_overlay", { op: "clear", id: "audit_marker" }), "clear overlay");
  return {
    toolCount: names.length, uniqueNames: new Set(names).size, docsHits: asArray(docs).length,
    useItemArguments: Object.keys(asObject(useItemProperties)).sort(),
  };
}

async function scenarioColdIron({ mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.talkChoose("npc_smith_harrow", ["offer", "accept"]);
  expectOk(await mcp.call("corealm_search_docs", { query: "Grithe Dagger recipe", limit: 3 }), "find dagger recipe");
  await mcp.gatherIntoBank({
    itemId: "grithe_ore", quantity: 6, locationId: "bracken_pit", archetype: "ore",
    interaction: "mine", bankId: "coldbrace_bank",
  });
  await mcp.gatherIntoBank({
    itemId: "march_stone", quantity: 2, locationId: "bracken_pit", archetype: "ore",
    interaction: "mine", bankId: "coldbrace_bank",
  });
  await mcp.gatherIntoBank({
    itemId: "palewood_log", quantity: 1, locationId: "palewood_copse", archetype: "tree",
    interaction: "chop", bankId: "coldbrace_bank",
  });
  for (const [itemId, quantity] of [["grithe_ore", 2], ["march_stone", 2], ["palewood_log", 1]] as const) {
    expectOk(await mcp.call("corealm_bank", { op: "withdraw", itemId, quantity }), `withdraw ${itemId}`);
  }
  await mcp.produce("coldbrace_fletching", "fletch_palewood_handle", 1);
  await mcp.produce("coldbrace_furnace", "smelt_grithe_bar", 2);
  await mcp.produce("coldbrace_anvil", "smith_grithe_dagger", 1);
  expectOk(await mcp.call("corealm_equip", { itemId: "grithe_dagger" }), "equip quest dagger");
  await mcp.moveTo({ locationId: "redsill_shallows" });
  let kills = 0;
  while (kills < 3) {
    const targets = await findByFamily(mcp, "skitterling");
    if (!targets.length) throw new Error("No living Rill Skitterling was visible");
    await mcp.kill(String(targets[0]!["id"]));
    kills += 1;
    await mcp.page.waitForTimeout(250);
  }
  await mcp.talkChoose("npc_smith_harrow", ["done"]);
  const quests = asArray(expectOk(await mcp.call("corealm_quests"), "read quests")).map(asObject);
  const quest = quests.find((row) => row["id"] === "cold_iron");
  if (quest?.["status"] !== "complete") throw new Error(`Cold Iron did not complete: ${JSON.stringify(quest)}`);
  return { status: quest["status"], stage: quest["stage"], kills };
}

async function scenarioMining40({ page, mcp }: ScenarioContext): Promise<JsonObject> {
  const bands = [
    { maxLevel: 5, locationId: "bracken_pit", itemId: "grithe_ore", bonusId: "pale_quartz", bankId: "coldbrace_bank" },
    { maxLevel: 40, locationId: "hollowcut_seam", itemId: "corven_ore", bonusId: "vell_amber", bankId: "rootfall_bank_chest" },
  ];
  let bankTrips = 0;
  let nodesWorked = 0;
  let currentLocation = "";
  let guard = 0;
  while (guard++ < 1_000) {
    const skills = expectOk(await mcp.call("corealm_skills"), "read mining level");
    const mining = asObject(asObject(skills)["mining"]);
    const level = numberAt(mining, "level");
    if (level >= 40) break;
    const band = bands.find((candidate) => level < candidate.maxLevel) ?? bands[1]!;
    const inventory = expectOk(await mcp.call("corealm_inventory"), "read mining inventory");
    if (numberAt(inventory, "freeSlots") <= 1) {
      await mcp.moveTo({ entityId: band.bankId });
      for (const itemId of [band.itemId, band.bonusId]) {
        const deposited = await mcp.call("corealm_bank", { op: "deposit", itemId });
        if (errorCode(deposited) && errorCode(deposited) !== "NOT_ENOUGH_ITEMS") expectOk(deposited, `deposit ${itemId}`);
      }
      bankTrips += 1;
      currentLocation = "";
      continue;
    }
    if (currentLocation !== band.locationId) {
      await mcp.moveTo({ locationId: band.locationId });
      currentLocation = band.locationId;
    }
    const nodes = (await mcp.inspectResourceRows(band.itemId, "ore")).filter((row) => row["state"] === "available");
    if (!nodes.length) {
      await page.waitForTimeout(500);
      continue;
    }
    await mcp.workResource(String(nodes[0]!["id"]), "mine");
    nodesWorked += 1;
  }
  const skills = expectOk(await mcp.call("corealm_skills"), "final mining skills");
  const mining = asObject(asObject(skills)["mining"]);
  if (numberAt(mining, "level") < 40) throw new Error(`Mining stopped at ${JSON.stringify(mining)}`);
  expectOk(await mcp.call("corealm_stop"), "stop after target level");
  return {
    miningLevel: mining["level"], miningXp: mining["xp"], bankTrips, nodesWorked,
    strategy: "Grithe to level 5, then the short Rootfall-to-Hollowcut Corven route",
  };
}

async function scenarioArmour({ mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.gatherIntoBank({
    itemId: "grithe_ore", quantity: 10, locationId: "bracken_pit", archetype: "ore",
    interaction: "mine", bankId: "coldbrace_bank",
  });
  await mcp.gatherIntoBank({
    itemId: "march_stone", quantity: 10, locationId: "bracken_pit", archetype: "ore",
    interaction: "mine", bankId: "coldbrace_bank",
  });
  for (const itemId of ["grithe_ore", "march_stone"]) {
    expectOk(await mcp.call("corealm_bank", { op: "withdraw", itemId, quantity: 10 }), `withdraw ${itemId}`);
  }
  await mcp.produce("coldbrace_furnace", "smelt_grithe_bar", 10);
  const recipes = [
    ["smith_grithe_helm", "grithe_helm"],
    ["smith_grithe_cuirass", "grithe_cuirass"],
    ["smith_grithe_greaves", "grithe_greaves"],
    ["smith_grithe_boots", "grithe_boots"],
    ["smith_grithe_gloves", "grithe_gloves"],
  ] as const;
  for (const [recipeId] of recipes) await mcp.produce("coldbrace_anvil", recipeId, 1);
  for (const [, itemId] of recipes) expectOk(await mcp.call("corealm_equip", { itemId }), `equip ${itemId}`);
  const inventory = expectOk(await mcp.call("corealm_inventory"), "read equipped armour");
  const slots = asObject(asObject(asObject(inventory)["equipment"])["slots"]);
  const worn = ["head", "body", "legs", "feet", "hands"].map((slot) => asObject(slots[slot])["itemId"]);
  const expected = recipes.map(([, itemId]) => itemId);
  if (JSON.stringify(worn) !== JSON.stringify(expected)) throw new Error(`Wrong armour set: ${JSON.stringify(worn)}`);
  return { worn, smithingLevel: asObject(asObject(await mcp.call("corealm_skills"))["smithing"])["level"] };
}

async function scenarioBossCamp({ page, mcp, fixture }: ScenarioContext): Promise<JsonObject> {
  fixture.push("Melee 40, a Kaldite combat kit, and food are installed before the boss loop; no loot or boss state is granted.");
  await page.evaluate(() => {
    const debug = window.__gameDebug as unknown as {
      clearInventory(): void;
      setSkillLevel(skill: string, level: number): void;
      giveItem(itemId: string, quantity: number, to: "inventory" | "bank"): void;
    };
    debug.clearInventory();
    debug.setSkillLevel("melee", 40);
    for (const itemId of [
      "kaldite_sword", "cairnpine_shield", "kaldite_helm", "kaldite_plate",
      "kaldite_greaves", "kaldite_boots", "kaldite_gauntlets",
    ]) debug.giveItem(itemId, 1, "inventory");
    debug.giveItem("seared_cragfin", 20, "inventory");
  });
  for (const itemId of [
    "kaldite_sword", "cairnpine_shield", "kaldite_helm", "kaldite_plate",
    "kaldite_greaves", "kaldite_boots", "kaldite_gauntlets",
  ]) expectOk(await mcp.call("corealm_equip", { itemId }), `equip boss fixture ${itemId}`);
  let kills = 0;
  while (kills < 8) {
    await mcp.moveTo({ entityId: "tempest_roc" });
    await mcp.kill("tempest_roc", 90_000);
    kills += 1;
    const loot = asArray(expectOk(await mcp.call("corealm_observe", {
      scope: "visible", archetypes: ["loot"], radius: 140, limit: 20,
    }), "observe boss loot")).map(asObject);
    for (const pile of loot) {
      const entityId = String(pile["id"]);
      await mcp.interact(entityId, "loot");
      expectOk(await mcp.call("corealm_take_loot", { entityId }), `take loot ${entityId}`);
    }
    const inventory = expectOk(await mcp.call("corealm_inventory"), "read boss drops");
    if (inventoryCount(inventory, "pale_quartz") > 0) {
      return { boss: "tempest_roc", wantedItem: "pale_quartz", kills, quantity: inventoryCount(inventory, "pale_quartz") };
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error("Tempest Roc did not drop pale_quartz in eight kills");
}

async function scenarioFishCookBank({ mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.moveTo({ locationId: "redsill_shallows" });
  const spots = (await mcp.inspectResourceRows("silt_minnow", "fishing_spot")).filter((row) => row["state"] === "available");
  if (!spots.length) throw new Error("No fishing spot was available");
  await mcp.workResource(String(spots[0]!["id"]), "fish");
  const caught = inventoryCount(await mcp.call("corealm_inventory"), "silt_minnow");
  if (caught < 1) throw new Error("Fishing produced no Silt Minnow");
  await mcp.produce("coldbrace_range", "cook_seared_minnow", caught);
  await mcp.moveTo({ entityId: "coldbrace_bank" });
  expectOk(await mcp.call("corealm_bank", { op: "depositAll" }), "bank cooked catch");
  const bank = expectOk(await mcp.call("corealm_bank", { op: "list" }), "read cooked bank");
  const cooked = bankCount(bank, "seared_minnow");
  const burnt = bankCount(bank, "burnt_minnow");
  if (cooked + burnt < caught) throw new Error(`Cooked output mismatch: caught ${caught}, banked ${cooked + burnt}`);
  return { caught, cooked, burnt, banked: cooked + burnt };
}

async function scenarioWoodcutFletch({ mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.moveTo({ locationId: "palewood_copse" });
  const trees = (await mcp.inspectResourceRows("palewood_log", "tree")).filter((row) => row["state"] === "available");
  if (!trees.length) throw new Error("No Palewood was available");
  await mcp.workResource(String(trees[0]!["id"]), "chop");
  const logs = inventoryCount(await mcp.call("corealm_inventory"), "palewood_log");
  if (logs < 2) throw new Error(`Woodcutting produced only ${logs} log(s); the fire and staff need two`);
  expectOk(await mcp.call("corealm_build_campfire", { logItemId: "palewood_log" }), "build Palewood campfire");
  await mcp.waitForIdleActivity();
  await mcp.produce("coldbrace_fletching", "fletch_palewood_shaft", 1);
  await mcp.produce("coldbrace_fletching", "fletch_palewood_staff", 1);
  expectOk(await mcp.call("corealm_equip", { itemId: "palewood_staff" }), "equip Palewood Staff");
  const inventory = expectOk(await mcp.call("corealm_inventory"), "read equipped staff");
  const mainHand = asObject(asObject(asObject(inventory)["equipment"])["slots"])["mainHand"];
  if (asObject(mainHand)["itemId"] !== "palewood_staff") throw new Error(`Staff was not equipped: ${JSON.stringify(mainHand)}`);
  const spellbook = expectOk(await mcp.call("corealm_spellbook", { op: "read" }), "read staff spellbook");
  return {
    logs, weapon: "palewood_staff", activeSpellId: asObject(spellbook)["activeSpellId"],
    chargedMagicWeapon: asObject(spellbook)["equippedWeapon"] !== null,
  };
}

async function scenarioFarm({ page, mcp, fixture }: ScenarioContext): Promise<JsonObject> {
  fixture.push("One Bittergrain seed is installed; raking, planting, timed growth, harvesting, and banking use production game paths.");
  await page.evaluate(() => {
    const debug = window.__gameDebug as unknown as { giveItem(itemId: string, quantity: number, to: "inventory" | "bank"): void };
    debug.giveItem("bittergrain_seed", 1, "inventory");
  });
  await mcp.moveTo({ locationId: "marchfield_farm" });
  const plots = asArray(expectOk(await mcp.call("corealm_observe", {
    scope: "visible", archetypes: ["farm_plot"], radius: 140, limit: 20,
  }), "observe farm plots")).map(asObject);
  const plot = plots.find((row) => row["state"] === "empty") ?? plots[0];
  if (!plot) throw new Error("No Marchfield plot was visible");
  if (plot["state"] === "empty") {
    await mcp.interact(String(plot["id"]), "rake");
    await mcp.waitForIdleActivity();
  }
  expectOk(await mcp.call("corealm_use_item", {
    itemId: "bittergrain_seed", targetEntityId: plot["id"],
  }), "plant Bittergrain");
  await mcp.waitForIdleActivity();
  fixture.push("The test clock advances five minutes so the persistent crop timer matures without a wall-clock wait.");
  await page.evaluate(() => {
    const debug = window.__gameDebug as unknown as { advanceGameTime(seconds: number): void };
    debug.advanceGameTime(300);
  });
  await page.waitForTimeout(200);
  await mcp.interact(String(plot["id"]), "harvest");
  await mcp.waitForIdleActivity();
  const harvested = inventoryCount(await mcp.call("corealm_inventory"), "bittergrain");
  if (harvested < 1) throw new Error("The mature Bittergrain plot yielded nothing");
  await mcp.moveTo({ entityId: "coldbrace_bank" });
  expectOk(await mcp.call("corealm_bank", { op: "depositAll" }), "bank Bittergrain");
  const bank = expectOk(await mcp.call("corealm_bank", { op: "list" }), "read crop bank");
  return { harvested, banked: bankCount(bank, "bittergrain") };
}

async function scenarioShop({ mcp }: ScenarioContext): Promise<JsonObject> {
  await mcp.moveTo({ entityId: "coldbrace_general" });
  const stock = expectOk(await mcp.call("corealm_shop", { op: "list", shopId: "coldbrace_general" }), "list shop");
  expectOk(await mcp.call("corealm_shop", {
    op: "sell", shopId: "coldbrace_general", itemId: "worn_sword", quantity: 1,
  }), "sell starter sword");
  expectOk(await mcp.call("corealm_shop", {
    op: "sell", shopId: "coldbrace_general", itemId: "worn_hatchet", quantity: 1,
  }), "sell starter hatchet");
  expectOk(await mcp.call("corealm_shop", {
    op: "sell", shopId: "coldbrace_general", itemId: "worn_pickaxe", quantity: 1,
  }), "sell starter pickaxe");
  const afterSale = expectOk(await mcp.call("corealm_inventory"), "currency after sale");
  const marks = numberAt(afterSale, "currency");
  if (marks < 9) throw new Error(`Selling starter gear paid only ${marks} marks`);
  const essenceBefore = inventoryCount(afterSale, "air_essence");
  expectOk(await mcp.call("corealm_shop", {
    op: "buy", shopId: "coldbrace_general", itemId: "air_essence", quantity: 1,
  }), "buy Air Essence");
  const bought = expectOk(await mcp.call("corealm_inventory"), "inventory after purchase");
  if (inventoryCount(bought, "air_essence") !== essenceBefore + 1) throw new Error("Bought essence did not reach inventory");
  return { stockRows: asArray(asObject(stock)["stock"]).length, marksAfterSale: marks, bought: "air_essence" };
}

async function scenarioMagicStop({ page, mcp }: ScenarioContext): Promise<JsonObject> {
  const spellbook = expectOk(await mcp.call("corealm_spellbook", { op: "read" }), "read spellbook");
  expectOk(await mcp.call("corealm_spellbook", { op: "select", spellId: "voltrend" }), "select Voltrend");
  expectOk(await mcp.call("corealm_move_to", { locationId: "palewood_copse" }), "start long route");
  await page.waitForTimeout(50);
  const stopped = expectOk(await mcp.call("corealm_stop"), "stop navigation");
  if (!asArray(asObject(stopped)["stopped"]).includes("navigation")) throw new Error(`Stop missed navigation: ${JSON.stringify(stopped)}`);
  await mcp.startCursor();
  await mcp.moveTo({ locationId: "redsill_shallows" });
  const targets = await findByFamily(mcp, "skitterling");
  if (!targets.length) throw new Error("No magic target was visible");
  const targetId = String(targets[0]!["id"]);
  await mcp.moveTo({ entityId: targetId });
  expectOk(await mcp.call("corealm_overlay", { op: "set", id: "magic_target", kind: "highlight", entityId: targetId }), "highlight target");
  expectOk(await mcp.call("corealm_attack", { entityId: targetId, spellId: "voltrend" }), "cast Voltrend");
  const events = await mcp.wait(["spell.launched", "combat.ended", "player.died"], 60_000);
  if (!events.some((event) => event["type"] === "spell.launched")) throw new Error(`No spell launch event: ${JSON.stringify(events)}`);
  const player = expectOk(await mcp.call("corealm_player"), "read player after cast");
  if (asObject(player)["dead"] === true) throw new Error("Player died in magic scenario");
  expectOk(await mcp.call("corealm_overlay", { op: "clear", id: "magic_target" }), "clear target highlight");
  return {
    selected: "voltrend",
    activeBefore: asObject(spellbook)["activeSpellId"],
    spellEvents: events.filter((event) => event["type"] === "spell.launched").length,
  };
}

export const WEBMCP_SCENARIOS: readonly ScenarioDef[] = [
  { id: "surface-contract", title: "WebMCP descriptors, envelopes, docs, and overlays", run: scenarioSurface },
  { id: "cold-iron-quest", title: "Complete Cold Iron from its opening dialogue", run: scenarioColdIron },
  { id: "mining-1-to-40", title: "Train Mining from 1 to 40 on the fastest bank route", run: scenarioMining40 },
  { id: "grithe-armour-from-scratch", title: "Mine, smelt, smith, and equip a five-piece armour set", run: scenarioArmour },
  { id: "tempest-roc-loot-camp", title: "Camp the Tempest Roc until Pale Quartz drops", run: scenarioBossCamp },
  { id: "fish-cook-bank", title: "Fish, cook the catch, and bank every result", run: scenarioFishCookBank },
  { id: "woodcut-fletch-equip", title: "Cut Palewood, fletch a staff, and equip it", run: scenarioWoodcutFletch },
  { id: "farm-harvest-bank", title: "Rake, plant, grow, harvest, and bank Bittergrain", run: scenarioFarm },
  { id: "shop-buy-sell", title: "Sell starter gear and buy stock through a real shop", run: scenarioShop },
  { id: "magic-combat-stop-overlay", title: "Cancel navigation, choose a spell, cast, and explain the target", run: scenarioMagicStop },
] as const;

async function advertisedTools(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const context = (document as unknown as { modelContext: { getTools(): Promise<{ name: string }[]> | { name: string }[] } }).modelContext;
    return (await context.getTools()).map((tool) => tool.name).sort();
  });
}

export async function runWebMcpAudit(
  runCandidate: string,
  requestedScenario: string | undefined,
  scale: number,
): Promise<WebMcpAuditReport> {
  const runDir = await prepareRun(runCandidate);
  const selected = requestedScenario
    ? WEBMCP_SCENARIOS.filter((scenario) => scenario.id === requestedScenario)
    : [...WEBMCP_SCENARIOS];
  if (selected.length === 0) throw new Error(`Unknown scenario ${requestedScenario}. Use: ${WEBMCP_SCENARIOS.map((row) => row.id).join(", ")}`);
  const server = await startGameServer();
  const report: WebMcpAuditReport = {
    startedAt: new Date().toISOString(), scale, binding: null, advertisedTools: [], coveredTools: [],
    uncoveredTools: [], scenarios: [], passed: false,
  };
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
        "--disable-frame-rate-limit", "--disable-gpu-vsync", "--mute-audio",
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(60_000);
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(String(error).slice(0, 400)));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text().slice(0, 400));
    });
    await page.goto(server.url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 90_000 });
    report.binding = await page.evaluate(() => (
      window as unknown as { corealm: { agent: { webmcp(): Record<string, unknown> } } }
    ).corealm.agent.webmcp()) as JsonObject;
    report.advertisedTools = await advertisedTools(page);

    const allCovered = new Set<string>();
    for (const scenario of selected) {
      await resetFixture(page, scale);
      const mcp = new WebMcpClient(page);
      await mcp.startCursor();
      const fixture: string[] = [];
      const startedAt = Date.now();
      const errors: string[] = [];
      let summary: JsonObject = {};
      let screenshot: string | null = null;
      try {
        summary = await scenario.run({ page, mcp, scale, fixture });
        const screenshotFile = path.join(runDir, "screenshots", `webmcp-${safeName(scenario.id)}.png`);
        await page.screenshot({ path: screenshotFile, fullPage: false });
        screenshot = path.relative(repoRoot, screenshotFile).replaceAll("\\", "/");
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : String(cause));
      }
      errors.push(...browserErrors.splice(0, browserErrors.length));
      for (const tool of mcp.covered) allCovered.add(tool);
      report.scenarios.push({
        id: scenario.id,
        title: scenario.title,
        passed: errors.length === 0,
        wallClockSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        toolCalls: mcp.calls,
        toolsCovered: [...mcp.covered].sort(),
        summary,
        fixture,
        screenshot,
        errors,
      });
    }
    report.coveredTools = [...allCovered].sort();
    report.uncoveredTools = report.advertisedTools.filter((tool) => !allCovered.has(tool));
    report.passed = report.scenarios.every((scenario) => scenario.passed)
      && (requestedScenario !== undefined || report.uncoveredTools.length === 0);
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close();
  }
  const suffix = requestedScenario ? `-${safeName(requestedScenario)}` : "";
  await writeFile(
    path.join(runDir, "test-results", `webmcp-audit${suffix}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runCandidate = argValue(args, "--run");
  if (!runCandidate) throw new Error("Usage: npx tsx tools/webmcp-audit.ts --run runs/<id> [--scenario id] [--scale 100]");
  const requestedScenario = argValue(args, "--scenario");
  const parsedScale = Number(argValue(args, "--scale") ?? 100);
  const scale = Number.isFinite(parsedScale) ? Math.max(1, Math.min(100, parsedScale)) : 100;
  const report = await runWebMcpAudit(runCandidate, requestedScenario, scale);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("WebMCP audit");
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
