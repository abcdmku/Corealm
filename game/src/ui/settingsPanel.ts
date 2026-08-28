/**
 * The settings screen, over `SettingsStore`.
 *
 * Every control here has to change something visible. See the note in `ui/settings.ts`.
 *
 * SCAFFOLD. The interface below is frozen; the body is a placeholder for the settings worker.
 */
import type { SettingsStore } from "./settings.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame } from "./panels.js";

export class SettingsPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly body: HTMLElement;

  constructor(private readonly ctx: UiContext, private readonly settings: SettingsStore) {
    this.frame = new PanelFrame({
      id: "settings",
      title: "Settings",
      registry: ctx.registry,
      placement: { top: "120px", left: "50%", width: "380px" },
      onOpen: () => this.refresh(true),
    });

    this.body = document.createElement("div");
    this.body.className = "settings";
    this.frame.body.appendChild(this.body);
  }

  refresh(_force = false): void {
    const current = this.settings.get();
    this.body.replaceChildren();
    for (const [key, value] of Object.entries(current)) {
      const row = document.createElement("div");
      row.className = "settings__row";
      row.textContent = `${key}: ${String(value)}`;
      this.body.appendChild(row);
    }
  }

  dispose(): void {
    this.frame.dispose();
  }
}
