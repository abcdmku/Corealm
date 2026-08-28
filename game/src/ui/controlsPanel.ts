/**
 * Every key the game answers to, read from the live registry.
 *
 * `KeyBindingRegistry.list()` has carried the comment "Shown by a future controls panel" since
 * round 0. This is that panel. It reads the registry rather than a hand-written table, so a binding
 * that is added, moved or lost shows up here without anybody remembering to update a list — which
 * is the only way a controls screen stays true.
 *
 * SCAFFOLD. The interface below is frozen; the body is a placeholder for the controls worker.
 */
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame } from "./panels.js";

export class ControlsPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly body: HTMLElement;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "controls",
      title: "Controls",
      key: "h",
      keyLabel: "Controls",
      registry: ctx.registry,
      placement: { top: "96px", right: "24px", width: "340px" },
      onOpen: () => this.refresh(true),
    });

    this.body = document.createElement("div");
    this.body.className = "controls";
    this.frame.body.appendChild(this.body);
  }

  refresh(force = false): void {
    const bindings = this.ctx.registry.list();
    const signature = bindings.map((b) => `${b.id}:${b.keys.join("+")}`).join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.body.replaceChildren();
    for (const binding of bindings) {
      const row = document.createElement("div");
      row.className = "controls__row";
      const keys = document.createElement("span");
      keys.className = "controls__keys";
      keys.textContent = binding.keys.map((k) => k.toUpperCase()).join(" / ");
      const label = document.createElement("span");
      label.className = "controls__label";
      label.textContent = binding.label;
      row.append(keys, label);
      this.body.appendChild(row);
    }
  }

  dispose(): void {
    this.frame.dispose();
  }
}
