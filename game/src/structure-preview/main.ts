import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { RegionId } from "../contracts.js";
import { AssetRegistry } from "../render/assets.js";
import {
  BUILDING_KITS,
  COMPOSITION_IDS,
  KIT_IDS,
  PREFAB_IDS,
  buildComposition,
  buildPrefab,
  buildWallRun,
  type CompositionId,
  type KitId,
  type PartPlacement,
  type PrefabId,
} from "../render/buildings.js";
import { architectureMaterialRoleForAsset, MaterialLibrary, REGION_PALETTES } from "../render/materials.js";
import { selectedStructureVariantId } from "../render/structures/catalog.js";

type SourceKind = "prefab" | "composition" | "wall-run";

interface StructureSelection {
  kind: SourceKind;
  id: string;
  kit: KitId;
  width: number;
  depth: number;
  seed: number;
}

interface StructurePreviewState {
  ready: boolean;
  revision: number;
  frames: number;
  partCount: number;
  assetCount: number;
  buildMs: number;
  variant: string | null;
  selection: StructureSelection;
  errors: string[];
}

interface StructurePreviewApi {
  getState(): StructurePreviewState;
  setSelection(patch: Partial<StructureSelection>): Promise<StructurePreviewState>;
}

declare global {
  interface Window {
    __structurePreview?: StructurePreviewApi;
  }
}

const DEFAULT_FOOTPRINTS: Record<PrefabId, readonly [number, number]> = {
  cottage: [6, 4], townhouse: [6, 4], hall: [12, 6], tower: [6, 6], stall: [4, 3],
  wall_segment: [8, 2], gatehouse: [8, 4], shed: [4, 4], ruin: [6, 4], quarry_hut: [6, 4],
  forge: [6, 5], porch: [4, 3], arcade: [6, 3], market_row: [9, 3], well: [2, 2], farmstead: [10, 6],
};

const KIT_REGIONS: Record<KitId, RegionId> = {
  plaster: "fallowmarch",
  timber: "vellenwood",
  stone: "karrowmoor",
};

function element<T extends HTMLElement>(id: string, type: new (...args: never[]) => T): T {
  const value = document.getElementById(id);
  if (!(value instanceof type)) throw new Error(`Structure preview needs #${id}`);
  return value;
}

function option(value: string, label = value.replaceAll("_", " ")): HTMLOptionElement {
  const result = document.createElement("option");
  result.value = value;
  result.textContent = label;
  return result;
}

function sanitizeSelection(candidate: StructureSelection): StructureSelection {
  const kind: SourceKind = candidate.kind === "composition"
    ? "composition"
    : candidate.kind === "wall-run" ? "wall-run" : "prefab";
  const ids: readonly string[] = kind === "prefab"
    ? PREFAB_IDS
    : kind === "composition" ? COMPOSITION_IDS : ["wall_run"];
  const fallback = kind === "prefab" ? "cottage" : kind === "composition" ? "region_gate" : "wall_run";
  const id = ids.includes(candidate.id) ? candidate.id : fallback;
  const kit = (KIT_IDS as readonly string[]).includes(candidate.kit) ? candidate.kit : "plaster";
  const clampSize = (value: number, fallbackValue: number) => Number.isFinite(value)
    ? Math.min(30, Math.max(2, Math.round(value))) : fallbackValue;
  return {
    kind,
    id,
    kit,
    width: clampSize(candidate.width, 6),
    depth: clampSize(candidate.depth, 4),
    seed: Number.isFinite(candidate.seed) ? Math.max(0, Math.floor(candidate.seed)) : 0,
  };
}

function partsFor(value: StructureSelection): PartPlacement[] {
  if (value.kind === "prefab") {
    return buildPrefab(value.id as PrefabId, [value.width, value.depth], value.seed, value.kit);
  }
  if (value.kind === "composition") {
    return buildComposition(value.id as CompositionId, value.seed, value.kit);
  }
  return buildWallRun(
    value.width,
    [{ at: value.width / 2, width: Math.min(value.depth, value.width) }],
    BUILDING_KITS[value.kit],
    value.seed,
  );
}

function variantFor(value: StructureSelection): string | null {
  if (value.kind !== "prefab") return null;
  return selectedStructureVariantId(
    value.id as PrefabId,
    [value.width, value.depth],
    value.seed,
    BUILDING_KITS[value.kit],
  ) ?? "classic";
}

async function startStructurePreview(params: URLSearchParams): Promise<void> {
  const canvas = element("structure-viewport", HTMLCanvasElement);
  const labModeInput = element("lab-mode", HTMLSelectElement);
  const sourceKind = element("source-kind", HTMLSelectElement);
  const structureId = element("structure-id", HTMLSelectElement);
  const kitId = element("kit-id", HTMLSelectElement);
  const widthInput = element("footprint-width", HTMLInputElement);
  const depthInput = element("footprint-depth", HTMLInputElement);
  const seedInput = element("variant-seed", HTMLInputElement);
  const previousSeed = element("previous-seed", HTMLButtonElement);
  const nextSeed = element("next-seed", HTMLButtonElement);
  const autoRotate = element("auto-rotate", HTMLInputElement);
  const fitCameraButton = element("fit-camera", HTMLButtonElement);
  const statusTitle = element("status-title", HTMLElement);
  const statusDetail = element("status-detail", HTMLElement);
  const statusPanel = statusTitle.closest(".status");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a241f);
  scene.fog = new THREE.Fog(0x1a241f, 34, 80);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  camera.position.set(13, 10, 16);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 3, 0);
  controls.maxPolarAngle = Math.PI * 0.49;

  scene.add(new THREE.HemisphereLight(0xc9d8cf, 0x4a4031, 2.15));
  const sun = new THREE.DirectionalLight(0xffe4b8, 3.4);
  sun.position.set(-12, 18, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 55;
  scene.add(sun);

  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x6f765d, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.GridHelper(40, 40, 0x756f52, 0x465047));

  const assets = new AssetRegistry();
  const materials = new MaterialLibrary();
  let structureRoot = new THREE.Group();
  structureRoot.name = "structure-preview-root";
  scene.add(structureRoot);

  let selection = sanitizeSelection({
    kind: params.get("kind") === "composition"
      ? "composition"
      : params.get("kind") === "wall-run" ? "wall-run" : "prefab",
    id: params.get("id") ?? "cottage",
    kit: params.get("kit") as KitId ?? "plaster",
    width: Number(params.get("width") ?? 6),
    depth: Number(params.get("depth") ?? 4),
    seed: Number(params.get("seed") ?? 0),
  });
  let structureState: StructurePreviewState = {
    ready: false, revision: 0, frames: 0, partCount: 0, assetCount: 0, buildMs: 0,
    variant: null, selection: { ...selection }, errors: [],
  };
  let buildToken = 0;

  function styleObject(object: THREE.Object3D, assetIdValue: string, regionId: RegionId): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const style = (material: THREE.Material): THREE.Material => {
        const role = architectureMaterialRoleForAsset(assetIdValue, material.name);
        return role ? materials.architecture(material, regionId, role) : material;
      };
      child.material = Array.isArray(child.material) ? child.material.map(style) : style(child.material);
      child.castShadow = true;
      child.receiveShadow = true;
    });
  }

  function setStatus(title: string, detail: string, error = false): void {
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
    statusPanel?.classList.toggle("error", error);
  }

  function syncStructureControls(): void {
    labModeInput.value = "structures";
    sourceKind.value = selection.kind;
    const ids: readonly string[] = selection.kind === "prefab"
      ? PREFAB_IDS
      : selection.kind === "composition" ? COMPOSITION_IDS : ["wall_run"];
    structureId.replaceChildren(...ids.map((id) => option(id)));
    structureId.value = selection.id;
    kitId.value = selection.kit;
    widthInput.value = String(selection.width);
    depthInput.value = String(selection.depth);
    seedInput.value = String(selection.seed);
    const footprintDisabled = selection.kind === "composition";
    widthInput.disabled = footprintDisabled;
    depthInput.disabled = footprintDisabled;
    document.querySelector(".footprint-row")?.classList.toggle("disabled", footprintDisabled);
  }

  function syncUrl(): void {
    const next = new URLSearchParams({
      mode: "structures",
      kind: selection.kind,
      id: selection.id,
      kit: selection.kit,
      width: String(selection.width),
      depth: String(selection.depth),
      seed: String(selection.seed),
    });
    history.replaceState(null, "", `${location.pathname}?${next}`);
  }

  function fitCamera(): void {
    const bounds = new THREE.Box3().setFromObject(structureRoot);
    if (bounds.isEmpty()) return;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(2.5, sphere.radius);
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).add(new THREE.Vector3(radius * 1.45, radius * 0.9, radius * 1.65));
    camera.near = Math.max(0.05, radius / 100);
    camera.far = Math.max(100, radius * 12);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function showStructureStatus(): void {
    const current = structureState;
    if (!current.ready) {
      setStatus("Structure not built", current.errors.join(" | "), current.errors.length > 0);
      return;
    }
    setStatus(
      `${current.selection.id.replaceAll("_", " ")} - ${current.variant ?? `seed ${current.selection.seed}`}`,
      `${current.partCount} parts - ${current.assetCount} GLBs - ${current.buildMs.toFixed(0)} ms`,
    );
  }

  async function rebuild(nextSelection: StructureSelection, autoFit = true): Promise<StructurePreviewState> {
    const token = ++buildToken;
    selection = sanitizeSelection(nextSelection);
    structureState = { ...structureState, ready: false, selection: { ...selection }, errors: [] };
    syncStructureControls();
    syncUrl();
    setStatus("Building...", `${selection.kit} - ${selection.id} - seed ${selection.seed}`);
    const started = performance.now();

    try {
      const parts = partsFor(selection);
      const assetIds = [...new Set(parts.map((part) => part.assetId))];
      await assets.loadMany(assetIds);
      if (token !== buildToken) return structureState;

      const nextRoot = new THREE.Group();
      nextRoot.name = `${selection.kind}:${selection.id}`;
      const regionId = KIT_REGIONS[selection.kit];
      for (const part of parts) {
        const object = assets.instance(part.assetId);
        object.name = part.tag;
        object.position.set(part.dx, part.dy, part.dz);
        object.rotation.y = part.rotationY;
        object.scale.setScalar(part.scale);
        if (part.scaleAxes) object.scale.multiply(new THREE.Vector3(...part.scaleAxes));
        styleObject(object, part.assetId, regionId);
        nextRoot.add(object);
      }

      scene.remove(structureRoot);
      structureRoot = nextRoot;
      scene.add(structureRoot);
      groundMaterial.color.setHex(REGION_PALETTES[regionId].groundLow);
      if (autoFit) fitCamera();

      structureState = {
        ready: true,
        revision: structureState.revision + 1,
        frames: structureState.frames,
        partCount: parts.length,
        assetCount: assetIds.length,
        buildMs: performance.now() - started,
        variant: variantFor(selection),
        selection: { ...selection },
        errors: [],
      };
      showStructureStatus();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      structureState = { ...structureState, ready: false, errors: [message], selection: { ...selection } };
      setStatus("Preview failed", message, true);
      console.error("Structure preview failed", cause);
    }
    return structuredClone(structureState);
  }

  function selectionFromControls(): StructureSelection {
    return sanitizeSelection({
      kind: sourceKind.value as SourceKind,
      id: structureId.value,
      kit: kitId.value as KitId,
      width: Number(widthInput.value),
      depth: Number(depthInput.value),
      seed: Number(seedInput.value),
    });
  }

  async function rebuildFromControls(): Promise<void> {
    await rebuild(selectionFromControls());
  }

  labModeInput.addEventListener("change", () => {
    if (labModeInput.value === "actors") location.assign("./index.html?mode=actors");
  });
  sourceKind.addEventListener("change", () => {
    const kind = sourceKind.value as SourceKind;
    const id = kind === "prefab" ? "cottage" : kind === "composition" ? "region_gate" : "wall_run";
    const dimensions = kind === "wall-run" ? { width: 18, depth: 4 } : {};
    void rebuild({ ...selection, kind, id, ...dimensions });
  });
  structureId.addEventListener("change", () => {
    const id = structureId.value;
    if (selection.kind === "prefab") {
      const footprint = DEFAULT_FOOTPRINTS[id as PrefabId];
      void rebuild({ ...selection, id, width: footprint[0], depth: footprint[1] });
    } else if (selection.kind === "composition") {
      void rebuild({ ...selection, id });
    }
  });
  kitId.addEventListener("change", () => { void rebuildFromControls(); });
  widthInput.addEventListener("change", () => { void rebuildFromControls(); });
  depthInput.addEventListener("change", () => { void rebuildFromControls(); });
  seedInput.addEventListener("change", () => { void rebuildFromControls(); });
  previousSeed.addEventListener("click", () => { void rebuild({ ...selection, seed: Math.max(0, selection.seed - 1) }); });
  nextSeed.addEventListener("click", () => { void rebuild({ ...selection, seed: selection.seed + 1 }); });
  fitCameraButton.addEventListener("click", fitCamera);

  window.__structurePreview = {
    getState: () => structuredClone(structureState),
    setSelection: async (patch) => rebuild({ ...selection, ...patch }),
  };

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const pixelRatio = Math.min(devicePixelRatio, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  function frame(now: number): void {
    structureState.frames += 1;
    if (autoRotate.checked) structureRoot.rotation.y = now * 0.00018;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  syncStructureControls();
  await assets.loadManifest();
  await rebuild(selection);
}

const params = new URLSearchParams(location.search);
if (params.get("mode") === "actors") {
  location.replace("./index.html?mode=actors");
} else {
  await startStructurePreview(params);
}
