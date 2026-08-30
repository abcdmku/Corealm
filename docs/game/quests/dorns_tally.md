---
title: "Dorn's Tally"
description: "Dorn's Tally start location, requirements, walkthrough, and rewards."
---

The March Company ledger says a Grithe seam is worth four loads. Pitmaster Dorn has been signing that figure for nine years and has never once believed it. Work a seam to the bottom, count what it actually gave, and settle the argument with a number.

![Pitmaster Dorn](../assets/captures/npcs/npc_pitmaster_dorn.webp)

| Giver | Start location | Region | Requirements | Prerequisite |
| --- | --- | --- | --- | --- |
| [Pitmaster Dorn](../../npcs/#pitmaster-dorn) | [Coldbrace Square](../../regions/#coldbrace-square) | [Fallowmarch](../../regions/#fallowmarch) | None | None |



## Walkthrough

### 1. Work one Grithe seam at the Bracken Pit until it is worked out. Stay on the same seam: Dorn wants the count from one node, not from six.

Pick one seam and stay on it. `inspect` the node while you work: its `resource.remaining` counts down, and the event that ends it carries `yieldsTaken`, which is the number Dorn wants.

<nav class="corealm-quest-where" aria-label="Locations for step 1"><span>Where</span><a href="../../regions/#bracken-pit">Bracken Pit</a></nav>
<nav class="corealm-quest-items" aria-label="Items for step 1"><span>Items</span><a href="../../items/#grithe-ore">Grithe Ore</a></nav>
<div class="corealm-quest-step-evidence">
<div class="corealm-quest-scenes"><figure class="corealm-quest-scene"><img src="../../assets/captures/locations/bracken_pit.webp" alt="Bracken Pit in the running Corealm world" loading="lazy" /><figcaption><strong>Bracken Pit</strong><span>Bracken Pit</span></figcaption></figure></div>
<figure class="corealm-location-map corealm-quest-map" data-location-map style="--map-image-ratio:1.3333333333333333">
<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="Map for Dorn's Tally, step 1">
<div class="corealm-map-stage" data-map-stage>
<img src="../../assets/world-map.webp?v=14f5aa5e68863076c507b002d6d1d30bf77ae9e848977ebf918a48de026b9dce" alt="Overhead map rendered from the Corealm game world" draggable="false" />
<a class="corealm-map-marker" href="../../regions/#bracken-pit" style="--map-x:36.6667%;--map-y:43.3333%" data-map-side="right" data-map-kind="seam" data-map-marker aria-label="Bracken Pit, Fallowmarch" title="Bracken Pit, Fallowmarch"><span>Bracken Pit<small>Fallowmarch</small></span></a>
</div>
<span class="corealm-map-north" aria-hidden="true">N</span>
<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">
<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>
<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>
<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>
</div>
<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>
</div>
<figcaption>Bracken Pit.</figcaption>
</figure>
</div>

#### Stage reward

| Reward | Amount |
| --- | --- |
| Mining XP | 40 |

### 2. Tell Pitmaster Dorn how many loads the seam actually gave. He offers three bands; pick the one your seam fell into.

The exact figure was in the `resource.depleted` event, and the quest kept it: it is the `last_seam_yield` counter on this quest's record. Guess wrong and Dorn sends you back to check, which costs nothing but a walk.

<nav class="corealm-quest-where" aria-label="Locations for step 2"><span>Where</span><a href="../../regions/#coldbrace-square">Coldbrace Square</a></nav>
<div class="corealm-quest-step-evidence">
<div class="corealm-quest-scenes"><figure class="corealm-quest-scene"><img src="../../assets/captures/npcs/npc_pitmaster_dorn.webp" alt="Pitmaster Dorn in the running Corealm world" loading="lazy" /><figcaption><strong>Pitmaster Dorn</strong><span>Coldbrace Square</span></figcaption></figure></div>
<figure class="corealm-location-map corealm-quest-map" data-location-map style="--map-image-ratio:1.3333333333333333">
<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="Map for Dorn's Tally, step 2">
<div class="corealm-map-stage" data-map-stage>
<img src="../../assets/world-map.webp?v=14f5aa5e68863076c507b002d6d1d30bf77ae9e848977ebf918a48de026b9dce" alt="Overhead map rendered from the Corealm game world" draggable="false" />
<a class="corealm-map-marker" href="../../npcs/#pitmaster-dorn" style="--map-x:36.4833%;--map-y:57.3750%" data-map-side="right" data-map-kind="npc" data-map-marker aria-label="Pitmaster Dorn, Fallowmarch" title="Pitmaster Dorn, Fallowmarch"><span>Pitmaster Dorn<small>Fallowmarch</small></span></a>
</div>
<span class="corealm-map-north" aria-hidden="true">N</span>
<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">
<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>
<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>
<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>
</div>
<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>
</div>
<figcaption>Coldbrace Square.</figcaption>
</figure>
</div>

#### Stage reward

| Reward | Amount |
| --- | --- |
| Mining XP | 60 |

### 3. Make the vault agree with the ledger: bank 15 Grithe ore at the Coldbrace Bank.

Walk to the bank counter and `bank("deposit", { itemId: "grithe_ore", quantity: -1 })`. The stage counts what is in the bank, not what you carried in.

<nav class="corealm-quest-where" aria-label="Locations for step 3"><span>Where</span><a href="../../regions/#coldbrace-bank">Coldbrace Bank</a></nav>
<nav class="corealm-quest-items" aria-label="Items for step 3"><span>Items</span><a href="../../items/#grithe-ore">Grithe Ore</a></nav>
<div class="corealm-quest-step-evidence">
<div class="corealm-quest-scenes"><figure class="corealm-quest-scene"><img src="../../assets/captures/entities/coldbrace_bank.webp" alt="Coldbrace Bank in the running Corealm world" loading="lazy" /><figcaption><strong>Coldbrace Bank</strong><span>Coldbrace Bank</span></figcaption></figure></div>
<figure class="corealm-location-map corealm-quest-map" data-location-map style="--map-image-ratio:1.3333333333333333">
<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="Map for Dorn's Tally, step 3">
<div class="corealm-map-stage" data-map-stage>
<img src="../../assets/world-map.webp?v=14f5aa5e68863076c507b002d6d1d30bf77ae9e848977ebf918a48de026b9dce" alt="Overhead map rendered from the Corealm game world" draggable="false" />
<a class="corealm-map-marker" href="../../regions/#coldbrace-bank" style="--map-x:36.3542%;--map-y:57.5333%" data-map-side="right" data-map-kind="entity" data-map-marker aria-label="Coldbrace Bank, Fallowmarch" title="Coldbrace Bank, Fallowmarch"><span>Coldbrace Bank<small>Fallowmarch</small></span></a>
</div>
<span class="corealm-map-north" aria-hidden="true">N</span>
<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">
<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>
<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>
<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>
</div>
<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>
</div>
<figcaption>Coldbrace Bank.</figcaption>
</figure>
</div>


### 4. Sign the corrected page with Pitmaster Dorn.

Back to the square. He will have a pen ready; he always has a pen ready.

<nav class="corealm-quest-where" aria-label="Locations for step 4"><span>Where</span><a href="../../regions/#coldbrace-square">Coldbrace Square</a></nav>
<div class="corealm-quest-step-evidence">
<div class="corealm-quest-scenes"><figure class="corealm-quest-scene"><img src="../../assets/captures/npcs/npc_pitmaster_dorn.webp" alt="Pitmaster Dorn in the running Corealm world" loading="lazy" /><figcaption><strong>Pitmaster Dorn</strong><span>Coldbrace Square</span></figcaption></figure></div>
<figure class="corealm-location-map corealm-quest-map" data-location-map style="--map-image-ratio:1.3333333333333333">
<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="Map for Dorn's Tally, step 4">
<div class="corealm-map-stage" data-map-stage>
<img src="../../assets/world-map.webp?v=14f5aa5e68863076c507b002d6d1d30bf77ae9e848977ebf918a48de026b9dce" alt="Overhead map rendered from the Corealm game world" draggable="false" />
<a class="corealm-map-marker" href="../../npcs/#pitmaster-dorn" style="--map-x:36.4833%;--map-y:57.3750%" data-map-side="right" data-map-kind="npc" data-map-marker aria-label="Pitmaster Dorn, Fallowmarch" title="Pitmaster Dorn, Fallowmarch"><span>Pitmaster Dorn<small>Fallowmarch</small></span></a>
</div>
<span class="corealm-map-north" aria-hidden="true">N</span>
<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">
<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>
<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>
<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>
</div>
<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>
</div>
<figcaption>Coldbrace Square.</figcaption>
</figure>
</div>


## Completion rewards

| Reward | Amount |
| --- | --- |
| Mining XP | 260 |
| [Grithe Pickaxe](../../items/#grithe-pickaxe) | 1 |
| Marks | 220 |
| Unlock | Dorn will quote you real seam figures instead of the ledger's. |
