/** Worker key ev2. Who holds a live rig, and does an enemy animate while you fight it? */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startFrozenServer } from "./ev2-server.js";

const prefix = process.argv[2] ?? "ev2-before";
const out = path.join(process.cwd(), "runs", "corealm", "screenshots");
interface Ent { id: string; archetype: string; regionId: string; position: number[]; state: string }

const server = await startFrozenServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
try {
  await driver.launch();
  await driver.open();
  await driver.wait(5000);

  const all = (await driver.callDebug("listEntities")) as Ent[];
  const chars = all.filter((e) => ["npc", "enemy", "boss"].includes(e.archetype));
  const paths = new Map<string, number>();
  const animatedIds: string[] = [];
  for (const e of chars) {
    const b = (await driver.callDebug("getDrawnBounds", [e.id])) as { path: string } | null;
    const key = b ? b.path.split(":")[0]! : "none";
    paths.set(`${e.archetype}:${key}`, (paths.get(`${e.archetype}:${key}`) ?? 0) + 1);
    if (b?.path.startsWith("animated")) animatedIds.push(`${e.archetype} ${e.id} ${e.regionId} ${b.path}`);
  }
  console.log("BY PATH", JSON.stringify([...paths.entries()].sort()));
  for (const line of animatedIds) console.log("  rigged:", line);

  const target = all.find((e) => e.archetype === "enemy" && e.regionId === "fallowmarch" && e.state !== "dead");
  if (!target) throw new Error("no enemy");
  const [x = 0, y = 0, z = 0] = target.position;
  await driver.callDebug("setSkillLevel", ["attack", 60]);
  await driver.callDebug("setSkillLevel", ["strength", 60]);
  await driver.callDebug("teleport", [[x + 2.5, y, z + 2.5]]);
  await driver.wait(1500);
  console.log("target", target.id, "bounds", JSON.stringify(await driver.callDebug("getDrawnBounds", [target.id])));
  console.log("views@fight", JSON.stringify(await driver.callDebug("getEntityViewStats")));

  await driver.callDebug("callTool", ["corealm_attack", { entityId: target.id }]);
  await driver.wait(700);
  await driver.screenshot(out, `${prefix}-enemy-attack`);
  console.log("mid-attack bounds", JSON.stringify(await driver.callDebug("getDrawnBounds", [target.id])));

  for (let i = 0; i < 40; i += 1) {
    await driver.callDebug("callTool", ["corealm_attack", { entityId: target.id }]);
    await driver.wait(350);
    const e = (await driver.callDebug("getEntity", [target.id])) as { state: string } | null;
    if (e?.state === "dead") break;
  }
  await driver.wait(400);
  await driver.screenshot(out, `${prefix}-enemy-death`);
  const e = (await driver.callDebug("getEntity", [target.id])) as { state: string } | null;
  console.log("after", e?.state, JSON.stringify(await driver.callDebug("getDrawnBounds", [target.id])));
  console.log("views@death", JSON.stringify(await driver.callDebug("getEntityViewStats")));
  console.log("errors", JSON.stringify(await driver.callDebug("getErrors")));
} finally {
  await driver.close();
  await server.close();
}
