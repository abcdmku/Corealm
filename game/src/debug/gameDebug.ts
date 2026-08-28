/**
 * `window.__gameDebug` — the test surface. Game code never calls it.
 *
 * The nine harness-required methods are FIXED by tools/lib/driver.ts and tools/smoke-test.ts. Their
 * names, synchrony, and return shapes are not ours to choose (see runs/corealm/architecture.md,
 * correction R1):
 *
 *   - all nine are SYNCHRONOUS: driver.snapshot() calls eight getters inside one page.evaluate and
 *     JSON-serialises the result, so a Promise would serialise to {}
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
import { roundVec3 } from "../core/math.js";

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
  version: { build: string; contracts: string; content: string };
  /** Rebuilds the world and restores spawn state. Must complete synchronously. */
  resetWorld(seed?: number, keepSave?: boolean): void;
  /** True when nothing is pending: no navigation, activity, combat, or asset load. */
  isIdle(): boolean;
  teleport(to: Vec3): void;
  saveNow(): void;
  getSaveBlob(): string;
  loadSaveBlob(json: string): void;
  focusCamera(shotId: string): boolean;
  listShots(): string[];
  callTool(name: string, args: unknown): Promise<unknown>;
  /** Test-only item grant. Goes through the real inventory so slot limits still apply. */
  giveItem(itemId: ItemId, quantity: number, to: "inventory" | "bank"): unknown;
  /** Empties a resource node through the real depletion path, so events and respawn still fire. */
  depleteNode(entityId: EntityId): boolean;
  /** Brings a node or enemy back immediately, skipping its respawn timer. */
  forceRespawn(entityId: EntityId): boolean;
}

function xyz(value: Vec3): { x: number; y: number; z: number } {
  return { x: value[0], y: value[1], z: value[2] };
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
        heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : 0,
      };
    },

    getErrors(): RecordedError[] {
      return deps.errors.map((entry) => ({ ...entry }));
    },

    isIdle(): boolean {
      return deps.isIdle();
    },

    advanceGameTime(seconds: number): void {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      clock.skipMs(seconds * 1000);
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

    listClips(): string[] {
      return assets.clipNames();
    },

    focusCamera(shotId: string): boolean {
      return deps.focusCamera(shotId);
    },

    /** Alias. `tools/screenshot.ts --preset` calls this name. */
    setCameraPreset(shotId: string): boolean {
      return deps.focusCamera(shotId);
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
