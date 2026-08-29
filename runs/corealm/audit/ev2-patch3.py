# -*- coding: utf-8 -*-
import io
p = 'game/src/render/entityViews.ts'
s = io.open(p, encoding='utf-8').read()

# --- canAffordUnique: distance gate -----------------------------------------
old = """  private canAffordUnique(
    archetype: Archetype,
    assetId: string,
    source: THREE.Object3D,
    character: CharacterSpec | null,
  ): boolean {
    const cost = this.uniqueCostOf(assetId, source, character);
    if (cost === 0) return false;

    // A boss is never instanced. There is one of them, the fight is the climax of its region, and
    // the instanced fallback freezes a rig on a single baked idle frame — which is why Ordrun
    // stood through a two-phase fight in a pose that read as a bug. Twenty draw calls against a
    // budget with eighty to spare at the worst dungeon pose is the right trade.
    if (archetype === "boss") return true;
    if (this.countUnique() >= this.maxUniqueViews) return false;
"""
new = """  private canAffordUnique(
    archetype: Archetype,
    assetId: string,
    source: THREE.Object3D,
    character: CharacterSpec | null,
    position: THREE.Vector3,
  ): boolean {
    const cost = this.uniqueCostOf(assetId, source, character);
    if (cost === 0) return false;

    // A boss is never instanced. There is one of them, the fight is the climax of its region, and
    // the instanced fallback freezes a rig on a single baked idle frame — which is why Ordrun
    // stood through a two-phase fight in a pose that read as a bug. Twenty draw calls against a
    // budget with eighty to spare at the worst dungeon pose is the right trade.
    if (archetype === "boss") return true;
    if (this.countUnique() >= this.maxUniqueViews) return false;
    // Distance before budget. Both pools used to be spent first-come in entity order, which is
    // region order, so the four Coldbrace NPCs took the whole named pool and rill_skitterlings_1..3
    // took the whole other pool — measured, four of the world's fifty enemies, and none of them
    // necessarily anywhere near the player. See `UNIQUE_RELEASE_FACTOR`.
    if (this.viewer && position.distanceToSquared(this.viewer) > this.animationRadiusSq) return false;
"""
assert old in s, 'canAffordUnique head not found'
s = s.replace(old, new, 1)

# --- attachRig takes an id ---------------------------------------------------
old = """  private attachRig(entity: SemanticEntity, root: THREE.Object3D, assetId: string): RigState | null {
    const rng = new Rng(hashString(entity.id));
    const clip = this.firstFittingClip(assetId, this.clipCandidates(assetId, entity.id, "idle"), root);"""
new = """  private attachRig(entityId: EntityId, root: THREE.Object3D, assetId: string): RigState | null {
    const rng = new Rng(hashString(entityId));
    const clip = this.firstFittingClip(assetId, this.clipCandidates(assetId, entityId, "idle"), root);"""
assert old in s, 'attachRig head not found'
s = s.replace(old, new, 1)

# --- update(): record the viewer and rebalance -------------------------------
old = """  update(deltaSeconds: number, viewer?: THREE.Vector3): void {
    this.animatedLastFrame = 0;
    if (this.animated.size === 0) return;
"""
new = """  update(deltaSeconds: number, viewer?: THREE.Vector3): void {
    this.animatedLastFrame = 0;
    if (viewer) {
      this.viewer = (this.viewer ?? new THREE.Vector3()).copy(viewer);
      // Before the tick, not after: a character promoted this frame should be ticked this frame,
      // or it renders one frame of its baked pose at the exact moment the player walks up to it.
      this.rebalanceUniques();
    }
    if (this.animated.size === 0) return;
"""
assert old in s, 'update head not found'
s = s.replace(old, new, 1)

# --- syncMotion doc correction ----------------------------------------------
old = """   * OPT-IN and currently uncalled; `app/loop.ts` owns the decision to call it. `sync` runs at 4 Hz
   * (loop.ts:266 returns early until 250 ms have passed) while `EnemyAI.stepToward` writes a
   * position every 100 ms sim tick, so three of every four enemy movement steps are invisible and
   * the fourth is a 40 cm jump. This closes that: pass the same entity list every render frame plus
   * `alpha = accumulator / SIM_TICK_MS`, and a moving entity is drawn between the last two ticks
   * instead of at the last one."""
new = """   * CORRECTION: this said "OPT-IN and currently uncalled". `app/loop.ts:381` now calls it every
   * render frame with `this.renderAlpha`, and that is what the numbers below are measured against.
   * `sync` runs at 4 Hz (loop.ts:266 returns early until 250 ms have passed) while
   * `EnemyAI.stepToward` writes a position every 100 ms sim tick, so three of every four enemy
   * movement steps used to be invisible and the fourth a 40 cm jump. A moving entity is now drawn
   * between the last two ticks instead of at the last one."""
assert old in s, 'syncMotion doc not found'
s = s.replace(old, new, 1)

# --- playAction doc correction ----------------------------------------------
old = """   * OPT-IN and currently uncalled. `app/loop.ts` already drains `CombatSystem.consumeHits()` for the
   * floating damage numbers; feeding the same stream in here is what makes an enemy react to being
   * hit. Returns false when the entity has no live mixer, which is the common case — an instanced
   * character cannot play a one-shot at all, and pretending otherwise would make the caller think
   * it worked."""
new = """   * CORRECTION: this said "OPT-IN and currently uncalled". `app/loop.ts:493` calls it with
   * `("attack")` on the swinger and `:497` with `("hit")` on whatever it landed on, both off the
   * `CombatSystem.consumeHits()` stream that already drives the floating damage numbers. Verified
   * live against rill_skitterlings_1 (runs/corealm/audit/ev2-combat.ts): `getDrawnBounds` reports
   * `animated:Idle` at rest, `animated:HitRecieve` within 700 ms of the first swing and
   * `animated:Death` once it dies.
   *
   * Returns false when the entity has no live mixer. Before the rig pools were allocated by camera
   * distance that was the answer for 46 of the world's 50 enemies whatever you did to them; it is
   * now the answer only for enemies further away than `animationRadius`, which cannot be the one
   * you are fighting. An instanced character cannot play a one-shot at all, and pretending
   * otherwise would make the caller think it worked."""
assert old in s, 'playAction doc not found'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
