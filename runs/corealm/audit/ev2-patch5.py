# -*- coding: utf-8 -*-
import io
p = 'game/src/render/entityViews.ts'
s = io.open(p, encoding='utf-8').read()

old = """  private countUnique(): number {
    let count = 0;
    for (const record of this.records.values()) if (record.unique) count += 1;
    return count;
  }
"""
new = """  /**
   * Kept as a counter rather than a walk of `this.records`.
   *
   * `canAffordUnique` asks for it, and `rebalanceUniques` asks `canAffordUnique` once per character
   * record per frame. Walking 1,203 records inside a loop over 62 candidates is 75,000 property
   * reads a frame to answer a question the layer already knows the answer to.
   */
  private countUnique(): number {
    return this.uniqueViewCount;
  }
"""
assert old in s, 'countUnique not found'
s = s.replace(old, new, 1)

old = """  private uniqueDrawCalls = 0;
  private namedDrawCalls = 0;
  private otherDrawCalls = 0;
"""
new = """  private uniqueDrawCalls = 0;
  private namedDrawCalls = 0;
  private otherDrawCalls = 0;
  /** Records currently holding a non-instanced object. See `countUnique`. */
  private uniqueViewCount = 0;
"""
assert old in s, 'counter anchor not found'
s = s.replace(old, new, 1)

old = """    record.awaitingRig = false;
    this.spend(record.named, record.uniqueCost);
"""
new = """    record.awaitingRig = false;
    this.uniqueViewCount += 1;
    this.spend(record.named, record.uniqueCost);
"""
assert old in s, 'buildUnique spend not found'
s = s.replace(old, new, 1)

old = """    if (!record.unique) return;
    record.unique.removeFromParent();"""
new = """    if (!record.unique) return;
    this.uniqueViewCount = Math.max(0, this.uniqueViewCount - 1);
    record.unique.removeFromParent();"""
assert old in s, 'releaseUnique body not found'
s = s.replace(old, new, 1)

old = """    this.uniqueDrawCalls = 0;
    this.namedDrawCalls = 0;
    this.otherDrawCalls = 0;
    for (const geometry of this.seamGeometries.values()) geometry.dispose();"""
new = """    this.uniqueDrawCalls = 0;
    this.namedDrawCalls = 0;
    this.otherDrawCalls = 0;
    this.uniqueViewCount = 0;
    for (const geometry of this.seamGeometries.values()) geometry.dispose();"""
assert old in s, 'dispose counters not found'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
