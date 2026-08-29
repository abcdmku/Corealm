# -*- coding: utf-8 -*-
import io
p = 'game/src/render/entityViews.ts'
s = io.open(p, encoding='utf-8').read()

old = """  private release(record: ViewRecord): void {
    if (record.rig) {
      record.rig.action.stop();
      record.rig.mixer.stopAllAction();
      record.rig.mixer.uncacheRoot(record.rig.root);
      this.animated.delete(record);
      record.rig = null;
    }
    if (record.unique) {
      record.unique.removeFromParent();
      // `DressedCharacter.dispose` frees the head-cap and merged geometries this assembly allocated
      // and nothing else owns. The source geometries and materials are shared with the loaded asset
      // and are deliberately left alone.
      record.dressed?.dispose();
      record.dressed = null;
      record.unique = null;
      this.refund(record.named, record.uniqueCost);
      record.uniqueCost = 0;
      record.uniqueMeshes = 0;
      return;
    }
    const group = this.groups.get(record.groupKey);
    if (!group || record.slot < 0) return;
    group.slots[record.slot] = null;
    group.free.push(record.slot);
    for (const mesh of group.live) mesh.setMatrixAt(record.slot, HIDDEN);
    for (const mesh of group.spent) mesh.setMatrixAt(record.slot, HIDDEN);
    for (const mesh of group.moving) mesh.setMatrixAt(record.slot, HIDDEN);
    group.dirty = true;
  }
"""

new = """  private release(record: ViewRecord): void {
    this.rigCandidates.delete(record);
    if (record.unique) {
      this.releaseUnique(record);
      return;
    }
    const group = this.groups.get(record.groupKey);
    if (!group || record.slot < 0) return;
    this.freeSlot(group, record.entityId, record.slot);
    record.slot = -1;
  }

  /**
   * Tears down one non-instanced character: mixer, scene node, owned geometry, pooled draw calls.
   *
   * Separate from `release` because `rebalanceUniques` demotes a character to its instanced pose
   * without the record going away, and that path must not drop the record out of `rigCandidates`
   * (it is exactly the record that has to be promoted again when the player walks back).
   */
  private releaseUnique(record: ViewRecord): void {
    if (record.rig) {
      record.rig.action.stop();
      record.rig.mixer.stopAllAction();
      record.rig.mixer.uncacheRoot(record.rig.root);
      this.animated.delete(record);
      record.rig = null;
    }
    if (!record.unique) return;
    record.unique.removeFromParent();
    // `DressedCharacter.dispose` frees the head-cap and merged geometries this assembly allocated
    // and nothing else owns. The source geometries and materials are shared with the loaded asset
    // and are deliberately left alone.
    record.dressed?.dispose();
    record.dressed = null;
    record.unique = null;
    this.refund(record.named, record.uniqueCost);
    record.uniqueCost = 0;
    record.uniqueMeshes = 0;
  }

  /** Hands one instance slot back to its group and hides it in every pose variant. */
  private freeSlot(group: InstanceGroup, entityId: EntityId, slot: number): void {
    if (slot < 0 || group.slots[slot] !== entityId) return;
    group.slots[slot] = null;
    group.free.push(slot);
    for (const mesh of group.live) mesh.setMatrixAt(slot, HIDDEN);
    for (const mesh of group.spent) mesh.setMatrixAt(slot, HIDDEN);
    for (const mesh of group.moving) mesh.setMatrixAt(slot, HIDDEN);
    group.dirty = true;
  }
"""

assert old in s, 'release body not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
