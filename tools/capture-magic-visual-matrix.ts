import path from "node:path";
import { writeFile } from "node:fs/promises";
import { GameDriver } from "./lib/driver.js";
import { prepareRun, safeName } from "./lib/paths.js";
import type { RunningGameServer } from "./lib/server.js";

interface EquipmentRead {
  equipment?: {
    slots?: Partial<Record<"mainHand", { itemId: string; quantity: number } | null>>;
  };
}

interface SpellbookRead {
  equippedWeapon?: { itemId: string; charges: number; capacity: number } | null;
}

interface EntityRead {
  id: string;
  state: string;
  position: [number, number, number];
  meta?: Record<string, unknown>;
}

const url = process.env.COREALM_URL ?? "http://127.0.0.1:5173";
const hardware = process.argv.includes("--hardware");
const HARDWARE_ARGS = [
  "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit", "--disable-gpu-vsync", "--mute-audio",
];
const SWIFTSHADER_ARGS = [
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio",
];
const mode = process.argv.includes("--wands-only")
  ? "wands"
  : process.argv.includes("--palewood-wand-only")
    ? "palewood-wand"
  : process.argv.includes("--duskoak-wand-only")
    ? "duskoak-wand"
  : process.argv.includes("--cairnpine-wand-only")
    ? "cairnpine-wand"
  : process.argv.includes("--basic-staff-only")
    ? "basic-staff"
  : process.argv.includes("--cairnpine-staff-only")
    ? "cairnpine-staff"
  : process.argv.includes("--charged-staff-only")
    ? "charged-staff"
  : process.argv.includes("--staffs-only")
    ? "staffs"
    : process.argv.includes("--staffs-tail")
      ? "staffs-tail"
    : process.argv.includes("--air-cache-only")
      ? "air-cache"
    : process.argv.includes("--earth-cache-only")
      ? "earth-cache"
    : process.argv.includes("--water-cache-only")
      ? "water-cache"
    : process.argv.includes("--caches-only")
      ? "caches"
      : "all";
const wandVariant = mode === "palewood-wand"
  ? { itemId: "palewood_wand", magicLevel: 1, frame: "magic-wood-palewood-wand-unlit" }
  : mode === "duskoak-wand"
    ? { itemId: "duskoak_wand", magicLevel: 5, frame: "magic-wood-duskoak-wand-unlit" }
    : mode === "cairnpine-wand"
      ? { itemId: "cairnpine_wand", magicLevel: 10, frame: "magic-wood-cairnpine-wand-unlit" }
      : null;
const captureWands = mode === "all" || mode === "wands" || wandVariant !== null;
const captureStaffs = mode === "all"
  || mode === "basic-staff"
  || mode === "cairnpine-staff"
  || mode === "charged-staff"
  || mode === "staffs"
  || mode === "staffs-tail";
const captureCaches = mode === "all"
  || mode === "caches"
  || mode === "air-cache"
  || mode === "earth-cache"
  || mode === "water-cache";
const runDir = await prepareRun("runs/corealm");
const screenshotDir = path.join(runDir, "screenshots");
const runningServer: RunningGameServer = { url, close: async () => undefined };
const driver = new GameDriver(runningServer, {
  viewport: { width: 1440, height: 900 },
  browserArgs: hardware ? HARDWARE_ARGS : SWIFTSHADER_ARGS,
  settings: {
    renderScale: 0.7,
    shadowQuality: "off",
    drawDistance: "near",
    damageNumbers: false,
    invertCameraY: false,
    uiScale: "normal",
    music: 0,
    ambient: 0,
    sfx: 0,
  },
});

const captured: string[] = [];
const call = (method: string, args: unknown[] = []): Promise<unknown> => driver.callDebug(method, args);
const tool = (name: string, args: unknown): Promise<unknown> => call("callTool", [name, args]);

async function loadout(): Promise<{ weapon: string | null; charges: number }> {
  const inventory = await tool("corealm_inventory", {}) as EquipmentRead;
  const book = await tool("corealm_spellbook", { op: "read" }) as SpellbookRead;
  return {
    weapon: inventory.equipment?.slots?.mainHand?.itemId ?? null,
    charges: book.equippedWeapon?.charges ?? 0,
  };
}

async function equip(itemId: string): Promise<void> {
  const result = await tool("corealm_equip", { itemId }) as { error?: string; message?: string };
  if (result.error) throw new Error(`Could not equip ${itemId}: ${result.error} ${result.message ?? ""}`.trim());
}

async function clearMainHand(): Promise<void> {
  const current = await loadout();
  if (!current.weapon) return;
  const result = await tool("corealm_equip", { unequipSlot: "mainHand" }) as {
    error?: string;
    message?: string;
  };
  if (result.error) throw new Error(`Could not clear main hand: ${result.error} ${result.message ?? ""}`.trim());
}

async function expectLoadout(
  weapon: string,
  charged: boolean,
): Promise<void> {
  const current = await loadout();
  const isCharged = current.charges > 0;
  if (current.weapon !== weapon || isCharged !== charged) {
    throw new Error(`Loadout mismatch: expected ${JSON.stringify({ weapon, charged })}, got ${JSON.stringify(current)}`);
  }
}

async function captureRuntimeFrame(name: string): Promise<string> {
  const dataUrl = await call("captureDocumentationFrame") as string;
  const encoded = dataUrl.match(/^data:image\/png;base64,(.+)$/)?.[1];
  if (!encoded) throw new Error("The game did not return a PNG runtime frame.");
  const file = path.join(screenshotDir, `${safeName(name)}.png`);
  await writeFile(file, Buffer.from(encoded, "base64"));
  return file;
}

async function capturePlayer(
  name: string,
  weapon: string,
  charged: boolean,
): Promise<void> {
  await expectLoadout(weapon, charged);
  const framed = await call("focusCamera", ["magic_player_close"]);
  if (framed !== true) throw new Error("The magic_player_close camera shot is unavailable.");
  await driver.wait(1_500);
  captured.push(await captureRuntimeFrame(name));
}

async function captureCache(name: string, entityId: string, element: string): Promise<void> {
  const entity = await call("getEntity", [entityId]) as EntityRead | null;
  if (!entity) throw new Error(`Missing ${element} cache entity ${entityId}.`);
  const framed = await call("focusEntity", [entityId]);
  if (framed !== true) throw new Error(`Could not frame ${element} cache entity ${entityId}.`);
  await driver.wait(1_500);
  captured.push(await captureRuntimeFrame(name));
}

try {
  await driver.launch();
  await driver.open(120_000);
  await driver.reset();
  let magicSeeded = false;

  if (captureWands) {
    if (wandVariant) {
      await clearMainHand();
      await call("clearInventory");
      await call("setSkillLevel", ["magic", wandVariant.magicLevel]);
      await call("giveItem", [wandVariant.itemId, 1, "inventory"]);
      await equip(wandVariant.itemId);
      await capturePlayer(wandVariant.frame, wandVariant.itemId, false);
    } else {
      await capturePlayer("magic-visual-basic-wand-unlit", "basic_wooden_wand", false);

      await call("seedMagic", [10, 100]);
      magicSeeded = true;
      await equip("air_wand");
      await capturePlayer("magic-visual-air-wand-charged", "air_wand", true);
    }
  }

  if (captureStaffs) {
    const isolatedStaff = mode === "basic-staff" || mode === "cairnpine-staff" || mode === "charged-staff";
    if (isolatedStaff) {
      await call("clearInventory");
      await call("setSkillLevel", ["magic", 10]);
    } else if (!magicSeeded) {
      await call("seedMagic", [10, 100]);
    }
    if (mode === "basic-staff") {
      await call("giveItem", ["basic_wooden_staff", 1, "inventory"]);
      await equip("basic_wooden_staff");
      await capturePlayer("magic-visual-basic-staff-unlit", "basic_wooden_staff", false);
    } else if (mode === "cairnpine-staff") {
      await call("giveItem", ["cairnpine_staff", 1, "inventory"]);
      await equip("cairnpine_staff");
      await capturePlayer("magic-wood-cairnpine-staff-unlit", "cairnpine_staff", false);
    } else if (mode === "charged-staff") {
      await call("giveItem", ["water_staff", 1, "inventory"]);
      await equip("water_staff");
      await capturePlayer("magic-visual-water-staff-charged", "water_staff", true);
    } else {
      if (mode !== "staffs-tail") {
        await equip("basic_wooden_staff");
        await capturePlayer("magic-visual-basic-staff-unlit", "basic_wooden_staff", false);
      }

      await equip("palewood_staff");
      await capturePlayer("magic-wood-palewood-staff-unlit", "palewood_staff", false);

      for (const [itemId, name] of [
        ["duskoak_staff", "magic-wood-duskoak-staff-unlit"],
        ["cairnpine_staff", "magic-wood-cairnpine-staff-unlit"],
      ] as const) {
        await equip(itemId);
        await capturePlayer(name, itemId, false);
      }

      await equip("water_staff");
      await capturePlayer("magic-visual-water-staff-charged", "water_staff", true);
    }
  }

  if (captureCaches) {
    for (const [cacheMode, name, entityId, element] of [
      ["air-cache", "magic-cache-air-glow", "fallowmarch_air_essence_cache_1", "air"],
      ["earth-cache", "magic-cache-earth-glow", "vellenwood_earth_essence_cache_1", "earth"],
      ["water-cache", "magic-cache-water-glow", "karrowmoor_water_essence_cache_1", "water"],
    ] as const) {
      if (mode !== "all" && mode !== "caches" && mode !== cacheMode) continue;
      await captureCache(name, entityId, element);
    }
  }

  const browserErrors = [
    ...driver.consoleErrors.map((message) => `console: ${message}`),
    ...driver.pageErrors.map((message) => `page: ${message}`),
    ...driver.requestErrors.map((message) => `request: ${message}`),
  ];
  if (browserErrors.length > 0) throw new Error(browserErrors.join("\n"));
} finally {
  await driver.close();
}

console.log(JSON.stringify({ url, mode, renderer: hardware ? "d3d11" : "swiftshader", captured }, null, 2));
