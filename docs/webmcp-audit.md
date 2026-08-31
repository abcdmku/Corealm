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
`document.modelContext.executeTool()`. It does not substitute `window.corealm.agent.call()`.
Each scenario starts from a deterministic reset. The simulation clock runs at the requested scale,
clamped to 1x through 100x. Movement, resource attempts, production, combat, respawns, and event
ordering still run through their production systems.

The two fixture-backed scenarios say so in their JSON results. The boss camp installs a combat kit
because the test concerns repeated boss kills and loot custody, not the hours of combat progression
needed to reach the boss. The farming scenario installs one seed and advances the persistent crop
clock by five minutes. Neither fixture grants the state that its scenario accepts.

## Audit findings repaired

- The documented inventory said 20 WebMCP tools while the runtime advertised 21. The inventory now
  includes `corealm_build_campfire` and matches the runtime descriptors.
- `corealm_use_item` advertised targeted seed planting but rejected every entity target. Matching
  carried seeds now route through the same production farming interaction used by the world menu.
- The same tool claimed unsupported item-on-item combinations and exposed a dead `targetItemId`
  argument. Both were removed; combinations remain explicit `corealm_produce` recipes.
- A deliberate `corealm_stop` emitted a cancellation event that the HUD described as an unreachable
  path. Cancellation still remains observable to an agent, but no longer shows a false route error.

## The ten scenarios

1. `surface-contract` checks all 21 descriptors, success and error envelopes, docs search, and overlays.
2. `cold-iron-quest` accepts and completes Cold Iron through dialogue, mining, smithing, equipment, and combat.
3. `mining-1-to-40` earns all 44,406 XP and switches from Grithe to the short Rootfall Corven route at level 5.
4. `grithe-armour-from-scratch` mines ore and flux, smelts ten bars, then smiths and equips five armour pieces.
5. `tempest-roc-loot-camp` repeats the boss fight and loots each pile until Pale Quartz is held.
6. `fish-cook-bank` fishes a school dry, cooks the catch, and banks cooked and burnt results.
7. `woodcut-fletch-equip` cuts Palewood, builds a campfire, makes and equips a staff, then checks the spellbook.
8. `farm-harvest-bank` rakes, plants, matures, harvests, and banks Bittergrain.
9. `shop-buy-sell` sells starter gear, buys stock, and reconciles inventory and marks.
10. `magic-combat-stop-overlay` cancels a route, selects a spell, marks a target, and checks `spell.launched`.

The combined report is written to `runs/corealm/test-results/webmcp-audit.json`. End-state screenshots
go to `runs/corealm/screenshots/webmcp-*.png`. A single-scenario run writes a suffixed report so
scenario runs can execute in parallel without overwriting one another.
