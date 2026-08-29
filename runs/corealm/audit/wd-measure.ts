/** One-session measurement for the world-detail wave: rocks, farm, water, camera cover. */
import { writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  const page = (driver as unknown as { page: import("playwright").Page }).page;

  const out = await page.evaluate(`(() => {
    const d = window.__gameDebug;
    const g = (x, z) => d.groundHeight(x, z);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const ents = d.getEntities();

    const tarns = [
      { id: "redsill", cx: -40, cz: -60, r: 9 },
      { id: "blackwater", cx: 128, cz: 84, r: 12 },
      { id: "cairn_tarn", cx: 206, cz: -88, r: 8 },
      { id: "far_tarn", cx: 284, cz: -110, r: 7 },
    ];
    const water = tarns.map((t) => {
      const level = g(t.cx, t.cz) + 0.9 * 0.55;
      const half = t.r + 14;
      let above = 0, total = 0, worstAbove = 0;
      for (let x = -half; x <= half; x += 1) {
        for (let z = -half; z <= half; z += 1) {
          if (x * x + z * z > half * half) continue;
          total += 1;
          const h = g(t.cx + x, t.cz + z);
          if (h > level) { above += 1; worstAbove = Math.max(worstAbove, h - level); }
        }
      }
      const shore = [];
      for (let s = 0; s < 16; s += 1) {
        const a = (s / 16) * Math.PI * 2;
        let hit = half;
        for (let rr = 1; rr <= half; rr += 0.5) {
          if (g(t.cx + Math.cos(a) * rr, t.cz + Math.sin(a) * rr) >= level) { hit = rr; break; }
        }
        shore.push(Math.round(hit * 100) / 100);
      }
      return { id: t.id, level: r3(level), centreGround: g(t.cx, t.cz),
        abovePct: Math.round((above / total) * 1000) / 10, worstAbove: r3(worstAbove), shore };
    });

    const fish = ents.filter((e) => e.archetype === "fishing_spot").map((e) => {
      const b = d.getDrawnBounds(e.id);
      return { id: e.id, pos: e.position, ground: g(e.position.x, e.position.z),
        ymin: b ? r3(b.min.y) : null, ymax: b ? r3(b.max.y) : null, w: b ? b.width : null };
    });

    const plots = ents.filter((e) => e.archetype === "farm_plot").map((e) => ({
      id: e.id, pos: e.position, ground: g(e.position.x, e.position.z),
    }));

    const rocks = ents.filter((e) => /gravelmaw_mouth|great_cairn|standing_stone/.test(e.id))
      .map((e) => { const b = d.getDrawnBounds(e.id); return {
        id: e.id, pos: e.position, ground: g(e.position.x, e.position.z),
        ymin: b ? r3(b.min.y) : null, ymax: b ? r3(b.max.y) : null, w: b ? b.width : null }; });

    const cams = {};
    for (const shot of ["bank", "town_center", "redsill_shallows", "marchfield_farm", "great_cairn", "gravelmaw_entrance", "karrowmoor_terraces", "rootfall", "highcairn"]) {
      d.focusCamera(shot);
      cams[shot] = { cam: d.getCamera(), player: d.getPlayerPosition(),
        ground: g(d.getPlayerPosition().x, d.getPlayerPosition().z) };
    }

    const buildings = d.listBuildings().filter((b) => ["porch","arcade","forge","well","market_row"].includes(b.prefab));

    return { water, fish, plots, rocks, cams, buildings, scene: d.getSceneStats ? d.getSceneStats() : null };
  })()`);
  await writeFile("runs/corealm/audit/wd-measure.json", JSON.stringify(out, null, 1));
  console.log("wrote runs/corealm/audit/wd-measure.json");
} finally {
  await driver.close();
  await server.close();
}
