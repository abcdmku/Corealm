/**
 * Every dialogue tree in Phase 1, as a node graph.
 *
 * Three rules the whole file obeys, because the UI, the agent surface and PRD acceptance F4 all
 * depend on them:
 *
 *  1. **A gated option stays visible and says why.** `requires` disables an option and shows its
 *     `reason` as plain text; it never hides it. Choosing a disabled option returns
 *     `INVALID_ARGUMENT` and does not move `nodeId`. `showIf` is the separate, narrower tool for
 *     branches that are not merely unavailable but irrelevant - offering a quest you already
 *     finished is noise, not a locked door.
 *  2. **Nothing in a line depends on seeing anything.** Every fact a player needs to act on is in
 *     the text: ids, directions in metres, and the actual reasoning for the one puzzle. An agent
 *     reading `corealm_dialogue` has exactly the information a human reading the panel has.
 *  3. **Twelve people, twelve voices.** Each tree is written against the `voice` rule on that
 *     character in `content/npcs.ts`. Read the rule before you add a line.
 *
 * Node ids referenced by a quest's `talk` predicate are load-bearing: `content/quests.ts` names
 * them, and reaching the node is what completes the stage.
 */
import type { EntityId, ItemId, QuestId, SkillId } from "../contracts.js";

// ------------------------------------------------------------------- shapes

/**
 * A test over quest state, skills, inventory or currency.
 *
 * Every arm carries its own `reason`, because a disabled option has to explain itself in one line
 * of plain English and the only place that line can honestly come from is the condition that
 * failed.
 */
export type DialogueCondition =
  | { kind: "questStatus"; questId: QuestId; status: "unstarted" | "active" | "complete"; reason: string }
  | { kind: "questStage"; questId: QuestId; min?: number; max?: number; reason: string }
  | { kind: "questFlag"; questId: QuestId; flag: string; value?: boolean; reason: string }
  | { kind: "questCounter"; questId: QuestId; counter: string; min?: number; max?: number; reason: string }
  /** Unstarted, prerequisites done, and skill requirements met. */
  | { kind: "questOffer"; questId: QuestId; reason: string }
  | { kind: "skill"; skill: SkillId; level: number; reason: string }
  | { kind: "item"; itemId: ItemId; quantity: number; reason: string }
  /** Holds when the player is carrying FEWER than `quantity`. The replacement-item safety net. */
  | { kind: "lacksItem"; itemId: ItemId; quantity: number; reason: string }
  | { kind: "currency"; amount: number; reason: string };

export type DialogueEffect =
  | { kind: "startQuest"; questId: QuestId }
  | { kind: "setFlag"; questId: QuestId; flag: string; value?: boolean }
  | { kind: "bumpCounter"; questId: QuestId; counter: string; by?: number }
  | { kind: "giveItem"; itemId: ItemId; quantity: number }
  | { kind: "takeItem"; itemId: ItemId; quantity: number }
  | { kind: "grantXp"; skill: SkillId; amount: number }
  | { kind: "grantCurrency"; amount: number };

export interface DialogueOptionDef {
  /** Globally unique. `dialogue("choose", id)` takes exactly this string. */
  id: string;
  text: string;
  /** All must hold for the option to appear at all. Use sparingly; prefer `requires`. */
  showIf?: DialogueCondition[];
  /** All must hold for the option to be selectable. A failure disables it and shows the reason. */
  requires?: DialogueCondition[];
  effects?: DialogueEffect[];
  /** First matching branch wins; `next` is the fallback. */
  nextIf?: { when: DialogueCondition[]; next: string | null }[];
  /** `null` ends the conversation. */
  next: string | null;
}

export interface DialogueNodeDef {
  id: string;
  /** Defaults to the NPC's name from content/npcs.ts. */
  speaker?: string;
  text: string;
  /** First matching variant replaces `text`. Lets one node id react to quest state. */
  variants?: { when: DialogueCondition[]; text: string }[];
  options: DialogueOptionDef[];
}

// ------------------------------------------------------- shared conditions

const LEAVE = (id: string): DialogueOptionDef => ({ id, text: "That is all for now.", next: null });

// ==========================================================================
// FALLOWMARCH
// ==========================================================================

/**
 * Warden Ilse gives no quest. She is the town's directory, which is a real job in a game where an
 * agent's first problem is "who do I talk to". Every one of her answers names an NPC id.
 */
const ILSE: DialogueNodeDef[] = [
  {
    id: "ilse_root",
    text:
      "Warden Ilse, Coldbrace, acting under March Company charter clause fourteen. You are "
      + "welcome here, you are counted, and you are responsible for your own equipment. What do "
      + "you need?",
    variants: [
      {
        when: [{ kind: "questStatus", questId: "the_carters_wager", status: "complete", reason: "" }],
        text:
          "The Carter has told me his version of your run. I have written down the version that "
          + "matches the distances. Both are on file. What do you need?",
      },
    ],
    options: [
      { id: "ilse_root#who", text: "Who in this town has work?", next: "ilse_directory" },
      { id: "ilse_root#town", text: "What is Coldbrace, exactly?", next: "ilse_town" },
      { id: "ilse_root#shortcuts", text: "Is there a faster way to the pit than the road?", next: "ilse_shortcuts" },
      {
        id: "ilse_root#charter",
        text: "Read me clause fourteen.",
        requires: [
          {
            kind: "questStatus", questId: "the_carters_wager", status: "complete",
            reason: "Warden Ilse only reads the charter to people who have settled a wager under it.",
          },
        ],
        next: "ilse_charter",
      },
      LEAVE("ilse_root#bye"),
    ],
  },
  {
    id: "ilse_directory",
    text:
      "Four people. Harrow the Smith, entity npc_smith_harrow, east side of the square, will not "
      + "sell you a weapon until you have made one. Pitmaster Dorn, npc_pitmaster_dorn, has a "
      + "ledger problem he calls a pit problem. Ranger Syb, npc_ranger_syb, has not eaten "
      + "properly since the spring. Carter Bel, npc_carter_bel, is at the south gate and is "
      + "wrong.",
    options: [
      { id: "ilse_directory#back", text: "Something else.", next: "ilse_root" },
      LEAVE("ilse_directory#bye"),
    ],
  },
  {
    id: "ilse_town",
    text:
      "Two hundred and six people, one vault, one pit, and a road the Company built and then "
      + "stopped maintaining. We keep the walls up. We keep the count. The Company has not "
      + "answered a letter in nine years, and I have sent one every quarter, so the file is "
      + "thorough if nothing else.",
    options: [
      { id: "ilse_town#north", text: "What is north of here?", next: "ilse_north" },
      { id: "ilse_town#back", text: "Something else.", next: "ilse_root" },
      LEAVE("ilse_town#bye"),
    ],
  },
  {
    id: "ilse_north",
    text:
      "The March Road runs to the North Gate, locationId fallowmarch_north_gate, and into "
      + "Vellenwood. The trees there were surveyed as terrain rather than as trees, which tells "
      + "you what the surveyor thought of them. Beyond Vellenwood is Karrowmoor. I have never "
      + "been. It is not in my charter.",
    options: [
      { id: "ilse_north#back", text: "Something else.", next: "ilse_root" },
      LEAVE("ilse_north#bye"),
    ],
  },
  {
    id: "ilse_shortcuts",
    text:
      "There are two. The Brookvault Planks, entity brookvault_planks, cross Corven Brook at "
      + "roughly minus seventy-eight, minus thirty, and save sixty-six metres on the trip to "
      + "Redsill Shallows. The Wall Vault, entity wall_vault, goes over our own north wall and "
      + "saves forty-four metres to the pit. Regulation nine forbids the second one. Nobody has "
      + "obeyed regulation nine since it was written.",
    options: [
      { id: "ilse_shortcuts#back", text: "Something else.", next: "ilse_root" },
      LEAVE("ilse_shortcuts#bye"),
    ],
  },
  {
    id: "ilse_charter",
    text:
      "Clause fourteen. Any person within the wall is counted, is owed the wall's protection, and "
      + "is owed an accurate record of what they are owed. That is the entire clause. It has "
      + "outlived the company that wrote it, which I find I do not mind.",
    options: [
      { id: "ilse_charter#back", text: "Something else.", next: "ilse_root" },
      LEAVE("ilse_charter#bye"),
    ],
  },
];

/** Harrow: eight words, twice, and then he is finished talking. */
const HARROW: DialogueNodeDef[] = [
  {
    id: "harrow_root",
    text: "Metal costs. Skill does not. Which are you short of?",
    variants: [
      {
        when: [{ kind: "questStatus", questId: "cold_iron", status: "active", reason: "" }],
        text: "Still on the dagger. Come back when it is done.",
      },
      {
        when: [{ kind: "questStatus", questId: "cold_iron", status: "complete", reason: "" }],
        text: "You made one. Now you can buy one.",
      },
    ],
    options: [
      {
        id: "harrow_root#offer",
        text: "Sell me a weapon.",
        showIf: [{ kind: "questStatus", questId: "cold_iron", status: "unstarted", reason: "" }],
        next: "harrow_cold_iron_offer",
      },
      {
        id: "harrow_root#progress",
        text: "How is the dagger meant to go?",
        showIf: [{ kind: "questStatus", questId: "cold_iron", status: "active", reason: "" }],
        next: "harrow_cold_iron_check",
      },
      {
        id: "harrow_root#done",
        text: "The dagger held.",
        showIf: [{ kind: "questStatus", questId: "cold_iron", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "cold_iron", min: 4,
            reason: "Harrow will not hear about the dagger until you have made it and used it.",
          },
        ],
        next: "harrow_cold_iron_done",
      },
      { id: "harrow_root#tiers", text: "What comes after Grithe?", next: "harrow_tiers" },
      {
        id: "harrow_root#kaldite",
        text: "Sell me something in Kaldite.",
        requires: [
          {
            kind: "skill", skill: "smithing", level: 10,
            reason: "Harrow will not sell Kaldite work below Smithing 10. He says it would be a waste of the bar.",
          },
        ],
        next: "harrow_kaldite",
      },
      LEAVE("harrow_root#bye"),
    ],
  },
  {
    id: "harrow_cold_iron_offer",
    text:
      "No. Make one first. Six Grithe out of the Bracken Pit, locationId bracken_pit. Two bars at "
      + "my furnace, entity coldbrace_furnace. A dagger at my anvil, entity coldbrace_anvil. Then "
      + "put it in something and tell me it held.",
    options: [
      {
        id: "harrow_cold_iron_offer#accept",
        text: "Fine. Six ore, two bars, a dagger.",
        effects: [{ kind: "startQuest", questId: "cold_iron" }],
        next: "harrow_cold_iron_accepted",
      },
      { id: "harrow_cold_iron_offer#no", text: "I will buy elsewhere.", next: null },
    ],
  },
  {
    id: "harrow_cold_iron_accepted",
    text:
      "Good. Pit is north, one hundred and sixty metres. Take the east gate. Skitterlings on the "
      + "brook flats when you are ready to test it, around minus eighty-eight, minus seventy.",
    options: [
      { id: "harrow_cold_iron_accepted#back", text: "Anything else?", next: "harrow_root" },
      LEAVE("harrow_cold_iron_accepted#bye"),
    ],
  },
  {
    id: "harrow_cold_iron_check",
    text: "Ore, bar, dagger, use it. In that order. I do not explain twice.",
    variants: [
      {
        when: [{ kind: "questStage", questId: "cold_iron", min: 1, max: 1, reason: "" }],
        text: "You have the ore. Furnace is by the anvil. Two bars.",
      },
      {
        when: [{ kind: "questStage", questId: "cold_iron", min: 2, max: 2, reason: "" }],
        text: "Bars are made. Anvil next. A dagger, not a sword. You are not ready for a sword.",
      },
      {
        when: [{ kind: "questStage", questId: "cold_iron", min: 3, max: 3, reason: "" }],
        text: "Wear it. Then find three Skitterlings. Carrying a blade is not owning one.",
      },
      {
        when: [{ kind: "questStage", questId: "cold_iron", min: 4, reason: "" }],
        text: "Then say so.",
      },
    ],
    options: [
      { id: "harrow_cold_iron_check#back", text: "Right.", next: "harrow_root" },
      LEAVE("harrow_cold_iron_check#bye"),
    ],
  },
  {
    id: "harrow_cold_iron_done",
    text:
      "Then it held. Take the hatchet, take the food, take the marks. You know how the whole "
      + "trade works now. Everything after this is a bigger fire.",
    options: [
      { id: "harrow_cold_iron_done#back", text: "Bigger fire?", next: "harrow_tiers" },
      LEAVE("harrow_cold_iron_done#bye"),
    ],
  },
  {
    id: "harrow_tiers",
    text:
      "Grithe here. Corven in Vellenwood, green in the break. Kaldite on the moor, blue-black, "
      + "splits with a line like lightning. Same three steps every time. Ore, bar, thing.",
    options: [
      { id: "harrow_tiers#back", text: "Something else.", next: "harrow_root" },
      LEAVE("harrow_tiers#bye"),
    ],
  },
  {
    id: "harrow_kaldite",
    text: "Kaldite dagger. Kaldite sword. Kaldite plate if you have the bars. Stall is behind me.",
    options: [
      { id: "harrow_kaldite#back", text: "Something else.", next: "harrow_root" },
      LEAVE("harrow_kaldite#bye"),
    ],
  },
];

/**
 * Dorn's tree carries the counting puzzle. Three answer bands, all three selectable, and the
 * routing is decided by `nextIf` against the `last_seam_yield` counter the quest system recorded
 * off the real `resource.depleted` event. There is no "correct" option in the data; there is a
 * correct answer in the world, which is the difference between a puzzle and a quiz.
 */
const DORN: DialogueNodeDef[] = [
  {
    id: "dorn_root",
    text:
      "Four. Four loads a seam, that is what the ledger says, four, and I have signed it nine "
      + "hundred and, no, nine hundred and forty-one times. Four. Have you ever seen a seam give "
      + "four?",
    variants: [
      {
        when: [{ kind: "questStatus", questId: "dorns_tally", status: "complete", reason: "" }],
        text:
          "Eleven point four average across the last six. Eleven point four! And the ledger said "
          + "four. Nine years. Do not tell the Warden how long it took me.",
      },
      {
        when: [{ kind: "questStatus", questId: "dorns_tally", status: "active", reason: "" }],
        text: "Well? What did it give? Not four. It never gives four.",
      },
    ],
    options: [
      {
        id: "dorn_root#offer",
        text: "How many does a seam give?",
        showIf: [{ kind: "questStatus", questId: "dorns_tally", status: "unstarted", reason: "" }],
        next: "dorn_tally_offer",
      },
      {
        id: "dorn_root#answer",
        text: "I worked a seam to the bottom. Here is the count.",
        showIf: [{ kind: "questStatus", questId: "dorns_tally", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "dorns_tally", min: 1, max: 1,
            reason: "Dorn wants a number from a seam you personally emptied. Work one out first.",
          },
        ],
        next: "dorn_tally_answer",
      },
      {
        id: "dorn_root#sign",
        text: "The vault holds fifteen. Sign the page.",
        showIf: [{ kind: "questStatus", questId: "dorns_tally", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "dorns_tally", min: 3,
            reason: "The bank has to agree with the ledger first. Fifteen Grithe ore in the Coldbrace vault.",
          },
        ],
        next: "dorn_tally_signed",
      },
      { id: "dorn_root#pit", text: "Tell me about the Bracken Pit.", next: "dorn_pit" },
      LEAVE("dorn_root#bye"),
    ],
  },
  {
    id: "dorn_tally_offer",
    text:
      "Nobody knows! That is the, that is exactly the problem. Go up to the pit, locationId "
      + "bracken_pit, pick one seam, and stay on it until it is finished. Not until you are bored. "
      + "Until it is empty and it tells you so. Then come back with the number.",
    options: [
      {
        id: "dorn_tally_offer#accept",
        text: "One seam, all the way down. Fine.",
        effects: [{ kind: "startQuest", questId: "dorns_tally" }],
        next: "dorn_tally_accepted",
      },
      { id: "dorn_tally_offer#no", text: "I have counting of my own to do.", next: null },
    ],
  },
  {
    id: "dorn_tally_accepted",
    text:
      "One seam. One. If you swap nodes halfway the number is worthless and I will know, because "
      + "the number will be wrong, and I will know it is wrong, because I know what wrong looks "
      + "like, I have signed it nine hundred and forty-one times.",
    options: [
      { id: "dorn_tally_accepted#back", text: "Understood.", next: "dorn_root" },
      LEAVE("dorn_tally_accepted#bye"),
    ],
  },
  {
    id: "dorn_tally_answer",
    text:
      "Go on then. Which band? And be honest, I would rather a true four than a flattering "
      + "twelve. I would not, actually, but say it anyway.",
    options: [
      {
        id: "dorn_tally_answer#low",
        text: "Eight loads or fewer.",
        nextIf: [
          {
            when: [{ kind: "questCounter", questId: "dorns_tally", counter: "last_seam_yield", max: 8, reason: "" }],
            next: "dorn_tally_correct",
          },
        ],
        next: "dorn_tally_wrong",
      },
      {
        id: "dorn_tally_answer#mid",
        text: "Between nine and twelve.",
        nextIf: [
          {
            when: [
              { kind: "questCounter", questId: "dorns_tally", counter: "last_seam_yield", min: 9, max: 12, reason: "" },
            ],
            next: "dorn_tally_correct",
          },
        ],
        next: "dorn_tally_wrong",
      },
      {
        id: "dorn_tally_answer#high",
        text: "Thirteen or more.",
        nextIf: [
          {
            when: [{ kind: "questCounter", questId: "dorns_tally", counter: "last_seam_yield", min: 13, reason: "" }],
            next: "dorn_tally_correct",
          },
        ],
        next: "dorn_tally_wrong",
      },
      { id: "dorn_tally_answer#back", text: "Let me check my count again.", next: "dorn_root" },
    ],
  },
  {
    id: "dorn_tally_wrong",
    text:
      "No. No, that is, that does not match anything, and I need it to match something. Go back "
      + "up. Work another seam down to nothing and read what it gives you when it gives out. The "
      + "pit will not mind. The pit has never minded.",
    options: [
      { id: "dorn_tally_wrong#back", text: "I will count it again.", next: "dorn_root" },
      LEAVE("dorn_tally_wrong#bye"),
    ],
  },
  {
    id: "dorn_tally_correct",
    text:
      "That. That is a real number. Say it again while I write it. Nine years of four. Right, "
      + "one more thing and it is finished: put fifteen Grithe ore in the vault, entity "
      + "coldbrace_bank, so the store agrees with the page. A number nobody can weigh is a rumour.",
    options: [
      { id: "dorn_tally_correct#back", text: "Fifteen in the vault. Done.", next: "dorn_root" },
      LEAVE("dorn_tally_correct#bye"),
    ],
  },
  {
    id: "dorn_tally_signed",
    text:
      "Signed. Ledger, vault and pit, all three saying the same thing on the same day. Take the "
      + "pickaxe, it is a good one, and take this before I count it again and change my mind.",
    options: [
      { id: "dorn_tally_signed#back", text: "Good luck with the Warden.", next: "dorn_root" },
      LEAVE("dorn_tally_signed#bye"),
    ],
  },
  {
    id: "dorn_pit",
    text:
      "Six Grithe seams and two stone faces, one hundred and sixty metres due north, locationId "
      + "bracken_pit. A seam comes back about twenty-one seconds after it empties, so if you work "
      + "them in a ring the first is ready before the last runs out. That much I do know.",
    options: [
      { id: "dorn_pit#back", text: "Something else.", next: "dorn_root" },
      LEAVE("dorn_pit#bye"),
    ],
  },
];

/** Syb: flat delivery, weather and hunger in the same tone. */
const SYB: DialogueNodeDef[] = [
  {
    id: "syb_root",
    text:
      "Wind off the moor, cold, steady, been like it for eleven weeks. I have eaten cold food for "
      + "eleven weeks as well. Both facts. Neither improving.",
    variants: [
      {
        when: [{ kind: "questStatus", questId: "bright_water", status: "complete", reason: "" }],
        text:
          "I have eaten something hot in the last month. It has changed my opinion of the month. "
          + "Ask me where the water is anywhere and I will tell you.",
      },
      {
        when: [{ kind: "questStatus", questId: "bright_water", status: "active", reason: "" }],
        text: "Still cold. Still steady. Still waiting.",
      },
    ],
    options: [
      {
        id: "syb_root#offer",
        text: "Why has nobody cooked for you?",
        showIf: [{ kind: "questStatus", questId: "bright_water", status: "unstarted", reason: "" }],
        next: "syb_meal_offer",
      },
      {
        id: "syb_root#deliver",
        text: "Sit down. Food.",
        showIf: [{ kind: "questStatus", questId: "bright_water", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "bright_water", min: 3,
            reason: "Syb wants the whole meal at once: grain grown, fish caught, fish cooked.",
          },
          {
            kind: "item", itemId: "seared_minnow", quantity: 2,
            reason: "You need 2 Seared Minnow in your bag. Burnt ones do not count.",
          },
          {
            kind: "item", itemId: "bittergrain", quantity: 3,
            reason: "You need 3 Bittergrain in your bag.",
          },
        ],
        effects: [
          { kind: "takeItem", itemId: "seared_minnow", quantity: 2 },
          { kind: "takeItem", itemId: "bittergrain", quantity: 3 },
        ],
        next: "syb_meal_eaten",
      },
      { id: "syb_root#water", text: "Where is the water around here?", next: "syb_water" },
      { id: "syb_root#march", text: "What is out on the open march?", next: "syb_march" },
      LEAVE("syb_root#bye"),
    ],
  },
  {
    id: "syb_meal_offer",
    text:
      "Because everyone here is busy and I am not anyone's problem. If you want to make me your "
      + "problem: grain out of Marchfield, locationId marchfield_farm, four seeds, take these. "
      + "Fish out of Redsill Shallows, locationId redsill_shallows. Cook them on Harrow's range, "
      + "entity coldbrace_range. Bring the lot back here.",
    options: [
      {
        id: "syb_meal_offer#accept",
        text: "Grain, fish, fire. I can do that.",
        effects: [{ kind: "startQuest", questId: "bright_water" }],
        next: "syb_meal_accepted",
      },
      { id: "syb_meal_offer#no", text: "I would burn it.", next: null },
    ],
  },
  {
    id: "syb_meal_accepted",
    text:
      "You will burn about half of them at Cooking 1. That is the rule, not your hands. Cook "
      + "spares. Bittergrain takes about four minutes in the ground and does not care whether you "
      + "are watching it.",
    options: [
      { id: "syb_meal_accepted#back", text: "Back shortly.", next: "syb_root" },
      LEAVE("syb_meal_accepted#bye"),
    ],
  },
  {
    id: "syb_meal_eaten",
    text:
      "Hm. Right. That is, yes. Good. Take the rod, it was my father's and it is better than "
      + "anything the stall sells, and take the seeds, and stop looking at me like that.",
    options: [
      { id: "syb_meal_eaten#back", text: "Where is the water in Vellenwood?", next: "syb_water" },
      LEAVE("syb_meal_eaten#bye"),
    ],
  },
  {
    id: "syb_water",
    text:
      "Three places worth a line. Redsill Shallows here, locationId redsill_shallows, minnow, "
      + "shallow and red-silted. Blackwater Pools in Vellenwood, locationId blackwater_pools, "
      + "bramble trout, deeper than they look and colder than they look. Cairn Tarns on the moor, "
      + "locationId cairn_tarns, cragfin, and a second pair at far_tarn across the gap.",
    options: [
      { id: "syb_water#back", text: "Something else.", next: "syb_root" },
      LEAVE("syb_water#bye"),
    ],
  },
  {
    id: "syb_march",
    text:
      "Skitterlings in the wet ground by the brook, minus eighty-eight, minus seventy. They will "
      + "not start it. Marchwolf pups on the rise at the Open March, minus two-fifty, thirty. "
      + "They will. Neither will kill you if you have eaten. That is most of what I know and all "
      + "of what matters.",
    options: [
      { id: "syb_march#back", text: "Something else.", next: "syb_root" },
      LEAVE("syb_march#bye"),
    ],
  },
];

/** Bel: volume, exclamation, and a distance that grows every time he says it. */
const BEL: DialogueNodeDef[] = [
  {
    id: "bel_root",
    text:
      "You! Settle something! The Warden says the pit road is the fast way. The Warden! Who has "
      + "walked it, what, twice? Three times? I have walked it four thousand times and I am "
      + "telling you the road is a lie the road tells about itself!",
    variants: [
      {
        when: [
          { kind: "questStatus", questId: "the_carters_wager", status: "complete", reason: "" },
          { kind: "questFlag", questId: "the_carters_wager", flag: "told_the_truth", reason: "" },
        ],
        text:
          "There you are. Honest one. Cost me two weeks of cart duty and I would do it again, "
          + "because now when I say a thing about a distance, people check, and I am right.",
      },
      {
        when: [{ kind: "questStatus", questId: "the_carters_wager", status: "complete", reason: "" }],
        text:
          "Ha! Best time on record! Unbeatable! Nobody has beaten it! Nobody has attempted it! "
          + "Do not attempt it.",
      },
      {
        when: [{ kind: "questStatus", questId: "the_carters_wager", status: "active", reason: "" }],
        text: "Are you running it or are you standing here? Those are different activities!",
      },
    ],
    options: [
      {
        id: "bel_root#offer",
        text: "What exactly is the bet?",
        showIf: [{ kind: "questStatus", questId: "the_carters_wager", status: "unstarted", reason: "" }],
        next: "bel_wager_offer",
      },
      {
        id: "bel_root#report",
        text: "I ran it. Here is my time.",
        showIf: [{ kind: "questStatus", questId: "the_carters_wager", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "the_carters_wager", min: 2,
            reason: "Bel wants both obstacles run: the Brookvault Planks first, then the Wall Vault.",
          },
        ],
        next: "bel_wager_report",
      },
      { id: "bel_root#cousin", text: "Tell me about your cousin.", next: "bel_cousin" },
      LEAVE("bel_root#bye"),
    ],
  },
  {
    id: "bel_wager_offer",
    text:
      "Two weeks of cart duty, that is the bet! She says road. I say over. Over the planks at the "
      + "brook, entity brookvault_planks, and over our own north wall, entity wall_vault. You "
      + "cannot do the wall cold, mind, you have to have some legs on you first. Vault the planks "
      + "until you are quick at it. Then the wall. Then come and tell me a number!",
    options: [
      {
        id: "bel_wager_offer#accept",
        text: "Planks, then wall. I will bring you a number.",
        effects: [{ kind: "startQuest", questId: "the_carters_wager" }],
        next: "bel_wager_accepted",
      },
      { id: "bel_wager_offer#no", text: "I am on the Warden's side.", next: "bel_snub" },
    ],
  },
  {
    id: "bel_snub",
    text: "The Warden's side! Everyone is on the Warden's side! That is not the same as being right!",
    options: [
      { id: "bel_snub#back", text: "All right, tell me the bet again.", next: "bel_wager_offer" },
      LEAVE("bel_snub#bye"),
    ],
  },
  {
    id: "bel_wager_accepted",
    text:
      "That is the spirit! The planks are at minus seventy-eight, minus thirty, anyone can do "
      + "those, my aunt could do those. The wall wants some Agility in you, three of it, which is "
      + "what the planks are for! Go! Go and be quick and come back slow so I can see your face!",
    options: [
      { id: "bel_wager_accepted#back", text: "Right.", next: "bel_root" },
      LEAVE("bel_wager_accepted#bye"),
    ],
  },
  {
    id: "bel_wager_report",
    text:
      "Numbers! Give me numbers! And keep your voice up, the Warden is standing right there and I "
      + "want this on the record.",
    options: [
      {
        id: "bel_wager_report#truth",
        text: "Honestly? The wall saves about forty metres. Useful, not miraculous.",
        effects: [{ kind: "setFlag", questId: "the_carters_wager", flag: "told_the_truth" }],
        next: "bel_wager_settled",
      },
      {
        id: "bel_wager_report#stretch",
        text: "Call it a hundred metres saved. Round numbers travel better.",
        effects: [{ kind: "setFlag", questId: "the_carters_wager", flag: "told_a_stretch" }],
        next: "bel_wager_settled",
      },
      {
        id: "bel_wager_report#whopper",
        text: "I did it in four seconds and landed on the roof of the vault.",
        effects: [{ kind: "setFlag", questId: "the_carters_wager", flag: "told_a_whopper" }],
        next: "bel_wager_settled",
      },
    ],
  },
  {
    id: "bel_wager_settled",
    text:
      "There! You heard it! Cart duty! Two weeks! Take your cut, you have earned it, and if "
      + "anyone asks, it was further than that.",
    variants: [
      {
        when: [{ kind: "questFlag", questId: "the_carters_wager", flag: "told_the_truth", reason: "" }],
        text:
          "Forty. Forty metres. That is, hm. That is still faster, is it not? That is still "
          + "faster. Warden! It is still faster! Take your cut. You could have lied and you did "
          + "not, and I find I mind that less than I expected.",
      },
      {
        when: [{ kind: "questFlag", questId: "the_carters_wager", flag: "told_a_whopper", reason: "" }],
        text:
          "The roof! Of the vault! Did you hear that, Warden? ... She is writing it down. She is "
          + "writing all of it down. Take your cut and go, go now, and do not come back through "
          + "the square this week.",
      },
    ],
    options: [
      { id: "bel_wager_settled#cousin", text: "Your cousin. Now.", next: "bel_cousin" },
      LEAVE("bel_wager_settled#bye"),
    ],
  },
  {
    id: "bel_cousin",
    text:
      "My cousin walked from here to Rootfall in a morning! A morning! Now, people say that is "
      + "not possible, and to those people I say: he had a very good morning.",
    options: [
      { id: "bel_cousin#back", text: "Something else.", next: "bel_root" },
      LEAVE("bel_cousin#bye"),
    ],
  },
];

// ==========================================================================
// VELLENWOOD
// ==========================================================================

/** Ansel: slow, reverent, names trees and job titles. */
const ANSEL: DialogueNodeDef[] = [
  {
    id: "ansel_root",
    text:
      "Stand a moment. The stand does not like a fast walker. ... There. Now. You are a miner, or "
      + "a cutter. Cutter. I can tell by the shoulders. What do you want from my trees?",
    variants: [
      {
        when: [{ kind: "questStatus", questId: "crooked_grain", status: "complete", reason: "" }],
        text:
          "Cutter. You went and looked at the split one. Not many do. Most take the eight and go "
          + "home and never ask what the ninth was for.",
      },
      {
        when: [{ kind: "questStatus", questId: "crooked_grain", status: "active", reason: "" }],
        text: "Eight. Not nine. And you have somewhere to be first.",
      },
    ],
    options: [
      {
        id: "ansel_root#offer",
        text: "I want to fell Duskoak.",
        showIf: [{ kind: "questStatus", questId: "crooked_grain", status: "unstarted", reason: "" }],
        requires: [
          {
            kind: "skill", skill: "woodcutting", level: 5,
            reason: "Ansel will not put a Duskoak in front of anyone under Woodcutting 5. He says the tree deserves better.",
          },
        ],
        next: "ansel_grain_offer",
      },
      {
        id: "ansel_root#deliver",
        text: "Eight Duskoak logs, and I went and saw the split one.",
        showIf: [{ kind: "questStatus", questId: "crooked_grain", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "crooked_grain", min: 2,
            reason: "Fell the eight first, then go and stand at the Split Duskoak, entity split_duskoak.",
          },
          {
            kind: "item", itemId: "duskoak_log", quantity: 8,
            reason: "You need 8 Duskoak logs in your bag. Logs do not stack, so that is 8 slots.",
          },
        ],
        effects: [{ kind: "takeItem", itemId: "duskoak_log", quantity: 8 }],
        next: "ansel_logs_taken",
      },
      { id: "ansel_root#stand", text: "Tell me about the stand.", next: "ansel_stand" },
      { id: "ansel_root#thornline", text: "What is at the Thornline?", next: "ansel_thornline" },
      LEAVE("ansel_root#bye"),
    ],
  },
  {
    id: "ansel_grain_offer",
    text:
      "Eight. You may have eight. Duskoak Stand, locationId vellenwood_canopy, ten trees there "
      + "and eight is what the stand can spare this season. ... And before you bring them to me, "
      + "you will go east and stand under the Split Duskoak, entity split_duskoak, out past the "
      + "pools at one-seventy, one-twelve. I want you to have seen it. That is the whole of the "
      + "price.",
    options: [
      {
        id: "ansel_grain_offer#accept",
        text: "Eight logs, and I go and look at the ninth.",
        effects: [{ kind: "startQuest", questId: "crooked_grain" }],
        next: "ansel_grain_accepted",
      },
      { id: "ansel_grain_offer#no", text: "I only wanted the wood.", next: "ansel_refused" },
    ],
  },
  {
    id: "ansel_refused",
    text: "Then you only get the wood you can buy. ... Come back when you have the time. It keeps.",
    options: [
      { id: "ansel_refused#back", text: "Wait. Tell me again.", next: "ansel_grain_offer" },
      LEAVE("ansel_refused#bye"),
    ],
  },
  {
    id: "ansel_grain_accepted",
    text:
      "Eight. And bring them here, do not bank them, I want to count them out of your hands. ... "
      + "The pools are the safe way east. The Fallen Duskoak, entity fallen_duskoak, is the fast "
      + "way and it wants Agility five in you.",
    options: [
      { id: "ansel_grain_accepted#back", text: "Understood.", next: "ansel_root" },
      LEAVE("ansel_grain_accepted#bye"),
    ],
  },
  {
    id: "ansel_logs_taken",
    text:
      "Eight. Good weight, clean ends. ... And you saw it. Split top to root, and green on the "
      + "west side, still. Fifty years like that. That is why the rule is eight and never the "
      + "ninth: a thing can be that far gone and still be working. Take the hatchet. Corven. It "
      + "will hold an edge in the deep stand.",
    options: [
      { id: "ansel_logs_taken#back", text: "What else may I cut?", next: "ansel_stand" },
      LEAVE("ansel_logs_taken#bye"),
    ],
  },
  {
    id: "ansel_stand",
    text:
      "Ten Duskoak at the stand, locationId vellenwood_canopy, north-west of Rootfall. The canopy "
      + "closes over it, so the walking is the hard part, not the cutting. The Canopy Walk, entity "
      + "canopy_walk, goes over the top of the wet ground and wants Agility six. It saves near "
      + "eighty metres. I do not use it. I am old and I like the ground.",
    options: [
      { id: "ansel_stand#back", text: "Something else.", next: "ansel_root" },
      LEAVE("ansel_stand#bye"),
    ],
  },
  {
    id: "ansel_thornline",
    text:
      "The Thornbound keep to the edges of the clearings. They do not come in past the standing "
      + "stones, entity thornline_stones. ... Nobody knows why and I will not be the one to find "
      + "out. Trapper Mott sets his line out that way, which tells you what Mott is like.",
    options: [
      { id: "ansel_thornline#back", text: "Something else.", next: "ansel_root" },
      LEAVE("ansel_thornline#bye"),
    ],
  },
];

/** Juno: jargon, then the translation, in one breath. */
const JUNO: DialogueNodeDef[] = [
  {
    id: "juno_root",
    text:
      "Careful, that is a full seam allowance on the bench, which means: do not lean on it. You "
      + "here for cord, hide, shafts, or advice? Three of those are free.",
    variants: [
      {
        when: [{ kind: "questStatus", questId: "knots_and_names", status: "complete", reason: "" }],
        text:
          "There she is, the fletcher. You know what a shaft is for now, which puts you ahead of "
          + "most of Rootfall. Lean on the bench if you like. You have earned it.",
      },
      {
        when: [{ kind: "questStatus", questId: "knots_and_names", status: "active", reason: "" }],
        text: "Four shafts, five shards. Come back when you have both, not when you have one.",
      },
    ],
    options: [
      {
        id: "juno_root#offer",
        text: "Teach me the parts trades.",
        showIf: [{ kind: "questStatus", questId: "knots_and_names", status: "unstarted", reason: "" }],
        next: "juno_parts_offer",
      },
      {
        id: "juno_root#deliver",
        text: "Four shafts and five shards, as asked.",
        showIf: [{ kind: "questStatus", questId: "knots_and_names", status: "active", reason: "" }],
        requires: [
          {
            // Without this gate a player who arrives holding everything could hand it all over in
            // the same tick the first two stages were still checking for it, and hand themselves a
            // dead quest. The stage gate makes the order deterministic.
            kind: "questStage", questId: "knots_and_names", min: 2,
            reason: "Make the four shafts and the five shards first; Juno counts them in that order.",
          },
          {
            kind: "item", itemId: "palewood_shaft", quantity: 4,
            reason: "You need 4 Palewood shafts. Fletch them from Palewood logs at entity coldbrace_fletching.",
          },
          {
            kind: "item", itemId: "essence_shard", quantity: 5,
            reason: "You need 5 Essence Shards. Craft them from gems at entity coldbrace_crafting.",
          },
        ],
        effects: [
          { kind: "takeItem", itemId: "palewood_shaft", quantity: 4 },
          { kind: "takeItem", itemId: "essence_shard", quantity: 5 },
        ],
        next: "juno_parts_taken",
      },
      { id: "juno_root#shards", text: "What is an essence shard actually doing?", next: "juno_shards" },
      { id: "juno_root#hide", text: "What do you make out of hide?", next: "juno_hide" },
      LEAVE("juno_root#bye"),
    ],
  },
  {
    id: "juno_parts_offer",
    text:
      "Parts trades, both of them, one afternoon. Fletching first: shafts, which is a straight "
      + "length of split log, which is to say, sticks, but good ones. Four Palewood shafts. Then "
      + "crafting: five essence shards off gems. Here, take three Pale Quartz to start, I have a "
      + "drawer of them and no patience.",
    options: [
      {
        id: "juno_parts_offer#accept",
        text: "Four shafts, five shards.",
        effects: [{ kind: "startQuest", questId: "knots_and_names" }],
        next: "juno_parts_accepted",
      },
      { id: "juno_parts_offer#no", text: "Another time.", next: null },
    ],
  },
  {
    id: "juno_parts_accepted",
    text:
      "Benches are in Coldbrace, both of them, which is a walk, which is why I gave you the "
      + "quartz. Fletching bench is entity coldbrace_fletching, crafting table is entity "
      + "coldbrace_crafting, they are four metres apart on the west side of the square. Palewood "
      + "logs come out of the copse at locationId palewood_copse.",
    options: [
      { id: "juno_parts_accepted#back", text: "Back soon.", next: "juno_root" },
      LEAVE("juno_parts_accepted#bye"),
    ],
  },
  {
    id: "juno_parts_taken",
    text:
      "Four and five. Grain runs true on all four, which means: you did not rush them. Right. "
      + "Wraps, take them, bramblehide, they will not stop a Cairnwight but they will stop the "
      + "cold. And a stack of shards, because you are going to need them the first time you point "
      + "a staff at something.",
    options: [
      { id: "juno_parts_taken#shards", text: "So what is a shard doing in there?", next: "juno_shards" },
      LEAVE("juno_parts_taken#bye"),
    ],
  },
  {
    id: "juno_shards",
    text:
      "It is the consumable half of a cast. Staff shapes it, shard pays for it. One shard, one "
      + "cast, and when the bag is empty the spell fails with NOT_ENOUGH_ITEMS and you look "
      + "foolish in front of something with teeth. Gems drop while you mine. Quartz here, amber "
      + "in the wood, garnet on the moor.",
    options: [
      { id: "juno_shards#back", text: "Something else.", next: "juno_root" },
      LEAVE("juno_shards#bye"),
    ],
  },
  {
    id: "juno_hide",
    text:
      "Coarse hide off the march, bramble hide off anything with a thorn in it, and wight shroud, "
      + "which is not hide and which I do not enjoy handling. Robes and wraps, mostly. Anything "
      + "that has to bend rather than stop a blade.",
    options: [
      { id: "juno_hide#back", text: "Something else.", next: "juno_root" },
      LEAVE("juno_hide#bye"),
    ],
  },
];

/** Mott: sincere misery, itemised. */
const MOTT: DialogueNodeDef[] = [
  {
    id: "mott_root",
    text:
      "Eleven traps. Eleven days. Nothing in any of them, not a hair, not a print, not so much as "
      + "a disappointed look. Eleven. I counted them again this morning in case I had miscounted "
      + "and there were fewer. There were not. There were eleven.",
    variants: [
      {
        when: [
          { kind: "questStatus", questId: "eleven_empty_days", status: "complete", reason: "" },
          { kind: "questFlag", questId: "eleven_empty_days", flag: "told_him_the_truth", reason: "" },
        ],
        text:
          "Upside down. Eleven of them. For eleven days. My father set traps for forty years and "
          + "I have been putting the open end in the ground. ... You could have not told me. I "
          + "want you to know that I am aware you could have not told me.",
      },
      {
        when: [{ kind: "questStatus", questId: "eleven_empty_days", status: "complete", reason: "" }],
        text:
          "Skitterlings. Skitterlings all along, eating the bait out from under. Well. That is a "
          + "relief, in the way that a thing can be a relief and still leave you with eleven "
          + "empty traps.",
      },
      {
        when: [{ kind: "questStatus", questId: "eleven_empty_days", status: "active", reason: "" }],
        text: "Twelve days, now. I have started counting the days you have been gone as well.",
      },
    ],
    options: [
      {
        id: "mott_root#offer",
        text: "Do you want someone to walk the line for you?",
        showIf: [{ kind: "questStatus", questId: "eleven_empty_days", status: "unstarted", reason: "" }],
        next: "mott_line_offer",
      },
      {
        id: "mott_root#report",
        text: "I walked your line.",
        showIf: [{ kind: "questStatus", questId: "eleven_empty_days", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "eleven_empty_days", min: 2,
            reason: "Walk all four sites and clear the Bramble Skitterlings first.",
          },
        ],
        next: "mott_report",
      },
      { id: "mott_root#luck", text: "Has it always gone like this for you?", next: "mott_luck" },
      LEAVE("mott_root#bye"),
    ],
  },
  {
    id: "mott_line_offer",
    text:
      "Would you? Nobody ever does. Four places: Blackwater Pools, locationId blackwater_pools. "
      + "Gorge Head, locationId gorge_head. The Thornline, locationId thornline_camp, and I am "
      + "sorry about the Thornline. Gorge Ford, locationId gorge_ford. Look at all four. Then "
      + "kill three of whatever is eating my bait, because something is.",
    options: [
      {
        id: "mott_line_offer#accept",
        text: "Four sites, three of whatever it is.",
        effects: [{ kind: "startQuest", questId: "eleven_empty_days" }],
        next: "mott_line_accepted",
      },
      { id: "mott_line_offer#no", text: "I am sorry about your traps.", next: "mott_luck" },
    ],
  },
  {
    id: "mott_line_accepted",
    text:
      "Thank you. Genuinely. The Thornbound at the Thornline are territorial, so they will not "
      + "chase you far, they will simply be extremely present. Bramble Skitterlings sit between "
      + "here and there, around one-fifty, one-twenty-eight, and they are the ones I would bet "
      + "on for the bait.",
    options: [
      { id: "mott_line_accepted#back", text: "Back when I have looked.", next: "mott_root" },
      LEAVE("mott_line_accepted#bye"),
    ],
  },
  {
    id: "mott_report",
    text:
      "Well? Do not soften it. Actually, do soften it. No. Do not. ... Do slightly soften it.",
    options: [
      {
        id: "mott_report#kind",
        text: "Skitterlings. They have been working the bait out from under the plates.",
        effects: [{ kind: "setFlag", questId: "eleven_empty_days", flag: "let_him_off" }],
        next: "mott_verdict_given",
      },
      {
        id: "mott_report#truth",
        text: "Skitterlings, yes. Also, Mott, all eleven traps are set upside down.",
        effects: [{ kind: "setFlag", questId: "eleven_empty_days", flag: "told_him_the_truth" }],
        next: "mott_verdict_given",
      },
    ],
  },
  {
    id: "mott_verdict_given",
    text:
      "Skitterlings. Of course it is skitterlings. It is always the small ones. Here, take the "
      + "trout, I smoked them myself and they are the one thing I have not got wrong.",
    variants: [
      {
        when: [{ kind: "questFlag", questId: "eleven_empty_days", flag: "told_him_the_truth", reason: "" }],
        text:
          "Upside... ah. Ah. Yes. Yes, that would do it, would it not. ... Take the trout. Take "
          + "them. No, I insist, I would like you to have something so that the next eleven days "
          + "are at least somebody's good week.",
      },
    ],
    options: [
      { id: "mott_verdict_given#luck", text: "Has it always gone like this?", next: "mott_luck" },
      LEAVE("mott_verdict_given#bye"),
    ],
  },
  {
    id: "mott_luck",
    text:
      "Once. One good week, four years ago. I caught nine in six days and I bought a coat with "
      + "the money. ... Then the coat caught on a Duskoak and tore across the back, and I have "
      + "not had a week since. I still have the coat. I keep it as a record.",
    options: [
      { id: "mott_luck#back", text: "Something else.", next: "mott_root" },
      LEAVE("mott_luck#bye"),
    ],
  },
];

// ==========================================================================
// KARROWMOOR
// ==========================================================================

/** Arden: costs, distances, headcounts, in the order they must be carried out. */
const ARDEN: DialogueNodeDef[] = [
  {
    id: "arden_root",
    text:
      "Highcairn. Nineteen crew, one wall, no dig. We stopped six months ago and we have eaten "
      + "for six months, which is a harder trick than digging. State your business and state it "
      + "in the order you intend to do it.",
    variants: [
      {
        when: [{ kind: "questStatus", questId: "bad_ground", status: "complete", reason: "" }],
        text:
          "Sixteen in the vault and you came over the ledge. That is on the board. Anything you "
          + "want measured on this moor, I have measured it.",
      },
      {
        when: [{ kind: "questStatus", questId: "bad_ground", status: "active", reason: "" }],
        text: "Ten out of the Lower Quarry, one climb, sixteen in the vault. In that order.",
      },
    ],
    options: [
      {
        id: "arden_root#offer",
        text: "You have work.",
        showIf: [{ kind: "questStatus", questId: "bad_ground", status: "unstarted", reason: "" }],
        requires: [
          {
            kind: "skill", skill: "mining", level: 10,
            reason: "Kaldite needs Mining 10. Arden does not hand out work he knows you cannot start.",
          },
          {
            kind: "skill", skill: "agility", level: 10,
            reason: "Sunder Ledge needs Agility 10, and the whole point of the job is the ledge.",
          },
        ],
        next: "arden_ground_offer",
      },
      {
        id: "arden_root#report",
        text: "Sixteen Kaldite are in the vault.",
        showIf: [{ kind: "questStatus", questId: "bad_ground", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "bad_ground", min: 3,
            reason: "Ten mined, the ledge climbed, then sixteen banked. Arden checks the board, not your word.",
          },
        ],
        next: "arden_route_reported",
      },
      { id: "arden_root#ledge", text: "Why does the ledge matter so much to you?", next: "arden_ledge" },
      { id: "arden_root#dig", text: "Why did you stop digging?", next: "arden_dig" },
      LEAVE("arden_root#bye"),
    ],
  },
  {
    id: "arden_ground_offer",
    text:
      "Three things, in this order. One: ten Kaldite out of the Lower Quarry, locationId "
      + "karrowmoor_terraces. Two: climb Sunder Ledge, entity sunder_ledge, at least once, so you "
      + "have the number in your legs and not just on a board. Three: sixteen Kaldite ore in the "
      + "Highcairn vault, entity highcairn_bank_counter. Then tell me which way you walked.",
    options: [
      {
        id: "arden_ground_offer#accept",
        text: "Ten, one climb, sixteen banked.",
        effects: [{ kind: "startQuest", questId: "bad_ground" }],
        next: "arden_ground_accepted",
      },
      { id: "arden_ground_offer#no", text: "Not today.", next: null },
    ],
  },
  {
    id: "arden_ground_accepted",
    text:
      "Good. Figures, since you will want them. Bank to Upper Karrow by road: one hundred and "
      + "eighty-eight metres, three legs, two ramps. Bank to Upper Karrow over the ledge: "
      + "forty-six metres and a six second climb. That is the whole of the argument and it is not "
      + "close.",
    options: [
      { id: "arden_ground_accepted#back", text: "Understood.", next: "arden_root" },
      LEAVE("arden_ground_accepted#bye"),
    ],
  },
  {
    id: "arden_route_reported",
    text:
      "Sixteen. Checked. And you came over the ledge, which the timings say plainly enough. Take "
      + "the pickaxe, it is crew issue and it is better than anything the stall has, and take the "
      + "money before the store hut hears about it.",
    options: [
      { id: "arden_route_reported#ledge", text: "The ledge.", next: "arden_ledge" },
      LEAVE("arden_route_reported#bye"),
    ],
  },
  {
    id: "arden_ledge",
    text:
      "Because the moor is vertical and everybody plans it flat. Three terraces between this "
      + "counter and that seam. A crew that walks the road does four trips a shift. A crew that "
      + "climbs does nine. Same ore, same arms, same day. The route is the job.",
    options: [
      { id: "arden_ledge#back", text: "Something else.", next: "arden_root" },
      LEAVE("arden_ledge#bye"),
    ],
  },
  {
    id: "arden_dig",
    text:
      "Because we hit a room. Twelve metres of black in a grey face, entity "
      + "gravelmaw_mouth_portal, and nineteen crew who all wanted to be somewhere else. I do not "
      + "pay people to be somewhere else. Ask Hale, npc_watcher_hale. It is his rota.",
    options: [
      { id: "arden_dig#back", text: "Something else.", next: "arden_root" },
      LEAVE("arden_dig#bye"),
    ],
  },
];

/** Vess: blunt, physical, changes her own subject. */
const VESS: DialogueNodeDef[] = [
  {
    id: "vess_root",
    text:
      "Nine years on the blue-black. It sparks when you break it. In the dark it keeps sparking "
      + "for a while after, which nobody likes talking about, so. What do you want.",
    variants: [
      {
        when: [{ kind: "questStatus", questId: "sparking_stone", status: "complete", reason: "" }],
        text:
          "Kaldite. That is what it is, that is all it is, and I have watched a spell go into it "
          + "and come back out again and I know what it is doing now. Nine years of calling it "
          + "that. Ridiculous.",
      },
      {
        when: [{ kind: "questStatus", questId: "sparking_stone", status: "active", reason: "" }],
        text: "Staff on. Magic five. Six ore. Get on with it before I lose my nerve about the whole idea.",
      },
    ],
    options: [
      {
        id: "vess_root#offer",
        text: "What does it do in the dark?",
        showIf: [{ kind: "questStatus", questId: "sparking_stone", status: "unstarted", reason: "" }],
        requires: [
          {
            kind: "skill", skill: "mining", level: 10,
            reason: "Vess wants somebody who can actually cut Kaldite. That is Mining 10.",
          },
        ],
        next: "vess_stone_offer",
      },
      {
        id: "vess_root#deliver",
        text: "Six Kaldite. Watch this.",
        showIf: [{ kind: "questStatus", questId: "sparking_stone", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "sparking_stone", min: 2,
            reason: "Equip the staff and get Magic to 5 first. She wants to see it done, not described.",
          },
          {
            kind: "item", itemId: "kaldite_ore", quantity: 6,
            reason: "You need 6 Kaldite ore in your bag.",
          },
        ],
        effects: [{ kind: "takeItem", itemId: "kaldite_ore", quantity: 6 }],
        next: "vess_stone_tested",
      },
      { id: "vess_root#faces", text: "Where are the Kaldite faces?", next: "vess_faces" },
      { id: "vess_root#cairns", text: "Who is stacking the cairns?", next: "vess_cairns" },
      LEAVE("vess_root#bye"),
    ],
  },
  {
    id: "vess_stone_offer",
    text:
      "It holds. Whatever you put in it, it holds it, and it gives it back later when nobody is "
      + "looking. I want somebody to put something in it on purpose so I can stop imagining what "
      + "it is holding. Here. My brother's staff and a dozen shards. Wear the staff, get Magic to "
      + "five with it, and bring me six ore.",
    options: [
      {
        id: "vess_stone_offer#accept",
        text: "Staff on, Magic five, six ore.",
        effects: [{ kind: "startQuest", questId: "sparking_stone" }],
        next: "vess_stone_accepted",
      },
      { id: "vess_stone_offer#no", text: "I would rather not touch it.", next: "vess_refused" },
    ],
  },
  {
    id: "vess_refused",
    text: "No. No, that is fair. That is the reasonable position. I have not held it for nine years.",
    options: [
      { id: "vess_refused#back", text: "Ask me again.", next: "vess_stone_offer" },
      LEAVE("vess_refused#bye"),
    ],
  },
  {
    id: "vess_stone_accepted",
    text:
      "Emberlash is the cheap one, one shard a cast. Scree Skitterlings out at one-seventy, minus "
      + "one-sixty, they are soft and there are six of them. Do not practise on Cairnwights. I "
      + "have seen what a Cairnwight does to somebody practising.",
    options: [
      { id: "vess_stone_accepted#back", text: "Right.", next: "vess_root" },
      LEAVE("vess_stone_accepted#bye"),
    ],
  },
  {
    id: "vess_stone_tested",
    text:
      "Go on. ... There. It took it. It took the whole cast and the fracture line went white and "
      + "then it just, sat there, being a rock. Nine years. It is a rock that likes magic. That "
      + "is all it ever was. Take the focus, take the shards, and take my brother's staff off my "
      + "hands, I never liked looking at it.",
    options: [
      { id: "vess_stone_tested#cairns", text: "Then who is stacking the cairns?", next: "vess_cairns" },
      LEAVE("vess_stone_tested#bye"),
    ],
  },
  {
    id: "vess_faces",
    text:
      "Five in the Lower Quarry, locationId karrowmoor_terraces, terrace one, next to the hole. "
      + "Three at Upper Karrow, locationId upper_karrow_seam, terrace four, and that one runs dry "
      + "if you are any good. Take the ledge up, do not take the road, the road is for carts and "
      + "regret.",
    options: [
      { id: "vess_faces#back", text: "Something else.", next: "vess_root" },
      LEAVE("vess_faces#bye"),
    ],
  },
  {
    id: "vess_cairns",
    text:
      "Not us. Ask Ode, npc_cairnkeeper_ode, she knows every stone up there by name and she has "
      + "gone quiet about it, which is the part that bothers me. Cairnkeeper going quiet. That is "
      + "a weather sign, that is.",
    options: [
      { id: "vess_cairns#back", text: "Something else.", next: "vess_root" },
      LEAVE("vess_cairns#bye"),
    ],
  },
];

/**
 * Ode carries The Long Cairn, including the three-lever puzzle on `ode_long_cairn_levers`.
 *
 * The puzzle is solvable from the text alone. Ode names the three mason's marks (a wedge, a drop,
 * a closed eye), says which of stone, water and dark each mark means, and quotes the crew's
 * ordering rule: "the moor gives stone, then water, then dark". Wedge, drop, eye. All six
 * permutations are offered and all six are selectable, because an option you cannot get wrong is
 * not a puzzle. Two wrong answers reveal a seventh option that simply asks her, so the chain has
 * no dead end.
 */
const ODE: DialogueNodeDef[] = [
  {
    id: "ode_root",
    text:
      "You will forgive me. I am counting. There are four hundred and eleven cairns on this moor "
      + "and it is my office to know the shape of each one. Nineteen of them are the wrong shape "
      + "this season, and I did not put a hand to any of them.",
    variants: [
      {
        when: [{ kind: "questStatus", questId: "long_cairn", status: "complete", reason: "" }],
        text:
          "The hall is kept. The stone is laid and the line is closed, and the gate beyond it is "
          + "open, which is a thing I did and not a thing that happened to me. Ask me anything "
          + "now. I have no more silence to spend.",
      },
      {
        when: [{ kind: "questStatus", questId: "long_cairn", status: "active", reason: "" }],
        text: "You are in the middle of an office. Tell me where you have got to.",
      },
    ],
    options: [
      {
        id: "ode_root#offer",
        text: "Nineteen wrong. Show me one.",
        showIf: [{ kind: "questStatus", questId: "long_cairn", status: "unstarted", reason: "" }],
        requires: [
          {
            kind: "skill", skill: "melee", level: 10,
            reason: "Ode will not send anyone under Melee 10 up the terraces. Cairnwights hold the ground at (100, -110).",
          },
          {
            kind: "skill", skill: "mining", level: 10,
            reason: "Mining 10, because the line ends in a quarry and she will not lead you somewhere you cannot work.",
          },
        ],
        next: "ode_long_cairn_offer",
      },
      {
        id: "ode_root#reported",
        text: "The Great Cairn has been re-stacked.",
        showIf: [{ kind: "questStatus", questId: "long_cairn", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "long_cairn", min: 1, max: 1,
            reason: "Go and see the Great Cairn first: moveTo({ locationId: \"great_cairn\" }).",
          },
        ],
        next: "ode_long_cairn_reported",
      },
      {
        id: "ode_root#levers",
        text: "There is a stone door in the second chamber with three levers on it.",
        showIf: [{ kind: "questStatus", questId: "long_cairn", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "long_cairn", min: 4, max: 4,
            reason: "Clear the Lit Gallery and reach The Collapse first; she will not describe a door you have not found.",
          },
        ],
        next: "ode_long_cairn_levers",
      },
      {
        id: "ode_root#stone",
        text: "The door is open. Give me the keeping-stone.",
        showIf: [{ kind: "questStatus", questId: "long_cairn", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "long_cairn", min: 5, max: 5,
            reason: "The Three-Lever Door has to be open before she will part with the stone.",
          },
        ],
        next: "ode_long_cairn_stone_given",
      },
      {
        // The safety net. Stage 7 checks that the garnet is still in your bag, and a player who
        // sells it would otherwise have a dead chain. `lacksItem` keeps this hidden while you are
        // carrying one, and the counter caps it at three so it is a rescue, not a gem mine.
        id: "ode_root#restone",
        text: "I no longer have the keeping-stone.",
        showIf: [
          { kind: "questStatus", questId: "long_cairn", status: "active", reason: "" },
          { kind: "questStage", questId: "long_cairn", min: 6, max: 6, reason: "" },
          { kind: "lacksItem", itemId: "cairn_garnet", quantity: 1, reason: "" },
        ],
        requires: [
          {
            kind: "questCounter", questId: "long_cairn", counter: "stones_given", max: 2,
            reason: "Ode has cut you three keeping-stones already. She will not cut a fourth, and she is right not to.",
          },
        ],
        effects: [
          { kind: "bumpCounter", questId: "long_cairn", counter: "stones_given" },
          { kind: "giveItem", itemId: "cairn_garnet", quantity: 1 },
        ],
        next: "ode_replacement_stone",
      },
      { id: "ode_root#cairns", text: "What is a cairn for?", next: "ode_cairns" },
      {
        id: "ode_root#under",
        text: "What is under the Great Cairn?",
        requires: [
          {
            kind: "questStatus", questId: "long_cairn", status: "complete",
            reason: "Ode will answer that when the Long Cairn is finished and not one hour before.",
          },
        ],
        next: "ode_under",
      },
      LEAVE("ode_root#bye"),
    ],
  },
  {
    id: "ode_long_cairn_offer",
    text:
      "The Great Cairn, locationId great_cairn, on terrace four. It was head height and forty "
      + "paces round when the quarry opened and it is neither of those things now. Go and stand "
      + "at it and look at the top three courses, then come back and tell me I am not an old "
      + "woman miscounting stones.",
    options: [
      {
        id: "ode_long_cairn_offer#accept",
        text: "I will go and look.",
        effects: [{ kind: "startQuest", questId: "long_cairn" }],
        next: "ode_long_cairn_accepted",
      },
      { id: "ode_long_cairn_offer#no", text: "Count them again first.", next: null },
    ],
  },
  {
    id: "ode_long_cairn_accepted",
    text:
      "Bank, Second Ramp, Third Ramp, then west. Cairnwights hold the middle ground at about one "
      + "hundred, minus one hundred and ten, and they do not leash early. Go fed.",
    options: [
      { id: "ode_long_cairn_accepted#back", text: "Understood.", next: "ode_root" },
      LEAVE("ode_long_cairn_accepted#bye"),
    ],
  },
  {
    id: "ode_long_cairn_reported",
    text:
      "Re-stacked. Not fallen, not robbed. Re-stacked, by something with a sense of order and "
      + "more patience than the living have. ... The nineteen make a line. It runs off terrace "
      + "four, down both ramps and into the quarry face, and it ends at a hole my neighbours have "
      + "a rota for. Go and ask Watcher Hale, npc_watcher_hale, what his rota has actually seen. "
      + "He will tell you if you ask him plainly.",
    options: [
      { id: "ode_long_cairn_reported#back", text: "Hale it is.", next: "ode_root" },
      LEAVE("ode_long_cairn_reported#bye"),
    ],
  },
  {
    id: "ode_long_cairn_levers",
    speaker: "Cairnkeeper Ode",
    text:
      "I know that door. The masons cut it and the masons left a rule with it, and I have the "
      + "rule by heart because it is the sort of thing my office is for.\n\n"
      + "Three levers, side by side, and a mark cut in the lintel above each one. A WEDGE, which "
      + "is the mason's mark for stone. A DROP, which is their mark for water. And a CLOSED EYE, "
      + "which is their mark for the dark. The marks are the only labels; the levers themselves "
      + "are identical.\n\n"
      + "The rule they left is one line: THE MOOR GIVES STONE, THEN WATER, THEN DARK. That is the "
      + "order they meant, and that is the order the door wants, and it is the order in which "
      + "this whole moor was made, if you have ever looked at a terrace face. Pull them wrong and "
      + "nothing happens except that you have been wrong.\n\n"
      + "So. Tell me the order and I will tell you whether you have it.",
    options: [
      {
        id: "ode_long_cairn_levers#wde",
        text: "Wedge, then drop, then closed eye.",
        effects: [{ kind: "setFlag", questId: "long_cairn", flag: "lever_order_known" }],
        next: "ode_levers_correct",
      },
      {
        id: "ode_long_cairn_levers#wed",
        text: "Wedge, then closed eye, then drop.",
        effects: [{ kind: "bumpCounter", questId: "long_cairn", counter: "lever_attempts" }],
        next: "ode_levers_wrong",
      },
      {
        id: "ode_long_cairn_levers#dwe",
        text: "Drop, then wedge, then closed eye.",
        effects: [{ kind: "bumpCounter", questId: "long_cairn", counter: "lever_attempts" }],
        next: "ode_levers_wrong",
      },
      {
        id: "ode_long_cairn_levers#dew",
        text: "Drop, then closed eye, then wedge.",
        effects: [{ kind: "bumpCounter", questId: "long_cairn", counter: "lever_attempts" }],
        next: "ode_levers_wrong",
      },
      {
        id: "ode_long_cairn_levers#ewd",
        text: "Closed eye, then wedge, then drop.",
        effects: [{ kind: "bumpCounter", questId: "long_cairn", counter: "lever_attempts" }],
        next: "ode_levers_wrong",
      },
      {
        id: "ode_long_cairn_levers#edw",
        text: "Closed eye, then drop, then wedge.",
        effects: [{ kind: "bumpCounter", questId: "long_cairn", counter: "lever_attempts" }],
        next: "ode_levers_wrong",
      },
      {
        id: "ode_long_cairn_levers#tell",
        text: "Ode. Just tell me which order.",
        showIf: [
          {
            kind: "questCounter", questId: "long_cairn", counter: "lever_attempts", min: 2,
            reason: "",
          },
        ],
        effects: [{ kind: "setFlag", questId: "long_cairn", flag: "lever_order_known" }],
        next: "ode_levers_told",
      },
      { id: "ode_long_cairn_levers#back", text: "Let me think about it.", next: "ode_root" },
    ],
  },
  {
    id: "ode_levers_wrong",
    text:
      "No. Think about the line again: the moor gives stone, then water, then dark. Stone is the "
      + "wedge. Water is the drop. The dark is the closed eye. It is not a riddle, it is a rota, "
      + "and rotas are written in the order they are worked.",
    options: [
      { id: "ode_levers_wrong#retry", text: "Let me try that again.", next: "ode_long_cairn_levers" },
      LEAVE("ode_levers_wrong#bye"),
    ],
  },
  {
    id: "ode_levers_correct",
    text:
      "Wedge, drop, closed eye. Stone, water, dark. That is the door's own order and it will "
      + "answer to it now. Go down to The Collapse, locationId gravelmaw_chamber2, and open it: "
      + "the door is entity gravelmaw_stone_door and the verb is open. It will not argue with you "
      + "twice.",
    options: [
      { id: "ode_levers_correct#back", text: "Down I go.", next: "ode_root" },
      LEAVE("ode_levers_correct#bye"),
    ],
  },
  {
    id: "ode_levers_told",
    text:
      "Wedge, drop, closed eye. There. It costs me nothing to say it and it is costing you "
      + "daylight not to know it. The door is entity gravelmaw_stone_door, in The Collapse, "
      + "locationId gravelmaw_chamber2. Open it.",
    options: [
      { id: "ode_levers_told#back", text: "Thank you.", next: "ode_root" },
      LEAVE("ode_levers_told#bye"),
    ],
  },
  {
    id: "ode_long_cairn_stone_given",
    text:
      "Then the hall is reachable and the office can be finished properly. This is a keeping-"
      + "stone. Cairn garnet, cut and not polished, and it goes on the top course of the cairn in "
      + "that hall, item cairn_garnet. Two Thornbound Elders stand over it and they will have to "
      + "be moved, and I am sorry, and I mean it. Do not sell the stone on the way.",
    options: [
      { id: "ode_long_cairn_stone_given#back", text: "Top course. Understood.", next: "ode_root" },
      LEAVE("ode_long_cairn_stone_given#bye"),
    ],
  },
  {
    id: "ode_replacement_stone",
    text:
      "Then here is another, and I will not ask. Garnet is common on this moor and patience is "
      + "not, so I have a great deal of one and I am spending the other. Top course of the cairn "
      + "in the hall, item cairn_garnet, locationId gravelmaw_chamber3.",
    options: [
      { id: "ode_replacement_stone#back", text: "It will get there this time.", next: "ode_root" },
      LEAVE("ode_replacement_stone#bye"),
    ],
  },
  {
    id: "ode_cairns",
    text:
      "A cairn is a promise that somebody was here and somebody else noticed. That is all. It is "
      + "not magic and it is not a grave marker, whatever the quarry crew tell each other. It is "
      + "a count kept in stone by people who could not write.",
    options: [
      { id: "ode_cairns#back", text: "Something else.", next: "ode_root" },
      LEAVE("ode_cairns#bye"),
    ],
  },
  {
    id: "ode_under",
    text:
      "Stone. Only stone, all the way down, and I have known that for thirty years. The thing "
      + "that has been re-stacking them is not looking for what is underneath. It is keeping the "
      + "count. Somebody taught it to keep the count, and then that somebody stopped coming, and "
      + "it has been doing the office alone ever since. ... Yes. I have thought about that a "
      + "great deal.",
    options: [
      { id: "ode_under#back", text: "Something else.", next: "ode_root" },
      LEAVE("ode_under#bye"),
    ],
  },
];

/** Hale: understatement as a coping mechanism. Long Cairn stage 3 lives here. */
const HALE: DialogueNodeDef[] = [
  {
    id: "hale_root",
    text:
      "Afternoon. I am on the mouth until six. It is fine. It is mostly fine. It is a hole and I "
      + "look at it, and then somebody else looks at it, and that is the rota.",
    variants: [
      {
        when: [{ kind: "questFlag", questId: "long_cairn", flag: "knows_gravelmaw", reason: "" }],
        text:
          "You went in. ... You went in, and you came back out, and I have been on this rota for "
          + "six months. I am not sure how I feel about that. Mostly relieved. Mostly.",
      },
    ],
    options: [
      {
        id: "hale_root#gravelmaw",
        text: "Tell me plainly what comes out of the Gravelmaw.",
        showIf: [{ kind: "questStatus", questId: "long_cairn", status: "active", reason: "" }],
        requires: [
          {
            kind: "questStage", questId: "long_cairn", min: 2, max: 2,
            reason: "Hale will not talk about the mouth until Cairnkeeper Ode has sent you. Speak to her first.",
          },
        ],
        next: "hale_gravelmaw_told",
      },
      { id: "hale_root#rota", text: "How does the rota work?", next: "hale_rota" },
      { id: "hale_root#mouth", text: "What does the mouth look like from here?", next: "hale_mouth" },
      LEAVE("hale_root#bye"),
    ],
  },
  {
    id: "hale_gravelmaw_told",
    text:
      "Plainly. Right. ... Four Cairnwights in the first chamber, the lit one. Somebody keeps "
      + "those torches burning, and it is not us, and I would rather they went out. Past that "
      + "there is a collapse, and it is dark, and there are a lot of the small ones in it. And "
      + "there is a door with three levers that none of us could work out, and after that... I "
      + "have not been after that. Nobody on the rota has been after that.\n\n"
      + "The mouth is entity gravelmaw_mouth_portal, terrace one, next to the quarry. Chamber one "
      + "is locationId gravelmaw_chamber1. Go armed. Please go armed.",
    options: [
      { id: "hale_gravelmaw_told#mouth", text: "What does it look like from here?", next: "hale_mouth" },
      LEAVE("hale_gravelmaw_told#bye"),
    ],
  },
  {
    id: "hale_rota",
    text:
      "Nineteen of us, so a shift every nineteen days, which is reasonable. It has been my shift "
      + "eleven times since the spring. I have not raised it. People swap for reasons and I do "
      + "not like to ask what the reasons are.",
    options: [
      { id: "hale_rota#back", text: "Something else.", next: "hale_root" },
      LEAVE("hale_rota#bye"),
    ],
  },
  {
    id: "hale_mouth",
    text:
      "Twelve metres of black in a grey face. You can see it from anywhere on terrace one, which "
      + "is the trouble, really. It is not that it is frightening to look at. It is that you can "
      + "always look at it, from anywhere, and so you do.",
    options: [
      { id: "hale_mouth#back", text: "Something else.", next: "hale_root" },
      LEAVE("hale_mouth#bye"),
    ],
  },
];

// ------------------------------------------------------------------ registry

export const DIALOGUE_NODES: readonly DialogueNodeDef[] = [
  ...ILSE, ...HARROW, ...DORN, ...SYB, ...BEL,
  ...ANSEL, ...JUNO, ...MOTT,
  ...ARDEN, ...VESS, ...ODE, ...HALE,
];

const NODES_BY_ID = new Map<string, DialogueNodeDef>(DIALOGUE_NODES.map((row) => [row.id, row]));

export function dialogueNode(id: string): DialogueNodeDef | undefined {
  return NODES_BY_ID.get(id);
}

/** Every option id, for the docs index and for a uniqueness check at boot. */
export function allOptionIds(): string[] {
  const out: string[] = [];
  for (const node of DIALOGUE_NODES) for (const option of node.options) out.push(option.id);
  return out;
}

/**
 * Structural check the root can run once at boot next to `content/validate.ts`: every `next` and
 * every `nextIf` target resolves, and no option id is used twice. Returns plain strings so a
 * content bug is a console line rather than a crashed frame.
 */
export function validateDialogue(): string[] {
  const problems: string[] = [];
  const seenOptionIds = new Set<string>();
  const seenNodeIds = new Set<string>();

  for (const node of DIALOGUE_NODES) {
    if (seenNodeIds.has(node.id)) problems.push(`dialogue: duplicate node id "${node.id}"`);
    seenNodeIds.add(node.id);

    if (node.options.length === 0) {
      problems.push(`dialogue: node "${node.id}" has no options, so it cannot be left`);
    }

    for (const option of node.options) {
      if (seenOptionIds.has(option.id)) {
        problems.push(`dialogue: duplicate option id "${option.id}"`);
      }
      seenOptionIds.add(option.id);

      const targets: (string | null)[] = [option.next];
      for (const branch of option.nextIf ?? []) targets.push(branch.next);
      for (const target of targets) {
        if (target !== null && !NODES_BY_ID.has(target)) {
          problems.push(`dialogue: option "${option.id}" points at missing node "${target}"`);
        }
      }
    }
  }

  return problems;
}

/** Every entity id an NPC's tree references as a `talk` target, for the quest cross-check. */
export function nodeExists(id: string): boolean {
  return NODES_BY_ID.has(id);
}

export type { EntityId as DialogueNpcId };
