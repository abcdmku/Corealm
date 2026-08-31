# Writing an agent for Corealm

Corealm is a browser RPG that an AI agent plays through the same actions a human uses. There is no
privileged automation path: every tool below calls the identical function the human UI calls. If a
human can do it, you can; if they cannot, neither can you.

This document is enough to write a working autonomous player from scratch.

## Getting a handle

Two entry points, one implementation behind both.

```js
// Always present, in every browser.
const agent = window.corealm.agent;

// The WebMCP surface, when the browser supports it. Same handlers.
const tools = await document.modelContext.getTools();
```

`window.corealm.agent` exposes:

| Method | Returns |
| --- | --- |
| `listTools()` | every tool with its name, description, and JSON Schema |
| `call(name, args)` | the tool's result. **Never throws.** |
| `webmcp()` | which container the adapter bound to, and whether it was native |
| `version()` | build, contracts, and content versions — cache knowledge against these |

## The single most important thing

**Nothing throws.** A failure comes back as data:

```js
const result = await agent.call("corealm_interact", { entityId: "x", interaction: "mine" });
// { error: "REQUIREMENTS_NOT_MET", message: "Requires Mining 10", entityId: "x" }
```

Always check for `.error` before using a result. The codes are:

`NOT_FOUND`, `OUT_OF_RANGE`, `NOT_REACHABLE`, `REQUIREMENTS_NOT_MET`, `INVENTORY_FULL`, `BUSY`,
`INVALID_ARGUMENT`, `DEAD`, `DEPLETED`, `NOT_ENOUGH_CURRENCY`, `NOT_ENOUGH_ITEMS`, `NO_DIALOGUE`,
`TIMEOUT`, `UNAVAILABLE`.

`message` is always human-readable and states what is missing. You can usually act on it directly.

## The second most important thing

**Do not poll.** `corealm_events` blocks until something happens:

```js
// Wrong: burns tool calls and tokens learning nothing.
while (true) {
  const player = await agent.call("corealm_player");
  if (!player.activityKind) break;
}

// Right: one call, returns the moment the activity actually ends.
const { events, nextSeq } = await agent.call("corealm_events", {
  sinceSeq: cursor,
  types: ["activity.stopped", "inventory.full", "resource.depleted"],
  timeoutMs: 30000,
});
cursor = nextSeq;
```

Events are a monotonic sequence. Keep the `nextSeq` you were given and pass it back as `sinceSeq`.
You will never miss an event and never see one twice.

The event types are:

```
navigation.started  navigation.completed  navigation.failed
activity.started    activity.stopped      resource.depleted   inventory.full
item.received       item.lost             item.equipped       item.unequipped
combat.started      combat.ended          spell.launched      essence.recharged
health.low          player.died           level.gained        production.completed
quest.updated       dialogue.opened       dialogue.closed     entity.discovered
```

`spell.launched` fires when a cast is rolled and its bolt leaves, carrying
`{ spellId, targetId, element, rung, flightMs, hit, orbItemId, remainingCharges }`. It matters to an agent because a spell does
NOT damage anything until it arrives: `flightMs` later, the target's health moves and the kill (if
any) resolves. So a cast that has been accepted is not yet a hit, and an agent that reads health
immediately after `corealm_attack` will read the old value.

`essence.recharged` carries
`{ altarId, orbItemId, element, before, after, essenceItemId, essenceSpent }`. Use `after` as the new
charge count and advance the event cursor before issuing another command.

You can reconstruct your inventory from `item.received` and `item.lost` alone. Gear moving onto or
off the body is **not** a loss or a gain: it emits `item.equipped` or `item.unequipped` instead, and
neither of the two item events fires for it. A swap emits one `item.equipped` carrying `replaced`
with the id of the piece that went back into the pack.

## The 21 tools

### Reading state
- `corealm_player` — position, region, health, dead, moving, activityKind, and two separate
  combat facts:
  - `inCombat` — a fight is happening: you have a target, or something has engaged you. It clears
    on the frame the last enemy dies, so `waitFor(() => !inCombat)` is safe after a kill.
  - `regenBlocked` — the eight-second no-regen window after any blow in either direction. It
    outlives the fight on purpose. Wait on this only if you are waiting to heal.
  - `targetId` and `engagedBy` name who, so you never have to infer it.
  - `facingRad` — which way the player is pointing, radians, 0 = +Z (north).
  - `time` — the sim clock: `{ simMs, tick, timeScale, paused }`. **Every deadline the game gives
    you is stamped in `simMs`, never in wall time** — a recovery cache's `expiresAtMs`, a crop's
    growth. Comparing one against `Date.now()` is wrong, and quietly wrong whenever the clock is
    paused or rescaled.
- `corealm_skills` — all 11 skills with level, xp, xpToNext
- `corealm_inventory` — 28 slots, equipment with summed bonuses, mark balance
- `corealm_spellbook` — call with `{ op: "read" }` to read all sixteen spells and the live magic
  loadout. The response contains:

  ```js
  {
    spells: [{
      id, name, element, rung, reqLevel, maxHit, baseXp, castMs,
      requiredElement, fuelCost, unlocked, castable, blockedBy, description,
    }],
    preferredSpellId, activeSpellId, magicLevel,
    equippedWeapon: {
      itemId, name, element, charges, capacity, rechargeItemId, rechargeCost,
    } ?? null,
    essence: { wind, earth, water, fire },
    releasedElements,
  }
  ```

  Call `{ op: "select", spellId }` to set the standing choice. Pass `spellId: null` to return to
  automatic selection. `activeSpellId` is what an attack will cast now. `blockedBy` states why a
  row cannot be cast.
- `corealm_quests` — every known quest with status, stage, and objective. `currentObjective` is
  prose written for a player and contains no ids; `currentObjectiveRefs` is the same objective as
  data — `{ kind: "item" | "entity" | "location" | "enemyFamily" | "recipe" | "spell", id }` — in
  the order the sentence names them. Read the refs, not the sentence:

  ```js
  const quest = (await agent.call("corealm_quests")).find((q) => q.status === "active");
  for (const ref of quest.currentObjectiveRefs) {
    if (ref.kind === "location") await agent.call("corealm_move_to", { locationId: ref.id });
    if (ref.kind === "entity") await agent.call("corealm_move_to", { entityId: ref.id });
  }
  ```

### Finding things
- `corealm_observe` — entities you can see now (`scope: "visible"`, 140 m ceiling), or the places
  you have discovered (`scope: "known"`)

  **Discovery is real, and it starts almost empty.** A fresh character knows four places out of
  forty-four. Walking within 40 m of somewhere discovers it permanently and fires
  `entity.discovered`. So `scope: "known"` is what you have earned, not a map you were handed —
  which means an agent that only ever looks at what it knows will walk in circles.

  The way out is `corealm_search_docs`. The generated pages name every place with its id —
  `**Bracken Pit** (\`bracken_pit\`)` — and `corealm_move_to({ locationId })` accepts an id whether
  or not you have been there. Look up where the ore is, walk there, discover it on arrival. That is
  the intended loop and it is how the mining proof in this document bootstraps.

  Rows for a place backed by an entity carry BOTH ids: `id` is the entity (`coldbrace_bank`) and
  `locationId` is the place it stands at (`bank_interior`). Only the second one is accepted by
  `move_to({ locationId })`.
- `corealm_inspect` — full detail on one entity
- `corealm_search_docs` — the public game documentation

### Acting
- `corealm_move_to` — walk to an entity, a location id, or a position
- `corealm_stop` — cancel navigation, activity, and combat
- `corealm_interact` — mine, chop, fish, rake, plant, harvest, talk, open, climb, vault, loot, take,
  produce, recharge, bank, trade, inspect
- `corealm_use_item` — eat food, equip gear, or apply a matching seed to a farm plot
- `corealm_equip` — equip an item or clear a slot
- `corealm_produce` — smelt, smith, cook, craft, fletch
- `corealm_build_campfire` — turn a carried log into a temporary cooking station
- `corealm_attack` — attack with whatever is in the main hand. A one-handed wand casts every 2.2
  seconds. A stronger two-handed staff casts every 3.0 seconds. Both reach 15 m, so the character
  opens fire without closing. A blade or bare hands swing at 1.6 m and walk in first.
  Pass `spellId` to force a specific spell. Damage lands when the bolt arrives, not when the call
  returns — see `spell.launched`
- `corealm_dialogue` — read, choose an option, end
- `corealm_bank` — list, deposit, withdraw, depositAll
- `corealm_shop` — list, buy, sell

### Helping the human
- `corealm_overlay` — highlight, path, marker, label
- `corealm_events` — the cursor and long-poll described above

## Magic loadout and recharging

A cast needs a wand or staff in `mainHand` and one unit of matching fuel. A matching elemental
weapon spends one stored charge first, including on a miss. A plain or empty weapon spends one
carried Essence instead. Boss-dropped Air, Earth, and Water Orbs are singleton altar keys, not
equipment. Carry the matching Orb to the dormant altar at that region's Essence Cache and use its
`awaken` interaction. This consumes the Orb once, permanently lights the altar, and enables both
matching wand and staff recipes. Fire remains visible in the spellbook but is not released.

An awakened Essence Altar refills the equipped elemental weapon to 1,000 for exactly 100 matching Essence.
The altar does not accept a plain weapon, a full weapon, the wrong Essence, or less than 100 Essence.

```js
const before = await agent.call("corealm_spellbook", { op: "read" });
await agent.call("corealm_interact", {
  entityId: "fallowmarch_air_altar",
  interaction: "awaken",
});
const result = await agent.call("corealm_interact", {
  entityId: "fallowmarch_air_altar",
  interaction: "recharge",
});
if (result.error) throw new Error(result.message);

const { events, nextSeq } = await agent.call("corealm_events", {
  sinceSeq: cursor,
  types: ["essence.recharged"],
  timeoutMs: 5000,
});
cursor = nextSeq;
const after = await agent.call("corealm_spellbook", { op: "read" });
```

## Three things that will surprise you

**Movement takes real time.** `corealm_move_to` returns immediately with an ETA. The character then
walks at 4.2 m/s over a real navmesh. Wait for `navigation.completed`.

**Interaction walks you into range automatically.** You do not need to move first. `corealm_interact`
on something far away starts walking and returns `{ started: "walking to ..." }`. Wait for
`navigation.completed`, then interact again.

**Gathering is a continuing activity.** One `corealm_interact` with `mine` keeps yielding ore until
the node depletes, your pack fills, you move, or you stop. This is the same thing one human click
does. Do not call it once per ore.

## Distances are walking distances

`ObservedEntity.distance` is path length over the navmesh, not straight line. Across the Karrowmoor
terraces those differ by enough to change which node is actually closer. Trust the number.

## A complete worked example: train Mining from 1 to 10

```js
const agent = window.corealm.agent;
let cursor = 0;

async function waitFor(types, timeoutMs = 60000) {
  const result = await agent.call("corealm_events", { sinceSeq: cursor, types, timeoutMs });
  cursor = result.nextSeq;
  return result.events;
}

async function mineUntilLevel(target) {
  while (true) {
    const skills = await agent.call("corealm_skills");
    if (skills.mining.level >= target) return;

    // Find the best ore we currently qualify for. Sorted nearest first already.
    const ores = await agent.call("corealm_observe", {
      archetypes: ["ore"],
      interaction: "mine",
      requirementsMet: true,
      radius: 140,
      limit: 10,
    });

    const available = ores.filter((ore) => ore.state === "available");
    if (available.length === 0) {
      // Everything nearby is depleted. Wait for a respawn rather than walking away.
      await waitFor(["resource.depleted"], 15000);
      continue;
    }

    // Highest tier we qualify for, nearest first as the tiebreak.
    const target_ore = available.sort((a, b) => b.tier - a.tier || a.distance - b.distance)[0];

    const started = await agent.call("corealm_interact", {
      entityId: target_ore.id,
      interaction: "mine",
    });
    if (started.error) continue;

    // If it had to walk, wait for arrival then start again.
    if (String(started.started).startsWith("walking")) {
      await waitFor(["navigation.completed", "navigation.failed"]);
      continue;
    }

    // Mine until something interesting happens. ONE call covers the whole session.
    const events = await waitFor(
      ["inventory.full", "resource.depleted", "activity.stopped", "level.gained"],
      120000,
    );

    if (events.some((event) => event.type === "inventory.full")) {
      await bankEverything();
    }
  }
}

async function bankEverything() {
  const banks = await agent.call("corealm_observe", { scope: "known", archetypes: ["bank"], limit: 5 });
  if (banks.length === 0) return;

  await agent.call("corealm_move_to", { entityId: banks[0].id });
  await waitFor(["navigation.completed", "navigation.failed"]);

  const result = await agent.call("corealm_bank", { op: "depositAll" });
  if (result.error) console.warn("bank failed:", result.message);
}

await mineUntilLevel(10);
```

That is roughly **20 to 40 tool calls** for the whole 1→10 climb. A naive polling agent spends more
than that on the first node.

## Being efficient

Efficiency is a design goal, not an afterthought. A better agent reaches the same goal with fewer
calls and fewer tokens.

**Cache what does not change.** The XP table, recipes, item stats and region layouts are fixed for a
build. Read them once through `corealm_search_docs`, key the cache on `agent.version().content`, and
never ask again.

**Remember where things are.** `corealm_observe` with `scope: "known"` returns discovered locations.
Once you know the Bracken Pit is at a given place you can `corealm_move_to` it by `locationId`
without searching.

**Filter hard.** An unfiltered `corealm_observe` in a town returns mostly scenery. Pass `archetypes`,
`interaction`, and `requirementsMet: true` and you get a short list you can act on.

**Predict inventory.** You have 28 slots. Ore does not stack. If you have 6 free slots, a node with
9 gathers left will fill you — bank first and save the interruption.

**Use one blocking wait instead of many polls.** This is the single largest saving available.

## The optimisation that makes this a game

The highest-tier resource is not always the best one. Corealm is built so that this is genuinely
true, not a slogan:

| Choice | XP/hour at Mining 12 |
| --- | --- |
| Tier 5 Corven ore, 38 m from the Rootfall bank | **16,521** |
| Tier 10 Kaldite ore, 188 m from the Highcairn bank | 14,266 |
| Tier 10 Kaldite ore, via the Sunder Ledge shortcut (needs Agility 10) | **18,409** |

Before Agility 10 the *lower*-tier ore wins by 15.8%. After the shortcut opens, the higher tier wins
by 11.4%. An agent that always picks the highest tier it qualifies for leaves about 15% on the table.

Work it out from data you can already read: `corealm_observe` gives tier and walking distance,
`corealm_search_docs` gives XP per gather, and the gathering formula is documented — success chance
is `0.30 + 0.016 * (effectiveLevel - requiredLevel)` per 1.8 s attempt, capped at 0.95.

## Information parity

You discover the world the way a player does.

- `corealm_inspect` on an entity you have never seen returns `NOT_FOUND`.
- `corealm_search_docs` returns documented public knowledge only. It never leaks unstarted quest
  stages or undiscovered secrets.
- `corealm_observe` with `scope: "visible"` returns what is genuinely observable right now.

This is deliberate. An agent that had to explore to learn something knows it honestly.

## Helping a human

If a person is watching, narrate with overlays instead of text:

```js
await agent.call("corealm_overlay", {
  op: "set", id: "target", kind: "highlight",
  entityId: ore.id, colour: "#ffd98a",
});
await agent.call("corealm_overlay", {
  op: "set", id: "note", kind: "label",
  entityId: ore.id, text: "Best XP per hour from here",
});
```

Overlays are pure presentation. Drawing one can never change game state, so they are always safe.

## Testing your agent

In a development build, `window.__gameDebug` offers deterministic setup: `setSkillLevel`,
`giveItem`, `teleport`, `advanceGameTime`, `setSeed`, `setTimeScale`, `loadScenario`.

Use these to **set up** a test, never to accomplish the task. An agent that teleports to the ore has
not proven anything. `setTimeScale` is the one exception — running the same actions faster is still
running the same actions.
