import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  mirrorAnimationClip,
  mirroredBoneName,
  applyHeadCap,
  assembleDressedCharacter,
  clipSkinnedGeometry,
  collectBones,
  collectSkinnedMeshes,
  createSkeletonCache,
  hairAssetFor,
  headCapHeightFor,
  mergeSkinnedMeshes,
  rebindSkinnedPart,
} from "../game/src/render/skinning.js";

/**
 * Unit tests for the shared skinned-mesh helper.
 *
 * These run headlessly: `three` imports cleanly under node (verified - the module is pure JS and
 * nothing here touches WebGLRenderer), and `SkeletonUtils.clone` is plain scene-graph work. So the
 * two things that were actually broken in the game - the bone-name remap and the skin-attribute
 * filter - are covered without a browser.
 *
 * The fixture is a miniature of the real asset layout: a five-joint chain standing in for the
 * library's 65, and two source rigs with the same joint names in the same order but DIFFERENT
 * boneInverses, which is the measured situation across base_male (rig ba5af210) and the male outfit
 * parts (rig 3c715354).
 */

const JOINTS = ["root", "pelvis", "spine_01", "neck_01", "Head"] as const;

function buildArmature(names: readonly string[], rise: number): { armature: THREE.Object3D; bones: THREE.Bone[] } {
  const armature = new THREE.Object3D();
  armature.name = "Armature";
  const bones: THREE.Bone[] = [];
  let parent: THREE.Object3D = armature;
  for (const [index, name] of names.entries()) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.y = index === 0 ? 0 : rise;
    parent.add(bone);
    bones.push(bone);
    parent = bone;
  }
  armature.updateMatrixWorld(true);
  return { armature, bones };
}

/** One axis-aligned triangle per height, indexed, with integer skinIndex and float skinWeight. */
function buildSkinnedGeometry(heights: readonly number[], boneCount: number): THREE.BufferGeometry {
  const positions = new Float32Array(heights.length * 9);
  const skinIndex = new Uint16Array(heights.length * 12);
  const skinWeight = new Float32Array(heights.length * 12);
  const indices: number[] = [];
  for (const [triangle, height] of heights.entries()) {
    const corners: Array<[number, number, number]> = [[0, height, 0], [1, height, 0], [0, height, 1]];
    for (const [corner, [x, y, z]] of corners.entries()) {
      const vertex = triangle * 3 + corner;
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;
      skinIndex[vertex * 4] = (triangle + corner) % boneCount;
      skinWeight[vertex * 4] = 1;
      indices.push(vertex);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  geometry.setIndex(indices);
  return geometry;
}

interface Fixture {
  root: THREE.Group;
  bones: THREE.Bone[];
  mesh: THREE.SkinnedMesh;
  boneInverses: THREE.Matrix4[];
}

/**
 * A loadable "asset": Group > Armature + SkinnedMesh, with explicit boneInverses.
 *
 * `rise` differentiates the rigs. Passing the boneInverses array explicitly matters: the Skeleton
 * constructor stores it by reference when the lengths match, which is what makes it usable as an
 * identity key for "same authored bind pose".
 */
function buildAsset(name: string, heights: readonly number[], rise: number, material?: THREE.Material): Fixture {
  const { armature, bones } = buildArmature(JOINTS, rise);
  const boneInverses = bones.map((bone) => bone.matrixWorld.clone().invert());
  const skeleton = new THREE.Skeleton(bones, boneInverses);
  const mesh = new THREE.SkinnedMesh(buildSkinnedGeometry(heights, bones.length), material ?? new THREE.MeshStandardMaterial());
  mesh.name = `${name}-mesh`;
  const root = new THREE.Group();
  root.name = name;
  root.add(armature);
  root.add(mesh);
  mesh.bind(skeleton, new THREE.Matrix4());
  root.updateMatrixWorld(true);
  return { root, bones, mesh, boneInverses };
}

describe("collectBones", () => {
  it("indexes every bone by name and keeps the first of a duplicate", () => {
    const host = buildAsset("host", [0, 1], 0.4);
    const bones = collectBones(host.root);
    expect([...bones.keys()].sort()).toEqual([...JOINTS].sort());
    expect(bones.get("Head")).toBe(host.bones[4]);

    // A second armature grafted on must not displace the host's bones.
    const stray = buildArmature(JOINTS, 0.9);
    host.root.add(stray.armature);
    expect(collectBones(host.root).get("Head")).toBe(host.bones[4]);
  });
});

describe("rebindSkinnedPart", () => {
  it("binds the part to the HOST's bones while keeping the PART's own boneInverses", () => {
    const host = buildAsset("host", [0, 1], 0.4);
    const part = buildAsset("part", [2, 3], 0.9);
    const clone = cloneSkinned(part.root);
    const clonedMesh = collectSkinnedMeshes(clone)[0];
    expect(clonedMesh).toBeDefined();
    const partInverses = clonedMesh?.skeleton.boneInverses;

    const target = host.mesh.parent;
    expect(target).toBe(host.root);
    const result = rebindSkinnedPart(clone, collectBones(host.root), host.root);

    expect(result.rejected).toBe(false);
    expect(result.bound).toBe(1);
    expect(result.missing).toEqual([]);
    const bound = result.meshes[0];
    expect(bound).toBeDefined();
    // Host Bone OBJECTS, by identity: this is what puts the part under the body's one mixer.
    expect(bound?.skeleton.bones).toEqual(host.bones);
    // ...and the part's own bind pose, also by identity.
    expect(bound?.skeleton.boneInverses).toBe(partInverses);
    expect(bound?.parent).toBe(host.root);
    expect(bound?.bindMode).toBe(THREE.AttachedBindMode);
  });

  it("discards the part's cloned armature instead of leaving orphan bones in the graph", () => {
    const host = buildAsset("host", [0, 1], 0.4);
    const part = buildAsset("part", [2, 3], 0.9);
    const clone = cloneSkinned(part.root);

    const result = rebindSkinnedPart(clone, collectBones(host.root), host.root);

    expect(result.discardedBones).toBe(JOINTS.length);
    expect(clone.children).toHaveLength(0);
    // The host graph gained one mesh and not one bone. Before this helper existed, layering three
    // outfit pieces on the player added 195 bones that nothing ever drove.
    expect(collectBones(host.root).size).toBe(JOINTS.length);
    expect(collectSkinnedMeshes(host.root)).toHaveLength(2);
  });

  it("reports a bone the host does not have and falls back to the part's own", () => {
    const host = buildAsset("host", [0], 0.4);
    const hostBones = collectBones(host.root);
    hostBones.delete("Head");
    const part = buildAsset("part", [2], 0.9);
    const clone = cloneSkinned(part.root);
    const clonedBones = collectBones(clone);

    const result = rebindSkinnedPart(clone, hostBones, host.root);

    expect(result.missing).toEqual(["Head"]);
    expect(result.bound).toBe(1);
    expect(result.rejected).toBe(false);
    expect(result.meshes[0]?.skeleton.bones[4]).toBe(clonedBones.get("Head"));
    expect(result.meshes[0]?.skeleton.bones[0]).toBe(host.bones[0]);
  });

  it("refuses the whole part under the reject policy, never half of it", () => {
    const host = buildAsset("host", [0], 0.4);
    const hostBones = collectBones(host.root);
    hostBones.delete("Head");
    const clone = cloneSkinned(buildAsset("part", [2], 0.9).root);

    const result = rebindSkinnedPart(clone, hostBones, host.root, { onMissingBone: "reject" });

    expect(result.rejected).toBe(true);
    expect(result.bound).toBe(0);
    expect(result.meshes).toEqual([]);
    expect(result.missing).toEqual(["Head"]);
    expect(collectSkinnedMeshes(host.root)).toHaveLength(1);
  });

  it("hands two parts cloned from one source the same Skeleton object via the cache", () => {
    const host = buildAsset("host", [0], 0.4);
    const part = buildAsset("part", [2], 0.9);
    const cache = createSkeletonCache();
    const bones = collectBones(host.root);

    const a = rebindSkinnedPart(cloneSkinned(part.root), bones, host.root, { skeletonCache: cache });
    const b = rebindSkinnedPart(cloneSkinned(part.root), bones, host.root, { skeletonCache: cache });

    expect(a.meshes[0]?.skeleton).toBe(b.meshes[0]?.skeleton);
    expect(cache.size).toBe(1);
  });

  it("shares one Skeleton across separately loaded parts that carry the same bind pose", () => {
    // outfit_male_peasant_chest.glb, _legs.glb and _boots.glb are three separate loads with three
    // separate boneInverses arrays, and the same authored rig (group 3c715354). Identity keying
    // alone would give them three skeletons and nothing would ever merge.
    const host = buildAsset("host", [0], 0.4);
    const chest = buildAsset("chest", [1.2], 0.9);
    const legs = buildAsset("legs", [0.6], 0.9);
    const boots = buildAsset("boots", [0.1], 0.9);
    const hood = buildAsset("hood", [1.7], 0.55); // a different rig
    expect(chest.boneInverses).not.toBe(legs.boneInverses);

    const cache = createSkeletonCache();
    const bones = collectBones(host.root);
    const bound = [chest, legs, boots, hood].map(
      (part) => rebindSkinnedPart(cloneSkinned(part.root), bones, host.root, { skeletonCache: cache }).meshes[0],
    );

    expect(bound[0]?.skeleton).toBe(bound[1]?.skeleton);
    expect(bound[0]?.skeleton).toBe(bound[2]?.skeleton);
    expect(bound[0]?.skeleton).not.toBe(bound[3]?.skeleton);
    expect(cache.size).toBe(2);
  });
});

describe("clipSkinnedGeometry", () => {
  it("keeps the triangles above the cut and filters the skin attributes with them", () => {
    const geometry = buildSkinnedGeometry([0, 1, 2, 3], 5);
    const clip = clipSkinnedGeometry(geometry, 1.5, "above");

    expect(clip.kind).toBe("clipped");
    if (clip.kind !== "clipped") return;
    expect(clip.totalTriangles).toBe(4);
    expect(clip.keptTriangles).toBe(2);

    const position = clip.geometry.getAttribute("position");
    const skinIndex = clip.geometry.getAttribute("skinIndex");
    const skinWeight = clip.geometry.getAttribute("skinWeight");
    expect(position.count).toBe(6);
    // Losing either of these renders the mesh in bind pose forever, which is the original bug.
    expect(skinIndex.count).toBe(6);
    expect(skinWeight.count).toBe(6);
    expect(skinIndex.array).toBeInstanceOf(Uint16Array);

    for (let vertex = 0; vertex < position.count; vertex += 1) {
      expect(position.getY(vertex)).toBeGreaterThanOrEqual(1.5);
    }
    // Triangles 2 and 3 carried skinIndex.x = (triangle + corner) % 5, so 2,3,4 then 3,4,0.
    expect([0, 1, 2, 3, 4, 5].map((v) => skinIndex.getX(v))).toEqual([2, 3, 4, 3, 4, 0]);
    expect(skinWeight.getX(0)).toBe(1);
    expect(clip.geometry.getIndex()?.count).toBe(6);
  });

  it("keeps positions in SOURCE space while testing the cut in bind space", () => {
    const geometry = buildSkinnedGeometry([0, 1, 2, 3], 5);
    const bindMatrix = new THREE.Matrix4().makeTranslation(0, 10, 0);

    // Without the bind matrix a cut at 11.5 keeps nothing; with it, the same two triangles survive.
    expect(clipSkinnedGeometry(geometry, 11.5, "above").kind).toBe("empty");
    const clip = clipSkinnedGeometry(geometry, 11.5, "above", bindMatrix);
    expect(clip.kind).toBe("clipped");
    if (clip.kind !== "clipped") return;
    expect(clip.keptTriangles).toBe(2);
    // Source space, not bind space: the geometry drops back into the same mesh unchanged otherwise.
    const position = clip.geometry.getAttribute("position");
    expect(position.getY(0)).toBe(2);
  });

  it("reports unchanged rather than handing back a geometry the caller does not own", () => {
    const geometry = buildSkinnedGeometry([2, 3], 5);
    expect(clipSkinnedGeometry(geometry, 1, "above").kind).toBe("unchanged");
    expect(clipSkinnedGeometry(geometry, 9, "above").kind).toBe("empty");
    expect(clipSkinnedGeometry(geometry, 9, "below").kind).toBe("unchanged");
  });

  it("clips below as the mirror of above", () => {
    const geometry = buildSkinnedGeometry([0, 1, 2, 3], 5);
    const clip = clipSkinnedGeometry(geometry, 1.5, "below");
    expect(clip.kind).toBe("clipped");
    if (clip.kind !== "clipped") return;
    expect(clip.keptTriangles).toBe(2);
    const position = clip.geometry.getAttribute("position");
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      expect(position.getY(vertex)).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("applyHeadCap", () => {
  it("cuts the body, drops what is wholly below and leaves the face meshes alone", () => {
    const body = buildAsset("base", [0, 1, 1.6, 1.7], 0.4);
    // A second mesh standing in for Eyes/Eyebrows: entirely above the cut, so untouched.
    const face = new THREE.SkinnedMesh(buildSkinnedGeometry([1.69, 1.72], 5), new THREE.MeshStandardMaterial());
    face.name = "Eyes";
    face.bind(body.mesh.skeleton, new THREE.Matrix4());
    body.root.add(face);
    // A third standing in for a mesh wholly below, e.g. a separate pair of feet.
    const feet = new THREE.SkinnedMesh(buildSkinnedGeometry([0.1, 0.2], 5), new THREE.MeshStandardMaterial());
    feet.name = "Feet";
    feet.bind(body.mesh.skeleton, new THREE.Matrix4());
    body.root.add(feet);

    const result = applyHeadCap(body.root, 1.55);

    expect(result.clipped).toEqual(["base-mesh"]);
    expect(result.kept).toEqual(["Eyes"]);
    expect(result.removed).toEqual(["Feet"]);
    expect(result.trianglesBefore).toBe(8);
    expect(result.trianglesAfter).toBe(4);
    expect(result.geometries).toHaveLength(1);
    expect(feet.parent).toBeNull();
  });

  it("uses the measured cut planes for the two base bodies", () => {
    expect(headCapHeightFor("base_male")).toBe(1.55);
    expect(headCapHeightFor("base_female")).toBe(1.5);
    expect(headCapHeightFor("enemy_crab")).toBeNull();
  });
});

describe("mergeSkinnedMeshes", () => {
  it("merges same-material meshes on one skeleton and offsets their indices", () => {
    const material = new THREE.MeshStandardMaterial();
    const host = buildAsset("host", [0, 1], 0.4, material);
    const second = new THREE.SkinnedMesh(buildSkinnedGeometry([2, 3], 5), material);
    second.name = "second";
    second.bind(host.mesh.skeleton, new THREE.Matrix4());
    host.root.add(second);

    const result = mergeSkinnedMeshes(collectSkinnedMeshes(host.root));

    expect(result.drawCallsBefore).toBe(2);
    expect(result.drawCallsAfter).toBe(1);
    const merged = result.meshes[0];
    expect(merged).toBeDefined();
    expect(merged?.geometry.getAttribute("position").count).toBe(12);
    expect(merged?.geometry.getIndex()?.count).toBe(12);
    // Second geometry's indices must be shifted by the first's vertex count or it draws itself.
    expect(merged?.geometry.getIndex()?.getX(6)).toBe(6);
    expect(merged?.skeleton).toBe(host.mesh.skeleton);
    expect(merged?.geometry.getAttribute("skinIndex").array).toBeInstanceOf(Uint16Array);
    expect(host.mesh.parent).toBeNull();
    expect(second.parent).toBeNull();
  });

  it("refuses to merge across materials, skeletons or attribute sets", () => {
    const material = new THREE.MeshStandardMaterial();
    const host = buildAsset("host", [0], 0.4, material);

    const otherMaterial = new THREE.SkinnedMesh(buildSkinnedGeometry([1], 5), new THREE.MeshStandardMaterial());
    otherMaterial.bind(host.mesh.skeleton, new THREE.Matrix4());

    const otherSkeleton = new THREE.SkinnedMesh(buildSkinnedGeometry([1], 5), material);
    otherSkeleton.bind(new THREE.Skeleton(host.bones, host.boneInverses.map((m) => m.clone())), new THREE.Matrix4());

    // Female_Peasant_Arms ships without COLOR_0 while Female_Peasant_Body ships with it; padding
    // the difference would change how a vertex-colour material shades.
    const otherAttributes = new THREE.SkinnedMesh(buildSkinnedGeometry([1], 5), material);
    otherAttributes.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(9), 3));
    otherAttributes.bind(host.mesh.skeleton, new THREE.Matrix4());

    for (const other of [otherMaterial, otherSkeleton, otherAttributes]) {
      host.root.add(other);
      const result = mergeSkinnedMeshes([host.mesh, other]);
      expect(result.drawCallsAfter).toBe(2);
      other.removeFromParent();
    }
  });
});

describe("assembleDressedCharacter", () => {
  it("builds one skeleton, one animation root and one mesh list from a body plus parts", () => {
    const shared = new THREE.MeshStandardMaterial();
    const body = buildAsset("base_male", [0, 1, 1.6], 0.4, shared);
    const chest = buildAsset("outfit_male_peasant_chest", [1.2], 0.9, shared);
    const legs = buildAsset("outfit_male_peasant_legs", [0.6], 0.9, shared);

    const character = assembleDressedCharacter({
      bodyAssetId: "base_male",
      body: body.root,
      parts: [
        { assetId: "outfit_male_peasant_chest", source: chest.root },
        { assetId: "outfit_male_peasant_legs", source: legs.root },
      ],
      merge: false,
    });

    expect(character.rebinds.get("outfit_male_peasant_chest")?.bound).toBe(1);
    expect(character.rebinds.get("outfit_male_peasant_legs")?.missing).toEqual([]);
    expect(character.meshes).toHaveLength(3);
    expect(character.drawCalls).toBe(3);
    // One armature survives, and it is the body's - which is why one mixer on `animationRoot`
    // drives the clothes as well as the skin.
    expect(collectBones(character.group).size).toBe(JOINTS.length);
    expect(character.animationRoot.name).toBe("body");
    for (const mesh of character.meshes) {
      expect(mesh.skeleton.bones).toEqual([...character.bones.values()]);
    }
    // The source graphs must be untouched: they are the shared loaded assets.
    expect(collectSkinnedMeshes(chest.root)).toHaveLength(1);
    expect(collectBones(body.root).size).toBe(JOINTS.length);
  });

  it("head-caps the body and merges the shared-material parts into one draw", () => {
    const shared = new THREE.MeshStandardMaterial();
    const body = buildAsset("base_male", [0.2, 1.0, 1.6, 1.7], 0.4, shared);
    const outfit = buildAsset("outfit_male_peasant", [0.6, 1.2], 0.9, shared);

    const character = assembleDressedCharacter({
      bodyAssetId: "base_male",
      body: body.root,
      parts: [{ assetId: "outfit_male_peasant", source: outfit.root }],
      headCap: true,
    });

    expect(character.headCap?.trianglesBefore).toBe(4);
    expect(character.headCap?.trianglesAfter).toBe(2);
    // Body and outfit are on different rigs here (rise 0.4 vs 0.9), so they keep separate
    // boneInverses and stay two draws - exactly the base_male / male-outfit situation in the pack.
    expect(character.merged?.drawCallsBefore).toBe(2);
    expect(character.drawCalls).toBe(2);

    character.dispose();
    expect(character.group.children).toHaveLength(0);
  });

  it("merges body and parts into one draw when they share a rig, as the female set does", () => {
    const shared = new THREE.MeshStandardMaterial();
    const body = buildAsset("base_female", [0.2, 1.0], 0.4, shared);
    // Same rise means the same authored bind pose, i.e. base_female and its outfit parts.
    const outfit = buildAsset("outfit_female_peasant", [0.6, 1.2], 0.4, shared);

    const character = assembleDressedCharacter({
      bodyAssetId: "base_female",
      body: body.root,
      parts: [{ assetId: "outfit_female_peasant", source: outfit.root }],
    });

    expect(character.merged?.drawCallsBefore).toBe(2);
    expect(character.drawCalls).toBe(1);
    expect(character.meshes[0]?.geometry.getAttribute("position").count).toBe(12);
  });

  it("throws on a body with no skinned mesh rather than returning a bone-less group", () => {
    const empty = new THREE.Group();
    expect(() => assembleDressedCharacter({ bodyAssetId: "nothing", body: empty })).toThrow(/no SkinnedMesh/);
  });
});

describe("hairAssetFor", () => {
  it("is a pure function of the id, with no unseeded randomness", () => {
    const first = hairAssetFor("npc-harrow", "male");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(hairAssetFor("npc-harrow", "male")).toBe(first);
    }
    expect(["hair_short", "hair_buzzed"]).toContain(first);
    expect(["hair_long", "hair_buns"]).toContain(hairAssetFor("npc-ilse", "female"));
  });

  it("spreads across the available assets instead of always answering the same one", () => {
    const ids = Array.from({ length: 40 }, (_, index) => `npc-${index}`);
    expect(new Set(ids.map((id) => hairAssetFor(id, "male"))).size).toBe(2);
    expect(new Set(ids.map((id) => hairAssetFor(id, "female"))).size).toBe(2);
  });
});

/**
 * The clip mirror, which exists because the animation library's only cast is left-handed and staves
 * are main-hand items. See `mirrorAnimationClip` for the reflection maths and why it is exact here.
 */
describe("mirrorAnimationClip", () => {
  it("swaps paired bone names and leaves centre-line bones alone", () => {
    expect(mirroredBoneName("hand_l")).toBe("hand_r");
    expect(mirroredBoneName("index_01_r")).toBe("index_01_l");
    expect(mirroredBoneName("ball_leaf_r")).toBe("ball_leaf_l");
    expect(mirroredBoneName("spine_01")).toBeNull();
    expect(mirroredBoneName("Head")).toBeNull();
    // "_leaf" is not a side. A greedy contains-check would have mangled it.
    expect(mirroredBoneName("root")).toBeNull();
  });

  it("retargets tracks to the opposite bone", () => {
    const clip = new THREE.AnimationClip("Cast", 1, [
      new THREE.QuaternionKeyframeTrack("hand_l.quaternion", [0], [0, 0, 0, 1]),
      new THREE.VectorKeyframeTrack("spine_01.position", [0], [1, 2, 3]),
    ]);
    const mirrored = mirrorAnimationClip(clip, "Cast_Mirror");
    expect(mirrored.name).toBe("Cast_Mirror");
    expect(mirrored.tracks.map((t) => t.name).sort())
      .toEqual(["hand_r.quaternion", "spine_01.position"]);
  });

  it("reflects a rotation about Y and Z but not about X", () => {
    // The rule is (x, y, z, w) -> (x, -y, -z, w). Reflection reverses handedness, so a turn about an
    // axis IN the mirror plane reverses and a turn about the axis PERPENDICULAR to it does not.
    const about = (axis: THREE.Vector3): number[] => {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, 0.7);
      const clip = new THREE.AnimationClip("t", 1, [
        new THREE.QuaternionKeyframeTrack("hand_l.quaternion", [0], [q.x, q.y, q.z, q.w]),
      ]);
      return Array.from(mirrorAnimationClip(clip, "m").tracks[0]!.values);
    };
    const x = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7);
    expect(about(new THREE.Vector3(1, 0, 0))[0]).toBeCloseTo(x.x, 6);

    const z = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7);
    expect(about(new THREE.Vector3(0, 0, 1))[2]).toBeCloseTo(-z.z, 6);

    const y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
    expect(about(new THREE.Vector3(0, 1, 0))[1]).toBeCloseTo(-y.y, 6);
  });

  it("mirrors a position across x and leaves y and z", () => {
    const clip = new THREE.AnimationClip("t", 1, [
      new THREE.VectorKeyframeTrack("hand_l.position", [0], [0.4, 1.2, -0.3]),
    ]);
    // toBeCloseTo, not toEqual: keyframe values live in a Float32Array, so 0.4 comes back as
    // 0.4000000059604645 and an exact compare fails on the storage format rather than the maths.
    const values = Array.from(mirrorAnimationClip(clip, "m").tracks[0]!.values);
    for (const [index, expected] of [-0.4, 1.2, -0.3].entries()) {
      expect(values[index]!).toBeCloseTo(expected, 6);
    }
  });

  it("is its own inverse", () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 0.5, 0.8).normalize(), 1.1);
    const clip = new THREE.AnimationClip("t", 1, [
      new THREE.QuaternionKeyframeTrack("hand_l.quaternion", [0], [q.x, q.y, q.z, q.w]),
      new THREE.VectorKeyframeTrack("hand_l.position", [0], [0.4, 1.2, -0.3]),
    ]);
    const twice = mirrorAnimationClip(mirrorAnimationClip(clip, "a"), "b");
    expect(twice.tracks.map((t) => t.name).sort()).toEqual(["hand_l.position", "hand_l.quaternion"]);
    for (const track of twice.tracks) {
      const source = clip.tracks.find((t) => t.name === track.name)!;
      for (const [index, value] of Array.from(track.values).entries()) {
        expect(value).toBeCloseTo(source.values[index]!, 6);
      }
    }
  });
});
