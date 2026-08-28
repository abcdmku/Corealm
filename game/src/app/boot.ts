/**
 * Boot sequence. The order is fixed because two WASM modules and the navmesh have hard ordering
 * (runs/corealm/architecture.md section 3, verified in stack-findings.md section 1).
 *
 * `getState().ready` only flips true at the very end, which is what the Playwright driver polls.
 *
 * This file is where the round-1 workers' output is composed: A1's semantic world, A2's terrain and
 * views, A4's input. Each depends only on frozen contracts, so no worker had to know about another.
 */
import * as THREE from "three";
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
import { WATER_BASIN_DEPTH, buildWorldTerrainSpec, startingSpawn } from "./worldSpec.js";
import { CAMERA } from "./config.js";
import { buildWorld, type BuildingBox } from "../world/regionBuilder.js";
import { EntityStore, straightLineDistance } from "../world/entities.js";
import { InteractionDispatcher } from "../world/interactions.js";
import { InventorySystem } from "../systems/inventory.js";
import { BankSystem } from "../systems/bank.js";
import { EquipmentSystem } from "../systems/equipment.js";
import { EconomySystem } from "../systems/economy.js";
import { ActivitySystem } from "../systems/activity.js";
import { GatheringSystem } from "../systems/gathering.js";
import { FarmingSystem } from "../systems/farming.js";
import { AgilitySystem } from "../systems/agility.js";
import { INTERACT_RANGE } from "./config.js";
import { distanceXZ } from "../core/math.js";
import { REGIONS, getRegion, validateRegions } from "../content/regions.js";
import { content } from "../content/index.js";
import { ALL_ITEMS } from "../content/items.js";
import { RESOURCES } from "../content/resources.js";
import { RECIPES } from "../content/recipes.js";
import { SPELLS } from "../content/spells.js";
import { ENEMIES } from "../content/enemies.js";
import { SHOPS } from "../content/shops.js";
import { scatterWorld, worldExclusions } from "../world/scatter.js";
import { findShot, shotIds } from "../debug/shots.js";
import { installAgentSurface } from "../agent/index.js";
import { createUi } from "../ui/panels.js";
import { Overlays } from "../render/overlays.js";
import { CharacterRig } from "../render/characterRig.js";
import { Vfx } from "../render/vfx.js";
import { DocSearch, buildDocs } from "../api/docs.js";

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

  // Canonical content is registered before anything can ask for it. Systems and the docs index all
  // read through `content`, so this has to happen before the first tick and before buildDocs().
  content.register({
    items: ALL_ITEMS,
    resources: RESOURCES,
    recipes: RECIPES,
    spells: SPELLS,
    enemies: ENEMIES,
    shops: SHOPS,
  });

  for (const problem of validateRegions()) {
    errors.push({ atMs: atMs(), source: "content.regions", message: problem });
  }

  // Cross-table integrity: a recipe naming an ingredient that does not exist, or a shop stocking a
  // phantom item, is invisible until a player tries it mid-session.
  for (const problem of validateContentTables()) {
    errors.push({ atMs: atMs(), source: "content.tables", message: problem });
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

  // Content references assets by id, so the ids can only be checked once the manifest exists.
  // This catches a prefab part or landmark composition naming a mesh that was never shipped.
  const knownAssetIds = new Set((assets.getManifest()?.assets ?? []).map((asset) => asset.id));
  if (knownAssetIds.size > 0) {
    for (const problem of validateRegions(knownAssetIds)) {
      errors.push({ atMs: atMs(), source: "content.assets", message: problem });
    }
  }

  // 7. Terrain, derived from canonical region data so there is one source of truth for where the
  //    world is. See app/worldSpec.ts for why this is derived rather than authored twice.
  setStatus("raising the ground…");
  // Flat pads are registered before the terrain mesh is generated, or the ground under a
  // settlement stays as noisy as the moor around it — Coldbrace square measured a metre of tilt
  // across 33 m before this. worldSpec derives the pads from the authored settlement data.
  scene.buildWorld(buildWorldTerrainSpec());
  // One heightfield collider rather than 28 terrain trimeshes: same ground answers, 24 ms instead
  // of a per-chunk trimesh build, and a single collider for the ray queries to walk.
  physics.addHeightfield(scene.heightfieldSamples());

  const heightAt = (regionId: RegionId, x: number, z: number): number => scene.heightAt(regionId, x, z);

  // 7b. Roads. Authored as location-to-location links, so the ribbon is built from the endpoints
  //     and draped onto the finished terrain. Without these the ground is one flat colour and
  //     nothing tells a new player which direction leads to content.
  buildRoads(scene);

  // 7c. Water. Fishing spots were authored as interaction markers with a note that the water itself
  //     is the render layer's job — and nothing was building it, so every fishing spot sat on dry
  //     grass. Each `kind: "water"` location gets a surface sunk just below the local ground.
  buildWaterBodies(scene);

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

  // 8b. Buildings become solid before the navmesh is generated, so paths route around them
  //     instead of through a wall. Gatehouses emit two pier boxes with the gate gap left open.
  for (const box of built.buildings) {
    physics.addStaticBox(box.position, box.halfExtents as unknown as Vec3, box.rotationY);
  }
  // Recast reads raw geometry, so the cheapest way to make a building block a path is to hand the
  // navmesh an invisible box for it. The vertical sides exceed the 48-degree walkable slope, so the
  // footprint drops out of the mesh. A box top does generate a small isolated roof polygon, which
  // is harmless: nothing connects to it, so no path can route over a roof.
  const navObstacles = buildNavObstacles(built.buildings);
  renderer.scene.add(navObstacles.group);

  // 9. Navmesh over the walkable terrain, then the route graph above it.
  setStatus("mapping walkable ground…");
  if (!nav.build([...scene.getWalkableMeshes(), ...navObstacles.meshes])) {
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

  // The camera pulls in when terrain or a building blocks the view of the player. The probe starts
  // at head height rather than at the feet, so the player's own capsule is never the first hit —
  // otherwise the camera jams at minimum distance permanently.
  camera.setOcclusionProbe((from, to) => {
    const direction: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (length < 0.001) return null;
    const unit: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length];
    return physics.raycast(from, unit, length);
  });

  // 12. Player.
  const spawnSpec = startingSpawn();
  const groundY = scene.heightAt(spawnSpec.regionId, spawnSpec.x, spawnSpec.z);
  const spawn: Vec3 = nav.closestPoint([spawnSpec.x, groundY + 0.2, spawnSpec.z]) ?? [spawnSpec.x, groundY, spawnSpec.z];
  // Facing convention matches NpcStandDef and debug/shots.ts: 0 looks toward +z.
  // The camera sits behind the player, so its yaw is the player's facing plus pi.
  const spawnFacing = getRegion(spawnSpec.regionId)?.spawnFacingRad ?? 0;
  store.get().player.position = spawn;
  store.get().player.regionId = spawnSpec.regionId;
  store.get().player.facingRad = spawnFacing;
  // A real skinned character rather than the round-0 capsule. If the rig fails to build for any
  // reason the capsule stays as the fallback, because a missing player is unrecoverable and an
  // ugly player is not.
  const playerRig = new CharacterRig(assets);
  const rigged = await playerRig.build({
    bodyAssetId: "base_male",
    outfitAssetIds: ["outfit_male_peasant_chest", "outfit_male_peasant_legs", "outfit_male_peasant_boots"],
  });
  if (rigged) {
    scene.entityGroup.add(playerRig.root);
    playerRig.setPosition(spawn, spawnFacing);
  } else {
    errors.push({ atMs: atMs(), source: "characterRig", message: "Player rig failed to build; using the placeholder" });
    scene.createPlaceholderPlayer();
  }
  scene.syncPlayer(spawn, spawnFacing, true);
  camera.setPose(spawnFacing + Math.PI, CAMERA.defaultPitch, CAMERA.defaultDistance);
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

  // ---- Round 2 systems. Construction order follows the dependency chain: inventory first, then
  // the systems that move items, then the activity spine, then the activities themselves.

  const now = (): number => clock.elapsedMs;

  /** True when the player is close enough to interact with any entity of a given archetype. */
  const nearArchetype = (archetype: string): boolean => {
    const position = store.get().player.position;
    for (const entity of entityStore.all()) {
      if (entity.archetype !== archetype) continue;
      if (distanceXZ(position, entity.position) <= INTERACT_RANGE * 2.2) return true;
    }
    return false;
  };

  // `use()` on a wearable should equip it, which is what clicking a sword means. Equipment does not
  // exist yet at this point, so the dep is a late-bound closure rather than a direct reference.
  let equipmentSystem: EquipmentSystem | undefined;
  const inventorySystem = new InventorySystem({
    store, events, now,
    equip: (itemId) => equipmentSystem
      ? equipmentSystem.equip(itemId)
      : { ok: false as const, error: { code: "UNAVAILABLE" as const, message: "Equipment is not ready" } },
  });
  equipmentSystem = new EquipmentSystem({ store, events, inventory: inventorySystem, now });
  const bankSystem = new BankSystem({
    store, events, inventory: inventorySystem, now,
    inRangeOfBank: () => nearArchetype("bank"),
  });
  const economySystem = new EconomySystem({
    store, events, inventory: inventorySystem, now,
    resolveShop: (shopId) => {
      const position = store.get().player.position;
      const shops = entityStore.all().filter((entity) => entity.archetype === "shop");
      const chosen = shopId
        ? shops.find((entity) => entity.id === shopId)
        // With no id, the nearest shop is what the player is obviously standing at.
        : shops.sort((a, b) => distanceXZ(position, a.position) - distanceXZ(position, b.position))[0];
      if (!chosen) return undefined;
      return {
        entityId: chosen.id,
        contentShopId: String(chosen.meta?.shopId ?? chosen.id),
        inRange: distanceXZ(position, chosen.position) <= INTERACT_RANGE * 2.2,
      };
    },
  });

  const activitySystem = new ActivitySystem(store, events);
  const gatheringSystem = new GatheringSystem({
    store, events, clock, rng, entities: entityStore,
    inventory: inventorySystem, activity: activitySystem, dispatcher: interactions,
  });
  const farmingSystem = new FarmingSystem({
    store, events, clock, rng, entities: entityStore,
    inventory: inventorySystem, activity: activitySystem, dispatcher: interactions,
    gathering: gatheringSystem,
  });
  const agilitySystem = new AgilitySystem({
    store, events, clock, rng, entities: entityStore,
    activity: activitySystem, dispatcher: interactions, nav,
  });

  api.register("inventory", inventorySystem);
  api.register("equipment", equipmentSystem);
  api.register("bank", bankSystem);
  api.register("shop", economySystem);
  api.register("activity", activitySystem.hook());

  api.register("entities", {
    get: (id) => entityStore.get(id),
    all: () => entityStore.all(),
    observe: (filter, from) => entityStore.observe(filter, from),
  });
  api.register("interactions", { run: (id, interaction) => interactions.run(id, interaction) });

  // Assistance overlays. Presentation only: drawing one never changes canonical state, which is
  // what makes it safe to let an agent write here.
  const labelRoot = document.getElementById("ui-root") ?? document.body;
  const overlays = new Overlays({
    scene,
    camera: renderer.camera,
    entityPosition: (entityId) => entityStore.get(entityId)?.position ?? null,
    labelRoot,
  });
  api.register("overlays", {
    set: (spec) => overlays.set(spec, clock.elapsedMs),
    clear: (id) => overlays.clear(id),
  });

  // Combat and activity feedback, driven off the event stream rather than called by systems. That
  // keeps the dependency pointing one way, and it means an agent's action produces exactly the same
  // feedback as a human's because both travel through the same events.
  const vfx = new Vfx({
    camera: renderer.camera,
    root: labelRoot,
    parent: scene.overlayGroup,
    entityPosition: (entityId) => entityStore.get(entityId)?.position ?? null,
    playerPosition: () => store.get().player.position,
  });
  events.subscribe((event) => vfx.handle(event, clock.elapsedMs));

  // "Click a distant ore" must walk there AND THEN mine it. The API remembers the intent; this is
  // what fires it on arrival. Both a human click and an agent tool call route through here.
  events.subscribe((event) => {
    if (event.type === "navigation.completed") api.resumePending();
    else if (event.type === "navigation.failed") api.clearPending();
  });

  // Documentation, generated from the same canonical content the runtime uses, so the docs cannot
  // drift from the game. Public knowledge only — hidden quest state never reaches this index.
  const docs = new DocSearch();
  docs.build(buildDocs());
  api.register("docs", { search: (query, limit) => docs.search(query, limit) });

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

  // The agent surface. Always installed at window.corealm.agent, and mirrored onto whichever
  // model-context container the browser provides. One implementation, three ways in.
  // The human UI. Everything it does goes through GameApi, the same object the agent tools call.
  const ui = createUi(api, {
    // OrbitCamera yaw is measured from +z clockwise; the compass wants a heading in the same frame.
    getHeadingRad: () => camera.yaw,
  });
  ui.mount(labelRoot);

  // A bank or shop interaction has no event of its own, so the panel opens off the successful
  // interaction rather than off a signal that does not exist.
  events.subscribe((event) => {
    if (event.type !== "activity.started" || !event.entityId) return;
    const entity = entityStore.get(event.entityId);
    if (entity?.archetype === "bank") ui.openBank(entity.id);
    else if (entity?.archetype === "shop") ui.openShop(entity.id);
  });

  const version = { build: "phase1-round2", contracts: "3", content: "1" };
  const agent = installAgentSurface(api, { version });

  const loop = new GameLoop({
    store, events, clock, rng, renderer, camera, scene, physics, nav, movement, api, saves, input,
  });
  // The Gravelmaw chambers are authored a few metres below the surface, right beside the entrance,
  // so rendering every entity unconditionally drew the whole dungeon population on top of the
  // terrace. That single pose measured 803 draw calls against a 400 budget. The dungeon is only
  // visible from inside it.
  const playerInDungeon = (): boolean => store.get().player.regionId === "gravelmaw";
  // Tick order is each system's own `order` field, following the PRD's documented update order.
  loop.addSystem(activitySystem);
  loop.addSystem(agilitySystem);
  loop.addSystem(gatheringSystem);
  loop.addSystem(farmingSystem);

  loop.setOverlays(overlays);
  loop.setVfx(vfx);
  loop.setUi(ui);
  if (rigged) loop.setPlayerRig(playerRig);
  loop.setEntityViews(entityViews, () => {
    const inside = playerInDungeon();
    return entityStore.all().filter((entity) => (entity.regionId === "gravelmaw") === inside);
  });

  const resetWorld = (seed?: number, keepSave = false): void => {
    if (!keepSave) saves.clear();
    store.reset(seed ?? store.get().meta.seed, Date.now());
    store.get().player.position = spawn;
    store.get().player.regionId = spawnSpec.regionId;
    store.get().player.facingRad = spawnFacing;
    rng.reseed(store.get().meta.seed);
    events.reset();
    clock.reset();
    movement.stop(store.get(), 0, "reset");
    movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: 0 });
    input.clear();
    camera.reset();
    camera.setPose(spawnFacing + Math.PI, CAMERA.defaultPitch, CAMERA.defaultDistance);
    camera.update(spawn[0], spawn[1], spawn[2], true);
    scene.syncPlayer(spawn, spawnFacing, true);

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
    version,
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
    /**
     * Moves the camera to a named repeatable pose. Screenshots and the perf budget both use these,
     * so a shot points at the thing it is named after rather than at a fixed compass bearing.
     */
    giveItem: (itemId: string, quantity: number, to: string) => (
      to === "bank"
        ? bankSystem.op("deposit", { itemId, quantity })
        : inventorySystem.addItem(itemId, quantity)
    ),
    focusCamera: (shotId: string) => {
      const shot = findShot(shotId);
      if (!shot) return false;
      const node = nav.routeNode(shot.locationId);
      if (!node) return false;
      const landed = nav.closestPoint(node.position) ?? node.position;
      store.get().player.position = landed;
      store.get().player.regionId = scene.regionAt(landed[0], landed[2]);
      movement.stop(store.get(), clock.elapsedMs, "focus-camera");
      scene.syncPlayer(landed, shot.yaw + Math.PI, true);
      camera.setPose(shot.yaw, shot.pitch, shot.distance);
      camera.update(landed[0], landed[1], landed[2], true);
      return true;
    },
    listShots: () => shotIds(),
    callTool: (name: string, args: unknown) => agent.call(name, (args ?? {}) as Record<string, unknown>),
  });

  void keyboard;
  document.getElementById("boot-screen")?.remove();
  loop.start();
  return { loop, api };
}

/**
 * Cross-checks the canonical tables against each other.
 *
 * Each table is authored in its own file, so nothing but a pass like this catches a recipe whose
 * ingredient id was renamed, an enemy dropping an item that was never defined, or a spell costing
 * a reagent that does not exist.
 */
function validateContentTables(): string[] {
  const problems: string[] = [];
  const itemIds = new Set(content.allItems().map((item) => item.id));

  const requireItem = (itemId: string, where: string): void => {
    if (!itemIds.has(itemId)) problems.push(`${where} references unknown item "${itemId}"`);
  };

  for (const resource of content.allResources()) {
    requireItem(resource.itemId, `resource ${resource.id}`);
    for (const bonus of resource.bonus ?? []) requireItem(bonus.itemId, `resource ${resource.id} bonus`);
  }
  for (const recipe of content.allRecipes()) {
    for (const input of recipe.inputs) requireItem(input.itemId, `recipe ${recipe.id} input`);
    requireItem(recipe.output.itemId, `recipe ${recipe.id} output`);
    if (recipe.burntItemId) requireItem(recipe.burntItemId, `recipe ${recipe.id} burnt`);
  }
  for (const spell of content.allSpells()) requireItem(spell.cost.itemId, `spell ${spell.id} cost`);
  for (const enemy of content.allEnemies()) {
    for (const drop of enemy.drops) requireItem(drop.itemId, `enemy ${enemy.id} drop`);
  }
  for (const shop of content.allShops()) {
    for (const entry of shop.stock) requireItem(entry.itemId, `shop ${shop.id} stock`);
  }

  const seen = new Set<string>();
  for (const item of content.allItems()) {
    if (seen.has(item.id)) problems.push(`duplicate item id "${item.id}"`);
    seen.add(item.id);
  }
  return problems;
}

/**
 * Puts water under every location authored as water.
 *
 * The surface is set slightly BELOW the sampled ground height at the centre, so the shoreline is
 * where the terrain rises through the plane rather than a hard rectangle edge floating on a field.
 */
function buildWaterBodies(scene: WorldScene): number {
  let built = 0;
  for (const region of REGIONS) {
    // Water exists for a gameplay reason, so it is sized and centred on the fishing cluster rather
    // than on the scenic location marker. Centring on the marker put every fishing spot on dry
    // grass beside a pond, which reads as a bug even though both were where they were authored.
    const clusters = region.clusters.filter((cluster) => cluster.archetype === "fishing_spot");
    for (const cluster of clusters) {
      const [x, z] = cluster.centre;
      const half = cluster.radius + 14;

      // worldSpec carved a basin here before the terrain mesh was built, so the floor is
      // WATER_BASIN_DEPTH below the region floor. Filling most of that depth puts the waterline on
      // the sloping bank, which is what makes the shoreline follow the terrain instead of ending
      // in a rectangle.
      const floor = scene.heightAt(region.id, x, z);
      scene.buildWater(
        { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half },
        floor + WATER_BASIN_DEPTH * 0.55,
        region.id,
      );
      built += 1;
    }
  }
  return built;
}

/**
 * Draws every authored road as a draped ribbon.
 *
 * Roads existed only as scatter exclusion corridors until now: the data was read, props were kept
 * off it, and nothing was ever drawn. `scene.buildRoad` had zero callers.
 */
function buildRoads(scene: WorldScene): number {
  let built = 0;
  for (const region of REGIONS) {
    const locationById = new Map(region.locations.map((location) => [location.id, location]));
    for (const road of region.roads) {
      const from = locationById.get(road.from);
      const to = locationById.get(road.to);
      if (!from || !to) continue;

      // Sample along the link so the ribbon follows the ground instead of cutting through a rise.
      const steps = Math.max(2, Math.ceil(Math.hypot(to.position[0] - from.position[0], to.position[1] - from.position[1]) / 6));
      const points: Vec3[] = [];
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = from.position[0] + (to.position[0] - from.position[0]) * t;
        const z = from.position[1] + (to.position[1] - from.position[1]) * t;
        points.push([x, scene.heightAt(region.id, x, z), z]);
      }
      if (scene.buildRoad(points, 5, region.id)) built += 1;
    }
  }
  return built;
}

/**
 * Invisible collision proxies handed to Recast so paths route around buildings.
 * Never rendered: `visible = false` keeps them out of every draw call while Recast still reads
 * their geometry, which it takes from the buffers rather than from the render list.
 */
function buildNavObstacles(boxes: readonly BuildingBox[]): { group: THREE.Group; meshes: THREE.Mesh[] } {
  const group = new THREE.Group();
  group.name = "nav-obstacles";
  group.visible = false;
  const meshes: THREE.Mesh[] = [];
  const material = new THREE.MeshBasicMaterial();

  for (const box of boxes) {
    const [halfX, halfY, halfZ] = box.halfExtents;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(halfX * 2, halfY * 2, halfZ * 2), material);
    mesh.position.set(box.position[0], box.position[1], box.position[2]);
    mesh.rotation.y = box.rotationY;
    mesh.name = `nav-obstacle-${box.id}`;
    mesh.visible = false;
    group.add(mesh);
    meshes.push(mesh);
  }
  group.updateMatrixWorld(true);
  return { group, meshes };
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
