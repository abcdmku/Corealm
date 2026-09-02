/**
 * A test-only stand-in for the browser's WebMCP container.
 *
 * Playwright's Chromium ships no `document.modelContext`, and the game deliberately installs no
 * polyfill of its own (a page that fills the gap itself can never report that the gap exists).
 * So the harness injects this before the page loads, with `page.addInitScript`, and the game's
 * adapter finds it exactly where a real implementation would be. It is marked
 * `__corealmPolyfill` so the adapter reports `binding: "polyfill", native: false` rather than
 * passing it off as the browser's.
 *
 * The shape follows the draft (webmachinelearning.github.io/webmcp, August 2026):
 * `registerTool(tool, { signal })`, `getTools()` returning the registered descriptors without
 * their `execute`, and `executeTool(tool, input, { signal })` running the callback with the
 * caller's signal and returning its result serialised to a JSON string — which is what a real
 * agent sees, so the audit parses exactly that.
 *
 * Shipped as a source string rather than a function because tsx emits `__name` helpers that do
 * not exist in the page.
 */
export const WEBMCP_POLYFILL_SCRIPT = `
(() => {
  if (document.modelContext) return;
  const registry = new Map();
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) { try { listener(new Event("toolchange")); } catch {} } };
  const container = {
    __corealmPolyfill: true,
    registerTool(tool, options) {
      if (!tool || typeof tool.name !== "string" || typeof tool.execute !== "function") {
        return Promise.reject(new TypeError("registerTool needs a name and an execute callback"));
      }
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) {
        return Promise.reject(new TypeError("Tool name must be 1-128 ASCII alphanumerics, _, - or ."));
      }
      registry.set(tool.name, tool);
      const signal = options && options.signal;
      if (signal) signal.addEventListener("abort", () => { registry.delete(tool.name); notify(); }, { once: true });
      notify();
      return Promise.resolve();
    },
    getTools() {
      return Promise.resolve([...registry.values()].map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        origin: location.origin,
      })));
    },
    async executeTool(tool, input, options) {
      const name = typeof tool === "string" ? tool : tool && tool.name;
      const found = registry.get(name);
      if (!found) throw new DOMException("Unknown tool " + name, "NotFoundError");
      const signal = (options && options.signal) || new AbortController().signal;
      const result = await found.execute(input || {}, { signal });
      return JSON.stringify(result === undefined ? null : result);
    },
    addEventListener(type, listener) { if (type === "toolchange") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "toolchange") listeners.delete(listener); },
    set ontoolchange(listener) { listeners.clear(); if (listener) listeners.add(listener); },
  };
  Object.defineProperty(document, "modelContext", { value: container, configurable: true });
})();
`;
