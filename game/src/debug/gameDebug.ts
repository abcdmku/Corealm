/**
 * `window.__gameDebug` — the test surface. Game code never calls it.
 *
 * The nine harness-required methods are FIXED by tools/lib/driver.ts and tools/smoke-test.ts. Their
 * names, synchrony, and return shapes are not ours to choose (see runs/corealm/architecture.md,
 * correction R1):
 *
 *   - all nine are SYNCHRONOUS: the driver reads them inside page.evaluate and JSON-serialises the
 *     result. Full snapshots include getEntities(); the default lean profile omits those thousands
 *     of rows. A Promise from any getter would still serialise to {}.
 *   - all nine are JSON-SAFE: callDebug does JSON.parse(JSON.stringify(fn() ?? null))
 *   - getState().ready gates boot detection
 *   - getPlayerPosition() returns {x,y,z}, NOT the Vec3 tuple the contracts use internally
 *   - getNavigationState().status must literally be "ready"
 *   - reset() takes effect within ~150 ms and is not awaited
 *   - volatile per-frame data lives under exactly `clock` and `renderer`, because
 *     play-game.ts's semanticFingerprint deletes those two keys before diffing. Anything volatile
 *     elsewhere makes every scenario step report changed:true and destroys the signal.
 *
 * Everything below the nine is a Corealm-specific test helper.
 */
import type * as THREE from "three";
import type { EntityId, ItemId, QuestId, SkillId, Vec3 } from "../contracts.js";
import type { Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { Navigation } from "../systems/navigation.js";
import type { Movement } from "../systems/movement.js";
import type { CorealmGameApi } from "../api/gameApi.js";
import type { Renderer } from "../render/renderer.js";
import type { OrbitCamera } from "../render/camera.js";
import type { AssetRegistry } from "../render/assets.js";
import { addSkillXp, setSkillLevel as applySkillLevel } from "../state/store.js";
import { PROCEDURAL_GEAR_ASSETS } from "../render/proceduralGear.js";
import { roundVec3 } from "../core/math.js";
import { keybindings } from "../input/keyboard.js";

export interface RecordedError {
  atMs: number;
  source: string;
  message: string;
  stack?: string;
}

export interface DebugDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  nav: Navigation;
  movement: Movement;
  api: CorealmGameApi;
  renderer: Renderer;
  camera: OrbitCamera;
  assets: AssetRegistry;
  errors: RecordedError[];
  /**
   * Live particle count in the spell effect layer, when one is wired.
   *
   * Exists because the alternative is guessing. `render/spellVfx.ts` draws through ONE additive
   * InstancedMesh, so from outside the only evidence a cast produced anything is `drawCalls` moving
   * by one — and that number also moves when the player crosses a streaming boundary or a building
   * fades, which is most of what happens while walking to a fight. `tools/verify-magic.ts` was
   * reading draw calls and calling a streamed-in hedge a spell. This answers the question directly.
   */
  spellParticles?(): number;
  /** JSON-safe audio playback state and evidence; absent only in boot-fallback tests. */
  audioState?(): unknown;
  audioHistory?(limit?: number): unknown;
  clearAudioHistory?(): void;
  version: { build: string; contracts: string; content: string };
  /** Rebuilds the world and restores spawn state. Must complete synchronously. */
  resetWorld(seed?: number, keepSave?: boolean): void;
  /** True when nothing is pending: no navigation, activity, combat, or asset load. */
  isIdle(): boolean;
  teleport(to: Vec3): void;
  saveNow(): void;
  getSaveBlob(): string;
  loadSaveBlob(json: string): void;
  /** Fast-forwards world timers that deliberately do not use the session SimClock. */
  advanceWorldTime?(seconds: number): void;
  focusCamera(shotId: string): boolean;
  /** Frames the live player closely enough to inspect held equipment. */
  focusPlayer(): boolean;
  /** Frames one live entity for generated guide photography. */
  focusEntity(entityId: EntityId): boolean;
  /** Frames a route-graph location, using its authored shot when one exists. */
  focusLocation(locationId: string): boolean;
  /**
   * Free orbit pose around an arbitrary world point, for structure inspection.
   *
   * `focusCamera` and `focusLocation` both snap their target to the navmesh, which is right for a
   * gameplay pose and wrong for photographing a roof: the interesting half of a structure audit is
   * above head height and off the walkable surface. This one places the orbit centre exactly where
   * it is asked to.
   */
  inspectPose(target: Vec3, yaw: number, pitch: number, distance: number): boolean;
  /** Freezes simulation and hides the player while documentation captures run. */
  setCaptureMode(enabled: boolean): void;
  /** Renders and returns the current gameplay canvas before another frame can clear it. */
  captureDocumentationFrame(): string;
  listShots(): string[];
  callTool(name: string, args: unknown): Promise<unknown>;
  /** Test-only item grant. Goes through the real inventory so slot limits still apply. */
  giveItem(itemId: ItemId, quantity: number, to: "inventory" | "bank"): unknown;
  /** Opens the real bank panel after a browser check has moved the player into bank range. */
  openBank?(bankId?: EntityId): boolean;
  /** Opens the real shop panel for browser acceptance without depending on unfinished trade wiring. */
  openShop?(shopId?: EntityId): boolean;
  /** Empties a resource node through the real depletion path, so events and respawn still fire. */
  depleteNode(entityId: EntityId): boolean;
  /** Brings a node or enemy back immediately, skipping its respawn timer. */
  forceRespawn(entityId: EntityId): boolean;
  /** World-space box the renderer draws for one entity, or null when it draws nothing. */
  drawnBounds(entityId: EntityId): { min: Vec3; max: Vec3; meshes: number; path: string } | null;
  /** Instancing, rig and draw-call budget state for the entity layer. */
  entityViewStats(): unknown;
  /** Terrain height at a world XZ. The same function the world layer places entities with. */
  groundHeight(x: number, z: number): number;
  /** Every assembled building, with the footprint the terrain has to be flat across. */
  listBuildings(): { id: string; prefab: string; x: number; z: number; width: number; depth: number; rotationY: number }[];
  /**
   * Whatever the scatter system reported for its last run, one entry per region.
   *
   * Optional for small boot-fallback tests that do not build procedural dressing. The real boot
   * supplies `ScatterResult[]`; without it `getScatterStats()` answers `{ available: false }`.
   */
  scatterStats?(): unknown;
  /** Live rig playback state; optional only for boot-fallback tests without a character rig. */
  playerMotion?(): unknown;
  entityMotion?(entityId: EntityId): unknown;
  /** Solved shoreline contours and basin closure state for the rendered water bodies. */
  waterBodies?(): unknown;
  /** One JSON-safe terrain/biome/coast probe for world authoring tools. */
  worldSample?(x: number, z: number): unknown;
  /** Build-time only: one north-up tile rendered from the complete Three scene. */
  captureWorldMapTile?(options: {
    centreX: number;
    centreZ: number;
    spanMetres: number;
    pixels: number;
  }): string;
}

/**
 * Archetypes whose entity origin is placed on the terrain by `spotToVec3`, so a gap between the
 * drawn mesh and the ground is a defect rather than an authored offset.
 *
 * `landmark` is excluded on purpose: 725 of the world's 892 entities are landmark rows, almost all
 * of them prefab or composition PARTS, which are authored in their parent asset's own frame with
 * deliberate offsets (the worst is a `wall_bottom_trim` sunk 0.134 m, which is how the trim reads).
 * `checkBuildingFooting()` already covers whether those parents stand level.
 */
const GROUND_PLACED_ARCHETYPES: readonly string[] = [
  "ore", "tree", "fishing_spot", "farm_plot",
  "enemy", "boss", "npc", "station", "bank", "shop",
  "obstacle", "door", "portal", "loot", "recovery_cache",
];

/** Worst rows returned by `checkGrounding()`. 892 entities of full detail blows the serialiser. */
const GROUNDING_REPORT_LIMIT = 200;

function xyz(value: Vec3): { x: number; y: number; z: number } {
  return { x: value[0], y: value[1], z: value[2] };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function installGameDebug(deps: DebugDeps): void {
  const { store, events, clock, nav, movement, api, renderer, camera, assets } = deps;

  const debugApi = {
    // ------------------------------------------------- the nine harness methods

    getState(): Record<string, unknown> {
      const state = store.get();
      const stats = renderer.getStats();
      return {
        ready: true,
        version: deps.version,
        regionId: state.player.regionId,
        seed: state.meta.seed,
        skills: Object.fromEntries(
          Object.entries(state.skills).map(([id, entry]) => [id, { level: entry.level, xp: entry.xp }]),
        ),
        currency: state.currency,
        health: state.player.health,
        maxHealth: state.player.maxHealth,
        inventoryUsed: state.inventory.slots.filter((slot) => slot !== null).length,
        bankUsed: state.bank.slots.length,
        activity: state.activity ? state.activity.kind : null,
        combatTargetId: state.combat.targetId,
        questCount: Object.keys(state.quests).length,
        entityCount: api.hooks.entities?.all().length ?? 0,
        assets: assets.stats(),
        navStatus: nav.getStatus(),
        // Volatile. play-game.ts deletes these two keys before diffing snapshots.
        clock: { elapsedMs: clock.elapsedMs, tick: clock.tick, paused: clock.paused, timeScale: clock.timeScale },
        renderer: { fps: stats.fps, frameMs: stats.frameMs, drawCalls: stats.drawCalls, triangles: stats.triangles },
      };
    },

    getPlayer(): Record<string, unknown> {
      const view = api.getPlayer();
      return {
        position: xyz(roundVec3(view.position)),
        regionId: view.regionId,
        health: view.health,
        maxHealth: view.maxHealth,
        inCombat: view.inCombat,
        dead: view.dead,
        moving: view.moving,
        activityKind: view.activityKind,
        combatLevelEstimate: view.combatLevelEstimate,
        facingRad: Math.round(store.get().player.facingRad * 1000) / 1000,
      };
    },

    /** The harness requires {x,y,z}, not the internal Vec3 tuple. */
    getPlayerPosition(): { x: number; y: number; z: number } {
      return xyz(roundVec3(store.get().player.position));
    },

    getCamera(): Record<string, unknown> {
      return camera.snapshot();
    },

    getEntities(): unknown[] {
      const all = api.hooks.entities?.all() ?? [];
      return all.map((entity) => ({
        id: entity.id,
        archetype: entity.archetype,
        name: entity.name,
        tier: entity.tier,
        regionId: entity.regionId,
        position: xyz(roundVec3(entity.position)),
        state: entity.state,
        interactions: entity.interactions,
        ...(entity.resource ? { remaining: entity.resource.remaining } : {}),
        ...(entity.combat ? { health: entity.combat.health, maxHealth: entity.combat.maxHealth } : {}),
      }));
    },

    getCurrentActivity(): unknown {
      return api.getActivity();
    },

    getObjectives(): unknown[] {
      return api.getQuests().map((quest) => ({
        id: quest.id,
        name: quest.name,
        status: quest.status,
        stage: quest.stage,
        stageCount: quest.stageCount,
        currentObjective: quest.currentObjective,
        // The ids the objective points at. The prose itself carries none, so a test that wants to
        // act on a quest reads these rather than parsing a sentence.
        refs: quest.currentObjectiveRefs,
      }));
    },

    /**
     * Every key the game answers to, from the live registry.
     *
     * Exists because "the panels are bound to i/k/e and nothing says so" was a real Phase 1 bug,
     * and the only honest way to test that a key still works is to ask what is bound and then
     * press it. A hard-coded list in a scenario would keep passing after the binding was lost.
     */
    getKeyBindings(): unknown[] {
      return keybindings.list().map((binding) => ({
        id: binding.id,
        keys: [...binding.keys],
        label: binding.label,
        group: binding.group ?? "General",
      }));
    },

    /** Which panels exist and which are open right now. Screenshots cannot answer the second half. */
    getPanels(): unknown[] {
      return [...document.querySelectorAll<HTMLElement>(".panel")].map((panel) => ({
        id: panel.id.replace(/^panel-/, ""),
        open: !panel.hidden,
      }));
    },

    getNavigationState(): Record<string, unknown> {
      const state = store.get();
      // The harness checks this exact string equals "ready".
      return nav.snapshot(
        state.player.movement.path,
        state.player.movement.destination,
        movement.remainingDistance(state),
      ) as unknown as Record<string, unknown>;
    },

    /** Synchronous by contract: the driver calls it, waits 150 ms, and does not await. */
    reset(options?: { seed?: number; keepSave?: boolean }): void {
      deps.resetWorld(options?.seed, options?.keepSave ?? false);
    },

    // ------------------------------------------------ additional test surface

    ready(): boolean {
      return true;
    },

    getVersion(): { build: string; contracts: string; content: string } {
      return deps.version;
    },

    setPaused(paused: boolean): void {
      clock.paused = Boolean(paused);
    },

    setTimeScale(scale: number): void {
      if (!Number.isFinite(scale)) return;
      clock.timeScale = Math.max(0.1, Math.min(100, scale));
    },

    getMetrics(): Record<string, number> {
      const stats = renderer.getStats();
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        fps: stats.fps,
        frameMs: stats.frameMs,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        programs: stats.programs,
        entityCount: api.hooks.entities?.all().length ?? 0,
        // Lives here and NOT in `getState`. `tools/play-game.ts` diffs state snapshots between
        // actions, and a per-frame particle count in that object would report a difference on every
        // comparison forever — the same reason `clock` and `renderer` are called out as volatile and
        // stripped there. Metrics are already understood to be a live reading.
        spellParticles: deps.spellParticles?.() ?? 0,
        heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : 0,
      };
    },

    getErrors(): RecordedError[] {
      return deps.errors.map((entry) => ({ ...entry }));
    },

    getAudioState(): unknown {
      return deps.audioState?.() ?? null;
    },

    getAudioHistory(limit?: number): unknown {
      return deps.audioHistory?.(limit) ?? [];
    },

    clearAudioHistory(): void {
      deps.clearAudioHistory?.();
    },

    isIdle(): boolean {
      return deps.isIdle();
    },

    advanceGameTime(seconds: number): void {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      clock.skipMs(seconds * 1000);
      deps.advanceWorldTime?.(seconds);
    },

    teleport(to: Vec3 | { x: number; y: number; z: number } | { entityId: EntityId } | { locationId: string }): boolean {
      let target: Vec3 | null = null;
      if (Array.isArray(to)) target = to as Vec3;
      else if (typeof to === "object" && to !== null && "x" in to) target = [to.x, to.y, to.z];
      else if (typeof to === "object" && to !== null && "entityId" in to) {
        target = api.hooks.entities?.get(to.entityId)?.position ?? null;
      } else if (typeof to === "object" && to !== null && "locationId" in to) {
        target = nav.routeNode(to.locationId)?.position ?? null;
      }
      if (!target) return false;
      deps.teleport(target);
      return true;
    },

    grantXp(skill: SkillId, amount: number): number {
      const result = addSkillXp(store.get(), skill, amount);
      if (result.levelsGained > 0) {
        events.emit("level.gained", { skill, level: result.newLevel, levelsGained: result.levelsGained }, undefined, clock.elapsedMs);
        events.flush();
      }
      store.markDirty();
      return result.newLevel;
    },

    setSkillLevel(skill: SkillId, level: number): number {
      applySkillLevel(store.get(), skill, level);
      store.markDirty();
      return store.get().skills[skill].level;
    },

    setCurrency(marks: number): void {
      if (!Number.isFinite(marks)) return;
      store.get().currency = Math.max(0, Math.floor(marks));
      store.markDirty();
    },

    setHealth(health: number): void {
      const state = store.get();
      if (!Number.isFinite(health)) return;
      state.player.health = Math.max(0, Math.min(state.player.maxHealth, Math.floor(health)));
      store.markDirty();
    },

    setSeed(seed: number): void {
      if (!Number.isFinite(seed)) return;
      store.get().meta.seed = seed >>> 0;
      store.markDirty();
    },

    clearInventory(): void {
      const slots = store.get().inventory.slots;
      for (let index = 0; index < slots.length; index += 1) slots[index] = null;
      store.markDirty();
    },

    openBank(bankId?: EntityId): boolean {
      return deps.openBank?.(bankId) ?? false;
    },

    openShop(shopId?: EntityId): boolean {
      return deps.openShop?.(shopId) ?? false;
    },

    getEntity(entityId: EntityId): unknown {
      return api.hooks.entities?.get(entityId) ?? null;
    },

    listEntities(filter?: { archetype?: string; regionId?: string; tier?: number }): unknown[] {
      const all = api.hooks.entities?.all() ?? [];
      return all.filter((entity) => {
        if (filter?.archetype && entity.archetype !== filter.archetype) return false;
        if (filter?.regionId && entity.regionId !== filter.regionId) return false;
        if (filter?.tier !== undefined && entity.tier !== filter.tier) return false;
        return true;
      });
    },

    getEvents(sinceSeq = 0): { events: unknown[]; nextSeq: number } {
      return events.since(sinceSeq);
    },

    getNavPath(from: Vec3, to: Vec3): unknown {
      const path = nav.findPath(from, to);
      return path ? path.map((point) => xyz(roundVec3(point))) : null;
    },

    planRoute(fromId: string, toId: string, agilityLevel = 1): unknown {
      return nav.planRoute(fromId, toId, agilityLevel);
    },

    listRouteNodes(): unknown[] {
      return nav.listRouteNodes();
    },

    /**
     * Counts what is actually in the scene graph, by group and by name prefix.
     *
     * Added because three separate "why can I not see X" investigations were each reduced to
     * guessing from a screenshot. A render bug is either "the object was never created" or "the
     * object exists and is invisible", and those need completely different fixes.
     */
    getSceneStats(): Record<string, unknown> {
      const counts: Record<string, number> = {};
      const hidden: Record<string, number> = {};
      let total = 0;
      renderer.scene.traverse((object) => {
        total += 1;
        const key = object.name ? object.name.replace(/[-_]?\d+$/, "") : object.type;
        counts[key] = (counts[key] ?? 0) + 1;
        let node: THREE.Object3D | null = object;
        let visible = true;
        while (node) {
          if (!node.visible) { visible = false; break; }
          node = node.parent;
        }
        if (!visible) hidden[key] = (hidden[key] ?? 0) + 1;
      });
      return { totalObjects: total, counts, hidden };
    },

    /**
      * The world-space box the renderer actually draws for one entity, or null when it draws
      * nothing.
      *
      * "It vanished" and "it is drawn somewhere I am not looking" are different bugs with the same
      * screenshot, and `getSceneStats` cannot tell them apart: it counts meshes, and an instanced
      * mesh exists whether or not any of its slots are visible. This reads the instance matrix for
      * the entity's own slot.
      */
    getDrawnBounds(entityId: EntityId): Record<string, unknown> | null {
      const bounds = deps.drawnBounds(entityId);
      if (!bounds) return null;
      return {
        min: xyz(bounds.min),
        max: xyz(bounds.max),
        height: round3(bounds.max[1] - bounds.min[1]),
        width: round3(Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2])),
        meshes: bounds.meshes,
        // "instanced" is the baked-idle fallback, "animated:<clip>" is a live rig. A screenshot
        // cannot tell them apart and the difference is the whole reason a boss looks like a statue.
        path: bounds.path,
      };
    },

    /**
     * How level the ground is under each building, in metres.
     *
     * A building is assembled level — every part shares the origin's ground height, because
     * following the terrain per part would shear a twelve-metre hall — so any tilt in the ground
     * beneath it turns into a floating corner or a buried one. That was the "wall panels float at
     * an angle, roof sections rest on grass" finding, and it is not a rendering bug at all: it is
     * a building standing off the edge of its settlement's flattened pad.
     *
     * `worst` is the largest gap between the height at the building's origin and the height under
     * any corner of its footprint. Anything above a few centimetres is visible.
     */
    checkBuildingFooting(): { id: string; worst: number }[] {
      return deps.listBuildings()
        .map((building) => {
          const cos = Math.cos(building.rotationY);
          const sin = Math.sin(building.rotationY);
          const base = deps.groundHeight(building.x, building.z);
          let worst = 0;
          for (const sx of [-0.5, 0.5]) {
            for (const sz of [-0.5, 0.5]) {
              const lx = sx * building.width;
              const lz = sz * building.depth;
              const x = building.x + lx * cos + lz * sin;
              const z = building.z - lx * sin + lz * cos;
              worst = Math.max(worst, Math.abs(deps.groundHeight(x, z) - base));
            }
          }
          return { id: building.id, worst: round3(worst) };
        })
        .sort((a, b) => b.worst - a.worst);
    },

    /**
     * Terrain height at a world XZ — the same function the world layer places entities with.
     *
     * Wired in boot.ts since round 1 and declared in `DebugDeps`, but never exposed here, so
     * `window.__gameDebug.groundHeight` read `undefined` and every grounding audit had to rebuild
     * the height field offline to ask the question.
     */
    groundHeight(x: number, z: number): number {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
      return round3(deps.groundHeight(x, z));
    },

    /** Every assembled building and the footprint the terrain has to be flat across. Same story. */
    listBuildings(): unknown[] {
      return deps.listBuildings();
    },

    /**
     * How far every ground-placed entity's drawn mesh sits above or below the ground under it.
     *
     * This is the number the whole floating/sinking class reduces to. Nothing placed an entity by
     * its mesh: `spotToVec3` put the GLB ORIGIN at ground level, and 119 of the 213 assets in the
     * library have |bbox.min.y| > 2 cm, so the visible gap came out as exactly
     * `glbMinY x scale x tierSilhouetteScale(tier)` — verified to three decimals across 159 surface
     * entities. That is why the Fallen Duskoak hovered 5.773 m (a `roof_log` at scale 1.5), the
     * Coldbrace fletching bench hovered 1.411 m, and all ten farm plots drew with their TOP 7.7 cm
     * underground.
     *
     * `gap` is `drawnMinY - groundY`: positive floats, negative sinks. Anything past a few
     * centimetres is visible in a screenshot, so a gate line can assert `worst < 0.05`.
     *
     * Two things to know before reading the numbers. `groundY` is the ANALYTIC height field, which
     * is what entities are placed against; the tessellated mesh the player sees differs from it by
     * meanAbs 0.031 m over 38,332 samples, so treat sub-5 cm rows as noise. And an entity the
     * renderer draws nothing for has no bounds at all — those are counted in `notDrawn`, never
     * silently scored as zero.
     */
    checkGrounding(): Record<string, unknown> {
      const all = api.hooks.entities?.all() ?? [];
      const rows: { id: string; archetype: string; assetId: string; drawnMinY: number; groundY: number; gap: number }[] = [];
      let considered = 0;
      let notDrawn = 0;
      for (const entity of all) {
        if (!GROUND_PLACED_ARCHETYPES.includes(entity.archetype)) continue;
        // "parent#part" ids are composition parts, authored in the parent's frame.
        if (entity.id.includes("#")) continue;
        considered += 1;
        const bounds = deps.drawnBounds(entity.id);
        if (!bounds) { notDrawn += 1; continue; }
        const groundY = deps.groundHeight(entity.position[0], entity.position[2]);
        rows.push({
          id: entity.id,
          archetype: entity.archetype,
          assetId: entity.view?.assetId ?? "",
          drawnMinY: round3(bounds.min[1]),
          groundY: round3(groundY),
          gap: round3(bounds.min[1] - groundY),
        });
      }
      rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
      const worstRow = rows[0];
      return {
        considered,
        measured: rows.length,
        notDrawn,
        worst: worstRow ? Math.abs(worstRow.gap) : 0,
        overTolerance: rows.filter((row) => Math.abs(row.gap) > 0.05).length,
        // Worst-first, capped. `measured` is the true population; `entries` is a window onto it.
        entries: rows.slice(0, GROUNDING_REPORT_LIMIT),
      };
    },

    /**
     * What the procedural scatter pass placed, per region.
     *
     * `scatterWorld` already computes this — placed, rejected, instancedMeshes, estimatedDrawCalls,
     * estimatedTriangles, byLayer, missingAssets — and boot throws the array away at the `await`,
     * so ~525 buried pebbles and every rejection were invisible from outside the page. When boot
     * has not supplied the port this answers `{ available: false }` rather than an empty array,
     * because "scatter placed nothing" and "nobody asked scatter" are different bugs.
     */
    getScatterStats(): unknown {
      if (!deps.scatterStats) return { available: false, reason: "boot did not supply a scatter port" };
      return { available: true, regions: deps.scatterStats() };
    },

    getPlayerMotion(): unknown {
      return deps.playerMotion?.() ?? null;
    },

    getEntityMotion(entityId: EntityId): unknown {
      return deps.entityMotion?.(entityId) ?? null;
    },

    getWaterBodies(): unknown {
      return deps.waterBodies?.() ?? null;
    },

    sampleWorld(x: number, z: number): unknown {
      return deps.worldSample?.(x, z) ?? null;
    },

    captureWorldMapTile(options: {
      centreX: number;
      centreZ: number;
      spanMetres: number;
      pixels: number;
    }): string {
      if (!deps.captureWorldMapTile) throw new Error("World-map capture is not installed.");
      return deps.captureWorldMapTile(options);
    },

    /** Instancing, rig and draw-call budget state for the entity layer. */
    getEntityViewStats(): Record<string, unknown> {
      return deps.entityViewStats() as unknown as Record<string, unknown>;
    },

    listClips(): string[] {
      return assets.clipNames();
    },

    focusCamera(shotId: string): boolean {
      return deps.focusCamera(shotId);
    },

    focusPlayer(): boolean {
      return deps.focusPlayer();
    },

    focusEntity(entityId: EntityId): boolean {
      return deps.focusEntity(entityId);
    },

    focusLocation(locationId: string): boolean {
      return deps.focusLocation(locationId);
    },

    setCaptureMode(enabled: boolean): void {
      deps.setCaptureMode(Boolean(enabled));
    },

    captureDocumentationFrame(): string {
      return deps.captureDocumentationFrame();
    },

    /** Alias. `tools/screenshot.ts --preset` calls this name. */
    setCameraPreset(shotId: string): boolean {
      return deps.focusCamera(shotId);
    },

    /** Orbit an arbitrary world point. Structure audits need poses no route node offers. */
    inspectPose(pose: {
      x: number; y: number; z: number; yaw?: number; pitch?: number; distance?: number;
    }): boolean {
      return deps.inspectPose(
        [Number(pose.x), Number(pose.y), Number(pose.z)],
        Number(pose.yaw ?? 0), Number(pose.pitch ?? 0.35), Number(pose.distance ?? 14),
      );
    },

    listShots(): string[] {
      return deps.listShots();
    },

    saveNow(): void {
      deps.saveNow();
    },

    getSaveBlob(): string {
      return deps.getSaveBlob();
    },

    loadSaveBlob(json: string): void {
      deps.loadSaveBlob(json);
    },

    /** Invokes an agent tool in-page. This is how parity between a click and a tool call is proven. */
    callTool(name: string, args: unknown): Promise<unknown> {
      return deps.callTool(name, args);
    },

    depleteNode(entityId: EntityId): boolean {
      return deps.depleteNode(entityId);
    },

    forceRespawn(entityId: EntityId): boolean {
      return deps.forceRespawn(entityId);
    },

    setQuestStage(questId: QuestId, stage: number): void {
      const quests = store.get().quests;
      const existing = quests[questId] ?? { status: "active" as const, stage: 0, counters: {}, flags: {} };
      existing.stage = Math.max(0, Math.floor(stage));
      existing.status = "active";
      quests[questId] = existing;
      store.markDirty();
    },

    giveItem(itemId: ItemId, quantity: number, to: "inventory" | "bank" = "inventory"): unknown {
      return deps.giveItem(itemId, quantity, to);
    },

    /**
     * Sets the character up to exercise the whole magic ladder in one call.
     *
     * Magic 70 (the top of the ladder — Kilnsurge unlocks exactly there), every staff, and enough
     * Essence Shards that the pouch is not the thing under test. The best staff is equipped, because
     * a staff sitting in the pack casts nothing: `systems/combat.ts` reads the MAIN HAND to decide
     * whether "attack" swings or casts.
     *
     * A setup helper, and only that. It grants items and levels, which under the rules in
     * `tools/gate-check.ts` may set a check up but can never satisfy one — nothing here fights,
     * casts or earns anything.
     *
     * Returns what it did, so a console caller sees the result rather than `undefined`.
     */
    seedMagic(magicLevel = 70, shards = 5000): Record<string, unknown> {
      applySkillLevel(store.get(), "magic", magicLevel);
      deps.giveItem("essence_shard", Math.max(1, Math.floor(shards)), "inventory");
      const staffIds = PROCEDURAL_GEAR_ASSETS.map((asset) => asset.itemId);
      for (const itemId of staffIds) deps.giveItem(itemId, 1, "inventory");
      // Best last so it wins the main hand: the ladder is authored weakest-first.
      const best = staffIds[staffIds.length - 1];
      const equipped = best ? api.equipItem(best) : null;
      store.markDirty();

      const book = api.getSpellbook();
      return {
        magic: store.get().skills.magic.level,
        shards: book.shards,
        staffs: staffIds,
        equipped: equipped?.ok === true ? best : `not equipped: ${equipped?.ok === false ? equipped.error.message : "no staff"}`,
        castable: book.spells.filter((row) => row.castable).length,
        activeSpellId: book.activeSpellId,
      };
    },
  };

  (window as unknown as { __gameDebug?: unknown }).__gameDebug = debugApi;
}

/** Installed before boot so the harness never races an undefined window property. */
export function installBootPlaceholder(): void {
  (window as unknown as { __gameDebug?: unknown }).__gameDebug = {
    getState: () => ({ ready: false, booting: true }),
    getPlayer: () => null,
    getPlayerPosition: () => ({ x: 0, y: 0, z: 0 }),
    getCamera: () => null,
    getEntities: () => [],
    getCurrentActivity: () => null,
    getObjectives: () => [],
    getNavigationState: () => ({ status: "uninitialized" }),
    reset: () => undefined,
    ready: () => false,
  };
}
