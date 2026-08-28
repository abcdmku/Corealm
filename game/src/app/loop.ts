/**
 * The update loop. Fixed 100 ms sim tick with an accumulator, decoupled from render.
 *
 * Update order matters and is fixed by runs/corealm/PRD.md section 3. The one ordering that must
 * never be changed: events flush LAST, after quests, so a `level.gained` and the `quest.updated`
 * it triggers land in the same tick and in causal order.
 *
 * The render half of this file interpolates. The sim moves the player 0.4202 m in one instant, ten
 * times a second; the camera, the world and the UI move every frame. Measured at 480 fps across
 * 11,050 frames of continuous movement, only 170 of them (1.54%) contained any player displacement
 * at all, and the camera's follow lag sawtoothed 0.005 m -> 0.692 m every 100 ms against a player
 * that teleported. So `renderFrame` draws the player at a point BETWEEN the last two sim ticks and
 * everything that follows the player — scene, rig, camera, shadow — reads that same interpolated
 * pose. The cost is up to one tick of latency on the drawn character, which is the standard trade
 * and is invisible next to a 42 cm jump.
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
import type { CombatHit } from "../systems/combat.js";
import type { CorealmGameApi } from "../api/gameApi.js";
import type { SaveService } from "../persistence/storage.js";
import type { InputController } from "../input/mouse.js";
import type { EntityViews } from "../render/entityViews.js";
import type { Overlays } from "../render/overlays.js";
import type { CharacterRig, CharacterPose } from "../render/characterRig.js";
import type { Vfx } from "../render/vfx.js";
import type { Ui } from "../ui/panels.js";
import type { EntityId, SemanticEntity, Vec3 } from "../contracts.js";
import { SIM_TICK_MS } from "../core/time.js";
import { AUTOSAVE_INTERVAL_MS, MOVEMENT } from "./config.js";

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

/**
 * The slice of `state.player.movement` the render layer reads.
 *
 * Speed is the sim's, not a per-frame position delta. The old code differenced
 * `state.player.position` between rendered frames and handed the result to `poseFor`, which meant
 * the rig was told "standing still" on 98.5% of frames and "running at 190 m/s" on the other 1.5%:
 * `play()` flipped idle<->run about twenty times a second and `action.reset()` restarted the jog
 * clip every time, so a 100 fps screencast showed the body pose pixel-identical across 116 ms of a
 * 0.933 s clip.
 *
 * `speed` and `gait` are what `Movement.publishSpeed` writes onto the movement record each tick
 * (`MovementSpeedFields` in systems/movement.ts). They are optional here because `state/store.ts`
 * declares only the fields it declared before — the writer landed in the same wave as this reader,
 * and a structural read costs nothing and cannot break if it is ever withdrawn. The fallback is the
 * old behaviour: moving means running at the configured speed.
 *
 * `gait` rather than `mode` decides whether the character is moving, because `mode` stays "direct"
 * through the deceleration coast and because a player walking into a wall keeps `mode: "direct"`
 * while `speed` is 0 — the published speed is measured AFTER the collision clamp, so it reads as
 * standing still, which is what they are.
 */
interface PlayerMovementView {
  mode: "idle" | "path" | "direct";
  speed?: number;
  gait?: "idle" | "walk" | "run";
}

/**
 * Above this, the player did not walk — it was teleported, and the render pose snaps.
 *
 * One sim tick of running is 4.2 m/s * 0.1 s = 0.4202 m measured, so 2 m is ~4.8 steps of headroom
 * and still far under the smallest thing anyone calls a teleport (a respawn crosses regions).
 * Without it, `__gameDebug.teleport` and every death respawn would smear the character across the
 * map over 100 ms.
 */
const TELEPORT_SNAP_METRES = 2;
const TELEPORT_SNAP_SQUARED = TELEPORT_SNAP_METRES * TELEPORT_SNAP_METRES;

const TWO_PI = Math.PI * 2;

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
  private drainHits: (() => readonly CombatHit[]) | null = null;
  private ui: Ui | null = null;
  private interiors: { group: { visible: boolean }; visible: () => boolean }[] = [];

  /**
   * The sim pose before the most recent tick. How far through the next one we are now comes from
   * `SimClock.alpha()`.
   *
   * This used to mirror the clock's own accumulator, because that field was private. Two copies of
   * one integrator is two things that can drift apart, and the one that drifts is the one nothing
   * tests, so the clock publishes it now and the mirror is gone.
   */
  private prevPlayerPos: [number, number, number] = [0, 0, 0];
  private prevFacingRad = 0;
  private havePrevPose = false;
  private renderAlpha = 1;
  /** Scratch, reused every frame. The render pose is written here rather than allocated. */
  private readonly renderPos: [number, number, number] = [0, 0, 0];
  private renderFacingRad = 0;

  /**
   * Worn item ids, in `rig.visibleSlots()` order, from the last frame that changed.
   *
   * A per-frame diff rather than a subscription to `item.equipped`, because it also covers
   * save-load, `__gameDebug.reset` and a scenario granting a kit directly — none of which emit an
   * equip event. It allocates nothing: the comparison walks a fixed-length array of interned item
   * id strings.
   */
  private wornItemIds: (string | null)[] = [];
  private archetypeOf: ((entityId: EntityId) => string | null) | null = null;
  /** Set by the event subscription, drained by the next render frame. */
  private pendingRigPose: CharacterPose | null = null;

  constructor(private readonly deps: LoopDeps) {
    // A bank interaction has no event of its own; it arrives as `activity.started` on an entity
    // whose archetype is "bank" (boot opens the bank window off exactly this signal). Without an
    // archetype lookup wired in, the chest-opening pose stays dormant and nothing else changes.
    deps.events.subscribe((event) => {
      if (event.type !== "activity.started" || !event.entityId) return;
      if (this.archetypeOf?.(event.entityId) !== "bank") return;
      this.pendingRigPose = "bank";
    });
  }

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

  /**
   * How the loop asks what an entity is, without importing the world layer.
   *
   * Only consumer today is the bank pose. Optional: unwired, the lookup returns nothing and the
   * `Chest_Open` clip simply never fires, which is the behaviour before this wave.
   */
  setArchetypeLookup(lookup: (entityId: EntityId) => string | null): void {
    this.archetypeOf = lookup;
  }

  /**
   * Plays a one-shot on the player rig at the next rendered frame.
   *
   * The seam for anything that is not movement, an activity or a swing. It exists because the bank
   * has no interaction of its own: `coldbrace_bank` advertises `interactions: ["inspect", "bank"]`
   * but no system registers a `"bank"` dispatcher handler, so `interact(bank, "bank")` returns
   * UNAVAILABLE and the `activity.started` this loop listens for never fires. Whoever wires the
   * bank window can call this from the same line.
   */
  playPose(pose: CharacterPose): void {
    this.pendingRigPose = pose;
  }

  /** Floating combat and XP feedback. Ticked on real time so it reads the same at any time scale. */
  setVfx(vfx: Vfx): void {
    this.vfx = vfx;
  }

  /**
   * Where damage numbers come from.
   *
   * `systems/combat.ts` has kept a hit log since round 3, with a comment on `consumeHits()` saying
   * "render/vfx.ts polls this for damage numbers", and nothing ever polled it — `Vfx.damage()` had
   * no callers anywhere in the project. So every fight in the game, including the two-phase boss,
   * happened in complete silence: health bars moved and nothing else did. It went unnoticed because
   * the gate check reads combat out of XP and entity state, which are both correct.
   *
   * The same drain now also drives the swing and flinch poses, which is the only place the edge
   * they need is visible: `PlayerView.inCombat` is a multi-second state flag, and `Sword_Attack`
   * and `Hit_Chest` are 1.533 s and 0.333 s events.
   *
   * The log is drained rather than read, so a frame that drops cannot replay yesterday's swings.
   */
  setCombatHits(drain: () => readonly CombatHit[]): void {
    this.drainHits = drain;
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

    const clock = this.deps.clock;
    const ticks = clock.advance(realDelta);
    for (let i = 0; i < ticks; i += 1) {
      // Captured per tick, not per batch: the render pose interpolates across the LAST tick, so a
      // catch-up batch of eight still draws the final 100 ms rather than smearing 800 ms of motion.
      this.capturePrevPose();
      this.simTick();
    }
    // A paused sim runs no ticks, so a blend held at whatever alpha the pause caught would freeze
    // the character part-way between two tick poses — and `__gameDebug.teleport` while paused would
    // leave it stranded there. alpha 1 is the true sim pose, which is the only honest thing to draw
    // when nothing is advancing, and it is what `SimClock.alpha()` deliberately does not return.
    this.renderAlpha = clock.paused ? 1 : clock.alpha();

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

  private capturePrevPose(): void {
    const player = this.deps.store.get().player;
    this.prevPlayerPos[0] = player.position[0];
    this.prevPlayerPos[1] = player.position[1];
    this.prevPlayerPos[2] = player.position[2];
    this.prevFacingRad = player.facingRad;
    this.havePrevPose = true;
  }

  /**
   * Writes the drawn player pose into `renderPos` / `renderFacingRad`.
   *
   * Facing takes the shortest arc, so a turn across the -pi/pi seam interpolates 20 degrees rather
   * than 340. It matters: `turnToward` runs once per sim tick with deltaMs 100, so a direct-input
   * turn steps up to 1.26 rad (72 degrees) at once and the rig read that raw.
   */
  private updateRenderPose(alpha: number): void {
    const player = this.deps.store.get().player;
    const current = player.position;
    if (!this.havePrevPose) {
      this.renderPos[0] = current[0];
      this.renderPos[1] = current[1];
      this.renderPos[2] = current[2];
      this.renderFacingRad = player.facingRad;
      return;
    }

    const dx = current[0] - this.prevPlayerPos[0];
    const dy = current[1] - this.prevPlayerPos[1];
    const dz = current[2] - this.prevPlayerPos[2];
    if (dx * dx + dy * dy + dz * dz > TELEPORT_SNAP_SQUARED) {
      this.prevPlayerPos[0] = current[0];
      this.prevPlayerPos[1] = current[1];
      this.prevPlayerPos[2] = current[2];
      this.prevFacingRad = player.facingRad;
      this.renderPos[0] = current[0];
      this.renderPos[1] = current[1];
      this.renderPos[2] = current[2];
      this.renderFacingRad = player.facingRad;
      return;
    }

    this.renderPos[0] = this.prevPlayerPos[0] + dx * alpha;
    this.renderPos[1] = this.prevPlayerPos[1] + dy * alpha;
    this.renderPos[2] = this.prevPlayerPos[2] + dz * alpha;

    let turn = (player.facingRad - this.prevFacingRad) % TWO_PI;
    if (turn > Math.PI) turn -= TWO_PI;
    else if (turn < -Math.PI) turn += TWO_PI;
    this.renderFacingRad = this.prevFacingRad + turn * alpha;
  }

  private renderFrame(nowMs: number, realDeltaMs: number): void {
    const { store, scene, camera, renderer, input } = this.deps;
    const state = store.get();

    this.updateRenderPose(this.renderAlpha);
    const position: Vec3 = this.renderPos;
    const facingRad = this.renderFacingRad;

    input.update();
    for (const interior of this.interiors) interior.group.visible = interior.visible();
    this.syncEntityViews();
    // Structure at 4 Hz, motion every frame. `sync` is throttled because rebuilding instance groups
    // is expensive, but `EnemyAiSystem.stepToward` writes a new position every 100 ms sim tick, so
    // at 4 Hz three of every four movement steps were invisible and the fourth was a 40 cm jump.
    // `syncMotion` only moves records that already exist and never allocates a group.
    if (this.entityViews && this.entitySource) {
      this.entityViews.syncMotion(this.entitySource(), this.renderAlpha);
    }
    // Animation advances on real time, not sim time: a paused sim should still idle, and a
    // time-scaled test run should not play idles at 100x.
    this.entityViews?.update(realDeltaMs / 1000, renderer.camera.position);
    this.overlays?.update(this.deps.clock.elapsedMs);
    this.paintCombatHits(nowMs);
    this.vfx?.update(nowMs);
    this.ui?.update();
    this.syncPlayerEquipment();
    this.syncPlayerRig(position, facingRad, realDeltaMs);
    scene.syncPlayer(position, facingRad);
    camera.update(position[0], position[1], position[2]);
    renderer.followShadow(renderer.camera.position.clone().setY(position[1]));
    renderer.camera.updateMatrixWorld();
    renderer.render(nowMs);
  }

  /**
   * Drives the player rig: position, facing, the pose implied by what the player is doing, and the
   * stride rate that keeps the feet from skating.
   *
   * Everything here reads the sim, not the scene graph. The one thing that used to come from the
   * render frame — speed, differenced between drawn positions — is exactly what froze the run
   * animation; see `PlayerMovementView`.
   */
  private syncPlayerRig(position: Vec3, facingRad: number, realDeltaMs: number): void {
    const rig = this.playerRig;
    if (!rig) return;

    const state = this.deps.store.get();
    const movement: PlayerMovementView = state.player.movement;
    const moving = movement.gait ? movement.gait !== "idle" : movement.mode !== "idle";
    const speed = movement.speed ?? (moving ? MOVEMENT.runSpeed : 0);
    const activity = state.activity;

    rig.setPosition(position, facingRad);

    // A one-shot claimed by an interaction or a swing outranks the steady-state pose for this
    // frame; `update()` drops back to idle when the clip finishes.
    const forced = this.pendingRigPose;
    this.pendingRigPose = null;
    if (forced && state.player.health > 0) {
      rig.play(forced, true);
    } else {
      rig.play(rig.poseFor({
        moving,
        speed,
        dead: state.player.health <= 0,
        inCombat: state.combat.targetId !== null || state.combat.engagedBy.length > 0,
        activityKind: activity?.kind ?? null,
        activitySkill: activity?.kind === "gathering" ? activity.skill : null,
      }));
    }
    rig.setLocomotionSpeed(speed);
    rig.update(realDeltaMs / 1000);
  }

  /**
   * Pushes worn equipment into the rig when, and only when, it changes.
   *
   * Before this, `equipMainHandAsset`, `VISIBLE_SLOTS` and `equippedAssetId` had zero callers
   * anywhere in the repo: a full tier-10 Kaldite kit rendered pixel-identical to naked and
   * `getSceneStats().totalObjects` read 1077 before and 1077 after. Measured with this wired:
   * 772 naked, 773 with the kit, and the rig's own child list gains the sword and swaps the whole
   * peasant set for the ranger one.
   */
  private syncPlayerEquipment(): void {
    const rig = this.playerRig;
    if (!rig) return;
    const worn = this.deps.store.get().equipment;
    const slots = rig.visibleSlots();

    let changed = this.wornItemIds.length !== slots.length;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      const itemId = (slot ? worn[slot]?.itemId : null) ?? null;
      if (this.wornItemIds[index] !== itemId) {
        this.wornItemIds[index] = itemId;
        changed = true;
      }
    }
    if (!changed) return;
    this.wornItemIds.length = slots.length;
    void rig.applyEquipment(worn);
  }

  /**
   * Turns this frame's swings into floating numbers and into a pose.
   *
   * A hit the player took floats over the player and reads as "incoming"; one they landed floats
   * over whatever they hit. A miss is worth showing too — a run of zeroes against a high-armour
   * target is the game explaining why Magic exists — so `hit: false` still paints, as a nought.
   *
   * The pose is the other half. A flinch outranks a swing: being hit is the thing the player needs
   * to see, and `Hit_Chest` is 0.333 s against `Sword_Attack`'s 1.533 s, so it reads as an
   * interruption and recovers before the next 600 ms combat tick.
   */
  private paintCombatHits(nowMs: number): void {
    if (!this.drainHits) return;
    const playerId = this.deps.store.get().player.id;
    let swingPose: CharacterPose | null = null;
    for (const swing of this.drainHits()) {
      const incoming = swing.attacker === "enemy";
      const kind = incoming ? "incoming" : swing.kind === "magic" ? "magic" : "melee";
      const over = incoming ? playerId : swing.targetId;
      this.vfx?.damage(over === playerId ? null : over, swing.damage, kind, nowMs);

      if (incoming) {
        if (swing.hit && swing.targetId === playerId) swingPose = "hit";
        // The enemy that threw it swings; the player takes it. Without this the boss fight is a
        // frozen statue exchanging damage numbers with a moving player.
        this.entityViews?.playAction(swing.sourceId, "attack");
      } else {
        if (swingPose !== "hit") swingPose = swing.kind === "magic" ? "cast" : "attack_melee";
        if (swing.hit && swing.targetId !== playerId) {
          this.entityViews?.playAction(swing.targetId, "hit");
        }
      }
    }
    if (swingPose) this.pendingRigPose = swingPose;
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
