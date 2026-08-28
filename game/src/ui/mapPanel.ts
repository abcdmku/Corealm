/**
 * The world map: where you are, what you have found, and how far away it is.
 *
 * The HUD carries a compass tape and nothing else, across a 700 x 400 m world of three regions
 * joined by a route graph. The map is `observe({ scope: "known" })` and nothing else: that call is
 * the discovery gate, it is the same list an agent gets, and nothing here reaches around it. Draw
 * only what it returns and the map cannot show a human something an agent could not find.
 *
 * One caveat the panel cannot fix from here: the gate is currently open. `EntityStore` takes a
 * `discoveredLocationIds` hook, `observeKnown` honours it, and `app/boot.ts` constructs the store
 * with `{ skillLevels }` only — so `discoveredLocationIds()` returns null and every registered
 * location counts as known. `state.discovery.locations` is written by `systems/travel.ts` and read
 * by nobody. A fresh character therefore opens the map on all forty places. When the root wires
 * that hook up, this panel narrows to what has actually been walked to with no change: the
 * nearly-empty cases were built and screenshotted by feeding that hook a set.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS DRAWN, AND WHERE EACH PIECE OF IT COMES FROM
 * ---------------------------------------------------------------------------------------------
 * Everything is one inline SVG in world units: one user unit is one metre, so the drawing is to
 * scale by construction and cannot drift from the world by rounding. `viewBox` does the fitting,
 * which is why there is no resize handler and no canvas.
 *
 *   frame      `WORLD_BOUNDS`, taken from `COREALM_WORLD.bounds` in render/scene.ts.
 *   regions    `RegionDef.bounds` from content/regions.ts, clipped to the frame, tinted with
 *              `REGION_PALETTES` from render/materials.ts so the map and the world agree on what
 *              colour Karrowmoor is.
 *   places     `observe({ scope: "known" })`. Nothing else. Position, name and distance are the
 *              row's own; the pip's shape and colour come from the authored `LocationDef.kind` of
 *              the place the row resolves to, which is a description of a place the player has
 *              already found, not a new one.
 *   roads      `RegionDef.roads` plus `RegionDef.adjacency`, drawn only where BOTH endpoints are
 *              in the known set. A road to somewhere you have not found would be a leak.
 *   player     `getPlayer().position`. Facing is derived — see `headingRad` below.
 *
 * Two content sources disagree about where the regions are, and this file has to pick one:
 * `COREALM_WORLD.regions` tiles the world into three vertical bands (Fallowmarch x < -120,
 * Vellenwood -120..110, Karrowmoor x > 110) while `RegionDef.bounds` authors an L: Fallowmarch
 * west of x = -20, Vellenwood the north-east block, Karrowmoor the south-east one. Five Fallowmarch
 * locations, including Marchfield and Redsill Shallows, sit inside the *terrain* band Vellenwood
 * owns. The map draws the CONTENT bounds, because a map's job is to say which region a place is in
 * — which is the same thing as saying what tier of country you are walking into — and the content
 * bounds are the ones that answer that question consistently. The terrain bands remain the truth
 * about ground colour, which is why the tint is still the region palette.
 *
 * The panel repaints on structure, not on frames. The SVG is rebuilt only when the SET of known
 * places changes (or the panel is forced open); a walking player moves one `transform` and one
 * line of text per refresh.
 */
import type { ObservedEntity, RegionId, Vec3 } from "../contracts.js";
import type { LocationDef, LocationKind } from "../content/regions.js";
import { REGIONS, WALK_SPEED_MPS, allLocations } from "../content/regions.js";
import { COREALM_WORLD } from "../render/scene.js";
import { REGION_PALETTES } from "../render/materials.js";
import { notify } from "./contextMenu.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame, report } from "./panels.js";

/**
 * World bounds from `COREALM_WORLD` in render/scene.ts. The map is drawn in this frame.
 *
 * Note that `content/regions.ts` exports its own `WORLD_BOUNDS` of x -350..350, ten metres east of
 * the terrain's -360..340. The terrain is what the player walks on, so the terrain frame wins here;
 * region rects are clipped into it, and no authored location is anywhere near either edge.
 */
export const WORLD_BOUNDS = {
  minX: COREALM_WORLD.bounds.minX,
  maxX: COREALM_WORLD.bounds.maxX,
  minZ: COREALM_WORLD.bounds.minZ,
  maxZ: COREALM_WORLD.bounds.maxZ,
} as const;

// ------------------------------------------------------------------ geometry

/** Metres of margin around the world rect, so a pip on the border still has its ring. */
const PAD = 14;
const VIEW_W = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX + PAD * 2;
const VIEW_H = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ + PAD * 2;

/** Everything below is in metres. North is up, east is right, so z is flipped and x is not. */
function projX(x: number): number {
  return x - WORLD_BOUNDS.minX + PAD;
}

function projY(z: number): number {
  return WORLD_BOUNDS.maxZ - z + PAD;
}

const GRID_METRES = 100;
const LABEL_SIZE = 12;
const PIP_RADIUS = 4;
const HIT_RADIUS = 11;

// ------------------------------------------------------------- place styling

/** What a place is, in one word, for the readout under the map. */
const KIND_LABEL: Record<LocationKind, string> = {
  settlement: "Town", bank: "Bank", seam: "Ore seam", grove: "Grove", water: "Water",
  farm: "Farm", gate: "Gate", landmark: "Landmark", camp: "Camp", junction: "Junction",
  dungeon: "Dungeon",
};

/**
 * Which places get a name on the map first when names compete for the same square metre.
 * A town you can bank in beats a junction you walk through.
 */
const KIND_RANK: Record<LocationKind, number> = {
  settlement: 0, bank: 1, dungeon: 1, gate: 2, seam: 3, grove: 3, water: 3,
  farm: 3, camp: 4, landmark: 5, junction: 6,
};

const DEFAULT_KIND: LocationKind = "landmark";

// --------------------------------------------------------- the content index

interface LocationEntry {
  id: string;
  regionId: RegionId;
  def: LocationDef;
}

/** The three surface regions. The Gravelmaw has its own interior and is not part of this layout. */
const SURFACE_REGIONS: ReadonlySet<RegionId> = new Set(REGIONS.map((region) => region.id));

/** locationId -> authored place, surface only. Used to name a road's endpoints and style a pip. */
const LOCATION_INDEX: ReadonlyMap<string, LocationEntry> = (() => {
  const index = new Map<string, LocationEntry>();
  for (const entry of allLocations()) {
    if (!SURFACE_REGIONS.has(entry.regionId)) continue;
    index.set(entry.location.id, { id: entry.location.id, regionId: entry.regionId, def: entry.location });
  }
  return index;
})();

/**
 * The route network as location-id pairs: every authored road, plus the gate crossings between
 * regions, deduplicated and with the dungeon's internal legs dropped.
 */
const ROAD_EDGES: readonly (readonly [string, string])[] = (() => {
  const seen = new Set<string>();
  const edges: [string, string][] = [];
  const push = (from: string, to: string): void => {
    if (!LOCATION_INDEX.has(from) || !LOCATION_INDEX.has(to)) return;
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([from, to]);
  };
  for (const region of REGIONS) {
    for (const road of region.roads) push(road.from, road.to);
    for (const link of region.adjacency) push(link.fromLocationId, link.toLocationId);
  }
  return edges;
})();

function hexColour(packed: number): string {
  return `#${packed.toString(16).padStart(6, "0")}`;
}

// ----------------------------------------------------------------- SVG utils

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Label boxes are laid out before the browser has measured anything, so width is estimated. */
function textWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) {
    if (char === " ") width += 0.28;
    else if ("ijltfIr.,'".includes(char)) width += 0.31;
    else if ("mwMW".includes(char)) width += 0.85;
    else if (char === char.toUpperCase()) width += 0.63;
    else width += 0.52;
  }
  return width * size;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function overlaps(a: Box, b: Box): boolean {
  return !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
}

// ------------------------------------------------------------------ the view

/** One known place, resolved from an observed row to something drawable. */
interface PlaceView {
  /** Stable key: the location id where one resolves, otherwise the observed row's own id. */
  key: string;
  /** Non-null when `moveTo({ locationId })` can be used, which is every route node. */
  locationId: string | null;
  entityId: string;
  name: string;
  kind: LocationKind;
  regionId: RegionId;
  x: number;
  z: number;
  px: number;
  py: number;
  distance: number;
  group: SVGGElement;
}

export class MapPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly body: HTMLElement;
  private readonly figure: HTMLElement;
  private readonly readoutName: HTMLElement;
  private readonly readoutMeta: HTMLElement;
  private readonly readoutRange: HTMLElement;
  private readonly legend: HTMLElement;

  private signature = "";
  private places: PlaceView[] = [];
  private byKey = new Map<string, PlaceView>();

  private playerMark: SVGGElement | null = null;
  private playerArrow: SVGPathElement | null = null;
  private leader: SVGLineElement | null = null;
  private destRing: SVGCircleElement | null = null;
  private emptyNote: SVGTextElement | null = null;

  private focusKey: string | null = null;
  private destKey: string | null = null;
  /** Focus index for the roving-tabindex keyboard route over the pips. */
  private rovingIndex = 0;

  /**
   * Which way the player is pointing, radians, 0 = north and increasing toward east.
   *
   * `PlayerView` does not carry the player's facing — `state.player.facingRad` exists and the debug
   * API reports it, but the frozen contract does not — so it is derived from where the player has
   * been between two refreshes. Standing still keeps the last heading; a character who has not
   * moved since the panel opened gets a plain dot rather than an arrow pointing at a guess.
   */
  private headingRad: number | null = null;
  private lastPos: [number, number] | null = null;

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "map",
      title: "Map",
      key: "m",
      keyLabel: "Map",
      registry: ctx.registry,
      placement: { top: "88px", left: "50%", width: "684px" },
      // Opening starts from the nearest place, not from wherever the arrows were left last time.
      onOpen: () => {
        this.rovingIndex = 0;
        this.focusKey = null;
        this.refresh(true);
      },
    });

    this.body = document.createElement("div");
    this.body.className = "map";

    this.figure = document.createElement("div");
    this.figure.className = "map__figure";

    const readout = document.createElement("div");
    readout.className = "map__readout";
    readout.setAttribute("role", "status");
    readout.setAttribute("aria-live", "polite");
    this.readoutName = document.createElement("span");
    this.readoutName.className = "map__readout-name";
    this.readoutMeta = document.createElement("span");
    this.readoutMeta.className = "map__readout-meta u-caps u-dim";
    this.readoutRange = document.createElement("span");
    this.readoutRange.className = "map__readout-range u-numeric";
    readout.append(this.readoutName, this.readoutMeta, this.readoutRange);

    this.legend = document.createElement("div");
    this.legend.className = "map__legend";

    this.body.append(this.figure, readout, this.legend);
    this.frame.body.appendChild(this.body);

    // One delegated listener set for every pip, so a rebuild does not have to rebind 40 nodes.
    this.figure.addEventListener("pointerover", (event) => {
      const place = this.placeFromEvent(event.target);
      if (place) this.setFocus(place.key);
    });
    this.figure.addEventListener("pointerleave", () => this.setFocus(null));
    this.figure.addEventListener("focusin", (event) => {
      const place = this.placeFromEvent(event.target);
      if (place) {
        this.rovingIndex = Math.max(0, this.places.indexOf(place));
        this.syncRoving();
        this.setFocus(place.key);
      }
    });
    this.figure.addEventListener("click", (event) => {
      const place = this.placeFromEvent(event.target);
      if (place) this.walkTo(place);
    });
    this.figure.addEventListener("keydown", (event) => this.onKeyDown(event));
  }

  /** Discovered places only. Same gate an agent sees. */
  known(): ObservedEntity[] {
    return this.ctx.api.observe({ scope: "known", limit: 100 });
  }

  refresh(force = false): void {
    const player = this.ctx.api.getPlayer();
    const rows = this.known().filter((row) => SURFACE_REGIONS.has(row.regionId));
    const signature = rows.map((row) => row.id).sort().join(",");
    if (force || signature !== this.signature) {
      this.signature = signature;
      this.rebuild(rows);
    } else {
      // Distances move under the player's feet even when the set of places does not.
      for (const row of rows) {
        const place = this.byKey.get(LOCATION_INDEX.get(row.id)?.id ?? row.id);
        if (place) place.distance = row.distance;
      }
    }

    this.frame.setSubtitle(this.subtitle(rows, player.regionId));
    this.trackPlayer(player.position);
    this.syncDestination();
    this.paintReadout();
  }

  dispose(): void {
    this.frame.dispose();
  }

  // ------------------------------------------------------------------ build

  private subtitle(rows: ObservedEntity[], regionId: RegionId): string {
    const region = REGIONS.find((entry) => entry.id === regionId);
    const where = region ? `${region.name} · tier ${region.tier}` : regionId;
    const count = rows.length === 1 ? "1 place found" : `${rows.length} places found`;
    return `${count} · ${where}`;
  }

  /** An observed row is a place on the map; this is the only step that needs the content index. */
  private resolve(row: ObservedEntity): { locationId: string | null; def: LocationDef | null } {
    const direct = LOCATION_INDEX.get(row.id);
    if (direct) return { locationId: direct.id, def: direct.def };

    // A location with an entity standing on it is reported under the ENTITY's id — the Coldbrace
    // bank counter comes back as `coldbrace_bank`, not as its route node `bank_interior`. The two
    // share a position to the centimetre, so the node is found by where it is rather than by name.
    let best: LocationEntry | null = null;
    let bestDistance = 8;
    for (const entry of LOCATION_INDEX.values()) {
      if (entry.regionId !== row.regionId) continue;
      const dx = entry.def.position[0] - row.position[0];
      const dz = entry.def.position[1] - row.position[2];
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    return best ? { locationId: best.id, def: best.def } : { locationId: null, def: null };
  }

  private rebuild(rows: ObservedEntity[]): void {
    const places: PlaceView[] = [];
    const byKey = new Map<string, PlaceView>();

    for (const row of rows) {
      const { locationId, def } = this.resolve(row);
      const key = locationId ?? row.id;
      if (byKey.has(key)) continue;
      const place: PlaceView = {
        key,
        locationId,
        entityId: row.id,
        name: row.name,
        kind: def?.kind ?? DEFAULT_KIND,
        regionId: row.regionId,
        x: row.position[0],
        z: row.position[2],
        px: projX(row.position[0]),
        py: projY(row.position[2]),
        distance: row.distance,
        group: el("g"),
      };
      places.push(place);
      byKey.set(key, place);
    }

    this.places = places;
    this.byKey = byKey;
    if (this.focusKey && !byKey.has(this.focusKey)) this.focusKey = null;
    this.rovingIndex = Math.min(this.rovingIndex, Math.max(0, places.length - 1));

    const svg = el("svg", {
      class: "map__svg",
      viewBox: `0 0 ${round(VIEW_W)} ${round(VIEW_H)}`,
      role: "group",
      "aria-label": "World map",
    });
    svg.append(
      this.buildFrame(),
      this.buildRegions(),
      this.buildGrid(),
      this.buildRoads(),
      this.buildPlaces(),
      this.buildLabels(),
      this.buildOverlay(),
      this.buildScaleBar(),
    );

    this.figure.replaceChildren(svg);
    this.layoutLabels(svg);
    this.syncRoving();
    this.paintLegend(rows);
  }

  private buildFrame(): SVGGElement {
    const group = el("g", { class: "map__frame" });
    group.appendChild(el("rect", {
      class: "map__ground",
      x: PAD, y: PAD,
      width: WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX,
      height: WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ,
      rx: 3,
    }));
    return group;
  }

  /**
   * Region blocks, tinted from the render palette. `groundHigh` is the colour of exposed ground in
   * that region, which is what the player sees from a hilltop, so it is what the block is painted.
   */
  private buildRegions(): SVGGElement {
    const group = el("g", { class: "map__regions" });
    for (const region of REGIONS) {
      const palette = REGION_PALETTES[region.id];
      const minX = Math.max(region.bounds.min[0], WORLD_BOUNDS.minX);
      const maxX = Math.min(region.bounds.max[0], WORLD_BOUNDS.maxX);
      const minZ = Math.max(region.bounds.min[1], WORLD_BOUNDS.minZ);
      const maxZ = Math.min(region.bounds.max[1], WORLD_BOUNDS.maxZ);

      const block = el("g", { class: "map__region" });
      const rect = el("rect", {
        class: "map__region-fill",
        x: round(projX(minX)), y: round(projY(maxZ)),
        width: round(maxX - minX), height: round(maxZ - minZ),
      });
      rect.style.setProperty("--region-tint", hexColour(palette.groundHigh));
      rect.style.setProperty("--region-edge", hexColour(palette.accent));
      block.appendChild(rect);

      const label = el("text", {
        class: "map__region-name u-caps",
        x: round(projX((minX + maxX) / 2)),
        y: round(projY(maxZ) + 18),
        "text-anchor": "middle",
      });
      label.style.setProperty("--region-tint", hexColour(palette.accent));
      label.textContent = `${region.name} · T${region.tier}`;
      block.appendChild(label);
      group.appendChild(block);
    }
    return group;
  }

  /** A 100 m lattice. It is the cheapest way to make "to scale" visible rather than claimed. */
  private buildGrid(): SVGGElement {
    const group = el("g", { class: "map__grid" });
    for (let x = Math.ceil(WORLD_BOUNDS.minX / GRID_METRES) * GRID_METRES; x <= WORLD_BOUNDS.maxX; x += GRID_METRES) {
      group.appendChild(el("line", {
        x1: round(projX(x)), y1: PAD, x2: round(projX(x)), y2: round(VIEW_H - PAD),
      }));
    }
    for (let z = Math.ceil(WORLD_BOUNDS.minZ / GRID_METRES) * GRID_METRES; z <= WORLD_BOUNDS.maxZ; z += GRID_METRES) {
      group.appendChild(el("line", {
        x1: PAD, y1: round(projY(z)), x2: round(VIEW_W - PAD), y2: round(projY(z)),
      }));
    }
    return group;
  }

  /**
   * The route network, drawn only where both ends are known. Twelve pips scattered on a rectangle
   * read as noise; the same twelve joined by the roads that actually exist read as a route.
   */
  private buildRoads(): SVGGElement {
    const group = el("g", { class: "map__roads" });
    for (const [fromId, toId] of ROAD_EDGES) {
      const from = this.byKey.get(fromId);
      const to = this.byKey.get(toId);
      if (!from || !to) continue;
      const crossRegion = from.regionId !== to.regionId;
      group.appendChild(el("line", {
        class: crossRegion ? "map__road map__road--crossing" : "map__road",
        x1: round(from.px), y1: round(from.py), x2: round(to.px), y2: round(to.py),
      }));
    }
    return group;
  }

  private buildPlaces(): SVGGElement {
    const group = el("g", { class: "map__places" });
    for (const place of this.places) {
      const node = place.group;
      node.setAttribute("class", `map__place map__place--${place.kind}`);
      node.setAttribute("transform", `translate(${round(place.px)} ${round(place.py)})`);
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "-1");
      node.setAttribute("aria-label", `${place.name}, ${KIND_LABEL[place.kind]}, ${Math.round(place.distance)} metres. Walk there.`);
      node.dataset["place"] = place.key;
      node.replaceChildren();

      const title = el("title");
      title.textContent = `${place.name} — walk here`;
      node.appendChild(title);
      node.appendChild(this.pip(place.kind));
      node.appendChild(el("circle", { class: "map__hit", r: HIT_RADIUS }));
      group.appendChild(node);
    }
    return group;
  }

  /** One shape per kind. Shape carries the class of place, colour carries which skill it feeds. */
  private pip(kind: LocationKind): SVGElement {
    switch (kind) {
      case "settlement":
        return el("rect", { class: "map__pip", x: -5, y: -5, width: 10, height: 10, rx: 1.5 });
      case "bank":
        return el("path", { class: "map__pip", d: "M0 -6 L6 0 L0 6 L-6 0 Z" });
      case "gate":
        return el("path", { class: "map__pip", d: "M-5.4 4 L0 -5.4 L5.4 4 Z" });
      case "dungeon":
        return el("circle", { class: "map__pip map__pip--hollow", r: 5.2 });
      case "junction":
        return el("path", { class: "map__pip map__pip--stroke", d: "M-3.6 0 H3.6 M0 -3.6 V3.6" });
      default:
        return el("circle", { class: "map__pip", r: PIP_RADIUS });
    }
  }

  /**
   * The name of every place, parked on its pip and hidden. `layoutLabels` places them once the SVG
   * is in the document, because until it is there is nothing to measure them against.
   */
  private buildLabels(): SVGGElement {
    const group = el("g", { class: "map__labels" });
    for (const place of this.places) {
      const text = el("text", {
        class: "map__label",
        x: round(place.px), y: round(place.py), "font-size": LABEL_SIZE,
      });
      text.setAttribute("visibility", "hidden");
      text.dataset["label"] = place.key;
      text.textContent = place.name;
      group.appendChild(text);
    }
    return group;
  }

  /**
   * Names, placed greedily and dropped when they cannot fit.
   *
   * Every pip, every region name and every already-placed label is an occupied rectangle. Each name
   * tries twelve offsets around its pip and takes the first that hits nothing; a name with nowhere
   * to go is dropped rather than overlapped, because two names on top of each other are worth less
   * than one. Nothing is lost by dropping it: hover, focus, the readout and the tooltip all still
   * name the pip, and the important places are laid out first — towns and banks before junctions,
   * near before far — so what survives is the part of the map a player is navigating by.
   *
   * Widths are MEASURED, not guessed. An estimate that runs short lets two names overlap, which is
   * the one outcome this is here to prevent; `getComputedTextLength` costs one layout per rebuild,
   * and a rebuild only happens when the set of known places changes. The estimator is kept as the
   * fallback for the case where the panel is not displayed and every measurement comes back zero.
   */
  private layoutLabels(svg: SVGSVGElement): void {
    const occupied: Box[] = [];

    // Region names are already on the map and outrank everything.
    for (const name of svg.querySelectorAll<SVGTextElement>(".map__region-name")) {
      const box = name.getBBox();
      occupied.push({ x0: box.x - 3, y0: box.y - 2, x1: box.x + box.width + 3, y1: box.y + box.height + 2 });
    }
    for (const place of this.places) {
      occupied.push({
        x0: place.px - PIP_RADIUS - 2, y0: place.py - PIP_RADIUS - 2,
        x1: place.px + PIP_RADIUS + 2, y1: place.py + PIP_RADIUS + 2,
      });
    }

    const ordered = [...this.places].sort((a, b) => {
      const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
      return rank !== 0 ? rank : a.distance - b.distance;
    });

    // Right of the pip first, then left, then above and below, then further out on the diagonals.
    const offsets: readonly (readonly [number, number, string])[] = [
      [7, 4, "start"], [-7, 4, "end"], [0, -9, "middle"], [0, 15, "middle"],
      [7, -6, "start"], [-7, -6, "end"], [7, 14, "start"], [-7, 14, "end"],
      [13, -13, "start"], [-13, -13, "end"], [13, 17, "start"], [-13, 17, "end"],
    ];

    for (const place of ordered) {
      const text = svg.querySelector<SVGTextElement>(`[data-label="${CSS.escape(place.key)}"]`);
      if (!text) continue;
      const measured = text.getComputedTextLength();
      const width = (measured > 0 ? measured : textWidth(place.name, LABEL_SIZE)) + 3;

      let placed = false;
      for (const [dx, dy, anchor] of offsets) {
        const x = place.px + dx;
        const y = place.py + dy;
        const x0 = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
        const box: Box = { x0, y0: y - LABEL_SIZE * 0.82, x1: x0 + width, y1: y + LABEL_SIZE * 0.24 };
        if (box.x0 < 2 || box.y0 < 2 || box.x1 > VIEW_W - 2 || box.y1 > VIEW_H - 2) continue;
        if (occupied.some((other) => overlaps(box, other))) continue;

        occupied.push(box);
        text.setAttribute("x", String(round(x)));
        text.setAttribute("y", String(round(y)));
        text.setAttribute("text-anchor", anchor);
        text.setAttribute("visibility", "visible");
        placed = true;
        break;
      }
      if (!placed) text.remove();
    }
  }

  /** The moving parts: the leader line, the destination ring, the player, and the empty note. */
  private buildOverlay(): SVGGElement {
    const group = el("g", { class: "map__overlay" });

    this.leader = el("line", { class: "map__leader", x1: 0, y1: 0, x2: 0, y2: 0 });
    this.leader.setAttribute("visibility", "hidden");
    group.appendChild(this.leader);

    this.destRing = el("circle", { class: "map__dest", r: 9 });
    this.destRing.setAttribute("visibility", "hidden");
    group.appendChild(this.destRing);

    const mark = el("g", { class: "map__player" });
    mark.appendChild(el("circle", { class: "map__player-halo", r: 10 }));
    mark.appendChild(el("circle", { class: "map__player-dot", r: 2.8 }));
    const arrow = el("path", { class: "map__player-arrow", d: "M0 -10.5 L5.2 3 L0 0.2 L-5.2 3 Z" });
    arrow.setAttribute("visibility", "hidden");
    mark.appendChild(arrow);
    const here = el("title");
    here.textContent = "You are here";
    mark.appendChild(here);
    group.appendChild(mark);

    this.playerMark = mark;
    this.playerArrow = arrow;

    // A character who has found nothing still gets a world, a region layout and their own position.
    // The map is the thing that stops "nothing found yet" reading as "the map is broken".
    const note = el("text", {
      class: "map__empty", x: round(VIEW_W / 2), y: round(VIEW_H - 34), "text-anchor": "middle",
    });
    note.textContent = "Nowhere found yet — walk, and places appear here as you reach them.";
    note.setAttribute("visibility", this.places.length === 0 ? "visible" : "hidden");
    group.appendChild(note);
    this.emptyNote = note;

    return group;
  }

  private buildScaleBar(): SVGGElement {
    const group = el("g", { class: "map__scale" });
    const x = projX(WORLD_BOUNDS.minX) + 10;
    const y = projY(WORLD_BOUNDS.minZ) - 12;
    group.appendChild(el("line", { class: "map__scale-bar", x1: x, y1: y, x2: x + GRID_METRES, y2: y }));
    group.appendChild(el("line", { class: "map__scale-bar", x1: x, y1: y - 3, x2: x, y2: y + 3 }));
    group.appendChild(el("line", {
      class: "map__scale-bar", x1: x + GRID_METRES, y1: y - 3, x2: x + GRID_METRES, y2: y + 3,
    }));
    const label = el("text", { class: "map__scale-text", x: x + GRID_METRES / 2, y: y - 5, "text-anchor": "middle" });
    label.textContent = `${GRID_METRES} m`;
    group.appendChild(label);

    const north = el("text", { class: "map__north u-caps", x: round(VIEW_W - PAD - 6), y: PAD + 16, "text-anchor": "end" });
    north.textContent = "N ↑";
    group.appendChild(north);
    return group;
  }

  private paintLegend(rows: ObservedEntity[]): void {
    this.legend.replaceChildren();
    for (const region of REGIONS) {
      const found = rows.filter((row) => row.regionId === region.id).length;
      const chip = document.createElement("span");
      chip.className = "map__chip";
      const swatch = document.createElement("i");
      swatch.className = "map__swatch";
      swatch.style.setProperty("--region-tint", hexColour(REGION_PALETTES[region.id].groundHigh));
      const name = document.createElement("span");
      name.textContent = region.name;
      const count = document.createElement("span");
      count.className = "u-dim u-numeric";
      count.textContent = found > 0 ? `${found}` : "—";
      chip.append(swatch, name, count);
      this.legend.appendChild(chip);
    }

    const hint = document.createElement("span");
    hint.className = "map__hint u-dim";
    hint.textContent = this.places.length > 0 ? "Click a place to walk there" : "Nothing found yet";
    this.legend.appendChild(hint);
  }

  // ----------------------------------------------------------------- updates

  /** Position now, and the heading implied by where the player was on the last refresh. */
  private trackPlayer(position: Vec3): void {
    const x = position[0];
    const z = position[2];
    const previous = this.lastPos;
    if (previous) {
      const dx = x - previous[0];
      const dz = z - previous[1];
      if (dx * dx + dz * dz > 0.16) this.headingRad = Math.atan2(dx, dz);
    }
    this.lastPos = [x, z];

    const mark = this.playerMark;
    if (!mark) return;
    const heading = this.headingRad;
    const rotation = heading === null ? 0 : (heading * 180) / Math.PI;
    mark.setAttribute("transform", `translate(${round(projX(x))} ${round(projY(z))}) rotate(${round(rotation)})`);
    this.playerArrow?.setAttribute("visibility", heading === null ? "hidden" : "visible");
    this.emptyNote?.setAttribute("visibility", this.places.length === 0 ? "visible" : "hidden");
  }

  /** The ring stays on the place being walked to until the player is standing on it. */
  private syncDestination(): void {
    const ring = this.destRing;
    if (!ring) return;
    const target = this.destKey ? this.byKey.get(this.destKey) : undefined;
    if (!target || target.distance < 4) {
      this.destKey = null;
      ring.setAttribute("visibility", "hidden");
      return;
    }
    ring.setAttribute("cx", String(round(target.px)));
    ring.setAttribute("cy", String(round(target.py)));
    ring.setAttribute("visibility", "visible");
  }

  private paintReadout(): void {
    const place = this.focusKey ? this.byKey.get(this.focusKey) : undefined;
    const leader = this.leader;

    if (!place) {
      const nearest = this.places[0];
      this.readoutName.textContent = "You are here";
      this.readoutMeta.textContent = nearest ? `Nearest: ${nearest.name}` : "No places found";
      this.readoutRange.textContent = nearest ? `${Math.round(nearest.distance)} m` : "";
      leader?.setAttribute("visibility", "hidden");
      return;
    }

    const metres = Math.round(place.distance);
    const seconds = Math.round(place.distance / WALK_SPEED_MPS);
    const region = REGIONS.find((entry) => entry.id === place.regionId);
    this.readoutName.textContent = place.name;
    this.readoutMeta.textContent = `${KIND_LABEL[place.kind]} · ${region?.name ?? place.regionId}`;
    this.readoutRange.textContent = metres < 4 ? "you are here" : `${metres} m · ${seconds}s walk`;

    const from = this.lastPos;
    if (leader && from) {
      leader.setAttribute("x1", String(round(projX(from[0]))));
      leader.setAttribute("y1", String(round(projY(from[1]))));
      leader.setAttribute("x2", String(round(place.px)));
      leader.setAttribute("y2", String(round(place.py)));
      leader.setAttribute("visibility", "visible");
    }
  }

  // ------------------------------------------------------------ interaction

  private placeFromEvent(target: EventTarget | null): PlaceView | null {
    if (!(target instanceof Element)) return null;
    const node = target.closest("[data-place]");
    if (!(node instanceof SVGElement)) return null;
    const key = node.dataset["place"];
    if (!key) return null;
    return this.byKey.get(key) ?? null;
  }

  private setFocus(key: string | null): void {
    if (this.focusKey === key) return;
    if (this.focusKey) this.byKey.get(this.focusKey)?.group.classList.remove("is-focused");
    this.focusKey = key;
    if (key) this.byKey.get(key)?.group.classList.add("is-focused");
    this.paintReadout();
  }

  /**
   * The map's one action, and it goes through the same call an agent makes.
   *
   * Every authored location is a route node, so `moveTo({ locationId })` is the path for anything
   * that resolved to one. The handful of rows that arrive under an entity id and land on no node
   * fall back to `{ entityId }` — the same destination, resolved from the entity the row came from,
   * rather than a raw position the navmesh might not like.
   */
  private walkTo(place: PlaceView): void {
    const result = place.locationId
      ? this.ctx.api.moveTo({ locationId: place.locationId })
      : this.ctx.api.moveTo({ entityId: place.entityId });
    // `report` surfaces `error.message` through the same notice sink every other panel uses. It
    // returns a plain boolean rather than a type guard, so the narrowing is done here.
    if (!result.ok) {
      report(result);
      this.destKey = null;
      this.syncDestination();
      return;
    }
    this.destKey = place.key;
    this.syncDestination();
    const seconds = Math.max(1, Math.round(result.value.etaMs / 1000));
    notify(`Walking to ${place.name} — ${Math.round(result.value.pathLength)} m, ${seconds}s`, "info");
  }

  /**
   * Roving tabindex over the pips: the map is one tab stop, the arrows move between places.
   * Forty tab stops in a panel is not a keyboard route, it is a hostage situation.
   */
  private syncRoving(): void {
    this.places.forEach((place, index) => {
      place.group.setAttribute("tabindex", index === this.rovingIndex ? "0" : "-1");
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    const current = this.places[this.rovingIndex];
    if (!current) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.walkTo(current);
      return;
    }

    const direction =
      event.key === "ArrowRight" ? [1, 0]
      : event.key === "ArrowLeft" ? [-1, 0]
      : event.key === "ArrowUp" ? [0, -1]
      : event.key === "ArrowDown" ? [0, 1]
      : null;
    if (!direction) return;
    event.preventDefault();

    const [dirX, dirY] = direction as [number, number];
    let best: PlaceView | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const place of this.places) {
      if (place === current) continue;
      const dx = place.px - current.px;
      const dy = place.py - current.py;
      const along = dx * dirX + dy * dirY;
      if (along <= 1) continue;
      // Distance along the arrow, plus a heavy penalty for drifting sideways off it.
      const across = Math.abs(dx * dirY - dy * dirX);
      const score = along + across * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = place;
      }
    }
    if (!best) return;
    this.rovingIndex = this.places.indexOf(best);
    this.syncRoving();
    best.group.focus({ preventScroll: true });
    this.setFocus(best.key);
  }
}
