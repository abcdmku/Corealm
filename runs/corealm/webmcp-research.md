# WebMCP research (root, before implementation)

Checked 2026-08-27 against the W3C Web Machine Learning community work, plus a direct capability probe in this repo's Playwright Chromium.

## Status of the standard

- WebMCP is a W3C-track browser API for pages to publish structured *tools* to an AI agent, instead of the agent scraping the DOM.
- Shipping status as of now: Edge 147 ships it natively, Chrome is in an open origin trial. Not universally available.
- The API is secure-context only (HTTPS). `http://127.0.0.1` and `http://localhost` count as secure contexts, so the Vite dev server is fine.

## API shape

The current spec draft puts the container on the **document**:

```js
const controller = new AbortController();

await document.modelContext.registerTool({
  name: "add-todo",
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text content of the todo item" }
    },
    required: ["text"]
  },
  async execute({ text }) {
    await addTodoItemToCollection(text);
    return { content: [{ type: "text", text: `Added todo item: "${text}" successfully.` }] };
  }
}, { signal: controller.signal });

const tools = await document.modelContext.getTools();
const result = await document.modelContext.executeTool(tool, { text: "..." });
```

Earlier and vendor-flavoured material describes `navigator.modelContext` with a batch
`provideContext({ tools: [...] })` plus `registerTool` / `unregisterTool`. Both spellings are in
the wild. Tool descriptor fields are stable across both: `name`, `description`, `inputSchema`
(JSON Schema), `execute(params)`.

Return shape is MCP-style content blocks:

```js
{ content: [{ type: "text", text: "..." }] }
```

Error signalling is not pinned down in the draft. MCP convention is either to throw, or to return
`{ isError: true, content: [...] }`. Corealm returns structured errors in the payload *and* sets
`isError`, so a caller gets a machine-readable reason either way.

## Capability probe in this repo

Playwright's bundled Chromium (`HeadlessChrome/151.0.7922.34`) exposes **neither**
`navigator.modelContext` nor `document.modelContext`, with or without
`--enable-features=WebMachineLearningModelContext,WebMCP,AIModelContext`. The origin trial needs a
token bound to a real origin.

## Consequence for Corealm's architecture

The browser API cannot be the only path, or none of it is testable here. So:

```text
                 CorealmAgentApi   (plain TypeScript, the only implementation)
                        |
      +-----------------+------------------+
      |                 |                  |
 window.corealm     document.modelContext  Internal AI
 .agent (always)    (registered when the   (assist/copilot/
                     browser supports it,   autonomous)
                     via a thin adapter)
```

- `CorealmAgentApi` holds all logic and validation. It is the canonical game API.
- The WebMCP adapter is a *translation layer only*: it maps each canonical tool to a descriptor,
  calls the same handler, and wraps the result in `{ content: [...] }`. It registers against
  `document.modelContext` if present, otherwise `navigator.modelContext`, otherwise it installs a
  local polyfill object so the same registration code path runs and stays testable.
- `window.corealm.agent` is always present and is what Playwright scenarios and the internal AI
  drive. It exercises the identical handlers the browser API would.

This keeps the "agent parity" pillar honest: there is exactly one implementation of every action,
and the WebMCP surface is a view onto it rather than a parallel code path.
