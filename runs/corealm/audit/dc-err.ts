import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
await driver.launch(); await driver.open();
const page = (driver as any).page;
page.on("console", (m: any) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 300)); });
page.on("pageerror", (e: any) => console.log("PAGEERROR", String(e).slice(0, 600)));
page.on("crash", () => console.log("PAGE CRASHED"));
const shots = await page.evaluate(() => (window as any).__gameDebug.listShots());
for (const s of shots) {
  try {
    await page.evaluate((id: string) => (window as any).__gameDebug.focusCamera(id), s);
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => (window as any).__gameDebug.getMetrics());
    console.log(s, "dc", m.drawCalls, "tris", m.triangles, "frameMs", m.frameMs);
  } catch (e) { console.log("FAILED at", s, String(e).slice(0, 200)); break; }
}
const errs = await page.evaluate(() => (window as any).__gameDebug.getErrors()).catch(() => "n/a");
console.log("errors", JSON.stringify(errs).slice(0, 1500));
await driver.close(); await server.close();
