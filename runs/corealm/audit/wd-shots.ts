/**
 * World-detail verification in ONE browser session: the eight acceptance poses, the three
 * walk-under-roof camera cases, and the water / composition-grounding measurements.
 *
 *   npx tsx runs/corealm/audit/wd-shots.ts [prefix]
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

const prefix = process.argv[2] ?? "wd";
const SHOTS = [
  "gravelmaw_entrance", "great_cairn", "karrowmoor_terraces", "marchfield_farm",
  "redsill_shallows", "bank", "town_center", "rootfall",
];
const COVER: readonly { name: string; from: string; x: number; z: number }[] = [
  { name: "porch", from: "bank", x: -163.4, z: -89 },
  { name: "forge", from: "bank", x: -145.5, z: -86 },
  { name: "arcade", from: "town_center", x: -170.9, z: -80 },
];

const vite = await createServer({
  root: gameRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
const server = {
  url: `http://127.0.0.1:${address.port}`,
  close: async (): Promise<void> => { await vite.close(); },
};

interface PageLike {
  evaluate<T>(fn: string): Promise<T>;
  screenshot(options: { path: string; type: "png"; timeout: number }): Promise<unknown>;
  on(event: string, handler: (message: { type(): string; text(): string }) => void): void;
}

// Four other agents are driving their own headless Chromium on this machine while this runs, so
// a 1440x900 capture can sit behind theirs for well past the driver's fixed 30 s.
const SHOT_TIMEOUT_MS = 150_000;
async function shoot(page: PageLike, dir: string, name: string): Promise<void> {
  await page.screenshot({ path: path.join(dir, `${name}.png`), type: "png", timeout: SHOT_TIMEOUT_MS });
}

const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  const page = (driver as unknown as { page: PageLike }).page;
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400));
  });
  const out = path.join("runs", "corealm", "screenshots");
  const report: Record<string, unknown> = {};

  const perShot: Record<string, unknown> = {};
  for (const shot of SHOTS) {
    await driver.callDebug("setCameraPreset", [shot]);
    await driver.wait(900);
    await shoot(page, out, `${prefix}-${shot}`);
    perShot[shot] = await page.evaluate(
      "(() => { const d = window.__gameDebug; const m = d.getMetrics();"
      + " return { calls: m.drawCalls || 0, tris: m.triangles || 0, cam: d.getCamera(),"
      + " player: d.getPlayerPosition() }; })()",
    );
    const row = perShot[shot] as { calls: number; tris: number };
    console.log(`${shot.padEnd(22)} calls ${String(row.calls).padStart(4)}  tris ${(row.tris / 1e6).toFixed(2)}M`);
  }
  report.shots = perShot;

  const cover: Record<string, unknown> = {};
  for (const spot of COVER) {
    await driver.callDebug("setCameraPreset", [spot.from]);
    await driver.wait(200);
    const y = await driver.callDebug("groundHeight", [spot.x, spot.z]) as number;
    await driver.callDebug("teleport", [[spot.x, y, spot.z]]);
    await driver.wait(1200);
    await shoot(page, out, `${prefix}-cover-${spot.name}`);
    cover[spot.name] = await page.evaluate(
      "(() => { const d = window.__gameDebug;"
      + " return { cam: d.getCamera(), player: d.getPlayerPosition(),"
      + " ground: d.groundHeight(d.getPlayerPosition().x, d.getPlayerPosition().z) }; })()",
    );
    console.log(spot.name, JSON.stringify(cover[spot.name]));
  }
  report.cover = cover;

  report.measure = await page.evaluate(`(() => {
    const d = window.__gameDebug;
    const g = (x, z) => d.groundHeight(x, z);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const tarns = [
      { id: "redsill", cx: -40, cz: -60, r: 9 },
      { id: "blackwater", cx: 128, cz: 84, r: 12 },
      { id: "cairn_tarn", cx: 206, cz: -88, r: 8 },
      { id: "far_tarn", cx: 284, cz: -110, r: 7 },
    ];
    // Above-surface fraction of the DRAWN disc: for each 1 m sample inside the rect, find the
    // shoreline on its own bearing at the resolution the mesh is now built at, and only count the
    // sample if it is inside that shoreline.
    const water = tarns.map((t) => {
      const level = g(t.cx, t.cz) + 0.9 * 0.55;
      const half = t.r + 14;
      const segs = Math.max(32, Math.min(192, Math.round((2 * Math.PI * half) / 2)));
      const shore = new Float64Array(segs);
      for (let s = 0; s < segs; s += 1) {
        const a = (s / segs) * Math.PI * 2;
        let low = 0;
        for (let rr = 0.5; rr <= half; rr += 0.5) {
          if (g(t.cx + Math.cos(a) * rr, t.cz + Math.sin(a) * rr) >= level) break;
          low = rr;
        }
        shore[s] = Math.max(2.5, low);
      }
      let above = 0, total = 0, worst = 0;
      for (let x = -half; x <= half; x += 1) {
        for (let z = -half; z <= half; z += 1) {
          const rr = Math.hypot(x, z);
          if (rr > half || rr < 0.5) continue;
          let a = Math.atan2(z, x);
          if (a < 0) a += Math.PI * 2;
          const bin = Math.round((a / (Math.PI * 2)) * segs) % segs;
          if (rr > shore[bin]) continue;
          total += 1;
          const h = g(t.cx + x, t.cz + z);
          if (h > level) { above += 1; worst = Math.max(worst, h - level); }
        }
      }
      let maxShore = 0;
      for (let s = 0; s < segs; s += 1) maxShore = Math.max(maxShore, shore[s]);
      return { id: t.id, segs, level: r3(level), covered: total,
        abovePct: total === 0 ? 0 : Math.round((above / total) * 1000) / 10,
        worstAbove: r3(worst), maxShore: r3(maxShore) };
    });

    // Composition grounding: every part of the two rock landmarks, drawn bottom against the ground
    // under it. Positive = floating.
    const rocks = d.getEntities()
      .filter((e) => /gravelmaw_mouth_portal#|great_cairn_stone#|thornline_stones#/.test(e.id))
      .map((e) => {
        const b = d.getDrawnBounds(e.id);
        const ground = g(e.position.x, e.position.z);
        return { id: e.id, gap: b ? r3(b.min.y - ground) : null,
          top: b ? r3(b.max.y - ground) : null, w: b ? b.w ?? b.width : null };
      });
    const floating = rocks.filter((r) => (r.gap ?? 0) > 0.05);

    return { water, rocks, floatingCount: floating.length,
      worstFloat: rocks.reduce((a, r) => Math.max(a, r.gap ?? 0), 0),
      grounding: d.checkGrounding ? d.checkGrounding().slice(0, 8) : null,
      scene: d.getSceneStats ? d.getSceneStats() : null };
  })()`);

  report.consoleErrors = consoleErrors.slice(0, 20);
  report.gameErrors = await driver.callDebug("getErrors");
  await writeFile(`runs/corealm/audit/${prefix}-shots.json`, JSON.stringify(report, null, 1));
  console.log("wrote", `runs/corealm/audit/${prefix}-shots.json`);
} finally {
  await driver.close();
  await server.close();
}
