/**
 * The vocabulary every tool file shares: the `ToolDef` shape, schema helpers, result helpers, and
 * the approval wait. No game imports and no tool imports, so `tools.ts` can assemble the tool
 * files and the tool files can import this without a cycle.
 */
import type { GameApi, GameErrorCode, Result } from "../contracts.js";
import type { AgentSession, SessionError, ToolAccess } from "./session.js";

/** JSON Schema fragment. Kept loose on purpose: WebMCP passes these through untouched. */
export type JsonSchema = Record<string, unknown>;

export interface ToolAnnotations {
  readOnlyHint: boolean;
  /** Results may quote NPC dialogue and item text authored in the game, never a third party. */
  untrustedContentHint: boolean;
}

export interface ToolContext {
  /** Fires when the caller cancels the call. Bounded operations stop at their next checkpoint. */
  signal?: AbortSignal;
  /**
   * Skips the mode and control gate. Only `__gameDebug.callTool` sets this, for the harness's
   * click-parity probes; nothing reachable from WebMCP or `window.corealm.agent` can.
   */
  bypassSession?: boolean;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  access: ToolAccess;
  annotations: ToolAnnotations;
  execute(args: Record<string, unknown>, context?: ToolContext): Promise<unknown> | unknown;
}

/** Everything a tool factory needs. */
export interface ToolDeps {
  api: GameApi;
  session: AgentSession;
  version: { build: string; contracts: string; content: string };
}

/** A tool's static half, before `execute`. */
export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  access: ToolAccess;
  /**
   * Only for a tool whose `op` argument mixes reads and writes (dialogue, bank, shop). Such a tool
   * is `read` access so its read op works in guide mode, gates its write ops on `act` itself, and
   * must tell WebMCP it is NOT read-only. Everything else derives the hint from `access`.
   */
  mutates?: boolean;
}

export type ToolExecute = (args: Record<string, unknown>, context: ToolContext) => Promise<unknown> | unknown;

export function defineTool(spec: ToolSpec, execute: ToolExecute): ToolDef {
  const { mutates, ...rest } = spec;
  return {
    ...rest,
    annotations: { readOnlyHint: spec.access === "read" && !mutates, untrustedContentHint: false },
    execute: (args, context = {}) => execute(args, context),
  };
}

export function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export const STR = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: "string", description, ...extra });
export const NUM = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: "number", description, ...extra });
export const INT = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: "integer", description, ...extra });
export const BOOL = (description: string): JsonSchema => ({ type: "boolean", description });
export const ENUM = (values: readonly (string | null)[], description: string): JsonSchema => ({
  type: values.includes(null) ? ["string", "null"] : "string",
  enum: [...values],
  description,
});
export const VEC3: JsonSchema = {
  type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x, y, z] in metres",
};

/** Unwraps a Result for an agent: success returns the value, failure returns a structured error. */
export function unwrap<T>(result: Result<T>): T | SessionError {
  if (result.ok) return result.value;
  return { error: result.error.code, message: result.error.message, ...(result.error.entityId ? { entityId: result.error.entityId } : {}) };
}

export function isError(value: unknown): value is SessionError {
  return Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>).error === "string");
}

export function failure(error: GameErrorCode, message: string, extra: Record<string, unknown> = {}): SessionError {
  return { error, message, ...extra };
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Blocks a world action on the player's say-so. Returns null when the action may proceed, or the
 * refusal to hand back. Waits `timeoutMs` for an answer so the common case is one call.
 */
export async function requireApproval(
  session: AgentSession,
  kind: "control" | "trade",
  description: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SessionError | null> {
  const request = session.requestApproval(kind, description);
  const settled = request.status === "pending" ? await session.waitForApproval(request.id, timeoutMs, signal) : request;
  if (settled?.status === "approved") return null;
  if (settled?.status === "denied") {
    return failure("NOT_PERMITTED", `The player declined: ${description}`, { requestId: request.id });
  }
  return failure("APPROVAL_REQUIRED", `Waiting for the player to approve: ${description}. Call corealm_session {op:"wait_approval", requestId} and retry once it is approved.`, { requestId: request.id, status: settled?.status ?? "expired" });
}
