/**
 * The collaboration tools: how an agent negotiates with the player.
 *
 * `corealm_session` is the control channel — connect, state the objective, ask for control, hand
 * it back, stop. `corealm_propose` puts a plan in front of the player without touching anything.
 * `corealm_route` previews the walk the character would take and draws it, which is how assist
 * mode says "go this way" while the player keeps the keys.
 *
 * None of these need play mode: they are the way to ask for it.
 */
import type { AgentMode, MoveTarget, Vec3 } from "../contracts.js";
import type { ProposalStep } from "./session.js";
import { TOOL_SPECS } from "./catalogue.js";
import {
  asNumber, asString, defineTool, failure, isError, requireApproval, unwrap,
  type ToolDef, type ToolDeps,
} from "./toolkit.js";

const PROPOSAL_OVERLAY_PREFIX = "proposal_";
const ROUTE_OVERLAY_ID = "agent_route";

export function createCollaborationTools({ api, session }: ToolDeps): ToolDef[] {
  const clearProposalOverlays = (count: number): void => {
    for (let index = 0; index < count; index += 1) {
      api.overlay("clear", { id: `${PROPOSAL_OVERLAY_PREFIX}${index}`, kind: "marker" });
    }
  };

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
      const previous = session.read().proposal;
      if (previous) clearProposalOverlays(previous.steps.length);
      if (args.clear === true) {
        session.setProposal(null);
        return { cleared: true };
      }
      if (typeof args.summary !== "string") return failure("INVALID_ARGUMENT", "summary is required unless clear is true");
      const rawSteps = Array.isArray(args.steps) ? (args.steps as Record<string, unknown>[]) : [];
      const steps: ProposalStep[] = rawSteps.map((step) => ({
        text: asString(step.text),
        ...(typeof step.tool === "string" ? { tool: step.tool } : {}),
        ...(typeof step.entityId === "string" ? { args: { entityId: step.entityId } } : {}),
        ...(typeof step.locationId === "string" ? { args: { locationId: step.locationId } } : {}),
      }));
      session.setProposal({ summary: args.summary, steps, proposedAtMs: api.getTime().simMs });

      // Markers only where the mode allows drawing. Guide mode gets the panel text alone, and the
      // result says so rather than drawing nothing silently.
      const mayDraw = session.read().mode !== "guide";
      let drawn = 0;
      const undrawn: string[] = [];
      if (mayDraw) {
        for (const [index, step] of rawSteps.entries()) {
          const target = typeof step.entityId === "string"
            ? { entityId: step.entityId }
            : typeof step.locationId === "string" ? { locationId: step.locationId } : null;
          if (!target) continue;
          const result = api.overlay("set", {
            id: `${PROPOSAL_OVERLAY_PREFIX}${index}`,
            kind: "label",
            text: `${index + 1}. ${asString(step.text).slice(0, 40)}`,
            colour: "#ffd98a",
            ...target,
          });
          if (result.ok) drawn += 1;
          else undrawn.push(`${index + 1}: ${result.error.message}`);
        }
      }
      return { proposed: true, steps: steps.length, drawn, ...(undrawn.length ? { undrawn } : {}), mode: session.read().mode, ...(mayDraw ? {} : { note: "Guide mode: shown in the panel, not drawn in the world." }) };
    }),

    defineTool(TOOL_SPECS.corealm_route, (args) => {
      const target: MoveTarget | null = typeof args.entityId === "string"
        ? { entityId: args.entityId }
        : typeof args.locationId === "string"
          ? { locationId: args.locationId }
          : Array.isArray(args.position) ? { position: args.position as unknown as Vec3 } : null;
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
        const line = api.overlay("set", { id: ROUTE_OVERLAY_ID, kind: "path", path: plan.points, colour: "#8ad4ff" });
        const end = api.overlay("set", {
          id: `${ROUTE_OVERLAY_ID}_end`, kind: "marker", colour: "#8ad4ff",
          ...("position" in target ? { position: target.position } : target),
        });
        if (typeof args.label === "string") {
          api.overlay("set", { id: `${ROUTE_OVERLAY_ID}_label`, kind: "label", text: args.label, ...("position" in target ? { position: target.position } : target) });
        }
        drawn = line.ok && end.ok;
      }
      return { ...plan, drawn, pointCount: plan.points.length };
    }),
  ];
}
