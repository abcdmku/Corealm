/**
 * The canonical agent tool surface.
 *
 * This is the single implementation of every action an AI agent can take. `agent/webmcp.ts` is a
 * translation layer onto it, and `__gameDebug.callTool` invokes it directly. There is no second
 * code path, which is what makes agent parity a property of the architecture rather than a claim:
 * every tool below calls `GameApi`, the same object the human UI calls.
 *
 * Twenty-two tools, consolidated from the brief's ~30 capability bullets. The consolidations that
 * did the work: `observe` absorbs known-location recall through a `scope` parameter, `interact`
 * absorbs gather/agility/loot/talk/door through the `InteractionId` it is given, and `events`
 * absorbs both draining and long-poll waiting through an optional timeout.
 *
 * `corealm_spellbook` was added with the Magic 1-70 ladder. It is not a
 * consolidation failure: `corealm_attack` can already name any spell per cast, but with sixteen
 * spells an agent needs to be able to READ which ones it has and which one a bare "cast" resolves
 * to, and that read has no other home.
 *
 * FROZEN. Only the root edits this file.
 */
import type {
  EntityId, GameApi, GameEventType, InteractionId, ItemId, RecipeId, SpellId, Vec3,
  EquipSlot, OverlaySpec, Result,
} from "../contracts.js";
import { EQUIP_SLOTS } from "../contracts.js";
import { SPELLS } from "../content/spells.js";

/** JSON Schema fragment. Kept loose on purpose: WebMCP passes these through untouched. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute(args: Record<string, unknown>): Promise<unknown> | unknown;
}

function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

const STR = (description: string): JsonSchema => ({ type: "string", description });
const NUM = (description: string): JsonSchema => ({ type: "number", description });
const BOOL = (description: string): JsonSchema => ({ type: "boolean", description });

/** Unwraps a Result for an agent: success returns the value, failure returns a structured error. */
function unwrap<T>(result: Result<T>): unknown {
  if (result.ok) return result.value;
  return { error: result.error.code, message: result.error.message, entityId: result.error.entityId };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createTools(api: GameApi): ToolDef[] {
  return [
    // ------------------------------------------------------------- state
    {
      name: "corealm_player",
      description:
        "Read the player's current state: position, region, health, whether they are in combat, "
        + "moving, dead, and what activity is running, plus the sim clock. Cheap. Call this before "
        + "deciding anything. Every deadline the game reports — a recovery cache's expiry, a crop's "
        + "growth — is stamped in the same sim milliseconds as `time.simMs`, never in wall time.",
      inputSchema: obj({}),
      execute: () => ({ ...api.getPlayer(), time: api.getTime() }),
    },
    {
      name: "corealm_skills",
      description:
        "Read all 11 skill levels with current XP and XP remaining to the next level. Use this to "
        + "decide what content the player qualifies for.",
      inputSchema: obj({}),
      execute: () => api.getSkills(),
    },
    {
      name: "corealm_inventory",
      description:
        "Read the 28 inventory slots, the equipped items with their summed bonuses, and the mark "
        + "balance. `freeSlots` is what you check before starting a long gathering session.",
      inputSchema: obj({}),
      execute: () => ({
        ...api.getInventory(),
        equipment: api.getEquipment(),
        currency: api.getCurrency(),
      }),
    },
    {
      name: "corealm_quests",
      description: "Read every known quest with its status, stage, and current objective text.",
      inputSchema: obj({}),
      execute: () => api.getQuests(),
    },

    // ------------------------------------------------------- observation
    {
      name: "corealm_observe",
      description:
        "List entities the player can currently see, or locations they have discovered. This is the "
        + "main way to find something to interact with. Results are sorted nearest first and "
        + "`distance` is walking distance over the navmesh, not straight line. In `known` scope, "
        + "a row backed by an entity has both its entity `id` and a `locationId`; a pure landmark "
        + "has `state: \"known\"` and its `id` is the location id. Filter hard: an unfiltered call "
        + "in a town is mostly scenery you cannot use.",
      inputSchema: obj({
        scope: { type: "string", enum: ["visible", "known"], description: "visible = what is in range now; known = discovered locations" },
        radius: NUM("Metres. Default 40, max 140."),
        archetypes: { type: "array", items: { type: "string" }, description: "e.g. [\"ore\",\"tree\",\"bank\",\"npc\",\"enemy\"]" },
        interaction: STR("Only entities offering this interaction, e.g. \"mine\""),
        requirementsMet: BOOL("true = only what the player currently qualifies for"),
        regionId: STR("Restrict to one region"),
        limit: NUM("Default 25, max 100."),
      }),
      execute: (args) => api.observe({
        scope: args.scope === "known" ? "known" : "visible",
        ...(typeof args.radius === "number" ? { radius: args.radius } : {}),
        ...(Array.isArray(args.archetypes) ? { archetypes: args.archetypes as never } : {}),
        ...(typeof args.interaction === "string" ? { interaction: args.interaction as InteractionId } : {}),
        ...(typeof args.requirementsMet === "boolean" ? { requirementsMet: args.requirementsMet } : {}),
        ...(typeof args.regionId === "string" ? { regionId: args.regionId as never } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      }),
    },
    {
      name: "corealm_inspect",
      description:
        "Full detail for one entity: state, tier, requirements, available interactions, and for a "
        + "resource node how many gathers it has left and how long it takes to respawn.",
      inputSchema: obj({ entityId: STR("Entity id from corealm_observe") }, ["entityId"]),
      execute: (args) => unwrap(api.inspect(asString(args.entityId))),
    },
    {
      name: "corealm_search_docs",
      description:
        "Search Corealm's public game documentation: XP tables, skill guides, recipes, item stats, "
        + "region information, enemies. This is documented public knowledge, not hidden state.",
      inputSchema: obj({ query: STR("Free text"), limit: NUM("Default 5, max 25") }, ["query"]),
      execute: async (args) => api.searchDocs(asString(args.query), asNumber(args.limit, 5)),
    },

    // ---------------------------------------------------------- movement
    {
      name: "corealm_move_to",
      description:
        "Walk the character to an entity, a known location id, or a world position. Movement is at "
        + "normal game speed over the real navmesh — this returns immediately with an ETA, it does "
        + "not teleport and does not block. Wait for the navigation.completed event.",
      inputSchema: obj({
        entityId: STR("Walk to this entity"),
        locationId: STR("Walk to this known location"),
        position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x,y,z] in metres" },
      }),
      execute: (args) => {
        if (typeof args.entityId === "string") return unwrap(api.moveTo({ entityId: args.entityId }));
        if (typeof args.locationId === "string") return unwrap(api.moveTo({ locationId: args.locationId }));
        if (Array.isArray(args.position) && args.position.length === 3) {
          return unwrap(api.moveTo({ position: args.position as unknown as Vec3 }));
        }
        return { error: "INVALID_ARGUMENT", message: "Give one of entityId, locationId, or position" };
      },
    },
    {
      name: "corealm_stop",
      description: "Cancel whatever the character is doing: navigation, the current activity, and combat.",
      inputSchema: obj({}),
      execute: () => unwrap(api.stop()),
    },

    // ------------------------------------------------------- interaction
    {
      name: "corealm_interact",
      description:
        "Perform an interaction on an entity: mine, chop, fish, rake, plant, harvest, talk, open, "
        + "climb, vault, loot, take, awaken, produce, recharge, bank, trade, inspect. If the character is out of "
        + "range this walks them into range first, exactly as a human click does. Gathering "
        + "interactions continue after one call until the node is depleted, the pack is full, or you stop. "
        + "Use awaken on a dormant regional Essence Altar while carrying its matching boss Orb. The Orb is "
        + "consumed once and the altar remains active. For recharge, target that awakened altar while a "
        + "matching charged Air, Earth, or Water wand or staff is "
        + "equipped. The altar atomically spends exactly 100 matching essence and fills that weapon "
        + "to 1000 charges. A full weapon or insufficient essence rejects without taking anything. A loot "
        + "interaction only opens the container; use corealm_take_loot to move stacks. If this call starts "
        + "a walk, wait for navigation.completed and then for essence.recharged; routed "
        + "failures are shown through the same game notice channel as in-range failures.",
      inputSchema: obj({
        entityId: STR("Entity id"),
        interaction: STR("One of the entity's listed interactions"),
      }, ["entityId", "interaction"]),
      execute: (args) => unwrap(api.interact(asString(args.entityId), asString(args.interaction) as InteractionId)),
    },
    {
      name: "corealm_take_loot",
      description:
        "Explicitly take loot after opening a loot pile or Recovery Cache. Give stackIndex to take "
        + "one displayed stack, or omit it to take everything that fits. Opening with "
        + "corealm_interact and the loot interaction never transfers items.",
      inputSchema: obj({
        entityId: STR("Opened loot container id"),
        stackIndex: NUM("Optional zero-based index in the displayed contents grid"),
      }, ["entityId"]),
      execute: (args) => unwrap(api.takeLoot(
        asString(args.entityId),
        typeof args.stackIndex === "number" ? Math.floor(args.stackIndex) : undefined,
      )),
    },
    {
      name: "corealm_use_item",
      description: "Use a carried item: eat food, equip gear, or apply a matching seed to a farm plot.",
      inputSchema: obj({
        itemId: STR("Item to use"),
        targetEntityId: STR("Optional farm plot entity to plant the seed in"),
      }, ["itemId"]),
      execute: (args) => {
        const itemId = asString(args.itemId);
        if (typeof args.targetEntityId === "string") return unwrap(api.useItem(itemId, { entityId: args.targetEntityId }));
        return unwrap(api.useItem(itemId));
      },
    },
    {
      name: "corealm_equip",
      description:
        "Equip an inventory item, or unequip a worn slot. Equipping checks skill requirements and "
        + "returns REQUIREMENTS_NOT_MET with the reason if the character does not qualify. Wands and "
        + "staffs occupy mainHand. Boss Orbs are altar keys and cannot be equipped.",
      inputSchema: obj({
        itemId: STR("Item to equip"),
        unequipSlot: {
          type: "string",
          enum: [...EQUIP_SLOTS],
          description: `Slot to clear. Slots: ${EQUIP_SLOTS.join(", ")}`,
        },
      }),
      execute: (args) => {
        if (typeof args.unequipSlot === "string") {
          if (!EQUIP_SLOTS.includes(args.unequipSlot as EquipSlot)) {
            return {
              error: "INVALID_ARGUMENT",
              message: `Unknown equipment slot ${args.unequipSlot}. Use one of: ${EQUIP_SLOTS.join(", ")}`,
            };
          }
          return unwrap(api.unequipItem(args.unequipSlot as EquipSlot));
        }
        if (typeof args.itemId === "string") return unwrap(api.equipItem(args.itemId));
        return { error: "INVALID_ARGUMENT", message: "Give either itemId or unequipSlot" };
      },
    },
    {
      name: "corealm_produce",
      description:
        "Start a production job at a station: smelt, smith, cook, craft, or fletch. Runs `quantity` "
        + "repetitions back to back and stops on missing ingredients, a full pack, movement, or "
        + "damage. Pass stationId to bind the exact selected station; otherwise the nearest valid "
        + "station is used for compatibility. The character must already be at the right station.",
      inputSchema: obj({
        recipeId: STR("Recipe id from corealm_search_docs"),
        quantity: NUM("How many to make. Default 1."),
        stationId: STR("Optional exact range, campfire, furnace, anvil, bench, or crafting station id"),
      }, ["recipeId"]),
      execute: (args) => {
        const recipeId = asString(args.recipeId) as RecipeId;
        const quantity = asNumber(args.quantity, 1);
        return unwrap(typeof args.stationId === "string"
          ? api.produceAt(args.stationId, recipeId, quantity)
          : api.produce(recipeId, quantity));
      },
    },
    {
      name: "corealm_build_campfire",
      description:
        "Build a portable cooking fire from one carried log. The game chooses the first valid "
        + "nearby dry placement; the three-second build consumes the log only when it completes.",
      inputSchema: obj({ logItemId: STR("Palewood, Duskoak, or Cairnpine log item id") }, ["logItemId"]),
      execute: (args) => unwrap(api.buildCampfire(asString(args.logItemId))),
    },

    // ------------------------------------------------------------ combat
    {
      name: "corealm_attack",
      description:
        "Attack an enemy with the main-hand weapon. With a wand or staff and no spellId, this casts "
        + "the selected spell when it is castable, otherwise it falls back to the highest-Magic-level "
        + "castable spell. If none is castable, it returns "
        + "REQUIREMENTS_NOT_MET and does not attack in melee. Pass spellId to require that exact spell. "
        + "Magic reaches 15 metres; melee reaches 1.6 metres. One cast spends one matching Essence "
        + "when the bolt launches. A matching charged weapon pays instead. Wands cast every 2200 ms "
        + "and staffs every 3000 ms. "
        + "Damage lands 0.3 to 1.3 seconds after launch. Read spell.launched.data.flightMs before checking "
        + "target health. Attacking repeats on that cadence until the target dies, leaves pursuit range, "
        + "another command replaces it, or the character dies.",
      inputSchema: obj({
        entityId: STR("Enemy entity id"),
        // Enumerated from the content table rather than typed out, because the ladder went from
        // three spells to sixteen and a hand-written list is the thing that goes stale first. The
        // enum also makes a bad id a schema rejection at the tool boundary instead of a NOT_FOUND
        // three calls later.
        spellId: {
          type: "string",
          enum: SPELLS.map((spell) => spell.id),
          description:
            "Optional. With a wand or staff, this forces a spell; omit it to use the standing choice "
            + "when castable or the strongest compatible spell automatically. With a non-magic weapon, "
            + "omitting it attacks in melee; supplying it returns a loadout error. Each spell has one "
            + "of four internal elements "
            + "(wind, water, earth, fire) and needs the Magic level listed here: "
            + SPELLS.map((spell) => `${spell.id} (${spell.element}, Magic ${spell.reqLevel})`).join(", ")
            + ". The player-facing Air Essence supplies wind spells. Every launch costs one matching "
            + "Essence unless a matching charged weapon can pay instead.",
        },
      }, ["entityId"]),
      execute: (args) => {
        const entityId = asString(args.entityId);
        if (typeof args.spellId !== "string") return unwrap(api.attack(entityId));
        // ONE result shape for one tool. `GameApi.cast` reports its cadence as `castMs` and
        // `GameApi.attack` as `attackSpeedMs` — the frozen contract's two names for the same
        // quantity, the interval until the next swing. Passed straight through, an agent that read
        // `attackSpeedMs` to pace itself got `undefined` the moment it named a spell, and paced
        // itself off nothing. Both names are emitted rather than renaming either, because the
        // contract owns both and an agent may already be reading either one.
        const cast = api.cast(args.spellId as SpellId, entityId);
        if (!cast.ok) return unwrap(cast);
        return { targetId: cast.value.targetId, castMs: cast.value.castMs, attackSpeedMs: cast.value.castMs };
      },
    },

    {
      name: "corealm_spellbook",
      description:
        "Read the sixteen attack spells and the active automatic choice, or set the standing choice. "
        + "Each spell row returns id, name, element, rung, reqLevel, maxHit, baseXp, castMs, "
        + "requiredElement, fuelCost, unlocked, castable, blockedBy, and description. The top-level "
        + "result returns preferredSpellId, activeSpellId, magicLevel, equippedWeapon, carried Essence by "
        + "element, and releasedElements. equippedWeapon includes live charges, capacity, rechargeItemId, "
        + "and rechargeCost. A cast requires a wand or staff plus matching Essence. Air, Earth, "
        + "and Water are released. Fire stays visible as unreleased tier-15 content. Selecting a locked "
        + "or currently incompatible spell is allowed; automatic selection stands in until it becomes "
        + "castable. Pass an explicit null spellId to restore automatic selection.",
      inputSchema: obj({
        op: { type: "string", enum: ["read", "select"] },
        spellId: {
          type: ["string", "null"],
          enum: [...SPELLS.map((spell) => spell.id), null],
          description: "Required when op is select. Null clears the choice back to automatic.",
        },
      }, ["op"]),
      execute: (args) => {
        const op = asString(args.op);
        if (op === "select") {
          if (!("spellId" in args)) {
            return { error: "INVALID_ARGUMENT", message: "spellId is required when op is select" };
          }
          const raw = args.spellId;
          if (raw !== null && typeof raw !== "string") {
            return { error: "INVALID_ARGUMENT", message: "spellId must be a spell id or null" };
          }
          const spellId = typeof raw === "string" ? (raw as SpellId) : null;
          return unwrap(api.setPreferredSpell(spellId));
        }
        if (op === "read") return api.getSpellbook();
        return { error: "INVALID_ARGUMENT", message: 'op must be "read" or "select"' };
      },
    },

    // -------------------------------------------------------- npc, trade
    {
      name: "corealm_dialogue",
      description:
        "Read the open dialogue, choose an option by id, or end the conversation. Talk to an NPC "
        + "first with corealm_interact using the \"talk\" interaction.",
      inputSchema: obj({
        op: { type: "string", enum: ["state", "choose", "end"] },
        optionId: STR("Required when op is choose"),
      }, ["op"]),
      execute: (args) => unwrap(api.dialogue(
        args.op === "choose" ? "choose" : args.op === "end" ? "end" : "state",
        typeof args.optionId === "string" ? args.optionId : undefined,
      )),
    },
    {
      name: "corealm_bank",
      description:
        "Use a bank the character is standing at: list contents, deposit or withdraw a quantity, or "
        + "deposit everything. Banks are the geographic anchor of every gathering route.",
      inputSchema: obj({
        op: { type: "string", enum: ["list", "deposit", "withdraw", "depositAll"] },
        itemId: STR("Item to move"),
        quantity: NUM("How many. Omit for all of that item."),
        filter: STR("Substring filter for list"),
      }, ["op"]),
      execute: (args) => unwrap(api.bank(
        args.op as "list" | "deposit" | "withdraw" | "depositAll",
        {
          ...(typeof args.itemId === "string" ? { itemId: args.itemId as ItemId } : {}),
          ...(typeof args.quantity === "number" ? { quantity: args.quantity } : {}),
          ...(typeof args.filter === "string" ? { filter: args.filter } : {}),
        },
      )),
    },
    {
      name: "corealm_shop",
      description: "Use a shop the character is standing at: list stock, buy, or sell.",
      inputSchema: obj({
        op: { type: "string", enum: ["list", "buy", "sell"] },
        shopId: STR("Shop entity id"),
        itemId: STR("Item to trade"),
        quantity: NUM("How many. Default 1."),
      }, ["op"]),
      execute: (args) => unwrap(api.shop(
        args.op as "list" | "buy" | "sell",
        {
          ...(typeof args.shopId === "string" ? { shopId: args.shopId } : {}),
          ...(typeof args.itemId === "string" ? { itemId: args.itemId as ItemId } : {}),
          ...(typeof args.quantity === "number" ? { quantity: args.quantity } : {}),
        },
      )),
    },

    // ---------------------------------------------------------- overlays
    {
      name: "corealm_overlay",
      description:
        "Draw or clear an assistance overlay in the player's world view: highlight an entity, draw "
        + "a path line, place a marker, or attach a world-space label. Use `locationId` for a known "
        + "place and `entityId` only for a real entity. If a pure location id is accidentally passed "
        + "as `entityId`, the game resolves it as a location instead of drawing at world origin. "
        + "Unknown targets return NOT_FOUND and draw nothing.",
      inputSchema: obj({
        op: { type: "string", enum: ["set", "clear"] },
        id: STR("Overlay id. Reusing an id replaces it."),
        kind: { type: "string", enum: ["highlight", "path", "marker", "label"] },
        entityId: STR("Entity to attach to"),
        locationId: STR("Known place id to mark at its fixed world position"),
        position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        path: { type: "array", items: { type: "array", items: { type: "number" } } },
        text: STR("Label text"),
        colour: STR("#rrggbb"),
        ttlMs: NUM("Auto-clear after this long. 0 or omitted means until cleared."),
      }, ["op"]),
      execute: (args) => {
        if (args.op === "clear") {
          return unwrap(api.overlay("clear", typeof args.id === "string" ? { id: args.id, kind: "marker" } : undefined));
        }
        const spec: OverlaySpec = {
          id: asString(args.id, `overlay_${Date.now()}`),
          kind: (args.kind as OverlaySpec["kind"]) ?? "highlight",
          ...(typeof args.entityId === "string" ? { entityId: args.entityId as EntityId } : {}),
          ...(typeof args.locationId === "string" ? { locationId: args.locationId } : {}),
          ...(Array.isArray(args.position) ? { position: args.position as unknown as Vec3 } : {}),
          ...(Array.isArray(args.path) ? { path: args.path as unknown as Vec3[] } : {}),
          ...(typeof args.text === "string" ? { text: args.text } : {}),
          ...(typeof args.colour === "string" ? { colour: args.colour } : {}),
          ...(typeof args.ttlMs === "number" ? { ttlMs: args.ttlMs } : {}),
        };
        return unwrap(api.overlay("set", spec));
      },
    },

    // ------------------------------------------------------------ events
    {
      name: "corealm_events",
      description:
        "Read game events since a cursor, optionally blocking until one arrives. Pass each returned "
        + "nextSeq as the next sinceSeq. A timeout lets you wait for inventory.full or "
        + "resource.depleted without polling. Magic payloads are exact: spell.launched has data "
        + "{spellId,targetId,element,rung,flightMs,hit,fuelSource,weaponItemId,remainingCharges,essenceItemId,remainingEssence} and uses the target "
        + "as entityId. essence.recharged has data "
        + "{altarId,weaponItemId,element,before,after,essenceItemId,essenceSpent} and uses the altar as "
        + "entityId. Element is wind for the player-facing Air element.",
      inputSchema: obj({
        sinceSeq: NUM("Cursor. Use 0 on the first call, then the nextSeq you were given."),
        types: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional event-type filter, for example [\"inventory.full\",\"resource.depleted\"] "
            + "or [\"spell.launched\",\"essence.recharged\"].",
        },
        timeoutMs: NUM("Block up to this long waiting for a matching event. Omit or 0 to return immediately."),
      }),
      execute: async (args) => api.events(
        asNumber(args.sinceSeq, 0),
        Array.isArray(args.types) ? (args.types as GameEventType[]) : undefined,
        asNumber(args.timeoutMs, 0),
      ),
    },
  ];
}

/** Name → tool, for `callTool`. */
export function toolTable(api: GameApi): Map<string, ToolDef> {
  return new Map(createTools(api).map((tool) => [tool.name, tool]));
}
