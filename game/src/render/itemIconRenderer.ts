/** Browser-only 3D renderer used by tools/generate-item-icons.ts. */
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ItemId } from "../contracts.js";
import { AssetRegistry } from "./assets.js";
import {
  itemIconAppearance,
  type ItemIconAppearance,
  type ItemIconPrimitive,
  type ItemIconPrimitivePart,
} from "./itemIconAppearances.js";

interface ItemIconRendererApi {
  ready: boolean;
  render(itemId: ItemId): Promise<string>;
}

declare global {
  interface Window {
    __itemIconRenderer?: ItemIconRendererApi;
  }
}

const SIZE = 256;
const assets = new AssetRegistry();
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
  premultipliedAlpha: true,
});
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const root = new THREE.Group();
root.name = "item-icon-root";
scene.add(root);

// One fixed look for the whole catalog. The object rotates only to correct authored axes.
const hemisphere = new THREE.HemisphereLight(0xfff1dc, 0x302821, 1.25);
scene.add(hemisphere);
const key = new THREE.DirectionalLight(0xffe3c2, 3);
key.position.set(-3, 5, 4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
key.shadow.camera.near = 0.1;
key.shadow.camera.far = 14;
scene.add(key);
const rim = new THREE.DirectionalLight(0xb9d1ff, 0.8);
rim.position.set(4, 2, -4);
scene.add(rim);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
const CAMERA_DIRECTION = new THREE.Vector3(1, 0.8165, 1).normalize();
camera.position.copy(CAMERA_DIRECTION).multiplyScalar(6);
camera.lookAt(0, 0, 0);

function material(colour: number, roughness = 0.62, metalness = 0.05): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: colour, roughness, metalness });
}

function ownedMesh(geometry: THREE.BufferGeometry, source: THREE.Material): THREE.Mesh {
  geometry.userData["itemIconOwned"] = true;
  const mesh = new THREE.Mesh(geometry, source);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addBand(group: THREE.Group, y: number, colour: number): void {
  const band = ownedMesh(new THREE.CylinderGeometry(0.105, 0.105, 0.12, 12), material(colour, 0.38, 0.45));
  band.position.y = y;
  group.add(band);
}

function buildPrimitive(part: ItemIconPrimitivePart): THREE.Group {
  const group = new THREE.Group();
  const primary = material(part.colour);
  const secondary = material(part.accent ?? part.colour, 0.4, 0.25);

  const builders: Record<ItemIconPrimitive, () => void> = {
    dagger: () => {
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0, 1.12);
      bladeShape.lineTo(0.28, 0.32);
      bladeShape.lineTo(0.2, -0.36);
      bladeShape.lineTo(-0.2, -0.36);
      bladeShape.lineTo(-0.28, 0.32);
      bladeShape.closePath();
      const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
        depth: 0.12,
        bevelEnabled: true,
        bevelSegments: 1,
        bevelSize: 0.025,
        bevelThickness: 0.02,
      });
      bladeGeometry.center();
      const blade = ownedMesh(bladeGeometry, primary);
      blade.position.y = 0.36;
      group.add(blade);
      const guard = ownedMesh(new THREE.BoxGeometry(0.78, 0.14, 0.18), secondary);
      guard.position.y = -0.48;
      group.add(guard);
      const grip = ownedMesh(new THREE.CylinderGeometry(0.09, 0.11, 0.56, 10), material(0x4c3427, 0.75, 0));
      grip.position.y = -0.82;
      group.add(grip);
      const pommel = ownedMesh(new THREE.SphereGeometry(0.15, 12, 8), secondary.clone());
      pommel.position.y = -1.13;
      group.add(pommel);
    },
    ingot: () => {
      const shape = new THREE.Shape();
      shape.moveTo(-0.82, -0.34);
      shape.lineTo(0.82, -0.34);
      shape.lineTo(0.58, 0.34);
      shape.lineTo(-0.58, 0.34);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.58,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.08,
        bevelThickness: 0.08,
        curveSegments: 1,
      });
      geometry.center();
      const bar = ownedMesh(geometry, primary);
      bar.rotation.x = -0.36;
      group.add(bar);
      const stamp = ownedMesh(new THREE.BoxGeometry(0.62, 0.05, 0.24), secondary);
      stamp.position.set(0, 0.36, 0.02);
      group.add(stamp);
    },
    log: () => {
      const body = ownedMesh(new THREE.CylinderGeometry(0.42, 0.47, 1.9, 16), primary);
      body.rotation.z = Math.PI / 2;
      group.add(body);
      for (const x of [-0.96, 0.96]) {
        const end = ownedMesh(new THREE.CircleGeometry(x < 0 ? 0.42 : 0.47, 16), secondary.clone());
        end.position.x = x;
        end.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2;
        group.add(end);
      }
      const ring = ownedMesh(new THREE.TorusGeometry(0.23, 0.025, 8, 24), material(0x4d3828, 0.9, 0));
      ring.position.x = 0.97;
      ring.rotation.y = Math.PI / 2;
      group.add(ring);
    },
    fish: () => {
      const body = ownedMesh(new THREE.SphereGeometry(0.72, 28, 18), primary);
      body.scale.set(1.35, 0.62, 0.52);
      group.add(body);
      const tail = ownedMesh(new THREE.ConeGeometry(0.48, 0.72, 3), secondary);
      tail.rotation.z = -Math.PI / 2;
      tail.position.x = -1.18;
      group.add(tail);
      const fin = ownedMesh(new THREE.ConeGeometry(0.23, 0.42, 3), secondary);
      fin.position.set(0, 0.48, 0);
      fin.rotation.z = Math.PI;
      group.add(fin);
      const eye = ownedMesh(new THREE.SphereGeometry(0.075, 12, 8), material(0x171514, 0.7, 0));
      eye.position.set(0.62, 0.18, 0.39);
      group.add(eye);
    },
    focus: () => {
      const stone = ownedMesh(new THREE.DodecahedronGeometry(0.68, 1), primary);
      stone.rotation.set(0.2, 0.35, 0.1);
      group.add(stone);
      const orbit = ownedMesh(new THREE.TorusGeometry(0.88, 0.055, 10, 48), secondary);
      orbit.rotation.x = Math.PI / 2.6;
      group.add(orbit);
    },
    hide: () => {
      const shape = new THREE.Shape();
      shape.moveTo(-0.72, 0.8);
      shape.lineTo(-0.35, 0.62);
      shape.lineTo(-0.58, 0.18);
      shape.lineTo(-0.82, -0.65);
      shape.lineTo(-0.32, -0.48);
      shape.lineTo(0, -0.8);
      shape.lineTo(0.32, -0.48);
      shape.lineTo(0.82, -0.65);
      shape.lineTo(0.58, 0.18);
      shape.lineTo(0.35, 0.62);
      shape.lineTo(0.72, 0.8);
      shape.lineTo(0, 0.64);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.12,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.045,
        bevelThickness: 0.04,
      });
      geometry.center();
      const hide = ownedMesh(geometry, primary);
      hide.rotation.set(-0.12, 0.18, 0);
      group.add(hide);
      const patch = ownedMesh(new THREE.CircleGeometry(0.3, 14), secondary);
      patch.position.set(0.08, -0.02, 0.12);
      group.add(patch);
    },
    seed: () => {
      for (const [x, y, angle] of [[-0.42, -0.12, -0.5], [0.1, 0.35, 0.18], [0.46, -0.28, 0.62]] as const) {
        const seed = ownedMesh(new THREE.SphereGeometry(0.34, 18, 12), primary.clone());
        seed.scale.set(0.7, 1.2, 0.48);
        seed.position.set(x, y, 0);
        seed.rotation.z = angle;
        group.add(seed);
      }
      const sprout = ownedMesh(new THREE.ConeGeometry(0.14, 0.48, 5), secondary);
      sprout.position.set(0.26, 0.78, 0);
      sprout.rotation.z = -0.55;
      group.add(sprout);
    },
    shaft: () => {
      const shaft = ownedMesh(new THREE.CylinderGeometry(0.085, 0.085, 2.2, 12), primary);
      group.add(shaft);
      addBand(group, -0.82, part.accent ?? part.colour);
      addBand(group, 0.82, part.accent ?? part.colour);
    },
    rod: () => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.62, -1, 0),
        new THREE.Vector3(-0.32, -0.25, 0),
        new THREE.Vector3(0.12, 0.52, 0),
        new THREE.Vector3(0.62, 1.02, 0),
      ]);
      const rod = ownedMesh(new THREE.TubeGeometry(curve, 24, 0.045, 10, false), primary);
      group.add(rod);
      const reel = ownedMesh(new THREE.TorusGeometry(0.25, 0.065, 10, 32), secondary);
      reel.position.set(-0.34, -0.35, 0.08);
      group.add(reel);
      const handle = ownedMesh(new THREE.CylinderGeometry(0.075, 0.09, 0.48, 10), secondary.clone());
      handle.position.set(-0.66, -0.88, 0);
      handle.rotation.z = -0.36;
      group.add(handle);
    },
    staff: () => {
      const shaft = ownedMesh(new THREE.CylinderGeometry(0.065, 0.09, 2.25, 12), primary);
      group.add(shaft);
      const crown = ownedMesh(new THREE.TorusGeometry(0.34, 0.07, 10, 32), primary.clone());
      crown.position.y = 1.18;
      group.add(crown);
      const stone = ownedMesh(new THREE.OctahedronGeometry(0.25, 0), secondary);
      stone.position.y = 1.18;
      stone.rotation.y = 0.45;
      group.add(stone);
      addBand(group, -0.7, part.accent ?? part.colour);
    },
    ring: () => {
      const ring = ownedMesh(new THREE.TorusGeometry(0.62, 0.115, 16, 48), primary);
      group.add(ring);
      const gem = ownedMesh(new THREE.OctahedronGeometry(0.27, 0), secondary);
      gem.position.y = 0.68;
      gem.rotation.z = Math.PI / 4;
      group.add(gem);
    },
    amulet: () => {
      const chain = ownedMesh(new THREE.TorusGeometry(0.7, 0.045, 10, 48), primary);
      chain.scale.y = 1.18;
      chain.position.y = 0.25;
      group.add(chain);
      const gem = ownedMesh(new THREE.OctahedronGeometry(0.38, 0), secondary);
      gem.position.y = -0.7;
      gem.rotation.z = Math.PI / 4;
      group.add(gem);
    },
  };

  builders[part.primitive]();
  return group;
}

function tintObject(object: THREE.Object3D, colour?: number, accent?: number): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const tint = (source: THREE.Material): THREE.Material => {
      const clone = source.clone();
      const standard = clone as Partial<THREE.MeshStandardMaterial>;
      if (colour !== undefined && standard.color instanceof THREE.Color) {
        const display = new THREE.Color(colour);
        const hsl = { h: 0, s: 0, l: 0 };
        display.getHSL(hsl);
        if (hsl.l < 0.3) display.setHSL(hsl.h, hsl.s, 0.3);
        standard.color.copy(display);
        // The game keeps these maps because an outfit is large enough to read their detail. At 32
        // px they multiply the tint into near-black noise. The icon keeps the authored geometry
        // and uses a flat tier material so the silhouette and colour both survive downsampling.
        standard.map = null;
        standard.vertexColors = false;
        standard.roughness = Math.max(0.38, Math.min(0.78, standard.roughness ?? 0.62));
        standard.metalness = Math.min(0.35, standard.metalness ?? 0);
        standard.needsUpdate = true;
      }
      if (accent !== undefined && standard.emissive instanceof THREE.Color) {
        standard.emissive.setHex(accent);
        standard.emissiveIntensity = 0.15;
      }
      return clone;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
  });
}

async function buildAppearance(appearance: ItemIconAppearance): Promise<THREE.Group> {
  const container = new THREE.Group();
  const localBounds = new THREE.Box3();
  for (const part of appearance.parts) {
    if (part.kind === "primitive") {
      const object = buildPrimitive(part);
      object.updateMatrixWorld(true);
      localBounds.union(new THREE.Box3().setFromObject(object));
      container.add(object);
      continue;
    }
    const source = await assets.load(part.assetId);
    const object = cloneSkeleton(source);
    if (part.scale !== undefined) object.scale.multiplyScalar(part.scale);
    tintObject(object, part.colour, part.accent);
    container.add(object);
    const entry = assets.entry(part.assetId);
    if (!entry) throw new Error(`Missing manifest entry for item icon asset: ${part.assetId}`);
    const scale = part.scale ?? 1;
    const min = new THREE.Vector3(
      entry.base?.x ?? -entry.size.x / 2,
      entry.base?.y ?? -entry.size.y / 2,
      entry.base?.z ?? -entry.size.z / 2,
    ).multiplyScalar(scale);
    const max = new THREE.Vector3(
      (entry.base?.x ?? -entry.size.x / 2) + entry.size.x,
      (entry.base?.y ?? -entry.size.y / 2) + entry.size.y,
      (entry.base?.z ?? -entry.size.z / 2) + entry.size.z,
    ).multiplyScalar(scale);
    localBounds.union(new THREE.Box3(min, max));
  }
  if (appearance.rotation) container.rotation.set(...appearance.rotation);
  container.userData["itemIconLocalBounds"] = {
    min: localBounds.min.toArray(),
    max: localBounds.max.toArray(),
  };
  return container;
}

function disposeCurrent(): void {
  for (const child of [...root.children]) {
    child.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry.userData["itemIconOwned"] === true) mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const entry of materials) entry.dispose();
    });
    root.remove(child);
  }
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
}

function fitCamera(appearance: ItemIconAppearance): void {
  const measuredBounds = (): THREE.Box3 => {
    const content = root.children[0];
    const saved = content?.userData["itemIconLocalBounds"] as
      | { min: [number, number, number]; max: [number, number, number] }
      | undefined;
    if (!content || !saved) return new THREE.Box3().setFromObject(root);
    return new THREE.Box3(
      new THREE.Vector3(...saved.min),
      new THREE.Vector3(...saved.max),
    ).applyMatrix4(content.matrixWorld);
  };

  root.updateMatrixWorld(true);
  let bounds = measuredBounds();
  if (bounds.isEmpty()) throw new Error(`Item icon has empty bounds: ${appearance.itemId}`);

  const centre = bounds.getCenter(new THREE.Vector3());
  const content = root.children[0];
  if (!content) throw new Error(`Item icon has no render object: ${appearance.itemId}`);
  content.position.sub(centre);
  root.updateMatrixWorld(true);
  bounds = measuredBounds();
  const size = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) throw new Error(`Item icon has invalid bounds: ${appearance.itemId}`);

  root.scale.multiplyScalar(2 / longest);
  root.updateMatrixWorld(true);
  bounds = measuredBounds();

  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const min = bounds.min;
  const max = bounds.max;
  const corners = [
    new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z), new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z), new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z), new THREE.Vector3(max.x, max.y, max.z),
  ];
  let width = 0;
  let height = 0;
  for (const corner of corners) {
    corner.applyMatrix4(camera.matrixWorldInverse);
    width = Math.max(width, Math.abs(corner.x) * 2);
    height = Math.max(height, Math.abs(corner.y) * 2);
  }
  const frameScale = appearance.frameScale ?? 1;
  const half = Math.max(width, height) * 0.5 * frameScale / 0.82;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
}

async function render(itemId: ItemId): Promise<string> {
  disposeCurrent();
  const appearance = itemIconAppearance(itemId);
  root.add(await buildAppearance(appearance));
  fitCamera(appearance);
  renderer.clear();
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}

const api: ItemIconRendererApi = { ready: false, render };
window.__itemIconRenderer = api;
await assets.loadManifest();
api.ready = true;
