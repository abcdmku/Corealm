# -*- coding: utf-8 -*-
import io
p = 'game/src/render/entityViews.ts'
s = io.open(p, encoding='utf-8').read()

old = """const UNIQUE_RELEASE_FACTOR = 1.75;
"""
new = """const UNIQUE_RELEASE_FACTOR = 1.75;

/**
 * Characters promoted from their instanced pose to a live rig per frame.
 *
 * One, because promoting a dressed NPC runs `assembleDressedCharacter` — a head cap cut out of the
 * body mesh, four to six outfit parts rebound to its bones, and a merge — and doing five of those in
 * the frame the player crosses into a settlement is one visible hitch instead of five invisible
 * ones. A settlement roster lights up over five frames, which at 60 fps is 83 ms.
 *
 * Demotion is deliberately NOT capped: it is a dispose, it is what frees the pool, and a promotion
 * that has to wait a frame for its budget is a character that stands still for a frame.
 */
const UNIQUE_PROMOTIONS_PER_FRAME = 1;
"""
assert old in s
s = s.replace(old, new, 1)

old = """    for (const record of this.rigCandidates) {
      if (record.unique || record.slot < 0) continue;
      if (record.position.distanceToSquared(viewer) > this.animationRadiusSq) continue;
      const group = this.groups.get(record.groupKey);
      if (!group || !this.characterReady(group.assetId, group.character)) continue;
      const slot = record.slot;
      if (!this.buildUnique(record, group)) continue;"""
new = """    let promoted = 0;
    for (const record of this.rigCandidates) {
      if (promoted >= UNIQUE_PROMOTIONS_PER_FRAME) break;
      if (record.unique || record.slot < 0) continue;
      if (record.position.distanceToSquared(viewer) > this.animationRadiusSq) continue;
      const group = this.groups.get(record.groupKey);
      if (!group || !this.characterReady(group.assetId, group.character)) continue;
      const slot = record.slot;
      if (!this.buildUnique(record, group)) continue;
      promoted += 1;"""
assert old in s
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
