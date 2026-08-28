/**
 * The world map: where you are, what you have found, and how far away it is.
 *
 * The HUD carries a compass tape and nothing else, across a 700 x 400 m world of three regions
 * joined by a route graph. The data for a map already exists and is already discovery-gated —
 * `observe({ scope: "known" })` returns exactly the locations the player has actually been near,
 * which is the same list an agent gets, so the map cannot show a human something an agent could not
 * find. Nothing here reaches around that gate.
 *
 * SCAFFOLD. The interface below is frozen; the body is a placeholder for the map worker.
 */
import type { ObservedEntity } from "../contracts.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame } from "./panels.js";

/** World bounds from `COREALM_WORLD` in render/scene.ts. The map is drawn in this frame. */
export const WORLD_BOUNDS = { minX: -360, maxX: 340, minZ: -200, maxZ: 200 } as const;

export class MapPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly body: HTMLElement;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "map",
      title: "Map",
      key: "m",
      keyLabel: "Map",
      registry: ctx.registry,
      placement: { top: "96px", left: "50%", width: "620px" },
      onOpen: () => this.refresh(true),
    });

    this.body = document.createElement("div");
    this.body.className = "map";
    this.frame.body.appendChild(this.body);
  }

  /** Discovered places only. Same gate an agent sees. */
  known(): ObservedEntity[] {
    return this.ctx.api.observe({ scope: "known", limit: 100 });
  }

  refresh(force = false): void {
    const player = this.ctx.api.getPlayer();
    const places = this.known();
    const signature = `${places.length}|${Math.round(player.position[0])},${Math.round(player.position[2])}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.frame.setSubtitle(`${places.length} places found`);
    this.body.replaceChildren();
    for (const place of places.slice(0, 12)) {
      const row = document.createElement("div");
      row.className = "map__row";
      row.textContent = `${place.name} — ${Math.round(place.distance)} m`;
      this.body.appendChild(row);
    }
  }

  dispose(): void {
    this.frame.dispose();
  }
}
