/**
 * Canvas2D view of the build-time rendered world map.
 *
 * Terrain, stamped roads, paving, water and settlement footprints are baked into one north-up
 * orthographic PNG before Vite builds the game. Runtime work is only one image blit plus the DOM
 * marker layer owned by MapPanel.
 */
import type { Vec3 } from "../contracts.js";
import { WORLD_MAP_RENDER_FINGERPRINT } from "../generated/worldMapFingerprint.js";
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

interface CachedTerrain {
  image: CanvasImageSource;
  bounds: ProjectedBounds;
}

const VIEW_PADDING_PX = 18;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
    this.projectedBounds = this.estimateBounds();
  }

  resize(width: number, height: number): boolean {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const ratio = clamp(window.devicePixelRatio || 1, 1, 2);
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
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        cache.image,
        topLeft.x,
        topLeft.y,
        (cache.bounds.maxU - cache.bounds.minU) * scale,
        (cache.bounds.maxV - cache.bounds.minV) * scale,
      );
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
      const projectedBounds = this.estimateBounds();
      this.cache = { image, bounds: projectedBounds };
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

  private project(x: number, _height: number, z: number): ProjectedPoint {
    return { u: x, v: -z };
  }

  private estimateBounds(): ProjectedBounds {
    const bounds = this.source.bounds;
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
