/**
 * What happened when you died, and where your things are.
 *
 * Death already works and the gate proves it: the pack empties into a recovery cache, the player
 * respawns at their bound point, and the cache can be walked back to and looted. The only thing a
 * player was ever told about any of that was the word "dead" on the health bar and a toast that
 * scrolled away. Respawn is instant and automatic, so this is not a gate the player has to click
 * through — it is a report, dismissed with Escape or the button, and it is the only place the
 * cache's location and expiry are ever stated.
 *
 * Not a `PanelFrame`: it covers the screen, it has no key, and it is raised by an event rather than
 * by the player.
 *
 * SCAFFOLD. The interface below is frozen; the body is a placeholder for the death worker.
 */
import type { UiContext } from "./panels.js";

/** Read straight off the `player.died` event payload. Every field is already in it. */
export interface DeathDetail {
  /** Where the player fell. */
  position: readonly [number, number, number];
  regionId: string;
  /** Where they got back up. */
  respawnPosition: readonly [number, number, number];
  respawnPointId: string;
  /** The recovery cache holding what they were carrying, or null if they carried nothing. */
  cacheId: string | null;
  itemsLost: number;
  /** Sim-clock milliseconds at which the cache is destroyed, or null. */
  expiresAtMs: number | null;
}

export class DeathScreen {
  private readonly root: HTMLElement;
  private detail: DeathDetail | null = null;

  constructor(private readonly ctx: UiContext) {
    const root = document.createElement("section");
    root.className = "death";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "You died");
    this.root = root;
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Raised by the root from `player.died`. */
  show(detail: DeathDetail): void {
    this.detail = detail;
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.detail = null;
  }

  /** Called on the HUD cadence while open, for the cache expiry countdown. */
  update(): void {
    if (this.isOpen()) this.render();
  }

  private render(): void {
    const detail = this.detail;
    if (!detail) return;
    this.root.replaceChildren();

    const title = document.createElement("h2");
    title.className = "death__title";
    title.textContent = "You died";

    const body = document.createElement("p");
    body.className = "death__body";
    body.textContent = detail.cacheId
      ? `${detail.itemsLost} items are in a cache where you fell.`
      : "You were carrying nothing.";

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "btn btn--primary";
    dismiss.textContent = "Continue";
    dismiss.dataset["autofocus"] = "true";
    dismiss.addEventListener("click", () => this.hide());

    this.root.append(title, body, dismiss);
    void this.ctx;
  }

  dispose(): void {
    this.root.remove();
  }
}
