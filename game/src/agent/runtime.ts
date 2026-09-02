/**
 * The agent runtime: the handlers behind the catalogue.
 *
 * Loaded by `agent/index.ts` on the first tool call, not at boot. Everything a call needs that
 * the descriptors do not — validation, the session gate, the bounded operations, the context
 * builder, the manual text — lives behind this import, which keeps the boot chunk to the
 * descriptors and the session. One instance per page; `createRuntime` is called once.
 */
import type { GameApi } from "../contracts.js";
import type { AgentSession } from "./session.js";
import { createTools, invokeTool, toolTable } from "./tools.js";
import type { ToolContext, ToolDef } from "./toolkit.js";

export interface AgentRuntime {
  tools: ToolDef[];
  invoke(name: string, args: Record<string, unknown> | undefined, context?: ToolContext): Promise<unknown>;
}

export function createRuntime(
  api: GameApi,
  session: AgentSession,
  version: { build: string; contracts: string; content: string },
): AgentRuntime {
  const tools = createTools(api, session, version);
  const table = toolTable(tools);
  return {
    tools,
    invoke(name, args, context = {}) {
      const tool = table.get(name);
      if (!tool) {
        return Promise.resolve({ error: "NOT_FOUND", message: `Unknown tool "${name}". Call listTools() for the ${tools.length} available.` });
      }
      return invokeTool(tool, session, args, context);
    },
  };
}
