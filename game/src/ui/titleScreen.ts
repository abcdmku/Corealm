/**
 * The title screen, and the pause menu — the same screen, raised at two different moments.
 *
 * The world boots and runs behind it rather than after it. That is deliberate: the boot sequence
 * already loads the save, builds the terrain, the navmesh and 892 entities before the first frame,
 * and gating that behind a button would mean either a long stare at a static image or a second
 * loading path. So the game is ready underneath and this sits on top of it.
 *
 * "Continue" is therefore just a dismiss. "New Game" is the only button that does anything to the
 * world: it clears the save and rebuilds, through the same `resetWorld` the debug surface uses.
 *
 * SCAFFOLD. The interface below is frozen; the body is a placeholder for the title worker.
 */

export interface TitleScreenOptions {
  /** True when a save was found at boot, so "Continue" is meaningful. */
  hasSave(): boolean;
  /** Clears the save and rebuilds the world. Wired by the root to `resetWorld`. */
  onNewGame(): void;
  /** Opens the settings panel. */
  onSettings(): void;
  /** Dismisses. Called on Continue and on Escape. */
  onClose(): void;
}

export class TitleScreen {
  private readonly root: HTMLElement;

  constructor(private readonly options: TitleScreenOptions) {
    const root = document.createElement("section");
    root.className = "title";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Corealm");
    this.root = root;
    this.render();
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.render();
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(): void {
    this.root.replaceChildren();

    const mark = document.createElement("h1");
    mark.className = "title__mark";
    mark.textContent = "COREALM";

    const actions = document.createElement("div");
    actions.className = "title__actions";

    const resume = document.createElement("button");
    resume.type = "button";
    resume.className = "btn btn--primary";
    resume.textContent = this.options.hasSave() ? "Continue" : "Begin";
    resume.dataset["autofocus"] = "true";
    resume.addEventListener("click", () => this.options.onClose());

    const fresh = document.createElement("button");
    fresh.type = "button";
    fresh.className = "btn";
    fresh.textContent = "New game";
    fresh.addEventListener("click", () => this.options.onNewGame());

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "btn";
    settings.textContent = "Settings";
    settings.addEventListener("click", () => this.options.onSettings());

    actions.append(resume, fresh, settings);
    this.root.append(mark, actions);
  }

  dispose(): void {
    this.root.remove();
  }
}
