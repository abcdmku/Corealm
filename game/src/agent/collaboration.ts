/**
 * The collaboration tools: how an agent negotiates with the player.
 *
 * `corealm_session` is the control channel — connect, state the objective, ask for control, hand
 * it back, stop. `corealm_propose` puts a plan in front of the player without touching anything;
 * the guidance layer (`app/guidance.ts`) draws its current step in the world and walks the cursor
 * forward as the player reaches each place. `corealm_route` previews the walk the character would
 * take and marks the destination, which is how assist mode says "go this way" while the player
 * keeps the keys.
 *
 * None of these need play mode: they are the way to ask for it.
 */
import type { AgentMode, MoveTarget, Vec3 } from "../contracts.js";
import type { ProposalStep } from "./session.js";
import { TOOL_SPECS } from "./catalogue.js";
import { ROUTE_COLOUR, ROUTE_OVERLAY_ID, targetFields } from "./guide.js";
import {
  asNumber, asString, defineTool, failure, isError, requireApproval, unwrap,
  type ToolDef, type ToolDeps,
} from "./toolkit.js";

/** The one-of-three target an agent names, or null when it named none. */
function targetOf(args: Record<string, unknown>): MoveTarget | null {
  if (typeof args.entityId === "string") return { entityId: args.entityId };
  if (typeof args.locationId === "string") return { locationId: args.locationId };
  if (Array.isArray(args.position)) return { position: args.position as unknown as Vec3 };
  return null;
}

export function createCollaborationTools({ api, session }: ToolDeps): ToolDef[] {
  return [
    defineTool(TOOL_SPECS.corealm_session, async (args, context) => {
      const op = asString(args.op);
      switch (op) {
        case "read":
          return session.read();
        case "connect":
          return session.connect(asString(args.agentName, "Agent"));
        case "set_objective":
          if (typeof args.objective !== "string") return failure("INVALID_ARGUMENT", "objective is required for set_objective");
          session.setObjective(args.objective, "agent");
          return session.read();
        case "set_activity":
          session.setActivity(typeof args.activity === "string" ? args.activity : null);
          return session.read();
        case "set_mode": {
          if (typeof args.mode !== "string") return failure("INVALID_ARGUMENT", "mode is required for set_mode");
          return session.setMode(args.mode as AgentMode, "agent");
        }
        case "request_control": {
          if (session.read().controlOwner === "agent" && session.read().mode === "play") {
            return { status: "granted", session: session.read() };
          }
          const reason = typeof args.reason === "string" && args.reason.trim()
            ? args.reason
            : typeof args.objective === "string" && args.objective.trim()
              ? `Let the agent play: ${args.objective}`
              : "Let the agent control the character";
          if (typeof args.objective === "string") session.setObjective(args.objective, "agent");
          const refused = await requireApproval(session, "control", reason, asNumber(args.timeoutMs, 25_000), context.signal);
          if (!refused) return { status: "granted", session: session.read() };
          // A pending or denied request is an answer, not a failure: no `error` key, so an agent
          // that checks for one sees a status to act on.
          const { error: _code, ...detail } = refused;
          return { status: _code === "NOT_PERMITTED" ? "denied" : "pending", ...detail, session: session.read() };
        }
        case "wait_approval": {
          if (typeof args.requestId !== "string") return failure("INVALID_ARGUMENT", "requestId is required for wait_approval");
          const settled = await session.waitForApproval(args.requestId, asNumber(args.timeoutMs, 25_000), context.signal);
          if (!settled) return failure("NOT_FOUND", `No approval request ${args.requestId} is known. It may have expired; ask again.`);
          return { status: settled.status === "approved" ? "granted" : settled.status, request: settled, session: session.read() };
        }
        case "release_control":
          return session.releaseControl();
        case "cancel_task":
          return { cancelled: session.cancelTask("cancelled by the agent", "agent"), session: session.read() };
        case "stop":
          return session.stop("agent");
        case "disconnect":
          return session.disconnect("agent");
        default:
          return failure("INVALID_ARGUMENT", `Unknown op ${op}`);
      }
    }),

    defineTool(TOOL_SPECS.corealm_propose, (args) => {
      if (args.clear === true) {
        const had = session.read().proposal !== null;
        session.clearProposal();
        return { cleared: had };
      }

      if (args.advance === true) {
        const before = session.read().proposal;
        if (!before) return failure("NOT_FOUND", "There is no plan to advance. Propose one first.");
        if (before.currentStep === null) return { advanced: false, finished: true, currentStep: null, step: null };
        const after = session.advanceProposal("agent");
        const current = after && after.currentStep !== null ? after.steps[after.currentStep] : null;
        return {
          advanced: true,
          completed: before.currentStep,
          currentStep: after?.currentStep ?? null,
          step: current?.text ?? null,
          finished: current === null,
        };
      }

      if (typeof args.summary !== "string") return failure("INVALID_ARGUMENT", "summary is required unless clear or advance is true");
      const rawSteps = Array.isArray(args.steps) ? (args.steps as Record<string, unknown>[]) : [];
      const steps: ProposalStep[] = [];
      const unreachable: string[] = [];
      for (const [index, raw] of rawSteps.entries()) {
        const named = targetOf(raw);
        let target: MoveTarget | undefined = named ?? undefined;
        if (named) {
          // Checked now rather than discovered by the player: an id that resolves to nothing is
          // reported back and the step falls to manual completion, so the guide never waits on an
          // arrival at a place that does not exist. A place that exists but has no walkable route
          // keeps its target — the pin still says where, only the ground line is missing.
          const plan = api.planPath(named);
          if (!plan.ok) {
            unreachable.push(`${index + 1}: ${plan.error.message}`);
            if (plan.error.code === "NOT_FOUND") target = undefined;
          }
        }
        steps.push({
          text: asString(raw.text),
          ...(typeof raw.tool === "string" ? { tool: raw.tool } : {}),
          ...(target ? { target } : {}),
          done: target && raw.done !== "manual" ? "arrive" : "manual",
          ...(typeof raw.arriveRadius === "number" ? { arriveRadius: raw.arriveRadius } : {}),
          status: "pending",
        });
      }
      session.setProposal({ summary: args.summary, steps, proposedAtMs: api.getTime().simMs });

      // Markers only where the mode allows drawing. Guide mode gets the panel text alone, and the
      // result says so rather than drawing nothing silently.
      const mode = session.read().mode;
      const targeted = steps.filter((step) => step.target).length;
      return {
        proposed: true,
        steps: steps.length,
        currentStep: steps.length > 0 ? 0 : null,
        drawn: mode === "guide" ? 0 : targeted,
        ...(unreachable.length ? { unreachable } : {}),
        mode,
        ...(mode === "guide"
          ? { note: "Guide mode: shown in the panel, not drawn in the world. Arrival still advances the plan." }
          : {}),
      };
    }),

    defineTool(TOOL_SPECS.corealm_route, (args) => {
      if (args.clear === true) {
        api.overlay("clear", { id: ROUTE_OVERLAY_ID, kind: "marker" });
        return { cleared: true };
      }
      const target = targetOf(args);
      if (!target) return failure("INVALID_ARGUMENT", "Give one of entityId, locationId, or position");
      const plan = unwrap(api.planPath(target));
      if (isError(plan)) return plan;
      const mode = session.read().mode;
      const wantDraw = args.draw !== false;
      if (wantDraw && mode === "guide" && args.draw === true) {
        return failure("NOT_PERMITTED", "Guide mode cannot draw. Ask for assist mode with corealm_session {op:\"set_mode\", mode:\"assist\"}, or pass draw: false.");
      }
      let drawn = false;
      if (wantDraw && mode !== "guide") {
        // One marker carries the whole preview: the pin, the label, and the ground route that
        // re-plans from the player as they walk and takes itself down when they arrive.
        const marker = api.overlay("set", {
          id: ROUTE_OVERLAY_ID,
          kind: "marker",
          colour: ROUTE_COLOUR,
          ...targetFields(target),
          ...(typeof args.label === "string" ? { text: args.label } : {}),
        });
        drawn = marker.ok;
      }
      return {
        ...plan,
        drawn,
        pointCount: plan.points.length,
        ...(drawn ? { overlayId: ROUTE_OVERLAY_ID } : {}),
      };
    }),
  ];
}
