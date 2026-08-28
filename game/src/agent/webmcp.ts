/**
 * WebMCP adapter.
 *
 * A translation layer, never a second implementation. Every tool here calls the same handler in
 * `agent/tools.ts` that `window.corealm.agent` and `__gameDebug.callTool` call.
 *
 * Spec research is in `runs/corealm/webmcp-research.md`. Summary of what shaped this file:
 *
 *  - The current draft puts the container on `document.modelContext` with
 *    `registerTool(descriptor, { signal })`, `getTools()` and `executeTool(tool, args)`. Earlier and
 *    vendor-flavoured material uses `navigator.modelContext` with a batch `provideContext({tools})`.
 *    Both spellings exist in the wild, so both are attempted.
 *  - The API is secure-context only. `http://localhost` and `http://127.0.0.1` count, so the dev
 *    server is fine.
 *  - This repo's Chromium exposes NEITHER spelling, with or without feature flags — the origin
 *    trial needs a token bound to a real origin. So a local polyfill is installed when neither
 *    exists, which keeps the registration path exercised and testable rather than dead code.
 *
 * Return shape is MCP-style content blocks. Errors come back as `isError` plus a structured payload,
 * because the draft does not pin error signalling down and a caller should get a machine-readable
 * reason either way.
 */
import type { GameApi } from "../contracts.js";
import { createTools, type ToolDef } from "./tools.js";

interface McpContent { type: "text"; text: string }
interface McpResult { content: McpContent[]; isError?: boolean; structuredContent?: unknown }

interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(params: Record<string, unknown>): Promise<McpResult>;
}

interface ModelContextLike {
  registerTool?: (tool: McpToolDescriptor, options?: { signal?: AbortSignal }) => Promise<void> | void;
  provideContext?: (context: { tools: McpToolDescriptor[] }) => Promise<void> | void;
  unregisterTool?: (name: string) => Promise<void> | void;
  getTools?: () => Promise<McpToolDescriptor[]> | McpToolDescriptor[];
  executeTool?: (tool: McpToolDescriptor | string, args: Record<string, unknown>) => Promise<McpResult>;
}

export type WebMcpBinding = "document.modelContext" | "navigator.modelContext" | "polyfill";

export interface WebMcpRegistration {
  binding: WebMcpBinding;
  toolCount: number;
  /** True when a real browser implementation accepted the registration. */
  native: boolean;
  dispose(): void;
}

/** Wraps a canonical tool result in MCP content blocks. */
function toMcpResult(value: unknown): McpResult {
  const isError = Boolean(value && typeof value === "object" && "error" in (value as Record<string, unknown>));
  return {
    content: [{ type: "text", text: JSON.stringify(value ?? null) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

function toDescriptor(tool: ToolDef): McpToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(params: Record<string, unknown>): Promise<McpResult> {
      try {
        return toMcpResult(await tool.execute(params ?? {}));
      } catch (cause) {
        // Nothing in the canonical API throws, so reaching here means a genuine defect rather than
        // a gameplay refusal. Report it as an error result instead of rejecting, because a rejected
        // tool call gives the agent nothing to reason about.
        return {
          content: [{ type: "text", text: String(cause) }],
          isError: true,
          structuredContent: { error: "UNAVAILABLE", message: String(cause) },
        };
      }
    },
  };
}

/** A minimal local stand-in, used when the browser ships no implementation. */
function installPolyfill(descriptors: McpToolDescriptor[]): ModelContextLike {
  const registry = new Map<string, McpToolDescriptor>(descriptors.map((tool) => [tool.name, tool]));
  const container: ModelContextLike = {
    registerTool: (tool) => { registry.set(tool.name, tool); },
    unregisterTool: (name) => { registry.delete(name); },
    provideContext: (context) => {
      registry.clear();
      for (const tool of context.tools) registry.set(tool.name, tool);
    },
    getTools: () => [...registry.values()],
    executeTool: async (tool, args) => {
      const name = typeof tool === "string" ? tool : tool.name;
      const found = registry.get(name);
      if (!found) {
        return {
          content: [{ type: "text", text: `Unknown tool ${name}` }],
          isError: true,
          structuredContent: { error: "NOT_FOUND", message: `Unknown tool ${name}` },
        };
      }
      return found.execute(args ?? {});
    },
  };
  Object.defineProperty(document, "modelContext", { value: container, configurable: true });
  return container;
}

/**
 * Registers Corealm's tools with whichever model-context container the browser provides.
 * Safe to call once at boot; returns a disposer for hot reload.
 */
export function registerWebMcp(api: GameApi): WebMcpRegistration {
  const descriptors = createTools(api).map(toDescriptor);
  const controller = new AbortController();

  const documentContainer = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  const navigatorContainer = (navigator as unknown as { modelContext?: ModelContextLike }).modelContext;

  let container: ModelContextLike;
  let binding: WebMcpBinding;
  let native: boolean;

  if (documentContainer) {
    container = documentContainer;
    binding = "document.modelContext";
    native = true;
  } else if (navigatorContainer) {
    container = navigatorContainer;
    binding = "navigator.modelContext";
    native = true;
  } else {
    container = installPolyfill(descriptors);
    binding = "polyfill";
    native = false;
  }

  if (native) {
    if (typeof container.provideContext === "function") {
      void container.provideContext({ tools: descriptors });
    } else if (typeof container.registerTool === "function") {
      for (const descriptor of descriptors) {
        void container.registerTool(descriptor, { signal: controller.signal });
      }
    }
  }

  return {
    binding,
    toolCount: descriptors.length,
    native,
    dispose: () => {
      controller.abort();
      if (typeof container.unregisterTool === "function") {
        for (const descriptor of descriptors) void container.unregisterTool(descriptor.name);
      }
    },
  };
}
