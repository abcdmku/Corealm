/**
 * The settings screen, over `SettingsStore`.
 *
 * Every control here has to change something visible. See the note in `ui/settings.ts`. Each row
 * therefore says what it does to the picture rather than naming the flag again: "the sun stops
 * casting" is checkable by looking out of the window, "Shadows: off" is not.
 *
 * The DOM is built once and only its states are synced afterwards. `refresh()` is called on the
 * panel cadence — every 220 ms while the panel is open — and rebuilding the rows on that beat
 * would blow away the focus ring mid-Tab and drop a switch the player was holding Enter on.
 *
 * The panel also subscribes to the store, so a setting changed anywhere else (the debug surface,
 * a second panel, "reset") shows up here without the panel being reopened.
 */
import type { SettingsStore, UiSettings } from "./settings.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame } from "./panels.js";
import { notify } from "./contextMenu.js";

/** The three booleans, in the order they are shown. */
interface ToggleSpec {
  key: "shadows" | "damageNumbers" | "invertCameraY";
  group: string;
  label: string;
  /** What changes on screen. Not a restatement of the label. */
  hint: string;
  /** Word shown on the switch when it is on, then when it is off. */
  states: readonly [string, string];
}

const TOGGLES: readonly ToggleSpec[] = [
  {
    key: "shadows",
    group: "Picture",
    label: "Shadows",
    hint: "The sun casts. Turn it off first on a machine that is struggling — nothing else here buys as many frames.",
    states: ["On", "Off"],
  },
  {
    key: "damageNumbers",
    group: "Picture",
    label: "Damage numbers",
    hint: "Hits and misses float over whoever took them. Off means they are never drawn, not drawn and hidden.",
    states: ["On", "Off"],
  },
  {
    key: "invertCameraY",
    group: "Camera",
    label: "Invert vertical look",
    hint: "Drag down to raise the camera instead of lowering it. Applies to every way the camera turns.",
    states: ["Inverted", "Normal"],
  },
];

const DENSITY: readonly { value: UiSettings["uiScale"]; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "compact", label: "Compact" },
];

export class SettingsPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly body: HTMLElement;
  private readonly switches = new Map<ToggleSpec["key"], HTMLButtonElement>();
  private readonly stateLabels = new Map<ToggleSpec["key"], HTMLElement>();
  private readonly densityButtons = new Map<UiSettings["uiScale"], HTMLButtonElement>();
  private readonly unsubscribe: () => void;

  constructor(ctx: UiContext, private readonly settings: SettingsStore) {
    this.frame = new PanelFrame({
      id: "settings",
      title: "Settings",
      registry: ctx.registry,
      placement: { top: "120px", left: "50%", width: "380px" },
      onOpen: () => this.refresh(true),
    });
    this.frame.setSubtitle("Kept on this device");

    this.body = document.createElement("div");
    this.body.className = "settings";
    this.frame.body.appendChild(this.body);

    this.build();
    // Fires immediately, so the controls start in sync with the stored value.
    this.unsubscribe = this.settings.subscribe(() => this.sync());
  }

  /** States only. The rows themselves never move. */
  refresh(_force = false): void {
    this.sync();
  }

  dispose(): void {
    this.unsubscribe();
    this.frame.dispose();
  }

  // --------------------------------------------------------------- building

  private build(): void {
    this.body.replaceChildren();

    let openGroup: HTMLElement | null = null;
    let openGroupName = "";
    for (const spec of TOGGLES) {
      if (spec.group !== openGroupName) {
        openGroupName = spec.group;
        openGroup = this.group(spec.group);
      }
      openGroup?.appendChild(this.toggleRow(spec));
    }

    this.group("Interface").appendChild(this.densityRow());

    const note = document.createElement("p");
    note.className = "settings__note";
    note.textContent = "These live on this device, not in your save. Starting a new game leaves them alone.";

    const footer = document.createElement("div");
    footer.className = "settings__footer";

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "btn btn--ghost";
    reset.textContent = "Reset to defaults";
    reset.addEventListener("click", () => {
      this.settings.reset();
      notify("Settings reset to defaults", "info");
    });

    footer.append(note, reset);
    this.body.appendChild(footer);
  }

  private group(title: string): HTMLElement {
    const section = document.createElement("section");
    section.className = "settings__group";

    const heading = document.createElement("h3");
    heading.className = "settings__group-title u-caps u-dim";
    heading.textContent = title;

    section.appendChild(heading);
    this.body.appendChild(section);
    return section;
  }

  private toggleRow(spec: ToggleSpec): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings__row";

    const text = document.createElement("div");
    text.className = "settings__text";

    const label = document.createElement("span");
    label.className = "settings__label";
    label.textContent = spec.label;

    const hint = document.createElement("span");
    hint.className = "settings__hint";
    hint.textContent = spec.hint;

    text.append(label, hint);

    // role="switch" rather than a checkbox: it is a control that acts at once, not a form field
    // that waits for a save button, and the two states are named on it.
    const control = document.createElement("button");
    control.type = "button";
    control.className = "switch";
    control.setAttribute("role", "switch");
    control.setAttribute("aria-label", spec.label);

    const track = document.createElement("span");
    track.className = "switch__track";
    const knob = document.createElement("span");
    knob.className = "switch__knob";
    track.appendChild(knob);

    const state = document.createElement("span");
    state.className = "switch__state";

    control.append(track, state);
    control.addEventListener("click", () => {
      this.settings.set({ [spec.key]: !this.settings.get()[spec.key] } as Partial<UiSettings>);
    });

    this.switches.set(spec.key, control);
    this.stateLabels.set(spec.key, state);

    row.append(text, control);
    return row;
  }

  private densityRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings__row";

    const text = document.createElement("div");
    text.className = "settings__text";

    const label = document.createElement("span");
    label.className = "settings__label";
    label.textContent = "Density";

    const hint = document.createElement("span");
    hint.className = "settings__hint";
    hint.textContent = "Compact shrinks the type and the padding across the HUD and every panel, and narrows the side panels.";

    text.append(label, hint);

    const group = document.createElement("div");
    group.className = "seg";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Density");

    for (const option of DENSITY) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost seg__btn";
      button.textContent = option.label;
      button.setAttribute("role", "radio");
      button.addEventListener("click", () => { this.settings.set({ uiScale: option.value }); });
      this.densityButtons.set(option.value, button);
      group.appendChild(button);
    }

    row.append(text, group);
    return row;
  }

  // ----------------------------------------------------------------- state

  private sync(): void {
    const current = this.settings.get();

    for (const spec of TOGGLES) {
      const on = current[spec.key];
      const control = this.switches.get(spec.key);
      if (control) {
        control.setAttribute("aria-checked", on ? "true" : "false");
        control.classList.toggle("is-on", on);
      }
      const state = this.stateLabels.get(spec.key);
      const word = on ? spec.states[0] : spec.states[1];
      if (state && state.textContent !== word) state.textContent = word;
    }

    for (const [value, button] of this.densityButtons) {
      const on = current.uiScale === value;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", on ? "true" : "false");
    }
  }
}
