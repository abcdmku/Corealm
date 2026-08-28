# Skills

## Combat

**Melee** — Physical accuracy, damage, and defence. Governs melee weapon and armour requirements.

**Magic** — Spellcasting power and accuracy, magical defence, and utility magic.

## Gathering

**Mining** — Breaks ore, stone, and gems out of seams and outcrops.

**Woodcutting** — Fells trees for logs and specialty wood.

**Fishing** — Takes fish and aquatic materials from shallows, pools, and deep water.

**Farming** — Grows crops, herbs, and fibres on plots that keep growing between sessions.

## Production

**Smithing** — Smelts ore into bars and forges melee equipment, tools, and metal components.

**Crafting** — Works gems, hide, and cloth into accessories, magic equipment, and components.

**Cooking** — Turns raw ingredients into healing food and stronger meals.

**Fletching** — Precision woodworking: shafts, handles, staves, and wooden tool components.

## Utility

**Agility** — Opens climbs, gaps, and tunnels that shorten routes between banks and resources.

## How gathering works

Mining, Woodcutting and Fishing share one model. An attempt happens every **1.8 seconds**.
At a node's own required level your success chance is exactly **30%** — one yield every six
seconds — rising 1.6 percentage points per level above the requirement, capped at 95%.

A better tool raises your *effective* level but never lets you gather something you do not
meet the base requirement for.

| Tier | XP per yield | Yields per node | Respawn | Tool bonus |
| --- | --- | --- | --- | --- |
| 1 | 10 | 8–15 | 21 s | +2 |
| 5 | 24 | 8–15 | 32 s | +5 |
| 10 | 35 | 8–14 | 43 s | +9 |
| 20 | 52 | 7–14 | 65 s | +17 |
| 30 | 65 | 7–13 | 86 s | +24 |
| 40 | 76 | 6–13 | 107 s | +32 |
| 50 | 86 | 6–12 | 126 s | +39 |
| 60 | 95 | 5–12 | 145 s | +40 |
| 70 | 103 | 5–11 | 164 s | +40 |
| 80 | 111 | 4–11 | 183 s | +40 |
| 90 | 119 | 4–10 | 202 s | +40 |
| 99 | 125 | 4–10 | 218 s | +40 |

## How combat works

Attacks resolve on a 600 ms tick. Your chance to hit is `attackRoll / (attackRoll + defenceRoll)`,
clamped between 5% and 95%. Melee damage rolls 1 to `floor(2 + (Melee + gear power) / 4.2)`.

There is no separate Defence skill: **Melee is your physical defence and Magic is your magical
defence**. Health is derived as `20 + 3 × floor((Melee + Magic) / 2)` plus equipment vitality.

Magic is 15% more accurate and each cast costs an essence shard. It beats high-armour,
low-magic-armour targets; melee beats the reverse.

You gain 4 experience per point of damage, plus twice the target's maximum health on the kill.
