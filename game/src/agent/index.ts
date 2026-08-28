/**
 * The public agent entry point: `window.corealm`.
 *
 * Always present, in every browser, regardless of WebMCP support. This is what Playwright
 * scenarios, the internal AI, and any external driver actually call — and it runs the identical
 * handlers the WebMCP surface exposes, so testing here genuinely tests the agent path.
 *
 * FROZEN. Only the root edits this file.
 */
import type { GameApi } from "../contracts.js";
import { createTools, toolTable, type ToolDef } from "./tools.js";
import { registerWebMcp, type WebMcpRegistration } from "./webmcp.js";

export interface CorealmAgentApi {
  /** Every tool, with its schema. Start here when writing an agent. */
  listTools(): { name: string; description: string; inputSchema: Record<string, unknown> }[];
  /** Invoke a tool by name. Never throws; failures come back as `{ error, message }`. */
  call(name: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Which model-context container the WebMCP adapter bound to, and whether it was native. */
  webmcp(): { binding: string; toolCount: number; native: boolean };
  /** Build and content versions, for an agent caching knowledge across sessions. */
  version(): { build: string; contracts: string; content: string };
}

export interface AgentSurfaceOptions {
  version: { build: string; contracts: string; content: string };
}

export function installAgentSurface(api: GameApi, options: AgentSurfaceOptions): {
  surface: CorealmAgentApi;
  registration: WebMcpRegistration;
  tools: ToolDef[];
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
} {
  const tools = createTools(api);
  const table = toolTable(api);
  const registration = registerWebMcp(api);

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const tool = table.get(name);
    if (!tool) {
      return { error: "NOT_FOUND", message: `Unknown tool "${name}". Call listTools() for the ${tools.length} available.` };
    }
    try {
      return await tool.execute(args ?? {});
    } catch (cause) {
      // The canonical API returns Results rather than throwing, so this is a real defect. Surface
      // it as data: an agent can act on a structured error, not on a rejected promise.
      return { error: "UNAVAILABLE", message: cause instanceof Error ? cause.message : String(cause) };
    }
  };

  const surface: CorealmAgentApi = {
    listTools: () => tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    call: (name, args) => call(name, args ?? {}),
    webmcp: () => ({
      binding: registration.binding,
      toolCount: registration.toolCount,
      native: registration.native,
    }),
    version: () => options.version,
  };

  (window as unknown as { corealm?: { agent: CorealmAgentApi } }).corealm = { agent: surface };

  return { surface, registration, tools, call };
}
