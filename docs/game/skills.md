---
title: "Skills"
description: "Corealm skills, gathering rules, and combat rules."
---

## Combat

- **Melee:** Physical accuracy, damage, and defence. Governs melee weapon and armour requirements.
- **Magic:** Spellcasting power and accuracy, magical defence, and utility magic.

## Gathering

- **Mining:** Breaks ore, stone, and gems out of seams and outcrops.
- **Woodcutting:** Fells trees for logs and specialty wood.
- **Fishing:** Takes fish and aquatic materials from shallows, pools, and deep water.
- **Farming:** Grows crops, herbs, and fibres on plots that keep growing between sessions.

## Production

- **Smithing:** Smelts ore into bars and forges melee equipment, tools, and metal components.
- **Crafting:** Works gems, hide, and cloth into accessories, magic equipment, and components.
- **Cooking:** Turns raw ingredients into healing food and stronger meals.
- **Fletching:** Precision woodworking: shafts, handles, staves, and wooden tool components.

## Utility

- **Agility:** Opens climbs, gaps, and tunnels that shorten routes between banks and resources.

## Gathering

Mining, Woodcutting, and Fishing attempt an action every **1.8 seconds**. Success starts at 30% at the required level, rises by 1.6 percentage points per extra level, and caps at 95%.

| Level | XP per yield | Yields per node | Respawn | Tool bonus |
| --- | --- | --- | --- | --- |
| 1 | 10 | 8-15 | 21 s | +2 |
| 5 | 24 | 8-15 | 32 s | +5 |
| 10 | 35 | 8-14 | 43 s | +9 |

## Gathering and production skill guides

The unlock rows below come from the same tier, resource, recipe, and item tables used by the game. See the [three complete gathering loops](./gathering-production) for ingredients and finished equipment.

### Mining

| Level | Unlocks |
| --- | --- |
| 1 | Grithe Seam yields Grithe Ore, plus Pale Quartz, Marchstone Face yields March Stone, plus Pale Quartz |
| 5 | Corven Seam yields Corven Ore, plus Vell Amber |
| 10 | Kaldite Face yields Kaldite Ore, plus Cairn Garnet |

### Smithing

| Level | Unlocks |
| --- | --- |
| 1 | 1× Grithe Bar, 1× Grithe Dagger, 1× Grithe Sword, 1× Grithe Helm, 1× Grithe Cuirass, 1× Grithe Greaves, 1× Grithe Boots, 1× Grithe Gloves, 1× Grithe Pickaxe, 1× Grithe Hatchet |
| 5 | 1× Corven Bar, 1× Corven Dagger, 1× Corven Sword, 1× Corven Helm, 1× Corven Plate, 1× Corven Greaves, 1× Corven Boots, 1× Corven Gauntlets, 1× Corven Pickaxe, 1× Corven Hatchet |
| 10 | 1× Kaldite Bar, 1× Kaldite Dagger, 1× Kaldite Sword, 1× Kaldite Helm, 1× Kaldite Plate, 1× Kaldite Greaves, 1× Kaldite Boots, 1× Kaldite Gauntlets, 1× Kaldite Pickaxe, 1× Kaldite Hatchet |

### Fishing

| Level | Unlocks |
| --- | --- |
| 1 | Redsill Shallow yields Silt Minnow |
| 5 | Blackwater Pool yields Bramble Trout |
| 10 | Cairn Tarn yields Cragfin |

### Cooking

| Level | Unlocks |
| --- | --- |
| 1 | 1× Seared Minnow |
| 5 | 1× Seared Trout |
| 10 | 1× Seared Cragfin |

### Woodcutting

| Level | Unlocks |
| --- | --- |
| 1 | Palewood yields Palewood Log |
| 5 | Duskoak yields Duskoak Log |
| 10 | Cairnpine yields Cairnpine Log |

### Fletching

| Level | Unlocks |
| --- | --- |
| 1 | 4× Palewood Shaft, 2× Palewood Handle, 1× Palewood Staff, 1× Palewood Wand, 1× Palewood Shield, 1× Quartz Focus, 1× Palewood Rod |
| 5 | 4× Duskoak Shaft, 2× Duskoak Handle, 1× Duskoak Staff, 1× Duskoak Wand, 1× Duskoak Shield, 1× Amber Focus, 1× Duskoak Rod |
| 10 | 4× Cairnpine Shaft, 2× Cairnpine Handle, 1× Cairnpine Staff, 1× Cairnpine Wand, 1× Cairnpine Shield, 1× Garnet Focus, 1× Cairnpine Rod |

### Crafting

| Level | Unlocks |
| --- | --- |
| 1 | 5× Essence Shard, 1× Grithe Ring, 1× Grithe Pendant, 1× Ember Ring, 1× Ember Charm, 1× Marchhide Robe, 1× Marchhide Leggings, 1× Marchhide Hood, 1× Marchhide Boots, 1× Marchhide Wraps |
| 5 | 5× Essence Shard, 1× Corven Ring, 1× Corven Pendant, 1× Stone Ring, 1× Stone Charm, 1× Bramblehide Robe, 1× Bramblehide Leggings, 1× Bramblehide Hood, 1× Bramblehide Boots, 1× Bramblehide Wraps |
| 10 | 5× Essence Shard, 1× Kaldite Ring, 1× Kaldite Pendant, 1× Storm Ring, 1× Storm Charm, 1× Wightshroud Robe, 1× Wightshroud Leggings, 1× Wightshroud Hood, 1× Wightshroud Boots, 1× Wightshroud Wraps |

## Combat

Attacks resolve on a 600 ms tick. Melee supplies physical defence; Magic supplies magical defence. Health is `20 + 3 × floor((Melee + Magic) / 2)` plus equipment vitality. Magic is 15% more accurate but consumes an essence shard per cast.
