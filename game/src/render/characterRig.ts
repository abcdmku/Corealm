/**
 * The player's character: a skinned rig with equipment attachment and animation blending.
 *
 * This is cheap to build because of a measured fact (runs/corealm/stack-findings.md section 2):
 * every character pack and both animation libraries share ONE identical 65-bone skeleton. So clips
 * play across packs with no retargeting, outfit pieces are skinned to the same bones, and `hand_r`
 * and `Head` exist as real nodes for weapon and helmet attachment.
 *
 * Only the player and a handful of named NPCs get a rig. The rest of the world's characters go
 * through the instanced, CPU-skinned path in `entityViews.ts`, because a fully dressed character is
 * ~27k triangles across ten skinned meshes and the draw-call budget does not survive many of them.
 */
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { EquipSlot, ItemStack, Vec3 } from "../contracts.js";
import type { AssetRegistry } from "./assets.js";

/** What the character is doing, which decides the clip. */
export type CharacterPose =
  | "idle" | "walk" | "run"
  | "mine" | "chop" | "fish" | "farm"
  | "attack_melee" | "cast" | "hit" | "death"
  | "eat" | "climb" | "produce" | "bank";

/**
 * Pose to clip name, from the shared library.
 *
 * The gaps are real and worth stating: there is no fishing clip in either library, so fishing
 * borrows a held-rod idle and the feedback comes from the bobber and ripple instead of the body.
 * Mining reuses the tree-chopping swing, which reads correctly with a pickaxe in hand.
 */
const POSE_CLIPS: Record<CharacterPose, readonly string[]> = {
  idle: ["Idle_Loop", "Idle_FoldArms_Loop"],
  walk: ["Walk_Loop"],
  run: ["Jog_Fwd_Loop", "Sprint_Loop"],
  mine: ["TreeChopping_Loop"],
  chop: ["TreeChopping_Loop"],
  fish: ["Idle_Rail_Loop", "Idle_Loop"],
  farm: ["Farm_Harvest", "Farm_PlantSeed"],
  attack_melee: ["Sword_Attack", "Sword_Regular_A", "Punch_Jab"],
  cast: ["Spell_Simple_Shoot", "Spell_Simple_Idle_Loop"],
  hit: ["Hit_Chest", "Hit_Knockback"],
  death: ["Death01"],
  eat: ["Consume"],
  climb: ["ClimbUp_1m", "NinjaJump_Start"],
  produce: ["Fixing_Kneeling", "Interact"],
  bank: ["Chest_Open", "Interact"],
};

/** Poses that play once and fall back to idle rather than looping. */
const ONE_SHOT: ReadonlySet<CharacterPose> = new Set(["attack_melee", "cast", "hit", "eat", "climb", "bank"]);

const CROSSFADE_SECONDS = 0.18;

export interface CharacterRigOptions {
  /** Base body asset id from the manifest, e.g. "base_male". */
  bodyAssetId: string;
  /** Optional outfit part asset ids layered onto the same skeleton. */
  outfitAssetIds?: string[];
  castShadow?: boolean;
}

export class CharacterRig {
  readonly root = new THREE.Group();

  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: CharacterPose = "idle";
  private currentAction: THREE.AnimationAction | null = null;
  private handAttachment: THREE.Object3D | null = null;
  private headAttachment: THREE.Object3D | null = null;
  private handBone: THREE.Object3D | null = null;
  private headBone: THREE.Object3D | null = null;
  private ready = false;
  private missingClips = new Set<string>();

  constructor(private readonly assets: AssetRegistry) {
    this.root.name = "character-rig";
  }

  /**
   * Builds the rig. SkeletonUtils' `clone` is required rather than `Object3D.clone`: a plain clone
   * shares the source skeleton, so every character built from one asset would animate in lockstep.
   */
  async build(options: CharacterRigOptions): Promise<boolean> {
    try {
      const source = await this.assets.load(options.bodyAssetId);
      const body = cloneSkinned(source) as THREE.Group;
      body.name = "body";
      this.root.add(body);

      if (options.castShadow !== false) {
        body.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
      }

      for (const outfitId of options.outfitAssetIds ?? []) {
        await this.attachOutfit(outfitId);
      }

      this.mixer = new THREE.AnimationMixer(body);
      this.handBone = body.getObjectByName("hand_r") ?? null;
      this.headBone = body.getObjectByName("Head") ?? null;
      this.ready = true;
      this.play("idle", true);
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  /** Layers an outfit piece onto the shared skeleton. */
  private async attachOutfit(assetId: string): Promise<void> {
    const source = await this.assets.load(assetId);
    const piece = cloneSkinned(source) as THREE.Group;
    piece.name = `outfit-${assetId}`;
    piece.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    this.root.add(piece);
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Switches pose with a crossfade. `force` restarts a one-shot that is already playing, which is
   * what makes repeated swings read as repeated swings rather than one long animation.
   */
  play(pose: CharacterPose, force = false): void {
    if (!this.mixer) return;
    if (pose === this.current && !force) return;

    const action = this.resolveAction(pose);
    if (!action) return;

    const previous = this.currentAction;
    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);

    if (ONE_SHOT.has(pose)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    }

    if (previous && previous !== action) {
      action.crossFadeFrom(previous, CROSSFADE_SECONDS, false);
    }
    action.play();

    this.current = pose;
    this.currentAction = action;
  }

  private resolveAction(pose: CharacterPose): THREE.AnimationAction | null {
    if (!this.mixer) return null;
    for (const clipName of POSE_CLIPS[pose]) {
      const cached = this.actions.get(clipName);
      if (cached) return cached;
      const clip = this.assets.clip(clipName);
      if (!clip) {
        this.missingClips.add(clipName);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      this.actions.set(clipName, action);
      return action;
    }
    // Falling back to idle rather than freezing in bind pose: a T-posed character is the single
    // loudest "unfinished" signal a frame can carry.
    return pose === "idle" ? null : this.resolveAction("idle");
  }

  /** Chooses a pose from movement and activity, so callers do not duplicate the mapping. */
  poseFor(input: {
    moving: boolean;
    speed: number;
    dead: boolean;
    inCombat: boolean;
    activityKind: string | null;
  }): CharacterPose {
    if (input.dead) return "death";
    if (input.activityKind === "gathering") return "mine";
    if (input.activityKind === "production") return "produce";
    if (input.activityKind === "farming") return "farm";
    if (input.activityKind === "eating") return "eat";
    if (input.activityKind === "traversing") return "climb";
    if (input.moving) return input.speed > 3.0 ? "run" : "walk";
    return "idle";
  }

  /** Attaches a weapon or tool to the right hand. Pass null to clear. */
  setMainHand(object: THREE.Object3D | null): void {
    if (this.handAttachment) {
      this.handAttachment.removeFromParent();
      this.handAttachment = null;
    }
    if (object && this.handBone) {
      this.handBone.add(object);
      this.handAttachment = object;
    }
  }

  setHead(object: THREE.Object3D | null): void {
    if (this.headAttachment) {
      this.headAttachment.removeFromParent();
      this.headAttachment = null;
    }
    if (object && this.headBone) {
      this.headBone.add(object);
      this.headAttachment = object;
    }
  }

  /** Loads and attaches the equipped weapon by asset id. Silently no-ops on a missing asset. */
  async equipMainHandAsset(assetId: string | null): Promise<void> {
    if (!assetId) {
      this.setMainHand(null);
      return;
    }
    try {
      const source = await this.assets.load(assetId);
      const weapon = source.clone(true);
      // The kit's weapons are authored upright at the origin; the hand bone points down the arm.
      weapon.rotation.set(Math.PI / 2, 0, 0);
      weapon.position.set(0, 0.03, 0.04);
      this.setMainHand(weapon);
    } catch {
      this.setMainHand(null);
    }
  }

  setPosition(position: Vec3, facingRad: number): void {
    this.root.position.set(position[0], position[1], position[2]);
    this.root.rotation.y = facingRad;
  }

  update(deltaSeconds: number): void {
    this.mixer?.update(deltaSeconds);
    // A finished one-shot returns to idle on its own, so a swing does not freeze on its last frame.
    if (this.currentAction && ONE_SHOT.has(this.current) && !this.currentAction.isRunning()) {
      this.play("idle", true);
    }
  }

  /** Clip names the rig asked for and did not find. Surfaced through the debug API. */
  getMissingClips(): string[] {
    return [...this.missingClips];
  }

  currentPose(): CharacterPose {
    return this.current;
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.actions.clear();
    this.root.removeFromParent();
  }
}

/** Equipment slots that have a visible attachment. The rest are stat-only in Phase 1. */
export const VISIBLE_SLOTS: readonly EquipSlot[] = ["mainHand", "head", "body", "legs", "feet"] as const;

export function equippedAssetId(stack: ItemStack | null, lookup: (itemId: string) => string | undefined): string | null {
  if (!stack) return null;
  return lookup(stack.itemId) ?? null;
}
