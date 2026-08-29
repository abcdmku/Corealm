/**
 * Scratch: one driver session that counts the enemy roster and frames every new group.
 *
 * One session on purpose. Every capture here is `teleport({entityId})` onto the group's first
 * member, so the follow camera frames the group without needing a shot preset per spawn.
 */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

interface Ent { id: string; regionId: string; archetype: string; name: string; tier: number;
  position: [number, number, number]; meta?: { groupId?: string; family?: string } }

const NEW_GROUPS: { group: string; preset: string }[] = [
  { group: "bracken_fenmites", preset: "bracken_pit" },
  { group: "redsill_mudbacks", preset: "redsill_shallows" },
  { group: "march_road_reavers", preset: "palewood_copse" },
  { group: "palewood_hollows", preset: "palewood_copse" },
  { group: "mire_fenmites", preset: "hollowcut_seam" },
  { group: "gorge_reavers", preset: "hollowcut_seam" },
  { group: "canopy_hollows", preset: "vellenwood_canopy" },
  { group: "terrace_mudbacks", preset: "karrowmoor_terraces" },
  { group: "karrow_reavers", preset: "karrowmoor_terraces" },
  { group: "tarn_marchwolves", preset: "highcairn" },
];

const PRESET_SHOTS = ["bracken_pit", "march_road", "vellenwood_canopy", "hollowcut_seam", "upper_karrow_seam"];

async function main(): Promise<void> {
  const shots = path.resolve("runs/corealm/screenshots");
  const server = await startGameServer();
  const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
  try {
    await driver.launch();
    await driver.open();

    const enemies = await driver.callDebug("listEntities", [{ archetype: "enemy" }]) as Ent[];
    const bosses = await driver.callDebug("listEntities", [{ archetype: "boss" }]) as Ent[];
    const byRegion = new Map<string, number>();
    const byGroup = new Map<string, { n: number; region: string; tier: number; name: string }>();
    for (const e of [...enemies, ...bosses]) {
      byRegion.set(e.regionId, (byRegion.get(e.regionId) ?? 0) + 1);
      const g = e.meta?.groupId ?? e.id;
      const row = byGroup.get(g) ?? { n: 0, region: e.regionId, tier: e.tier, name: e.name };
      row.n += 1;
      byGroup.set(g, row);
    }
    console.log(`AFTER: enemy ${enemies.length} + boss ${bosses.length} = ${enemies.length + bosses.length}`);
    for (const [region, n] of [...byRegion].sort()) console.log(`  region ${region.padEnd(12)} ${n}`);
    for (const [g, row] of [...byGroup].sort((a, b) => a[1].region.localeCompare(b[1].region) || a[0].localeCompare(b[0]))) {
      console.log(`  ${row.region.padEnd(12)} ${g.padEnd(28)} t${String(row.tier).padEnd(3)} x${row.n}  ${row.name}`);
    }

    const perf = await driver.callDebug("getSceneStats", []) as Record<string, unknown>;
    console.log("scene stats: " + JSON.stringify(perf));

    for (const { group, preset } of NEW_GROUPS) {
      await driver.callDebug("setCameraPreset", [preset]);
      await driver.wait(200);
      await driver.callDebug("setHealth", [999]);
      const ok = await driver.callDebug("teleport", [{ entityId: `${group}_1` }]);
      await driver.wait(1400);
      const file = await driver.screenshot(shots, `MON-${group.replace(/_/g, "-")}`);
      console.log(`shot ${group} teleport=${String(ok)} -> ${file}`);
    }

    // The dungeon groups need the portal, because chamber geometry only exists inside the region.
    await driver.callDebug("teleport", [{ locationId: "gravelmaw_entrance" }]);
    await driver.wait(400);
    await driver.callDebug("callTool", ["corealm_interact", { entityId: "gravelmaw_mouth_portal", interaction: "enter" }]);
    await driver.wait(900);
    for (const group of ["gravelmaw_ch1_reavers", "gravelmaw_ch2_mudbacks"]) {
      await driver.callDebug("setHealth", [999]);
      const ok = await driver.callDebug("teleport", [{ entityId: `${group}_1` }]);
      await driver.wait(1400);
      const file = await driver.screenshot(shots, `MON-${group.replace(/_/g, "-")}`);
      console.log(`shot ${group} teleport=${String(ok)} region=${String((await driver.callDebug("getState", []) as { regionId?: string }).regionId)} -> ${file}`);
    }

    for (const preset of PRESET_SHOTS) {
      await driver.callDebug("setCameraPreset", [preset]);
      await driver.wait(1200);
      const file = await driver.screenshot(shots, `MON-preset-${preset.replace(/_/g, "-")}`);
      console.log(`shot preset ${preset} -> ${file}`);
    }

    const errors = await driver.callDebug("getErrors", []);
    console.log("errors: " + JSON.stringify(errors));
  } finally {
    await driver.close();
    await server.close();
  }
}

await main();
