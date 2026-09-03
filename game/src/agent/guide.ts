/**
 * The guide: what a proposed plan looks like in the world.
 *
 * Pure. `collaboration.ts` (the tool runtime) and `app/guidance.ts` (the presentation layer) both
 * import this, so the overlay ids, the colours and the rule for which steps are drawn live in one
 * place and neither chunk has to pull the other in.
 *
 * The current step is a marker: a pin, a ground route from the player, a numbered label. Steps
 * still to come are numbered labels alone, dimmer, so the player sees the shape of the plan
 * without a forest of pins. Done steps are not drawn at all — that is the whole point.
 */
import type { MoveTarget, OverlaySpec } from "../contracts.js";
import type { Proposal, ProposalStep } from "./session.js";

export const GUIDE_STEP_OVERLAY_ID = "guide_step";
export const GUIDE_UPCOMING_PREFIX = "guide_next_";
export const ROUTE_OVERLAY_ID = "agent_route";
export const QUEST_OVERLAY_ID = "quest_objective";

/**
 * Brass, the HUD accent: the guide and the quest marker. Saturated on purpose — the ribbon is an
 * unlit surface under ACES, and the HUD's paler `#ffd98a` reads as white on the ground.
 */
export const GUIDE_COLOUR = "#e6b64e";
/** The same brass, dimmed, for steps that are not yet current. */
export const GUIDE_UPCOMING_COLOUR = "#9c8c66";
/** The cool assist-mode accent, for a route the agent previews. Same reasoning as the brass. */
export const ROUTE_COLOUR = "#6ea8ff";

export function isGuideOverlayId(id: string): boolean {
  return id === GUIDE_STEP_OVERLAY_ID || id.startsWith(GUIDE_UPCOMING_PREFIX);
}

/** "3. Mine six Grithe ore" — numbered from one, because the panel numbers from one. */
export function stepLabel(index: number, step: Pick<ProposalStep, "text">): string {
  const text = step.text.trim();
  return `${index + 1}. ${text.length > 44 ? `${text.slice(0, 43)}…` : text}`;
}

/** The overlay fields that name a target, from a `MoveTarget`. */
export function targetFields(target: MoveTarget): Pick<OverlaySpec, "entityId" | "locationId" | "position"> {
  if ("entityId" in target) return { entityId: target.entityId };
  if ("locationId" in target) return { locationId: target.locationId };
  return { position: target.position };
}

/** Every overlay a plan wants drawn right now. Empty for no plan or a finished one. */
export function guideOverlaySpecs(proposal: Proposal | null): OverlaySpec[] {
  if (!proposal || proposal.currentStep === null) return [];
  const specs: OverlaySpec[] = [];
  for (const [index, step] of proposal.steps.entries()) {
    if (!step.target) continue;
    if (index === proposal.currentStep) {
      specs.push({
        id: GUIDE_STEP_OVERLAY_ID,
        kind: "marker",
        ...targetFields(step.target),
        text: stepLabel(index, step),
        colour: GUIDE_COLOUR,
        // A step that completes by arrival takes its marker down on arrival. A manual step keeps
        // the pin (the player is meant to do something there) and only the route goes.
        persist: step.done !== "arrive",
        ...(step.arriveRadius !== undefined ? { arriveRadius: step.arriveRadius } : {}),
      });
    } else if (step.status === "pending") {
      specs.push({
        id: `${GUIDE_UPCOMING_PREFIX}${index}`,
        kind: "label",
        ...targetFields(step.target),
        text: stepLabel(index, step),
        colour: GUIDE_UPCOMING_COLOUR,
      });
    }
  }
  return specs;
}
