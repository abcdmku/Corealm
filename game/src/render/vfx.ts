/**
 * Combat and activity feedback: damage numbers, XP drops, spell effects, and the boss telegraph.
 *
 * All of it is driven by the event stream rather than by systems calling in. That keeps the
 * dependency pointing one way — systems emit facts, the renderer reacts — and it means an action
 * taken by an agent produces exactly the same feedback as the same action taken by a human, because
 * both go through the same events.
 *
 * Nothing here owns gameplay state. Deleting this file would make the game ugly, not wrong.
 */
import * as THREE from "three";
import type { GameEvent, SkillId, Vec3 } from "../contracts.js";
import { SKILLS } from "../content/skills.js";

interface FloatingText {
  element: HTMLElement;
  world: THREE.Vector3;
  bornAtMs: number;
  lifetimeMs: number;
  riseMetres: number;
}

interface Telegraph {
  id: string;
  mesh: THREE.Mesh;
  startedAtMs: number;
  durationMs: number;
}

export interface VfxDeps {
  camera: THREE.Camera;
  /** Where floating text is mounted. */
  root: HTMLElement;
  parent: THREE.Object3D;
  /** Current world position of an entity, for anchoring a number to the thing that took the hit. */
  entityPosition(entityId: string): Vec3 | null;
  playerPosition(): Vec3;
}

const DAMAGE_LIFETIME_MS = 1100;
const XP_LIFETIME_MS = 1400;
const MAX_FLOATERS = 40;

export class Vfx {
  /**
   * Floating combat numbers, as a player preference.
   *
   * Off means the numbers are never created, not created-and-hidden: on a busy fight that is the
   * difference between a few dozen DOM nodes a second and none.
   */
  damageNumbers = true;
  private floaters: FloatingText[] = [];
  private telegraphs = new Map<string, Telegraph>();
  private readonly projected = new THREE.Vector3();
  private readonly group = new THREE.Group();

  constructor(private readonly deps: VfxDeps) {
    this.group.name = "vfx";
    this.deps.parent.add(this.group);
  }

  /**
   * Reacts to one game event. Wire this to `EventBus.subscribe` at boot.
   * Unknown event types are ignored on purpose: a new event should never crash the renderer.
   */
  handle(event: GameEvent, nowMs: number): void {
    switch (event.type) {
      case "item.received": {
        const skill = event.data.skill as SkillId | undefined;
        const xp = event.data.xp as number | undefined;
        if (typeof xp === "number" && xp > 0 && skill) this.xpDrop(skill, xp, nowMs);
        break;
      }
      case "level.gained": {
        const skill = event.data.skill as SkillId | undefined;
        const level = event.data.level as number | undefined;
        if (skill && typeof level === "number") {
          this.floatAt(this.deps.playerPosition(), `${SKILLS[skill]?.name ?? skill} ${level}`, "vfx-level", nowMs, 2200, 2.6);
        }
        break;
      }
      case "combat.started":
        break;
      case "health.low":
        this.floatAt(this.deps.playerPosition(), "Low health", "vfx-warning", nowMs, 1600, 1.6);
        break;
      case "player.died":
        this.floatAt(this.deps.playerPosition(), "You died", "vfx-warning", nowMs, 2600, 2.0);
        break;
      case "resource.depleted":
        if (event.entityId) {
          const at = this.deps.entityPosition(event.entityId);
          if (at) this.floatAt(at, "Depleted", "vfx-muted", nowMs, 1200, 1.0);
        }
        break;
      case "inventory.full":
        this.floatAt(this.deps.playerPosition(), "Inventory full", "vfx-warning", nowMs, 1800, 1.8);
        break;
      default:
        break;
    }
  }

  /** A damage number over whoever took the hit. Called directly by the combat system's event data. */
  damage(entityId: string | null, amount: number, kind: "melee" | "magic" | "incoming", nowMs: number): void {
    if (!this.damageNumbers) return;
    const at = entityId ? this.deps.entityPosition(entityId) : this.deps.playerPosition();
    if (!at) return;
    const label = amount <= 0 ? "miss" : String(amount);
    const className = amount <= 0
      ? "vfx-miss"
      : kind === "incoming" ? "vfx-damage-in" : kind === "magic" ? "vfx-damage-magic" : "vfx-damage";
    this.floatAt(at, label, className, nowMs, DAMAGE_LIFETIME_MS, 1.5);
  }

  xpDrop(skill: SkillId, xp: number, nowMs: number): void {
    const element = this.floatAt(this.deps.playerPosition(), `+${xp} ${SKILLS[skill]?.name ?? skill}`, "vfx-xp", nowMs, XP_LIFETIME_MS, 1.9);
    if (element) element.style.color = SKILLS[skill]?.colour ?? "#f2ece0";
  }

  /**
   * A boss ground-slam telegraph: a growing ring the player can read and step out of.
   * The whole point of a telegraph is that it is legible before it hurts, so this fills over the
   * wind-up rather than appearing at the moment of damage.
   */
  telegraph(id: string, centre: Vec3, radius: number, durationMs: number, nowMs: number): void {
    this.clearTelegraph(id);
    const geometry = new THREE.RingGeometry(radius * 0.05, radius, 40);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0xd0552f,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.position.set(centre[0], centre[1] + 0.06, centre[2]);
    mesh.renderOrder = 9;
    this.group.add(mesh);
    this.telegraphs.set(id, { id, mesh, startedAtMs: nowMs, durationMs });
  }

  clearTelegraph(id: string): void {
    const existing = this.telegraphs.get(id);
    if (!existing) return;
    existing.mesh.removeFromParent();
    existing.mesh.geometry.dispose();
    (existing.mesh.material as THREE.Material).dispose();
    this.telegraphs.delete(id);
  }

  /** Per-frame: age floaters, project them to screen space, and grow telegraphs. */
  update(nowMs: number): void {
    for (let index = this.floaters.length - 1; index >= 0; index -= 1) {
      const floater = this.floaters[index]!;
      const age = nowMs - floater.bornAtMs;
      if (age >= floater.lifetimeMs) {
        floater.element.remove();
        this.floaters.splice(index, 1);
        continue;
      }

      const progress = age / floater.lifetimeMs;
      this.projected.copy(floater.world);
      this.projected.y += floater.riseMetres * progress;
      this.projected.project(this.deps.camera);

      if (this.projected.z > 1) {
        floater.element.style.display = "none";
        continue;
      }
      floater.element.style.display = "block";
      floater.element.style.left = `${(this.projected.x * 0.5 + 0.5) * window.innerWidth}px`;
      floater.element.style.top = `${(-this.projected.y * 0.5 + 0.5) * window.innerHeight}px`;
      // Hold full opacity for the first half, then fade, so a number is readable before it goes.
      floater.element.style.opacity = String(progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2);
    }

    for (const [id, telegraph] of [...this.telegraphs]) {
      const progress = (nowMs - telegraph.startedAtMs) / telegraph.durationMs;
      if (progress >= 1) {
        this.clearTelegraph(id);
        continue;
      }
      const material = telegraph.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.25 + progress * 0.45;
      telegraph.mesh.scale.setScalar(0.35 + progress * 0.65);
    }
  }

  private floatAt(
    world: Vec3,
    text: string,
    className: string,
    nowMs: number,
    lifetimeMs: number,
    riseMetres: number,
  ): HTMLElement | null {
    // Cap rather than queue: in a long fight the newest numbers are the ones worth reading.
    while (this.floaters.length >= MAX_FLOATERS) {
      const oldest = this.floaters.shift();
      oldest?.element.remove();
    }

    const element = document.createElement("div");
    element.className = `vfx-float ${className}`;
    element.textContent = text;
    this.deps.root.appendChild(element);

    this.floaters.push({
      element,
      world: new THREE.Vector3(world[0], world[1] + 1.4, world[2]),
      bornAtMs: nowMs,
      lifetimeMs,
      riseMetres,
    });
    return element;
  }

  activeFloaters(): number {
    return this.floaters.length;
  }

  dispose(): void {
    for (const floater of this.floaters) floater.element.remove();
    this.floaters = [];
    for (const id of [...this.telegraphs.keys()]) this.clearTelegraph(id);
    this.group.removeFromParent();
  }
}
