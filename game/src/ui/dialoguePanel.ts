/**
 * The conversation window.
 *
 * Phase 1 shipped 12 NPCs, 82 dialogue nodes, and no way for a human to see any of it. Every one of
 * the ten quests is started or finished through dialogue — including `cold_iron`, the tutorial — so
 * until this panel exists a human player can gather, craft, fight, bank, shop and reach level 10 in
 * all eleven skills without being able to begin a single quest. An agent could talk the whole time,
 * through `corealm_dialogue`. This is the missing half of that surface.
 *
 * The root opens and closes it from the `dialogue.opened` / `dialogue.closed` events, so a
 * conversation started by a mouse click, by the context menu, or by an agent all raise the same
 * window. It never opens itself.
 *
 * SCAFFOLD. The interface below is frozen; the body is a placeholder for the dialogue worker.
 */
import type { DialogueView } from "../contracts.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { PanelFrame } from "./panels.js";

export class DialoguePanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly body: HTMLElement;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "dialogue",
      title: "Conversation",
      // No key. You do not open a conversation with a keystroke; you talk to somebody.
      registry: ctx.registry,
      placement: { bottom: "104px", left: "50%", width: "560px", maxHeight: "44vh" },
      onClose: () => this.endConversation(),
    });

    this.body = document.createElement("div");
    this.body.className = "dialogue";
    this.frame.body.appendChild(this.body);
  }

  /** The open conversation, or null when there is none. */
  view(): DialogueView | null {
    const result = this.ctx.api.dialogue("state");
    return result.ok ? result.value : null;
  }

  refresh(force = false): void {
    const view = this.view();
    if (!view) {
      if (this.frame.isOpen()) this.frame.close();
      return;
    }

    const signature = `${view.npcId}|${view.text}|${view.options.map((o) => `${o.id}:${o.enabled}`).join(",")}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.frame.setSubtitle(view.speaker);
    this.body.replaceChildren();

    const text = document.createElement("p");
    text.className = "dialogue__text";
    text.textContent = view.text;
    this.body.appendChild(text);

    for (const option of view.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn dialogue__option";
      button.textContent = option.text;
      button.disabled = !option.enabled;
      if (option.disabledReason) button.title = option.disabledReason;
      button.addEventListener("click", () => this.choose(option.id));
      this.body.appendChild(button);
    }
  }

  /** Called by the root when a conversation opens. */
  openFor(): void {
    this.refresh(true);
    this.frame.open();
  }

  private choose(optionId: string): void {
    const result = this.ctx.api.dialogue("choose", optionId);
    if (!result.ok) return;
    this.refresh(true);
    this.ctx.refresh();
  }

  /** Ends the conversation in the game when the window is dismissed, so state cannot drift. */
  private endConversation(): void {
    if (this.view()) this.ctx.api.dialogue("end");
  }

  dispose(): void {
    this.frame.dispose();
  }
}
