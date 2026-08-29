# -*- coding: utf-8 -*-
import io
p = 'game/src/render/entityViews.ts'
s = io.open(p, encoding='utf-8').read()

old = """  stats(): EntityViewStats {
    let instancedMeshes = 0;
    let triangles = 0;
    let bakedPoses = 0;
    let dressedGroups = 0;
    for (const group of this.groups.values()) {
      instancedMeshes += group.live.length + group.spent.length + group.moving.length;
      if (group.posed) bakedPoses += 1;
      if (group.character) dressedGroups += 1;
      const active = group.slots.filter((slot) => slot !== null).length;
      for (const part of group.liveParts) triangles += part.triangles * active;
    }

    let unique = 0;
    let uniqueMeshes = 0;
    let uniqueTriangles = 0;
    let dressedCharacters = 0;
    let movingViews = 0;
    for (const record of this.records.values()) {
      if (record.movingTicks > 0) movingViews += 1;
      if (!record.unique) continue;
      unique += 1;
      if (record.dressed) dressedCharacters += 1;
      uniqueMeshes += record.uniqueMeshes;
      record.unique.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) uniqueTriangles += triangleCount(mesh.geometry);
      });
    }

    return {
      entities: this.records.size,
      groups: this.groups.size,
      instancedMeshes,
      uniqueViews: unique,
      riggedViews: this.animated.size,
      animatedLastFrame: this.animatedLastFrame,
      bakedPoses,
      highlights: this.highlights.size,
      // Counted, not guessed, and with the shadow pass in it. Every instanced entity mesh and every
      // unique character mesh casts, so each is two submitted draws; highlights are unlit overlays
      // and are not, so a ring plus a pip is two.
      estimatedDrawCalls: instancedMeshes * 2 + uniqueMeshes * 2 + this.highlights.size * 2,"""

new = """  stats(): EntityViewStats {
    // Which pose variant each group actually has something in. A group whose entities all took a
    // non-instanced rig keeps a full set of `InstancedMesh`es at `count` 0, and an unused spent or
    // walk variant is the same: allocated, never submitted. Charging for them is what put 636 on a
    // report next to a renderer reading 321.
    const occupied = new Map<string, { live: boolean; spent: boolean; moving: boolean }>();
    for (const record of this.records.values()) {
      if (record.slot < 0) continue;
      const group = this.groups.get(record.groupKey);
      if (!group) continue;
      const flags = occupied.get(group.key) ?? { live: false, spent: false, moving: false };
      const moving = record.movingTicks > 0 && !record.spent;
      if (record.spent && group.spent.length > 0) flags.spent = true;
      else if (moving && group.moving.length > 0) flags.moving = true;
      else flags.live = true;
      occupied.set(group.key, flags);
    }

    let instancedMeshes = 0;
    let drawnInstancedMeshes = 0;
    let triangles = 0;
    let bakedPoses = 0;
    let dressedGroups = 0;
    for (const group of this.groups.values()) {
      instancedMeshes += group.live.length + group.spent.length + group.moving.length;
      const flags = occupied.get(group.key);
      if (flags) {
        if (flags.live) drawnInstancedMeshes += group.live.length;
        if (flags.spent) drawnInstancedMeshes += group.spent.length;
        if (flags.moving) drawnInstancedMeshes += group.moving.length;
      }
      if (group.posed) bakedPoses += 1;
      if (group.character) dressedGroups += 1;
      const active = group.slots.filter((slot) => slot !== null).length;
      for (const part of group.liveParts) triangles += part.triangles * active;
    }

    let unique = 0;
    let uniqueMeshes = 0;
    let uniqueTriangles = 0;
    let dressedCharacters = 0;
    let movingViews = 0;
    for (const record of this.records.values()) {
      if (record.movingTicks > 0) movingViews += 1;
      if (!record.unique) continue;
      unique += 1;
      if (record.dressed) dressedCharacters += 1;
      uniqueMeshes += record.uniqueMeshes;
      record.unique.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) uniqueTriangles += triangleCount(mesh.geometry);
      });
    }

    return {
      entities: this.records.size,
      groups: this.groups.size,
      instancedMeshes,
      drawnInstancedMeshes,
      uniqueViews: unique,
      riggedViews: this.animated.size,
      animatedLastFrame: this.animatedLastFrame,
      bakedPoses,
      highlights: this.highlights.size,
      // Counted, not guessed, and with the shadow pass in it. Every instanced entity mesh and every
      // unique character mesh casts, so each is two submitted draws; highlights are unlit overlays
      // and are not, so a ring plus a pip is two. World-wide and unculled — see the field doc.
      estimatedDrawCalls: drawnInstancedMeshes * 2 + uniqueMeshes * 2 + this.highlights.size * 2,"""

assert old in s, 'stats body not found'
s = s.replace(old, new, 1)

old = """    for (const record of this.records.values()) this.release(record);
    this.group.clear();
    this.groups.clear();
    this.records.clear();
    this.animated.clear();"""
new = """    for (const record of this.records.values()) this.release(record);
    this.group.clear();
    this.groups.clear();
    this.records.clear();
    this.animated.clear();
    this.rigCandidates.clear();
    this.viewer = null;"""
assert old in s, 'dispose body not found'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
