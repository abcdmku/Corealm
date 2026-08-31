/**
 * Canvas2D view of the build-time rendered world map.
 *
 * Terrain, stamped roads, paving, water and settlement footprints are baked into north-up WebP
 * renditions before Vite builds the game. Runtime work is one selected image blit plus the DOM
 * marker layer owned by MapPanel.
 */
import type { Vec3 } from "../contracts.js";
import {
  WORLD_MAP_DETAIL_RENDITIONS,
  WORLD_MAP_IMAGE_BOUNDS,
} from "../generated/worldMapFingerprint.js";
import type { MapTerrainSource } from "./panels.js";

export interface MapScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface WorldMapViewState {
  centreU: number;
  centreV: number;
  zoom: number;
  worldBounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
}

interface ProjectedPoint {
  u: number;
  v: number;
}

interface ProjectedBounds {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

interface TerrainLevel {
  source: CanvasImageSource;
  width: number;
  height: number;
}

interface DetailRendition {
  readonly id: string;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

interface TerrainLoadState {
  level: TerrainLevel | null;
  loading: HTMLImageElement | null;
  failures: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

const VIEW_PADDING_PX = 18;
const LOAD_RETRY_DELAYS_MS = [250, 1_000] as const;

/**
 * Zoom 1 fits the whole map; MAP_HOME_ZOOM is the "street level" view the window opens at,
 * centred on the player, and it is what the toolbar labels 100%. The ceiling is twice home.
 * Exported so MapPanel's controls and readout stay in the same frame of reference.
 */
export const MAP_MIN_ZOOM = 1;
export const MAP_HOME_ZOOM = 6;
export const MAP_MAX_ZOOM = 12;
const MIN_ZOOM = MAP_MIN_ZOOM;
const MAX_ZOOM = MAP_MAX_ZOOM;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Owns the cached basemap and the pan/zoom transform. It deliberately knows nothing about labels,
 * discovery, destinations, or movement; MapPanel keeps those semantic layers in DOM/SVG.
 */
export class WorldMapCanvas {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly terrainStates = new Map<string, TerrainLoadState>();
  private disposed = false;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private centreU = 0;
  private centreV = 0;
  private zoom = MIN_ZOOM;
  private viewReady = false;
  private projectedBounds: ProjectedBounds;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly source: MapTerrainSource,
  ) {
    this.context = canvas.getContext("2d", { alpha: false });
    this.projectedBounds = this.projectBounds(WORLD_MAP_IMAGE_BOUNDS);
  }

  resize(width: number, height: number): boolean {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    // Capped at 1.5, not 2: on a 2x display this canvas is the biggest raster in the app, and
    // the sharpness difference on a painted terrain map does not survive a blind test.
    const ratio = clamp(window.devicePixelRatio || 1, 1, 1.5);
    if (nextWidth === this.width && nextHeight === this.height && ratio === this.pixelRatio) return false;

    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = ratio;
    this.canvas.width = Math.max(1, Math.round(nextWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(nextHeight * ratio));
    this.canvas.style.width = `${nextWidth}px`;
    this.canvas.style.height = `${nextHeight}px`;
    if (this.viewReady) this.clampCentre();
    return true;
  }

  render(): void {
    if (!this.viewReady) this.resetView();
    const context = this.context;
    if (!context) return;

    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = "#121310";
    context.fillRect(0, 0, this.width, this.height);

    const scale = this.screenScale();
    this.prepare(scale);
    const level = this.pickLoadedLevel(scale);
    if (level) {
      const bounds = this.projectedBounds;
      const topLeft = this.toScreen(bounds.minU, bounds.minV);
      const spanW = (bounds.maxU - bounds.minU) * scale;
      const spanH = (bounds.maxV - bounds.minV) * scale;
      context.imageSmoothingEnabled = true;
      // "medium", not "high": at a 2x-DPI megapixel canvas the high-quality resample is the
      // single most expensive part of a pan frame, and the difference is invisible in motion.
      context.imageSmoothingQuality = "medium";
      // Renditions store +x rightward; the display frame is +x leftward (see project()).
      context.save();
      context.scale(-1, 1);
      context.drawImage(level.source, -(topLeft.x + spanW), topLeft.y, spanW, spanH);
      context.restore();
    } else {
      this.paintFallback(context);
      this.paintLoadStatus(context);
    }

  }

  resetView(): void {
    const bounds = this.projectedBounds;
    this.centreU = (bounds.minU + bounds.maxU) / 2;
    this.centreV = (bounds.minV + bounds.maxV) / 2;
    this.zoom = MIN_ZOOM;
    this.viewReady = true;
    this.clampCentre();
  }

  /** Centre the view on a world position, optionally at a given zoom. Used by "open on player". */
  centreOn(position: Vec3, zoom?: number): void {
    if (!this.viewReady) this.resetView();
    if (zoom !== undefined) this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const projected = this.project(position[0], position[1], position[2]);
    this.centreU = projected.u;
    this.centreV = projected.v;
    this.clampCentre();
  }

  zoomBy(factor: number, anchorX = this.width / 2, anchorY = this.height / 2): boolean {
    const before = this.mapAt(anchorX, anchorY);
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - this.zoom) < 1e-6) return false;
    this.zoom = next;
    const scale = this.screenScale();
    this.centreU = before.u - (anchorX - this.width / 2) / scale;
    this.centreV = before.v - (anchorY - this.height / 2) / scale;
    this.clampCentre();
    return true;
  }

  panByPixels(deltaX: number, deltaY: number): boolean {
    if (this.zoom <= MIN_ZOOM + 1e-6) return false;
    const previousU = this.centreU;
    const previousV = this.centreV;
    const scale = this.screenScale();
    this.centreU -= deltaX / scale;
    this.centreV -= deltaY / scale;
    this.clampCentre();
    return Math.abs(previousU - this.centreU) > 1e-6 || Math.abs(previousV - this.centreV) > 1e-6;
  }

  screen(position: Vec3): MapScreenPoint {
    const projected = this.project(position[0], position[1], position[2]);
    const point = this.toScreen(projected.u, projected.v);
    return {
      x: point.x,
      y: point.y,
      visible: point.x >= -24 && point.y >= -24 && point.x <= this.width + 24 && point.y <= this.height + 24,
    };
  }

  zoomLevel(): number {
    return this.zoom;
  }

  viewport(): Readonly<{ width: number; height: number }> {
    return { width: this.width, height: this.height };
  }

  /** JSON-safe state for browser acceptance checks. Projected U/V are the pan coordinate frame. */
  viewState(): WorldMapViewState {
    return {
      centreU: Math.round(this.centreU * 1000) / 1000,
      centreV: Math.round(this.centreV * 1000) / 1000,
      zoom: Math.round(this.zoom * 1000) / 1000,
      worldBounds: { ...this.source.bounds },
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const state of this.terrainStates.values()) {
      if (state.retryTimer !== null) clearTimeout(state.retryTimer);
      state.retryTimer = null;
      if (state.loading) state.loading.src = "";
      state.loading = null;
      state.level = null;
    }
    this.terrainStates.clear();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  /**
   * Image requests begin here, and render() is only called once MapPanel opens. Constructing the
   * closed panel during UI boot therefore does not request any detail rendition.
   */
  private prepare(screenScale: number): void {
    if (this.disposed || !this.context) return;
    const rendition = this.pickRendition(screenScale);
    if (rendition) this.loadRendition(rendition);
  }

  private stateFor(rendition: DetailRendition): TerrainLoadState {
    const existing = this.terrainStates.get(rendition.id);
    if (existing) return existing;
    const state: TerrainLoadState = {
      level: null,
      loading: null,
      failures: 0,
      retryTimer: null,
    };
    this.terrainStates.set(rendition.id, state);
    return state;
  }

  private loadRendition(rendition: DetailRendition): void {
    const state = this.stateFor(rendition);
    if (
      this.disposed
      || state.level
      || state.loading
      || state.retryTimer !== null
      || state.failures > LOAD_RETRY_DELAYS_MS.length
    ) return;
    const image = new Image();
    image.decoding = "async";
    state.loading = image;
    image.onload = () => {
      state.loading = null;
      if (this.disposed) return;
      state.failures = 0;
      state.level = {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      if (!this.viewReady) this.resetView();
      else this.clampCentre();
      this.render();
    };
    image.onerror = () => {
      state.loading = null;
      if (this.disposed) return;
      state.failures += 1;
      const retryDelay = LOAD_RETRY_DELAYS_MS[state.failures - 1];
      if (retryDelay !== undefined) {
        state.retryTimer = setTimeout(() => {
          state.retryTimer = null;
          this.loadRendition(rendition);
        }, retryDelay);
      }
      const fallback = this.fallbackRendition(rendition);
      if (fallback) this.loadRendition(fallback);
      this.render();
    };
    const imageUrl = new URL(rendition.path, document.baseURI);
    imageUrl.searchParams.set("v", rendition.sha256);
    image.src = imageUrl.href;
  }

  /**
   * Pick the smallest pregenerated rendition with at least one source pixel per screen pixel at
   * this zoom. The generator writes largest-first, so walking the list preserves stable ties.
   */
  private pickRendition(screenScale: number): DetailRendition | null {
    const renditions: readonly DetailRendition[] = WORLD_MAP_DETAIL_RENDITIONS;
    const first = renditions[0];
    if (!first) return null;
    const spanU = Math.max(1, this.projectedBounds.maxU - this.projectedBounds.minU);
    const needPxPerUnit = screenScale * this.pixelRatio;
    let chosen = first;
    for (const rendition of renditions) {
      if (rendition.width / spanU >= needPxPerUnit) chosen = rendition;
      else break;
    }
    return chosen;
  }

  private pickLoadedLevel(screenScale: number): TerrainLevel | null {
    const spanU = Math.max(1, this.projectedBounds.maxU - this.projectedBounds.minU);
    const needPxPerUnit = screenScale * this.pixelRatio;
    let chosen: TerrainLevel | null = null;
    for (const rendition of WORLD_MAP_DETAIL_RENDITIONS) {
      const level = this.terrainStates.get(rendition.id)?.level ?? null;
      if (!level) continue;
      if (!chosen) chosen = level;
      if (level.width / spanU >= needPxPerUnit) chosen = level;
    }
    return chosen;
  }

  /** Use another pregenerated level while the preferred file retries. */
  private fallbackRendition(failed: DetailRendition): DetailRendition | null {
    const renditions: readonly DetailRendition[] = WORLD_MAP_DETAIL_RENDITIONS;
    const index = renditions.findIndex((rendition) => rendition.id === failed.id);
    if (index < 0) return null;
    return renditions[index + 1] ?? renditions[index - 1] ?? null;
  }

  /**
   * North (+z) up and — deliberately — world +x to the LEFT. The world is right-handed and Y-up:
   * standing in it facing +z, +x is on your left, so a map that drew +x rightward was mirrored
   * against everything the player sees. The baked PNG is stored +x-rightward, so render() flips
   * it horizontally to match this frame; markers, the pip and clicks all come through here.
   */
  private project(x: number, _height: number, z: number): ProjectedPoint {
    return { u: -x, v: -z };
  }

  private projectBounds(bounds: Readonly<{
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }>): ProjectedBounds {
    const corners = [
      this.project(bounds.minX, 0, bounds.minZ),
      this.project(bounds.maxX, 0, bounds.minZ),
      this.project(bounds.minX, 0, bounds.maxZ),
      this.project(bounds.maxX, 0, bounds.maxZ),
    ];
    return {
      minU: Math.min(...corners.map((point) => point.u)),
      maxU: Math.max(...corners.map((point) => point.u)),
      minV: Math.min(...corners.map((point) => point.v)),
      maxV: Math.max(...corners.map((point) => point.v)),
    };
  }

  private fitScale(): number {
    const bounds = this.projectedBounds;
    const availableWidth = Math.max(1, this.width - VIEW_PADDING_PX * 2);
    const availableHeight = Math.max(1, this.height - VIEW_PADDING_PX * 2);
    return Math.min(
      availableWidth / Math.max(1, bounds.maxU - bounds.minU),
      availableHeight / Math.max(1, bounds.maxV - bounds.minV),
    );
  }

  private screenScale(): number {
    return this.fitScale() * this.zoom;
  }

  private toScreen(u: number, v: number): { x: number; y: number } {
    const scale = this.screenScale();
    return {
      x: this.width / 2 + (u - this.centreU) * scale,
      y: this.height / 2 + (v - this.centreV) * scale,
    };
  }

  private mapAt(x: number, y: number): ProjectedPoint {
    const scale = this.screenScale();
    return {
      u: this.centreU + (x - this.width / 2) / scale,
      v: this.centreV + (y - this.height / 2) / scale,
    };
  }

  private clampCentre(): void {
    const bounds = this.projectedBounds;
    const scale = this.screenScale();
    const halfU = this.width / (2 * scale);
    const halfV = this.height / (2 * scale);
    this.centreU = halfU * 2 >= bounds.maxU - bounds.minU
      ? (bounds.minU + bounds.maxU) / 2
      : clamp(this.centreU, bounds.minU + halfU, bounds.maxU - halfU);
    this.centreV = halfV * 2 >= bounds.maxV - bounds.minV
      ? (bounds.minV + bounds.maxV) / 2
      : clamp(this.centreV, bounds.minV + halfV, bounds.maxV - halfV);
  }

  private paintFallback(context: CanvasRenderingContext2D): void {
    const bounds = this.projectedBounds;
    const topLeft = this.toScreen(bounds.minU, bounds.minV);
    const bottomRight = this.toScreen(bounds.maxU, bounds.maxV);
    context.fillStyle = "#33372b";
    context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }

  private paintLoadStatus(context: CanvasRenderingContext2D): void {
    const states = [...this.terrainStates.values()];
    const exhausted = states.length > 0 && states.every((state) =>
      !state.level
      && !state.loading
      && state.retryTimer === null
      && state.failures > LOAD_RETRY_DELAYS_MS.length
    );
    context.save();
    context.fillStyle = "rgba(8, 10, 8, 0.82)";
    context.fillRect(0, 0, this.width, this.height);
    context.fillStyle = exhausted ? "#f2b8a8" : "#e8ddbf";
    context.font = "600 15px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(exhausted ? "Detailed map unavailable" : "Loading detailed map…", this.width / 2, this.height / 2);
    context.restore();
  }
}
