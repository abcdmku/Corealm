/**
 * Boot sequence. The order is fixed because two WASM modules and the navmesh have hard ordering
 * (runs/corealm/architecture.md section 3, verified in stack-findings.md section 1).
 *
 * `getState().ready` only flips true at the very end, which is what the Playwright driver polls.
 */
import * as THREE from "three";
import type { RegionId, Vec3 } from "../contracts.js";
import { Store } from "../state/store.js";
import { EventBus } from "../core/events.js";
import { SimClock } from "../core/time.js";
import { RngStreams } from "../core/rng.js";
import { Renderer } from "../render/renderer.js";
import { OrbitCamera } from "../render/camera.js";
import { AssetRegistry } from "../render/assets.js";
import { WorldScene } from "../render/scene.js";
import { Physics } from "../systems/physics.js";
import { Navigation, type RouteEdge, type RouteNode } from "../systems/navigation.js";
import { Movement } from "../systems/movement.js";
import { CorealmGameApi } from "../api/gameApi.js";
import { SaveService } from "../persistence/storage.js";
import { installBootPlaceholder, installGameDebug, type RecordedError } from "../debug/gameDebug.js";
import { GameLoop } from "./loop.js";
import { InputController } from "../input/mouse.js";
import { PLAYER_SPEED } from "./config.js";

export interface BootResult {
  loop: GameLoop;
  api: CorealmGameApi;
}

const SPAWN: Vec3 = [6, 0, 14];

export async function boot(canvas: HTMLCanvasElement): Promise<BootResult> {
  const errors: RecordedError[] = [];
  const startedAt = performance.now();

  // 1. Placeholder debug surface, before anything can fail.
  installBootPlaceholder();
  captureErrors(errors, () => performance.now() - startedAt);

  const setStatus = (message: string): void => {
    const node = document.querySelector(".boot-status");
    if (node) node.textContent = message;
  };

  // 2. Core services.
  const store = new Store(1337, Date.now());
  const events = new EventBus();
  const clock = new SimClock();
  const rng = new RngStreams(store.get().meta.seed);

  // 3 + 4. WASM libraries. Both must finish before any world building.
  setStatus("starting the simulation…");
  await Promise.all([Physics.initLibrary(), Navigation.initLibrary()]);

  const physics = new Physics();
  physics.create();
  const nav = new Navigation();

  // 5. Renderer.
  setStatus("lighting the frontier…");
  const renderer = new Renderer(canvas);
  const camera = new OrbitCamera(renderer.camera);
  const scene = new WorldScene(renderer.scene);

  // 6. Assets.
  setStatus("loading assets…");
  const assets = new AssetRegistry();
  let clipCount = 0;
  try {
    await assets.loadManifest();
    clipCount = await assets.loadAnimationLibraries();
  } catch (cause) {
    errors.push({
      atMs: performance.now() - startedAt,
      source: "assets",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  // 7. Terrain and collision.
  setStatus("raising the ground…");
  const terrain = scene.buildTerrain({
    regionId: "fallowmarch",
    size: 240,
    centre: [0, 0],
    segments: 96,
    amplitude: 7.5,
    seed: 20260827,
  });
  physics.addStaticMesh(terrain);

  // 7b. Asset placement proof. Round 1 replaces this with authored region composition, but the
  // foundation must demonstrate that manifest -> GLB -> instanced scene actually works.
  await scatterProof(assets, scene, store.get().meta.seed, errors, () => performance.now() - startedAt);

  // 8. Navmesh from the walkable meshes now in the scene.
  setStatus("mapping walkable ground…");
  const navBuilt = nav.build(scene.getWalkableMeshes());
  if (!navBuilt) {
    errors.push({ atMs: performance.now() - startedAt, source: "navigation", message: "Navmesh build failed" });
  }

  // 9. Route graph over the navmesh. Agility shortcuts become edges here, never off-mesh links.
  buildRouteGraph(nav, scene);

  // 10. Player and views.
  const spawn = nav.closestPoint([SPAWN[0], scene.heightAt("fallowmarch", SPAWN[0], SPAWN[2]) + 0.2, SPAWN[2]]) ?? SPAWN;
  store.get().player.position = spawn;
  scene.createPlaceholderPlayer();
  scene.syncPlayer(spawn, 0);
  camera.update(spawn[0], spawn[1], spawn[2], true);

  // 11. Save.
  const saves = new SaveService();
  const loaded = saves.load();
  if (loaded.status === "loaded" && loaded.state) {
    store.replace(loaded.state);
  } else if (loaded.status === "failed") {
    errors.push({
      atMs: performance.now() - startedAt,
      source: "persistence",
      message: `Save could not be loaded: ${loaded.reason ?? "unknown"}`,
    });
  }

  // 12. Wire the API and the loop.
  const movement = new Movement(nav, events);
  const api = new CorealmGameApi(store, events, nav, movement, clock);
  const input = new InputController(canvas, renderer, camera, api, movement);

  const loop = new GameLoop({ store, events, clock, rng, renderer, camera, scene, physics, nav, movement, api, saves, input });

  const resetWorld = (seed?: number, keepSave = false): void => {
    if (!keepSave) saves.clear();
    store.reset(seed ?? store.get().meta.seed, Date.now());
    store.get().player.position = spawn;
    store.get().player.facingRad = 0;
    rng.reseed(store.get().meta.seed);
    events.reset();
    clock.reset();
    movement.stop(store.get(), 0, "reset");
    movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: 0 });
    input.clear();
    camera.reset();
    camera.update(spawn[0], spawn[1], spawn[2], true);
    scene.syncPlayer(spawn, 0);
    errors.length = 0;
  };

  installGameDebug({
    store, events, clock, nav, movement, api, renderer, camera, assets, errors,
    version: { build: "phase1-round0", contracts: "1", content: "1" },
    resetWorld,
    isIdle: () => store.get().player.movement.mode === "idle" && store.get().activity === null,
    teleport: (to: Vec3) => {
      const snapped = nav.closestPoint(to) ?? to;
      store.get().player.position = snapped;
      movement.stop(store.get(), clock.elapsedMs, "teleport");
      scene.syncPlayer(snapped, store.get().player.facingRad);
      camera.update(snapped[0], snapped[1], snapped[2], true);
    },
    saveNow: () => { saves.save(store.get(), Date.now()); },
    getSaveBlob: () => saves.serialize(store.get()),
    loadSaveBlob: (json: string) => {
      try {
        store.replace(JSON.parse(json) as ReturnType<Store["snapshot"]>);
      } catch (cause) {
        errors.push({
          atMs: clock.elapsedMs,
          source: "debug.loadSaveBlob",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    focusCamera: () => false,
    listShots: () => [],
    callTool: () => Promise.reject(new Error("Agent tools arrive in round 6")),
  });

  void clipCount;
  document.getElementById("boot-screen")?.remove();
  loop.start();
  return { loop, api };
}

/**
 * Places real Quaternius meshes through the instanced path, so round 0 proves the whole asset
 * chain end to end rather than only that the manifest parses.
 */
async function scatterProof(
  assets: AssetRegistry,
  scene: WorldScene,
  seed: number,
  errors: RecordedError[],
  atMs: () => number,
): Promise<void> {
  const groups: { tags: string[]; count: number; scale: [number, number]; clearRadius: number }[] = [
    { tags: ["tree", "broadleaf"], count: 70, scale: [0.85, 1.35], clearRadius: 16 },
    { tags: ["tree", "pine"], count: 40, scale: [0.9, 1.4], clearRadius: 16 },
    { tags: ["bush"], count: 55, scale: [0.7, 1.2], clearRadius: 9 },
    { tags: ["rock"], count: 45, scale: [0.6, 1.3], clearRadius: 9 },
  ];

  const rng = new RngStreams(seed).get("scatter");

  for (const group of groups) {
    const candidates = assets.byTags(...group.tags);
    if (candidates.length === 0) continue;

    for (const entry of candidates.slice(0, 3)) {
      try {
        await assets.load(entry.id);
      } catch (cause) {
        errors.push({
          atMs: atMs(),
          source: "assets",
          message: `Failed to load ${entry.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
        continue;
      }

      const perAsset = Math.max(1, Math.round(group.count / Math.min(3, candidates.length)));
      const placements: { position: Vec3; rotationY: number; scale: number }[] = [];
      let attempts = 0;
      while (placements.length < perAsset && attempts < perAsset * 12) {
        attempts += 1;
        const x = rng.float(-110, 110);
        const z = rng.float(-110, 110);
        // Keep the spawn approach clear so the smoke test's centre-screen click hits open ground.
        if (Math.hypot(x - SPAWN[0], z - SPAWN[2]) < group.clearRadius) continue;
        const y = scene.heightAt("fallowmarch", x, z);
        placements.push({
          position: [x, y, z],
          rotationY: rng.float(0, Math.PI * 2),
          scale: rng.float(group.scale[0], group.scale[1]),
        });
      }

      scene.scatterInstanced(assets.instance(entry.id), placements, `scatter-${entry.id}`);
    }
  }
}

/**
 * Round 0 route graph: the spawn, and a couple of reference points so `planRoute` and
 * `moveTo({locationId})` are exercised from the start. Region content replaces this in round 1.
 */
function buildRouteGraph(nav: Navigation, scene: WorldScene): void {
  const at = (x: number, z: number): Vec3 => [x, scene.heightAt("fallowmarch", x, z), z];
  const nodes: RouteNode[] = [
    { id: "coldbrace", name: "Coldbrace", position: at(6, 14), regionId: "fallowmarch" },
    { id: "bracken_pit", name: "Bracken Pit", position: at(-52, -38), regionId: "fallowmarch" },
    { id: "marchfield", name: "Marchfield", position: at(58, -24), regionId: "fallowmarch" },
  ];

  const edges: RouteEdge[] = [];
  for (const from of nodes) {
    for (const to of nodes) {
      if (from.id === to.id) continue;
      const length = nav.pathDistance(from.position, to.position);
      if (length === null) continue;
      edges.push({ from: from.id, to: to.id, cost: length / PLAYER_SPEED, kind: "walk" });
    }
  }
  nav.setRouteGraph(nodes, edges);
}

function captureErrors(sink: RecordedError[], atMs: () => number): void {
  window.addEventListener("error", (event) => {
    sink.push({ atMs: atMs(), source: "window.error", message: String(event.message), stack: event.error?.stack });
  });
  window.addEventListener("unhandledrejection", (event) => {
    sink.push({ atMs: atMs(), source: "unhandledrejection", message: String(event.reason) });
  });
}

export type { THREE };
