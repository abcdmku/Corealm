# Critic packet

Use `skills/critic.md` and `docs/feature-lab.md`. Require lab proof before final-world evidence for every isolatable feature. Review only. Do not edit code.

## Approved PRD

# Corealm — Phase 1 PRD

Scope: Phase 1 only. Content tiers 1, 5, 10 across three regions. The architecture must handle levels 1 to 99 and tiers 1 to 99 without schema changes, but no tier above 10 is authored in this run.

Everything here is meant to be implemented literally. Where a number appears, it is the number. Where a name appears, it is the name.

---

## 0. Scope decisions

### In scope

All 11 skills, movement and camera, click-to-move over a real navmesh, keyboard movement, Rapier collision, semantic entities, 28-slot inventory, 9-slot equipment, bank, currency, shops, gathering with depletion and respawn, four production skills, melee and magic combat, enemies with three behaviours, loot, derived health, death and item recovery, NPCs, dialogue, 10 quests including one 7-stage chain, one dungeon, three released region bosses, browser-local persistence, generated documentation, the WebMCP tool set, the agent event queue, four overlay kinds, and `window.__gameDebug`.

### Cut from Phase 1

These appear in the brief but do not serve the Phase 1 gate. Each is listed with where it goes.

| Cut | Reason | Where it goes |
| --- | --- | --- |
| Internal AI (Assist / Copilot / Autonomous modes) | The gate proves agent capability through an *external* AI over WebMCP. An in-game model integration adds a config panel, a key-handling problem, and a chat UI, none of which the gate checks. | Phase 2. `GameApi` is the seam it attaches to, so nothing gets rewritten. |
| Content tiers 20 to 99 | Phase 1 content scope is 1, 5, 10. | Phases 2 and 3. Content schemas carry `tier: number`, so no code changes. |
| Minimap | Needs a second render pass and its own art pipeline. A compass strip, world-space destination markers, and a Locations panel with click-to-path cover the same navigation need for a fraction of the cost. | Phase 2. |
| Boss phases beyond two, hazard fields, timing windows, resource-pressure mechanics | One boss with two phases and one telegraphed ground slam proves the telegraph system. More phases are content, not architecture. | Phase 2 and 3 bosses. |
| Bank tabs, fuzzy search, custom ordering, placeholders | A plain substring filter over item names covers every Phase 1 test case. | Phase 2. |
| Shop restocking simulation, price drift, stock decay | Fixed stock, fixed prices. The Phase 1 economy loop is sell-resources / buy-supplies, and drift makes tests non-deterministic for no gain across three regions. | Phase 2. |
| Overlay kinds beyond four (hazard markers, quest-target auto-tracking, requirement badges) | Highlight, path line, world marker, and world label cover the screenshot requirement and let an agent draw a complete assistant experience. | Phase 2. |
| Ranged combat, prayer-style systems, special attacks, multiple weapon styles | Not among the brief's 11 skills. | Never. |
| Day/night, weather, ambient audio, music | Not gate-checked, and each is a full system. | Phase 2 at the earliest. |
| Multiplayer, accounts, server persistence | The brief says browser-local for this roadmap. | Out of roadmap. |
| Item degradation and repair, outside elemental-weapon charges | No gate criterion. | Out of scope. |
| Paid assets and heavy VFX | The approved magic amendment adds the free Blink `FREE - RPG Weapons` pack and DEXSOFT `Rocks FREE pack`; other paid or unapproved packs remain out of scope. | Phase 3. |

### Deliberate simplifications that need root sign-off

1. **No separate Defence skill.** The brief lists Melee as covering "physical accuracy, damage, defense", so physical defence level equals the Melee level and magical defence level equals the Magic level. That keeps the skill count at exactly 11.
2. **Death drops inventory only, not equipment.** The brief asks for consequence while keeping experimentation practical. Dropping worn gear makes the agent recovery loop much harder to test and much harsher for new players. Equipment stays worn through death.
3. **Magic needs a consumable.** A cast spends one matching Essence. An upgraded elemental weapon spends its matching stored charge first and falls back to carried Essence when empty. Mining and the Essence Altar provide the upkeep loop.

### Approved scope amendment: audio

The August 29, 2026 audio brief reverses the Phase 1 cut for ambient audio and music. The shipped game now includes:

- A rights-traced SFX library plus owner-supplied local music, curated to Corealm's grounded medieval-fantasy tone. Files that read as modern, sci-fi, cartoon, firearm, vehicle, electronic, or otherwise outside that tone are excluded.
- SFX for player footsteps and every shipped interaction family: mining, woodcutting, fishing, farming, smithing, smelting, crafting, cooking, fletching, melee, magic, damage, death, looting, doors, portals, agility, equipment, banking, shops, dialogue, and UI feedback.
- Repeated cue variants play in a fixed round-robin order at a fixed playback rate. Footsteps read the rendered ground material, with distinct families for grass, dirt and mud, stone and gravel, wood, forest floor, and cave floor.
- Region ambience for the three surface regions and the Gravelmaw interior. Ambience changes with semantic player region and never changes game state.
- Region music only where the supplied `C:\Users\Borg\Music\corealm` library names a shipped region theme. Fallowmarch uses plains music, Vellenwood uses `Deep Woodland`, Karrowmoor uses `Stone city`, and Gravelmaw has no music until a matching track is supplied. Desert, jungle, goblin-village, mire, and swamp tracks are reserved for future regions.
- Three independently persisted client volumes, `music`, `ambient`, and `sfx`, exposed in an Audio section reachable from the main menu. Each control applies immediately and supports a true zero-volume state.
- Browser acceptance that proves audio unlocks after a user gesture, region changes select the right ambience and eligible music, representative semantic actions select the right cue family, zero volume silences its own bus, settings survive reload, and no audio error reaches the console.

### Approved scope amendment: magic weapons, elemental orbs, and essence

The August 30, 2026 magic-equipment brief replaces generic Essence Shards and the procedural staff proxies with a physical weapon, orb, mining, and recharge loop.

#### Weapon ladder

- A new character starts with the Basic Wooden Wand equipped. Its wood and socket are plain brown and unlit.
- A new character carries 50 Air Essence. A plain wand or staff consumes one matching Essence per cast, so Voltrend works immediately.
- The Basic Wooden Staff is the tier-0 staff. Palewood, Duskoak, and Cairnpine variants follow at tiers 1, 5, and 10. The matching wand variants use the same log ladder. Wood species changes the base colour while every plain weapon remains unlit.
- Staffs are two-handed, slower, and stronger. Wands are one-handed, weaker, and faster. The released cadence is 3.0 seconds for a staff and 2.2 seconds for a wand. A two-handed staff cannot be equipped alongside an off-hand item. There is no orb equipment slot.
- Staff and wand meshes come from Blink's free `FREE - RPG Weapons` Unity Asset Store pack. An elemental weapon has a glowing socket in its element colour. Plain weapons stay non-emissive.
- Tiered staffs and wands are Fletching products made from the matching log's shafts. Crafting a released boss Orb with its matching wood-tier wand or staff consumes the Orb and creates the elemental charged weapon: Air with Palewood, Earth with Duskoak, and Water with Cairnpine.

#### Orb progression

| Tier | Region | Boss reward | Released |
| --- | --- | --- | --- |
| 1 | Fallowmarch | Air Orb | Yes |
| 5 | Vellenwood | Earth Orb | Yes |
| 10 | Karrowmoor / Gravelmaw | Water Orb | Yes |
| 15 | Future region | Fire Orb | No |

- The tier 1 and tier 5 regions gain named region bosses. Ordrun remains the tier 10 boss. Each boss has a guaranteed orb drop for its tier.
- Orbs are singleton crafting components, never equipment. The elemental weapon created from one starts at exactly 1,000 of 1,000 charges. One compatible spell cast spends one weapon charge whether the cast hits or misses.
- The spell ladder opens with air at Magic 1, earth at Magic 5, water at Magic 10, and fire at Magic 15. Fire spells remain visible as future progression but cannot be cast because the Fire Orb and Fire Essence are not released.
- Direct casts and automatic attacks require a wand or staff plus matching fuel. A matching charged weapon pays first; otherwise one carried matching Essence pays. Human, agent, debug, and persistence paths read and mutate the same weapon-charge and inventory state.

#### Essence caches and altars

- Each released surface region has one distant authored essence cache, placed away from its settlement and ordinary gathering loop. The cache contains one large mineable centre and four smaller mineable nodes around it.
- Every node uses a model from DEXSOFT's free `Rocks FREE pack`. Its rock remains readable under the region palette and has element-coloured emissive veins. Depleted nodes keep the same silhouette, lose the emissive veins, and show the shared depleted state.
- Each node rolls a total capacity of 40 to 90 essence when the world builds and every time it returns. A successful mining roll grants one matching, stackable essence and removes one capacity. The node respawns exactly 30 seconds after depletion.
- Air, Earth, and Water Essence use the normal Mining requirements for tiers 1, 5, and 10. Fire Essence has no released node.
- Every released settlement has an Essence Altar. Interacting with an altar while a partially charged elemental wand or staff is equipped consumes exactly 100 matching Essence and restores that weapon to 1,000 charges. A full weapon is refused without taking Essence.
- Recharging emits a semantic event, updates the spellbook and equipment readouts immediately, and persists through save and reload.

#### Acceptance additions

1. A fresh character visibly holds the plain brown Basic Wooden Wand. No socket or weapon part emits light.
2. Crafting and equipping each released elemental weapon shows the correct socket glow and an exact charge readout on the weapon.
3. A wand's repeated casts resolve at 2.2 seconds and deal less damage than the same-tier 3.0-second staff. A staff refuses to equip while an off-hand item is worn.
4. Killing each released region boss produces its guaranteed crafting Orb. The weapon crafted from it starts at 1,000 charges.
5. Mining a released essence node yields one essence per successful roll, exhausts after a deterministic 40-to-90 roll, emits `resource.depleted`, and returns 30 seconds later with a fresh 40-to-90 roll.
6. An altar interaction with 100 matching Essence and a partially charged elemental weapon removes exactly 100 Essence and restores exactly 1,000 charges. A plain weapon, wrong Essence, a full weapon, or fewer than 100 Essence changes nothing and returns a specific error.
7. Browser state before and after an Essence-funded cast, a weapon-charge-funded cast, node depletion, node respawn, Orb loot, crafting, and altar recharge proves the semantic changes. Screenshots cover the starter wand, all three cache colours, both weapon families charged and unlit, an Orb drop, and the equipment charge readout.

---

## 1. Player experience and core loop

### The fifteen-second read a new player forms

You wake on a windy plain outside a walled town that is obviously the last safe thing for miles. Rocks glint. Trees are clearly choppable. Something small and hostile is picking through the grass forty metres off. Everything visible can be taken, hit, or walked to.

### Core loop

```
explore -> gather -> produce -> equip / consume -> fight or quest -> level up
       -> unlock a stronger tier or a shorter route -> explore further
```

The loop closes on itself twice, and both must be visible to the player.

**Material loop.** Ore and logs become bars and handles, which become weapons and tools, which make gathering and combat faster, which produce more ore and logs.

**Route loop.** Agility levels open shortcuts that shorten bank trips, which raises XP per hour on distant high-tier nodes, which flips which node is actually the best training spot. Section 2.8 gives the exact numbers for that flip.

### Session shapes

| Session | Length | What the player does |
| --- | --- | --- |
| First | 20 to 40 min | Spawn in Fallowmarch, take Cold Iron, mine Grithe, smelt, smith a dagger, kill Rill Skitterlings, reach Melee 5 and Mining 5. |
| Mid | 30 to 60 min | Travel to Vellenwood, train Woodcutting and Fishing on tier 5, cook, run the Canopy Run agility route, fight Thornbound. |
| Late Phase 1 | 60 to 120 min | Karrowmoor. Tier 10 gear, the Sunder Ledge shortcut, The Long Cairn chain, then Ordrun. |

### What "readable" means concretely

- A node's tier is legible from 12 m at the default camera pitch, by material colour and by silhouette scale.
- Right-clicking anything lists every interaction it has. Unavailable entries stay visible, greyed, and state the missing requirement in plain text ("Requires Mining 10").
- Every XP gain floats a number in the skill's colour, and the skill guide panel states the exact XP for every action the player has performed at least once.

### Agent experience

An agent gets the same world through 16 WebMCP tools (section 7.4). It cannot teleport, cannot read undiscovered content, and moves at 4.2 m/s over the navmesh a human walks. Two things make agent quality measurable. The event queue means a good agent almost never polls. The route flip in section 2.8 means a naive "always mine the highest tier" agent gives up roughly 15% XP per hour against an agent that does the arithmetic.

---

## 2. Mechanics with numerical values

### 2.1 The XP curve

One closed-form formula, computed once at load into a frozen 99-entry table.

```
totalXpAt(L) = floor( 873 * (1.1 ^ (L - 1)) - 873 + 6 * L * (L - 1) )
```

`totalXpAt(1) = 0`, and `xpToNext(L) = totalXpAt(L + 1) - totalXpAt(L)`.

Checkpoints, all derived from that formula. The root can verify any row with a calculator.

| Level | Cumulative XP | XP for that level |
| --- | --- | --- |
| 2 | 99 | 99 |
| 3 | 219 | 120 |
| 5 | 525 | 165 |
| 10 | 1,725 | 295 |
| 20 | 6,746 | 714 |
| 30 | 18,195 | 1,607 |
| 40 | 44,406 | 3,734 |
| 50 | 106,992 | 9,057 |
| 60 | 262,014 | 22,676 |
| 70 | 654,878 | 57,807 |
| 80 | 1,662,731 | 148,737 |
| 90 | 4,263,794 | 384,396 |
| 92 | 5,151,454 | 464,919 |
| 95 | 6,843,596 | 618,482 |
| 98 | 9,094,836 | 822,861 |
| 99 | **9,999,879** | 905,043 |

Level 99 lands 121 XP under 10 million, which is as close as a clean two-constant formula gets. Level 92 sits at 51.5% of the total, so the last seven levels are half the grind, which is the pacing classic-MMO players expect. Increments are strictly positive at all 98 steps. Level 2 at 99 XP is small enough that a new player levels something inside the first minute.

The table is canonical content data. `content/xp.ts` computes it at module load and exports a frozen `readonly number[]` of length 99. Nothing else may recompute it.

Phase 1 imposes no level cap. A player can grind Mining to 40 on tier 10 nodes if they want. Content simply stops at tier 10.

### 2.2 Skills

Exactly 11, each 1 to 99, each starting at level 1 with 0 XP.

| Id | Name | Group | Colour (XP drops and skills panel) |
| --- | --- | --- | --- |
| `melee` | Melee | combat | `#c0392b` |
| `magic` | Magic | combat | `#5b6ee1` |
| `mining` | Mining | gathering | `#8d8d94` |
| `woodcutting` | Woodcutting | gathering | `#6b8f3a` |
| `fishing` | Fishing | gathering | `#3aa0c4` |
| `farming` | Farming | gathering | `#a3c44a` |
| `smithing` | Smithing | production | `#b5651d` |
| `crafting` | Crafting | production | `#a86fc4` |
| `cooking` | Cooking | production | `#d98c2b` |
| `fletching` | Fletching | production | `#7a5c3a` |
| `agility` | Agility | utility | `#3ac48a` |

Health is derived, not a skill.

### 2.3 Derived health

```
vitalityLevel = max(1, floor((melee + magic) / 2))
maxHealth     = 20 + 3 * vitalityLevel + sum(equipped.vitality)
```

| Melee / Magic | Equipment vitality | Max health |
| --- | --- | --- |
| 1 / 1 | 0 | 23 |
| 10 / 1 | +6 (tier 1 kit) | 41 |
| 12 / 5 | +14 (tier 5 kit) | 58 |
| 18 / 8 | +16 (tier 10 kit) | 75 |
| 50 / 50 | +40 | 210 |
| 99 / 99 | +90 | 407 |

Out of combat, health regenerates 1 point every 6.0 s. Regeneration stops while any hostile has targeted the player within the last 8 s.

### 2.4 Combat formulas

Melee and enemy rolls resolve on the 600 ms combat cadence. Magic is checked on every 100 ms sim
tick so the authored 2.2-second wand and 3.0-second staff cadences resolve exactly rather than being
rounded to a 600 ms boundary. A standard 2.4-second melee weapon still attacks every four combat
ticks.

**Accuracy.**

```
attackRoll  = (attackLevel  + 9) * (1 + gearAccuracy / 100) * styleFactor
defenceRoll = (defenceLevel + 9) * (1 + gearArmour   / 100)
hitChance   = clamp(attackRoll / (attackRoll + defenceRoll), 0.05, 0.95)
```

For melee, `attackLevel` is the attacker's Melee, `styleFactor` is 1.00, and the defender uses Melee as `defenceLevel` plus the sum of `armour` on worn gear. For magic, `attackLevel` is the attacker's Magic, `styleFactor` is 1.15, and the defender uses Magic plus the sum of `magicArmour`.

Enemies carry `attackLevel`, `defenceLevel`, `accuracy`, `armour`, and `magicArmour` in content data, so the same two lines cover both directions.

**Melee damage.**

```
maxHit = floor(2 + (meleeLevel + gearPower) / 4.2)
damage = hit ? randomInt(1, maxHit) : 0
```

| Melee level | gearPower | maxHit |
| --- | --- | --- |
| 1 | 0 (unarmed) | 2 |
| 1 | +6 (Grithe dagger) | 3 |
| 5 | +14 (Corven sword) | 6 |
| 10 | +26 (Kaldite sword) | 10 |
| 20 | +45 | 17 |
| 50 | +110 | 40 |
| 99 | +200 | 73 |

A miss deals 0. A hit deals at least 1, which reads better than the classic zero-damage-hit and gives agents a cleaner signal.

**Magic damage.** Each spell carries `baseMax` and `divisor`.

```
maxHit = floor(spell.baseMax + (magicLevel + gearMagicPower) / spell.divisor)
```

| Spell | baseMax | divisor | maxHit at unlock | maxHit 10 levels later with tier gear |
| --- | --- | --- | --- | --- |
| Voltrend (Magic 1) | 3 | 8 | 3 | 6 |
| Stonebrand (Magic 5) | 5 | 7 | 6 | 9 |
| Rimewash (Magic 10) | 8 | 6 | 14 | 18 |

Magic costs one matching elemental-weapon charge or carried Essence per cast and is 15% more accurate through `styleFactor`. Wands cast every 2.2 seconds with lower power; two-handed staffs cast every 3.0 seconds with higher power. Its niche is high-`armour`, low-`magicArmour` targets. Against a Cairnwight (armour +55, magicArmour +10) at Magic 10 with a Water Staff, Rimewash outperforms the equivalent melee path. Against a Scree Skitterling (armour +30, magicArmour +40) melee wins. Both paths stay useful, which is a gate criterion.

**Combat XP.**

```
xpPerDamage = 4                                  // to melee or magic, whichever dealt it
onKill:   attackerSkillXp += round(target.maxHealth * 2.0)
onCast:   magicXp += spell.baseXp                // 5 / 12 / 22 at tier 1 / 5 / 10, hit or miss
```

Melee 1 to 10 needs 1,725 XP. A Rill Skitterling has 6 HP and gives 6 * 4 + 12 = 36 XP, so 48 kills, roughly 11 minutes with a tier 1 dagger. At Melee 99 with +200 gear the rate is about 133,000 XP/hr, so 99 costs roughly 75 hours of pure combat.

**Time to kill, verified against the formulas above.**

| Fight | Hit chance | maxHit | TTK |
| --- | --- | --- | --- |
| Melee 1 unarmed vs Rill Skitterling (6 HP) | 50% | 2 | 19 s |
| Melee 3, Grithe dagger vs Rill Skitterling | 56% | 4 | 10 s |
| Melee 7, Corven sword vs Thornbound Husk (26 HP) | 51% | 7 | 30 s |
| Melee 12, Kaldite sword vs Scree Skitterling (34 HP) | 51% | 11 | 27 s |
| Melee 12, Kaldite sword vs Cairnwight (38 HP) | 46% | 11 | 33 s |
| Melee 18, tier 10 kit vs Ordrun (200 HP) | 45% | 12 | 165 s |

Ordrun deals about 1.02 damage/s through tier 10 armour, so a 165 s fight costs roughly 169 damage against a 75 HP pool. That is about 9 Seared Cragfin (11 HP each) plus eat time. A boss you can lose is the point.

**Auto-attack.** Starting an attack sets `combat.targetId`, and the player keeps attacking on the weapon's cadence until the target dies, the player leaves the 1.6 m melee or 9.0 m spell range, the player issues another command, or the player dies. Enemies use a content-defined aggro radius of 6 m to 14 m and leash at 28 m from their spawn point.

### 2.5 Gathering formulas

One shared model across Mining, Woodcutting, Fishing, and the harvest step of Farming.

```
gatherTickMs   = 1800
effectiveLevel = skillLevel + tool.gatherBonus
successChance  = clamp(0.30 + 0.016 * (effectiveLevel - node.reqLevel), 0.05, 0.95)
yieldXp(tier)  = round(10 * tier ^ 0.55)
```

At the node's own requirement level the chance is exactly 0.30, which is 6.0 s per yield. It reaches 0.95 at 41 levels above the requirement. The formula is deliberately tier-independent so an agent can reason about it in one line.

Tools add flat effective levels: tier 1 tool +2, tier 5 tool +5, tier 10 tool +9. General rule for later tiers, `toolBonus(tier) = round(1.6 + 0.75 * tier)`, capped at 40. Attempting a node without the required *base* skill level is refused with `REQUIREMENTS_NOT_MET`. Tools never bypass requirements.

| Tier | yieldXp | XP/hr at exactly the req level | XP/hr at req+10 |
| --- | --- | --- | --- |
| 1 | 10 | 6,000 | 8,880 |
| 5 | 24 | 14,400 | 21,300 |
| 10 | 35 | 21,000 | 32,200 |
| 20 | 52 | 31,200 | 47,800 |
| 50 | 86 | 51,600 | 79,100 |
| 99 | 125 | 75,000 | 115,000 |

Those are gather-only rates. Real rates run 25% to 40% lower once bank trips count, which is what makes section 2.8 interesting.

Mining 1 to 10, switching to tier 5 ore at Mining 5, takes 9.4 minutes of pure gathering, or about 13 minutes with travel and one bank trip. That is the time budget for the external-agent Mining proof.

### 2.6 Node durability and respawn

```
yieldRange(tier)     = [ max(4, round(8.5 - 0.052 * tier)),
                         max(8, round(15 - 0.052 * tier)) ]
respawnSeconds(tier) = round(18 + 3.2 * tier ^ 0.9)
```

| Tier | Yields per life | Respawn |
| --- | --- | --- |
| 1 | 8 to 15 | 21 s |
| 5 | 8 to 15 | 32 s |
| 10 | 8 to 14 | 43 s |
| 50 | 6 to 12 | 126 s |
| 99 | 4 to 10 | 218 s |

These formulas are the default for ordinary nodes. An authored `yieldRange` or `respawnSeconds`
overrides it; each released essence-cache node uses 40–90 capacity and exactly 30 seconds.

Yield count is rolled from the seeded RNG when a node respawns. A depleted node swaps to its depleted mesh variant and desaturates its material by 45%.

Cluster sizing keeps circuits alive. Five nodes at roughly 12 yields each at 6.0 s per yield is 360 s of work against a 21 s to 43 s respawn, so node 1 is always back before node 5 empties. The tension only appears at high skill levels or with a small cluster, and both are used on purpose: the 3-node Kaldite seam in Upper Karrow genuinely runs dry at Mining 20+, which is what pushes players to the second seam and the shortcut.

### 2.7 Production formulas

```
recipeXp = round(yieldXp(tier) * craftWeight)
```

| Recipe kind | craftWeight | Duration | Skill |
| --- | --- | --- | --- |
| Smelt bar | 0.8 | 2.4 s | Smithing |
| Dagger | 2.0 | 3.0 s | Smithing |
| Sword | 3.5 | 3.0 s | Smithing |
| Body or legs armour | 5.0 | 3.0 s | Smithing |
| Helm, boots, gloves | 2.5 | 3.0 s | Smithing |
| Pickaxe or hatchet head | 2.2 | 3.0 s | Smithing |
| Cooked food | 1.5 | 2.4 s | Cooking |
| Amulet or ring | 3.0 | 2.4 s | Crafting |
| Leather body | 4.0 | 2.4 s | Crafting |
| Wand | 2.4 | 1.8 s | Fletching |
| Staff | 3.2 | 1.8 s | Fletching |
| Tool handle | 1.0 | 1.8 s | Fletching |
| Fishing rod | 1.8 | 1.8 s | Fletching |
| Wooden shield | 2.8 | 1.8 s | Fletching |

Worked examples. Tier 1 `yieldXp` is 10, so a Grithe bar gives 8 XP and a Grithe sword gives 35 XP. Tier 10 `yieldXp` is 35, so a Kaldite bar gives 28 XP and a Kaldite body gives 175 XP.

Cooking is the only production skill that can fail:

```
burnChance = clamp(0.45 - 0.030 * (cookingLevel - recipe.reqLevel), 0.00, 0.45)
```

Burning stops 15 levels above the requirement. Burnt food gives 0 XP and a worthless item.

Batch jobs run `quantity` repetitions back to back and stop on missing ingredients, a full inventory, player movement, damage taken, or cancel.

**Food healing.**

```
healAmount(tier) = round(2 + 1.35 * tier ^ 0.85)
```

Tier 1 heals 3, tier 5 heals 7, tier 10 heals 11, tier 99 heals 70. Eating takes 1.8 s and blocks attacks for that time. Healing above `maxHealth` is wasted.

### 2.8 Agility and the route-optimisation flip

```
agilityXp(tier) = round(10 * tier ^ 0.55 * 1.8)     // 18 / 43 / 63 at tier 1 / 5 / 10
successChance   = clamp(0.60 + 0.02 * (agilityLevel - obstacle.reqLevel), 0.50, 1.00)
onFail:         damage = randomInt(2, 6), player placed at obstacle.failPoint, no XP
```

Traversal takes 2.0 s to 4.0 s depending on the obstacle. Success reaches 1.00 twenty levels above the requirement.

The flip case, with real numbers. Run speed 4.2 m/s, 28-slot load, 6 s of bank interaction per trip, 1.8 s gather tick.

| Mining level | Corven seam, 38 m from Rootfall bank | Kaldite seam, 190 m from Highcairn bank | Same Kaldite seam via **Sunder Ledge** (Agility 10), 45 m plus a 6 s climb |
| --- | --- | --- | --- |
| 12 | 16,522 XP/hr | 14,210 XP/hr | 18,448 XP/hr |
| 15 | 18,100 XP/hr | 15,399 XP/hr | 20,504 XP/hr |
| 20 | 20,601 XP/hr | 17,123 XP/hr | 23,679 XP/hr |

Before Agility 10, tier 5 ore next to a bank beats tier 10 ore across the moor by about 16%. After Agility 10, tier 10 wins by about 12%. That reversal is the metagame the brief asks for, and any agent that can multiply will find it.

Phase 1 has 9 obstacles: 2 in Fallowmarch (req 1 and 3), 3 in Vellenwood (req 5, 6, 8), 4 in Karrowmoor (req 10 for Sunder Ledge, plus 12, 14, 14).

### 2.9 Farming

Persistent across sessions and reloads. Growth advances from wall-clock deltas, so a plot planted before a reload keeps growing.

| Crop | Tier | Farming req | Stages | Seconds per stage | Total | Yield | Harvest XP each | Plant XP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bittergrain | 1 | 1 | 4 | 60 | 240 s | 3 to 6 | 10 | 2 |
| Duskberry | 5 | 5 | 5 | 120 | 600 s | 3 to 6 | 24 | 5 |
| Cairnleaf | 10 | 10 | 5 | 180 | 900 s | 2 to 5 | 35 | 7 |

Plot lifecycle: `empty -> raked -> planted -> growing(stage 1..n) -> ready -> harvested -> empty`. Raking takes 1.8 s and gives 3 Farming XP. Six plots in Fallowmarch, four in Karrowmoor. Plots are per-save, not per-session.

`__gameDebug.advanceGameTime(seconds)` fast-forwards growth timers and node respawns for tests. It is never exposed to WebMCP.

### 2.10 Inventory, bank, currency

- Inventory: 28 slots. Stackable kinds are currency, elemental essence, seeds, shafts, and gems. Everything else takes one slot per item, including every ore, log, fish, bar, and equipment piece.
- Bank: 400 slots, every slot stacks to 2,147,483,647. Deposit, withdraw, deposit-all, quantity selection (1 / 5 / 10 / all / custom), and a substring name filter.
- Currency: **marks**. Stackable, carried in inventory, dropped by enemies, paid by quests, earned by selling.

Reference prices. Shop buy price to the player and sell price from the player, at a 40% spread.

| Item | Buy | Sell |
| --- | --- | --- |
| Grithe ore | 12 | 7 |
| Corven ore | 42 | 25 |
| Kaldite ore | 95 | 57 |
| Palewood log | 10 | 6 |
| Duskoak log | 38 | 22 |
| Cairnpine log | 88 | 52 |
| Grithe sword | 180 | 108 |
| Corven sword | 620 | 372 |
| Kaldite sword | 1,450 | 870 |
| Air essence | 9 | 5 |
| Seared Cragfin | 70 | 42 |

Enemy mark drops are `randomInt(round(tier * 3), round(tier * 11))`, so tier 1 drops 3 to 11 and tier 10 drops 30 to 110. Ordrun drops 900 to 1,400 plus a guaranteed Kaldite piece.

### 2.11 Death and recovery

On death, every inventory item drops into a **Recovery Cache** semantic entity at the death position, snapped to the navmesh. Equipped items stay equipped. No XP or levels are lost. The player respawns at the last settlement respawn point they have visited (Coldbrace, Rootfall, or Highcairn) at full health.

The cache is visible only to its owner, survives reload, and expires 15 real minutes after creation. Expiry destroys the contents. Only one cache exists at a time, and dying with a live cache destroys the old one, so the HUD shows a persistent warning banner with a countdown while a cache is live.

Movement speed is 4.2 m/s running and 1.9 m/s walking. Walking is used only by NPCs.

---

## 3. Runtime systems and update order

### Frame structure

The game runs a fixed-step simulation inside a variable-rate render loop. Two clocks:

- **Sim tick:** 100 ms fixed step. Up to 5 sim steps per frame, then the accumulator clamps to avoid spiral-of-death after a tab restore.
- **Combat / gather tick:** 600 ms, counted in sim ticks (every 6th sim step). Melee, enemy attacks,
  gather rolls, and production completions land here. Magic launch readiness is the deliberate
  exception: it is checked each 100 ms sim tick so wands resolve at exactly 2.2 seconds and staffs at
  exactly 3.0 seconds. Every path remains deterministic from the seed and sim-tick count.

`__gameDebug.step(ms)` drives sim ticks manually while paused, which is how Playwright gets determinism.

### Update order inside one sim tick

Order is load-bearing. A worker who reorders this breaks tests.

| # | System | Owner file | What it does |
| --- | --- | --- | --- |
| 1 | Time | `core/time.ts` | Advances `simTimeMs`, applies `timeScale`, emits tick boundaries. |
| 2 | Input intake | `input/*` | Drains queued human intents into the same command queue the agent API writes to. |
| 3 | Command dispatch | `api/gameApi.ts` | Validates and applies one command per actor per tick. Rejections become errors and events. |
| 4 | Navigation | `systems/navigation.ts` | Advances path following, recomputes on blockage, emits `navigation.completed` / `navigation.failed`. |
| 5 | Physics | `systems/physics.ts` | Rapier step. Character controller resolves collision and grounding for the player and all enemies. |
| 6 | Activity | `systems/gathering.ts`, `production.ts`, `farming.ts`, `agility.ts` | Advances the single active player activity. Rolls only on combat ticks. |
| 7 | Enemy AI | `systems/enemyAI.ts` | Aggro checks, leash checks, chase, retreat, boss phase transitions and telegraphs. |
| 8 | Combat | `systems/combat.ts` | Resolves attack timers for the player and every engaged enemy, applies damage, awards XP. |
| 9 | Health | `systems/health.ts` | Regeneration, low-health threshold crossing, food effects. |
| 10 | Death | `systems/death.ts` | Detects zero health, builds the Recovery Cache, teleports and resets. Also expires stale caches. |
| 11 | World | `world/entities.ts` | Node respawn timers, crop growth, loot despawn, spawner repopulation. |
| 12 | Quests | `systems/quests.ts` | Evaluates stage predicates against the state snapshot, advances stages, emits `quest.updated`. |
| 13 | Discovery | `api/observation.ts` | Marks newly visible entities and locations as discovered, emits `entity.discovered`. |
| 14 | Event flush | `agent/events.ts` | Appends the tick's events to the ring buffer, wakes any blocked `corealm_events` waiters. |
| 15 | Persistence | `persistence/storage.ts` | Marks state dirty. Autosave writes at most once every 10 s, and always on `beforeunload`. |

### Render frame, after the sim catches up

| # | Step | Owner file |
| --- | --- | --- |
| R1 | Camera update, follow and collision | `render/camera.ts` |
| R2 | Entity view sync (position, state, material variant) | `render/entityViews.ts` |
| R3 | Character animation blend | `render/characterRig.ts` |
| R4 | Overlay rebuild (highlights, path lines, markers, labels) | `render/overlays.ts` |
| R5 | Damage numbers, XP drops, hit sparks | `render/vfx.ts` |
| R6 | Three.js render | `render/renderer.ts` |
| R7 | UI reconciliation from the state snapshot | `ui/*` |

Renderers read state. They never write it. The one exception is `render/camera.ts`, which owns `camera` in the settings slice because it has no gameplay meaning.

### Determinism

- Every gameplay random draw goes through `core/rng.ts`, a seeded xorshift128+ with named streams (`combat`, `gather`, `loot`, `worldgen`, `ai`). Streams are independent so a combat roll never shifts a scatter placement.
- `worldgen` is seeded from the region seed and is stable across reloads. The other streams seed from the save and persist their counters.
- `Math.random` is banned in `game/src/` outside `core/rng.ts`. Add an ESLint `no-restricted-properties` rule.

### Boot sequence

1. Parse and validate all content (`content/validate.ts`). A schema failure throws before the renderer exists, with the offending id in the message.
2. Build the XP table and freeze it.
3. Create renderer, scene, camera, and the loading screen.
4. Load the asset manifest and the GLB set for the spawn region only. The other two regions stream in on approach.
5. Init Rapier, build static colliders from region collision meshes.
6. Load or build navmeshes with recast-navigation. Baked `.bin` navmeshes ship in `game/public/nav/`, with runtime bake as the fallback.
7. Restore the save, or create a new character.
8. Construct semantic entities for the spawn region, then instantiate their views.
9. Install `window.__gameDebug`, then register the WebMCP tool set.
10. Set `__gameDebug.ready()` to true and start the loop.

Target: `ready()` returns true within 6 s on a cold cache, 2 s warm.

### Performance budget

60 FPS on a modern gaming desktop at 1920x1080. Per frame budget of 16.6 ms, allocated as 6 ms render, 3 ms sim, 2 ms UI, 5 ms headroom. Enforcement rules:

- One `InstancedMesh` per (asset, material variant) pair for scatter props. Target under 400 draw calls in the densest view, which is Vellenwood canopy.
- Entity views instantiate only within 140 m of the camera, with a 160 m destruction hysteresis.
- Two LOD levels per Quaternius mesh above 500 triangles, swapping at 45 m.
- Shadow map is a single 2048 cascade covering 60 m around the player.
- `__gameDebug.getMetrics()` reports `fps`, `frameMs`, `drawCalls`, `triangles`, `entityCount`, and `heapMB`, so screenshot runs can assert the budget.

---

## 4. World layout and visual direction

### Naming direction for all twelve regions

So later phases stay consistent, the naming system is fixed now.

Rules. One invented compound word from Old-English or Anglo-Saxon roots. Two or three syllables. No apostrophes, no `-ia` or `-oria` suffixes, no real-world place names, no Latinate abstractions. Tiers 1 to 30 use land nouns (march, wood, moor, halt, mire). Tiers 40 to 70 blend land nouns with weather and element roots. Tiers 80 to 99 drop the land-noun grammar entirely and use element or abstract roots. The Core is the only region named with a definite article, which is how the player knows it is the last one.

| Tier | Direction | Reserved name |
| --- | --- | --- |
| 1 | Frontier plains | **Fallowmarch** (Phase 1) |
| 5 | Deep woodland | **Vellenwood** (Phase 1) |
| 10 | Stone highlands | **Karrowmoor** (Phase 1) |
| 20 | Ember foothills | Kilnhalt |
| 30 | Marshlands | Sedgemire |
| 40 | Frozen north | Rimewatch |
| 50 | Desert | Sunderwaste |
| 60 | Storm coast | Gallowtide |
| 70 | Corrupted wilds | Blightholt |
| 80 | Volcanic wastes | Ashvarr |
| 90 | Arcane / astral | Aetherfall |
| 99 | The final realm | The Core |

Material names follow the same escalation: Grithe, Corven, Kaldite (Phase 1), then Emberite, Fenglass, Rimesteel, Sunderite, Tidewrought, Blightsteel, Ashvarrite, Aetherite, Corestone.

### Fallowmarch (tier 1, frontier plains)

Fallowmarch is the last surveyed land before the maps stop being useful. Two generations ago the March Company drove a road north from somewhere nobody here has been, planted a bank vault at the end of it, walled a town around the vault, and then stopped answering letters. What is left is Coldbrace: a stone-and-timber town of about two hundred people who make their living pulling soft grey Grithe out of a shallow pit, selling it back down the road, and pretending the wind off the northern moor does not sound like anything. The plains themselves are open, tussocky, and easy. Nothing here will kill a careful person. That is exactly why people who want to be careful stay, and why everyone interesting has already left for the woods.

**Layout.** 420 m x 420 m playable, elevation range 14 m, gentle rolling terrain with a north-south road spline.

| Feature | Position note | Contents |
| --- | --- | --- |
| Coldbrace town | Centre-south, walled, two gates | Bank (12 counter slots visually, one shared 400-slot store), General shop, Smith shop, furnace and anvil, cooking range, crafting table, fletching bench, 5 quest NPCs |
| Bracken Pit | 160 m north of town | 6 Grithe ore nodes (tier 1), 2 stone nodes |
| Galeheart Cache | Remote west march | Air Essence: one large centre plus four satellites, 40–90 capacity each, 30 s respawn |
| Tempest Roc | Remote cache approach | Tier-1 region boss; first guaranteed singleton drop is the Air Orb |
| Palewood Copse | 190 m west | 8 Palewood trees (tier 1) |
| Redsill Shallows | 120 m east, on Corven Brook | 4 fishing spots, Silt minnow (tier 1) |
| Marchfield | 90 m north-east, inside the wall line | 6 farm plots, Bittergrain seeds |
| The Open March | Everywhere outside the road | Rill Skitterlings, Marchwolf pups |
| Brookvault Planks (Agility 1) | Across Corven Brook | Cuts the bank-to-Redsill trip from 205 m to 130 m |
| Wall Vault (Agility 3) | North wall | Cuts bank-to-Bracken from 178 m to 118 m |
| North Gate | Top of the road | Exit to Vellenwood |

**Look.** Bleached grass greens, weathered grey-brown timber, a single warm accent of copper-orange on Coldbrace roofs. Wide sightlines, low prop density (about 1 prop per 40 m²). The player can see the town from anywhere on the plain, which is the point.

**Landmarks:** the March Company vault tower (tallest structure, visible from 300 m), the broken north milestone, the lone dead Palewood at the top of the rise.

### Vellenwood (tier 5, deep woodland)

Vellenwood grows out of the north end of Fallowmarch the way a wall grows out of a fence. Within two hundred metres of the gate the sky closes. The Duskoak here are old enough that the March Company surveyors marked them as terrain rather than trees, and the ground between them is a slow tangle of root, moss, and standing water that is deeper than it looks. Rootfall is the only settlement: nine buildings and a bank chest, built on and around the stump of a Duskoak so large the stump is the town square. The people of Rootfall are cheerful in a way that people who live somewhere genuinely dangerous often are. They will tell you which paths are safe. They will not tell you why the Thornbound only move at the edges of the clearings, and they will change the subject if you ask twice.

**Layout.** 380 m x 380 m, elevation range 26 m, a river gorge cutting north-west to south-east, canopy occlusion is the primary navigation problem.

| Feature | Contents |
| --- | --- |
| Rootfall hamlet | Bank chest, general shop, cooking range, anvil, 3 quest NPCs, Essence Altar |
| Duskoak Stand | 10 Duskoak trees (tier 5) |
| Hollowcut Seam | 5 Corven ore nodes (tier 5), 38 m from the Rootfall bank chest |
| Blackwater Pools | 5 fishing spots, Bramble trout (tier 5) |
| The Thornline | Thornbound Husks, Bramble Skitterlings, Marchwolves |
| Rootheart Cache | Remote eastern wood | Earth Essence: one large centre plus four satellites, 40–90 capacity each, 30 s respawn; Rootheart guards the first Earth Orb |
| Fallen Duskoak (Agility 5) | Gorge crossing, saves 85 m |
| Canopy Walk (Agility 6) | Three-platform route above the stand |
| Root Tunnel (Agility 8) | Rootfall to the Thornline, saves 110 m |
| South and East gates | Fallowmarch and Karrowmoor |

**Look.** Deep desaturated greens with a strong value contrast between shafted light and canopy shadow. Bark browns pushed purple. High prop density (about 1 per 8 m²) but ground clutter is kept low so pathing stays legible. Fog starts at 55 m.

**Landmarks:** the Rootfall stump, the split Duskoak over the gorge, the standing stones at the Thornline edge.

### Karrowmoor (tier 10, stone highlands)

Karrowmoor is what Fallowmarch would be if you tilted it sixty degrees and took the soil away. The moor climbs in terraces of grey slate to a ridge you can see from the Vellenwood gate, and every flat surface on it is covered in cairns. Nobody in Highcairn built them and nobody in Highcairn will move one. The outpost itself is a quarry camp with a wall, kept alive by the fact that Kaldite is the hardest metal anyone this side of the road has a name for, and by the fact that the quarry crew stopped digging six months ago. What they hit was the Gravelmaw, and what came out of the Gravelmaw is still walking around inside it, arranging stones. The crew calls it Ordrun. They have a rota for who watches the entrance, and they have never once discussed sealing it.

**Layout.** 460 m x 460 m, elevation range 62 m across four terraces, verticality is the defining feature.

| Feature | Contents |
| --- | --- |
| Highcairn outpost | Terrace 2. Bank, general shop, smith shop, furnace, anvil, cooking range, 4 quest NPCs, 4 farm plots |
| Lower Quarry | Terrace 1. 5 Kaldite ore nodes (tier 10), the Gravelmaw entrance |
| Upper Karrow Seam | Terrace 4. 3 Kaldite ore nodes, 190 m from the bank by road |
| Ridge Pines | Terrace 3. 8 Cairnpine trees (tier 10) |
| Cairn Tarns | Terrace 2 and 3. 4 fishing spots, Cragfin (tier 10) |
| The Cairnfields | Cairnwights, Scree Skitterlings, Thornbound Elders |
| **Sunder Ledge** (Agility 10) | Highcairn to Upper Karrow. 190 m becomes 45 m plus a 6 s climb. This is the flip in section 2.8. |
| Scree Slide (Agility 12) | Terrace 4 down to terrace 1, one-way |
| Chimney Climb (Agility 14) | Gravelmaw interior shortcut past chamber 2 |
| Cairn Leap (Agility 14) | Terrace 3 gap, opens a fishing circuit |
| The Gravelmaw | 3 chambers plus a boss arena |

**Gravelmaw dungeon.** Entrance in the quarry face. Chamber 1 is a lit gallery with 4 Cairnwights. Chamber 2 is a dark collapse with 6 Scree Skitterlings and a 3-lever stone door puzzle (the levers are described in The Long Cairn's stage 5 dialogue). Chamber 3 is the cairn hall, 2 Thornbound Elders, and the quest terminus for The Long Cairn. The boss arena is a 24 m circular chamber behind a door that only opens after The Long Cairn completes.

**Ordrun the Quarrykeeper.** Tier 10, 200 HP, attack level 20, accuracy +50, armour +50, magicArmour +18, maxHit 11, attack speed 3.0 s.

- Phase 1 (100% to 55% HP): melee only, chases, leashes at 24 m.
- Transition at 55%: Ordrun plants and stone plates rise around the arena. 3 s of invulnerability.
- Phase 2 (55% to 0%): every 12 s Ordrun telegraphs a ground slam. A 5 m red decal appears for 1.6 s, then deals 22 damage to anyone standing in it. Its melee cadence drops to 2.4 s. Armour drops to +38, so the fight speeds up if the player survives the slams.
- Death drops 900 to 1,400 marks, one guaranteed Kaldite item from a 4-entry table, the
  Quarrykeeper's Cairnstone quest item, and the singleton Water Orb on first acquisition.

**Look.** Cold blue-grey slate, lichen green-yellow accents, a single warm firelight source per camp. Sparse props, but very large ones. Sightlines are vertical: the player can see three terraces at once from most positions, which makes route planning readable at a glance.

**Landmarks:** the Highcairn crane, the Great Cairn on terrace 4, the Gravelmaw mouth (a 12 m black wound in grey stone, visible from terrace 1 anywhere).

### Visual system

- **Palette.** Each region has a locked 8-swatch palette in `render/materials.ts`. Tier is communicated by material, never by scale alone: Grithe is a soft grey with a warm ochre vein, Corven is a green-shot bronze, Kaldite is a blue-black with a cyan fracture line. The same three material treatments apply to ore nodes, bars, and every weapon and armour piece, so a Kaldite sword and a Kaldite seam read as the same substance at 12 m.
- **Material system.** One `MeshStandardMaterial` template per (region, family) pair, parameterised by tier colour, roughness, and an emissive fracture mask. Quaternius meshes get their materials replaced at load, so a single mesh serves all tiers.
- **Silhouette rule.** Tier changes scale by at most 20% and always change proportion. A Kaldite sword is 12% longer than a Grithe sword but has a distinctly wider guard, so tier reads in shadow.
- **Camera.** Elevated third person. Distance 4 m to 22 m (default 12 m), pitch 18 to 68 degrees (default 38), full yaw, smooth follow with a 0.12 s lag, and a spring that pulls in when geometry occludes the player.
- **Assets.** Quaternius Medieval Village MegaKit for Coldbrace, Rootfall, and Highcairn. Stylized Nature MegaKit for all three regions' flora and rock. Fantasy Props MegaKit for interiors, shops, and quest props. Universal Base Characters plus Modular Character Outfits: Fantasy for the player and NPCs. Universal Animation Library 1 and 2 for locomotion, gather, attack, and death. `game/public/assets/manifest.json` holds asset id, local file, original pack, source URL, license, category, tags, dimensions, animation list, and material info for every file shipped.
- **Procedural composition.** Poisson-disc scatter for grass, rock, and small props, keyed off biome masks, with exclusion zones around roads, buildings, nodes, NPCs, and every navmesh link. Roads and rivers are authored splines. Everything gameplay-relevant is placed by hand in region data. The scatter never places anything the player can interact with.

---

## 5. UI and controls

### Controls

| Input | Action |
| --- | --- |
| Left click on ground | Click-to-move. Paths over the navmesh, shows a destination marker. |
| Left click on entity | Default interaction (mine / chop / fish / attack / talk / open / climb / pick up). |
| Right click on entity or ground | Context menu listing every interaction, including unavailable ones with their requirement text. |
| W / A / S / D | Direct movement, camera-relative, cancels any active path and activity. |
| Shift | Hold to walk (1.9 m/s). |
| Right-drag or middle-drag | Rotate camera. |
| Mouse wheel | Zoom, 4 m to 22 m. |
| Space | Interact with the hovered entity, or the selected one if nothing is hovered. |
| Esc | Close the top panel, otherwise cancel the active activity. |
| I / K / E / Q / J | Inventory, Skills, Equipment, Quests, Journal (Locations). |
| 1 to 4 | Quick slots. Slot 1 is the equipped spell, slots 2 to 4 are consumables. |
| F1 | Toggle overlays. |
| F3 | Debug HUD (FPS, draw calls, position, region, active activity). |

Every interaction reachable by mouse also has a keyboard route, because Playwright drives some tests through keys.

### Panels

| Panel | Contents |
| --- | --- |
| HUD | Health bar with numeric `cur/max`, marks count, active activity bar with a label and progress, floating XP drops, event toast strip (bottom-left, 4 lines, 6 s decay), compass strip, Recovery Cache countdown banner when one is live. |
| Inventory | 4 x 7 grid, drag to reorder, left click uses, right click opens the context menu, hover shows the tooltip. |
| Skills | 11 rows: icon, name, level, XP bar, XP to next. Clicking a row opens that skill's generated guide with every unlock at every tier. |
| Equipment | Nine slots laid out around a character silhouette. The main-hand readout shows live elemental-weapon charge when applicable, and aggregate accuracy, power, armour, magicArmour, magicPower, and vitality totals appear below. |
| Bank | 8 x 10 visible grid with paging over 400 slots, quantity selector (1 / 5 / 10 / All / X), Deposit All button, substring name filter, inventory strip along the bottom for drag transfers. |
| Shop | Two columns, shop stock and player inventory, with buy and sell price on every row and a quantity selector. |
| Dialogue | Portrait, speaker name, body text, numbered option list. Options are keyboard-selectable with 1 to 9. |
| Quests | Left list grouped by region with status pips (not started / in progress / complete), right pane with the current stage text and the objective checklist. |
| Journal (Locations) | Every discovered location with its region, distance, and a Path button that draws the route overlay and starts navigation. This replaces the cut minimap. |
| Context menu | Appears at the cursor, lists interactions in priority order, greys unavailable entries with requirement text. |
| Tooltip | Item name, tier badge, equipment stats with a green/red delta against the currently equipped item, value, and requirements. |

### Overlays (four kinds only)

| Kind | Rendering | Set by |
| --- | --- | --- |
| `highlight` | Coloured outline on an entity's mesh, colour and thickness configurable | Player quest tracking, agent via `corealm_overlay` |
| `path` | A tube along a navmesh path, with an animated flow | Navigation, Journal Path button, agent |
| `marker` | A ground decal plus a screen-clamped off-screen arrow | Destination marker, quest targets, agent |
| `label` | A billboarded text sprite anchored to a world position or entity | Agent annotations |

Overlays live in their own scene layer, are excluded from picking, and are cleared by `corealm_overlay` with `op: "clear"` or F1.

---

## 6. Canonical game state

One store. `state/store.ts` owns it, everything else reads a frozen snapshot. Systems write through typed reducers so persistence and the debug API see one shape.

```ts
interface GameState {
  meta: {
    saveVersion: number;          // bump forces migrate.ts
    createdAtMs: number;
    lastSavedAtMs: number;
    playSeconds: number;
    seed: number;
  };
  player: {
    id: EntityId;                 // always "player"
    name: string;
    position: Vec3;
    facingRad: number;
    regionId: RegionId;
    health: number;
    maxHealth: number;            // derived, recomputed on skill or equipment change
    respawnPointId: string;       // "coldbrace" | "rootfall" | "highcairn"
    movement: {
      mode: "idle" | "path" | "direct";
      path: Vec3[] | null;
      pathIndex: number;
      destination: Vec3 | null;
      destinationEntityId: EntityId | null;
    };
  };
  skills: Record<SkillId, { xp: number; level: number }>;
  inventory: {
    slots: (InventorySlot | null)[];   // exactly 28
  };
  equipment: Record<EquipSlot, ItemStack | null>;   // exactly 9 keys
  magic: {
    // Canonical charge ledger for elemental weapon item ids.
    weaponCharges: Record<ItemId, number>;
    // Prevents a boss from replacing an Orb already consumed in elemental-weapon crafting.
    consumedOrbs: Record<ItemId, boolean>;
  };
  bank: {
    slots: ItemStack[];                // <= 400, dense, no nulls
    filter: string;
  };
  currency: number;                    // marks, mirrored into inventory as a stack
  activity: ActivityState | null;      // exactly one at a time
  combat: {
    targetId: EntityId | null;
    inCombatUntilMs: number;
    nextAttackAtMs: number;
    activeSpellId: SpellId | null;
    engagedBy: EntityId[];
  };
  quests: Record<QuestId, {
    status: "unstarted" | "active" | "complete";
    stage: number;
    counters: Record<string, number>;
    flags: Record<string, boolean>;
  }>;
  dialogue: {
    npcId: EntityId;
    nodeId: string;
    text: string;
    speaker: string;
    options: { id: string; text: string; enabled: boolean; disabledReason?: string }[];
  } | null;
  farming: Record<string, {            // plotId -> plot
    plotId: string;
    regionId: RegionId;
    cropId: ItemId | null;
    stage: number;
    stageCount: number;
    stageStartedAtMs: number;          // wall clock, survives reload
    state: "empty" | "raked" | "growing" | "ready";
  }>;
  world: {
    nodes: Record<EntityId, {
      remaining: number;
      state: "available" | "depleted";
      respawnAtMs: number | null;
    }>;
    enemies: Record<EntityId, {
      health: number;
      state: "idle" | "aggro" | "dead" | "returning";
      spawnPos: Vec3;
      respawnAtMs: number | null;
      bossPhase?: number;
    }>;
    obstaclesUsed: Record<EntityId, number>;   // traversal counts, for the journal
    lootPiles: Record<EntityId, {
      position: Vec3;
      items: ItemStack[];
      expiresAtMs: number;
      ownerOnly: boolean;
    }>;
    recoveryCache: {
      id: EntityId;
      position: Vec3;
      regionId: RegionId;
      items: ItemStack[];
      expiresAtMs: number;
    } | null;
  };
  discovery: {
    entities: Record<EntityId, number>;   // id -> first-seen wall clock ms
    locations: Record<string, number>;    // locationId -> first-visited ms
    regions: RegionId[];
  };
  settings: {
    cameraDistance: number;
    cameraPitchRad: number;
    overlaysVisible: boolean;
    uiScale: number;
  };
}
```

### The activity slice

Exactly one activity at a time, which is what makes agent parity easy to state and easy to test.

```ts
type ActivityState =
  | { kind: "gathering";  skill: SkillId; entityId: EntityId; nodeTier: number;
      startedAtMs: number; nextRollAtMs: number; yieldsThisSession: number }
  | { kind: "production"; skill: SkillId; recipeId: RecipeId; stationId: EntityId;
      remaining: number; completed: number; nextCompleteAtMs: number }
  | { kind: "traversing"; obstacleId: EntityId; endsAtMs: number }
  | { kind: "farming";    op: "rake" | "plant" | "harvest"; plotId: string; endsAtMs: number }
  | { kind: "eating";     itemId: ItemId; endsAtMs: number };
```

Combat is not an activity. It runs in the `combat` slice so a player can eat while auto-attacking, which they need to survive Ordrun.

### Persistence

- Key `corealm.save.v1` in `localStorage`, JSON, roughly 40 KB for a fully progressed Phase 1 character.
- Autosave at most every 10 s when dirty, plus on `beforeunload`, plus immediately after death, level gain, quest stage change, and any bank write.
- `meta.saveVersion` gates `persistence/migrate.ts`. An unmigratable save shows a dialog offering export-to-clipboard and a fresh start. It never silently wipes.
- Content-derived values (`maxHealth`, skill `level`, prices, recipes) are recomputed on load rather than trusted, so a content rebalance applies to existing saves.

---

## 7. Modules and frozen interfaces

### 7.1 File layout under `game/src/`, one owner per file

Ownership letters map to the build rounds in section 9. `ROOT` means only the root agent edits the file.

```
game/src/
  main.ts                        ROOT
  contracts.ts                   ROOT  (frozen, section 7.2)
  app/
    boot.ts                      ROOT
    loop.ts                      ROOT
    config.ts                    ROOT
  core/
    rng.ts                       ROOT
    events.ts                    ROOT
    time.ts                      ROOT
    math.ts                      ROOT
  state/
    store.ts                     ROOT
    selectors.ts                 ROOT
  content/
    index.ts                     ROOT
    validate.ts                  ROOT
    xp.ts                        ROOT
    skills.ts                    ROOT
    items.ts                     C1
    equipment.ts                 C1
    resources.ts                 B1
    recipes.ts                   C1
    spells.ts                    D1
    enemies.ts                   D1
    npcs.ts                      E1
    quests.ts                    E1
    dialogue.ts                  E1
    regions.ts                   A1
    shops.ts                     C1
  world/
    entities.ts                  A1
    spatial.ts                   A1
    regionBuilder.ts             A1
    scatter.ts                   A2
    interactions.ts              A1
  systems/
    movement.ts                  A2
    navigation.ts                A2
    physics.ts                   A2
    inventory.ts                 B2
    bank.ts                      B2
    equipment.ts                 C2
    gathering.ts                 B1
    production.ts                C2
    economy.ts                   C2
    combat.ts                    D2
    enemyAI.ts                   D2
    health.ts                    D2
    death.ts                     D2
    farming.ts                   B3
    agility.ts                   A3
    quests.ts                    E2
    dialogue.ts                  E2
  render/
    renderer.ts                  ROOT
    scene.ts                     A2
    camera.ts                    A2
    assets.ts                    ROOT
    materials.ts                 A2
    entityViews.ts               A2
    characterRig.ts              D3
    overlays.ts                  F2
    vfx.ts                       D3
  ui/
    hud.ts                       B4
    inventoryPanel.ts            B4
    skillsPanel.ts               B4
    equipmentPanel.ts            C3
    bankPanel.ts                 B4
    shopPanel.ts                 C3
    dialoguePanel.ts             E3
    questPanel.ts                E3
    journalPanel.ts              F3
    contextMenu.ts               A4
    tooltips.ts                  C3
    styles.css                   A4
  input/
    mouse.ts                     A4
    keyboard.ts                  A4
    picking.ts                   A4
  api/
    gameApi.ts                   ROOT
    observation.ts               F1
    docs.ts                      F3
  agent/
    webmcp.ts                    F1
    tools.ts                     F1
    events.ts                    F1
  persistence/
    storage.ts                   ROOT
    migrate.ts                   ROOT
  debug/
    gameDebug.ts                 ROOT
```

Rule: no worker edits `contracts.ts`, `store.ts`, `gameApi.ts`, or `gameDebug.ts`. A worker who needs a change there stops and reports, per AGENTS.md rule 5.

### 7.2 `game/src/contracts.ts`, the frozen exports

These signatures are the contract the root reviews and freezes before any parallel work.

```ts
// ---------- primitives ----------
export type Vec3 = readonly [number, number, number];

export type SkillId =
  | "melee" | "magic"
  | "mining" | "woodcutting" | "fishing" | "farming"
  | "smithing" | "crafting" | "cooking" | "fletching"
  | "agility";

export type RegionId = "fallowmarch" | "vellenwood" | "karrowmoor" | "gravelmaw";

export type EquipSlot =
  | "head" | "body" | "legs" | "feet" | "hands"
  | "mainHand" | "offHand" | "accessory1" | "accessory2";

export type EntityId = string;   // "ore_t10_0042", "npc_coldbrace_smith", "player"
export type ItemId   = string;   // "kaldite_ore", "seared_cragfin"
export type RecipeId = string;
export type SpellElement = "wind" | "water" | "earth" | "fire";
export type SpellRung = "lash" | "bolt" | "burst" | "surge";
export type SpellId =
  | "voltrend" | "stonebrand" | "rimewash" | "emberlash"
  | "skirlbolt" | "sleetbolt" | "shalebolt" | "cinderbolt"
  | "galeburst" | "spateburst" | "cragburst" | "pyreburst"
  | "squallsurge" | "tidesurge" | "scarpsurge" | "kilnsurge";
export type QuestId  = string;

export type Archetype =
  | "ore" | "tree" | "fishing_spot" | "farm_plot"
  | "enemy" | "boss" | "npc" | "station" | "bank" | "shop"
  | "obstacle" | "door" | "portal" | "loot" | "recovery_cache" | "landmark";

export type InteractionId =
  | "inspect" | "mine" | "chop" | "fish" | "rake" | "plant" | "harvest"
  | "attack" | "cast" | "talk" | "open" | "enter" | "climb" | "vault"
  | "loot" | "take" | "produce" | "recharge" | "bank" | "trade" | "equip" | "unequip";

// ---------- items and equipment ----------
export interface ItemStack { itemId: ItemId; quantity: number; }
export interface InventorySlot extends ItemStack { slotIndex: number; }

export interface EquipmentBonuses {
  accuracy: number;      // percent, additive
  power: number;         // melee maxHit input
  armour: number;        // percent, additive
  magicAccuracy: number;
  magicPower: number;
  magicArmour: number;
  vitality: number;      // flat max health
}

export interface ItemDef {
  id: ItemId;
  name: string;
  tier: number;                       // 0..99; tier 0 is starter equipment
  description: string;
  stackable: boolean;
  value: number;                      // shop buy price; sell is round(value * 0.6)
  category: "resource" | "bar" | "equipment" | "food" | "tool" | "seed" | "quest" | "currency" | "component";
  equip?: {
    slot: EquipSlot;
    bonuses: EquipmentBonuses;
    attackSpeedMs?: number;           // main hand only
    requires: Partial<Record<SkillId, number>>;
  };
  magicWeapon?: {
    kind: "wand" | "staff";
    hands: 1 | 2;
    charge?: {
      element: SpellElement; capacity: number; initialCharges: number;
      rechargeItemId: ItemId; rechargeCost: number; orbItemId: ItemId; released: boolean;
    };
  };
  orb?: {
    element: SpellElement; released: boolean;
  };
  food?: { healAmount: number };
  tool?: { skill: SkillId; gatherBonus: number };
  seed?: { cropId: ItemId };
}

// ---------- semantic entity, the shared world object ----------
export interface SemanticEntity {
  id: EntityId;
  archetype: Archetype;
  name: string;
  tier: number;
  regionId: RegionId;
  position: Vec3;
  state: string;                                   // archetype-specific, e.g. "available" | "depleted"
  requirements?: Partial<Record<SkillId, number>>;
  interactions: InteractionId[];
  resource?: { remaining: number; maxYields: number; respawnSeconds: number; itemId: ItemId };
  combat?: { health: number; maxHealth: number; level: number; aggroRadius: number };
  npc?: { dialogueRootId: string; questIds: QuestId[] };
  station?: { skill: SkillId; recipeIds: RecipeId[] };
  obstacle?: { reqLevel: number; exitPosition: Vec3; durationMs: number; savesMeters: number };
  meta?: Record<string, string | number | boolean>;
}

// ---------- observation, what the agent and UI can see ----------
export type ObservationScope = "visible" | "known";

export interface ObservedEntity {
  id: EntityId;
  archetype: Archetype;
  name: string;
  tier: number;
  regionId: RegionId;
  position: Vec3;
  distance: number;                 // metres from the player, path distance not straight line
  state: string;
  interactions: InteractionId[];
  requirementsMet: boolean;
  blockedBy?: string;               // "Requires Mining 10"
}

export interface ObserveFilter {
  scope?: ObservationScope;
  radius?: number;                  // default 40, max 140
  archetypes?: Archetype[];
  interaction?: InteractionId;
  requirementsMet?: boolean;
  regionId?: RegionId;
  limit?: number;                   // default 25, max 100
}

// ---------- errors ----------
export type GameErrorCode =
  | "NOT_FOUND" | "OUT_OF_RANGE" | "NOT_REACHABLE" | "REQUIREMENTS_NOT_MET"
  | "INVENTORY_FULL" | "BUSY" | "INVALID_ARGUMENT" | "DEAD" | "DEPLETED"
  | "NOT_ENOUGH_CURRENCY" | "NOT_ENOUGH_ITEMS" | "NO_DIALOGUE"
  | "TIMEOUT" | "UNAVAILABLE";

export interface GameError { code: GameErrorCode; message: string; entityId?: EntityId; }
export type Result<T> = { ok: true; value: T } | { ok: false; error: GameError };

// ---------- events ----------
export type GameEventType =
  | "navigation.started" | "navigation.completed" | "navigation.failed"
  | "activity.started" | "activity.stopped"
  | "resource.depleted" | "inventory.full"
  | "item.received" | "item.lost"
  | "combat.started" | "combat.ended" | "spell.launched" | "essence.recharged"
  | "health.low" | "player.died"
  | "level.gained" | "production.completed"
  | "quest.updated" | "dialogue.opened" | "dialogue.closed"
  | "entity.discovered";

export interface GameEvent {
  seq: number;                      // monotonic, never reused
  type: GameEventType;
  atMs: number;                     // sim clock
  entityId?: EntityId;
  data: Record<string, unknown>;    // shape per type, documented in section 7.5
}

// ---------- the canonical API, the only way to change the world ----------
export interface GameApi {
  // state
  getPlayer(): PlayerView;
  getSkills(): Record<SkillId, { level: number; xp: number; xpToNext: number }>;
  getInventory(): { slots: (InventorySlot | null)[]; freeSlots: number };
  getEquipment(): { slots: Record<EquipSlot, ItemStack | null>; totals: EquipmentBonuses };
  getActivity(): ActivitySummary | null;
  getQuests(): QuestSummary[];
  getCurrency(): number;

  // observation
  observe(filter: ObserveFilter): ObservedEntity[];
  inspect(entityId: EntityId): Result<SemanticEntity>;
  searchDocs(query: string, limit?: number): DocHit[];

  // movement
  moveTo(target: { entityId: EntityId } | { position: Vec3 } | { locationId: string }): Result<{ pathLength: number; etaMs: number }>;
  stop(): Result<{ stopped: string[] }>;

  // interaction
  interact(entityId: EntityId, interaction: InteractionId): Result<{ started: string }>;
  useItem(itemId: ItemId, target?: { itemId: ItemId } | { entityId: EntityId }): Result<{ effect: string }>;
  equipItem(itemId: ItemId): Result<{ slot: EquipSlot; replaced: ItemId | null }>;
  unequipItem(slot: EquipSlot): Result<{ itemId: ItemId }>;
  produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }>;

  // combat
  attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }>;
  cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }>;

  // npc, bank, shop
  dialogue(op: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null>;
  bank(op: "list" | "deposit" | "withdraw" | "depositAll", args?: { itemId?: ItemId; quantity?: number; filter?: string }): Result<BankView>;
  shop(op: "list" | "buy" | "sell", args?: { shopId?: EntityId; itemId?: ItemId; quantity?: number }): Result<ShopView>;

  // overlays
  overlay(op: "set" | "clear", spec?: OverlaySpec): Result<{ activeCount: number }>;

  // events
  events(sinceSeq: number, filter?: GameEventType[], timeoutMs?: number): Promise<{ events: GameEvent[]; nextSeq: number }>;
}

export interface PlayerView {
  position: Vec3; regionId: RegionId; health: number; maxHealth: number;
  inCombat: boolean; dead: boolean; moving: boolean; activityKind: string | null;
  combatLevelEstimate: number;
}

export interface ActivitySummary {
  kind: string; skill?: SkillId; entityId?: EntityId; recipeId?: RecipeId;
  progress: number;            // 0..1 for the current unit
  completed: number; remaining: number;
}

export interface QuestSummary {
  id: QuestId; name: string; regionId: RegionId;
  status: "unstarted" | "active" | "complete";
  stage: number; stageCount: number;
  currentObjective: string | null;
  requirements: Partial<Record<SkillId, number>>;
}

export interface DialogueView {
  npcId: EntityId; speaker: string; text: string;
  options: { id: string; text: string; enabled: boolean; disabledReason?: string }[];
}

export interface BankView { slots: ItemStack[]; usedSlots: number; capacity: number; }
export interface ShopView { shopId: EntityId; stock: { itemId: ItemId; name: string; buyPrice: number; sellPrice: number; quantity: number }[]; currency: number; }
export interface DocHit { docId: string; title: string; section: string; snippet: string; score: number; }

export interface OverlaySpec {
  id: string;
  kind: "highlight" | "path" | "marker" | "label";
  entityId?: EntityId;
  position?: Vec3;
  path?: Vec3[];
  text?: string;
  colour?: string;             // "#rrggbb"
  ttlMs?: number;              // default 0, meaning until cleared
}
```

`gameApi.ts` is the single implementation of `GameApi`. `ui/*`, `agent/tools.ts`, and `debug/gameDebug.ts` all go through it. There is no second path into the world.

### 7.3 Content schemas the workers author against

`content/validate.ts` runs a hand-written validator (no external schema dependency) over every content file at boot and throws with the offending id. Required shapes:

```ts
export interface ResourceNodeDef {
  id: string; archetype: "ore" | "tree" | "fishing_spot"; tier: number;
  name: string; skill: SkillId; reqLevel: number; itemId: ItemId;
  assetId: string; depletedAssetId: string;
  yieldRange?: readonly [number, number]; // exceptional authored capacity, inclusive
  respawnSeconds?: number;               // exceptional authored depletion cooldown
}

export interface RecipeDef {
  id: RecipeId; name: string; skill: SkillId; reqLevel: number; tier: number;
  inputs: ItemStack[]; output: ItemStack; xp: number; durationMs: number;
  stationKind: "furnace" | "anvil" | "range" | "crafting_table" | "fletching_bench";
}

export interface SpellDef {
  id: SpellId; name: string; tier: number; reqLevel: number;
  element: SpellElement; rung: SpellRung;
  baseMax: number; divisor: number; baseXp: number; castMs: number;
  cost: { element: SpellElement; charges: number }; description: string;
}

export interface EnemyDef {
  id: string; family: string; name: string; tier: number;
  maxHealth: number; attackLevel: number; defenceLevel: number;
  accuracy: number; armour: number; magicArmour: number;
  maxHit: number; attackSpeedMs: number;
  behaviour: "passive" | "aggressive" | "territorial";
  aggroRadius: number; leashRadius: number;
  lootTable: { itemId: ItemId; min: number; max: number; chance: number }[];
  assetId: string; animationSet: string;
  boss?: { phases: { atHealthFraction: number; armour: number; attackSpeedMs: number; telegraphId?: string }[] };
}

export interface QuestDef {
  id: QuestId; name: string; regionId: RegionId;
  kind: "local" | "skill" | "puzzle" | "dungeon" | "chain";
  requirements: Partial<Record<SkillId, number>>;
  prerequisiteQuestIds: QuestId[];
  stages: QuestStageDef[];
  rewards: { xp: Partial<Record<SkillId, number>>; items: ItemStack[]; currency: number; unlocks: string[] };
}

export interface QuestStageDef {
  index: number;
  objective: string;                  // shown in the quest panel and returned by getQuests()
  completion:
    | { kind: "talk"; npcId: EntityId; dialogueNodeId: string }
    | { kind: "have"; itemId: ItemId; quantity: number }
    | { kind: "kill"; enemyFamily: string; count: number }
    | { kind: "gather"; itemId: ItemId; count: number }
    | { kind: "produce"; recipeId: RecipeId; count: number }
    | { kind: "reach"; locationId: string }
    | { kind: "traverse"; obstacleId: EntityId }
    | { kind: "flag"; flag: string };
  hint: string;                       // surfaced through docs search and the quest panel
}

export interface RegionDef {
  id: RegionId; name: string; tier: number; seed: number;
  bounds: { min: Vec3; max: Vec3 };
  spawnPoint: Vec3; respawnPointId: string;
  terrainAssetId: string; navmeshFile: string;
  palette: string[];                  // exactly 8 hex swatches
  placements: PlacementDef[];         // authored, one per gameplay entity
  scatter: ScatterLayerDef[];         // seeded, no gameplay entities
  links: { toRegionId: RegionId; position: Vec3; exitPosition: Vec3 }[];
}
```

### 7.4 The WebMCP tool set, 16 tools

Design rule: a tool is one player verb, not one code path. Every tool maps to a `GameApi` call, every tool returns a plain JSON object, and every failure returns `{ error: { code, message } }` with a code from `GameErrorCode`.

Registration goes through the browser's WebMCP registration API in `agent/webmcp.ts`, behind a thin adapter so a spec change touches one file. The same tool table is callable in-page through `__gameDebug.callTool(name, args)`, which is how Playwright proves human and agent parity.

| # | Tool | Purpose |
| --- | --- | --- |
| 1 | `corealm_get_state` | Everything about the player, filtered by section |
| 2 | `corealm_observe` | List entities, visible or known |
| 3 | `corealm_inspect` | Full detail on one entity |
| 4 | `corealm_search_docs` | Query the generated documentation |
| 5 | `corealm_move` | Navigate to an entity, a location, or a point |
| 6 | `corealm_interact` | Start any world interaction |
| 7 | `corealm_stop` | Cancel movement, activity, and combat |
| 8 | `corealm_attack` | Melee or spell attack |
| 9 | `corealm_use_item` | Eat, use, or use-on |
| 10 | `corealm_equip` | Equip or unequip |
| 11 | `corealm_produce` | Start a production batch |
| 12 | `corealm_dialogue` | Read, choose, or end dialogue |
| 13 | `corealm_bank` | List, deposit, withdraw, deposit all |
| 14 | `corealm_shop` | List, buy, sell |
| 15 | `corealm_overlay` | Set or clear assistance overlays |
| 16 | `corealm_events` | Drain or wait on the event queue |

**1. `corealm_get_state`**
Args: `{ sections?: ("player"|"skills"|"inventory"|"equipment"|"activity"|"quests"|"currency")[] }`. Default returns `player`, `activity`, and `currency` only, which keeps the common poll under 200 tokens.
Returns: `{ player?: PlayerView, skills?: {...}, inventory?: {...}, equipment?: {...}, activity?: ActivitySummary|null, quests?: QuestSummary[], currency?: number }`.
Errors: `INVALID_ARGUMENT` on an unknown section.

**2. `corealm_observe`**
Args: `{ scope?: "visible"|"known", radius?: number, archetypes?: Archetype[], interaction?: InteractionId, requirementsMet?: boolean, regionId?: RegionId, limit?: number }`. Defaults: `scope: "visible"`, `radius: 40`, `limit: 25`. Radius caps at 140 which is the view distance, and `scope: "known"` ignores radius and returns discovered entities and locations across all visited regions.
Returns: `{ entities: ObservedEntity[], truncated: boolean, totalMatched: number }`.
Errors: `INVALID_ARGUMENT`.

**3. `corealm_inspect`**
Args: `{ entityId: string }`.
Returns: the full `SemanticEntity` plus `{ distance: number, requirementsMet: boolean, blockedBy?: string, reachable: boolean }`.
Errors: `NOT_FOUND` if the id does not exist or has never been discovered.

**4. `corealm_search_docs`**
Args: `{ query: string, limit?: number }` (default 5, max 20).
Returns: `{ hits: DocHit[] }`.
Errors: `INVALID_ARGUMENT` on an empty query. Never returns undiscovered quest content.

**5. `corealm_move`**
Args: `{ to: { entityId: string } | { locationId: string } | { position: [number,number,number] }, stopWithin?: number, wait?: boolean, timeoutMs?: number }`. `stopWithin` defaults to the target's interaction range. `wait` defaults to `false`, so the tool returns immediately and the agent listens for `navigation.completed`. `wait: true` blocks until arrival or `timeoutMs` (default 60000, max 180000).
Returns: `{ started: true, pathLength: number, etaMs: number, arrived?: boolean, position?: Vec3 }`.
Errors: `NOT_FOUND`, `NOT_REACHABLE` (no navmesh path), `DEAD`, `TIMEOUT`, `INVALID_ARGUMENT`.
Movement always runs at 4.2 m/s on the navmesh. There is no fast path.

**6. `corealm_interact`**
Args: `{ entityId: string, interaction: InteractionId }`.
Returns: `{ started: "gathering"|"production"|"recharged ..."|"traversing"|"farming"|"dialogue"|"bank"|"shop"|"loot"|"door", activity?: ActivitySummary }`.
Errors: `NOT_FOUND`, `OUT_OF_RANGE` (with the required distance in the message), `REQUIREMENTS_NOT_MET`, `DEPLETED`, `INVENTORY_FULL`, `BUSY`, `DEAD`, `UNAVAILABLE`.
One call starts exactly the continuing activity one human click starts.

**7. `corealm_stop`**
Args: `{ what?: ("movement"|"activity"|"combat")[] }`, defaults to all three.
Returns: `{ stopped: string[] }`. Never errors except `DEAD`.

**8. `corealm_attack`**
Args: `{ entityId: string, spellId?: SpellId }`. With a wand or staff, omitting `spellId` uses the
standing spell choice or strongest compatible charged spell. With a non-magic weapon it means melee.
Returns: `{ targetId: string, attackSpeedMs: number, targetHealth: number, targetMaxHealth: number }`.
Errors: `NOT_FOUND`, `OUT_OF_RANGE`, `REQUIREMENTS_NOT_MET` (spell level, weapon, matching orb, or empty orb), `DEAD`, `UNAVAILABLE` (target already dead or non-hostile).

**9. `corealm_use_item`**
Args: `{ itemId: string, on?: { itemId: string } | { entityId: string } }`.
Returns: `{ effect: string, healed?: number, consumed?: ItemStack }`.
Errors: `NOT_ENOUGH_ITEMS`, `NOT_FOUND`, `OUT_OF_RANGE`, `BUSY`, `UNAVAILABLE`, `DEAD`.

**10. `corealm_equip`**
Args: `{ op: "equip"|"unequip", itemId?: string, slot?: EquipSlot }`. `equip` needs `itemId`, `unequip` needs `slot`.
Returns: `{ slot: EquipSlot, itemId: string|null, replaced: string|null, totals: EquipmentBonuses, maxHealth: number }`.
Errors: `NOT_FOUND`, `NOT_ENOUGH_ITEMS`, `REQUIREMENTS_NOT_MET`, `INVENTORY_FULL` (unequip with a full inventory), `INVALID_ARGUMENT`.

**11. `corealm_produce`**
Args: `{ recipeId: string, quantity: number }` (quantity 1 to 28).
Returns: `{ queued: number, durationMs: number, perUnitXp: number, missing?: ItemStack[] }`.
Errors: `NOT_FOUND`, `OUT_OF_RANGE` (not at the right station), `REQUIREMENTS_NOT_MET`, `NOT_ENOUGH_ITEMS`, `BUSY`, `INVENTORY_FULL`.

**12. `corealm_dialogue`**
Args: `{ op: "state"|"choose"|"end", optionId?: string }`.
Returns: `DialogueView | null`, plus `{ questUpdated?: QuestId }` when a choice advances a quest.
Errors: `NO_DIALOGUE`, `INVALID_ARGUMENT` (unknown or disabled option), `UNAVAILABLE`.

**13. `corealm_bank`**
Args: `{ op: "list"|"deposit"|"withdraw"|"depositAll", itemId?: string, quantity?: number, filter?: string }`. `quantity: -1` means all of that item.
Returns: `{ slots: ItemStack[], usedSlots: number, capacity: 400, moved?: ItemStack }`.
Errors: `OUT_OF_RANGE` (not at a bank), `NOT_ENOUGH_ITEMS`, `INVENTORY_FULL`, `INVALID_ARGUMENT`.

**14. `corealm_shop`**
Args: `{ op: "list"|"buy"|"sell", itemId?: string, quantity?: number }`. The shop is whichever one the player currently has open.
Returns: `ShopView` plus `{ traded?: ItemStack, marksDelta?: number }`.
Errors: `OUT_OF_RANGE`, `NOT_ENOUGH_CURRENCY`, `NOT_ENOUGH_ITEMS`, `INVENTORY_FULL`, `UNAVAILABLE` (shop does not buy that item).

**15. `corealm_overlay`**
Args: `{ op: "set"|"clear", overlays?: OverlaySpec[], ids?: string[] }`. `clear` with no `ids` clears everything the agent set. Cap of 32 simultaneous agent overlays.
Returns: `{ activeCount: number }`.
Errors: `INVALID_ARGUMENT`, `NOT_FOUND` (overlay anchored to an unknown entity).
Overlays are cosmetic. They never change game state, which keeps agent parity honest.

**16. `corealm_events`**
Args: `{ sinceSeq: number, types?: GameEventType[], timeoutMs?: number, maxEvents?: number }`. `timeoutMs: 0` (default) drains immediately. Any positive value up to 180000 blocks until a matching event arrives or the timeout fires.
Returns: `{ events: GameEvent[], nextSeq: number, dropped: number }`. `dropped` is non-zero when the agent fell more than 256 events behind, which tells it to re-sync with `corealm_get_state`.
Errors: `INVALID_ARGUMENT`. A timeout returns `{ events: [], nextSeq }` rather than an error, because an empty wait is a normal result.

**Token-efficiency shape.** The intended agent loop is: `corealm_get_state` once at start, `corealm_observe` once per location change, `corealm_interact` to start an activity, then `corealm_events` with a long timeout until something happens. A well-built agent mining from 1 to 10 should need under 60 tool calls. A polling agent needs several hundred, and that gap is the metagame.

### 7.5 Events and delivery

**Delivery mechanism.** `agent/events.ts` owns a 256-entry ring buffer of `GameEvent`, with a monotonic `seq` that never resets inside a session. Systems append through `core/events.ts` during sim tick 14 (section 3), so all events for a tick land together and in a stable order. Three consumers read the same buffer:

- `corealm_events` over WebMCP, cursor-based with optional long-poll. Waiters register a promise plus a type filter and resolve on the next matching append or on timeout. This is the primary mechanism, and it works regardless of what push support the WebMCP implementation has.
- The HUD toast strip, which subscribes in-process.
- `__gameDebug.getEvents(sinceSeq)`, which does a non-blocking drain for Playwright.

If the shipping WebMCP implementation supports server-initiated notifications, `agent/webmcp.ts` also pushes each event as a notification. That is an enhancement layered on top, never the only path, because the spec surface is the biggest unknown in this build (see section 10).

**Event catalogue.** `data` shapes are exact.

| Type | `data` |
| --- | --- |
| `navigation.started` | `{ to: Vec3, entityId?: string, pathLength: number, etaMs: number }` |
| `navigation.completed` | `{ at: Vec3, entityId?: string, tookMs: number }` |
| `navigation.failed` | `{ reason: "unreachable"\|"blocked"\|"cancelled"\|"dead", at: Vec3 }` |
| `activity.started` | `{ kind: string, skill?: SkillId, entityId?: string, recipeId?: string }` |
| `activity.stopped` | `{ kind: string, reason: "completed"\|"depleted"\|"inventory_full"\|"moved"\|"combat"\|"cancelled"\|"missing_items"\|"died", completed: number }` |
| `resource.depleted` | `{ entityId: string, itemId: string, respawnInSeconds: number, yieldsTaken: number }` |
| `inventory.full` | `{ blockedItemId: string }` |
| `item.received` | `{ itemId: string, quantity: number, source: "gather"\|"loot"\|"produce"\|"quest"\|"shop"\|"bank"\|"harvest" }` |
| `item.lost` | `{ itemId: string, quantity: number, reason: "consumed"\|"sold"\|"banked"\|"died"\|"burnt" }` |
| `combat.started` | `{ targetId: string, targetName: string, targetLevel: number, initiator: "player"\|"enemy" }` |
| `combat.ended` | `{ targetId: string, outcome: "killed"\|"escaped"\|"died"\|"leashed", xpGained: number }` |
| `spell.launched` | `{ spellId: SpellId, targetId: string, element: SpellElement, rung: SpellRung, flightMs: number, hit: boolean, orbItemId: ItemId, remainingCharges: number }` |
| `essence.recharged` | `{ altarId: string, orbItemId: ItemId, element: SpellElement, essenceItemId: ItemId, before: number, after: 1000, essenceSpent: 100 }` |
| `health.low` | `{ health: number, maxHealth: number, fraction: number }` fires once per crossing below 0.30 |
| `player.died` | `{ at: Vec3, regionId: RegionId, killerId?: string, cacheId: string, cacheExpiresAtMs: number, respawnAt: Vec3 }` |
| `level.gained` | `{ skill: SkillId, level: number, unlocked: string[] }` |
| `production.completed` | `{ recipeId: string, itemId: string, quantity: number, xp: number, burnt: boolean, remaining: number }` |
| `quest.updated` | `{ questId: string, status: string, stage: number, stageCount: number, objective: string\|null }` |
| `dialogue.opened` | `{ npcId: string, speaker: string, optionCount: number }` |
| `dialogue.closed` | `{ npcId: string }` |
| `entity.discovered` | `{ entityId: string, archetype: Archetype, name: string, regionId: RegionId }` |

Events report facts. They never contain instructions, and they never leak undiscovered content. `entity.discovered` fires only after the entity has actually entered the player's 40 m observation radius with line of sight.

### 7.6 `window.__gameDebug`

Never called by game code. Installed by `debug/gameDebug.ts` at boot, and it wraps `GameApi` rather than reaching into the store.

**Harness-required methods (9).** These are the generic contract `tools/` depends on. The root must confirm the exact names against the existing harness before freezing, since this PRD agent did not read `tools/` (see section 10, assumption A1).

| # | Method | Signature | Purpose |
| --- | --- | --- | --- |
| 1 | `ready` | `() => boolean` | True once boot step 10 completes. Playwright polls this before anything else. |
| 2 | `getState` | `() => GameState` | Deep-cloned, JSON-safe snapshot of the whole canonical state. |
| 3 | `getVersion` | `() => { build: string; contracts: string; content: string }` | Build hash, contracts hash, content hash. Detects a stale bundle. |
| 4 | `setPaused` | `(paused: boolean) => void` | Halts the sim loop. Rendering continues so screenshots stay valid. |
| 5 | `step` | `(ms: number) => void` | Advances the sim by exactly `ms` while paused, in 100 ms sim ticks. |
| 6 | `getMetrics` | `() => { fps, frameMs, drawCalls, triangles, entityCount, heapMB }` | The performance assertion source. |
| 7 | `getErrors` | `() => { atMs: number; source: string; message: string; stack?: string }[]` | Every console error, unhandled rejection, and content validation warning since boot. |
| 8 | `waitForIdle` | `(timeoutMs?: number) => Promise<boolean>` | Resolves when no navigation, activity, combat, or asset load is pending. The standard "settle" call before a state comparison. |
| 9 | `reset` | `(opts?: { seed?: number; keepSave?: boolean }) => Promise<void>` | Wipes the save (unless `keepSave`), reseeds, rebuilds the world, resolves when `ready()` is true again. |

**Game-specific deterministic-test helpers.** Everything Phase 1 needs to make a scenario reproducible in under 30 seconds of wall clock.

| Method | Signature | Purpose |
| --- | --- | --- |
| `setTimeScale` | `(scale: number) => void` | 0.1 to 100. Multiplies the sim clock only. Render stays real time. |
| `advanceGameTime` | `(seconds: number) => void` | Jumps node respawn timers, crop growth, loot expiry, and the recovery cache clock forward without simulating the frames between. The only way to test a 900 s Cairnleaf. |
| `teleport` | `(to: Vec3 \| { entityId: string } \| { locationId: string }) => void` | Snaps the player to the navmesh at the target. Test setup only, never exposed to WebMCP. |
| `grantXp` | `(skill: SkillId, amount: number) => void` | Adds XP through the real level-up path so `level.gained` still fires. |
| `setSkillLevel` | `(skill: SkillId, level: number) => void` | Sets XP to `totalXpAt(level)` exactly. Used to set up tier 10 scenarios without an hour of grinding. |
| `giveItem` | `(itemId: ItemId, quantity: number, to?: "inventory" \| "bank") => Result<void>` | Defaults to inventory, respects the 28-slot limit and returns `INVENTORY_FULL`. |
| `clearInventory` | `() => void` | Empties all 28 slots. |
| `setCurrency` | `(marks: number) => void` | Sets the mark balance. |
| `setHealth` | `(health: number) => void` | Clamped to `[0, maxHealth]`. Setting 0 runs the real death path. |
| `setSeed` | `(seed: number) => void` | Reseeds every RNG stream. Combined with `setPaused` and `step`, makes combat rolls reproducible. |
| `loadScenario` | `(name: string) => Promise<void>` | Applies a named fixture from `debug/scenarios.ts`. Phase 1 ships: `fresh`, `tier1_ready`, `tier5_ready`, `tier10_ready`, `boss_ready`, `bank_full`, `farming_planted`, `quest_longcairn_stage4`, `dead_with_cache`. |
| `forceRespawn` | `(entityId: EntityId) => void` | Immediately respawns a node or enemy. |
| `depleteNode` | `(entityId: EntityId) => void` | Sets `remaining` to 0 and runs the real depletion path. |
| `setQuestStage` | `(questId: QuestId, stage: number) => void` | Jumps a quest to a stage, applying prior-stage flags. |
| `getEntity` | `(entityId: EntityId) => SemanticEntity \| null` | Full entity, ignoring discovery gating. Test-only visibility. |
| `listEntities` | `(filter?: { archetype?: Archetype; regionId?: RegionId; tier?: number }) => SemanticEntity[]` | Ungated entity listing for locating test targets. |
| `getEvents` | `(sinceSeq: number) => { events: GameEvent[]; nextSeq: number }` | Non-blocking drain of the same ring buffer WebMCP reads. |
| `callTool` | `(name: string, args: unknown) => Promise<unknown>` | Invokes a WebMCP tool in-page. This is how the parity tests prove one agent call equals one human click. |
| `getNavPath` | `(from: Vec3, to: Vec3) => Vec3[] \| null` | Raw navmesh query, for asserting reachability and path length. |
| `focusCamera` | `(shotId: string) => Promise<void>` | Moves the camera to a named repeatable screenshot pose from `debug/shots.ts`, resolves when the frame is stable. |
| `listShots` | `() => string[]` | The 18 screenshot ids in section 8.7. |
| `saveNow` | `() => Promise<void>` | Forces a persistence write. |
| `getSaveBlob` | `() => string` | The raw JSON that would be written. |
| `loadSaveBlob` | `(json: string) => Promise<void>` | Loads a save, runs migrations, rebuilds the world. |

---

## 8. Acceptance criteria as browser-observable checks

Every criterion below is a Playwright script that touches `window.__gameDebug`, performs an action the way a human or agent would, and compares state. No criterion is satisfied by reading source.

Shared preamble for every test:

```js
await page.waitForFunction(() => window.__gameDebug?.ready() === true, { timeout: 20000 });
await page.evaluate(() => window.__gameDebug.reset({ seed: 1337 }));
await page.evaluate(() => window.__gameDebug.waitForIdle());
```

Every test ends by asserting `__gameDebug.getErrors()` has length 0.

### 8.1 Boot and world

| # | Check |
| --- | --- |
| A1 | `ready()` returns true within 20 s. `getErrors()` is empty. |
| A2 | `getState().player.regionId === "fallowmarch"` and `getState().player.position` is within 3 m of Fallowmarch's `spawnPoint`. |
| A3 | `listEntities({ regionId: "fallowmarch" })` returns at least 40 entities, including at least 6 with `archetype === "ore"` and `tier === 1`. |
| A4 | `getMetrics().fps >= 55` averaged over 5 s at the `town_center` shot, and `getMetrics().drawCalls < 400`. |
| A5 | After `focusCamera("vellenwood_canopy")`, `getMetrics().fps >= 55` and `drawCalls < 400`. |

### 8.2 Movement, camera, navigation

| # | Check |
| --- | --- |
| B1 | Record `p0 = getState().player.position`. Hold `KeyW` for 1000 ms. `p1` differs from `p0` by 3.6 m to 4.8 m, and `p1[1]` follows terrain height within 0.5 m. |
| B2 | Click a ground point 60 m away. Within 200 ms `getState().player.movement.mode === "path"` and `path.length > 1`. Await `navigation.completed`. Final position is within 1.5 m of the click target. |
| B3 | `getNavPath(coldbraceBank, upperKarrowSeam)` returns a non-null path of length 380 m to 460 m, proving the three regions are connected on one navmesh. |
| B4 | Click a point inside a building's collider. The event is `navigation.failed` with `reason: "unreachable"`, or the player stops at the nearest valid point without penetrating the collider. Never both. |
| B5 | Scroll wheel changes `getState().settings.cameraDistance` within `[4, 22]`, and right-drag changes camera yaw. `focusCamera` restores an exact pose, byte-identical screenshots across two runs at the same seed. |
| B6 | While the player walks a 40 m path, `getMetrics().fps >= 55` throughout. |

### 8.3 Gathering, inventory, banking

| # | Check |
| --- | --- |
| C1 | `setSkillLevel("mining", 1)`, `clearInventory()`, teleport near a tier 1 ore node, then `callTool("corealm_interact", { entityId, interaction: "mine" })`. `getState().activity.kind === "gathering"` within 200 ms and an `activity.started` event exists. |
| C2 | From C1, `setTimeScale(20)` and wait for 3 `item.received` events. `getState().skills.mining.xp === 30` exactly (3 yields x 10 XP), and inventory holds 3 `grithe_ore` in 3 separate slots (ore does not stack). |
| C3 | Continue until `resource.depleted` fires. `getState().world.nodes[id].state === "depleted"`, `remaining === 0`, `respawnAtMs` is set, and the yields taken are between 9 and 15. |
| C4 | `advanceGameTime(22)`. The node's state is `"available"` and `remaining` is between 9 and 15 again. |
| C5 | `giveItem` to fill 28 slots, then start gathering. `activity.stopped` fires with `reason: "inventory_full"` and an `inventory.full` event fires. `activity` is null. |
| C6 | With 20 ore held, walk to the Coldbrace bank and `callTool("corealm_bank", { op: "depositAll" })`. Inventory `freeSlots === 28`, `getState().bank.slots` contains one entry with `quantity: 20`. |
| C7 | `callTool("corealm_bank", { op: "withdraw", itemId: "grithe_ore", quantity: 5 })` from 15 m away returns `error.code === "OUT_OF_RANGE"` and the bank is unchanged. |
| C8 | Mining 1 to 10 by gathering alone, with `setTimeScale(50)`, completes and produces exactly one `level.gained` event per level from 2 through 10, in order. Final `getState().skills.mining.xp >= 1725`. |

### 8.4 Production, equipment, economy

| # | Check |
| --- | --- |
| D1 | `loadScenario("tier1_ready")`, walk to the Coldbrace furnace, `corealm_produce({ recipeId: "smelt_grithe_bar", quantity: 5 })`. Five `production.completed` events fire. Smithing XP increases by exactly 40 (5 x 8). |
| D2 | At the anvil, produce `grithe_sword`. Smithing XP increases by exactly 35, and a `grithe_sword` appears in inventory. |
| D3 | `corealm_equip({ op: "equip", itemId: "grithe_sword" })`. `getState().equipment.mainHand.itemId === "grithe_sword"`, `equipment.totals.power === 6`, and `player.maxHealth` matches the section 2.3 formula. |
| D4 | Attempt to equip a Kaldite sword at Melee 1. Error is `REQUIREMENTS_NOT_MET` and the message names the skill and level. Equipment is unchanged. |
| D5 | At the range with raw fish and Cooking 1, produce 10 cooked fish. Burnt count is between 2 and 7 (the 0.45 burn chance at the requirement level), and `burnt: true` events carry 0 XP. |
| D6 | `setSkillLevel("cooking", 16)` and repeat D5. Burnt count is 0. |
| D7 | Sell 10 Grithe ore at the general shop. Currency increases by exactly 70 (10 x 7), inventory loses exactly 10 ore. |
| D8 | Buy with insufficient marks. Error is `NOT_ENOUGH_CURRENCY`, currency and inventory unchanged. |
| D9 | With the starter Basic Wooden Wand, cast Voltrend once and observe Air Essence fall from 50 to 49. Craft and equip an Air Wand, observe its charge fall from 1000 to 999, then spend exactly 100 Air Essence at an Essence Altar to refill it; a full weapon refuses recharge without consuming Essence. |

### 8.5 Combat, health, death

| # | Check |
| --- | --- |
| E1 | `loadScenario("tier1_ready")`, `setSeed(99)`, attack a Rill Skitterling. `combat.started` fires, `getState().combat.targetId` is set, and the enemy's health drops on the next combat tick. |
| E2 | With `setPaused(true)` then `step(2400)` repeated, damage values are identical across two runs at the same seed. |
| E3 | Kill the Skitterling. `combat.ended` fires with `outcome: "killed"`, Melee XP increases by exactly `4 * damageDealt + 12`, and a loot pile entity exists at the corpse position. |
| E4 | `corealm_interact` with `loot` on the pile transfers marks and items into inventory, and the pile entity disappears. |
| E5 | Magic parity: equip a Water Staff, then `corealm_attack({ entityId: cairnwight, spellId: "rimewash" })`. Magic XP increases by `4 * damage + 22` per cast and the Water Staff loses exactly one charge at launch. |
| E6 | `setHealth(6)` while in combat. `health.low` fires exactly once. Eating a cooked fish raises health by exactly `healAmount(tier)` and blocks attacks for 1800 ms. |
| E7 | `setHealth(0)`. `player.died` fires. `getState().world.recoveryCache` is non-null with every pre-death inventory item, `getState().inventory` is empty, `getState().equipment` is unchanged, and skill XP is unchanged. Player position equals the Coldbrace respawn point and health equals `maxHealth`. |
| E8 | Walk to the cache and loot it. Every item returns and the cache becomes null. |
| E9 | `advanceGameTime(901)` on a live cache. The cache becomes null and the items are gone. |
| E10 | `loadScenario("boss_ready")`, fight Ordrun. At health fraction 0.55, `getState().world.enemies.ordrun.bossPhase` changes from 1 to 2. A telegraph overlay exists for 1600 ms before the slam, and standing in it costs exactly 22 health. |

### 8.6 Quests, dialogue, agility, farming, persistence, agent

| # | Check |
| --- | --- |
| F1 | `corealm_interact` with `talk` on the Coldbrace smith. `dialogue.opened` fires, `getState().dialogue` is non-null with at least 2 options. |
| F2 | `corealm_dialogue({ op: "choose", optionId })` accepting Cold Iron sets `getState().quests.cold_iron.status === "active"` and fires `quest.updated`. |
| F3 | Completing every stage of Cold Iron moves `status` to `"complete"`, adds the exact reward XP per skill, the exact item stacks, and the exact mark amount from the quest definition. |
| F4 | Selecting a disabled dialogue option returns `INVALID_ARGUMENT` and does not change `getState().dialogue.nodeId`. |
| F5 | `setSkillLevel("agility", 10)`, traverse Sunder Ledge. Agility XP increases by exactly 63, and the player's post-traversal position is within 1 m of the obstacle's `exitPosition`. `getNavPath` from the bank via the shortcut is under 60 m against 185 m to 200 m without it. |
| F6 | `setSkillLevel("agility", 10)` and fail-force by seed: on failure, health drops by 2 to 6, Agility XP is unchanged, and the player is at `failPoint`. |
| F7 | Rake, plant Bittergrain, `advanceGameTime(240)`, harvest. Yield is 3 to 6, Farming XP is `2 + 3 + yield * 10`, and the plot returns to `"empty"`. |
| F8 | Plant a crop, `saveNow()`, `page.reload()`, wait for `ready()`. The plot's `stageStartedAtMs` and `cropId` survive, and growth continued across the reload. |
| F9 | Full persistence: after a session that levels 4 skills, banks 30 items, completes 2 quests, and discovers 2 regions, `page.reload()` reproduces `skills`, `bank`, `quests`, `discovery`, `equipment`, and `currency` exactly. |
| F10 | `getSaveBlob()` parses as JSON under 100 KB. `reset()` then `loadSaveBlob(blob)` restores an identical `getState()` apart from `meta.lastSavedAtMs`. |
| F11 | Parity: `callTool("corealm_interact", { entityId: ore, interaction: "mine" })` and a real mouse click on the same node produce the same `activity.started` event payload and the same `ActivityState` shape. |
| F12 | Information parity: `corealm_inspect` on an entity the player has never seen returns `NOT_FOUND`. After the player walks within 40 m with line of sight, `entity.discovered` fires and `corealm_inspect` succeeds. |
| F13 | `corealm_search_docs({ query: "kaldite" })` returns hits covering the ore, the bar, and at least one recipe, and returns nothing from an unstarted quest's hidden stages. |
| F14 | `corealm_events` with `timeoutMs: 5000` while idle returns `{ events: [], nextSeq }` after roughly 5 s without throwing. The same call while gathering returns within one gather tick. |
| F15 | Event-efficiency budget: a scripted agent that mines 1 to 10 using `interact` plus `corealm_events` makes fewer than 60 tool calls total, counted by a `callTool` wrapper. |
| F16 | Overlays: `corealm_overlay({ op: "set", overlays: [{ id: "x", kind: "highlight", entityId }] })` returns `activeCount: 1`, the screenshot shows the outline, and `getState()` is unchanged apart from nothing (overlays live outside canonical state). |
| F17 | Agent gate proof: a scripted agent using only WebMCP tools raises Mining from 1 to 10 and ends with at least 40 ore in the bank, with no `__gameDebug` call other than `setTimeScale`. |
| F18 | Agent quest proof: a scripted agent using only WebMCP tools takes The Long Cairn from unstarted to `"complete"` across all 7 stages. |

### 8.7 Screenshot set, 18 repeatable shots

Every id is a `focusCamera` pose in `debug/shots.ts`, captured after `waitForIdle()` at a fixed seed, so two runs produce comparable images.

`spawn`, `town_entrance`, `town_center`, `bank_interior`, `palewood_copse`, `bracken_pit`, `marchfield_farm`, `redsill_shallows`, `vellenwood_canopy`, `rootfall_hamlet`, `karrowmoor_terraces`, `highcairn_outpost`, `gravelmaw_entrance`, `gravelmaw_chamber2`, `combat_normal`, `boss_ordrun_phase2`, `ui_inventory_skills`, `overlay_showcase`.

Each shot must show: correct tier materials, readable silhouettes at the default camera pitch, no z-fighting, no floating props, no navmesh gaps under the player.

---

## 9. Parallel build rounds with disjoint file ownership

> Lab-first amendment: for all new work, [the realtime feature-lab gate](../../docs/feature-lab.md) supersedes any direct-to-final-world ordering below. Each isolatable feature gets a lab fixture and root lab acceptance before a later final-world integration step. Only authored full-world behavior may use a recorded exception, and reusable local pieces still use the lab.

Round 0 is root-only, per AGENTS.md rules 3 and 4. Rounds 1 through 7 map to the seven vertical proofs in the brief. Each round ends with the root running the whole-game checks. Nobody proceeds on a failed round.

**Round 0, root only, no parallel work.**
Owns: `main.ts`, `contracts.ts`, `app/*`, `core/*`, `state/*`, `content/index.ts`, `content/validate.ts`, `content/xp.ts`, `content/skills.ts`, `render/renderer.ts`, `render/assets.ts`, `api/gameApi.ts`, `persistence/*`, `debug/gameDebug.ts`.
Deliverable: the game boots in Chromium, renders an empty scene with a controllable camera, Rapier and recast are initialised, the store exists, `__gameDebug.ready()` returns true, and `contracts.ts` is frozen.
Exit: A1 passes.

**Round 1, proof 1: world, movement, navigation.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| A1 | `content/regions.ts`, `world/entities.ts`, `world/spatial.ts`, `world/regionBuilder.ts`, `world/interactions.ts` | Three regions built from data, semantic entities constructed, spatial queries |
| A2 | `systems/movement.ts`, `systems/navigation.ts`, `systems/physics.ts`, `render/scene.ts`, `render/camera.ts`, `render/materials.ts`, `render/entityViews.ts`, `world/scatter.ts` | Navmesh pathing, character controller, camera, tier materials, instanced scatter |
| A4 | `input/mouse.ts`, `input/keyboard.ts`, `input/picking.ts`, `ui/contextMenu.ts`, `ui/styles.css` | Click-to-move, WASD, hover and selection, context menu |

Exit: A2 to A5, B1 to B6. Screenshots `spawn`, `town_entrance`, `town_center`.

**Round 2, proof 2: gathering loop.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| B1 | `content/resources.ts`, `systems/gathering.ts` | Node definitions for tiers 1, 5, 10, the gather tick, depletion, respawn |
| B2 | `systems/inventory.ts`, `systems/bank.ts` | 28 slots, stacking rules, 400-slot bank |
| B4 | `ui/hud.ts`, `ui/inventoryPanel.ts`, `ui/skillsPanel.ts`, `ui/bankPanel.ts` | HUD, inventory, skills, bank panels |

Exit: C1 to C8. Screenshots `bracken_pit`, `palewood_copse`, `redsill_shallows`, `bank_interior`.

**Round 3, proof 3: production loop.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| C1 | `content/items.ts`, `content/equipment.ts`, `content/recipes.ts`, `content/shops.ts` | The full tier 1/5/10 item, gear, recipe, and shop tables |
| C2 | `systems/production.ts`, `systems/equipment.ts`, `systems/economy.ts` | Batch production, burn chance, equip rules, buy and sell |
| C3 | `ui/equipmentPanel.ts`, `ui/shopPanel.ts`, `ui/tooltips.ts` | Equipment panel with stat deltas, shop, item tooltips |

Exit: D1 to D9.

**Round 4, proof 4: combat loop.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| D1 | `content/enemies.ts`, `content/spells.ts` | 21 enemy rows including three region bosses, plus the 16-spell elemental ladder |
| D2 | `systems/combat.ts`, `systems/enemyAI.ts`, `systems/health.ts`, `systems/death.ts` | Accuracy and damage rolls, aggro and leash, regen, death and recovery cache |
| D3 | `render/characterRig.ts`, `render/vfx.ts` | Animation blending, damage numbers, XP drops, spell effects, boss telegraph decal |

Exit: E1 to E10. Screenshots `combat_normal`, `boss_ordrun_phase2`.

**Round 5, proof 5: quests, dialogue, farming, agility.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| E1 | `content/npcs.ts`, `content/quests.ts`, `content/dialogue.ts` | 12 NPCs, 10 quests including the 7-stage Long Cairn, all dialogue trees |
| E2 | `systems/quests.ts`, `systems/dialogue.ts` | Stage predicates, reward application, dialogue traversal |
| E3 | `ui/dialoguePanel.ts`, `ui/questPanel.ts` | Dialogue and quest UI |
| A3 | `systems/agility.ts` | 9 obstacles, success roll, fail damage, traversal |
| B3 | `systems/farming.ts` | Plot lifecycle, wall-clock growth, harvest yields |

Exit: F1 to F9. Screenshots `marchfield_farm`, `rootfall_hamlet`, `karrowmoor_terraces`, `highcairn_outpost`, `gravelmaw_entrance`, `gravelmaw_chamber2`.

**Round 6, proof 6: agent interface.**

| Worker | Files | Deliverable |
| --- | --- | --- |
| F1 | `api/observation.ts`, `agent/webmcp.ts`, `agent/tools.ts`, `agent/events.ts` | Discovery gating, the 16 tools, the ring buffer, long-poll waiters |
| F2 | `render/overlays.ts` | Highlight, path, marker, label |
| F3 | `api/docs.ts`, `ui/journalPanel.ts` | Generated docs plus the search index, Locations panel |

Exit: F11 to F16. Screenshot `overlay_showcase`.

**Round 7, integration, root-led with two workers.**
Everything wired together, content balance passes against the section 2 tables, the dungeon and boss integrated with The Long Cairn, and the two gate proofs run end to end.
Exit: F10, F17, F18, the full screenshot set, and the whole acceptance suite green.

**Ownership rules for every round.**
No two workers in the same round touch the same file. A worker who needs a `contracts.ts` change stops and reports rather than editing it. Content files are owned by exactly one worker per round, so `content/items.ts` belongs to C1 in round 3 and is read-only for everyone else afterwards. Only the root runs whole-game checks while a round is active.

---

## 10. Contradictions in the brief and risky assumptions

### Contradictions

**C1. Every Phase 1 system versus a Phase 1 that is meant to be a proof.**
The brief calls Phase 1 "prove Corealm" and then lists 30+ systems as required, including quests, a dungeon, a boss, documentation, WebMCP, agent events, and overlays. Building all of that at content depth for three regions is not a proof, it is most of the game. My reading: Phase 1 builds every system's *architecture* at tier 1/5/10 content depth, and content breadth is what Phases 2 and 3 add. Section 0 cuts what does not test that. The root should confirm this reading before round 1, because if Phase 1 is meant to be broader, the round plan needs a fourth and fifth worker per round.

**C2. "Melee (physical accuracy, damage, defense)" versus a separate defence stat.**
The brief gives Melee three jobs and lists exactly 11 skills. Any implementation with a separate Defence skill breaks the count. I resolved this by making physical defence level equal Melee level and magical defence level equal Magic level. Consequence worth flagging: a pure-Magic character has low physical defence, which makes them fragile against melee enemies. That is a real balance property, not an accident, and Ordrun's magicArmour of only 18 exists so a magic build has a viable route through the boss.

**C3. Health is derived, but the brief also wants food and death to matter.**
Derived health from `(melee + magic) / 2` means a level 1 magic-only character has 23 HP and dies to almost anything. That is fine and classic, but it means the tier 1 enemies must be genuinely weak. Rill Skitterling at 6 HP with maxHit 2 is calibrated for exactly that.

**C4. "Nodes create circuits where early nodes respawn as later ones deplete" versus tier 10 respawn timers.**
At tier 10 (43 s respawn, 8 to 14 yields, 6.0 s per yield at the requirement level) a 5-node cluster always holds, so the circuit never actually creates tension. I made this deliberate rather than accidental: the 3-node Upper Karrow seam genuinely runs dry above Mining 20, which is what makes the two-seam choice in section 2.8 real. If the root wants circuit pressure at every tier, respawn timers need to roughly double and the section 2.8 numbers change.

**C5. Resource yield bands.**
The brief says roughly 8 to 15 low tier, 6 to 12 mid, 4 to 10 high. My formula gives 9 to 15 at tier 1, 6 to 12 at tier 50, and 4 to 10 at tier 99, which fits the mid and high bands exactly and is one off at the bottom of the low band. If the root wants exactly 8 to 15, change the min constant from 9 to 8.

### Risky assumptions

**A1. The 9 harness-required `__gameDebug` methods.**
I was instructed not to read `tools/`, so I proposed the nine methods in section 7.6 from what a Playwright harness structurally needs: `ready`, `getState`, `getVersion`, `setPaused`, `step`, `getMetrics`, `getErrors`, `waitForIdle`, `reset`. If `tools/` already expects different names or signatures, the root must reconcile before round 0 freezes. This is the single highest-risk item in the document, because every acceptance criterion in section 8 calls these names.

**A2. WebMCP specification stability.**
The brief says to research the current official WebMCP spec before building the adapter. I could not browse, so `agent/webmcp.ts` is specified as a thin adapter over a stable internal tool table, with three properties that survive any spec change: the tool table itself has no WebMCP types in it, `__gameDebug.callTool` invokes the same table without WebMCP, and event delivery is cursor plus long-poll rather than push. If the shipping spec supports notifications, push is added on top. If registration turns out to look nothing like what round 6 assumes, only `agent/webmcp.ts` changes. The root should still do the spec research before round 6 starts.

**A3. recast-navigation across three regions with 62 m of verticality.**
Karrowmoor's terraces and the Gravelmaw interior are the hardest navmesh case in Phase 1. I assumed baked `.bin` navmeshes shipped in `game/public/nav/` with runtime bake as a fallback, and off-mesh links for every agility obstacle. If off-mesh links do not behave, agility shortcuts stop being real routes and section 2.8's flip disappears, which removes a pillar. Round 1 should prove B3 (a single navmesh path from Coldbrace bank to the Upper Karrow seam) before anyone builds content on top of it.

**A4. Quaternius asset coverage for tier 10 and the dungeon.**
Medieval Village and Stylized Nature cover Fallowmarch and Vellenwood comfortably. Karrowmoor's terraces, the Gravelmaw interior, and Ordrun himself are the coverage risk. If no free pack has a suitable stone construct, the fallback is a Universal Base Character with a stone material treatment and a scale of 1.8, which reads acceptably at boss distance. This should be checked during round 0 asset manifest work, not discovered in round 4.

**A5. XP curve pacing against the agent proof.**
Mining 1 to 10 takes about 13 minutes of real time. That is deliberate and correct for the game, but it makes the F17 agent proof a 13-minute test. The proof allows `setTimeScale` and nothing else. If the root wants the proof to run at real speed, budget 15 minutes of CI time for it.

**A6. 60 FPS in Vellenwood.**
Dense canopy at 1 prop per 8 m² is the worst case in Phase 1. The 400-draw-call budget assumes aggressive instancing per (asset, material variant) pair. If tier materials fragment the instancing (three tiers x four families x three regions is 36 material variants), draw calls climb fast. Round 1 must measure A5 with real canopy density before round 5 adds quest props on top.

**A7. localStorage size.**
A fully progressed Phase 1 save is roughly 40 KB, well under the 5 MB quota. The risk is `world.nodes` and `discovery.entities` growing to one entry per entity across three regions, which is a few thousand keys. I assumed that stays under 100 KB. If it does not, node state compresses to a delta against content defaults.

---

## Root-review checklist

### Scope to cut

Confirm or reverse each of these before freezing contracts. Every one of them is a real reduction in Phase 1 work.

1. **Internal AI (Assist / Copilot / Autonomous).** Not gate-checked. Roughly one full worker-round of savings. Cut unless the root reads the gate differently.
2. **Minimap.** Replaced by the compass strip plus the Journal panel. Saves a render pass and a whole art task.
3. **Boss complexity beyond two phases and one telegraph.** Ordrun proves the telegraph system. More phases are Phase 2 content.
4. **Shop restocking, price drift, bank tabs, fuzzy search.** Fixed prices and a substring filter cover every test in section 8.
5. **Overlay kinds beyond four.** Highlight, path, marker, and label are enough for `overlay_showcase` and for an agent to build an assistant experience.
6. **Content tiers 20 to 99.** Schemas carry `tier: number` and nothing else changes. Zero cost to defer.

If any of these come back in, the round plan in section 9 needs a rebalance, not just an extra task.

### Contracts to verify before freezing `contracts.ts`

1. **`__gameDebug` names against `tools/`.** Assumption A1. Highest risk in the document. Reconcile the nine harness methods before round 0 ends, because all 40+ acceptance criteria call them by name.
2. **`GameApi` is genuinely the only write path.** Confirm that `ui/*`, `agent/tools.ts`, and `debug/gameDebug.ts` all route through it. If any UI panel writes the store directly, agent parity is dead and section 8's F11 becomes untestable.
3. **`SemanticEntity` covers all 16 archetypes** without an escape hatch beyond `meta`. If a worker needs a new top-level field, that is a root change under AGENTS.md rule 5.
4. **`ActivityState` really is one-at-a-time,** and combat sits outside it. The player must be able to eat while auto-attacking, or Ordrun is unwinnable.
5. **Event `data` shapes are exact.** Section 7.5 gives the field list per type. Agents will depend on these, and a loose `Record<string, unknown>` in practice becomes an undocumented API.
6. **`Result<T>` everywhere, no thrown errors across the API boundary.** WebMCP tools must return errors as values.
7. **The XP table is computed once and frozen.** Verify `totalXpAt(99) === 9999879` in a unit test so a refactor cannot silently change the curve.
8. **Update order in section 3.** Events flush at step 14, after quests at step 12, so a `level.gained` and the `quest.updated` it triggers land in the same tick and in that order.

### First playable proof

The single thing to build before anything else, and the thing that decides whether the rest of the plan holds:

**Stand in Coldbrace. Right-click a Grithe ore node in the Bracken Pit 160 m away. Watch the player path there over a real navmesh. Watch four ore appear one at a time, one every six seconds. Watch Mining hit level 2 at 99 XP. Watch the node go grey and empty. Walk back to the bank and deposit.**

That single run exercises: content loading and validation, the semantic entity layer, navmesh pathing, the character controller, the activity system, the gather tick, the seeded RNG, the XP curve, level-up, the depletion and respawn timer, inventory slots, the bank, the event queue, and `__gameDebug` state comparison. If it works through a mouse click and produces an identical result through `callTool("corealm_interact", ...)`, the architecture is proven and rounds 3 through 7 are content and systems on top of a known-good base.

If it does not work, nothing after it matters.


## Browser evidence

- test-results/gate-check.json
- test-results/smoke.json

## Screenshots

- screenshots/MON-bracken-fenmites.png
- screenshots/MON-canopy-hollows.png
- screenshots/MON-gorge-reavers.png
- screenshots/MON-gravelmaw-ch1-reavers.png
- screenshots/MON-gravelmaw-ch2-mudbacks.png
- screenshots/MON-karrow-reavers.png
- screenshots/MON-march-road-reavers.png
- screenshots/MON-mire-fenmites.png
- screenshots/MON-palewood-hollows.png
- screenshots/MON-preset-bracken-pit.png
- screenshots/MON-preset-hollowcut-seam.png
- screenshots/MON-preset-march-road.png
- screenshots/MON-preset-upper-karrow-seam.png
- screenshots/MON-preset-vellenwood-canopy.png
- screenshots/MON-redsill-mudbacks.png
- screenshots/MON-tarn-marchwolves.png
- screenshots/MON-terrace-mudbacks.png
- screenshots/MON2-karrow-reavers.png
- screenshots/MON2-mire-fenmites.png
- screenshots/MOTION-canopy-cam.png
- screenshots/MOTION-cast-0-crop.png
- screenshots/MOTION-cast-0.png
- screenshots/MOTION-cast-1.png
- screenshots/MOTION-cast-10.png
- screenshots/MOTION-cast-11.png
- screenshots/MOTION-cast-12-crop.png
- screenshots/MOTION-cast-12.png
- screenshots/MOTION-cast-13.png
- screenshots/MOTION-cast-2.png
- screenshots/MOTION-cast-3-crop.png
- screenshots/MOTION-cast-3.png
- screenshots/MOTION-cast-4.png
- screenshots/MOTION-cast-5.png
- screenshots/MOTION-cast-6-crop.png
- screenshots/MOTION-cast-6.png
- screenshots/MOTION-cast-7.png
- screenshots/MOTION-cast-8.png
- screenshots/MOTION-cast-9-crop.png
- screenshots/MOTION-cast-9.png
- screenshots/MOTION-dungeon-cam.png
- screenshots/MOTION-enemy-chase.png
- screenshots/MOTION-enemy-fight.png
- screenshots/MOTION-gate-blocked.png
- screenshots/MOTION-karrow-lowpitch-a.png
- screenshots/MOTION-karrow-lowpitch-d.png
- screenshots/MOTION-karrow-lowpitch-s.png
- screenshots/MOTION-karrow-lowpitch-w.png
- screenshots/MOTION-karrow-path.png
- screenshots/MOTION-karrow-walk.png
- screenshots/MOTION-probe1-end.png
- screenshots/MOTION-run-f0-crop.png
- screenshots/MOTION-run-f0.png
- screenshots/MOTION-run-f1-crop.png
- screenshots/MOTION-run-f1.png
- screenshots/MOTION-run-f2-crop.png
- screenshots/MOTION-run-f2.png
- screenshots/MOTION-run-f3.png
- screenshots/MOTION-run-f4-crop.png
- screenshots/MOTION-run-f4.png
- screenshots/MOTION-run-f5.png
- screenshots/MOTION-run-idle-after-crop.png
- screenshots/MOTION-run-idle-after.png
- screenshots/MOTION-terrace-climb.png
- screenshots/MOTION-town-npcs.png
- screenshots/MOTION-town-occlusion.png
- screenshots/MOTION-walk-f0-crop.png
- screenshots/MOTION-walk-f0.png
- screenshots/MOTION-walk-f1-crop.png
- screenshots/MOTION-walk-f1.png
- screenshots/MOTION-walk-f2-crop.png
- screenshots/MOTION-walk-f2.png
- screenshots/MOTION-walk-f3-crop.png
- screenshots/MOTION-walk-f3.png
- screenshots/RIG-harrow.png
- screenshots/RIG-npc-crop.png
- screenshots/RIG-player-crop.png
- screenshots/RIG-ranger-npc.png
- screenshots/RIG-spawn-player.png
- screenshots/RIG-town-center.png
- screenshots/RIG-town-player.png
- screenshots/SET-bank.png
- screenshots/SET-highcairn.png
- screenshots/SET-rootfall.png
- screenshots/SET-town_center.png
- screenshots/SET-town_entrance.png
- screenshots/banner-perpendicular-coldbrace.png
- screenshots/banner-rhythm-coldbrace.png
- screenshots/banner-rhythm-final.png
- screenshots/baseline-bank.png
- screenshots/baseline-spawn.png
- screenshots/baseline-town_center.png
- screenshots/baseline-town_entrance.png
- screenshots/before-bank.png
- screenshots/before-spawn.png
- screenshots/before-town_entrance.png
- screenshots/bld-highcairn.png
- screenshots/bld-hollowcut_seam.png
- screenshots/bld-rootfall.png
- screenshots/bld-spawn.png
- screenshots/bld-town_center.png
- screenshots/bld-town_entrance.png
- screenshots/buildings-highcairn.png
- screenshots/buildings-polish-coldbrace.png
- screenshots/buildings-polish-highcairn.png
- screenshots/buildings-polish-marchfield.png
- screenshots/buildings-polish-rootfall.png
- screenshots/buildings-town_entrance.png
- screenshots/cam-bank.png
- screenshots/cam-gravelmaw_entrance.png
- screenshots/cam-highcairn.png
- screenshots/cam-karrowmoor_terraces.png
- screenshots/cam-rootfall.png
- screenshots/cam-town_center.png
- screenshots/camA-bank.png
- screenshots/camA-gravelmaw_entrance.png
- screenshots/camA-highcairn.png
- screenshots/camA-karrowmoor_terraces.png
- screenshots/camA-rootfall.png
- screenshots/camA-town_center.png
- screenshots/camB-bank.png
- screenshots/camC-bank.png
- screenshots/camC-gravelmaw_entrance.png
- screenshots/camC-highcairn.png
- screenshots/camC-karrowmoor_terraces.png
- screenshots/camC-rootfall.png
- screenshots/camC-town_center.png
- screenshots/cambefore-bank.png
- screenshots/cambefore-gravelmaw_entrance.png
- screenshots/cambefore-highcairn.png
- screenshots/cambefore-karrowmoor_terraces.png
- screenshots/cambefore-rootfall.png
- screenshots/cambefore-town_center.png
- screenshots/camwalk-arcade.png
- screenshots/camwalk-dungeon1.png
- screenshots/camwalk-dungeon2.png
- screenshots/camwalk-forge.png
- screenshots/camwalk-hc_porch.png
- screenshots/camwalk-porch.png
- screenshots/camwalk-rf_counter.png
- screenshots/camwalk-well.png
- screenshots/cohesion-canopy-walk.png
- screenshots/cohesion-gravelmaw-crop.png
- screenshots/cohesion-gravelmaw.png
- screenshots/cohesion-highcairn.png
- screenshots/cohesion-lower-quarry.png
- screenshots/cohesion-mire-skirt.png
- screenshots/cohesion-region-gate.png
- screenshots/cohesion-root-tunnel.png
- screenshots/cohesion-rootfall.png
- screenshots/cohesion-town-gate.png
- screenshots/cohesion-west-track.png
- screenshots/collision-anvil.png
- screenshots/collision-bankchest.png
- screenshots/collision-diagonal-hall.png
- screenshots/collision-final.png
- screenshots/collision-gate-gap.png
- screenshots/collision-in-tree.png
- screenshots/collision-in-water-2.png
- screenshots/collision-in-water.png
- screenshots/collision-inside-cottage.png
- screenshots/collision-npc.png
- screenshots/collision-on-hall-roof.png
- screenshots/collision-pathed-into-cottage.png
- screenshots/collision-pathed-out-of-cottage.png
- screenshots/collision-spawn-to-bank.png
- screenshots/collision-stall.png
- screenshots/collision-wall-s.png
- screenshots/cov-bank.png
- screenshots/cov-bracken_pit.png
- screenshots/cov-gravelmaw_entrance.png
- screenshots/cov-great_cairn.png
- screenshots/cov-highcairn.png
- screenshots/cov-hollowcut_seam.png
- screenshots/cov-karrowmoor_terraces.png
- screenshots/cov-march_road.png
- screenshots/cov-marchfield_farm.png
- screenshots/cov-palewood_copse.png
- screenshots/cov-redsill_shallows.png
- screenshots/cov-rootfall.png
- screenshots/cov-spawn.png
- screenshots/cov-sunder_ledge.png
- screenshots/cov-town_center.png
- screenshots/cov-town_entrance.png
- screenshots/cov-upper_karrow_seam.png
- screenshots/cov-vellenwood_canopy.png
- screenshots/dc-bank.png
- screenshots/dc-highcairn.png
- screenshots/dc-palewood_copse.png
- screenshots/dc-rootfall.png
- screenshots/dc-spawn.png
- screenshots/dc-town_center.png
- screenshots/dc-town_entrance.png
- screenshots/dcb0-hollowcut_seam.png
- screenshots/eq-01-naked-spawn-zoom.png
- screenshots/eq-01-naked-spawn.png
- screenshots/eq-02-full-kaldite-kit-spawn-zoom.png
- screenshots/eq-02-full-kaldite-kit-spawn.png
- screenshots/eq-03-full-wightshroud-staff-spawn-zoom.png
- screenshots/eq-03-full-wightshroud-staff-spawn.png
- screenshots/eq-04-panels-worn-corven-sword.png
- screenshots/eq-05-worn-panel-magic-kit.png
- screenshots/eq-05-worn-panel-zoom.png
- screenshots/eq-06-worn-tooltip-cairnpine-staff.png
- screenshots/eq-07-inventory-tooltip-unmet-kaldite-sword.png
- screenshots/eq-07-two-swords-zoom.png
- screenshots/eq-icons-sheet.png
- screenshots/ev-bank.png
- screenshots/ev-before-bank.png
- screenshots/ev-before-highcairn.png
- screenshots/ev-before-rootfall.png
- screenshots/ev-before-town_center.png
- screenshots/ev-crop-npc_foreman_arden.png
- screenshots/ev-crop-npc_ranger_syb.png
- screenshots/ev-crop-npc_seamer_juno.png
- screenshots/ev-crop-npc_smith_harrow.png
- screenshots/ev-crop-npc_trapper_mott.png
- screenshots/ev-crop-npc_warden_ilse.png
- screenshots/ev-enemy-alive.png
- screenshots/ev-enemy-dead.png
- screenshots/ev-highcairn.png
- screenshots/ev-rootfall.png
- screenshots/ev-town_center.png
- screenshots/ev2-bank.png
- screenshots/ev2-before-bank.png
- screenshots/ev2-before-bracken_pit.png
- screenshots/ev2-before-enemy-attack.png
- screenshots/ev2-before-enemy-death.png
- screenshots/ev2-before-highcairn.png
- screenshots/ev2-before-rootfall.png
- screenshots/ev2-before-town_center.png
- screenshots/ev2-bracken_pit.png
- screenshots/ev2-enemy-attack-crop.png
- screenshots/ev2-enemy-attack.png
- screenshots/ev2-enemy-dead-crop.png
- screenshots/ev2-enemy-death-crop.png
- screenshots/ev2-enemy-death.png
- screenshots/ev2-enemy-hit-crop.png
- screenshots/ev2-gravelmaw_entrance.png
- screenshots/ev2-highcairn.png
- screenshots/ev2-karrowmoor_terraces.png
- screenshots/ev2-npc-crop.png
- screenshots/ev2-npc-vs-enemy-attack.png
- screenshots/ev2-npc-vs-enemy-death.png
- screenshots/ev2-rootfall.png
- screenshots/ev2-town_center.png
- screenshots/ev2-vellenwood_canopy.png
- screenshots/ev3-after-foe-bracken_fenmites.png
- screenshots/ev3-after-foe-march_road_reavers.png
- screenshots/ev3-after-foe-marchwolf_pups.png
- screenshots/ev3-after-foe-palewood_hollows.png
- screenshots/ev3-after-foe-redsill_mudbacks.png
- screenshots/ev3-after-foe-rill_skitterlings.png
- screenshots/ev3-after-npc-carter_bel.png
- screenshots/ev3-after-npc-pitmaster_dorn.png
- screenshots/ev3-after-npc-ranger_syb.png
- screenshots/ev3-after-npc-smith_harrow.png
- screenshots/ev3-after-npc-warden_ilse.png
- screenshots/ev3-after-npc-woodward_ansel.png
- screenshots/ev3-before-foe-bracken_fenmites.png
- screenshots/ev3-before-foe-bramble_skitterlings.png
- screenshots/ev3-before-foe-cairnwights_fields.png
- screenshots/ev3-before-foe-canopy_hollows.png
- screenshots/ev3-before-foe-gorge_reavers.png
- screenshots/ev3-before-foe-gravelmaw_ch1_wights.png
- screenshots/ev3-before-foe-gravelmaw_ch2_skitterlings.png
- screenshots/ev3-before-foe-gravelmaw_ch3_elders.png
- screenshots/ev3-before-foe-march_road_reavers.png
- screenshots/ev3-before-foe-marchwolf_pups.png
- screenshots/ev3-before-foe-marchwolves_deepwood.png
- screenshots/ev3-before-foe-mire_fenmites.png
- screenshots/ev3-before-foe-palewood_hollows.png
- screenshots/ev3-before-foe-redsill_mudbacks.png
- screenshots/ev3-before-foe-rill_skitterlings.png
- screenshots/ev3-before-foe-scree_skitterlings.png
- screenshots/ev3-before-foe-thornbound_elders_ridge.png
- screenshots/ev3-before-foe-thornbound_husks.png
- screenshots/ev3-before-npc-cairnkeeper_ode.png
- screenshots/ev3-before-npc-carter_bel.png
- screenshots/ev3-before-npc-foreman_arden.png
- screenshots/ev3-before-npc-pitmaster_dorn.png
- screenshots/ev3-before-npc-quarrier_vess.png
- screenshots/ev3-before-npc-ranger_syb.png
- screenshots/ev3-before-npc-seamer_juno.png
- screenshots/ev3-before-npc-smith_harrow.png
- screenshots/ev3-before-npc-trapper_mott.png
- screenshots/ev3-before-npc-warden_ilse.png
- screenshots/ev3-before-npc-watcher_hale.png
- screenshots/ev3-before-npc-woodward_ansel.png
- screenshots/ev3-zoom-foe-bracken_fenmites.png
- screenshots/ev3-zoom-foe-march_road_reavers.png
- screenshots/ev3-zoom-foe-marchwolf_pups.png
- screenshots/ev3-zoom-foe-palewood_hollows.png
- screenshots/ev3-zoom-foe-redsill_mudbacks.png
- screenshots/ev3-zoom-foe-rill_skitterlings.png
- screenshots/ev3-zoom-foe-thornbound_husks.png
- screenshots/ev3-zoom-npc-carter_bel.png
- screenshots/ev3-zoom-npc-pitmaster_dorn.png
- screenshots/ev3-zoom-npc-ranger_syb.png
- screenshots/ev3-zoom-npc-seamer_juno.png
- screenshots/ev3-zoom-npc-smith_harrow.png
- screenshots/ev3-zoom-npc-warden_ilse.png
- screenshots/ev3-zoom-npc-woodward_ansel.png
- screenshots/ev3-zoom-pose-highcairn.png
- screenshots/ev3-zoom-pose-rootfall.png
- screenshots/ev3-zoom-pose-town_center.png
- screenshots/foundation-bank.png
- screenshots/foundation-spawn.png
- screenshots/foundation-town_center.png
- screenshots/gd-bank.png
- screenshots/gd-bracken_pit.png
- screenshots/gd-crop-ground.png
- screenshots/gd-gravelmaw_entrance.png
- screenshots/gd-great_cairn.png
- screenshots/gd-highcairn.png
- screenshots/gd-hollowcut_seam.png
- screenshots/gd-karrowmoor_terraces.png
- screenshots/gd-march_road.png
- screenshots/gd-marchfield_farm.png
- screenshots/gd-palewood_copse.png
- screenshots/gd-redsill_shallows.png
- screenshots/gd-rootfall.png
- screenshots/gd-spawn.png
- screenshots/gd-sunder_ledge.png
- screenshots/gd-town_center.png
- screenshots/gd-town_entrance.png
- screenshots/gd-upper_karrow_seam.png
- screenshots/gd-vellenwood_canopy.png
- screenshots/gnd-bank.png
- screenshots/gnd-bracken_pit.png
- screenshots/gnd-gravelmaw_entrance.png
- screenshots/gnd-great_cairn.png
- screenshots/gnd-highcairn.png
- screenshots/gnd-hollowcut_seam.png
- screenshots/gnd-karrowmoor_terraces.png
- screenshots/gnd-march_road.png
- screenshots/gnd-marchfield_farm.png
- screenshots/gnd-palewood_copse.png
- screenshots/gnd-redsill_shallows.png
- screenshots/gnd-rootfall.png
- screenshots/gnd-spawn.png
- screenshots/gnd-sunder_ledge.png
- screenshots/gnd-town_center.png
- screenshots/gnd-town_entrance.png
- screenshots/gnd-upper_karrow_seam.png
- screenshots/gnd-vellenwood_canopy.png
- screenshots/ground-coldbrace-fletching.png
- screenshots/ground-fallen-duskoak.png
- screenshots/ground-far-tarn.png
- screenshots/ground-preset-bracken_pit.png
- screenshots/ground-preset-great_cairn.png
- screenshots/ground-preset-highcairn.png
- screenshots/ground-preset-karrowmoor_terraces.png
- screenshots/ground-preset-marchfield_farm.png
- screenshots/ground-preset-palewood_copse.png
- screenshots/ground-preset-sunder_ledge.png
- screenshots/ground-preset-town_center.png
- screenshots/ground-ridge-pines-pillar.png
- screenshots/hc-highcairn.png
- screenshots/hc-hollowcut_seam.png
- screenshots/hc-karrowmoor_terraces.png
- screenshots/hc-sunder_ledge.png
- screenshots/head-gravelmaw_entrance.png
- screenshots/head-great_cairn.png
- screenshots/head-highcairn.png
- screenshots/head-karrowmoor_terraces.png
- screenshots/head-march_road.png
- screenshots/head-redsill_shallows.png
- screenshots/head-rootfall.png
- screenshots/head-sunder_ledge.png
- screenshots/lit-ab2-rootfall-group-overlays.png
- screenshots/lit-abl-rootfall-noamb.png
- screenshots/lit-abl-rootfall-with.png
- screenshots/lit-abl-rootfall-without.png
- screenshots/lit-abl-town_entrance-noamb.png
- screenshots/lit-bank.png
- screenshots/lit-bracken_pit.png
- screenshots/lit-crop-black.png
- screenshots/lit-crop-white.png
- screenshots/lit-gravelmaw_entrance.png
- screenshots/lit-great_cairn.png
- screenshots/lit-highcairn.png
- screenshots/lit-hollowcut_seam.png
- screenshots/lit-karrowmoor_terraces.png
- screenshots/lit-march_road.png
- screenshots/lit-marchfield_farm.png
- screenshots/lit-palewood_copse.png
- screenshots/lit-redsill_shallows.png
- screenshots/lit-rootfall.png
- screenshots/lit-spawn.png
- screenshots/lit-sunder_ledge.png
- screenshots/lit-town_center.png
- screenshots/lit-town_entrance.png
- screenshots/lit-upper_karrow_seam.png
- screenshots/lit-vellenwood_canopy.png
- screenshots/lita1-abl-rootfall-noamb.png
- screenshots/lita1-bank.png
- screenshots/lita1-bracken_pit.png
- screenshots/lita1-gravelmaw_entrance.png
- screenshots/lita1-great_cairn.png
- screenshots/lita1-highcairn.png
- screenshots/lita1-hollowcut_seam.png
- screenshots/lita1-karrowmoor_terraces.png
- screenshots/lita1-march_road.png
- screenshots/lita1-marchfield_farm.png
- screenshots/lita1-palewood_copse.png
- screenshots/lita1-redsill_shallows.png
- screenshots/lita1-rootfall.png
- screenshots/lita1-spawn.png
- screenshots/lita1-sunder_ledge.png
- screenshots/lita1-town_center.png
- screenshots/lita1-town_entrance.png
- screenshots/lita1-upper_karrow_seam.png
- screenshots/lita1-vellenwood_canopy.png
- screenshots/litb-spawn.png
- screenshots/litb4-bank.png
- screenshots/litb4-bracken_pit.png
- screenshots/litb4-gravelmaw_entrance.png
- screenshots/litb4-great_cairn.png
- screenshots/litb4-highcairn.png
- screenshots/litb4-hollowcut_seam.png
- screenshots/litb4-karrowmoor_terraces.png
- screenshots/litb4-march_road.png
- screenshots/litb4-marchfield_farm.png
- screenshots/litb4-palewood_copse.png
- screenshots/litb4-redsill_shallows.png
- screenshots/litb4-rootfall.png
- screenshots/litb4-spawn.png
- screenshots/litb4-sunder_ledge.png
- screenshots/litb4-town_center.png
- screenshots/litb4-town_entrance.png
- screenshots/litb4-upper_karrow_seam.png
- screenshots/litb4-vellenwood_canopy.png
- screenshots/look-atlas-detail-grass.png
- screenshots/look-atlas-detail-gravel.png
- screenshots/look-atlas-detail-rock.png
- screenshots/look-atlas-detail-soil.png
- screenshots/look-atlas-macro-grass.png
- screenshots/look-atlas-macro-gravel.png
- screenshots/look-atlas-macro-rock.png
- screenshots/look-atlas-macro-soil.png
- screenshots/look-glbtex-0.png
- screenshots/look1-bank.png
- screenshots/look1-spawn.png
- screenshots/look1-town_center.png
- screenshots/look1-town_entrance.png
- screenshots/look2-bank.png
- screenshots/look2-bracken_pit.png
- screenshots/look2-crop-anvil2.png
- screenshots/look2-crop-barrel.png
- screenshots/look2-crop-forge.png
- screenshots/look2-gravelmaw_entrance.png
- screenshots/look2-great_cairn.png
- screenshots/look2-highcairn.png
- screenshots/look2-hollowcut_seam.png
- screenshots/look2-karrowmoor_terraces.png
- screenshots/look2-march_road.png
- screenshots/look2-marchfield_farm.png
- screenshots/look2-palewood_copse.png
- screenshots/look2-prop-coldbrace_anvil.png
- screenshots/look2-prop-coldbrace_bank.png
- screenshots/look2-prop-coldbrace_furnace.png
- screenshots/look2-redsill_shallows.png
- screenshots/look2-rootfall.png
- screenshots/look2-spawn.png
- screenshots/look2-sunder_ledge.png
- screenshots/look2-town_center.png
- screenshots/look2-town_entrance.png
- screenshots/look2-upper_karrow_seam.png
- screenshots/look2-vellenwood_canopy.png
- screenshots/look3-crop-anvil.png
- screenshots/look3-prop-coldbrace_anvil.png
- screenshots/look3-prop-coldbrace_furnace.png
- screenshots/magic-01-starter-wand.png
- screenshots/magic-04-air-cache-five-nodes.png
- screenshots/magic-05-air-cache-glowing-veins.png
- screenshots/magic-06-air-cache-depleted.png
- screenshots/magic-08-air-orb-boss-drop.png
- screenshots/magic-cache-air-glow.png
- screenshots/magic-cache-earth-glow.png
- screenshots/magic-cache-water-glow.png
- screenshots/magic-cast-kilnsurge.png
- screenshots/magic-visual-basic-staff-unlit.png
- screenshots/magic-visual-basic-wand-unlit.png
- screenshots/magic-wood-cairnpine-staff-unlit.png
- screenshots/magic-wood-cairnpine-wand-unlit.png
- screenshots/magic-wood-duskoak-staff-unlit.png
- screenshots/magic-wood-duskoak-wand-unlit.png
- screenshots/magic-wood-palewood-staff-unlit.png
- screenshots/magic-wood-palewood-wand-unlit.png
- screenshots/message-log.png
- screenshots/r1-after-movement.png
- screenshots/r1-bank.png
- screenshots/r1-bracken-pit.png
- screenshots/r1-gravelmaw-entrance.png
- screenshots/r1-highcairn.png
- screenshots/r1-karrowmoor.png
- screenshots/r1-spawn.png
- screenshots/r1-town-center.png
- screenshots/r1-vellenwood.png
- screenshots/r2-bank.png
- screenshots/r2-bracken_pit.png
- screenshots/r2-gravelmaw_entrance.png
- screenshots/r2-great_cairn.png
- screenshots/r2-highcairn.png
- screenshots/r2-hollowcut_seam.png
- screenshots/r2-karrowmoor_terraces.png
- screenshots/r2-march_road.png
- screenshots/r2-marchfield_farm.png
- screenshots/r2-palewood_copse.png
- screenshots/r2-rootfall.png
- screenshots/r2-spawn.png
- screenshots/r2-sunder_ledge.png
- screenshots/r2-town_center.png
- screenshots/r2-town_entrance.png
- screenshots/r2-upper_karrow_seam.png
- screenshots/r2-vellenwood_canopy.png
- screenshots/r3-bank.png
- screenshots/r3-combat.png
- screenshots/r3-depleted.png
- screenshots/r3-fishing.png
- screenshots/r3-mining.png
- screenshots/r3-overlay.png
- screenshots/r3-player.png
- screenshots/r3-shop.png
- screenshots/r3-ui.png
- screenshots/r3-vertical-slice.png
- screenshots/r4-gravelmaw-inside.png
- screenshots/r4-gravelmaw-mouth.png
- screenshots/r4-great-cairn.png
- screenshots/r4-ordrun.png
- screenshots/r5-coldbrace.png
- screenshots/r5-highcairn.png
- screenshots/r5-icons.png
- screenshots/r5-node-spent.png
- screenshots/r5-panels.png
- screenshots/r5-rootfall.png
- screenshots/r5-tree-spent.png
- screenshots/r5-water.png
- screenshots/r6-combat.png
- screenshots/r6-controls.png
- screenshots/r6-death.png
- screenshots/r6-dialogue.png
- screenshots/r6-map.png
- screenshots/r6-title.png
- screenshots/ramp-great_cairn.png
- screenshots/ramp-highcairn.png
- screenshots/ramp-hollowcut_seam.png
- screenshots/ramp-karrowmoor_terraces.png
- screenshots/ramp-sunder_ledge.png
- screenshots/ramp-upper_karrow_seam.png
- screenshots/rb-bank.png
- screenshots/rb-highcairn.png
- screenshots/rb-marchfield_farm.png
- screenshots/rb-npc-crop.png
- screenshots/rb-spawn.png
- screenshots/rb-town_center.png
- screenshots/rf1-rootfall.png
- screenshots/rig-bank-zoom.png
- screenshots/rig-bank.png
- screenshots/rig-combat-zoom.png
- screenshots/rig-combat.png
- screenshots/rig-kitted-zoom.png
- screenshots/rig-kitted.png
- screenshots/rig-run-a-zoom.png
- screenshots/rig-run-a.png
- screenshots/rig-run-b-zoom.png
- screenshots/rig-run-b.png
- screenshots/rig-spawn-zoom.png
- screenshots/rig-spawn.png
- screenshots/rig-town-center-zoom.png
- screenshots/rig-town-peasant-zoom.png
- screenshots/rig-town-peasant.png
- screenshots/rig2-a1-bank-crop.png
- screenshots/rig2-a1-bank.png
- screenshots/rig2-before-bank-crop.png
- screenshots/rig2-before-bank.png
- screenshots/rig2-equip-grithe_dagger-crop.png
- screenshots/rig2-equip-grithe_dagger.png
- screenshots/rig2-equip-grithe_sword-crop.png
- screenshots/rig2-equip-grithe_sword.png
- screenshots/rig2-equip-kaldite_sword-crop.png
- screenshots/rig2-equip-kaldite_sword.png
- screenshots/rig2-equip-palewood_shield-crop.png
- screenshots/rig2-equip-palewood_shield.png
- screenshots/root-bank2.png
- screenshots/root-bank3.png
- screenshots/root-bankporch.png
- screenshots/root-forgeyard.png
- screenshots/round0-scatter.png
- screenshots/round0-spawn.png
- screenshots/scatter-bank.png
- screenshots/scatter-bracken_pit.png
- screenshots/scatter-fallow-open.png
- screenshots/scatter-gravelmaw_entrance.png
- screenshots/scatter-great_cairn.png
- screenshots/scatter-highcairn.png
- screenshots/scatter-hollowcut_seam.png
- screenshots/scatter-karrow-open.png
- screenshots/scatter-karrowmoor_terraces.png
- screenshots/scatter-march_road.png
- screenshots/scatter-marchfield_farm.png
- screenshots/scatter-palewood_copse.png
- screenshots/scatter-redsill_shallows.png
- screenshots/scatter-rootfall.png
- screenshots/scatter-seam-fallow-vellen.png
- screenshots/scatter-seam-vellen-karrow.png
- screenshots/scatter-spawn.png
- screenshots/scatter-sunder_ledge.png
- screenshots/scatter-town_center.png
- screenshots/scatter-town_entrance.png
- screenshots/scatter-upper_karrow_seam.png
- screenshots/scatter-vellen-open.png
- screenshots/scatter-vellenwood_canopy.png
- screenshots/sct-bank.png
- screenshots/sct-bracken_pit.png
- screenshots/sct-crop-bloom.png
- screenshots/sct-gravelmaw_entrance.png
- screenshots/sct-great_cairn.png
- screenshots/sct-highcairn.png
- screenshots/sct-hollowcut_seam.png
- screenshots/sct-karrowmoor_terraces.png
- screenshots/sct-leaves-atlas.png
- screenshots/sct-march_road.png
- screenshots/sct-marchfield_farm.png
- screenshots/sct-palewood_copse.png
- screenshots/sct-redsill_shallows.png
- screenshots/sct-rootfall.png
- screenshots/sct-spawn.png
- screenshots/sct-sunder_ledge.png
- screenshots/sct-town_center.png
- screenshots/sct-town_entrance.png
- screenshots/sct-upper_karrow_seam.png
- screenshots/sct-vellenwood_canopy.png
- screenshots/seeded-mage.png
- screenshots/shell-highcairn.png
- screenshots/shell-hollowcut_seam.png
- screenshots/shell-rootfall.png
- screenshots/shell-town_center.png
- screenshots/shell-town_entrance.png
- screenshots/sky-bank.png
- screenshots/sky-bracken_pit.png
- screenshots/sky-dungeon-chamber1-up.png
- screenshots/sky-dungeon-chamber1.png
- screenshots/sky-dungeon-chamber1b.png
- screenshots/sky-dungeon-chamber3-up.png
- screenshots/sky-dungeon-chamber3.png
- screenshots/sky-gravelmaw_entrance.png
- screenshots/sky-great_cairn.png
- screenshots/sky-highcairn.png
- screenshots/sky-hollowcut_seam.png
- screenshots/sky-karrowmoor_terraces.png
- screenshots/sky-march_road.png
- screenshots/sky-marchfield_farm.png
- screenshots/sky-palewood_copse.png
- screenshots/sky-probe-pitchup.png
- screenshots/sky-probe-yaw0.png
- screenshots/sky-probe-yaw180.png
- screenshots/sky-probe-yaw270.png
- screenshots/sky-probe-yaw90.png
- screenshots/sky-redsill_shallows.png
- screenshots/sky-rootfall.png
- screenshots/sky-spawn.png
- screenshots/sky-sunder_ledge.png
- screenshots/sky-town_center.png
- screenshots/sky-town_entrance.png
- screenshots/sky-upper_karrow_seam.png
- screenshots/sky-vellenwood_canopy.png
- screenshots/sky-walk-town.png
- screenshots/spellbook-icons.png
- screenshots/staff-in-hand.png
- screenshots/terrain-bank.png
- screenshots/terrain-bracken_pit.png
- screenshots/terrain-gravelmaw_entrance.png
- screenshots/terrain-great_cairn.png
- screenshots/terrain-highcairn.png
- screenshots/terrain-hollowcut_seam.png
- screenshots/terrain-karrowmoor_terraces.png
- screenshots/terrain-march_road.png
- screenshots/terrain-marchfield_farm.png
- screenshots/terrain-palewood_copse.png
- screenshots/terrain-redsill_shallows.png
- screenshots/terrain-rootfall.png
- screenshots/terrain-spawn.png
- screenshots/terrain-sunder_ledge.png
- screenshots/terrain-town_center.png
- screenshots/terrain-town_entrance.png
- screenshots/terrain-upper_karrow_seam.png
- screenshots/terrain-vellenwood_canopy.png
- screenshots/vfx-canopy-leaves-crop.png
- screenshots/vfx-canopy-leaves.png
- screenshots/vfx-contact-bracken.png
- screenshots/vfx-contact-hollowcut-OFF-crop.png
- screenshots/vfx-contact-hollowcut-OFF.png
- screenshots/vfx-contact-hollowcut-ON-crop.png
- screenshots/vfx-contact-hollowcut-ON.png
- screenshots/vfx-contact-hollowcut.png
- screenshots/vfx-contact-palewood-OFF.png
- screenshots/vfx-contact-palewood-ON.png
- screenshots/vfx-contact-palewood.png
- screenshots/vfx-damage-numbers-2-crop.png
- screenshots/vfx-damage-numbers-2.png
- screenshots/vfx-damage-numbers-3-crop.png
- screenshots/vfx-damage-numbers-3.png
- screenshots/vfx-damage-numbers-crop.png
- screenshots/vfx-damage-numbers.png
- screenshots/vfx-fishing-ripple.png
- screenshots/vfx-forge-furnace-crop.png
- screenshots/vfx-forge-sparks.png
- screenshots/vfx-highcairn-forge.png
- screenshots/vfx-overlay-conform.png
- screenshots/vfx-run-dust-2-crop.png
- screenshots/vfx-run-dust-2.png
- screenshots/vfx-run-dust-crop.png
- screenshots/vfx-run-dust.png
- screenshots/vfx-telegraph-a.png
- screenshots/vfx-telegraph-b.png
- screenshots/vfx-telegraph-c.png
- screenshots/vfx-telegraph-slope.png
- screenshots/vfx-terraces-contact.png
- screenshots/vfx-town-smoke.png
- screenshots/vfx-xp-drop.png
- screenshots/visual-before-coldbrace-20260829.png
- screenshots/visual-before-highcairn-20260829.png
- screenshots/visual-before-rootfall-20260829.png
- screenshots/w-cache.png
- screenshots/w-controls-1280-transient.png
- screenshots/w-controls-1280.png
- screenshots/w-controls-1440.png
- screenshots/w-death-720.png
- screenshots/w-death-carrying.png
- screenshots/w-death-empty.png
- screenshots/w-death-expired.png
- screenshots/w-dialogue-ansel-1440x900.png
- screenshots/w-dialogue-controls-while-talking-1440x900.png
- screenshots/w-dialogue-harrow-after-1-1280x720.png
- screenshots/w-dialogue-harrow-after-1-1440x900.png
- screenshots/w-dialogue-harrow-root-1280x720.png
- screenshots/w-dialogue-harrow-root-1440x900.png
- screenshots/w-dialogue-ilse-scrollback-1280x720.png
- screenshots/w-dialogue-ilse-scrollback-1440x900.png
- screenshots/w-dialogue-ode-levers-1280x720.png
- screenshots/w-dialogue-ode-levers-1440x900.png
- screenshots/w-dialogue-ode-levers-scrolled-1280x720.png
- screenshots/w-dialogue-ode-levers-scrolled-1440x900.png
- screenshots/w-dialogue-ode-refused-1280x720.png
- screenshots/w-dialogue-ode-refused-1440x900.png
- screenshots/w-dialogue-ode-root-1280x720.png
- screenshots/w-dialogue-ode-root-1440x900.png
- screenshots/w-map-1280.png
- screenshots/w-map-early-crop.png
- screenshots/w-map-early.png
- screenshots/w-map-empty.png
- screenshots/w-map-failure.png
- screenshots/w-map-keyboard.png
- screenshots/w-map-nothing.png
- screenshots/w-map-spawn-crop.png
- screenshots/w-map-spawn.png
- screenshots/w-map-walking-crop.png
- screenshots/w-map-walking.png
- screenshots/w-map-zoom.png
- screenshots/w-title-confirm-720.png
- screenshots/w-title-confirm-armed.png
- screenshots/w-title-confirm.png
- screenshots/w-title-damage-numbers-on.png
- screenshots/w-title-menu-720.png
- screenshots/w-title-menu-continue.png
- screenshots/w-title-menu.png
- screenshots/w-title-panels-compact.png
- screenshots/w-title-panels-normal.png
- screenshots/w-title-settings-720.png
- screenshots/w-title-settings-after-reload.png
- screenshots/w-title-settings-compact.png
- screenshots/w-title-settings-defaults.png
- screenshots/w-title-settings.png
- screenshots/w-title-world-shadows-off.png
- screenshots/w-title-world-shadows-on.png
- screenshots/w1-bank.png
- screenshots/w1-bracken_pit.png
- screenshots/w1-gravelmaw_entrance.png
- screenshots/w1-great_cairn.png
- screenshots/w1-highcairn.png
- screenshots/w1-hollowcut_seam.png
- screenshots/w1-karrowmoor_terraces.png
- screenshots/w1-march_road.png
- screenshots/w1-marchfield_farm.png
- screenshots/w1-palewood_copse.png
- screenshots/w1-redsill_shallows.png
- screenshots/w1-rootfall.png
- screenshots/w1-spawn.png
- screenshots/w1-sunder_ledge.png
- screenshots/w1-town_center.png
- screenshots/w1-town_entrance.png
- screenshots/w1-upper_karrow_seam.png
- screenshots/w1-vellenwood_canopy.png
- screenshots/w1fix-highcairn.png
- screenshots/w1fix-town_center.png
- screenshots/w2-bank.png
- screenshots/w2-highcairn.png
- screenshots/w2-march_road.png
- screenshots/w2-palewood_copse.png
- screenshots/w2-rootfall.png
- screenshots/w2-spawn.png
- screenshots/w2-town_center.png
- screenshots/w2-town_entrance.png
- screenshots/w3-bank.png
- screenshots/w3-bracken_pit.png
- screenshots/w3-crop-black.png
- screenshots/w3-crop-blob1.png
- screenshots/w3-crop-cart.png
- screenshots/w3-crop-chimney.png
- screenshots/w3-crop-cobble.png
- screenshots/w3-crop-far-rock.png
- screenshots/w3-crop-gravel.png
- screenshots/w3-crop-hcblob.png
- screenshots/w3-crop-horizon.png
- screenshots/w3-crop-horizon2.png
- screenshots/w3-crop-mf.png
- screenshots/w3-crop-spawnblob.png
- screenshots/w3-crop-square-ba.png
- screenshots/w3-gravelmaw_entrance.png
- screenshots/w3-great_cairn.png
- screenshots/w3-highcairn.png
- screenshots/w3-hollowcut_seam.png
- screenshots/w3-karrowmoor_terraces.png
- screenshots/w3-march_road.png
- screenshots/w3-marchfield_farm.png
- screenshots/w3-palewood_copse.png
- screenshots/w3-redsill_shallows.png
- screenshots/w3-rootfall.png
- screenshots/w3-spawn.png
- screenshots/w3-sunder_ledge.png
- screenshots/w3-town_center.png
- screenshots/w3-town_entrance.png
- screenshots/w3-upper_karrow_seam.png
- screenshots/w3-vellenwood_canopy.png
- screenshots/w3acc-crop-spawnA.png
- screenshots/w4a-highcairn.png
- screenshots/w4a-hollowcut_seam.png
- screenshots/w4a-rootfall.png
- screenshots/w4a-town_center.png
- screenshots/w4a-town_entrance.png
- screenshots/w4b-highcairn.png
- screenshots/w4b-hollowcut_seam.png
- screenshots/w4b-rootfall.png
- screenshots/w4b-town_center.png
- screenshots/w4b-town_entrance.png
- screenshots/wd-bank.png
- screenshots/wd-cover-arcade.png
- screenshots/wd-cover-forge.png
- screenshots/wd-cover-porch.png
- screenshots/wd-gravelmaw_entrance.png
- screenshots/wd-great_cairn.png
- screenshots/wd-karrowmoor_terraces.png
- screenshots/wd-marchfield_farm.png
- screenshots/wd-redsill_shallows.png
- screenshots/wd-rootfall.png
- screenshots/wd-town_center.png
- screenshots/wire-bank.png
- screenshots/wire-spawn.png
- screenshots/wire-town_center.png
- screenshots/wire-town_entrance.png
