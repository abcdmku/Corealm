/** Setup controls for the transient empty world. Play still goes through the normal game input. */
import type {
  FeatureLabApi,
  FeatureLabState,
  FeatureLabTargetKind,
  SkillId,
  SpellId,
} from "../contracts.js";
import { notify } from "./contextMenu.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame } from "./panels.js";

function option(value: string, label: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function labelled(label: string, control: HTMLElement): HTMLLabelElement {
  const root = document.createElement("label");
  root.className = "lab-field";
  const text = document.createElement("span");
  text.className = "u-caps u-dim";
  text.textContent = label;
  root.append(text, control);
  return root;
}

export class FeatureLabPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly kind = document.createElement("select");
  private readonly target = document.createElement("select");
  private readonly skill = document.createElement("select");
  private readonly level = document.createElement("input");
  private readonly spell = document.createElement("select");
  private readonly status = document.createElement("p");
  private targetKind: FeatureLabTargetKind | null = null;
  private signature = "";

  constructor(private readonly ctx: UiContext, private readonly lab: FeatureLabApi) {
    this.frame = new PanelFrame({
      id: "feature-lab",
      title: "Feature lab",
      key: "l",
      keyLabel: "Lab",
      registry: ctx.registry,
      placement: { right: "10px", bottom: "48px", width: "250px", maxHeight: "calc(100vh - 110px)" },
      group: "side",
      onOpen: () => this.refresh(true),
    });

    const intro = document.createElement("p");
    intro.className = "empty-state lab-intro";
    intro.textContent = "The production engine is running on an empty flat world. Click ground to run; click a creature to target and fight it.";

    this.kind.append(option("creature", "Creature"), option("npc", "NPC"));
    this.kind.addEventListener("change", () => this.populateTargets(this.kind.value as FeatureLabTargetKind));

    const spawn = this.button("Spawn target", () => this.lab.spawnTarget(
      this.kind.value as FeatureLabTargetKind,
      this.target.value,
    ));

    const catalog = this.lab.getCatalog();
    this.skill.append(...catalog.skills.map((row) => option(row.id, row.label)));
    this.skill.value = "magic";
    this.skill.addEventListener("change", () => this.refresh(true));
    this.level.type = "number";
    this.level.min = "1";
    this.level.max = "99";
    this.level.step = "1";
    const setLevel = this.button("Set level", () => this.lab.setLevel(
      this.skill.value as SkillId,
      Number(this.level.value),
    ));

    this.spell.append(...catalog.spells.map((row) => option(row.id, row.label)));
    const setSpell = this.button("Use spell", () => this.lab.setSpell(this.spell.value as SpellId));
    const actions = document.createElement("div");
    actions.className = "lab-actions";
    actions.append(
      this.button("Attack selected", () => this.lab.perform("attack")),
      this.button("Cast selected", () => this.lab.perform("cast")),
      this.button("Reset player", () => this.lab.perform("reset-player")),
    );

    const gear = document.createElement("p");
    gear.className = "empty-state lab-gear-note";
    gear.textContent = "Open Worn, then click any equipment slot to choose every production item valid for it.";

    const structures = document.createElement("a");
    structures.className = "btn lab-structures-link";
    structures.href = "./structure-preview.html";
    structures.textContent = "Open structure preview";

    this.status.className = "lab-status u-numeric";
    this.frame.body.append(
      intro,
      labelled("Target kind", this.kind),
      labelled("Target", this.target),
      spawn,
      labelled("Skill", this.skill),
      labelled("Level", this.level),
      setLevel,
      labelled("Spell", this.spell),
      setSpell,
      actions,
      gear,
      structures,
      this.status,
    );
    this.populateTargets("creature");
  }

  refresh(force = false): void {
    const state = this.lab.getState();
    const skillId = this.skill.value as SkillId;
    const signature = this.signatureFor(state, skillId);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.level.value = String(state.levels[skillId] ?? 1);
    if (state.spellId) this.spell.value = state.spellId;
    if (state.target) {
      this.kind.value = state.target.kind;
      this.populateTargets(state.target.kind, state.target.presetId);
    }
    const target = state.target
      ? `${state.target.name}: ${state.target.health ?? "-"}/${state.target.maxHealth ?? "-"}`
      : "No target";
    const position = state.playerPosition.map((value) => value.toFixed(1)).join(", ");
    this.status.textContent = `${target} · player ${position} · ${state.movement.mode}`;
    this.frame.setSubtitle("real engine · transient world");
  }

  dispose(): void {
    this.frame.dispose();
  }

  private populateTargets(kind: FeatureLabTargetKind, selected?: string): void {
    if (this.targetKind !== kind) {
      this.targetKind = kind;
      const rows = this.lab.getCatalog().targets[kind];
      this.target.replaceChildren(...rows.map((row) => option(row.id, row.label)));
    }
    if (selected && [...this.target.options].some((row) => row.value === selected)) {
      this.target.value = selected;
    }
  }

  private button(label: string, action: () => unknown | Promise<unknown>): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.addEventListener("click", () => {
      button.disabled = true;
      Promise.resolve()
        .then(action)
        .then(() => {
          this.ctx.refresh();
          this.refresh(true);
        })
        .catch((cause: unknown) => notify(cause instanceof Error ? cause.message : String(cause), "error"))
        .finally(() => { button.disabled = false; });
    });
    return button;
  }

  private signatureFor(state: FeatureLabState, skillId: SkillId): string {
    return [
      state.target?.entityId ?? "-",
      state.target?.state ?? "-",
      state.target?.health ?? "-",
      state.levels[skillId],
      state.spellId ?? "-",
      state.movement.mode,
      ...state.playerPosition,
    ].join("|");
  }
}
