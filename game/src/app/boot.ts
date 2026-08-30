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
import type { EntityId, RegionId, SemanticEntity, SkillId, Vec3 } from "../contracts.js";
import { SKILL_IDS } from "../contracts.js";
import { Store, addSkillXp } from "../state/store.js";
import { EventBus } from "../core/events.js";
import { SimClock } from "../core/time.js";
import { RngStreams } from "../core/rng.js";
import { Renderer } from "../render/renderer.js";
import { OrbitCamera } from "../render/camera.js";
import { AssetRegistry } from "../render/assets.js";
import { WorldScene } from "../render/scene.js";
import { EntityViews } from "../render/entityViews.js";
import { Physics } from "../systems/physics.js";
import { Navigation, solidObstacleMeshes } from "../systems/navigation.js";
import { Movement } from "../systems/movement.js";
import { Solids } from "../systems/solids.js";
import { CorealmGameApi } from "../api/gameApi.js";
import { SaveService } from "../persistence/storage.js";
import { installBootPlaceholder, installGameDebug, type RecordedError } from "../debug/gameDebug.js";
import { GameLoop } from "./loop.js";
import { InputController } from "../input/mouse.js";
import { WATER_BASIN_DEPTH, buildWorldTerrainSpec, startingSpawn } from "./worldSpec.js";
import { prepareWorldSurface } from "./worldSurface.js";
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
import { CombatSystem } from "../systems/combat.js";
import { EnemyAiSystem } from "../systems/enemyAI.js";
import { HealthSystem } from "../systems/health.js";
import { DeathSystem } from "../systems/death.js";
import { ProductionSystem } from "../systems/production.js";
import { QuestSystem } from "../systems/quests.js";
import { DiscoverySystem } from "../systems/discovery.js";
import { DialogueSystem } from "../systems/dialogue.js";
import { TravelSystem } from "../systems/travel.js";
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
import { QUESTS } from "../content/quests.js";
import { scatterWorld, worldExclusions, type ScatterResult } from "../world/scatter.js";
import { findShot, shotIds } from "../debug/shots.js";
import { installAgentSurface } from "../agent/index.js";
import { createUi } from "../ui/panels.js";
import { SettingsStore, type UiSettings } from "../ui/settings.js";
import { keybindings } from "../input/keyboard.js";
import { Overlays } from "../render/overlays.js";
import { CharacterRig } from "../render/characterRig.js";
import { addChamberLights, buildDungeon, type DungeonSpec } from "../render/dungeon.js";
import { Ambience, Vfx, type AmbienceEmitter, type AmbienceKind } from "../render/vfx.js";
import { DocSearch, buildDocs } from "../api/docs.js";
import {
  AudioDirector, AudioEngine, COREALM_AUDIO_CATALOG, CorealmAudioBridge,
  footstepSurfaceAt, type AudioDiagnostic,
} from "../audio/index.js";

export interface BootResult {
  loop: GameLoop;
  api: CorealmGameApi;
}

export async function boot(canvas: HTMLCanvasElement): Promise<BootResult> {
  const errors: RecordedError[] = [];
  const worldMapCapture = new URLSearchParams(window.location.search).get("world-map-capture") === "1";
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
  const clientSettings = new SettingsStore();
  const initialSettings = clientSettings.get();
  const audioDiagnostics: AudioDiagnostic[] = [];
  const audioEngine = new AudioEngine(COREALM_AUDIO_CATALOG, {
    initialVolumes: {
      music: initialSettings.music,
      ambient: initialSettings.ambient,
      sfx: initialSettings.sfx,
    },
    onDiagnostic: (diagnostic) => {
      audioDiagnostics.push(diagnostic);
      if (audioDiagnostics.length > 64) audioDiagnostics.shift();
    },
  });
  audioEngine.installGestureUnlock(window);
  const audioDirector = new AudioDirector(audioEngine, COREALM_AUDIO_CATALOG, {
    regionFadeMs: 1400,
  });

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
  const terrainSpec = buildWorldTerrainSpec();
  scene.buildWorld(terrainSpec);
  // One heightfield collider rather than 28 terrain trimeshes: same ground answers, 24 ms instead
  // of a per-chunk trimesh build, and a single collider for the ray queries to walk.
  physics.addHeightfield(scene.heightfieldSamples());

  const heightAt = (regionId: RegionId, x: number, z: number): number => scene.heightAt(regionId, x, z);

  // 7b. Roads, paving and shorelines, stamped INTO the ground rather than laid on top of it.
  //
  //     Roads used to be 42 transparent depth-write-off ribbons: the frame's largest overdraw
  //     source and its largest single draw-call block, with an unpainted hole at every junction
  //     where the two ribbons' end fades met, and 10% of their vertices below the terrain mesh so
  //     the road vanished in patches. Stamped into the terrain's own vertex colours and splat
  //     weights the corridor is mip-correct, shadow-correct and z-fight-free by construction, and
  //     it costs nothing to draw. Paving and the wet band at a waterline ride the same mechanism.
  //
  //     This runs AFTER `buildWorld` deliberately: `setGroundStamps` restamps every chunk that
  //     already exists, and the water level has to be sampled off the finished terrain. Supplying
  //     roads here also retires the ribbon path — `scene.buildRoad` returns null once stamps are
  //     provided — so there is exactly one road in the world rather than two that disagree.
  prepareWorldSurface(scene, store.get().meta.seed);

  // 7c. Water. Fishing spots were authored as interaction markers with a note that the water itself
  //     is the render layer's job — and nothing was building it, so every fishing spot sat on dry
  //     grass. Each `kind: "water"` location gets a surface sunk just below the local ground.

  // 8. Semantic world. Data in, entities out, deterministic from the seed.
  setStatus("populating the frontier…");
  //
  // The ports are what stop the world being placed by accident. `baseY` is the measured bbox
  // minimum of each GLB, so an entity is placed by its FEET rather than by its origin: without it
  // the visible gap is exactly `glbMinY * scale * tierSilhouetteScale(tier)`, which is why the
  // Fallen Duskoak hovered 5.77 m and the Coldbrace fletching bench 1.41 m, and why 74 of 151
  // measured entities sat more than 5 cm off the ground. `assetSize` sizes the collision volumes
  // that make the world solid at all.
  const roadPolylines = scene.getRoadPolylines();
  const roadDistance = (x: number, z: number): number => {
    let best = Infinity;
    for (const line of roadPolylines) {
      for (let index = 0; index < line.length - 1; index += 1) {
        const a = line[index]!;
        const b = line[index + 1]!;
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const lengthSq = dx * dx + dz * dz;
        const t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / lengthSq));
        best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t)));
      }
    }
    return best;
  };
  const worldPorts = {
    heightAt,
    baseY: (assetId: string): number => assets.baseY(assetId),
    assetSize: (assetId: string): { x: number; y: number; z: number } | null => assets.assetSize(assetId),
    assetCenterXZ: (assetId: string): { x: number; z: number } | null => assets.assetCenterXZ(assetId),
    roadDistance,
  };
  const built = buildWorld(store.get().meta.seed, heightAt, worldPorts);

  // The portal arch is intentionally open geometry. From the quarry approach that otherwise
  // frames the bright world behind the hill, turning the promised "black wound" into a gate to
  // daylight. A recessed, unlit plane supplies only the visual darkness of the tunnel; it has no
  // collider, semantic entity, or navmesh volume, so the real portal remains the interaction.
  const gravelmawMouth = built.entities.find((entity) => entity.id === "gravelmaw_mouth_portal");
  if (gravelmawMouth) {
    const yaw = gravelmawMouth.view?.rotationY ?? 0;
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(3.35, 6.9),
      new THREE.MeshBasicMaterial({ color: 0x050709, toneMapped: false }),
    );
    backdrop.name = "gravelmaw-shadow-mouth";
    backdrop.position.set(
      gravelmawMouth.position[0] - Math.sin(yaw) * 0.18,
      gravelmawMouth.position[1] + 3.45,
      gravelmawMouth.position[2] - Math.cos(yaw) * 0.18,
    );
    backdrop.rotation.y = yaw;
    backdrop.castShadow = false;
    backdrop.receiveShadow = false;
    renderer.scene.add(backdrop);
  }

  const skillLevels = (): Record<SkillId, number> => {
    const levels = {} as Record<SkillId, number>;
    const skills = store.get().skills;
    for (const id of SKILL_IDS) levels[id] = skills[id].level;
    return levels;
  };

  // PRD F12's discovery gate, finally connected. `EntityStore` has always accepted this port and
  // boot has always constructed the store without one, which made it return null — and null means
  // "discovery is not gating anything", so `observe({ scope: "known" })` handed a character who had
  // never left the spawn square all forty named places in the world. The system that answers it is
  // built below, once there are locations to sweep; the closure defers to it.
  let discoverySystem: DiscoverySystem | null = null;
  const entityStore = new EntityStore({
    skillLevels,
    discoveredLocationIds: () => discoverySystem?.discovered() ?? null,
  });
  entityStore.load(built.entities);
  entityStore.registerLocations(built.knownLocations);
  const gameAudio = new CorealmAudioBridge({
    store,
    engine: audioEngine,
    director: audioDirector,
    entity: (entityId) => entityStore.get(entityId),
    surfaceAt: (position, regionId) => footstepSurfaceAt(
      regionId,
      position,
      scene.groundSurfaceAt(position[0], position[2]),
    ),
  });

  // The other half of the quest-ref check in `validateQuestObjectives`: entity and location refs
  // can only be resolved once the world exists. An objective that points an agent at an id nothing
  // built is a dead end no screenshot would ever show.
  for (const problem of validateQuestRefTargets(entityStore, built.routeNodes.map((node) => node.id))) {
    errors.push({ atMs: atMs(), source: "content.quests", message: problem });
  }

  // 8a. Dungeon interiors. The Gravelmaw was authored as chamber centres with floor offsets and
  //     nothing underneath, so everything in it hung in mid-air over the moor: entering snapped the
  //     player back to the surface and the boss chased, leashed, and walked home. Built before the
  //     navmesh so the chambers are genuinely walkable.
  const dungeonSpec = buildDungeonSpec(scene);
  const dungeon = dungeonSpec ? buildDungeon(dungeonSpec, scene.materials) : null;
  if (dungeon && dungeonSpec) {
    scene.root.add(dungeon.group);
    addChamberLights(dungeonSpec, dungeon.group);
  }

  // 8b. Buildings become solid before the navmesh is generated, so paths route around them
  //     instead of through a wall. Gatehouses emit two pier boxes with the gate gap left open.
  for (const box of built.buildings) {
    physics.addStaticBox(box.position, box.halfExtents as unknown as Vec3, box.rotationY);
  }
  // Recast reads raw geometry, so the cheapest way to make something block a path is to hand the
  // navmesh an invisible carve for it.
  //
  // Two things changed here and both were measured. The carve source is now `built.solids` rather
  // than `built.buildings`: solids is a documented SUPERSET (a consumer takes one or the other,
  // never both, or every building is carved twice), and it is the only list that contains the bank
  // chest, the anvil, the market stalls, the trees and the ore rocks the player used to walk
  // straight through. And the geometry is an open-topped ring rather than a closed box, because a
  // box top rasterises into a WALKABLE ROOF: (-160, 6, -60) snapped to y = 9.041 on the March
  // Company Hall ridge and the player could stroll five metres along it, and every teleport in the
  // game — region travel, debug teleport, focusCamera, death respawn — routes through
  // `nav.closestPoint`, so those polygons were reachable. A ring generates no roof polygon at all.
  const navCarves = solidObstacleMeshes(built.solids);
  const navCarveGroup = new THREE.Group();
  navCarveGroup.name = "nav-obstacles";
  navCarveGroup.visible = false;
  for (const mesh of navCarves) navCarveGroup.add(mesh);
  navCarveGroup.updateMatrixWorld(true);
  renderer.scene.add(navCarveGroup);

  // 9. Navmesh over the walkable terrain, then the route graph above it.
  setStatus("mapping walkable ground…");
  if (!nav.build([
    ...scene.getWalkableMeshes(),
    ...(dungeon?.walkable ?? []),
    ...(dungeon?.blockers ?? []),
    ...navCarves,
  ])) {
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
  let scatterResults: ScatterResult[] = [];
  try {
    scatterResults = await scatterWorld(scene, assets, store.get().meta.seed);
  } catch (cause) {
    errors.push({ atMs: atMs(), source: "scatter", message: describeError(cause) });
  }

  // 11. Entity views. The render layer reads `SemanticEntity.view`; it never invents an appearance.
  // Rigged characters bypass instancing, so they are the single largest draw-call line item: ten
  // full rigs in the Highcairn frame put that pose 6 calls over the 400 budget. 64 leaves room for
  // the settlement geometry while still dressing every NPC a player is close enough to talk to.
  // 96 rather than 64. The old number was chosen when a dressed NPC cost 10 skinned meshes; the
  // characters are now assembled through `render/skinning.ts` and cost 5-6, and the worst measured
  // pose sits at 322 of the 400 draw-call budget with 78 calls of headroom where it used to have 3.
  // The pool is split internally between named characters and everything else — as one counter, a
  // reserve equal to the whole budget left the enemy ceiling at exactly zero and no enemy in the
  // game had ever animated.
  const entityViews = new EntityViews(scene, assets, scene.materials, {
    maxUniqueDrawCalls: 96,
    maxUniqueViews: 16,
  });
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
  // Region loops are selected only after the save decides the player's real starting region.
  // Until this point gesture unlock has no desired loop to start, so the loading screen cannot
  // briefly play Fallowmarch over a character saved elsewhere.
  audioDirector.setRegion(store.get().player.regionId);

  // 14. API and hooks. Everything a human or an agent does goes through here.
  const movement = new Movement(nav, events);
  // Everything that makes a step honest. `Movement` runs without any of these — that is what let it
  // be written while boot was frozen — and running without them is what "no collisions" meant:
  // only the navmesh constrained a step, so direct WASD input walked through the bank chest, the
  // anvil, both market stalls, an NPC, an enemy, a tree and an ore rock. `solids` does the XZ
  // push-out with a wall slide; `heightAt` puts the player's feet on the same ground plane
  // everything else is placed on, instead of 0.147-0.417 m above it on the navmesh; `entities`
  // pushes out of the things that move, which a navmesh carve cannot follow.
  const solids = new Solids(built.solids);
  movement.setPorts({ solids, heightAt, entities: entityStore });
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

  // ---- Combat and production. Combat is NOT an activity: it lives in its own state slice so the
  // player can eat while auto-attacking, without which the boss is unwinnable.
  const combatSystem = new CombatSystem({
    store, events, rng,
    entities: entityStore,
    equipment: equipmentSystem,
    inventory: inventorySystem,
    dispatcher: interactions,
    movement,
    activity: activitySystem,
  });
  const enemyAiSystem = new EnemyAiSystem({
    store, events, entities: entityStore, combat: combatSystem, nav,
  });
  const healthSystem = new HealthSystem({ store, events, equipment: equipmentSystem });
  const deathSystem = new DeathSystem({
    store, events,
    entities: entityStore,
    inventory: inventorySystem,
    dispatcher: interactions,
    // Respawn points are authored per region; fall back to the region's own spawn.
    respawn: {
      resolve: (respawnPointId: string, regionId: RegionId) => {
        const node = nav.routeNode(respawnPointId);
        if (node) return { position: node.position, regionId: node.regionId as RegionId };
        const region = getRegion(regionId) ?? getRegion("fallowmarch");
        const fallbackId: RegionId = region?.id ?? "fallowmarch";
        const spot = region?.spawnPoint ?? [spawnSpec.x, spawnSpec.z];
        const y = scene.heightAt(fallbackId, spot[0], spot[1]);
        return { position: [spot[0], y, spot[1]] as Vec3, regionId: fallbackId };
      },
    },
    health: healthSystem,
    combat: combatSystem,
    enemyAi: enemyAiSystem,
    activity: activitySystem,
    movement,
    snapToGround: (point) => nav.closestPoint(point),
    // Without this the recovery cache has no `view`, and `entityViews.sync` skips any entity that
    // has none — so everything the player was carrying sat on a patch of grass with nothing drawn
    // over it and nothing to right-click. The agent path never noticed, because an agent finds it
    // through `observe` and loots it by id; a human had no way to see that it was there at all.
    // That asymmetry is the exact thing this project's parity rule exists to catch.
    cacheView: { assetId: "crate_wood", scale: 1.1, labelHeight: 1.4 },
  });
  const productionSystem = new ProductionSystem({
    store, events, rng,
    entities: entityStore,
    inventory: inventorySystem,
    activity: activitySystem,
    dispatcher: interactions,
  });
  activitySystem.register(productionSystem.driver);

  // ---- Quests and dialogue.
  //
  // Quests are the only system that writes world state (two doors), so the entity port is narrowed
  // to exactly that: read, and set a state with an optional locked reason.
  const questEntityPort = {
    get: (id: EntityId) => entityStore.get(id),
    setState: (id: EntityId, state: string, lockedReason?: string): boolean => {
      const entity = entityStore.get(id);
      if (!entity) return false;
      entity.state = state;
      if (lockedReason !== undefined) {
        entity.meta = { ...(entity.meta ?? {}), lockedReason };
      }
      return true;
    },
  };

  // XP must travel the real level-up path, or `level.gained` never fires and quests that reward XP
  // silently skip the level a player just earned.
  const questXpPort = {
    award: (skill: SkillId, amount: number): void => {
      const result = addSkillXp(store.get(), skill, amount);
      if (result.levelsGained > 0) {
        events.emit(
          "level.gained",
          { skill, level: result.newLevel, levelsGained: result.levelsGained },
          undefined,
          clock.elapsedMs,
        );
      }
      store.markDirty();
    },
  };

  discoverySystem = new DiscoverySystem({
    store,
    events,
    locations: () => built.knownLocations,
  });
  // Once, before the first frame: a loaded save or a fresh spawn knows where it is standing rather
  // than finding out 700 ms in.
  discoverySystem.sweep(clock.elapsedMs);

  const questSystem = new QuestSystem({
    store, events, clock,
    entities: questEntityPort,
    inventory: inventorySystem,
    xp: questXpPort,
    dispatcher: interactions,
  });
  const dialogueSystem = new DialogueSystem({
    store, events, clock,
    entities: entityStore,
    inventory: inventorySystem,
    xp: questXpPort,
    quests: questSystem,
    dispatcher: interactions,
  });

  // Portals. Registered AFTER agility so this handler wins the `enter` verb; it hands genuine
  // obstacles back rather than teleporting past a climb the player has not earned.
  /**
   * Which region a world point is in, accounting for the dungeon underneath Karrowmoor.
   *
   * `scene.regionAt` answers from terrain XZ alone, so every point in the Gravelmaw reports
   * "karrowmoor" — the dungeon is directly below it. That made teleporting into the arena leave the
   * player tagged as being on the surface, and the render filter that hides dungeon entities from
   * outside then culled the boss and the whole interior. The tier 10 encounter photographed as
   * empty sky.
   */
  const regionAtPoint = (point: Vec3): RegionId => {
    if (dungeonSpec) {
      for (const chamber of dungeonSpec.chambers) {
        const flat = Math.hypot(point[0] - chamber.centre[0], point[2] - chamber.centre[1]);
        if (flat <= chamber.radius + 4 && Math.abs(point[1] - chamber.floorY) <= 6) {
          return dungeonSpec.regionId;
        }
      }
    }
    return scene.regionAt(point[0], point[2]);
  };
  // Region is part of semantic player state, so ordinary movement must update it too. This port
  // uses Y to distinguish Gravelmaw from the Karrowmoor terrain directly above it.
  movement.setPorts({ regionAt: (point) => regionAtPoint(point) });

  const teleportPlayer = (position: Vec3, regionId: RegionId): void => {
    const snapped = nav.closestPoint(position) ?? position;
    store.get().player.position = snapped;
    store.get().player.regionId = regionId;
    audioDirector.setRegion(regionId);
    movement.stop(store.get(), clock.elapsedMs, "portal");
    scene.syncPlayer(snapped, store.get().player.facingRad, true);
    camera.update(snapped[0], snapped[1], snapped[2], true);
  };
  const travelSystem = new TravelSystem({
    store, events, clock,
    entities: entityStore,
    nav,
    dispatcher: interactions,
    place: teleportPlayer,
  });
  void travelSystem;

  api.register("quests", questSystem);
  api.register("dialogue", dialogueSystem);
  api.register("combat", combatSystem.hook());
  api.register("production", productionSystem.hook());
  api.register("inventory", {
    slots: () => inventorySystem.slots(),
    freeSlots: () => inventorySystem.freeSlots(),
    use: (itemId, target) => {
      const result = inventorySystem.use(itemId, target);
      gameAudio.handleInventoryUse(result);
      return result;
    },
  });
  api.register("equipment", equipmentSystem);
  api.register("bank", {
    op: (op, args) => {
      const result = bankSystem.op(op, args);
      gameAudio.handleBank(op, result.ok);
      return result;
    },
  });
  api.register("shop", {
    op: (op, args) => {
      const result = economySystem.op(op, args);
      gameAudio.handleTrade(op, result.ok);
      return result;
    },
  });
  api.register("activity", activitySystem.hook());

  api.register("entities", {
    get: (id) => entityStore.get(id),
    all: () => entityStore.all(),
    observe: (filter, from) => entityStore.observe(filter, from),
  });
  api.register("interactions", {
    run: (id, interaction) => {
      const result = interactions.run(id, interaction);
      gameAudio.handleInteraction(interaction, result);
      return result;
    },
  });

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
  events.subscribe((event) => gameAudio.handleEvent(event));

  // Standing atmosphere, as opposed to the event-driven feedback above. Both are polled from Vfx's
  // own update, so the loop needs no change. One InstancedMesh for the whole world.
  const ambience = new Ambience(scene.overlayGroup, { maxParticles: 640 });
  vfx.setAmbience(ambience);
  for (const emitter of collectAmbienceEmitters(scene, built)) ambience.addEmitter(emitter);
  // Polled rather than pushed: a telegraph has to keep drawing for the whole wind-up, and a dropped
  // frame on an `onTelegraph` listener would leave a ring on the ground after the slam landed.
  vfx.setTelegraphSource(() => enemyAiSystem.telegraphs().map((telegraph) => ({
    id: telegraph.enemyId,
    centre: telegraph.centre,
    radius: telegraph.radius,
    progress: telegraph.firesAtMs > telegraph.startedAtMs
      ? Math.min(1, Math.max(0, (clock.elapsedMs - telegraph.startedAtMs) / (telegraph.firesAtMs - telegraph.startedAtMs)))
      : 1,
  })));

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
  const WALK_DESTINATION_HIGHLIGHT_ID = "ui:walk-destination";
  const HOVER_HIGHLIGHT = "#e4bd62";
  const SELECTION_HIGHLIGHT = "#dbe5cf";
  let hoveredActionId: EntityId | null = null;
  let selectedEntityId: EntityId | null = null;

  const repaintEntityHighlight = (entityId: EntityId | null): void => {
    if (!entityId) return;
    entityViews.clearHighlight(entityId);
    if (entityId === selectedEntityId) {
      entityViews.setHighlight(entityId, SELECTION_HIGHLIGHT, true);
    } else if (entityId === hoveredActionId) {
      entityViews.setHighlight(entityId, HOVER_HIGHLIGHT, false);
    }
  };

  const input = new InputController(canvas, renderer, camera, api, movement, {
    onHoverChange: (entityId) => {
      const inspected = entityId ? api.inspect(entityId) : null;
      const next = inspected?.ok && inspected.value.interactions.length > 0 ? entityId : null;
      const previous = hoveredActionId;
      if (previous === next) return;

      hoveredActionId = next;
      repaintEntityHighlight(previous);
      repaintEntityHighlight(next);
    },
    onSelectionChange: (entityId) => {
      const previous = selectedEntityId;
      selectedEntityId = entityId;

      repaintEntityHighlight(previous);
      repaintEntityHighlight(entityId);
      if (entityId) {
        // An action target owns the outline. A ground highlight here would imply the click was only
        // movement, even when the API is walking into range before mining, talking, or attacking.
        overlays.clear(WALK_DESTINATION_HIGHLIGHT_ID);
      }
    },
    onWalkDestination: (point) => {
      overlays.setWalkDestination(WALK_DESTINATION_HIGHLIGHT_ID, point, clock.elapsedMs);
    },
  });
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
  // There is exactly ONE KeyboardController, and `InputController` owns it. A second one used to
  // stand here: both listened on `window`, both dispatched the same keydown through the same
  // shared registry, and every panel key therefore fired twice — open, then closed, in one press.
  // Movement still worked (held keys are a set, so adding twice is adding once), which is why the
  // panels looked unbound rather than double-bound and no screenshot in Phase 1 ever showed one.

  // The agent surface. Always installed at window.corealm.agent, and mirrored onto whichever
  // model-context container the browser provides. One implementation, three ways in.
  // The human UI. Everything it does goes through GameApi, the same object the agent tools call.
  const ui = createUi(api, {
    settings: clientSettings,
    mapTerrain: {
      bounds: terrainSpec.bounds,
      sample: (x, z) => ({
        height: scene.meshHeightAt(x, z),
        normal: scene.normalAt(x, z),
        regionId: scene.regionAt(x, z),
      }),
      roadPolylines: () => scene.getRoadPolylines(),
    },
    // OrbitCamera yaw is measured from +z clockwise; the compass wants a heading in the same frame.
    getHeadingRad: () => camera.yaw,
    hasSave: () => loaded.status === "loaded",
    // Declared below. Referenced from inside a closure, so the temporal dead zone never applies:
    // nothing can press "New game" before boot has finished running.
    onNewGame: () => resetWorld(undefined, false),
  });
  ui.mount(labelRoot);

  // UI sound follows semantic activation, so pointer clicks and keyboard-generated clicks share
  // one path. Canvas clicks are excluded: world actions have their own material-specific cues.
  labelRoot.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("button, [role='button'], input[type='range'], select")
      : null;
    if (!target || target.matches(":disabled, [aria-disabled='true']")) return;
    gameAudio.playUi("ui.click");
  }, { capture: true });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.repeat) gameAudio.playUi("ui.cancel");
  }, { capture: true });

  // Client preferences. Each one is applied here, and each one changes something on the next frame
  // — see the note in ui/settings.ts about why a setting that does nothing is worse than none.
  let appliedPreferences: UiSettings | null = null;
  ui.settings.subscribe((preferences) => {
    const previous = appliedPreferences;
    if (!previous
      || previous.music !== preferences.music
      || previous.ambient !== preferences.ambient
      || previous.sfx !== preferences.sfx) {
      audioEngine.setVolumes({
        music: preferences.music,
        ambient: preferences.ambient,
        sfx: preferences.sfx,
      });
    }
    if (!previous || previous.renderScale !== preferences.renderScale) {
      renderer.setRenderScale(preferences.renderScale);
    }
    if (!previous || previous.shadowQuality !== preferences.shadowQuality) {
      renderer.setShadowQuality(preferences.shadowQuality);
    }
    if (!previous || previous.drawDistance !== preferences.drawDistance) {
      renderer.setDrawDistance(preferences.drawDistance);
    }
    if (!previous || previous.invertCameraY !== preferences.invertCameraY) {
      camera.invertPitch = preferences.invertCameraY;
    }
    if (!previous || previous.damageNumbers !== preferences.damageNumbers) {
      vfx.damageNumbers = preferences.damageNumbers;
    }
    if (!previous || previous.uiScale !== preferences.uiScale) {
      labelRoot.classList.toggle("is-compact", preferences.uiScale === "compact");
    }
    appliedPreferences = preferences;
  });

  // A bank or shop interaction has no event of its own, so the panel opens off the successful
  // interaction rather than off a signal that does not exist.
  events.subscribe((event) => {
    if (event.type !== "activity.started" || !event.entityId) return;
    const entity = entityStore.get(event.entityId);
    if (entity?.archetype === "bank") ui.openBank(entity.id);
    else if (entity?.archetype === "shop") ui.openShop(entity.id);
  });

  // Dialogue and death both have real events, so the windows follow the game rather than the click
  // that caused it: a conversation opened by a mouse click, by the context menu, or by an agent
  // calling `corealm_interact` all raise the same window.
  events.subscribe((event) => {
    if (event.type === "navigation.completed" || event.type === "navigation.failed") {
      overlays.clear(WALK_DESTINATION_HIGHLIGHT_ID);
    }
    if (event.type === "dialogue.opened") ui.openDialogue();
    else if (event.type === "dialogue.closed") ui.closeDialogue();
    else if (event.type === "player.died") {
      const data = event.data as Record<string, unknown>;
      ui.showDeath({
        position: (data["position"] ?? [0, 0, 0]) as [number, number, number],
        regionId: String(data["regionId"] ?? ""),
        respawnPosition: (data["respawnPosition"] ?? [0, 0, 0]) as [number, number, number],
        respawnPointId: String(data["respawnPointId"] ?? ""),
        cacheId: typeof data["cacheId"] === "string" ? data["cacheId"] : null,
        itemsLost: Number(data["itemsLost"] ?? 0),
        expiresAtMs: typeof data["expiresAtMs"] === "number" ? data["expiresAtMs"] : null,
      });
    }
  });

  // The pause menu, on the last Escape.
  //
  // Priority 950 puts it after `input.cancel` at 900. Escape closes the top panel if one is open.
  // Otherwise it cancels the current activity and continues here, so one press always reaches the
  // pause menu from ordinary play.
  keybindings.register({
    id: "ui.menu",
    keys: ["escape"],
    label: "Pause menu",
    group: "General",
    priority: 950,
    onDown: () => {
      ui.openTitle();
      return true;
    },
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
  loop.addSystem(enemyAiSystem);
  loop.addSystem(combatSystem);
  loop.addSystem(healthSystem);
  loop.addSystem(deathSystem);
  loop.addSystem(productionSystem);
  loop.addSystem(questSystem);
  loop.addSystem(discoverySystem);
  loop.addSystem(gameAudio);

  if (dungeon) loop.addInterior(dungeon.group, () => store.get().player.regionId === "gravelmaw");
  // What the player is interacting with, so the rig can pick a pose for it: opening a chest is not
  // the same animation as swinging at a rock.
  loop.setArchetypeLookup((id) => entityStore.get(id)?.archetype ?? null);
  loop.setOverlays(overlays);
  loop.setVfx(vfx);
  loop.setCombatHits(() => combatSystem.consumeHits());
  loop.setCombatPresentationHandler((hit, phase) => gameAudio.handlePlayerCombatMotion(hit, phase));
  loop.setPlayerMotionHandler((event) => {
    if (event.kind === "footstep") {
      gameAudio.handleFootstep();
    } else if (event.pose === "mine" || event.pose === "chop") {
      gameAudio.handleGatherMotion(event.pose, event.kind);
    }
  });
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
    loop.resetPresentation();
    gameAudio.reset();

    // Node yields and enemy health are seeded world state, so a reset rebuilds them rather than
    // leaving a half-mined world behind a nominally fresh character.
    const rebuilt = buildWorld(store.get().meta.seed, heightAt, worldPorts);
    entityStore.load(rebuilt.entities);
    entityStore.registerLocations(rebuilt.knownLocations);
    nav.setRouteGraph(rebuilt.routeNodes, rebuilt.routeEdges);
    entityViews.sync(entityStore.all());
    errors.length = 0;
  };

  installGameDebug({
    store, events, clock, nav, movement, api, renderer, camera, assets, errors,
    version,
    audioState: () => ({
      ...audioEngine.snapshot(),
      regionId: store.get().player.regionId,
      diagnostics: audioDiagnostics.map(({ kind, message, name, url }) => ({ kind, message, name, url })),
    }),
    audioHistory: (limit) => audioEngine.history(limit),
    clearAudioHistory: () => audioEngine.clearHistory(),
    // "scatter placed nothing" and "nobody asked scatter" are different bugs, and the debug surface
    // could not tell them apart while boot threw this array away.
    scatterStats: () => scatterResults,
    playerMotion: () => playerRig.motionSnapshot(),
    entityMotion: (entityId: EntityId) => entityViews.motionSnapshot(entityId),
    waterBodies: () => scene.getWaterBodies(),
    captureWorldMapTile: (options) => {
      const position = store.get().player.position;
      // All terrain, assets and entity batches are resident; only procedural scatter is hidden by
      // region streaming. Reveal it for this synchronous render, then restore the gameplay view.
      scene.updateStreaming(0, 0, Infinity);
      try {
        return renderer.captureTopDownTile({
          ...options,
          centreY: scene.meshHeightAt(options.centreX, options.centreZ),
        });
      } finally {
        if (!worldMapCapture) scene.updateStreaming(position[0], position[2]);
      }
    },
    resetWorld,
    isIdle: () => store.get().player.movement.mode === "idle" && store.get().activity === null,
    teleport: (to: Vec3) => {
      const snapped = nav.closestPoint(to) ?? to;
      const regionId = regionAtPoint(snapped);
      store.get().player.position = snapped;
      store.get().player.regionId = regionId;
      audioDirector.setRegion(regionId);
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
    /**
     * Empties a node through the REAL depletion path rather than by writing `remaining = 0`, so a
     * test sees the same events, the same state transition, and the same respawn timer a player
     * would. A shortcut that bypasses the system proves nothing about the system.
     */
    depleteNode: (entityId: string) => {
      const entity = entityStore.get(entityId);
      if (!entity?.resource) return false;
      const node = store.get().world.nodes[entityId];
      if (node) node.remaining = 1;
      entity.resource.remaining = 1;
      // One more successful gather now empties it, and the system does the rest.
      return gatheringSystem.forceDeplete(entityId, clock.elapsedMs);
    },

    forceRespawn: (entityId: string) => gatheringSystem.forceRespawn(entityId, clock.elapsedMs),
    drawnBounds: (entityId: string) => entityViews.drawnBounds(entityId),
    entityViewStats: () => entityViews.stats(),
    groundHeight: (x: number, z: number) => scene.heightAtXZ(x, z),
    listBuildings: () => REGIONS.flatMap((region) => (region.settlement?.buildings ?? []).map((building) => ({
      id: building.id,
      prefab: building.prefab,
      x: building.position[0],
      z: building.position[1],
      width: building.footprint[0],
      depth: building.footprint[1],
      rotationY: building.rotationY,
    }))),

    // Silent on purpose. `addItem` emits `item.received`, which the quest system counts into
    // `gather:<itemId>` — so an unsilenced debug grant could complete a gather stage on its own,
    // which is exactly the hole the gate check's "debug may set a check up, never satisfy one" rule
    // exists to close. Cold Iron stage 1 and the whole of Dorn's Tally were satisfiable by
    // `giveItem` alone.
    giveItem: (itemId: string, quantity: number, to: string) => (
      to === "bank"
        ? bankSystem.op("deposit", { itemId, quantity })
        : inventorySystem.addItem(itemId, quantity, { silent: true })
    ),
    openBank: (bankId?: string) => {
      ui.openBank(bankId);
      return true;
    },
    openShop: (shopId?: string) => {
      ui.openShop(shopId);
      return true;
    },
    focusCamera: (shotId: string) => {
      const shot = findShot(shotId);
      if (!shot) return false;
      const node = nav.routeNode(shot.locationId);
      if (!node) return false;
      const landed = nav.closestPoint(node.position) ?? node.position;
      store.get().player.position = landed;
      store.get().player.regionId = scene.regionAt(landed[0], landed[2]);
      audioDirector.setRegion(store.get().player.regionId);
      movement.stop(store.get(), clock.elapsedMs, "focus-camera");
      scene.syncPlayer(landed, shot.yaw + Math.PI, true);
      camera.setPose(shot.yaw, shot.pitch, shot.distance);
      camera.update(landed[0], landed[1], landed[2], true);
      return true;
    },
    listShots: () => shotIds(),
    callTool: (name: string, args: unknown) => agent.call(name, (args ?? {}) as Record<string, unknown>),
  });

  // Every shader the session will need, compiled now rather than the first time a pose reveals it.
  // Measured before this existed: the program count climbed 19 -> 20 mid-session and the frames
  // that paid for it were 1130 ms, 994 ms and 346 ms. The two extra passes are for variants three
  // skips by default — a material only compiles its transparent form when something is actually
  // transparent, and three skips everything under an invisible ancestor, which is the whole dungeon
  // and the +3-point-light variant of every material in it.
  setStatus("warming the shaders…");
  renderer.warmup({
    transparentVariants: [scene.root],
    temporarilyVisible: dungeon ? [dungeon.group] : [],
  });

  document.getElementById("boot-screen")?.remove();
  if (worldMapCapture) {
    // Build-time capture is deterministic: no animation/motion frame may land between two tiles.
    scene.updateTime(0);
    scene.updateStreaming(0, 0, Infinity);
  } else {
    loop.start();
  }
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

  problems.push(...validateQuestObjectives(itemIds));
  return problems;
}

/**
 * Objective prose is what a player reads; `refs` is what an agent acts on. Two ways that pair goes
 * wrong, both caught here rather than in a screenshot:
 *
 *  1. A developer id leaks back into the sentence. Any backtick in an objective is one.
 *  2. A ref names something that does not exist, which is worse than an inline id because nothing
 *     renders it and nobody notices until an agent calls `moveTo` on it.
 *
 * Entity and location ids are checked at world-build time instead — the entity table does not exist
 * yet when content validates — so only the content-resolvable kinds are checked here.
 */
function validateQuestRefTargets(entityStore: EntityStore, locationIds: readonly string[]): string[] {
  const problems: string[] = [];
  const known = new Set(locationIds);
  for (const quest of QUESTS) {
    for (const stage of quest.stages) {
      for (const ref of stage.refs ?? []) {
        if (ref.kind === "entity" && !entityStore.get(ref.id)) {
          problems.push(`quest ${quest.id} stage ${stage.index} ref names unknown entity "${ref.id}"`);
        }
        if (ref.kind === "location" && !known.has(ref.id)) {
          problems.push(`quest ${quest.id} stage ${stage.index} ref names unknown location "${ref.id}"`);
        }
      }
    }
  }
  return problems;
}

function validateQuestObjectives(itemIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const recipeIds = new Set(content.allRecipes().map((recipe) => recipe.id));
  const spellIds = new Set(content.allSpells().map((spell) => spell.id));

  for (const quest of QUESTS) {
    for (const stage of quest.stages) {
      const where = `quest ${quest.id} stage ${stage.index}`;
      if (stage.objective.includes("`")) {
        problems.push(`${where} objective still prints a developer id: ${stage.objective}`);
      }
      for (const ref of stage.refs ?? []) {
        if (ref.kind === "item" && !itemIds.has(ref.id)) {
          problems.push(`${where} ref names unknown item "${ref.id}"`);
        }
        if (ref.kind === "recipe" && !recipeIds.has(ref.id)) {
          problems.push(`${where} ref names unknown recipe "${ref.id}"`);
        }
        if (ref.kind === "spell" && !spellIds.has(ref.id)) {
          problems.push(`${where} ref names unknown spell "${ref.id}"`);
        }
      }
    }
  }
  return problems;
}

/**
 * Puts water under every location authored as water.
 *
 * The surface is set slightly BELOW the sampled ground height at the centre, so the shoreline is
 * where the terrain rises through the plane rather than a hard rectangle edge floating on a field.
 */
/**
 * The authored road network, as polylines for the ground stamp.
 *
 * Roads are authored as location links, then resolved through an actual settlement gate whenever
 * one endpoint lies inside a wall circuit. The gate is an interior control point, not a decorative
 * suggestion: stamping, scatter exclusion and the map all consume the same resulting polyline.
 * Samples follow the terrain every six metres. The renderer may add a small deterministic meander
 * between those fixed controls, while the route graph remains keyed by the original node ids.
 */
/**
 * Paved ground, from whatever the settlements author.
 *
 * Empty until a settlement carries a `paving` array. The tiles themselves are instanced scenery
 * emitted by `world/regionBuilder.ts`; this is the ground UNDER them, which has to read as cobble
 * rather than as grass showing through a 2 cm gap between 2 m tiles.
 */
/**
 * Where water meets land, so the bank gets mud and wet stone instead of dry grass to the waterline.
 *
 * Centred and sized on the fishing CLUSTER rather than the scenic location marker, for the same
 * reason `buildWaterBodies` is: centring on the marker put every fishing spot on dry grass beside a
 * pond, which reads as a bug even though both were where they were authored. The two must agree, so
 * they derive from the same numbers.
 */
/**
 * Turns the authored dungeon data into a geometry spec.
 *
 * Chamber floors are absolute heights here: the content stores an offset from the terrain at the
 * mouth, which is the one point the surface and the interior agree on. Corridors are derived from
 * the chamber order rather than authored, because the chambers descend in a line and an authored
 * corridor list would be a second thing to keep in step.
 */
function buildDungeonSpec(scene: WorldScene): DungeonSpec | null {
  for (const region of REGIONS) {
    const dungeon = region.dungeon;
    if (!dungeon) continue;

    const base = scene.heightAt(region.id, dungeon.entrance[0], dungeon.entrance[1]);
    const chambers = dungeon.chambers.map((chamber) => ({
      id: chamber.id,
      name: chamber.name,
      centre: [chamber.centre[0], chamber.centre[1]] as [number, number],
      radius: chamber.radius,
      floorY: base + chamber.floorOffset,
      lit: chamber.lit,
    }));

    const corridors = chambers.slice(0, -1).map((chamber, index) => {
      const next = chambers[index + 1]!;
      return {
        from: chamber.centre,
        to: next.centre,
        fromY: chamber.floorY,
        toY: next.floorY,
        width: 6,
      };
    });

        // Tall enough to reach the terrain above. At 7 m the chamber wall stopped 5 m short of
    // Karrowmoor's surface and the elevated camera looked straight over it into daylight.
    return { regionId: dungeon.id, chambers, corridors, wallHeight: 13 };
  }
  return null;
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
  }
  // Use the exact stamped centrelines, including gate controls and deterministic meander. A second
  // straight-line reconstruction lets scatter and clusters grow directly through the visible road.
  for (const [index, points] of scene.getRoadPolylines().entries()) {
    worldExclusions.addCorridor(points, 8, "road", `resolved-road-${index}`);
  }
}

/** Loads every GLB the world's entities name, so the first sync does not pop meshes in late. */
/**
 * Assets for entities the world creates while it is running rather than at build time.
 *
 * Today that is one thing: the recovery cache dropped where the player died.
 */
const SPAWNED_LATER_ASSET_IDS: readonly string[] = ["crate_wood"];

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
  // Entities that do not exist yet but will. `EntityViews.syncOne` returns early when an asset is
  // not loaded and nothing ever retries, so anything spawned mid-session has to be in memory now
  // or it will never be drawn at all.
  for (const id of SPAWNED_LATER_ASSET_IDS) ids.add(id);
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

/**
 * Standing atmosphere, placed off the same authored data everything else is placed off.
 *
 * There is no "atmosphere" content type and there should not be one: every emitter here is implied
 * by something the world already contains. A chimney is a cottage's chimney, a forge fire is a
 * smithing station, a ripple is a fishing spot. Deriving them means a settlement that adds a house
 * gets its smoke for free, and a settlement that moves one does not leave a plume behind.
 *
 * All of it lands in ONE InstancedMesh, so the whole world's smoke, sparks and ripples cost a
 * single draw call. Each emitter carries its own cull distance, so a chimney 200 m away contributes
 * nothing at all rather than a sub-pixel sprite.
 */
function collectAmbienceEmitters(scene: WorldScene, built: { entities: readonly SemanticEntity[] }): AmbienceEmitter[] {
  const emitters: AmbienceEmitter[] = [];

  // Chimney smoke, read off the assembled buildings rather than off the building list: `cottage`
  // and `quarry_hut` place their chimney with a seeded offset, so the only thing that knows where
  // the flue actually came out is the emitted part.
  for (const entity of built.entities) {
    if (entity.view?.assetId !== "chimney") continue;
    emitters.push({
      id: `smoke-${entity.id}`,
      kind: "smoke",
      // The part is placed at the chimney's base; the smoke leaves the top of it.
      position: [entity.position[0], entity.position[1] + 3.1, entity.position[2]],
      scale: 1,
    });
  }

  // Forge fire and cooking heat, from the stations themselves.
  for (const region of REGIONS) {
    for (const station of region.settlement?.stations ?? []) {
      const kind: AmbienceKind | null =
        station.kind === "furnace" ? "spark" : station.kind === "range" ? "smoke" : null;
      if (!kind) continue;
      const [x, z] = station.position;
      emitters.push({
        id: `station-${station.id}`,
        kind,
        position: [x, scene.heightAt(region.id, x, z) + (kind === "spark" ? 0.9 : 0.7), z],
        scale: kind === "spark" ? 0.7 : 0.8,
      });
    }

    // Water movement, on the fishing clusters the water surface is centred on.
    for (const cluster of region.clusters) {
      if (cluster.archetype !== "fishing_spot") continue;
      const [x, z] = cluster.centre;
      emitters.push({
        id: `ripple-${cluster.id}`,
        kind: "ripple",
        position: [x, scene.heightAt(region.id, x, z) + WATER_BASIN_DEPTH * 0.55, z],
        scale: Math.max(1, cluster.radius / 8),
      });
    }
  }

  return emitters;
}
