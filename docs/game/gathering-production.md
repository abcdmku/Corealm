---
title: "Gathering and production"
description: "The level 1, 5, and 10 gathering loops, generated from the live tier, resource, item, and recipe tables."
---

These tables are a content check as much as a player guide. A tier appears here only when the canonical catalog resolves its resources, items, and recipes.

## 1. Mining and Smithing

March Stone remains the flux for every bar. This keeps the level 1 mine useful after later metal tiers unlock.

### Mining unlocks

| Level | Node | Primary yield | Secondary yield | XP | Per node | Respawn |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Grithe Seam | [Grithe Ore](./items/#grithe-ore) | [Pale Quartz](./items/#pale-quartz) at 6% | 10 | 8-15 | 21 s |
| 1 | Marchstone Face | [March Stone](./items/#march-stone) | [Pale Quartz](./items/#pale-quartz) at 3% | 10 | 8-15 | 21 s |
| 5 | Corven Seam | [Corven Ore](./items/#corven-ore) | [Vell Amber](./items/#vell-amber) at 6% | 24 | 8-15 | 32 s |
| 10 | Kaldite Face | [Kaldite Ore](./items/#kaldite-ore) | [Cairn Garnet](./items/#cairn-garnet) at 7% | 35 | 8-14 | 43 s |

### Smithing unlocks

| Level | Bar recipe | Station | Time | XP | Finished equipment |
| --- | --- | --- | --- | --- | --- |
| 1 | 1× Grithe Ore + 1× March Stone → 1× Grithe Bar | Furnace | 2.4 s | 8 | [Grithe Dagger](./items/#grithe-dagger), [Grithe Sword](./items/#grithe-sword), [Grithe Helm](./items/#grithe-helm), [Grithe Cuirass](./items/#grithe-cuirass), [Grithe Greaves](./items/#grithe-greaves), [Grithe Boots](./items/#grithe-boots), [Grithe Gloves](./items/#grithe-gloves), [Grithe Pickaxe](./items/#grithe-pickaxe), [Grithe Hatchet](./items/#grithe-hatchet) |
| 5 | 2× Corven Ore + 1× March Stone → 1× Corven Bar | Furnace | 2.4 s | 19 | [Corven Dagger](./items/#corven-dagger), [Corven Sword](./items/#corven-sword), [Corven Helm](./items/#corven-helm), [Corven Plate](./items/#corven-plate), [Corven Greaves](./items/#corven-greaves), [Corven Boots](./items/#corven-boots), [Corven Gauntlets](./items/#corven-gauntlets), [Corven Pickaxe](./items/#corven-pickaxe), [Corven Hatchet](./items/#corven-hatchet) |
| 10 | 2× Kaldite Ore + 2× March Stone → 1× Kaldite Bar | Furnace | 2.4 s | 28 | [Kaldite Dagger](./items/#kaldite-dagger), [Kaldite Sword](./items/#kaldite-sword), [Kaldite Helm](./items/#kaldite-helm), [Kaldite Plate](./items/#kaldite-plate), [Kaldite Greaves](./items/#kaldite-greaves), [Kaldite Boots](./items/#kaldite-boots), [Kaldite Gauntlets](./items/#kaldite-gauntlets), [Kaldite Pickaxe](./items/#kaldite-pickaxe), [Kaldite Hatchet](./items/#kaldite-hatchet) |

## 2. Fishing and Cooking

A range and a player-built campfire use the same recipe and burn chance. Raw and burnt fish are not food.

| Level | Fishing spot | Raw fish | Cooked food | Heal | Cooking XP | Stations | Time | Burn at unlock | Burnt result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Redsill Shallow | [Silt Minnow](./items/#silt-minnow) | [Seared Minnow](./items/#seared-minnow) | 3 | 15 | Range / Campfire | 2.4 s | 45% | [Burnt Minnow](./items/#burnt-minnow) |
| 5 | Blackwater Pool | [Bramble Trout](./items/#bramble-trout) | [Seared Trout](./items/#seared-trout) | 7 | 36 | Range / Campfire | 2.4 s | 45% | [Burnt Trout](./items/#burnt-trout) |
| 10 | Cairn Tarn | [Cragfin](./items/#cragfin) | [Seared Cragfin](./items/#seared-cragfin) | 12 | 53 | Range / Campfire | 2.4 s | 45% | [Burnt Cragfin](./items/#burnt-cragfin) |

Burn chance is `clamp(0.45 - 0.030 × (Cooking level - recipe level), 0, 0.45)`. Cooked fish takes 1.8 seconds to eat and cannot heal above maximum health.

## 3. Woodcutting, Fletching, and Crafting

Each log tier supplies the reusable shafts and handles used by wooden gear and handled metal equipment.

### Wood and Fletching unlocks

| Level | Tree | Log | Shafts | Handles | Wooden equipment |
| --- | --- | --- | --- | --- | --- |
| 1 | Palewood | [Palewood Log](./items/#palewood-log) | 1× Palewood Log → 4× Palewood Shaft for 10 XP | 1× Palewood Log → 2× Palewood Handle for 10 XP | [Palewood Staff](./items/#palewood-staff) from 3× Palewood Shaft; [Palewood Wand](./items/#palewood-wand) from 2× Palewood Shaft; [Palewood Shield](./items/#palewood-shield) from 2× Palewood Log + 1× Grithe Bar; [Palewood Rod](./items/#palewood-rod) from 2× Palewood Shaft + 1× Coarse Hide; [Basic Wooden Wand](./items/#basic-wooden-wand) from 1× Palewood Shaft; [Basic Wooden Staff](./items/#basic-wooden-staff) from 2× Palewood Shaft |
| 5 | Duskoak | [Duskoak Log](./items/#duskoak-log) | 1× Duskoak Log → 4× Duskoak Shaft for 24 XP | 1× Duskoak Log → 2× Duskoak Handle for 24 XP | [Duskoak Staff](./items/#duskoak-staff) from 3× Duskoak Shaft; [Duskoak Wand](./items/#duskoak-wand) from 2× Duskoak Shaft; [Duskoak Shield](./items/#duskoak-shield) from 2× Duskoak Log + 1× Corven Bar; [Duskoak Rod](./items/#duskoak-rod) from 2× Duskoak Shaft + 1× Bramble Hide |
| 10 | Cairnpine | [Cairnpine Log](./items/#cairnpine-log) | 1× Cairnpine Log → 4× Cairnpine Shaft for 35 XP | 1× Cairnpine Log → 2× Cairnpine Handle for 35 XP | [Cairnpine Staff](./items/#cairnpine-staff) from 3× Cairnpine Shaft; [Cairnpine Wand](./items/#cairnpine-wand) from 2× Cairnpine Shaft; [Cairnpine Shield](./items/#cairnpine-shield) from 2× Cairnpine Log + 1× Kaldite Bar; [Cairnpine Rod](./items/#cairnpine-rod) from 2× Cairnpine Shaft + 1× Wight Shroud |

### Mining and Crafting bridge

| Level | Gem | Crafting outputs |
| --- | --- | --- |
| 1 | [Pale Quartz](./items/#pale-quartz) | [Air Wand](./items/#air-wand) from 1× Palewood Wand + 1× Air Orb; [Air Staff](./items/#air-staff) from 1× Palewood Staff + 1× Air Orb; [Grithe Ring](./items/#grithe-ring) from 1× Grithe Bar + 1× Pale Quartz; [Grithe Pendant](./items/#grithe-pendant) from 1× Grithe Bar + 1× Pale Quartz; [Ember Ring](./items/#ember-ring) from 1× Grithe Bar + 2× Pale Quartz; [Ember Charm](./items/#ember-charm) from 2× Pale Quartz; [Marchhide Robe](./items/#marchhide-robe) from 3× Coarse Hide; [Marchhide Leggings](./items/#marchhide-leggings) from 2× Coarse Hide; [Marchhide Hood](./items/#marchhide-hood) from 1× Coarse Hide; [Marchhide Boots](./items/#marchhide-boots) from 1× Coarse Hide; [Marchhide Wraps](./items/#marchhide-wraps) from 1× Coarse Hide |
| 5 | [Vell Amber](./items/#vell-amber) | [Earth Wand](./items/#earth-wand) from 1× Duskoak Wand + 1× Earth Orb; [Earth Staff](./items/#earth-staff) from 1× Duskoak Staff + 1× Earth Orb; [Corven Ring](./items/#corven-ring) from 1× Corven Bar + 1× Vell Amber; [Corven Pendant](./items/#corven-pendant) from 1× Corven Bar + 1× Vell Amber; [Stone Ring](./items/#stone-ring) from 1× Corven Bar + 2× Vell Amber; [Stone Charm](./items/#stone-charm) from 2× Vell Amber; [Bramblehide Robe](./items/#bramblehide-robe) from 3× Bramble Hide; [Bramblehide Leggings](./items/#bramblehide-leggings) from 2× Bramble Hide; [Bramblehide Hood](./items/#bramblehide-hood) from 1× Bramble Hide; [Bramblehide Boots](./items/#bramblehide-boots) from 1× Bramble Hide; [Bramblehide Wraps](./items/#bramblehide-wraps) from 1× Bramble Hide |
| 10 | [Cairn Garnet](./items/#cairn-garnet) | [Water Wand](./items/#water-wand) from 1× Cairnpine Wand + 1× Water Orb; [Water Staff](./items/#water-staff) from 1× Cairnpine Staff + 1× Water Orb; [Kaldite Ring](./items/#kaldite-ring) from 1× Kaldite Bar + 1× Cairn Garnet; [Kaldite Pendant](./items/#kaldite-pendant) from 1× Kaldite Bar + 1× Cairn Garnet; [Storm Ring](./items/#storm-ring) from 1× Kaldite Bar + 2× Cairn Garnet; [Storm Charm](./items/#storm-charm) from 2× Cairn Garnet; [Wightshroud Robe](./items/#wightshroud-robe) from 3× Wight Shroud; [Wightshroud Leggings](./items/#wightshroud-leggings) from 2× Wight Shroud; [Wightshroud Hood](./items/#wightshroud-hood) from 1× Wight Shroud; [Wightshroud Boots](./items/#wightshroud-boots) from 1× Wight Shroud; [Wightshroud Wraps](./items/#wightshroud-wraps) from 1× Wight Shroud |

[Campfire fuel, lifetime, and build XP](./campfires) also derive from each tier's log row.
