/** Terrain probes: tarn rim profiles, and polar ground around the two rock landmarks + the farm. */
import { writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 800, height: 600 } });
try {
  await driver.launch();
  await driver.open();
  const page = (driver as unknown as { page: import("playwright").Page }).page;
  const out = await page.evaluate(`(() => {
    const d = window.__gameDebug;
    const g = (x, z) => d.groundHeight(x, z);
    const r2 = (v) => Math.round(v * 100) / 100;

    const tarns = [
      { id: "redsill", cx: -40, cz: -60, r: 9 },
      { id: "blackwater", cx: 128, cz: 84, r: 12 },
      { id: "cairn_tarn", cx: 206, cz: -88, r: 8 },
      { id: "far_tarn", cx: 284, cz: -110, r: 7 },
    ];
    const rims = tarns.map((t) => {
      const half = t.r + 14;
      const rays = [];
      for (let s = 0; s < 32; s += 1) {
        const a = (s / 32) * Math.PI * 2;
        const prof = [];
        for (let rr = 0; rr <= half; rr += 1) prof.push(r2(g(t.cx + Math.cos(a) * rr, t.cz + Math.sin(a) * rr)));
        rays.push(prof);
      }
      const rim = rays.map((p) => Math.max(...p));
      return { id: t.id, centre: r2(g(t.cx, t.cz)), requested: r2(g(t.cx, t.cz) + 0.495),
        spill: r2(Math.min(...rim)), rimMax: r2(Math.max(...rim)), rim: rim.map(r2), rays };
    });

    const polar = (cx, cz, radii) => {
      const rows = {};
      for (const rr of radii) {
        const row = [];
        for (let s = 0; s < 16; s += 1) {
          const a = (s / 16) * Math.PI * 2;
          row.push(r2(g(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr) - g(cx, cz)));
        }
        rows[rr] = row;
      }
      return { origin: r2(g(cx, cz)), rows };
    };

    return {
      rims,
      gravelmaw: polar(46, -24, [3, 5, 7, 9, 11, 13]),
      greatCairn: polar(140, -176, [3, 5, 7, 9, 11]),
      thornline: polar(206, 168, [3, 5, 7, 9]),
      farm: polar(-96, -22, [4, 8, 12, 16, 20]),
    };
  })()`);
  await writeFile("runs/corealm/audit/wd-probe.json", JSON.stringify(out, null, 1));
  console.log("ok");
} finally {
  await driver.close();
  await server.close();
}
