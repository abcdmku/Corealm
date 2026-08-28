/**
 * Renderer ownership: the WebGL context, the render target size, sky, atmosphere, lighting rig,
 * and per-frame stats.
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

/**
 * The sky gradient, authored by elevation rather than by texture row.
 *
 * `e` is 1 at the zenith, 0 at the geometric horizon, -1 straight down. Sphere UV and three's
 * equirectangular mapping are the same function of the polar angle — `uv.y = 1 - phi/PI` — so
 * `e = 2 * uv.y - 1` converts one to the other exactly, and the pale band lands ON the horizon
 * instead of 0.38 of a hemisphere below it, which is where the authored "horizon at 0.88" would
 * have put it if 0.88 were read as a full-sphere v.
 *
 * The lower hemisphere is not decoration and it is not hidden either. It is the environment map, so
 * what sits below the horizon is the bounce light every roof, blade and wet surface receives from
 * the ground — which is why it ends dark at the nadir. But it is ALSO on screen: at a shot pitch of
 * 0.4 rad the camera looks 23 degrees down, so everything from the horizon to -7.5 degrees is
 * visible background wherever terrain does not cover it, and the world is only 700 x 400 m so a
 * ridge-top view runs out of terrain long before the far plane. A brown ground tone there read as a
 * desert plain filling a third of `sky-great_cairn`. The first 22 degrees below the horizon are
 * therefore haze in the fog's own tone, and only past that does it fall to ground.
 *
 * Two corrections to the authored numbers, both measured rather than taste.
 *
 * FIRST, the bands are far tighter to the horizon than "warm in the lowest 12%" reads as. The
 * eighteen authored shot pitches run 0.34 to 0.62 rad, so at a 55-degree vertical FOV the top edge
 * of the frame sits between +4.6 and -8.0 degrees of elevation: this game NEVER shows sky above
 * about 5 degrees. A warm band 12% of a hemisphere tall is 10.8 degrees, which made the whole sky
 * one flat tan field — measured at (217, 213, 201) to (170, 157, 129) top to bottom in
 * `sky-great_cairn` before this was tightened. All of the gradient's work now happens in the first
 * 11 degrees, and the blues above that exist for the environment map rather than for the frame.
 *
 * SECOND, the hex values below are pre-compensated for ACES. The background is tone mapped (three
 * tone maps any background whose colour space is not sRGB, and a PMREM target is linear), and ACES
 * desaturates pale colours hard: the authored horizon #cfe0e8 came out of the pipe as #d1d8db, a
 * near-neutral grey, which is why the first pass had a colourless sky. Each stop here is the value
 * that DISPLAYS as the authored one, solved by bisecting the ACES fit at exposure 1.0. The comments
 * give the authored colour each stop resolves to.
 */
const SKY_STOPS: readonly { e: number; colour: number }[] = [
  { e: 1.000, colour: 0x4e79ae },   // displays as the authored zenith #4f83b8
  { e: 0.450, colour: 0x6997cb },   // displays as #7ba7cc, the authored mid-sky stop
  { e: 0.120, colour: 0x89bdee },   // 11 degrees: displays as #a9c6dc
  { e: 0.045, colour: 0xa8d8f2 },   // 4 degrees
  { e: 0.012, colour: 0xc1f7ff },   // 1 degree: displays as the authored horizon #cfe0e8
  { e: 0.000, colour: 0xffdf9e },   // displays as the authored warm band #e8d8b8
  { e: -0.012, colour: 0xd6e6ea },  // distant haze rather than ground; see the paragraph above
  { e: -0.250, colour: 0x8f9689 },  // 22 degrees down, where haze gives way to land
  { e: -1.000, colour: 0x4a4436 },  // nadir, the same ground tone the hemisphere light uses
];

/** Rows in the gradient. 256 is smooth enough that no banding survives the 8-bit output. */
const SKY_TEXTURE_HEIGHT = 256;

/**
 * Columns in the gradient. Every row is one flat colour, so this width carries no information —
 * it exists solely because `PMREMGenerator._fromTexture` derives the cube size as
 * `texture.image.width / 4`. The proposed 2 x 256 texture therefore asks for a cube of side 0.5,
 * which yields `_lodMax = -1` and a render target that comes back BLACK: measured as an exactly
 * (0, 0, 0) sky in `sky-palewood_copse` and a scene lit by nothing but the sun and a 0.55 hemisphere.
 * 1024 asks for the 256 cube the proposal costed at 1.4 MB.
 */
const SKY_TEXTURE_WIDTH = 1024;

/**
 * Where the sun sits relative to whatever `followShadow` is tracking.
 *
 * 32 degrees of elevation — `atan(42 / hypot(58, 34))` — not the 50.5 degrees this rig shipped
 * with. A 50-degree sun is near-noon light: shadows are short, faces of a hill differ by almost
 * nothing, and the measured result was an entire 1280x720 frame (`sunder_ledge`) of one grey value
 * across 36 m of authored verticality. At 32 degrees the same geometry throws a shadow 1.6x longer
 * and every building, boulder and terrace riser gets a readable long shadow.
 */
const SUN_OFFSET = { x: 58, y: 42, z: 34 } as const;

export interface WarmupOptions {
  /**
   * Roots whose materials should ALSO be compiled in their transparent form.
   *
   * `transparent` is part of three's program cache key (the `opaque` bit in
   * `WebGLPrograms.getProgramCacheKeyBooleans`), so the first frame the occluder fade flips a roof
   * to transparent pays a fresh shader compile — the same class of stall that measured 1130 ms
   * here. Pass the fade candidates and that cost moves to boot.
   */
  transparentVariants?: readonly THREE.Object3D[];
  /**
   * Groups that are hidden at boot but will be shown later — the dungeon interior, today.
   *
   * `loop.addInterior` hides the Gravelmaw group whenever the player is on the surface, and three
   * skips everything under an invisible ancestor, including its four lights. So a warm-up that runs
   * with the dungeon hidden compiles neither the dungeon's own materials nor the +3-point-light
   * variant of every other material, and the player pays for both in the frame they walk in.
   * These roots are shown for a second compile pass and put back exactly as they were.
   */
  temporarilyVisible?: readonly THREE.Object3D[];
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;

  /** The gradient the sky and the environment map are both generated from. */
  private readonly skyGradient: THREE.DataTexture;
  /** PMREM output. Held so `dispose` can free it; it is both `scene.background` and `.environment`. */
  private readonly environment: THREE.WebGLRenderTarget | null;
  /**
   * Transparent clones made by `warmup`, kept alive deliberately. three releases a program when the
   * last material referencing it is disposed, so an undisposed clone is what pins the variant in
   * the program cache for the life of the session.
   */
  private readonly warmupMaterials: THREE.Material[] = [];

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
    // 1.00, not 1.05. Exposure above 1 on top of ACES and a key light of 3.0 clips the roof tiles
    // in the Highcairn frame to flat orange while the ground under them stays undifferentiated.
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 14, 18);
    this.camera.lookAt(0, 1, 0);

    // Sky and environment, in that order: the gradient is authored once and used twice.
    //
    // Deviation from the proposal, and the reason for it: the spec asked for a BackSide sphere of
    // radius 1000 parented to the camera. Radius 1000 is beyond `CAMERA.far` (280) so it would be
    // clipped away entirely, and a sphere parented to the camera inherits camera pitch, which tilts
    // the horizon band whenever the player orbits. `scene.background` holding the PMREM cube costs
    // the same single draw call, is drawn in the correct orientation by construction, and cannot be
    // clipped or culled. It is also literally the same texture as `scene.environment`, so the sky
    // and the image lighting the world can never disagree.
    this.skyGradient = createSkyGradient();
    this.environment = generateEnvironment(this.renderer, this.skyGradient);
    if (this.environment) {
      this.scene.background = this.environment.texture;
      this.scene.environment = this.environment.texture;
    } else {
      // Fallback only. If PMREM fails there is no IBL and no gradient, but the frame still has the
      // flat sky it had before this change rather than a black void.
      this.scene.background = new THREE.Color(0xb8cfe0);
    }

    // Fog near 30, not 90. The camera lives 6-34 m from the player, so a near of 90 gave the entire
    // playable volume exactly zero attenuation: a ridge 60 m behind Highcairn was drawn at the same
    // saturation as the grass underfoot. 30 puts 8-15% haze on the mid-ground, and 300 clears
    // `CAMERA.far` (280) so nothing reaches full fog before it is clipped.
    // 0x9fcdfa is the authored 0xb8cfe0 pre-compensated for ACES, the same correction the sky stops
    // carry: fog is mixed in linear space before tone mapping, so an uncorrected fog colour lands on
    // screen as #c5d0d7 and the horizon shows a seam where grey haze meets a blue sky.
    this.scene.fog = new THREE.Fog(0x9fcdfa, 30, 300);

    // Key, sky fill, and the environment map doing the bounce. The old rig was a 2.4 key against
    // ~1.5 of ambient — 1.6:1, which is a wash, not lighting. This is closer to 5:1.
    this.sun = new THREE.DirectionalLight(0xffe9c4, 3.0);
    this.sun.position.set(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    // +/-48 rather than +/-70: 96 m across 2048 texels is 4.7 cm per texel against 6.8 cm before,
    // which is what lets a 0.7 m kerb or a fence post cast a shadow with an edge instead of a smear.
    this.sun.shadow.camera.left = -48;
    this.sun.shadow.camera.right = 48;
    this.sun.shadow.camera.top = 48;
    this.sun.shadow.camera.bottom = -48;
    // Tighter texels need less bias. -0.0008 at 6.8 cm/texel was peeling contact shadows away from
    // the objects casting them, which is half of why every prop read as floating.
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 0.55, down from 1.15. The environment map now supplies the sky fill with direction, so a
    // second omnidirectional term at 1.15 only flattens what the sun just shaped.
    this.scene.add(new THREE.HemisphereLight(0x9fc4dd, 0x4a4436, 0.55));

    // The 0.35 back-light that used to sit at (-30, 18, -24) is deliberately gone. It was a fixed
    // fill from one direction regardless of where the geometry faced; `scene.environment` does the
    // same job from every direction at once and is directionally correct.

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

  /**
   * Turns real-time shadows on or off, as a player preference.
   *
   * Flips the light rather than `shadowMap.enabled`: toggling the renderer flag at runtime
   * invalidates every material in the scene and costs a full shader recompile, which on this world
   * is a visible stall. Dropping the sun's cast has the same visual result for free.
   */
  setShadows(enabled: boolean): void {
    this.sun.castShadow = enabled;
  }

  /** Keeps the shadow frustum tight around the player so 2048px of shadow map stays sharp. */
  followShadow(target: THREE.Vector3): void {
    this.sun.position.set(target.x + SUN_OFFSET.x, target.y + SUN_OFFSET.y, target.z + SUN_OFFSET.z);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * Compiles every shader the first frames would otherwise compile mid-session.
   *
   * Measured before this existed: `npm run perf` reported 19 programs at the `spawn` and
   * `town_entrance` poses and 20 at all sixteen later ones, and the frames that did the compiling
   * measured 1130.6 ms, 994.7 ms and 346.1 ms against medians of 1.2-4.2 ms. Call this once, at the
   * end of boot, after the world, the entity views, the dungeon and the overlays exist — anything
   * added to the scene afterwards is not covered.
   *
   * Cheap to call twice; three returns the cached program for anything already compiled.
   */
  warmup(options?: WarmupOptions): void {
    const holder = new THREE.Group();
    holder.name = "shader-warmup";

    const seen = new Set<THREE.Material>();
    for (const root of options?.transparentVariants ?? []) {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh !== true) return;
        // Skinned meshes are skipped: skinning is a program parameter too, and nothing skinned is
        // ever a fade candidate — the fade exists for roofs and walls.
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh === true) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (seen.has(material)) continue;
          seen.add(material);
          const clone = material.clone();
          clone.transparent = true;
          clone.depthWrite = false;
          this.warmupMaterials.push(clone);
          // The real geometry, not a placeholder: vertex colours, vertex alphas and UV sets are all
          // program parameters read off the geometry, so a stand-in would compile a different
          // program to the one the fade actually needs.
          const instanced = mesh as THREE.InstancedMesh;
          const proxy = instanced.isInstancedMesh === true
            ? new THREE.InstancedMesh(mesh.geometry, clone, 1)
            : new THREE.Mesh(mesh.geometry, clone);
          proxy.frustumCulled = false;
          holder.add(proxy);
        }
      });
    }

    if (holder.children.length > 0) this.scene.add(holder);
    this.renderer.compile(this.scene, this.camera);

    // Second pass with the interiors revealed. Both variants end up in the program cache, and
    // neither entering nor leaving the dungeon compiles anything afterwards.
    const hidden = (options?.temporarilyVisible ?? []).filter((root) => root.visible === false);
    if (hidden.length > 0) {
      for (const root of hidden) root.visible = true;
      this.renderer.compile(this.scene, this.camera);
      for (const root of hidden) root.visible = false;
    }

    if (holder.children.length > 0) this.scene.remove(holder);
    holder.clear();
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
    for (const material of this.warmupMaterials) material.dispose();
    this.warmupMaterials.length = 0;
    this.environment?.dispose();
    this.skyGradient.dispose();
    this.renderer.dispose();
  }
}

/**
 * The sky as a 2 x 256 RGBA texture.
 *
 * A `DataTexture` rather than the proposed `CanvasTexture`: the bytes are computed here, so the
 * gradient is identical on every machine and in any environment without a DOM, and there is no
 * 2D-canvas colour-management step between the authored hex and the sampled texel.
 */
function createSkyGradient(): THREE.DataTexture {
  const width = SKY_TEXTURE_WIDTH;
  const height = SKY_TEXTURE_HEIGHT;
  const data = new Uint8Array(width * height * 4);
  const colour = new THREE.Color();
  const encoded = { r: 0, g: 0, b: 0 };

  for (let row = 0; row < height; row += 1) {
    // Row 0 is uv.y = 0, which is straight down; row height-1 is the zenith.
    const v = (row + 0.5) / height;
    sampleSky(2 * v - 1, colour);
    // Back to sRGB before it becomes bytes. `sampleSky` works in the linear working space, and the
    // texture is tagged sRGB, so writing the linear values straight out would have the shader decode
    // them a second time — #4f83b8 would reach the frame as #163b78.
    colour.getRGB(encoded, THREE.SRGBColorSpace);
    const r = Math.round(encoded.r * 255);
    const g = Math.round(encoded.g * 255);
    const b = Math.round(encoded.b * 255);
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = "sky-gradient";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Linear interpolation between the authored stops, in sRGB, which is how they were picked. */
function sampleSky(elevation: number, out: THREE.Color): THREE.Color {
  const e = Math.min(1, Math.max(-1, elevation));
  for (let index = 0; index < SKY_STOPS.length - 1; index += 1) {
    const upper = SKY_STOPS[index]!;
    const lower = SKY_STOPS[index + 1]!;
    if (e <= upper.e && e >= lower.e) {
      const span = upper.e - lower.e;
      const t = span <= 0 ? 0 : (e - lower.e) / span;
      const a = new THREE.Color().setHex(lower.colour, THREE.SRGBColorSpace);
      const b = new THREE.Color().setHex(upper.colour, THREE.SRGBColorSpace);
      // setHex with SRGBColorSpace converts to working (linear) space, so lerp here is a linear
      // blend of the two authored colours — which is what avoids the muddy midpoint sRGB lerps give.
      return out.copy(a).lerp(b, t);
    }
  }
  return out.setHex(SKY_STOPS[e > 0 ? 0 : SKY_STOPS.length - 1]!.colour, THREE.SRGBColorSpace);
}

/**
 * Prefilters the gradient into an environment map.
 *
 * There was no `scene.environment` anywhere in this game before this: grep for `envMap`, `PMREM`
 * or `scene.environment` across game/src returned nothing. That is why nothing metallic reads as
 * metal, and why a roughness-0.1 water surface would have rendered black — a smooth surface with
 * nothing to reflect reflects nothing. About 1.4 MB for a 256 cube and roughly 8 ms at boot.
 */
function generateEnvironment(
  renderer: THREE.WebGLRenderer,
  gradient: THREE.DataTexture,
): THREE.WebGLRenderTarget | null {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromEquirectangular(gradient);
    pmrem.dispose();
    target.texture.name = "sky-environment";
    return target;
  } catch {
    // A missing environment map is a look regression, not a crash. Boot continues without it.
    return null;
  }
}
