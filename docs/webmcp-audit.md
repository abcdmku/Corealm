# WebMCP gameplay audit

Run the complete audit against the real Vite game:

```sh
npm run webmcp:audit -- --run runs/corealm --scale 100
```

Run one scenario in isolation:

```sh
npm run webmcp:audit -- --run runs/corealm --scenario mining-1-to-40 --scale 100
```

The runner calls tools through `document.modelContext.getTools()` and
`document.modelContext.executeTool()`, parsing the JSON text block each call returns — exactly
what a browser agent sees. It does not substitute `window.corealm.agent.call()`.

Playwright's Chromium ships no WebMCP, and the game installs no polyfill of its own (a page that
fills the gap itself can never report that the gap exists). The harness injects a test stand-in,
`tools/lib/webmcp-polyfill.ts`, before the page loads. The game recognises it and reports
`binding: "polyfill", native: false`; the report records that, and the audit refuses to run if
the adapter mistakes the stand-in for a browser implementation.

Control is obtained the way a real session obtains it: the audit connects, asks for play mode
through `corealm_session`, and clicks Allow in the agent panel. Scenarios that test the handoff
itself start without control.

Each scenario starts from a deterministic reset (seed 1337). The simulation clock runs at the
requested scale, clamped to 1x through 100x. Waits go through the event stream or
`corealm_wait`; there are no wall-clock deadlines against the scaled clock. Movement, resource
attempts, production, combat, respawns, and event ordering still run through their production
systems.

The two fixture-backed scenarios say so in their JSON results. The boss camp installs a combat
kit because the test concerns repeated boss kills and loot custody, not the hours of combat
progression needed to reach the boss. The farming scenario installs one seed and advances the
persistent crop clock by five minutes. Neither fixture grants the state that its scenario
accepts.

## The eleven scenarios

1. `surface-contract` checks every advertised descriptor against `listTools()` (title, strict
   schema, `readOnlyHint` consistent with access), success and error envelopes, schema rejection
   of bad arguments, truncation fields on `corealm_events`, `corealm_context` and
   `corealm_manual` shape, docs search, and that a fresh journal lists only the starting
   region's quests.
2. `collaboration-handoff` walks the modes: reads work in guide while acting and drawing are
   refused; assist draws a route and a plan; a control request is denied, then allowed; Stop
   cancels a running `corealm_navigate` with `CANCELLED` and hands control back; Pause parks a
   walk and refuses commands with `PAUSED`; Resume lets it arrive; release hands back.
3. `cold-iron-quest` accepts and completes Cold Iron through dialogue, `corealm_gather`,
   `corealm_craft`, `corealm_follow_route`, `corealm_fight`, and the journal's own objective refs.
4. `mining-1-to-40` earns the full climb with `corealm_gather` sessions and bank trips,
   switching from Grithe to the short Rootfall Corven route at level 5.
5. `grithe-armour-from-scratch` mines ore and flux, smelts ten bars, then smiths and equips five
   armour pieces.
6. `tempest-roc-loot-camp` repeats the boss fight, takes one stack explicitly and sweeps the rest,
   until Pale Quartz is held.
7. `fish-cook-bank` fishes, cooks the catch, and banks cooked and burnt results.
8. `woodcut-fletch-equip` cuts Palewood, builds a campfire, makes and equips a staff through both
   the primitive and the bounded production path, then checks the spellbook.
9. `farm-harvest-bank` rakes, plants, matures, harvests, and banks Bittergrain.
10. `shop-buy-sell` sells starter gear and buys stock. The first sale raises a trade approval;
    the harness ticks "Always allow trades" in the panel.
11. `magic-combat-stop-overlay` cancels a route, selects a spell, marks a target, and checks
    `spell.launched`.

Tool coverage counts a tool only when its call ran: a schema rejection, a session refusal, or an
`UNAVAILABLE` does not count. The combined report is written to
`runs/corealm/test-results/webmcp-audit.json`. End-state screenshots go to
`runs/corealm/screenshots/webmcp-*.png`. A single-scenario run writes a suffixed report so
scenario runs can execute in parallel without overwriting one another.
