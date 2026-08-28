/**
 * Human input: click-to-move, WASD direct movement, camera orbit and zoom, hover picking.
 *
 * Both movement styles the brief asks for, side by side. Everything routes through GameApi, so a
 * human click and an agent tool call reach the identical function.
 */
import * as THREE from "three";
import type { CorealmGameApi } from "../api/gameApi.js";
import type { OrbitCamera } from "../render/camera.js";
import type { Renderer } from "../render/renderer.js";
import type { Movement } from "../systems/movement.js";
import type { Vec3 } from "../contracts.js";
import { CAMERA } from "../app/config.js";

const DRAG_THRESHOLD_PX = 4;

export class InputController {
  private keys = new Set<string>();
  private pointerDown = false;
  private dragging = false;
  private dragButton = 0;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  hoveredEntityId: string | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: Renderer,
    private readonly camera: OrbitCamera,
    private readonly api: CorealmGameApi,
    private readonly movement: Movement,
  ) {
    this.attach();
  }

  private attach(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", () => this.keys.clear());
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = true;
    this.dragging = false;
    this.dragButton = event.button;
    this.downX = this.lastX = event.clientX;
    this.downY = this.lastY = event.clientY;
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

    if (!this.pointerDown) return;
    if (!this.dragging && Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > DRAG_THRESHOLD_PX) {
      this.dragging = true;
    }
    if (!this.dragging) return;

    // Right-drag or middle-drag orbits. Left-drag is reserved for future selection boxes.
    if (this.dragButton === 2 || this.dragButton === 1) {
      const deltaX = event.clientX - this.lastX;
      const deltaY = event.clientY - this.lastY;
      this.camera.rotate(-deltaX * 0.006, -deltaY * 0.004);
    }
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    if (this.dragging) {
      this.dragging = false;
      return;
    }
    if (event.button === 0) this.handleClick(event.clientX, event.clientY);
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.camera.zoom(Math.sign(event.deltaY) * (CAMERA.maxDistance - CAMERA.minDistance) * 0.06);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.key.toLowerCase());
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  /** Click-to-move: raycast the terrain, path there through GameApi. */
  private handleClick(clientX: number, clientY: number): void {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.renderer.camera);

    const terrain = this.renderer.scene.getObjectByName("terrain");
    if (!terrain) return;
    const hits = this.raycaster.intersectObject(terrain, true);
    const hit = hits[0];
    if (!hit) return;

    const target: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
    this.api.moveTo({ position: target });
  }

  /**
   * Folds held keys into the movement controller. Called once per rendered frame.
   * Movement is screen-relative, so W always means "away from the camera".
   */
  update(): void {
    const forward = (this.keys.has("w") || this.keys.has("arrowup") ? 1 : 0)
      - (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0);
    const strafe = (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0)
      - (this.keys.has("a") || this.keys.has("arrowleft") ? 1 : 0);
    this.movement.setDirectInput({ forward, strafe, cameraYaw: this.camera.yaw });
  }

  clear(): void {
    this.keys.clear();
    this.pointerDown = false;
    this.dragging = false;
    this.movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: this.camera.yaw });
  }

  isHeld(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }
}
