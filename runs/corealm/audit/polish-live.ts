/**
 * One-session browser acceptance for the world-polish round.
 *
 * The root runs this after the build gate. It observes real DOM controls, real player translation
 * and mixer time, live humanoid render records, and the scatter pass that completed during boot.
 * No animation result is inferred from source constants.
 *
 *   npx tsx runs/corealm/audit/polish-live.ts
 */
import { createServer } from "vite";
import { GameDriver } from "../../../tools/lib/driver.js";
import { gameRoot } from "../../../tools/lib/paths.js";

interface CheckResult {
  section: string;
  ok: boolean;
  detail: string;
}

interface Position {
  x: number;
  y: number;
  z: number;
}

interface PlayerMotion {
  pose?: string;
  clip?: string | null;
  time?: number;
  duration?: number;
  timeScale?: number;
}

interface PlayerSample {
  at: number;
  position: Position;
  motion: PlayerMotion | null;
}

interface EntityMotion {
  entityId?: string;
  liveRig?: boolean;
  path?: string | null;
  semanticPosition?: number[];
  drawnPosition?: number[];
  semanticRotationY?: number;
  drawnRotationY?: number;
  facing?: number[];
  motion?: string | null;
  clip?: string | null;
  time?: number | null;
  duration?: number | null;
  timeScale?: number | null;
}

interface EntitySample {
  at: number;
  motion: EntityMotion | null;
  player: Position;
}

const results: CheckResult[] = [];
const GPU_ARGS = [
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--mute-audio",
];
function check(section: string, ok: boolean, detail: string): void {
  results.push({ section, ok, detail });
}

function distance(a: Position, b: Position): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function arrayDistance(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b || a.length < 3 || b.length < 3) return NaN;
  return Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
}

function angleDifference(a: number | undefined, b: number | undefined): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(Math.atan2(Math.sin(a! - b!), Math.cos(a! - b!)));
}

function phaseAdvances(samples: readonly { time?: number | null; duration?: number | null }[]): number {
  let advances = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current || !Number.isFinite(previous.time) || !Number.isFinite(current.time)) continue;
    const duration = Number.isFinite(current.duration) && current.duration! > 0 ? current.duration! : 0;
    let delta = current.time! - previous.time!;
    if (delta < -0.02 && duration > 0) delta += duration;
    if (delta > 0.015) advances += 1;
  }
  return advances;
}

const vite = await createServer({
  root: gameRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await vite.listen();
const address = vite.httpServer?.address();
if (!address || typeof address === "string") throw new Error("Vite did not expose a TCP port");
const server = {
  url: `http://127.0.0.1:${address.port}`,
  close: async (): Promise<void> => { await vite.close(); },
};

const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: GPU_ARGS,
});
try {
  await driver.launch();
  await driver.open(90_000);
  if (!driver.page) throw new Error("GameDriver launched without a page");
  const page = driver.page;
  console.log("polish-live: booted");

  // --------------------------------------------------------------- grass live census

  const scatter = await driver.callDebug("getScatterStats") as {
    available?: boolean;
    reason?: string;
    regions?: {
      regionId: string;
      placed: number;
      instancedMeshes: number;
      estimatedTriangles: number;
      byLayer: Record<string, number>;
      missingAssets: string[];
    }[];
  };
  check("grass-live", scatter.available === true, `scatter stats are observable${scatter.reason ? `: ${scatter.reason}` : ""}`);
  const surfaceScatter = (scatter.regions ?? []).filter((region) => region.regionId !== "gravelmaw");
  check("grass-live", surfaceScatter.length === 3, `${surfaceScatter.length} surface-region scatter reports returned`);
  for (const region of surfaceScatter) {
    const blade = region.byLayer.bladecarpet ?? 0;
    const dense = blade + (region.byLayer.groundcover ?? 0) + (region.byLayer.carpet ?? 0);
    check("grass-live", blade >= 25_000, `${region.regionId} placed ${blade.toLocaleString()} generated bladecarpet cards`);
    check("grass-live", dense >= 50_000, `${region.regionId} placed ${dense.toLocaleString()} dense-cover instances`);
    check("grass-live", region.missingAssets.length === 0, `${region.regionId} missing scatter assets: ${region.missingAssets.join(", ") || "none"}`);
    check("grass-live", region.instancedMeshes > 0 && region.estimatedTriangles > 0, `${region.regionId} emitted ${region.instancedMeshes} meshes and ${region.estimatedTriangles.toLocaleString()} measured triangles`);
  }

  // ------------------------------------------------------------ Journal is Quests

  await driver.press("j");
  console.log("polish-live: opening quests");
  await driver.wait(150);
  const questUi = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#panel-quests");
    const debug = window.__gameDebug as unknown as {
      getKeyBindings?(): { id?: string; keys?: string[]; label?: string }[];
    } | undefined;
    const bindings = typeof debug?.getKeyBindings === "function" ? debug.getKeyBindings() : undefined;
    const questBinding = bindings?.find((binding) => binding.id === "panel.quests");
    const dock = [...document.querySelectorAll<HTMLElement>(".dock__btn")].find((button) =>
      button.querySelector(".dock__key")?.textContent?.trim().toLowerCase() === "j");
    const chrome = [
      ...document.querySelectorAll<HTMLElement>(".panel__title, .dock__label, .controls__label"),
    ].filter((node) => node.offsetParent !== null).map((node) => node.textContent?.trim() ?? "");
    return {
      exists: Boolean(panel),
      open: Boolean(panel && !panel.hidden),
      title: panel?.querySelector(".panel__title")?.textContent?.trim() ?? null,
      aria: panel?.getAttribute("aria-label") ?? null,
      closeAria: panel?.querySelector(".panel__close")?.getAttribute("aria-label") ?? null,
      binding: questBinding ?? null,
      dockLabel: dock?.querySelector(".dock__label")?.textContent?.trim() ?? null,
      journalChrome: chrome.filter((text) => /journal/i.test(text)),
    };
  });
  check("quests-rename", questUi.exists && questUi.open, "J opens #panel-quests in the live UI");
  check("quests-rename", questUi.title === "Quests" && questUi.aria === "Quests", `panel title/aria are ${questUi.title}/${questUi.aria}`);
  check("quests-rename", questUi.closeAria === "Close Quests", `close control is labelled ${questUi.closeAria}`);
  check(
    "quests-rename",
    questUi.binding?.label === "Quests" && questUi.binding?.keys?.includes("j") === true,
    `live key binding is ${JSON.stringify(questUi.binding)}`,
  );
  check("quests-rename", questUi.dockLabel === "Quests", `J dock label is ${questUi.dockLabel}`);
  check("quests-rename", questUi.journalChrome.length === 0, `visible UI chrome containing Journal: ${questUi.journalChrome.join(", ") || "none"}`);
  await driver.press("j");

  // --------------------------------------------------------- real map interaction

  await driver.press("m");
  console.log("polish-live: opening map");
  await driver.wait(600);
  const mapInitial = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#panel-map");
    const figure = panel?.querySelector<HTMLElement>(".map__figure");
    const canvas = panel?.querySelector<HTMLCanvasElement>("canvas.map__canvas");
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    const colours = new Set<string>();
    if (canvas && context && canvas.width > 0 && canvas.height > 0) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const stepX = Math.max(1, Math.floor(canvas.width / 28));
      const stepY = Math.max(1, Math.floor(canvas.height / 18));
      for (let y = 0; y < canvas.height; y += stepY) {
        for (let x = 0; x < canvas.width; x += stepX) {
          const offset = (y * canvas.width + x) * 4;
          colours.add(`${image[offset]},${image[offset + 1]},${image[offset + 2]},${image[offset + 3]}`);
        }
      }
    }
    return {
      open: Boolean(panel && !panel.hidden),
      canvas: canvas ? { width: canvas.width, height: canvas.height, colours: colours.size } : null,
      zoom: figure?.dataset.mapZoom ?? null,
      centreU: figure?.dataset.mapCentreU ?? null,
      centreV: figure?.dataset.mapCentreV ?? null,
      labels: figure?.dataset.mapLabels ?? null,
      worldBounds: figure?.dataset.mapWorldBounds ?? null,
      figureAria: figure?.getAttribute("aria-label") ?? null,
      controls: [...(panel?.querySelectorAll<HTMLButtonElement>(".map__control") ?? [])].map((button) => ({
        label: button.getAttribute("aria-label"),
        pressed: button.getAttribute("aria-pressed"),
      })),
    };
  });
  check("map-live", mapInitial.open, "M opens the map panel");
  check("map-live", Boolean(mapInitial.canvas && mapInitial.canvas.width >= 600 && mapInitial.canvas.height >= 300), `terrain canvas is ${mapInitial.canvas?.width ?? 0}x${mapInitial.canvas?.height ?? 0}`);
  check("map-live", (mapInitial.canvas?.colours ?? 0) >= 24, `terrain canvas sample contains ${mapInitial.canvas?.colours ?? 0} distinct colours`);
  check("map-live", mapInitial.zoom === "1.000" && mapInitial.labels === "shown", `initial map state is zoom=${mapInitial.zoom}, labels=${mapInitial.labels}`);
  interface MapBounds { minX?: number; maxX?: number; minZ?: number; maxZ?: number }
  let parsedBounds: MapBounds | null = null;
  try { parsedBounds = mapInitial.worldBounds ? JSON.parse(mapInitial.worldBounds) as MapBounds : null; } catch { parsedBounds = null; }
  check(
    "map-live",
    Boolean(parsedBounds && (parsedBounds.maxX ?? 0) - (parsedBounds.minX ?? 0) >= 500 && (parsedBounds.maxZ ?? 0) - (parsedBounds.minZ ?? 0) >= 250),
    `canvas reports real world bounds ${mapInitial.worldBounds}`,
  );
  check("map-live", /drag to pan/i.test(mapInitial.figureAria ?? "") && /wheel to zoom/i.test(mapInitial.figureAria ?? ""), `map interaction help is ${mapInitial.figureAria}`);

  // The full world keeps rendering behind this non-modal panel. In software-rendered CI,
  // Playwright's actionability loop can time out after the native click has already fired, so
  // invoke the visible control's real DOM click and verify the resulting live state below.
  await page.getByRole("button", { name: "Zoom map in" }).evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole("button", { name: "Zoom map in" }).evaluate((button: HTMLButtonElement) => button.click());
  await driver.wait(100);
  const zoomed = await page.locator(".map__figure").evaluate((figure: HTMLElement) => ({
    zoom: figure.dataset.mapZoom,
    centreU: figure.dataset.mapCentreU,
    centreV: figure.dataset.mapCentreV,
  }));
  check("map-live", Number(zoomed.zoom) > 1.7, `zoom controls changed live zoom from 1.000 to ${zoomed.zoom}`);

  const figureBox = await page.locator(".map__figure").boundingBox();
  if (figureBox) {
    await driver.drag(
      figureBox.x + figureBox.width * 0.52,
      figureBox.y + figureBox.height * 0.52,
      figureBox.x + figureBox.width * 0.68,
      figureBox.y + figureBox.height * 0.62,
    );
    await driver.wait(100);
  }
  const panned = await page.locator(".map__figure").evaluate((figure: HTMLElement) => ({
    centreU: figure.dataset.mapCentreU,
    centreV: figure.dataset.mapCentreV,
  }));
  check(
    "map-live",
    Boolean(figureBox && (panned.centreU !== zoomed.centreU || panned.centreV !== zoomed.centreV)),
    `drag changed map centre from ${zoomed.centreU},${zoomed.centreV} to ${panned.centreU},${panned.centreV}`,
  );

  await page.getByRole("button", { name: "Hide map labels" }).evaluate((button: HTMLButtonElement) => button.click());
  await driver.wait(50);
  const labelsHidden = await page.evaluate(() => {
    const figure = document.querySelector<HTMLElement>(".map__figure");
    const button = document.querySelector<HTMLButtonElement>(".map__control[aria-label='Show map labels']");
    const svg = document.querySelector<SVGElement>(".map__svg");
    return {
      state: figure?.dataset.mapLabels,
      pressed: button?.getAttribute("aria-pressed"),
      hiddenClass: svg?.classList.contains("map__svg--labels-hidden"),
    };
  });
  check("map-live", labelsHidden.state === "hidden" && labelsHidden.pressed === "false" && labelsHidden.hiddenClass === true, `label toggle state is ${JSON.stringify(labelsHidden)}`);
  await driver.press("m");
  console.log("polish-live: map interaction checked");

  // -------------------------------------------------- player speed and run cadence

  await driver.reset();
  await page.keyboard.down("w");
  const playerSamples = await page.evaluate(async () => {
    const debug = window.__gameDebug as unknown as {
      getPlayerPosition(): Position;
      getPlayerMotion?(): PlayerMotion | null;
    };
    const samples: PlayerSample[] = [];
    const started = performance.now();
    for (let index = 0; index < 22; index += 1) {
      samples.push({
        at: performance.now() - started,
        position: debug.getPlayerPosition(),
        motion: typeof debug.getPlayerMotion === "function" ? debug.getPlayerMotion() : null,
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 90));
    }
    return samples;
  });
  await page.keyboard.up("w");
  console.log("polish-live: player run sampled");
  const steady = playerSamples.filter((sample) => sample.at >= 500 && sample.at <= 1_800);
  let pathMetres = 0;
  for (let index = 1; index < steady.length; index += 1) pathMetres += distance(steady[index - 1]!.position, steady[index]!.position);
  const elapsedSeconds = steady.length >= 2 ? (steady[steady.length - 1]!.at - steady[0]!.at) / 1000 : 0;
  const metresPerSecond = elapsedSeconds > 0 ? pathMetres / elapsedSeconds : 0;
  const runMotions = steady.map((sample) => sample.motion).filter((motion): motion is PlayerMotion => motion !== null && motion.pose === "run");
  const cadenceMotion = [...runMotions].reverse().find((motion) =>
    Number.isFinite(motion.duration) && motion.duration! > 0 && Number.isFinite(motion.timeScale));
  const stepsPerMinute = cadenceMotion
    ? (cadenceMotion.timeScale! / cadenceMotion.duration!) * 2 * 60
    : 0;
  check("player-run", steady.length >= 8, `${steady.length} live steady-state position samples were collected`);
  // Movement advances on the 100 ms simulation tick while these browser samples land every
  // 90 ms, so the first/last partial tick can under-report a short two-second run by about 8%.
  check("player-run", metresPerSecond >= 3.75 && metresPerSecond <= 4.35, `measured ground speed is ${metresPerSecond.toFixed(3)} m/s, target 4.2`);
  check("player-run", runMotions.length >= Math.floor(steady.length * 0.75), `${runMotions.length}/${steady.length} steady samples report the run pose`);
  check(
    "player-run",
    runMotions.every((motion) => Boolean(motion.clip && /(?:jog|run|sprint)/i.test(motion.clip) && !/walk/i.test(motion.clip))),
    `observed run clips: ${[...new Set(runMotions.map((motion) => motion.clip ?? "null"))].join(", ") || "none"}`,
  );
  check("player-run", phaseAdvances(runMotions) >= 5, `${phaseAdvances(runMotions)} consecutive mixer samples advanced instead of restarting`);
  check("player-run", stepsPerMinute >= 145 && stepsPerMinute <= 165, `runtime duration/timeScale give ${stepsPerMinute.toFixed(1)} steps/min`);

  // ------------------------------------------- representative humanoid locomotion/facing

  async function observeHumanoid(entityId: string, centre: readonly [number, number], sectionLabel: string): Promise<void> {
    const entity = await driver.callDebug("getEntity", [entityId]) as {
      id?: string;
      position?: number[];
      view?: { assetId?: string };
    } | null;
    if (!entity?.position || entity.position.length < 3) {
      check("humanoid-live", false, `${sectionLabel}: ${entityId} is not observable through getEntity`);
      return;
    }
    const dx = centre[0] - entity.position[0]!;
    const dz = centre[1] - entity.position[2]!;
    const length = Math.hypot(dx, dz);
    const unitX = length > 0.1 ? dx / length : Math.SQRT1_2;
    const unitZ = length > 0.1 ? dz / length : Math.SQRT1_2;
    // Nine metres is inside a reaver's 14 m aggro radius and leaves enough closing distance to
    // observe locomotion even when the 2 s AI census fires at the end of its interval.
    const playerTarget = [entity.position[0]! + unitX * 9, entity.position[1]!, entity.position[2]! + unitZ * 9];
    await driver.callDebug("teleport", [playerTarget]);
    const samples = await page.evaluate(async ({ id }) => {
      const debug = window.__gameDebug as unknown as {
        getEntityMotion?(entityId: string): EntityMotion | null;
        getPlayerPosition(): Position;
      };
      const rows: EntitySample[] = [];
      const started = performance.now();
      for (let index = 0; index < 42; index += 1) {
        rows.push({
          at: performance.now() - started,
          motion: typeof debug.getEntityMotion === "function" ? debug.getEntityMotion(id) : null,
          player: debug.getPlayerPosition(),
        });
        await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      }
      return rows;
    }, { id: entityId });
    const observed = samples.map((sample) => sample.motion).filter((motion): motion is EntityMotion => motion !== null);
    if (observed.length === 0) {
      check("humanoid-live", false, `${sectionLabel}: getEntityMotion is absent or returned null, so locomotion is unobservable`);
      return;
    }
    const moving = observed.filter((motion) => motion.motion === "walk" || motion.motion === "run");
    const firstPosition = observed.find((motion) => motion.semanticPosition)?.semanticPosition;
    const lastPosition = [...observed].reverse().find((motion) => motion.semanticPosition)?.semanticPosition;
    const displacement = arrayDistance(firstPosition, lastPosition);
    const last = observed[observed.length - 1]!;
    const firstDrawn = observed.find((motion) => motion.drawnPosition)?.drawnPosition;
    const lastDrawn = [...observed].reverse().find((motion) => motion.drawnPosition)?.drawnPosition;
    const moveX = (lastDrawn?.[0] ?? 0) - (firstDrawn?.[0] ?? 0);
    const moveZ = (lastDrawn?.[2] ?? 0) - (firstDrawn?.[2] ?? 0);
    const moveLength = Math.hypot(moveX, moveZ);
    const facingDot = moveLength > 0.05 && last.facing
      ? (moveX / moveLength) * last.facing[0]! + (moveZ / moveLength) * last.facing[2]!
      : -1;
    const finalSample = samples[samples.length - 1]!;
    const towardX = finalSample.player.x - (last.semanticPosition?.[0] ?? finalSample.player.x);
    const towardZ = finalSample.player.z - (last.semanticPosition?.[2] ?? finalSample.player.z);
    const towardLength = Math.hypot(towardX, towardZ);
    const targetFacingDot = towardLength > 0.05 && Number.isFinite(last.semanticRotationY)
      ? (towardX / towardLength) * Math.sin(last.semanticRotationY!) + (towardZ / towardLength) * Math.cos(last.semanticRotationY!)
      : -1;
    const finalLag = arrayDistance(last.semanticPosition, last.drawnPosition);
    const clips = [...new Set(moving.map((motion) => motion.clip ?? "null"))];
    check("humanoid-live", last.liveRig === true && last.path === "live-rig", `${sectionLabel}: render path is ${last.path}, liveRig=${last.liveRig}`);
    check("humanoid-live", Number.isFinite(displacement) && displacement >= 0.35, `${sectionLabel}: semantic displacement is ${Number.isFinite(displacement) ? displacement.toFixed(3) : "unobservable"} m`);
    check("humanoid-live", moving.length >= 3, `${sectionLabel}: ${moving.length}/${observed.length} samples report locomotion`);
    check("humanoid-live", moving.every((motion) => Boolean(motion.clip && /(?:jog|run|sprint)/i.test(motion.clip))), `${sectionLabel}: moving clips are ${clips.join(", ") || "none"}`);
    check("humanoid-live", phaseAdvances(moving) >= 2, `${sectionLabel}: ${phaseAdvances(moving)} moving mixer samples advance`);
    check("humanoid-live", facingDot >= 0.65 || targetFacingDot >= 0.90, `${sectionLabel}: movement facing dot ${facingDot.toFixed(3)}, target facing dot ${targetFacingDot.toFixed(3)}`);
    check("humanoid-live", angleDifference(last.semanticRotationY, last.drawnRotationY) <= 0.40, `${sectionLabel}: drawn/semantic facing error is ${angleDifference(last.semanticRotationY, last.drawnRotationY).toFixed(3)} rad`);
    check("humanoid-live", Number.isFinite(finalLag) && finalLag <= 0.90, `${sectionLabel}: drawn/semantic position lag is ${Number.isFinite(finalLag) ? finalLag.toFixed(3) : "unobservable"} m`);
  }

  await observeHumanoid("march_road_reavers_1", [-234, -24], "surface reaver");
  console.log("polish-live: surface humanoid sampled");
  await observeHumanoid("gravelmaw_ch1_reavers_1", [40, -40], "dungeon reaver");
  console.log("polish-live: dungeon humanoid sampled");

  // ------------------------------------------------------------- runtime errors

  const gameErrors = await driver.callDebug("getErrors") as unknown[];
  check("runtime", gameErrors.length === 0, `${gameErrors.length} game debug errors`);
  check("runtime", driver.consoleErrors.length === 0, `${driver.consoleErrors.length} console errors`);
  check("runtime", driver.pageErrors.length === 0, `${driver.pageErrors.length} uncaught page errors`);
  check("runtime", driver.requestErrors.length === 0, `${driver.requestErrors.length} failed requests`);
} finally {
  console.log("polish-live: closing browser");
  await driver.close();
  await server.close();
}

const failed = results.filter((result) => !result.ok);
const sections = [...new Set(results.map((result) => result.section))];
console.log("World polish live acceptance");
for (const section of sections) {
  const rows = results.filter((result) => result.section === section);
  const failures = rows.filter((result) => !result.ok);
  console.log(`${failures.length === 0 ? "PASS" : "FAIL"} ${section}: ${rows.length - failures.length}/${rows.length}`);
  for (const failure of failures) console.log(`  ! ${failure.detail}`);
}
console.log(`${failed.length === 0 ? "PASS" : "FAIL"}: ${results.length - failed.length}/${results.length} checks`);
process.exitCode = failed.length === 0 ? 0 : 1;
