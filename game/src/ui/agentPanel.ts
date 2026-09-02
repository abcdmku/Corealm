/**
 * The agent panel: the player's window onto, and hand on, the collaboration session.
 *
 * Shows who is connected, the mode, the objective, what the agent is doing, and any pending
 * request. Offers Pause/Resume, Stop, Take control, and — when the agent has asked — Allow/Deny.
 * The player can also hand the character over without being asked ("Let agent play").
 *
 * Repaints on the session's own notifications and at the panel cadence, with the panels' signature
 * rule: the DOM is touched only when something the player can see changed. Position and collapse
 * persist as client preferences, like the quest tracker.
 */
import type { AgentSession, AgentSessionView } from "../agent/session.js";

const STORE_KEY = "corealm.agentPanel.v1";

interface PanelPrefs {
  x: number | null;
  y: number | null;
  collapsed: boolean;
}

function loadPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
      return {
        x: typeof parsed.x === "number" ? parsed.x : null,
        y: typeof parsed.y === "number" ? parsed.y : null,
        collapsed: parsed.collapsed === true,
      };
    }
  } catch {
    // Private mode or a corrupt entry: the panel still works, it just forgets between sessions.
  }
  return { x: null, y: null, collapsed: false };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  // A HUD click must not fall through to the world as a walk order.
  node.addEventListener("pointerdown", (event) => event.stopPropagation());
  node.addEventListener("click", onClick);
  return node;
}

export interface AgentPanelDeps {
  session: AgentSession;
  /** Sim clock, for elapsed-time readouts. */
  now(): number;
}

export class AgentPanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly objectiveEl: HTMLElement;
  private readonly activityEl: HTMLElement;
  private readonly controlEl: HTMLElement;
  private readonly proposalRow: HTMLElement;
  private readonly proposalSummary: HTMLElement;
  private readonly proposalSteps: HTMLOListElement;
  private readonly approvalBox: HTMLElement;
  private readonly approvalText: HTMLElement;
  private readonly alwaysAllow: HTMLInputElement;
  private readonly alwaysAllowLabel: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly takeButton: HTMLButtonElement;
  private readonly grantButton: HTMLButtonElement;
  private readonly footEl: HTMLElement;
  private readonly collapseButton: HTMLButtonElement;
  private readonly unsubscribe: () => void;
  private prefs: PanelPrefs = loadPrefs();
  private signature = "";

  constructor(private readonly deps: AgentPanelDeps) {
    const root = el("section", "agent-panel");
    root.setAttribute("aria-label", "AI agent");

    const header = el("header", "agent-panel__header");
    const dot = el("span", "agent-panel__dot");
    const name = el("span", "agent-panel__name u-truncate");
    const mode = el("span", "agent-panel__mode");
    const collapse = button("▾", "agent-panel__btn", () => this.setCollapsed(!this.prefs.collapsed));
    header.append(dot, name, mode, collapse);

    const body = el("div", "agent-panel__body");

    const objectiveRow = el("div", "agent-panel__row");
    const objective = el("span", "agent-panel__value");
    objectiveRow.append(el("span", "agent-panel__key", "Goal"), objective);

    const activityRow = el("div", "agent-panel__row");
    const activity = el("span", "agent-panel__value");
    activityRow.append(el("span", "agent-panel__key", "Doing"), activity);

    const controlRow = el("div", "agent-panel__row");
    const control = el("span", "agent-panel__value");
    controlRow.append(el("span", "agent-panel__key", "Control"), control);

    const proposalRow = el("div", "agent-panel__row");
    const proposalCell = el("div", "");
    const proposalSummary = el("div", "agent-panel__value");
    const proposalSteps = el("ol", "agent-panel__steps");
    proposalCell.append(proposalSummary, proposalSteps);
    proposalRow.append(el("span", "agent-panel__key", "Plan"), proposalCell);
    proposalRow.hidden = true;

    const approvalBox = el("div", "agent-panel__approval");
    approvalBox.hidden = true;
    const approvalTitle = el("div", "agent-panel__approval-title", "The agent asks");
    const approvalText = el("div", "agent-panel__approval-text");
    const approvalActions = el("div", "agent-panel__actions");
    const allow = button("Allow", "btn btn--primary", () => this.answer(true));
    const deny = button("Deny", "btn", () => this.answer(false));
    approvalActions.append(allow, deny);
    const always = el("label", "agent-panel__always");
    const alwaysInput = document.createElement("input");
    alwaysInput.type = "checkbox";
    alwaysInput.addEventListener("pointerdown", (event) => event.stopPropagation());
    alwaysInput.addEventListener("change", () => this.setAlways(alwaysInput.checked));
    const alwaysLabel = el("span", "", "Always allow");
    always.append(alwaysInput, alwaysLabel);
    approvalBox.append(approvalTitle, approvalText, approvalActions, always);

    const actions = el("div", "agent-panel__actions");
    const pause = button("Pause", "btn", () => this.togglePause());
    const stop = button("Stop", "btn btn--danger", () => this.deps.session.stop("player"));
    const take = button("Take control", "btn", () => this.deps.session.takeControl("player"));
    const grant = button("Let agent play", "btn btn--primary", () => this.deps.session.grantControl("player"));
    actions.append(pause, stop, take, grant);

    const foot = el("div", "agent-panel__foot");

    body.append(objectiveRow, activityRow, controlRow, proposalRow, approvalBox, actions, foot);
    root.append(header, body);

    // Drag by the header, the movable-panel recipe: explicit left/top from the first move.
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      const rect = root.getBoundingClientRect();
      const grabX = event.clientX - rect.left;
      const grabY = event.clientY - rect.top;
      const onMove = (move: PointerEvent) => {
        const left = Math.min(Math.max(move.clientX - grabX, 0), Math.max(0, window.innerWidth - rect.width));
        const top = Math.min(Math.max(move.clientY - grabY, 0), Math.max(0, window.innerHeight - 24));
        this.prefs.x = Math.round(left);
        this.prefs.y = Math.round(top);
        this.applyPosition();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        this.save();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      event.preventDefault();
      event.stopPropagation();
    });

    this.root = root;
    this.body = body;
    this.nameEl = name;
    this.modeEl = mode;
    this.objectiveEl = objective;
    this.activityEl = activity;
    this.controlEl = control;
    this.proposalRow = proposalRow;
    this.proposalSummary = proposalSummary;
    this.proposalSteps = proposalSteps;
    this.approvalBox = approvalBox;
    this.approvalText = approvalText;
    this.alwaysAllow = alwaysInput;
    this.alwaysAllowLabel = alwaysLabel;
    this.pauseButton = pause;
    this.stopButton = stop;
    this.takeButton = take;
    this.grantButton = grant;
    this.footEl = foot;
    this.collapseButton = collapse;
    this.applyPosition();
    this.applyCollapsed();
    this.unsubscribe = deps.session.subscribe(() => this.update(true));
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
    this.update(true);
  }

  update(force = false): void {
    const session = this.deps.session;
    session.expireStaleApproval();
    const view = session.read();
    const signature = [
      view.agentName, view.mode, view.controlOwner, view.paused, view.objective, view.activity,
      view.task?.id, view.proposal?.proposedAtMs, view.pendingApproval?.id, view.autoApprove.control,
      view.autoApprove.trade, view.webmcp.binding, view.toolCalls,
    ].join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.paint(view);
  }

  dispose(): void {
    this.unsubscribe();
    this.root.remove();
  }

  private paint(view: AgentSessionView): void {
    const root = this.root;
    root.classList.toggle("mode-guide", view.mode === "guide");
    root.classList.toggle("mode-assist", view.mode === "assist");
    root.classList.toggle("mode-play", view.mode === "play");
    root.classList.toggle("is-controlling", view.controlOwner === "agent");
    root.classList.toggle("is-paused", view.paused);

    this.nameEl.textContent = view.connected ? view.agentName ?? "Agent" : "No agent";
    this.nameEl.title = view.connected ? `${view.agentName} · ${view.toolCalls} tool calls` : "No agent has connected yet";
    this.modeEl.textContent = view.paused ? "paused" : view.mode;

    this.objectiveEl.textContent = view.objective ?? "—";
    this.objectiveEl.classList.toggle("is-dim", !view.objective);
    this.activityEl.textContent = view.paused
      ? "Paused"
      : view.activity ?? (view.connected ? "Idle" : "Waiting for an agent");
    this.activityEl.classList.toggle("is-live", Boolean(view.task) && !view.paused);
    this.activityEl.classList.toggle("is-dim", !view.activity || view.paused);
    this.controlEl.textContent = view.controlOwner === "agent" ? "Agent is playing" : "You";
    this.controlEl.classList.toggle("is-live", view.controlOwner === "agent");

    const proposal = view.proposal;
    this.proposalRow.hidden = !proposal;
    if (proposal) {
      this.proposalSummary.textContent = proposal.summary;
      this.proposalSteps.replaceChildren(...proposal.steps.map((step) => {
        const item = document.createElement("li");
        item.textContent = step.text;
        return item;
      }));
    }

    const approval = view.pendingApproval;
    this.approvalBox.hidden = !approval;
    if (approval) {
      this.approvalText.textContent = approval.description;
      this.alwaysAllow.checked = view.autoApprove[approval.kind];
      this.alwaysAllowLabel.textContent = approval.kind === "control" ? "Always let this agent play" : "Always allow trades";
    }

    this.pauseButton.textContent = view.paused ? "Resume" : "Pause";
    this.pauseButton.hidden = !view.connected;
    this.stopButton.hidden = !view.connected || (view.controlOwner !== "agent" && !view.task);
    this.takeButton.hidden = view.controlOwner !== "agent";
    this.grantButton.hidden = !view.connected || view.controlOwner === "agent" || Boolean(approval);

    const webmcp = view.webmcp;
    const status = webmcp.native
      ? `WebMCP · ${webmcp.toolCount} tools`
      : webmcp.binding === "polyfill"
        ? `WebMCP test shim · ${webmcp.toolCount} tools`
        : "WebMCP not available in this browser";
    this.footEl.textContent = status;
    this.footEl.title = webmcp.native || webmcp.binding === "polyfill"
      ? `Bound to ${webmcp.binding}`
      : "Open Corealm in a WebMCP-capable browser (Chrome with chrome://flags/#enable-webmcp-testing, or an agent's in-app browser) to let an AI play alongside you. window.corealm.agent is always available.";
    this.footEl.classList.toggle("is-warning", !webmcp.native && webmcp.binding !== "polyfill");
  }

  private answer(approved: boolean): void {
    const request = this.deps.session.read().pendingApproval;
    if (!request) return;
    this.deps.session.answerApproval(request.id, approved, "player");
  }

  private setAlways(enabled: boolean): void {
    const request = this.deps.session.read().pendingApproval;
    this.deps.session.setAutoApprove(request ? request.kind : "control", enabled);
  }

  private togglePause(): void {
    const session = this.deps.session;
    if (session.read().paused) session.resume("player");
    else session.pause("player");
  }

  private setCollapsed(collapsed: boolean): void {
    this.prefs.collapsed = collapsed;
    this.applyCollapsed();
    this.save();
  }

  private applyCollapsed(): void {
    this.body.hidden = this.prefs.collapsed;
    this.root.classList.toggle("is-collapsed", this.prefs.collapsed);
    this.collapseButton.textContent = this.prefs.collapsed ? "▸" : "▾";
    this.collapseButton.title = this.prefs.collapsed ? "Expand" : "Collapse";
    this.collapseButton.setAttribute("aria-expanded", this.prefs.collapsed ? "false" : "true");
  }

  private applyPosition(): void {
    if (this.prefs.x === null || this.prefs.y === null) return;
    this.root.classList.add("is-moved");
    this.root.style.left = `${this.prefs.x}px`;
    this.root.style.top = `${this.prefs.y}px`;
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.prefs));
    } catch {
      // Same tolerance as loadPrefs.
    }
  }
}
