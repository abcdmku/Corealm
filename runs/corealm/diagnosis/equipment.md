# equipment

## Summary

The equipment *system* is not broken — it is invisible. I equipped all 57 gear rows through the real `gameApi.equipItem` path and every one of them produced a stat delta that matches `content/equipment.ts` exactly (57/57), with zero console errors and zero `getErrors()` entries. Swap, rollback, INVENTORY_FULL, REQUIREMENTS_NOT_MET, NOT_ENOUGH_ITEMS, max-health clamp (145 -> 140 on unequipping a Kaldite Plate), save/load round trip, and death-keeps-gear all behave exactly as `runs/corealm/architecture.md` specifies. UI and agent surfaces reach the identical `gameApi` function and produce a byte-identical state snapshot (PRD F11 parity holds). What is completely absent is the render half: `getSceneStats().totalObjects` reads 1077 before equipping, 1077 after wearing the full tier-10 Kaldite kit, and 1077 after swapping to the full Wightshroud + Cairnpine Staff kit. The rig's children never change from `body` + the three hardcoded peasant outfit pieces. `CharacterRig.equipMainHandAsset`, `VISIBLE_SLOTS` and `equippedAssetId` have zero callers anywhere in the repo — the render seam for equipment was declared and never wired. On top of that, the three outfit pieces the player *does* wear are added to `this.root` without being rebound to the body's skeleton, so they sit in bind pose while the body animates underneath: that is the dark bar floating at the chest and the boot floating in front of the shins in eq-01-naked-spawn-zoom.png. Secondary: all six staffs draw a sword icon in the Worn panel, and equipment has zero test coverage.

## Evidence

- **Full 57-item equip sweep through gameApi.equipItem (via agent tool corealm_equip), melee 1/magic 1 then melee 40/magic 40, recording getPlayer() and corealm_inventory().equipment.totals before and after each** — 57/57 stat deltas match content/equipment.ts exactly. At level 1: 20 of 57 equip OK, 37 correctly rejected with REQUIREMENTS_NOT_MET. At level 40: 57/57 equip OK. Examples — grithe_sword {accuracy +7, power +8}; kaldite_sword {accuracy +28, power +26}; kaldite_plate {accuracy +3, armour +18, magicArmour +4, vitality +5} maxHealth 140->145; wightshroud_robe {armour +2, magicAccuracy +6, magicPower +3, magicArmour +14, vitality +4} 140->144; cairnpine_staff {power +4, magicAccuracy +24, magicPower +20, magicArmour +4}. Zero __gameDebug.getErrors() entries, zero page console errors.
- **Scene-graph delta across three equipment states via getSceneStats()** — totalObjects = 1077 naked / 1077 with full tier-10 Kaldite kit / 1077 with full Wightshroud + Cairnpine Staff. Rig children unchanged in all three: character-rig > body, outfit-outfit_male_peasant_chest, outfit-outfit_male_peasant_legs, outfit-outfit_male_peasant_boots.
- **runs/corealm/screenshots/eq-01-naked-spawn.png, eq-02-full-kaldite-kit-spawn.png, eq-03-full-wightshroud-staff-spawn.png plus 130x110 nearest-neighbour crops of the player (-zoom.png)** — Character is pixel-identical in all three. Bare chest, bare arms, bare feet; a dark bar floating across the chest, dark shorts detached at the hips, a boot shape floating in front of the shins. Only the HUD differs (23/23 vs 23/156 health bar).
- **Swap, rollback and inventory-pressure edge cases** — Swap grithe_sword -> kaldite_sword: totals 7/8 -> 28/26, grithe_sword returned to the pack, one item on each side, no duplication. 27 junk stacks + kaldite_helm at 28/28 full: equip succeeded (frees its own slot first, 1 free after). Refilled to 28/28 then unequip: INVENTORY_FULL "No free inventory slot for your Kaldite Helm", helm stays worn — gear is never destroyed. Equip without carrying: NOT_ENOUGH_ITEMS. Unequip an empty slot: NOT_FOUND. Unequip "backpack": INVALID_ARGUMENT.
- **Max-health clamp on unequip** — Wearing kaldite_plate at melee 40: maxHealth 145. Healed to 145, unequipped: maxHealth 140 and current health clamped 145 -> 140. Correct.
- **Death with a full tier-10 kit worn plus 5 grithe_ore carried** — After death: all 9 equipment slots unchanged (totals accuracy 42 / power 26 / armour 58 / magicArmour 19 / vitality 16), inventory emptied to []. Matches architecture: death drops inventory, not equipment.
- **Save/load round trip** — saveNow() -> getSaveBlob(): top-level keys include `equipment` with all 9 slots populated. reset() cleared all 9 to null; loadSaveBlob() restored all 9 items and totals byte for byte, maxHealth back to 156.
- **PRD F11 UI/agent parity: equip corven_sword via callTool("corealm_equip") vs via a real left-click on .inv-grid .slot[data-slot-index="0"] with the Inventory panel open** — Identical. JSON of {equipment.slots, equipment.totals, inventory.slots, freeSlots, maxHealth} matched exactly. (Note: with the panel CLOSED the click is a no-op, because panels.ts:687 only refreshes open panels so the cell's cached stack is stale — a test artefact, not a player-facing bug.)
- **runs/corealm/screenshots/eq-06-worn-tooltip-cairnpine-staff.png and eq-07-inventory-tooltip-unmet-kaldite-sword.png** — Tooltips are the strongest part of this domain. Worn panel tooltip: name, "Tier 10 · equipment", description, Power +4 / Magic accuracy +24 / Magic power +20 / Magic armour +4, "Attack speed 3.0 s", "Requires Magic 10", "Value 1,180 · sells for 708". Inventory tooltip on an unequippable Kaldite Sword: green/red deltas against the worn staff (+28, +22, -24, -20, -4), "Compared with your main hand.", and "Requires Melee 10 — you have 1" in red. Panel subtitle correctly reads "9 of 9 slots worn" and the totals block sums correctly.
- **GLB structure of an outfit piece and of the weapon set** — outfit_male_ranger_chest.glb: 69 nodes (full 65-bone skeleton incl. Head, hand_l, hand_r), 3 meshes, 0 animations — same node count as base_male.glb. weapon/{sword,axe,pickaxe,shield}.glb: 1 node, 1 mesh each, node names *_Bronze / *_Wooden, tagged `recolour`. No staff, dagger or bow anywhere in the 213-asset manifest.
- **Reachability of the gear ladder from content** — All 57 equipment ids are referenced by at least one of shops.ts / recipes.ts / enemies.ts / quests.ts / regions.ts. Nothing is orphaned content.

## Findings

### 1. [critical/confirmed] Equipment has no visual representation at all — the rig is never told what is worn

`game/src/app/boot.ts:297`

**Root cause.** `CharacterRig` is built once at boot with a hardcoded `outfitAssetIds: ["outfit_male_peasant_chest", "outfit_male_peasant_legs", "outfit_male_peasant_boots"]` and is never updated again. `loop.ts:217 syncPlayerRig()` only pushes position, facing and pose; it never reads `api.getEquipment()`. Nothing in the repo subscribes to the `item.equipped` / `item.unequipped` events for rendering (grep: only equipment.ts emits them, gate-check.ts reads them).

**Evidence.** `getSceneStats().totalObjects` = 1077 naked, 1077 wearing the full tier-10 melee kit (kaldite_sword/cairnpine_shield/kaldite_helm/plate/greaves/boots/gauntlets/ring/pendant, totals accuracy 42 power 26 armour 58 vitality 16), 1077 wearing the full Wightshroud magic kit + Cairnpine Staff. The rig's children are the same 4 nodes in all three states: `character-rig` > `body`, `outfit-outfit_male_peasant_chest`, `outfit-outfit_male_peasant_legs`, `outfit-outfit_male_peasant_boots`. Screenshots runs/corealm/screenshots/eq-01-naked-spawn-zoom.png and eq-03-full-wightshroud-staff-spawn-zoom.png are pixel-identical on the character.

**Fix.** Wire the seam that already exists. (1) Add an appearance table in `content/` (NOT in `contracts.ts` ItemDef — that file is frozen and has no asset field): `export const GEAR_APPEARANCE: Record<ItemId, { assetId: string; tint?: string; scale?: number }>` keyed by the 57 ids. (2) In `loop.ts:217 syncPlayerRig`, diff `api.getEquipment().slots` against a cached signature per frame (or subscribe to `item.equipped`/`item.unequipped` in boot) and call the rig. (3) Extend `CharacterRig` with `setSlotAsset(slot: EquipSlot, assetId: string | null)` covering `head/body/legs/feet/hands` (skinned rebind, see next finding) and route `mainHand`/`offHand` through the existing `equipMainHandAsset` plus a new `equipOffHandAsset` bound to `hand_l` (confirmed present in base_male.glb). `equippedAssetId(stack, lookup)` at characterRig.ts:281 is exactly the lookup helper this needs and is currently dead code.

### 2. [critical/confirmed] Outfit pieces are never rebound to the body skeleton, so they render frozen in bind pose

`game/src/render/characterRig.ts:130`

**Root cause.** `attachOutfit()` does `cloneSkinned(source)` and then `this.root.add(piece)`. Each outfit GLB ships its own full copy of the 65-bone skeleton, and the `AnimationMixer` is created on `body` only (characterRig.ts:106). Nothing ever drives the outfit's bones, so every outfit SkinnedMesh stays at its bind transform while the body animates under it.

**Evidence.** `npx tsx tools/inspect-glb.ts game/public/assets/models/outfit/outfit_male_ranger_chest.glb` -> 69 nodes (the full skeleton: Head, hand_l, hand_r, neck_01, finger chains...), meshes [Male_Ranger_Body, Male_Ranger_Body_Belt_1, ...], animations []. Identical node count to base_male.glb (69 nodes). Visually in runs/corealm/screenshots/eq-01-naked-spawn-zoom.png the player is bare-chested and barefoot with a dark horizontal bar floating across the chest (outfit_male_peasant_chest, bbox 0.747 x 0.637), dark shorts detached at the hips (…_legs, 0.423 x 0.651) and a boot shape floating in front of the shins (…_boots, 0.351 x 0.452).

**Fix.** In `attachOutfit`, after `cloneSkinned`, capture the body's `THREE.Skeleton` once (`(body.getObjectByName('SuperHero_Male') as THREE.SkinnedMesh).skeleton` or the first SkinnedMesh found) and for every SkinnedMesh in the cloned piece call `mesh.bind(bodySkeleton, mesh.bindMatrix)`, then reparent that mesh under the body's armature root and discard the piece's own bone hierarchy. Bone names are byte-identical across every character and outfit pack (stack-findings.md section 2), so a name-indexed rebind is safe. Verify with a screenshot at `spawn`: the chest piece must sit on the torso instead of 30 cm in front of it.

### 3. [critical/confirmed] `equipMainHandAsset`, `VISIBLE_SLOTS` and `equippedAssetId` are dead exports with zero callers

`game/src/render/characterRig.ts:279`

**Root cause.** The render-side API for equipment was written in full but never called. `grep -rn "VISIBLE_SLOTS|equippedAssetId|equipMainHandAsset|setMainHand|setHead" game/src tools --include=*.ts` returns matches only inside characterRig.ts itself. `VISIBLE_SLOTS` also lists `body`, `legs`, `feet` which have no implementation behind them at all — only `setMainHand` (hand_r) and `setHead` (Head) exist.

**Evidence.** grep across game/src and tools returns 5 hits for `CharacterRig`, all in boot.ts (297, 298, 303, 304) and loop.ts (24, 65, 92) — none of them touch equipment. `equipMainHandAsset` is called 0 times. Live proof: wearing a Kaldite Sword adds nothing to the scene graph (1077 objects before and after).

**Fix.** Implement `body`/`legs`/`feet`/`hands` as skinned-rebind slots (same code path as the fixed `attachOutfit`) and `head`/`mainHand`/`offHand` as bone attachments on `Head`, `hand_r`, `hand_l`. Keep `VISIBLE_SLOTS` as the single source of which slots the rig honours, and make it the loop's iteration list so adding a slot is one edit.

### 4. [high/confirmed] There is no item->asset mapping anywhere, and 3 of 6 mainHand weapon archetypes have no mesh in the library

`game/src/contracts.ts:84`

**Root cause.** `ItemDef.equip` carries `slot`, `bonuses`, `attackSpeedMs`, `requires` and nothing about appearance. `SemanticEntity.view.assetId` is the render seam for world entities but the player has no SemanticEntity, so worn gear has no channel to the render layer. Separately the asset library only has 4 weapon GLBs.

**Evidence.** manifest.json weapon category = exactly 4 assets: axe (0.294x0.827x0.046), pickaxe (0.813x1.198x0.136), shield (0.615x0.621x0.179), sword (0.267x1.132x0.065). No staff, no dagger, no bow. Outfit category has 20 modular slot-tagged pieces in exactly 4 sets (male/female x peasant/ranger); the peasant set has no head piece, the ranger set is complete (chest/legs/boots/gloves/hood/pauldron). All four weapon GLBs are single-node single-mesh named `*_Bronze` / `*_Wooden` and tagged `recolour`.

**Fix.** Map the 57 ids onto 2 visual sets x 3 tier tints rather than 57 assets. Melee line -> outfit_male_ranger_{chest,legs,boots,gloves,hood} (+ _pauldron on tier 5/10 body for silhouette growth); magic line -> outfit_male_peasant_{chest,legs,boots,gloves} + ranger_hood. mainHand: all swords AND daggers -> weapon/sword.glb (dagger at scale 0.65); offHand shields AND foci -> weapon/shield.glb (focus at scale 0.4). Tier reads through material colour, not geometry: use `MaterialLibrary` in render/materials.ts to override the `*_Bronze` material to Grithe grey / Corven dark-oiled / Kaldite black-with-garnet, and lean on `tierSilhouetteScale`. Staffs have no asset — either commission one or accept that the 6 staff items show nothing in hand and say so; do NOT ship a sword in a mage's hand.

### 5. [medium/confirmed] Every mainHand item draws a sword icon, every offHand a shield, every accessory a ring

`game/src/ui/itemIcons.ts:94`

**Root cause.** `BY_EQUIP_SLOT` maps the nine slots to nine shapes, and `iconShapeFor` returns `BY_EQUIP_SLOT[def.equip.slot]` for anything with an `equip` block. Slot is the only input, so within a slot every item is the same glyph.

**Evidence.** runs/corealm/screenshots/eq-05-worn-panel-zoom.png: the player is wearing the full Wightshroud magic kit and the mainHand cell shows a blue SWORD glyph for the Cairnpine Staff. eq-06-worn-tooltip-cairnpine-staff.png confirms the tooltip on that same cell reads "Cairnpine Staff, Tier 10, Magic power +20, Attack speed 3.0 s". 18 of 57 items are mis-shaped: 6 staffs and 3 daggers drawn as swords, 3 foci drawn as shields, 6 pendants/charms drawn as rings.

**Fix.** Add a shape override table keyed by item id pattern in itemIcons.ts before the slot fallback: `/_staff$/ -> "staff"`, `/_dagger$/ -> "dagger"`, `/_focus$/ -> "orb"`, `/_pendant$|_charm$/ -> "amulet"`. Four new entries in `PATHS`. Cheap, and it makes the Worn panel readable at a glance instead of five identical blue plates.

### 6. [medium/confirmed] Zero test coverage on the entire equipment system, and `KITS` was exported for a test that was never written

`game/src/content/equipment.ts:523`

**Root cause.** `KITS` carries a comment saying it is "exported so a test can re-check the totals in the header comment without re-deriving them by hand". `grep -rn KITS --include=*.ts` finds exactly one hit — its own declaration. The three test files (tests/formulas.test.ts, tests/paths.test.ts, tests/xp.test.ts) contain zero occurrences of the string "equip".

**Evidence.** `grep -rn "equip" --include=*.test.ts .` returns nothing. `npm test` is 25/25 green while a 57-row gear ladder whose numbers are load-bearing for the PRD 2.3/2.4 damage and health tables is entirely unverified. My live sweep found the numbers correct, but nothing in CI would catch a regression.

**Fix.** Add tests/equipment.test.ts asserting the six `KITS` sum to the totals stated in the equipment.ts header (accuracy 11/23/42, armour 16/33/58, vitality 6/14/16, magicPower 6/14/32) and that `computeMaxHealth` on the tier-1/5/10 melee kits at the PRD's levels yields 41/58/75. That is the test the export was written for.

### 7. [low/confirmed] `refreshMaxHealth` is implemented twice, in two systems, with the same derivation

`game/src/systems/equipment.ts:158`

**Root cause.** `HealthSystem.refreshMaxHealth` (health.ts:74) already recomputes the cap and clamps every single tick, precisely so "no caller has to remember to refresh after a level-up, an equip, or a load" (its own comment). `EquipmentSystem.refreshMaxHealth` duplicates that logic and is called on every equip (line 110) and unequip (line 140), each of which also calls `store.markDirty()` a second time.

**Evidence.** Both call `computeMaxHealth(state, equipment.totals().vitality)` and both clamp `player.health`. Measured behaviour is identical either way: equipping kaldite_plate raised maxHealth 140 -> 145; unequipping it at full health dropped 145 -> 140 and clamped health to 140. The health system alone would have produced that within one tick.

**Fix.** Delete `EquipmentSystem.refreshMaxHealth` and the two calls at equipment.ts:110 and :140. Keep the health system as the single owner of the cap. If the one-tick lag before the Equipment panel's Vitality row updates matters, have equipment call `deps.health.refreshMaxHealth(state)` through a port instead of re-deriving.

### 8. [low/likely] `getEquipment()` silently reports all-zero bonuses when the equipment hook is missing

`game/src/api/gameApi.ts:155`

**Root cause.** The no-hook fallback returns the real worn `slots` from the store but pairs them with `emptyBonuses()`. A caller sees nine occupied slots and +0 across the board — an internally contradictory view rather than an error.

**Evidence.** Never triggers today (boot always wires the hook, and my sweep read correct totals throughout), but the inventory fallback two functions up at gameApi.ts:143 degrades honestly while this one fabricates a plausible wrong answer. The Equipment panel would render "9 of 9 slots worn" with every total at 0.

**Fix.** Either return `err("UNAVAILABLE")`-equivalent empty slots too, so the view is self-consistent, or compute the totals inline from `content.item(id).equip.bonuses` — it is a seven-field sum over nine slots and needs no system.

## Recommendations

1. Fix the skeleton rebind first, before adding any new slot. In `characterRig.ts attachOutfit()` (line 119-131), grab the body's Skeleton once in `build()` after `cloneSkinned`, then for each SkinnedMesh inside the cloned outfit call `mesh.bind(bodySkeleton, mesh.bindMatrix)` and reparent it under the body armature; drop the piece's duplicate bone tree. This alone removes the floating chest bar and the detached boots that are visible today at spawn, and it is a prerequisite for every other slot.

2. Add `GEAR_APPEARANCE` to `content/equipment.ts` (or a new `content/appearance.ts`): `Record<ItemId, { assetId: string; tint?: number; scale?: number }>` over all 57 ids. Do NOT touch `contracts.ts` — ItemDef is frozen and has no asset field. Two visual sets carry the whole ladder: melee -> outfit_male_ranger_{chest,legs,boots,gloves,hood}, magic -> outfit_male_peasant_{chest,legs,boots,gloves} + outfit_male_ranger_hood. Add outfit_male_ranger_pauldron to tier 5 and 10 body pieces so the silhouette grows with tier.

3. Generalise the rig: replace `setMainHand`/`setHead` with `setSlot(slot: EquipSlot, object: THREE.Object3D | null)` plus `async equipSlotAsset(slot, assetId | null)`. Route `head`/`mainHand`/`offHand` to bone attachment (`Head`, `hand_r`, `hand_l` — all three confirmed present in base_male.glb) and `body`/`legs`/`feet`/`hands` to the rebound-skinned path. Drive the whole thing off `VISIBLE_SLOTS` (characterRig.ts:279) so adding a slot is one array edit.

4. Wire it in `loop.ts syncPlayerRig` (line 217): cache a signature of `api.getEquipment().slots` and, on change, call `rig.equipSlotAsset(slot, equippedAssetId(stack, id => GEAR_APPEARANCE[id]?.assetId))` for each slot in VISIBLE_SLOTS. `equippedAssetId` at characterRig.ts:281 already has exactly this signature and currently has zero callers. Alternatively subscribe to `item.equipped`/`item.unequipped` in boot.ts — but the per-frame diff also covers save-load and reset, which the events do not.

5. Make tier read through material, not geometry. The four weapon GLBs are tagged `recolour` with materials named `*_Bronze`/`*_Wooden`. Add a `MaterialLibrary` override in `render/materials.ts` for three metal tints — Grithe dull grey, Corven dark oiled, Kaldite black with a garnet accent — and apply the tint from `GEAR_APPEARANCE` when attaching. Combined with `tierSilhouetteScale` this gives 57 items three readable looks for the cost of 3 materials.

6. Decide the staff question explicitly. There is no staff, dagger or bow mesh in the 213-asset library. Daggers can be `weapon/sword.glb` at scale 0.65 and foci can be `weapon/shield.glb` at 0.4, both of which read correctly. Staffs have no honest proxy — either add one asset or leave the 6 staff items empty-handed and log it, but do not put a sword in a mage's hand.

7. Fix `ui/itemIcons.ts:94`: add an id-pattern override table ahead of the slot fallback for `_staff$`, `_dagger$`, `_focus$`, `_pendant$|_charm$`, with four new `PATHS` entries. Today 18 of 57 items draw the wrong silhouette, including a sword glyph for the Cairnpine Staff in the Worn panel.

8. Write tests/equipment.test.ts against the exported `KITS` (equipment.ts:523), which was declared for exactly this and has never been imported. Assert the six kit totals from the file header (accuracy 11/23/42, armour 16/33/58, vitality 6/14/16, magicPower 6/14/32) and `computeMaxHealth` = 41/58/75 at the PRD's level pairs. Equipment currently has zero test coverage.

9. Delete `EquipmentSystem.refreshMaxHealth` (equipment.ts:158) and its two call sites at lines 110 and 140. `HealthSystem.refreshMaxHealth` (health.ts:74) already runs the same derivation every tick and its comment says it exists so no caller has to remember.

## Files to edit

- game/src/render/characterRig.ts
- game/src/app/loop.ts
- game/src/app/boot.ts
- game/src/content/equipment.ts
- game/src/ui/itemIcons.ts
- game/src/systems/equipment.ts
- game/src/api/gameApi.ts
- game/src/render/materials.ts
