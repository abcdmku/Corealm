/**
 * Renderer ownership: the WebGL context, the render target size, lighting rig, and per-frame stats.
 *
 * This file owns no gameplay state. Everything it draws is a view of the canonical store.
 */
import * as THREE from "three";
import { CAMERA, RENDER_BUDGET } from "../app/config.js";

export interface RenderStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  overBudget: boolean;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;

  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  private stats: RenderStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, programs: 0, overBudget: false };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc4dd);
    this.scene.fog = new THREE.Fog(0x9fc4dd, 90, 260);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 14, 18);
    this.camera.lookAt(0, 1, 0);

    // Restrained three-light rig. Stylized low-poly reads best with a strong key, a cool fill from
    // the sky, and just enough bounce to keep shadowed faces from going flat black.
    this.sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    this.sun.position.set(42, 60, 26);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(new THREE.HemisphereLight(0xbcd8f0, 0x5c5240, 1.15));

    const bounce = new THREE.DirectionalLight(0xd8e4ff, 0.35);
    bounce.position.set(-30, 18, -24);
    this.scene.add(bounce);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Keeps the shadow frustum tight around the player so 2048px of shadow map stays sharp. */
  followShadow(target: THREE.Vector3): void {
    this.sun.position.set(target.x + 42, target.y + 60, target.z + 26);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }

  render(nowMs: number): void {
    this.renderer.render(this.scene, this.camera);

    if (this.lastFrameAt > 0) {
      const frameMs = nowMs - this.lastFrameAt;
      this.frameTimes.push(frameMs);
      if (this.frameTimes.length > 90) this.frameTimes.shift();
    }
    this.lastFrameAt = nowMs;

    const info = this.renderer.info.render;
    const averageMs = this.frameTimes.length
      ? this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length
      : 0;

    this.stats = {
      fps: averageMs > 0 ? Math.round(1000 / averageMs) : 0,
      frameMs: Math.round(averageMs * 100) / 100,
      drawCalls: info.calls,
      triangles: info.triangles,
      programs: this.renderer.info.programs?.length ?? 0,
      overBudget: info.calls > RENDER_BUDGET.maxDrawCalls,
    };
  }

  getStats(): RenderStats {
    return { ...this.stats };
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
