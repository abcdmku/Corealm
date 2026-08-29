# -*- coding: utf-8 -*-
import io
p = 'game/src/render/entityViews.ts'
s = io.open(p, encoding='utf-8').read()

old = """    const rigged = group.liveParts.length === 0 || this.isRigged(view.assetId);
    const ready = rigged && this.characterReady(view.assetId, character);
    const source = ready ? this.sourceOf(view.assetId) : null;
    const named = entity.archetype === "npc" || entity.archetype === "boss";
    let unique: THREE.Object3D | null = null;
    let dressed: DressedCharacter | null = null;
    let rig: RigState | null = null;
    let uniqueMeshes = 0;
    let uniqueCost = 0;

    if (source && this.canAffordUnique(entity.archetype, view.assetId, source, character)) {
      dressed = character ? this.assembleCharacter(character) : null;
      unique = dressed ? dressed.group : cloneRigged(source);
      uniqueMeshes = dressed ? dressed.drawCalls : this.meshesIn(view.assetId, source);
      uniqueCost = uniqueMeshes * 2;
      unique.userData.entityId = entity.id;
      unique.traverse((child) => {
        child.userData.entityId = entity.id;
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Characters ground themselves with their own shadow. It is the second draw the budget
        // above is counting, and a floating shadowless NPC reads as unfinished on its own.
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Keep the authored material, so a live -> dead -> respawned entity re-derives its look
        // from the ART rather than from its own previous variant. Compounding variants is how a
        // node that respawns after being mined comes back permanently grey.
        mesh.userData.baseMaterial = mesh.material;
      });
      this.group.add(unique);
      this.spend(named, uniqueCost);
      rig = this.attachRig(entity, dressed?.animationRoot ?? unique, view.assetId);
    }

    const slot = unique ? -1 : this.takeSlot(group, entity.id);
    if (!unique && slot < 0) {
      dressed?.dispose();
      return null;
    }

    const record: ViewRecord = {
      entityId: entity.id,
      archetype: entity.archetype,
      groupKey,
      slot,
      unique,
      dressed,
      rig,
      uniqueMeshes,
      uniqueCost,
      named,
      // A rigged entity built before its skeleton source arrived is re-acquired on the next sync.
      awaitingRig: rigged && !ready,
      signature: "",
      position: new THREE.Vector3(),
      target: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      previous: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      rotationY: view.rotationY ?? 0,
      targetRotationY: view.rotationY ?? 0,
      previousRotationY: view.rotationY ?? 0,
      movingTicks: 0,
      scale: 1,
      spent: false,
      normal: null,
      tilt: 0,
      labelHeight: view.labelHeight ?? 1.6,
      radius: this.minHighlightRadius,
    };
    this.records.set(entity.id, record);
    if (rig) {
      this.animated.add(record);
      this.bindRigEvents(record);
    }
    return record;
  }
"""

new = """    const rigged = group.liveParts.length === 0 || this.isRigged(view.assetId);
    const ready = rigged && this.characterReady(view.assetId, character);

    const record: ViewRecord = {
      entityId: entity.id,
      archetype: entity.archetype,
      groupKey,
      slot: -1,
      unique: null,
      dressed: null,
      rig: null,
      uniqueMeshes: 0,
      uniqueCost: 0,
      named: entity.archetype === "npc" || entity.archetype === "boss",
      // A rigged entity built before its skeleton source arrived is re-acquired on the next sync.
      awaitingRig: rigged && !ready,
      rigCandidate: rigged,
      signature: "",
      // Seeded from the entity rather than left at the origin: `buildUnique` allocates the rig pool
      // by distance from the camera, and a record reading (0,0,0) until `syncOne` writes it back
      // would be measured from the middle of the world.
      position: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      target: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      previous: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      rotationY: view.rotationY ?? 0,
      targetRotationY: view.rotationY ?? 0,
      previousRotationY: view.rotationY ?? 0,
      movingTicks: 0,
      scale: 1,
      spent: false,
      normal: null,
      tilt: 0,
      labelHeight: view.labelHeight ?? 1.6,
      radius: this.minHighlightRadius,
    };

    if (!ready || !this.buildUnique(record, group)) {
      const slot = this.takeSlot(group, entity.id);
      if (slot < 0) return null;
      record.slot = slot;
    }

    this.records.set(entity.id, record);
    if (rigged) this.rigCandidates.add(record);
    return record;
  }

  /**
   * Gives one record the non-instanced, mixer-driven copy of its character, if it can have one.
   *
   * Split out of `acquire` because `rebalanceUniques` needs the identical construction when a
   * character walks into range long after its group was built. Returns false and leaves the record
   * untouched when the source is not in, the budget is spent, or the entity is too far from the
   * camera to be worth a skeleton.
   */
  private buildUnique(record: ViewRecord, group: InstanceGroup): boolean {
    const assetId = group.assetId;
    const character = group.character;
    const source = this.sourceOf(assetId);
    if (!source) return false;
    if (!this.canAffordUnique(record.archetype, assetId, source, character, record.position)) {
      return false;
    }

    const dressed = character ? this.assembleCharacter(character) : null;
    const unique = dressed ? dressed.group : cloneRigged(source);
    const uniqueMeshes = dressed ? dressed.drawCalls : this.meshesIn(assetId, source);
    const entityId = record.entityId;
    unique.userData.entityId = entityId;
    unique.traverse((child) => {
      child.userData.entityId = entityId;
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Characters ground themselves with their own shadow. It is the second draw the budget is
      // counting, and a floating shadowless NPC reads as unfinished on its own.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Keep the authored material, so a live -> dead -> respawned entity re-derives its look
      // from the ART rather than from its own previous variant. Compounding variants is how a
      // node that respawns after being mined comes back permanently grey.
      mesh.userData.baseMaterial = mesh.material;
    });
    this.group.add(unique);

    record.unique = unique;
    record.dressed = dressed;
    record.uniqueMeshes = uniqueMeshes;
    record.uniqueCost = uniqueMeshes * 2;
    record.awaitingRig = false;
    this.spend(record.named, record.uniqueCost);

    record.rig = this.attachRig(entityId, dressed?.animationRoot ?? unique, assetId);
    if (record.rig) {
      this.animated.add(record);
      this.bindRigEvents(record);
    }
    return true;
  }

  /**
   * Moves the rig pools to whoever is standing in front of the camera, once per frame.
   *
   * Demote first, then promote, and in that order for a reason: the pool is what gates promotion,
   * so walking from Coldbrace to Highcairn can only light up Highcairn NPCs after the four in
   * Coldbrace have handed their 48 draw calls back. Both halves are no-ops until `update` has been
   * given a camera position, which is what makes the boot-time first sync behave as it always did.
   *
   * A demoted character does NOT vanish for the quarter second until the next `sync`: it takes an
   * instance slot in the same pass and is written into its group baked pose immediately.
   */
  private rebalanceUniques(): void {
    const viewer = this.viewer;
    if (!viewer || this.rigCandidates.size === 0) return;
    let changed = false;

    for (const record of this.rigCandidates) {
      // The boss is exempt in both directions. There is one of them, the fight is the climax of its
      // region, and an instanced boss is a rig frozen on one baked frame through a two-phase fight.
      if (!record.unique || record.archetype === "boss") continue;
      if (record.position.distanceToSquared(viewer) <= this.uniqueReleaseRadiusSq) continue;
      const group = this.groups.get(record.groupKey);
      if (!group) continue;
      const slot = this.takeSlot(group, record.entityId);
      if (slot < 0) continue;
      this.releaseUnique(record);
      record.slot = slot;
      this.writeSlot(group, record);
      group.dirty = true;
      changed = true;
    }

    for (const record of this.rigCandidates) {
      if (record.unique || record.slot < 0) continue;
      if (record.position.distanceToSquared(viewer) > this.animationRadiusSq) continue;
      const group = this.groups.get(record.groupKey);
      if (!group || !this.characterReady(group.assetId, group.character)) continue;
      const slot = record.slot;
      if (!this.buildUnique(record, group)) continue;
      this.freeSlot(group, record.entityId, slot);
      record.slot = -1;
      this.placeUnique(record);
      this.applyUniqueState(record, group.tier);
      this.setMotion(record, record.spent ? "death" : record.movingTicks > 0 ? "walk" : "idle");
      changed = true;
    }

    if (changed) this.flush();
  }
"""

assert old in s, 'acquire body not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
