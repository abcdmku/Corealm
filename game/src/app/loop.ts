/**
 * The update loop. Fixed 100 ms sim tick with an accumulator, decoupled from render.
 *
 * Update order matters and is fixed by runs/corealm/PRD.md section 3. The one ordering that must
 * never be changed: events flush LAST, after quests, so a `level.gained` and the `quest.updated`
 * it triggers land in the same tick and in causal order.
 */
import type { Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { RngStreams } from "../core/rng.js";
import type { Renderer } from "../render/renderer.js";
import type { OrbitCamera } from "../render/camera.js";
import type { WorldScene } from "../render/scene.js";
import type { Physics } from "../systems/physics.js";
import type { Navigation } from "../systems/navigation.js";
import type { Movement } from "../systems/movement.js";
import type { CorealmGameApi } from "../api/gameApi.js";
import type { SaveService } from "../persistence/storage.js";
import type { InputController } from "../input/mouse.js";
import type { EntityViews } from "../render/entityViews.js";
import type { Overlays } from "../render/overlays.js";
import type { CharacterRig } from "../render/characterRig.js";
import type { Vfx } from "../render/vfx.js";
import type { Ui } from "../ui/panels.js";
import type { SemanticEntity } from "../contracts.js";
import { SIM_TICK_MS } from "../core/time.js";
import { AUTOSAVE_INTERVAL_MS } from "./config.js";

/** A system that wants a slice of each sim tick. Registered by later build rounds. */
export interface TickSystem {
  readonly name: string;
  /** Lower runs earlier. Keep inside the PRD's documented order. */
  readonly order: number;
  tick(deltaMs: number, atMs: number): void;
}

export interface LoopDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  rng: RngStreams;
  renderer: Renderer;
  camera: OrbitCamera;
  scene: WorldScene;
  physics: Physics;
  nav: Navigation;
  movement: Movement;
  api: CorealmGameApi;
  saves: SaveService;
  input: InputController;
}

export class GameLoop {
  private running = false;
  private frameHandle = 0;
  private lastFrameAt = 0;
  private lastAutosaveAt = 0;
  private systems: TickSystem[] = [];
  private entityViews: EntityViews | null = null;
  private entitySource: (() => SemanticEntity[]) | null = null;
  private viewSyncAccumulatorMs = 0;
  private overlays: Overlays | null = null;
  private playerRig: CharacterRig | null = null;
  private vfx: Vfx | null = null;
  private ui: Ui | null = null;
  private interiors: { group: { visible: boolean }; visible: () => boolean }[] = [];
  private lastPlayerPos: [number, number, number] | null = null;

  constructor(private readonly deps: LoopDeps) {}

  /**
   * Attaches the render mirror of the semantic world.
   *
   * Kept out of `LoopDeps` because the views are built after the world is, and the loop must be
   * constructible before them. Views resync on a slow cadence rather than every frame: entity state
   * changes at gameplay speed, not at 240 Hz, and a full diff every frame is pure waste.
   */
  setEntityViews(views: EntityViews, entities: () => SemanticEntity[]): void {
    this.entityViews = views;
    this.entitySource = entities;
  }

  /** Overlays tick every frame: they expire on a timer and follow entities that move. */
  setOverlays(overlays: Overlays): void {
    this.overlays = overlays;
  }

  /** The player's skinned rig, when one built successfully. */
  setPlayerRig(rig: CharacterRig): void {
    this.playerRig = rig;
  }

  /** Floating combat and XP feedback. Ticked on real time so it reads the same at any time scale. */
  setVfx(vfx: Vfx): void {
    this.vfx = vfx;
  }

  /** The human UI. `update()` is internally throttled, so calling it every frame is correct. */
  setUi(ui: Ui): void {
    this.ui = ui;
  }

  /**
   * An interior that should only render while the player is inside it.
   *
   * The Gravelmaw sits a few metres below Karrowmoor, so its floors, walls and ceilings were being
   * drawn from every surface pose — six draw calls over budget at Highcairn for geometry nobody
   * could see through the moor.
   */
  addInterior(group: { visible: boolean }, visible: () => boolean): void {
    this.interiors.push({ group, visible });
  }

  /** Later rounds register their systems here. Kept sorted by declared order. */
  addSystem(system: TickSystem): void {
    this.systems.push(system);
    this.systems.sort((a, b) => a.order - b.order);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  private frame = (nowMs: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    const realDelta = Math.min(nowMs - this.lastFrameAt, 250);
    this.lastFrameAt = nowMs;

    const ticks = this.deps.clock.advance(realDelta);
    for (let i = 0; i < ticks; i += 1) this.simTick();

    this.renderFrame(nowMs, realDelta);
    this.maybeAutosave(nowMs);
  };

  /** One 100 ms simulation step. */
  private simTick(): void {
    const { store, clock, movement, physics, events } = this.deps;
    const state = store.get();
    const atMs = clock.elapsedMs;

    // 1. input has already been folded into the movement controller by the input layer
    // 2. movement
    movement.update(state, SIM_TICK_MS, atMs);

    // 3. physics (static world for now; keeps the collider set warm and ground queries valid)
    physics.step();

    // 4..12. registered systems: gathering, production, combat, enemy AI, health, farming, quests
    for (const system of this.systems) system.tick(SIM_TICK_MS, atMs);

    // 13. clock commit
    clock.commitTick();
    state.meta.playSeconds += SIM_TICK_MS / 1000;

    // 14. events flush LAST, on purpose.
    events.flush();
  }

  private renderFrame(nowMs: number, realDeltaMs: number): void {
    const { store, scene, camera, renderer, input } = this.deps;
    const state = store.get();

    input.update();
    for (const interior of this.interiors) interior.group.visible = interior.visible();
    this.syncEntityViews();
    // Animation advances on real time, not sim time: a paused sim should still idle, and a
    // time-scaled test run should not play idles at 100x.
    this.entityViews?.update(realDeltaMs / 1000, renderer.camera.position);
    this.overlays?.update(this.deps.clock.elapsedMs);
    this.vfx?.update(nowMs);
    this.ui?.update();
    this.syncPlayerRig(state.player.position, state.player.facingRad, realDeltaMs);
    scene.syncPlayer(state.player.position, state.player.facingRad);
    camera.update(state.player.position[0], state.player.position[1], state.player.position[2]);
    renderer.followShadow(renderer.camera.position.clone().setY(state.player.position[1]));
    renderer.camera.updateMatrixWorld();
    renderer.render(nowMs);
  }

  /**
   * Drives the player rig: position, facing, and the pose implied by what the player is doing.
   *
   * Speed is measured from actual movement between frames rather than read from a config constant,
   * so a walk animation never plays while the character is standing against a wall.
   */
  private syncPlayerRig(position: readonly number[], facingRad: number, realDeltaMs: number): void {
    const rig = this.playerRig;
    if (!rig) return;

    const current: [number, number, number] = [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0];
    let speed = 0;
    if (this.lastPlayerPos && realDeltaMs > 0) {
      const dx = current[0] - this.lastPlayerPos[0];
      const dz = current[2] - this.lastPlayerPos[2];
      speed = Math.hypot(dx, dz) / (realDeltaMs / 1000);
    }
    this.lastPlayerPos = current;

    const player = this.deps.api.getPlayer();
    rig.setPosition(current as never, facingRad);
    rig.play(rig.poseFor({
      moving: speed > 0.25,
      speed,
      dead: player.dead,
      inCombat: player.inCombat,
      activityKind: player.activityKind,
    }));
    rig.update(realDeltaMs / 1000);
  }

  /** Diffs semantic entities into the render layer a few times a second, not every frame. */
  private syncEntityViews(): void {
    if (!this.entityViews || !this.entitySource) return;
    this.viewSyncAccumulatorMs += SIM_TICK_MS;
    if (this.viewSyncAccumulatorMs < 250) return;
    this.viewSyncAccumulatorMs = 0;
    this.entityViews.sync(this.entitySource());
  }

  private maybeAutosave(nowMs: number): void {
    if (nowMs - this.lastAutosaveAt < AUTOSAVE_INTERVAL_MS) return;
    this.lastAutosaveAt = nowMs;
    if (!this.deps.store.consumeDirty()) return;
    this.deps.saves.save(this.deps.store.get(), Date.now());
  }
}
