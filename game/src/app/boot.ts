/**
 * Boot sequence. The order is fixed because two WASM modules and the navmesh have hard ordering
 * (runs/corealm/architecture.md section 3, verified in stack-findings.md section 1).
 *
 * `getState().ready` only flips true at the very end, which is what the Playwright driver polls.
 *
 * This file is where the round-1 workers' output is composed: A1's semantic world, A2's terrain and
 * views, A4's input. Each depends only on frozen contracts, so no worker had to know about another.
 */
import type { RegionId, SkillId, Vec3 } from "../contracts.js";
import { SKILL_IDS } from "../contracts.js";
import { Store } from "../state/store.js";
import { EventBus } from "../core/events.js";
import { SimClock } from "../core/time.js";
import { RngStreams } from "../core/rng.js";
import { Renderer } from "../render/renderer.js";
import { OrbitCamera } from "../render/camera.js";
import { AssetRegistry } from "../render/assets.js";
import { WorldScene } from "../render/scene.js";
import { EntityViews } from "../render/entityViews.js";
import { Physics } from "../systems/physics.js";
import { Navigation } from "../systems/navigation.js";
import { Movement } from "../systems/movement.js";
import { CorealmGameApi } from "../api/gameApi.js";
import { SaveService } from "../persistence/storage.js";
import { installBootPlaceholder, installGameDebug, type RecordedError } from "../debug/gameDebug.js";
import { GameLoop } from "./loop.js";
import { InputController } from "../input/mouse.js";
import { KeyboardController } from "../input/keyboard.js";
import { buildWorldTerrainSpec, startingSpawn } from "./worldSpec.js";
import { buildWorld } from "../world/regionBuilder.js";
import { EntityStore, straightLineDistance } from "../world/entities.js";
import { InteractionDispatcher } from "../world/interactions.js";
import { REGIONS, validateRegions } from "../content/regions.js";
import { scatterWorld, worldExclusions } from "../world/scatter.js";

export interface BootResult {
  loop: GameLoop;
  api: CorealmGameApi;
}

export async function boot(canvas: HTMLCanvasElement): Promise<BootResult> {
  const errors: RecordedError[] = [];
  const startedAt = performance.now();
  const atMs = (): number => performance.now() - startedAt;

  // 1. Placeholder debug surface, before anything can fail.
  installBootPlaceholder();
  captureErrors(errors, atMs);

  const setStatus = (message: string): void => {
    const node = document.querySelector(".boot-status");
    if (node) node.textContent = message;
  };

  // 2. Core services and content validation. Bad content is loud, never silently degrading.
  const store = new Store(1337, Date.now());
  const events = new EventBus();
  const clock = new SimClock();
  const rng = new RngStreams(store.get().meta.seed);

  for (const problem of validateRegions()) {
    errors.push({ atMs: atMs(), source: "content.regions", message: problem });
  }

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

  // 6. Assets. Animation libraries load once as a shared clip library; every rig plays from it.
  setStatus("loading assets…");
  const assets = new AssetRegistry();
  try {
    await assets.loadManifest();
    await assets.loadAnimationLibraries();
  } catch (cause) {
    errors.push({ atMs: atMs(), source: "assets", message: describeError(cause) });
  }

  // 7. Terrain, derived from canonical region data so there is one source of truth for where the
  //    world is. See app/worldSpec.ts for why this is derived rather than authored twice.
  setStatus("raising the ground…");
  scene.buildWorld(buildWorldTerrainSpec());
  // One heightfield collider rather than 28 terrain trimeshes: same ground answers, 24 ms instead
  // of a per-chunk trimesh build, and a single collider for the ray queries to walk.
  physics.addHeightfield(scene.heightfieldSamples());

  const heightAt = (regionId: RegionId, x: number, z: number): number => scene.heightAt(regionId, x, z);

  // 8. Semantic world. Data in, entities out, deterministic from the seed.
  setStatus("populating the frontier…");
  const built = buildWorld(store.get().meta.seed, heightAt);

  const skillLevels = (): Record<SkillId, number> => {
    const levels = {} as Record<SkillId, number>;
    const skills = store.get().skills;
    for (const id of SKILL_IDS) levels[id] = skills[id].level;
    return levels;
  };

  const entityStore = new EntityStore({ skillLevels });
  entityStore.load(built.entities);
  entityStore.registerLocations(built.knownLocations);

  // 9. Navmesh over the walkable terrain, then the route graph above it.
  setStatus("mapping walkable ground…");
  if (!nav.build(scene.getWalkableMeshes())) {
    const failure = nav.snapshot(null, null, 0).error ?? "unknown";
    errors.push({ atMs: atMs(), source: "navigation", message: `Navmesh build failed: ${failure}` });
  }
  nav.setRouteGraph(built.routeNodes, built.routeEdges);

  // Path distance, not straight line: `ObservedEntity.distance` is documented as walking distance,
  // and across Karrowmoor's terraces the difference is large enough to change an agent's choice.
  entityStore.setDistanceFunction((from, to) => nav.pathDistance(from, to) ?? straightLineDistance(from, to));

  // 10. Procedural dressing, kept clear of anything authored.
  setStatus("dressing the world…");
  registerExclusions(scene);
  try {
    await scatterWorld(scene, assets, store.get().meta.seed);
  } catch (cause) {
    errors.push({ atMs: atMs(), source: "scatter", message: describeError(cause) });
  }

  // 11. Entity views. The render layer reads `SemanticEntity.view`; it never invents an appearance.
  const entityViews = new EntityViews(scene, assets, scene.materials);
  await preloadEntityAssets(assets, entityStore, errors, atMs);
  try {
    entityViews.sync(entityStore.all());
  } catch (cause) {
    errors.push({ atMs: atMs(), source: "entityViews", message: describeError(cause) });
  }
  for (const missing of entityViews.stats().missingAssets) {
    errors.push({ atMs: atMs(), source: "entityViews", message: `Missing asset "${missing}"` });
  }

  // 12. Player.
  const spawnSpec = startingSpawn();
  const groundY = scene.heightAt(spawnSpec.regionId, spawnSpec.x, spawnSpec.z);
  const spawn: Vec3 = nav.closestPoint([spawnSpec.x, groundY + 0.2, spawnSpec.z]) ?? [spawnSpec.x, groundY, spawnSpec.z];
  store.get().player.position = spawn;
  store.get().player.regionId = spawnSpec.regionId;
  scene.createPlaceholderPlayer();
  scene.syncPlayer(spawn, 0, true);
  camera.update(spawn[0], spawn[1], spawn[2], true);

  // 13. Save.
  const saves = new SaveService();
  const loaded = saves.load();
  if (loaded.status === "loaded" && loaded.state) {
    store.replace(loaded.state);
  } else if (loaded.status === "failed") {
    errors.push({ atMs: atMs(), source: "persistence", message: `Save could not be loaded: ${loaded.reason ?? "unknown"}` });
  }

  // 14. API and hooks. Everything a human or an agent does goes through here.
  const movement = new Movement(nav, events);
  const api = new CorealmGameApi(store, events, nav, movement, clock);

  const interactions = new InteractionDispatcher({
    get: (id) => entityStore.get(id),
    playerPosition: () => store.get().player.position,
    skillLevels,
  });

  api.register("entities", {
    get: (id) => entityStore.get(id),
    all: () => entityStore.all(),
    observe: (filter, from) => entityStore.observe(filter, from),
  });
  api.register("interactions", { run: (id, interaction) => interactions.run(id, interaction) });

  // 15. Input.
  const input = new InputController(canvas, renderer, camera, api, movement);
  input.setEntityPickSource((raycaster) => {
    const entityId = entityViews.pick(raycaster);
    if (!entityId) return null;
    const position = entityViews.positionOf(entityId);
    if (!position) return null;
    return {
      entityId,
      point: [position.x, position.y, position.z] as Vec3,
      distance: position.distanceTo(renderer.camera.position),
    };
  });
  const keyboard = new KeyboardController({ api });

  const loop = new GameLoop({
    store, events, clock, rng, renderer, camera, scene, physics, nav, movement, api, saves, input,
  });
  loop.setEntityViews(entityViews, () => entityStore.all());

  const resetWorld = (seed?: number, keepSave = false): void => {
    if (!keepSave) saves.clear();
    store.reset(seed ?? store.get().meta.seed, Date.now());
    store.get().player.position = spawn;
    store.get().player.regionId = spawnSpec.regionId;
    store.get().player.facingRad = 0;
    rng.reseed(store.get().meta.seed);
    events.reset();
    clock.reset();
    movement.stop(store.get(), 0, "reset");
    movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: 0 });
    input.clear();
    camera.reset();
    camera.update(spawn[0], spawn[1], spawn[2], true);
    scene.syncPlayer(spawn, 0, true);

    // Node yields and enemy health are seeded world state, so a reset rebuilds them rather than
    // leaving a half-mined world behind a nominally fresh character.
    const rebuilt = buildWorld(store.get().meta.seed, heightAt);
    entityStore.load(rebuilt.entities);
    entityStore.registerLocations(rebuilt.knownLocations);
    nav.setRouteGraph(rebuilt.routeNodes, rebuilt.routeEdges);
    entityViews.sync(entityStore.all());
    errors.length = 0;
  };

  installGameDebug({
    store, events, clock, nav, movement, api, renderer, camera, assets, errors,
    version: { build: "phase1-round1", contracts: "2", content: "1" },
    resetWorld,
    isIdle: () => store.get().player.movement.mode === "idle" && store.get().activity === null,
    teleport: (to: Vec3) => {
      const snapped = nav.closestPoint(to) ?? to;
      store.get().player.position = snapped;
      store.get().player.regionId = scene.regionAt(snapped[0], snapped[2]);
      movement.stop(store.get(), clock.elapsedMs, "teleport");
      scene.syncPlayer(snapped, store.get().player.facingRad, true);
      camera.update(snapped[0], snapped[1], snapped[2], true);
    },
    saveNow: () => { saves.save(store.get(), Date.now()); },
    getSaveBlob: () => saves.serialize(store.get()),
    loadSaveBlob: (json: string) => {
      try {
        store.replace(JSON.parse(json) as ReturnType<Store["snapshot"]>);
      } catch (cause) {
        errors.push({ atMs: clock.elapsedMs, source: "debug.loadSaveBlob", message: describeError(cause) });
      }
    },
    focusCamera: () => false,
    listShots: () => [],
    callTool: () => Promise.reject(new Error("Agent tools arrive in round 6")),
  });

  void keyboard;
  document.getElementById("boot-screen")?.remove();
  loop.start();
  return { loop, api };
}

/**
 * Keeps procedural dressing off anything authored. Trees growing through the bank door is the
 * single most obvious way a procedural world reads as unmade.
 */
function registerExclusions(scene: WorldScene): void {
  worldExclusions.clear();
  for (const region of REGIONS) {
    if (region.settlement) {
      worldExclusions.addCircle(
        region.settlement.centre[0], region.settlement.centre[1], 46, "settlement", region.settlement.id,
      );
    }
    for (const location of region.locations) {
      worldExclusions.addCircle(location.position[0], location.position[1], 9, "cluster", location.id);
    }
    for (const cluster of region.clusters) {
      worldExclusions.addCircle(cluster.centre[0], cluster.centre[1], cluster.radius + 3, "cluster", cluster.id);
    }
    // Roads are authored as location-to-location links, so the corridor is derived from the two
    // endpoints rather than a stored polyline.
    const locationById = new Map(region.locations.map((location) => [location.id, location]));
    for (const road of region.roads) {
      const from = locationById.get(road.from);
      const to = locationById.get(road.to);
      if (!from || !to) continue;
      const points: Vec3[] = [from.position, to.position].map(
        (spot) => [spot[0], scene.heightAt(region.id, spot[0], spot[1]), spot[1]] as Vec3,
      );
      worldExclusions.addCorridor(points, 8, "road", `${road.from}->${road.to}`);
    }
  }
}

/** Loads every GLB the world's entities name, so the first sync does not pop meshes in late. */
async function preloadEntityAssets(
  assets: AssetRegistry,
  entityStore: EntityStore,
  errors: RecordedError[],
  atMs: () => number,
): Promise<void> {
  const ids = new Set<string>();
  for (const entity of entityStore.all()) {
    if (entity.view?.assetId) ids.add(entity.view.assetId);
    if (entity.view?.depletedAssetId) ids.add(entity.view.depletedAssetId);
  }
  const ordered = [...ids];
  const results = await Promise.allSettled(ordered.map((id) => assets.load(id)));
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      errors.push({
        atMs: atMs(),
        source: "assets",
        message: `Failed to load "${ordered[index]}": ${describeError(result.reason)}`,
      });
    }
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function captureErrors(sink: RecordedError[], atMs: () => number): void {
  window.addEventListener("error", (event) => {
    sink.push({ atMs: atMs(), source: "window.error", message: String(event.message), stack: event.error?.stack });
  });
  window.addEventListener("unhandledrejection", (event) => {
    sink.push({ atMs: atMs(), source: "unhandledrejection", message: String(event.reason) });
  });
}
