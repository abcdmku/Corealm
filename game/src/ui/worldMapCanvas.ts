/**
 * Canvas2D view of the build-time rendered world map.
 *
 * Terrain, stamped roads, paving, water and settlement footprints are baked into one north-up
 * orthographic PNG before Vite builds the game. Runtime work is only one image blit plus the DOM
 * marker layer owned by MapPanel.
 */
import type { Vec3 } from "../contracts.js";
import {
  WORLD_MAP_IMAGE_BOUNDS,
  WORLD_MAP_RENDER_FINGERPRINT,
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

interface CachedTerrain {
  /** Pre-downsampled copies, largest first. Render picks the smallest one that is still at
   * least 1:1 for the current zoom, so a zoomed-out pan never resamples the full-resolution
   * PNG (17 megapixels) every frame — that was the whole of the map's drag lag. */
  levels: TerrainLevel[];
  bounds: ProjectedBounds;
}

const VIEW_PADDING_PX = 18;

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
 * Full resolution plus 1/2 and 1/4 copies, largest first, downsampled once at load. A copy that
 * cannot get a 2D context (unit tests without a canvas backend) is skipped; the full image is
 * always level zero, so rendering never depends on the copies existing.
 */
function buildLevels(image: HTMLImageElement): TerrainLevel[] {
  const levels: TerrainLevel[] = [
    { source: image, width: image.naturalWidth, height: image.naturalHeight },
  ];
  let previous: CanvasImageSource = image;
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  for (let step = 0; step < 2; step += 1) {
    const nextWidth = Math.max(1, Math.round(width / 2));
    const nextHeight = Math.max(1, Math.round(height / 2));
    const canvas = document.createElement("canvas");
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    const context = canvas.getContext("2d");
    if (!context) break;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(previous, 0, 0, nextWidth, nextHeight);
    levels.push({ source: canvas, width: nextWidth, height: nextHeight });
    previous = canvas;
    width = nextWidth;
    height = nextHeight;
  }
  return levels;
}

/**
 * Owns the cached basemap and the pan/zoom transform. It deliberately knows nothing about labels,
 * discovery, destinations, or movement; MapPanel keeps those semantic layers in DOM/SVG.
 */
export class WorldMapCanvas {
  private readonly context: CanvasRenderingContext2D | null;
  private cache: CachedTerrain | null = null;
  private preparing = false;
  private loadFailed = false;
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
    this.prepare();
    if (!this.viewReady) this.resetView();
    const context = this.context;
    if (!context) return;

    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = "#121310";
    context.fillRect(0, 0, this.width, this.height);

    const cache = this.cache;
    if (cache) {
      const topLeft = this.toScreen(cache.bounds.minU, cache.bounds.minV);
      const scale = this.screenScale();
      const level = this.pickLevel(cache, scale);
      const spanW = (cache.bounds.maxU - cache.bounds.minU) * scale;
      const spanH = (cache.bounds.maxV - cache.bounds.minV) * scale;
      context.imageSmoothingEnabled = true;
      // "medium", not "high": at a 2x-DPI megapixel canvas the high-quality resample is the
      // single most expensive part of a pan frame, and the difference is invisible in motion.
      context.imageSmoothingQuality = "medium";
      // The PNG is stored +x-rightward; the display frame is +x-leftward (see project()).
      context.save();
      context.scale(-1, 1);
      context.drawImage(level.source, -(topLeft.x + spanW), topLeft.y, spanW, spanH);
      context.restore();
    } else {
      this.paintFallback(context);
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
    this.cache = null;
    this.loadFailed = true;
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  private prepare(): void {
    if (this.cache || this.preparing || this.loadFailed || !this.context) return;
    this.preparing = true;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const projectedBounds = this.projectBounds(WORLD_MAP_IMAGE_BOUNDS);
      this.cache = { levels: buildLevels(image), bounds: projectedBounds };
      this.projectedBounds = projectedBounds;
      this.preparing = false;
      if (!this.viewReady) this.resetView();
      else this.clampCentre();
      this.render();
    };
    image.onerror = () => {
      this.preparing = false;
      this.loadFailed = true;
      this.render();
    };
    const imageUrl = new URL("generated/world-map.png", document.baseURI);
    imageUrl.searchParams.set("v", WORLD_MAP_RENDER_FINGERPRINT);
    image.src = imageUrl.href;
  }

  /**
   * The smallest pre-downsampled copy that still has at least one source pixel per screen pixel
   * at this zoom (device ratio included). Smaller source, same picture, far cheaper resample.
   */
  private pickLevel(cache: CachedTerrain, screenScale: number): TerrainLevel {
    const spanU = Math.max(1, cache.bounds.maxU - cache.bounds.minU);
    const needPxPerUnit = screenScale * this.pixelRatio;
    let chosen = cache.levels[0]!;
    for (const level of cache.levels) {
      if (level.width / spanU >= needPxPerUnit) chosen = level;
      else break;
    }
    return chosen;
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
}
