/**
 * Guidance proof: drives the real game through the agent surface and photographs the marker, the
 * ground ribbon, the re-plan as the player moves, arrival, and the plan's cursor advancing.
 *
 *   npx tsx runs/corealm/audit/guidance-shots.ts
 *
 * Output: runs/corealm/screenshots/guidance-*.png plus a JSON line per checkpoint on stdout.
 *
 * Harness notes. This renders at about one frame a second on SwiftShader, and events publish on
 * the sim tick, so every read that expects an event long-polls rather than reading straight after
 * the move. The camera is the ordinary follow camera: `inspectPose` relocates the player, which is
 * not what a guidance photograph wants.
 */
import path from "node:path";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";

type Vec3 = [number, number, number];
type Json = Record<string, unknown>;

const server = await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  settings: {
    renderScale: 1,
    shadowQuality: "off",
    drawDistance: "near",
    damageNumbers: true,
    invertCameraY: false,
    uiScale: "normal",
    music: 0,
    ambient: 0,
    sfx: 0,
  },
});

const tool = (name: string, args: Json = {}): Promise<unknown> => driver.callDebug("callTool", [name, args]);
const out = path.join(process.cwd(), "runs", "corealm", "screenshots");
/** Two or three frames in this harness. */
const SETTLE_MS = 2_600;

async function cursor(): Promise<number> {
  return (await tool("corealm_events", { sinceSeq: 0 }) as { nextSeq: number }).nextSeq;
}

async function awaitEvents(since: number, types: string[]): Promise<Json[]> {
  const batch = await tool("corealm_events", { sinceSeq: since, types, timeoutMs: 12_000 }) as { events: { type: string; data: Json }[] };
  return batch.events.map((event) => ({ type: event.type, ...event.data }));
}

try {
  await driver.launch();
  await driver.open(240_000);
  await driver.callDebug("reset", [{ seed: 1337 }]);
  await driver.wait(SETTLE_MS);

  await tool("corealm_session", { op: "connect", agentName: "Guidance proof" });
  await tool("corealm_session", { op: "set_mode", mode: "assist" });

  // 1. A previewed route: marker + ribbon from the player's feet, follow camera.
  const start = (await tool("corealm_player") as { position: Vec3 }).position;
  const route = await tool("corealm_route", { locationId: "bracken_pit", label: "Ore here" }) as { points: Vec3[]; pathLength: number; drawn: boolean };
  console.log(JSON.stringify({ step: "route", drawn: route.drawn, pathLength: route.pathLength, points: route.points.length, start }));
  const pit = route.points.at(-1)!;
  await driver.wait(SETTLE_MS);
  console.log(await driver.screenshot(out, "guidance-route"));

  // 2. Move to 22 m short of the pit: the ribbon re-plans from there, the pin and label are in frame.
  const approach = (): Vec3 => {
    for (let index = route.points.length - 2; index >= 0; index -= 1) {
      const point = route.points[index]!;
      const gap = Math.hypot(pit[0] - point[0], pit[2] - point[2]);
      if (gap < 22) continue;
      const t = (gap - 22) / gap;
      return [point[0] + (pit[0] - point[0]) * t, point[1], point[2] + (pit[2] - point[2]) * t];
    }
    return route.points[0]!;
  };
  await driver.callDebug("teleport", [approach()]);
  await driver.wait(SETTLE_MS);
  console.log(await driver.screenshot(out, "guidance-route-replanned"));

  // 3. Arrive: the marker clears itself and says so on the event stream.
  const beforeArrival = await cursor();
  await driver.callDebug("teleport", [[pit[0] + 3, pit[1], pit[2] + 3]]);
  const arrived = await awaitEvents(beforeArrival, ["overlay.arrived"]);
  console.log(JSON.stringify({ step: "arrived", events: arrived }));
  await driver.wait(SETTLE_MS);
  console.log(await driver.screenshot(out, "guidance-route-arrived"));

  // 4. A plan: the current step marked with the ribbon, the next as a label, the panel's cursor.
  await driver.callDebug("teleport", [start]);
  await driver.wait(SETTLE_MS);
  const known = await tool("corealm_observe", { scope: "known", limit: 12 }) as { id: string; locationId?: string; name: string; distance: number }[];
  const place = known.find((row) => row.locationId && row.locationId !== "bracken_pit" && row.distance > 20);
  const second = place?.locationId ?? "town_center";
  const proposal = await tool("corealm_propose", {
    summary: "Mine six Grithe ore for Cold Iron",
    steps: [
      { text: "Walk to the Bracken Pit", locationId: "bracken_pit" },
      { text: "Mine six Grithe ore", done: "manual" },
      { text: `Carry it to ${place?.name ?? "town"}`, locationId: second },
    ],
  });
  console.log(JSON.stringify({ step: "propose", proposal, second }));
  await driver.wait(SETTLE_MS);
  console.log(await driver.screenshot(out, "guidance-plan"));

  // 5. Reach step 1: it clears, the cursor moves on, and the agent hears about it.
  const beforeStep = await cursor();
  await driver.callDebug("teleport", [[pit[0] + 2, pit[1], pit[2] + 2]]);
  const guide = await awaitEvents(beforeStep, ["agent.guide"]);
  const session = await tool("corealm_session", { op: "read" }) as { proposal: { currentStep: number | null; steps: { status: string }[] } };
  console.log(JSON.stringify({ step: "advanced", events: guide, cursor: session.proposal.currentStep, statuses: session.proposal.steps.map((s) => s.status) }));
  await driver.wait(SETTLE_MS);
  console.log(await driver.screenshot(out, "guidance-plan-advanced"));

  // 6. The agent ticks the manual step off; step 3 lights up with its own ribbon.
  const beforeAdvance = await cursor();
  console.log(JSON.stringify({ step: "advance", result: await tool("corealm_propose", { advance: true }) }));
  console.log(JSON.stringify({ step: "advance-events", events: await awaitEvents(beforeAdvance, ["agent.guide"]) }));
  await driver.wait(SETTLE_MS);
  console.log(await driver.screenshot(out, "guidance-plan-step3"));
  const panel = await driver.page!.evaluate("(() => Array.from(document.querySelectorAll('.agent-panel__steps li')).map((li) => li.className + ':' + li.textContent))()");
  console.log(JSON.stringify({ step: "panel", panel }));

  const diagnostics = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
  if (diagnostics.console.length || diagnostics.page.length || diagnostics.request.length) {
    throw new Error(`Browser diagnostics: ${JSON.stringify(diagnostics)}`);
  }
} finally {
  await driver.close();
  await server.close();
}
