/**
 * The pinned-quest tracker: one quest's card floating over the world, so the player can follow an
 * objective without holding the journal open.
 *
 * Pin/unpin comes from the Quests panel through `UiContext.pinQuest`. The card defaults to the
 * left middle of the screen, drags by its header, and collapses to just the header. Pin choice,
 * dragged position and collapsed state persist in localStorage — they are client preferences,
 * like the settings store, not save data.
 *
 * Repaints follow the panels' signature rule: `update()` runs at the panel cadence and touches
 * the DOM only when the quest's stage, objective or status actually changed.
 */
import type { GameApi, QuestId, QuestSummary } from "../contracts.js";

const STORE_KEY = "corealm.questTracker.v1";

interface TrackerState {
  questId: QuestId | null;
  /** Dragged position, viewport px. Null means the default left-middle placement. */
  x: number | null;
  y: number | null;
  collapsed: boolean;
}

function loadState(): TrackerState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TrackerState>;
      return {
        questId: typeof parsed.questId === "string" ? parsed.questId : null,
        x: typeof parsed.x === "number" ? parsed.x : null,
        y: typeof parsed.y === "number" ? parsed.y : null,
        collapsed: parsed.collapsed === true,
      };
    }
  } catch {
    // Private mode or a corrupt entry: the tracker still works, it just forgets between sessions.
  }
  return { questId: null, x: null, y: null, collapsed: false };
}

export class QuestTracker {
  private readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly objectiveEl: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly collapseButton: HTMLButtonElement;
  private state: TrackerState = loadState();
  private signature = "";

  constructor(private readonly api: GameApi) {
    const root = document.createElement("section");
    root.className = "quest-tracker";
    root.hidden = true;
    root.setAttribute("aria-label", "Tracked quest");

    const header = document.createElement("header");
    header.className = "quest-tracker__header";

    const name = document.createElement("span");
    name.className = "quest-tracker__name u-truncate";

    const stage = document.createElement("span");
    stage.className = "quest-tracker__stage u-numeric";

    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "quest-tracker__btn";
    collapse.addEventListener("click", () => this.setCollapsed(!this.state.collapsed));

    const unpin = document.createElement("button");
    unpin.type = "button";
    unpin.className = "quest-tracker__btn";
    unpin.textContent = "×";
    unpin.title = "Unpin quest";
    unpin.setAttribute("aria-label", "Unpin quest");
    unpin.addEventListener("click", () => this.pin(null));

    header.append(name, stage, collapse, unpin);

    const body = document.createElement("div");
    body.className = "quest-tracker__body";

    const objective = document.createElement("p");
    objective.className = "quest-tracker__objective";

    const bar = document.createElement("div");
    bar.className = "bar bar--thin quest-tracker__progress";
    const fill = document.createElement("div");
    fill.className = "bar__fill";
    bar.appendChild(fill);

    body.append(objective, bar);
    root.append(header, body);

    // Drag by the header, exactly the movable-panel recipe: explicit left/top from the first
    // move, transform killed so the default translateY(-50%) centring cannot double-count.
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      const rect = root.getBoundingClientRect();
      const grabX = event.clientX - rect.left;
      const grabY = event.clientY - rect.top;
      const onMove = (move: PointerEvent) => {
        const left = Math.min(Math.max(move.clientX - grabX, 0), Math.max(0, window.innerWidth - rect.width));
        const top = Math.min(Math.max(move.clientY - grabY, 0), Math.max(0, window.innerHeight - 24));
        this.state.x = Math.round(left);
        this.state.y = Math.round(top);
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
    });

    this.root = root;
    this.nameEl = name;
    this.stageEl = stage;
    this.body = body;
    this.objectiveEl = objective;
    this.fill = fill;
    this.collapseButton = collapse;
    this.applyPosition();
    this.applyCollapsed();
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
    this.update(true);
  }

  pin(questId: QuestId | null): void {
    if (this.state.questId === questId) questId = null; // pinning the pinned quest unpins it
    this.state.questId = questId;
    this.save();
    this.update(true);
  }

  pinnedId(): QuestId | null {
    return this.state.questId;
  }

  update(force = false): void {
    const id = this.state.questId;
    if (!id) {
      if (!this.root.hidden) this.root.hidden = true;
      this.signature = "";
      return;
    }
    const quest = this.api.getQuests().find((entry) => entry.id === id);
    if (!quest) {
      // The pinned quest no longer exists (new game, content change): let go quietly.
      this.state.questId = null;
      this.save();
      this.root.hidden = true;
      return;
    }

    const signature = `${quest.id}:${quest.status}:${quest.stage}:${quest.currentObjective ?? ""}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.root.hidden = false;
    this.root.classList.toggle("is-complete", quest.status === "complete");
    this.nameEl.textContent = quest.name;
    this.nameEl.title = quest.name;
    this.stageEl.textContent = quest.status === "active"
      ? `${quest.stage + 1}/${quest.stageCount}`
      : quest.status === "complete" ? "done" : "—";
    this.objectiveEl.textContent = this.objectiveText(quest);
    this.fill.style.width = quest.status === "complete"
      ? "100%"
      : `${Math.round((quest.stage / Math.max(1, quest.stageCount)) * 100)}%`;
  }

  dispose(): void {
    this.root.remove();
  }

  private objectiveText(quest: QuestSummary): string {
    if (quest.status === "complete") return "Complete.";
    if (quest.status === "unstarted") return "Not started yet.";
    return quest.currentObjective ?? "";
  }

  private setCollapsed(collapsed: boolean): void {
    this.state.collapsed = collapsed;
    this.applyCollapsed();
    this.save();
  }

  private applyCollapsed(): void {
    this.body.hidden = this.state.collapsed;
    this.root.classList.toggle("is-collapsed", this.state.collapsed);
    this.collapseButton.textContent = this.state.collapsed ? "▸" : "▾";
    this.collapseButton.title = this.state.collapsed ? "Expand" : "Collapse";
    this.collapseButton.setAttribute("aria-label", this.state.collapsed ? "Expand tracker" : "Collapse tracker");
    this.collapseButton.setAttribute("aria-expanded", this.state.collapsed ? "false" : "true");
  }

  private applyPosition(): void {
    if (this.state.x === null || this.state.y === null) return;
    this.root.classList.add("is-moved");
    this.root.style.left = `${this.state.x}px`;
    this.root.style.top = `${this.state.y}px`;
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
    } catch {
      // Same tolerance as loadState: preferences that cannot persist are still live preferences.
    }
  }
}
