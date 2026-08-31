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
import type { GameState, Store } from "../state/store.js";
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
import type {
  CharacterMotionEvent,
  CharacterRig,
  CharacterPose,
  GearWeaponChargePresentationLike,
} from "../render/characterRig.js";
import type { Vfx } from "../render/vfx.js";
import type { SpellVfx } from "../render/spellVfx.js";
import { content } from "../content/index.js";
import type { GameEvent, ItemId, SkillId, SpellElement, SpellRung } from "../contracts.js";
import type { Ui } from "../ui/panels.js";
import type { EntityId, SemanticEntity, Vec3 } from "../contracts.js";
import { GATHER_TICK_MS, SIM_TICK_MS } from "../core/time.js";
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

/**
 * Tools are carried, not equipped. Return the strongest matching tool in the pack so the held
 * fishing model shows what the gathering roll actually uses.
 */
function bestCarriedGatheringTool(state: GameState, skill: SkillId): ItemId | null {
  let best: { itemId: ItemId; bonus: number } | null = null;
  for (const stack of state.inventory.slots) {
    if (!stack) continue;
    const tool = content.item(stack.itemId)?.tool;
    if (!tool || tool.skill !== skill) continue;
    if (!best || tool.gatherBonus > best.bonus) {
      best = { itemId: stack.itemId, bonus: tool.gatherBonus };
    }
  }
  return best?.itemId ?? null;
}


/**
 * One player hit held between the roll that produced it and the frame that should appear to cause
 * it. `flightUntilMs` is null for melee and for any cast the effect layer could not fly; see the
 * field comment on `pendingPlayerHits`.
 */
/**
 * How fast the single casting clip plays, by rung.
 *
 * `Spell_Simple_Shoot` is 1.0 s of the same gesture whatever is being thrown. A lash runs slightly
 * hot so a cheap dart looks flicked; a surge runs at two-thirds speed so the biggest spell in the
 * game looks like it costs something. The band is deliberately narrow — below about 0.6 the clip
 * stops reading as one motion and starts reading as a stutter, and the cast still has to finish
 * inside the 3000 ms it is given.
 */
/**
 * Height above the player's feet that a spell is emitted from.
 *
 * Chest height on the 1.8 m rigs this game uses, so the bolt leaves the middle of the character
 * rather than their head or their shins.
 */
const CAST_ORIGIN_HEIGHT = 1.1;

function castTimeScale(rung: SpellRung | null): number | null {
  switch (rung) {
    case "lash": return 1.15;
    case "bolt": return 1.0;
    case "burst": return 0.85;
    case "surge": return 0.7;
    default: return null;
  }
}

interface PendingPlayerHit {
  hit: CombatHit;
  swingPresented: boolean;
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
  private drainHits: (() => readonly CombatHit[]) | null = null;
  private playerMotionHandler: ((event: CharacterMotionEvent) => void) | null = null;
  private combatPresentationHandler: ((hit: CombatHit, phase: "swing" | "impact" | "combined") => void) | null = null;
  /**
   * MELEE hits waiting for the animation frame that should appear to cause them.
   *
   * Melee only, now. A sword's contact marker IS the moment it connects, so a swing pays out on
   * `impact` and is done. Magic used to queue here too, with a flight deadline layered on top,
   * because the damage was canonical the instant the cast resolved and only the number could be
   * held back. `systems/combat.ts` now holds the DAMAGE back for the length of the flight, so a
   * magic hit reaches this class already on time and is presented immediately.
   */
  private readonly pendingPlayerHits: PendingPlayerHit[] = [];
  private spellVfx: SpellVfx | null = null;
  /** Scratch for the cast origin, so a cast allocates nothing. */
  private readonly spellOriginTuple: [number, number, number] = [0, 0, 0];
  private gatheringRigKey: string | null = null;
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
  /** Charged weapon id plus charged/empty state from the last rig sync. */
  private wornWeaponChargeSignature: string | null = null;
  private archetypeOf: ((entityId: EntityId) => string | null) | null = null;
  /** Set by the event subscription, drained by the next render frame. */
  private pendingRigPose: CharacterPose | null = null;
  /**
   * Playback rate for the pose in `pendingRigPose`, when it should not run at its authored tempo.
   *
   * Set only for casts, and only from the spell's rung. The 86-clip animation library ships exactly
   * one casting motion (`Spell_Simple_Shoot`; the other three Spell_Simple_* clips are Enter, Exit
   * and an idle loop), so without this every spell from Emberlash to Kilnsurge is the same 1.0 s
   * gesture and the rung the player picked reads nowhere on the body.
   */
  private pendingRigPoseTimeScale: number | null = null;

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
   * The spell effect layer. Optional: unwired, casts still resolve, still award XP and still play
   * their cue — they simply pay out on the rig's contact marker like a sword does.
   */
  setSpellVfx(spellVfx: SpellVfx): void {
    this.spellVfx = spellVfx;
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

  /** Sound and other presentation systems consume the rig's measured contact frames here. */
  setPlayerMotionHandler(handler: (event: CharacterMotionEvent) => void): void {
    this.playerMotionHandler = handler;
  }

  /** Splits a resolved player attack into its visible swing and contact frames. */
  setCombatPresentationHandler(
    handler: (hit: CombatHit, phase: "swing" | "impact" | "combined") => void,
  ): void {
    this.combatPresentationHandler = handler;
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

  isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  /** Clears render-only work when debug or save loading replaces the canonical world. */
  resetPresentation(): void {
    this.pendingRigPose = null;
    this.pendingRigPoseTimeScale = null;
    this.pendingPlayerHits.length = 0;
    this.gatheringRigKey = null;
    this.playerRig?.drainMotionEvents();
    this.playerRig?.play("idle", true);
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
    // Played time is persisted state and is also the clock for portable fires and resource
    // respawns. Keep the save dirty between autosave intervals so an idle countdown cannot rewind
    // after reload. `Store` holds one boolean, so this does not queue writes per tick.
    store.markDirty();

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
    //
    // The corpse fade is the exception and takes the SIM clock, which is why both go in. It is a
    // function of `nowMs - view.diedAtMs`, and that instant was stamped on the sim clock, so any
    // other time base would make a body dissolve at the wrong moment - or on a resumed save, at a
    // wildly wrong one.
    this.entityViews?.update(realDeltaMs / 1000, renderer.camera.position, this.deps.clock.elapsedMs);
    this.overlays?.update(this.deps.clock.elapsedMs);
    this.paintCombatHits(nowMs);
    this.vfx?.update(nowMs);
    // After `vfx`, so a spell burst draws over the floating numbers rather than under them.
    this.spellVfx?.update(nowMs);
    this.ui?.update();
    this.syncPlayerEquipment();
    this.syncPlayerRig(position, facingRad, realDeltaMs, nowMs);
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
  private syncPlayerRig(position: Vec3, facingRad: number, realDeltaMs: number, nowMs: number): void {
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
    const forcedTimeScale = this.pendingRigPoseTimeScale;
    this.pendingRigPose = null;
    this.pendingRigPoseTimeScale = null;
    if (forced && state.player.health > 0) {
      rig.play(forced, true, forcedTimeScale ?? undefined);
    } else {
      rig.play(rig.poseFor({
        moving,
        speed,
        dead: state.player.health <= 0,
        inCombat: state.combat.targetId !== null || state.combat.engagedBy.length > 0,
        activityKind: activity?.kind ?? null,
        activitySkill: activity?.kind === "gathering" ? activity.skill : null,
        activityTier: activity?.kind === "gathering" ? activity.nodeTier : null,
        activityToolItemId: activity?.kind === "gathering"
          ? bestCarriedGatheringTool(state, activity.skill)
          : null,
      }));
    }
    rig.setLocomotionSpeed(speed);

    if (activity?.kind === "gathering" && (activity.skill === "mining" || activity.skill === "woodcutting")) {
      const key = `${activity.entityId}:${activity.startedAtMs}:${activity.skill}`;
      // Systems evaluate at the start of a sim tick, then the clock commits 100 ms. Rewinding one
      // tick and adding the render interpolation fraction gives the same instant the current state
      // represents, so the contact pose does not lead its semantic roll by a whole fixed step.
      const presentationAtMs = Math.max(
        0,
        this.deps.clock.elapsedMs - SIM_TICK_MS + this.renderAlpha * SIM_TICK_MS,
      );
      rig.syncGatheringCycle(
        activity.nextRollAtMs - presentationAtMs,
        GATHER_TICK_MS,
        key !== this.gatheringRigKey,
      );
      this.gatheringRigKey = key;
    } else {
      this.gatheringRigKey = null;
    }

    rig.update(realDeltaMs / 1000);
    for (const event of rig.drainMotionEvents()) {
      this.playerMotionHandler?.(event);
      this.presentPlayerCombatEvent(event, nowMs);
    }
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
    const state = this.deps.store.get();
    const worn = state.equipment;
    const slots = rig.visibleSlots();
    const mainHandId = worn.mainHand?.itemId ?? null;
    const chargeSpec = mainHandId ? content.item(mainHandId)?.magicWeapon?.charge : undefined;
    const chargedWeaponItemId = chargeSpec ? mainHandId : null;
    const weaponCharged = chargedWeaponItemId !== null
      && (state.magic.weaponCharges[chargedWeaponItemId] ?? 0) > 0;
    const chargeSignature = `${chargedWeaponItemId ?? "-"}/${weaponCharged ? "charged" : "empty"}`;

    let changed = this.wornItemIds.length !== slots.length
      || this.wornWeaponChargeSignature !== chargeSignature;
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
    this.wornWeaponChargeSignature = chargeSignature;
    const charge: GearWeaponChargePresentationLike = {
      itemId: chargedWeaponItemId,
      charged: weaponCharged,
    };
    void rig.applyEquipment(worn, charge);
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
      if (incoming) {
        this.vfx?.damage(null, swing.damage, kind, nowMs);
        this.combatPresentationHandler?.(swing, "combined");
        if (swing.hit && swing.targetId === playerId) swingPose = "hit";
        // The enemy that threw it swings; the player takes it. Without this the boss fight is a
        // frozen statue exchanging damage numbers with a moving player.
        this.entityViews?.playAction(swing.sourceId, "attack");
      } else if (swing.kind === "magic") {
        // A magic hit arrives ALREADY on time: `systems/combat.ts` held the damage back for the
        // whole flight, so this IS the frame the bolt reached the target. Waiting for the rig's
        // contact marker the way melee does would delay it a second time — and the cast animation
        // that owns those markers finished while the bolt was still travelling, so the next marker
        // is a whole cast interval away. No pose either: the caster threw this a second ago and is
        // standing still now. `handleSpellLaunch` played the cast when it was actually cast.
        // "impact", not "combined": the cast half already sounded when the spell launched, and
        // "combined" replays both.
        this.combatPresentationHandler?.(swing, "impact");
        this.vfx?.damage(swing.targetId, swing.damage, "magic", nowMs);
        if (swing.hit) this.entityViews?.playAction(swing.targetId, "hit");
      } else {
        // Damage is already canonical. Its sound and number wait for the attack clip's measured
        // contact frame, so the player's sword is what appears to cause it.
        if (this.pendingPlayerHits.length > 0) this.flushPendingPlayerHits(nowMs);
        this.pendingPlayerHits.push({ hit: swing, swingPresented: false });
        if (swingPose !== "hit") swingPose = "attack_melee";
      }
    }
    // A flinch outranks the attack pose. If both land in one render frame there will be no player
    // contact marker to consume the queued hit, so present it now instead of losing the feedback.
    if (swingPose === "hit" && this.pendingPlayerHits.length > 0) this.flushPendingPlayerHits(nowMs);
    if (!this.playerRig && this.pendingPlayerHits.length > 0) this.flushPendingPlayerHits(nowMs);
    if (swingPose) {
      this.pendingRigPose = swingPose;
      this.pendingRigPoseTimeScale = null;
    }
  }

  private presentPlayerCombatEvent(event: CharacterMotionEvent, nowMs: number): void {
    if (event.kind === "footstep" || (event.pose !== "attack_melee" && event.pose !== "cast")) return;
    const expectedKind = event.pose === "cast" ? "magic" : "melee";
    const pending = this.pendingPlayerHits.find((entry) => entry.hit.kind === expectedKind);
    if (!pending) return;

    if (event.kind === "swing") {
      if (pending.swingPresented) return;
      pending.swingPresented = true;
      this.combatPresentationHandler?.(pending.hit, "swing");
      return;
    }

    if (!pending.swingPresented) this.combatPresentationHandler?.(pending.hit, "swing");
    this.payOutPlayerHit(pending, nowMs);
  }

  /**
   * Starts the bolt for a cast that has just been rolled.
   *
   * Driven by the `spell.launched` event rather than by the hit log, because the hit log entry for a
   * spell is now written when it LANDS — `systems/combat.ts` defers the damage for the length of the
   * flight, so by the time a magic `CombatHit` exists the projectile should already have arrived.
   *
   * Nothing here decides timing. The event carries `flightMs`, the sim scheduled the damage against
   * it, and `render/spellVfx.ts` draws against the same shared `spellFlightMs`; this only has to
   * point the effect at the right places.
   */
  handleSpellLaunch(event: GameEvent, nowMs: number): void {
    if (event.type !== "spell.launched" || !this.spellVfx) return;
    const data = event.data;
    const targetId = typeof data["targetId"] === "string" ? data["targetId"] : null;
    const element = data["element"] as SpellElement | undefined;
    const rung = data["rung"] as SpellRung | undefined;
    if (!targetId || !element || !rung) return;
    const to = this.entityPositionFor(targetId);
    if (!to) return;

    this.spellVfx.cast({
      // Seeded off the sim stamp and the target, so two casts thrown in one frame at two enemies
      // scatter differently, and the same cast replayed from a seed scatters identically.
      id: `${event.atMs}:${targetId}`,
      element,
      rung,
      from: this.castOrigin(),
      to,
      hit: data["hit"] === true,
      // The event carries the flight in SIM milliseconds, which is what the damage was scheduled
      // against. This layer runs on the render clock, so the sim's time scale is divided out or the
      // bolt and the hit come apart the moment anything scales time — the acceptance harness runs
      // at 20.
      flightMsOverride: typeof data["flightMs"] === "number"
        ? data["flightMs"] / (this.deps.clock.timeScale || 1)
        : undefined,
    }, nowMs);

    // The cast animation belongs here too, for the same reason the bolt does: this is the moment
    // the spell leaves. Driving it off the hit log would play the throw at the instant the spell
    // arrived, a whole flight late.
    this.pendingRigPose = "cast";
    this.pendingRigPoseTimeScale = castTimeScale(rung);
  }

  /**
   * Where a spell leaves the caster: the centre of the player, slightly in front.
   *
   * An earlier pass read the crown of the staff through the hand bone, which was more literal and
   * read worse — the crown swings through a wide arc during the cast, so the bolt appeared to be
   * flung from wherever the arm happened to be rather than aimed, and at some phases it started
   * behind the player's shoulder. A fixed point at chest height is steady, reads as "from the
   * caster", and is what the effect layer's forward nudge was designed around.
   *
   * The nudge itself lives in `render/spellVfx.ts` (`HAND_REACH`), which knows the direction to the
   * target; this only has to supply the height.
   */
  private castOrigin(): Vec3 {
    const at = this.deps.store.get().player.position;
    this.spellOriginTuple[0] = at[0];
    this.spellOriginTuple[1] = at[1] + CAST_ORIGIN_HEIGHT;
    this.spellOriginTuple[2] = at[2];
    return this.spellOriginTuple;
  }

  /** Where a target stands right now. Null rather than the origin when it has gone. */
  private entityPositionFor(entityId: EntityId): Vec3 | null {
    if (!this.entitySource) return null;
    for (const entity of this.entitySource()) {
      if (entity.id === entityId) return entity.position;
    }
    return null;
  }

  private payOutPlayerHit(pending: PendingPlayerHit, nowMs: number): void {
    this.combatPresentationHandler?.(pending.hit, "impact");
    const kind = pending.hit.kind === "magic" ? "magic" : "melee";
    this.vfx?.damage(pending.hit.targetId, pending.hit.damage, kind, nowMs);
    if (pending.hit.hit) this.entityViews?.playAction(pending.hit.targetId, "hit");
    const index = this.pendingPlayerHits.indexOf(pending);
    if (index >= 0) this.pendingPlayerHits.splice(index, 1);
  }

  /**
   * Pays out every queued hit at once, without waiting for a contact marker.
   *
   * Reached when a flinch outranks the attack pose in the same frame, when a second hit lands before
   * the first was presented, and when there is no player rig at all. All three are cases where the
   * marker that would normally trigger the payout is never going to arrive.
   *
   * IT MUST STILL FIRE THE SPELL EFFECT, and the first version of this did not. `launchSpell` was
   * only called from the rig's swing marker, so a cast that flushed drew a damage number out of
   * thin air with nothing leaving the staff. That is not a rare path: a caster fighting anything
   * that fights back gets flinched constantly, and `tools/verify-magic.ts` found it by casting four
   * times at an aggressive target and seeing zero particles every time — while the same cast against
   * a target that had not yet retaliated drew fine.
   *
   * Melee only. A magic hit never reaches this queue: it is presented the moment it arrives, which
   * is already the right moment.
   */
  private flushPendingPlayerHits(nowMs: number): void {
    for (const pending of this.pendingPlayerHits.splice(0, this.pendingPlayerHits.length)) {
      this.combatPresentationHandler?.(pending.hit, "combined");
      const kind = pending.hit.kind === "magic" ? "magic" : "melee";
      this.vfx?.damage(pending.hit.targetId, pending.hit.damage, kind, nowMs);
      if (pending.hit.hit) this.entityViews?.playAction(pending.hit.targetId, "hit");
    }
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
