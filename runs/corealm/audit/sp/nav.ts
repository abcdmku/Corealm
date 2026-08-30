/**
 * Can the player still walk through everything this pass rebuilt?
 *
 * The region gate went from two free-standing wall panels to two closed 2 x 2 m masonry piers, and
 * the wellhead curb went from a 0.167 m trim ring to 0.55 m of collided masonry. Both are new
 * navmesh obstacles on ground a player has to cross, so both need a path check rather than a
 * screenshot.
 *
 *   npx tsx runs/corealm/audit/sp/nav.ts
 */
import { GameDriver } from "../../../../tools/lib/driver.js";
import { startGameServer } from "../../../../tools/lib/server.js";

/** `getNavPath` answers an array of `{x, y, z}` waypoints, or null when Detour finds nothing. */
type PathResult = { x: number; y: number; z: number }[] | null;

const server = await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 900, height: 600 },
  settings: {
    renderScale: 0.7, shadowQuality: "off", drawDistance: "near",
    damageNumbers: false, invertCameraY: false, uiScale: "normal",
    music: 0, ambient: 0, sfx: 0,
  },
});
await driver.launch();
await driver.open(180_000);

const ground = async (x: number, z: number): Promise<number> =>
  Number(await driver.callDebug("groundHeight", [x, z]));

/** Straight-line metres against path metres: a detour means something is in the way. */
async function crossing(label: string, ax: number, az: number, bx: number, bz: number): Promise<void> {
  const ay = await ground(ax, az);
  const by = await ground(bx, bz);
  const path = await driver.callDebug("getNavPath", [[ax, ay, az], [bx, by, bz]]) as PathResult;
  const direct = Math.hypot(bx - ax, bz - az);
  if (!path || path.length < 2) {
    console.log(`${label.padEnd(34)} direct ${direct.toFixed(1)} m  NO PATH`);
    return;
  }
  let walked = 0;
  for (let i = 1; i < path.length; i += 1) {
    walked += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
  }
  const detour = walked / direct;
  console.log(
    `${label.padEnd(34)} direct ${direct.toFixed(1)} m  path ${walked.toFixed(1)} m`
    + `  x${detour.toFixed(2)}  ${path.length} waypoints${detour > 1.35 ? "   DETOUR" : ""}`,
  );
}

// Every region gate, crossed along the road axis it stands on.
await crossing("fallowmarch north gate", -26, 110, -26, 126);
await crossing("vellenwood marchgate", -12, 114, -12, 130);
await crossing("vellenwood cairn gate", 242, 24, 258, 24);
await crossing("karrowmoor moorgate", 248, 4, 264, 4);
// The wellhead, which now has a 0.55 m collided curb in the middle of Coldbrace's square.
await crossing("coldbrace square past the well", -170, -77, -158, -77);
await crossing("coldbrace square across the well", -164, -83, -164, -71);
// The paved edges that were re-tiled.
await crossing("coldbrace gate street", -160, -112, -160, -90);

console.log("\nconsole errors", driver.consoleErrors.slice(0, 6));
console.log("page errors", driver.pageErrors.slice(0, 6));
await driver.close();
await server.close();
