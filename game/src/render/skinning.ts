/**
 * Shared skinned-mesh assembly: one host skeleton, many parts rebound onto it.
 *
 * ## Why this file exists
 *
 * `characterRig.attachOutfit` and the rigged path in `entityViews` both build a dressed humanoid,
 * and both got it wrong in the same way. `SkeletonUtils.clone`
 * (node_modules/three/examples/jsm/utils/SkeletonUtils.js:392-428) deep-clones the whole graph
 * INCLUDING the Armature's bones, then rebinds every SkinnedMesh to `sourceMesh.skeleton.clone()`
 * with `skeleton.bones` remapped to the CLONED bones. The clone is therefore a fully independent
 * skeleton, and an AnimationMixer built on the body drives none of it. Measured consequence: the
 * player's tunic and boots render forever in bind pose (runs/corealm/screenshots/baseline-bank.png,
 * baseline-town_center.png), and each layered piece leaves 65 orphan Bones being matrix-updated
 * every frame - 195 dead nodes on the player alone.
 *
 * ## What makes the rebind legal
 *
 * The asset library holds FOUR distinct 65-joint humanoid skeletons, not one. Measured by hashing
 * each GLB's `inverseBindMatrices` buffer across models/character, models/outfit and
 * models/animation:
 *
 *   ba5af210  base_male, alone
 *   eea9805d  base_female + hair_long + hair_buns + every female outfit part
 *   3c715354  eyebrows + hair_short + hair_buzzed + hair_beard + every male outfit part
 *   0d2ac055  both animation libraries
 *
 * What they DO share is the joint list: 65 joints, byte-identical names in byte-identical order
 * (root, pelvis, spine_01..03, neck_01, Head, clavicle_*, ..., ball_leaf_r) - re-verified here
 * across 17 files. That is exactly why a NAME-KEYED rebind works and a raw bone-array share does
 * not: take the HOST's `Bone` objects (so one mixer drives everything) and keep the PART's own
 * `boneInverses` (they encode the part's authored bind pose). The residual is the rest-pose delta
 * between the two rigs: 0 mm for base_female + female parts, at most 23.7 mm (foot) / 23.3 mm
 * (hand) for base_male + male parts, and it hides inside the clothing everywhere but the wrists.
 * Do NOT retarget - the names and order already match, so `SkeletonUtils.retarget` would only add
 * error.
 *
 * ## Why parenting does not matter, and what does
 *
 * `SkinnedMesh.updateMatrixWorld` (three 0.185, src/objects/SkinnedMesh.js) recomputes
 * `bindMatrixInverse = matrixWorld^-1` every frame while `bindMode === AttachedBindMode`, and the
 * skinning shader evaluates `matrixWorld * bindMatrixInverse * boneMatrix * bindMatrix * p`. The
 * mesh's own transform cancels out algebraically: the result is `boneMatrix * bindMatrix * p`, i.e.
 * pure bone space. So a rebound part renders correctly under any parent that shares a world space
 * with the bones. This file still reparents onto the host's own mesh parent, because that is what
 * keeps one dressed character in one subtree for culling, disposal and scene-graph readability.
 *
 * ## Layering
 *
 * `render/` owns no gameplay state. This module is pure Three.js plus `core/rng` for deterministic
 * choices; it imports nothing from `systems/`, `world/`, `state/` or `content/`.
 */
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Rng } from "../core/rng.js";

// ---------------------------------------------------------------- bones

/**
 * Name-keyed index of every `Bone` under `root`.
 *
 * First name wins. A dressed character built by this module has exactly one Armature by
 * construction, but a caller that hands in a half-assembled graph gets the host's bones rather
 * than a leftover part's, which is the safer of the two answers.
 */
export function collectBones(root: THREE.Object3D): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((child) => {
    const bone = child as THREE.Bone;
    if (bone.isBone && !bones.has(bone.name)) bones.set(bone.name, bone);
  });
  return bones;
}

/** Every `SkinnedMesh` under `root`, in traversal order. */
export function collectSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) meshes.push(mesh);
  });
  return meshes;
}

// -------------------------------------------------------------- rebind

/** What to do when a part asks for a bone the host does not have. */
export type MissingBonePolicy =
  /** Keep the part's own cloned bone for that joint and count it. The part still renders. */
  | "fallback"
  /** Bind nothing and report; the caller drops the part. */
  | "reject";

/**
 * Reuses one rebound `THREE.Skeleton` per distinct authored bind pose.
 *
 * Two lookups, in this order:
 *
 * 1. By the IDENTITY of the source `boneInverses` array. `Skeleton.clone()` is
 *    `new Skeleton(this.bones, this.boneInverses)` and the constructor stores `boneInverses` BY
 *    REFERENCE while copying `bones` (three 0.185, src/objects/Skeleton.js:46-62), so every
 *    SkinnedMesh `SkeletonUtils.clone` produced from one source skin shares one array object. This
 *    catches the five primitives inside outfit_male_peasant.glb at zero cost.
 * 2. By CONTENT - bone names plus a hash of every boneInverse, verified by exact comparison. This
 *    is the one that matters across files: outfit_male_peasant_chest.glb, _legs.glb and _boots.glb
 *    are three separate loads with three separate arrays, but they are the same authored rig
 *    (measured: identical sha1 over each GLB's inverseBindMatrices buffer, group 3c715354), so
 *    without a content check they would never share a skeleton and could never be merged.
 *
 * The content path is only ever reached once per distinct rig per assembly, and only compares 65
 * matrices when a 32-bit hash already collided, so it costs nothing measurable.
 */
export class SkeletonCache {
  private readonly byIdentity = new Map<readonly THREE.Matrix4[], THREE.Skeleton>();
  private readonly byShape = new Map<string, THREE.Skeleton[]>();

  /**
   * Distinct rebound skeletons held - i.e. distinct authored bind poses on this character.
   *
   * Not the number of source skeletons resolved: three separately loaded outfit parts on one rig
   * resolve three times and produce one skeleton, which is the whole point of the content lookup.
   */
  get size(): number {
    let count = 0;
    for (const bucket of this.byShape.values()) count += bucket.length;
    return count;
  }

  /**
   * The rebound skeleton for `source`: host bones by name, `source`'s own boneInverses.
   *
   * Unresolvable bone names are added to `missing` and fall back to the part's own bone, so the
   * caller can decide whether to keep or refuse the part. A cache hit cannot report missing names -
   * it is by construction the same rig that was already resolved against the same host.
   */
  resolve(
    source: THREE.Skeleton,
    hostBones: ReadonlyMap<string, THREE.Bone>,
    missing: Set<string>,
  ): THREE.Skeleton {
    const known = this.byIdentity.get(source.boneInverses);
    if (known) return known;

    const bones: THREE.Bone[] = [];
    for (const bone of source.bones) {
      const host = hostBones.get(bone.name);
      if (host) {
        bones.push(host);
        continue;
      }
      missing.add(bone.name);
      bones.push(bone);
    }

    const shape = `${bones.map((bone) => bone.name).join("|")}#${hashMatrices(source.boneInverses)}`;
    const candidates = this.byShape.get(shape);
    if (candidates) {
      for (const candidate of candidates) {
        if (sameBones(candidate.bones, bones) && sameMatrices(candidate.boneInverses, source.boneInverses)) {
          this.byIdentity.set(source.boneInverses, candidate);
          return candidate;
        }
      }
    }

    const skeleton = new THREE.Skeleton(bones, source.boneInverses);
    this.byIdentity.set(source.boneInverses, skeleton);
    if (candidates) candidates.push(skeleton);
    else this.byShape.set(shape, [skeleton]);
    return skeleton;
  }
}

export function createSkeletonCache(): SkeletonCache {
  return new SkeletonCache();
}

/** FNV-1a over the raw Float32 bits. glTF inverseBindMatrices are Float32, so this is exact. */
function hashMatrices(matrices: readonly THREE.Matrix4[]): number {
  const scratch = new Float32Array(1);
  const bits = new Uint32Array(scratch.buffer);
  let hash = 0x811c_9dc5;
  for (const matrix of matrices) {
    for (const value of matrix.elements) {
      scratch[0] = value;
      hash ^= bits[0] ?? 0;
      hash = Math.imul(hash, 0x0100_0193);
    }
  }
  return hash >>> 0;
}

function sameBones(a: readonly THREE.Bone[], b: readonly THREE.Bone[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function sameMatrices(a: readonly THREE.Matrix4[], b: readonly THREE.Matrix4[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (!left || !right || !left.equals(right)) return false;
  }
  return true;
}

export interface RebindOptions {
  /** Default "fallback". */
  onMissingBone?: MissingBonePolicy;
  /** Default true - every character in this game casts and receives. */
  castShadow?: boolean;
  /** Default true. */
  receiveShadow?: boolean;
  /**
   * Reuses one `THREE.Skeleton` per authored bind pose across calls, so meshes from the same source
   * file end up sharing a skeleton object and become mergeable. Pass one map through a whole
   * assembly. See `mergeSkinnedMeshes`.
   */
  skeletonCache?: SkeletonCache;
}

/** Result of rebinding one part. Never half-applied: on "reject", `meshes` is empty. */
export interface RebindResult {
  /** SkinnedMeshes successfully rebound and reparented. */
  bound: number;
  /** Bone names the part wanted that the host did not have, deduplicated and sorted. */
  missing: string[];
  /** The rebound meshes, now children of the target node. */
  meshes: THREE.SkinnedMesh[];
  /** True when `onMissingBone: "reject"` fired and nothing was attached. */
  rejected: boolean;
  /** Orphan Bones dropped with the part's own Armature. */
  discardedBones: number;
}

/**
 * Rebinds a cloned skinned part onto a host body's bones and reparents it onto `target`.
 *
 * For each SkinnedMesh in `part`: build a `THREE.Skeleton` from the HOST's Bone objects looked up
 * by name, keeping the PART's own `boneInverses`, call `mesh.bind(skeleton, mesh.bindMatrix)`, then
 * move the mesh onto `target` and throw the part's cloned Armature away. Discarding the Armature is
 * as much the point as the rebind is: today each layered piece leaves 65 orphan Bones in the graph
 * being matrix-updated every frame. Measured on the real assets, a body plus three outfit parts
 * comes out with 65 bones total instead of 260, and every mesh's `skeleton.bones` holds the host's
 * Bone objects by identity.
 *
 * `part` must be a clone you own - this mutates it and leaves it empty.
 */
export function rebindSkinnedPart(
  part: THREE.Object3D,
  hostBones: ReadonlyMap<string, THREE.Bone>,
  target: THREE.Object3D,
  options: RebindOptions = {},
): RebindResult {
  const policy = options.onMissingBone ?? "fallback";
  const cache = options.skeletonCache ?? createSkeletonCache();
  const meshes = collectSkinnedMeshes(part);
  const missing = new Set<string>();

  // Resolve first, attach second. A "reject" must not leave half a shirt on the character.
  const plans: Array<{ mesh: THREE.SkinnedMesh; skeleton: THREE.Skeleton }> = [];
  for (const mesh of meshes) {
    plans.push({ mesh, skeleton: cache.resolve(mesh.skeleton, hostBones, missing) });
  }

  if (policy === "reject" && missing.size > 0) {
    const discarded = countBones(part);
    disposeGraph(part);
    return { bound: 0, missing: [...missing].sort(), meshes: [], rejected: true, discardedBones: discarded };
  }

  const attached: THREE.SkinnedMesh[] = [];
  for (const { mesh, skeleton } of plans) {
    mesh.bind(skeleton, mesh.bindMatrix);
    // AttachedBindMode is what makes the mesh's own transform cancel out of the skinning result
    // (see the header). GLTFLoader already leaves it here; setting it makes the assumption local.
    mesh.bindMode = THREE.AttachedBindMode;
    mesh.removeFromParent();
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.matrix.identity();
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = options.receiveShadow !== false;
    target.add(mesh);
    attached.push(mesh);
  }

  const discardedBones = countBones(part);
  // Everything worth keeping has been moved out; the remainder is the part's own Armature.
  disposeGraph(part);

  return { bound: attached.length, missing: [...missing].sort(), meshes: attached, rejected: false, discardedBones };
}

function countBones(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((child) => {
    if ((child as THREE.Bone).isBone) count += 1;
  });
  return count;
}

// ------------------------------------------------------------ clipping

/** Which side of the cut survives. */
export type ClipSide = "below" | "above";

/**
 * Outcome of clipping a skinned geometry.
 *
 * "unchanged" is its own case on purpose. Returning the SOURCE geometry when nothing was cut would
 * hand the caller a geometry it does not own, and callers register whatever they get back for
 * disposal - that is how a shared asset geometry gets disposed out from under every other user of
 * it. base_male's Eyes and Eyebrows meshes sit entirely above the head-cap plane (measured
 * y 1.6836-1.7135 and 1.6949-1.7255 against a cut at 1.55), so this case is the common one.
 */
export type SkinnedClipResult =
  | { kind: "unchanged" }
  | { kind: "empty" }
  | { kind: "clipped"; geometry: THREE.BufferGeometry; keptTriangles: number; totalTriangles: number };

/** Attributes carried through a static clip. Matches `entityViews.clipGeometryBelow`. */
const STATIC_ATTRIBUTES = ["position", "normal", "uv", "color"] as const;

/** Attributes carried through a skinned clip. Dropping either of the last two unbinds the mesh. */
const SKINNED_ATTRIBUTES = [
  "position", "normal", "uv", "uv1", "uv2", "color", "tangent", "skinIndex", "skinWeight",
] as const;

/**
 * Keeps only the triangles below world height `cut`, with `matrix` baked in.
 *
 * Drop-in replacement for the private `clipGeometryBelow` in `entityViews.ts`: same signature, same
 * centroid test, same non-indexed output carrying position/normal/uv/color. It lives here so the
 * two files stop owning one algorithm twice.
 *
 * A triangle is kept when its CENTROID is below the cut, which leaves a flat-ish top rather than
 * the ragged fringe an all-vertices test produces on low-poly geometry. Returns null when the cut
 * keeps nothing - for a tree canopy that is the correct answer and the caller drops the part.
 *
 * NOT for skinned meshes: it bakes `matrix` into the positions and drops skinIndex/skinWeight, so
 * the result no longer deforms. Use `clipSkinnedGeometry` for anything with bones.
 */
export function clipGeometryBelow(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  cut: number,
): THREE.BufferGeometry | null {
  return clipStatic(geometry, matrix, cut, "below");
}

/**
 * The mirror of `clipGeometryBelow`: keeps the triangles ABOVE `cut`.
 *
 * The rig diagnosis asks for this to build a head cap, but a head cap is a skinned cut and wants
 * `clipSkinnedGeometry`. This one is the static counterpart of the same question.
 */
export function clipGeometryAbove(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  cut: number,
): THREE.BufferGeometry | null {
  return clipStatic(geometry, matrix, cut, "above");
}

function clipStatic(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  cut: number,
  side: ClipSide,
): THREE.BufferGeometry | null {
  const baked = geometry.clone().applyMatrix4(matrix);
  const source = baked.getIndex() ? baked.toNonIndexed() : baked;
  const position = source.getAttribute("position");
  if (!position || position.count < 3) return null;

  const keep: number[] = [];
  for (let triangle = 0; triangle + 2 < position.count; triangle += 3) {
    const centroid = (position.getY(triangle) + position.getY(triangle + 1) + position.getY(triangle + 2)) / 3;
    if (side === "below" ? centroid <= cut : centroid >= cut) keep.push(triangle);
  }
  if (keep.length === 0) return null;

  const out = new THREE.BufferGeometry();
  for (const name of STATIC_ATTRIBUTES) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    const size = attribute.itemSize;
    const values = new Float32Array(keep.length * 3 * size);
    let write = 0;
    for (const triangle of keep) {
      for (let vertex = 0; vertex < 3; vertex += 1) {
        for (let component = 0; component < size; component += 1) {
          values[write] = attribute.getComponent(triangle + vertex, component);
          write += 1;
        }
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  out.computeBoundingSphere();
  return out;
}

/**
 * Clips a SKINNED geometry, which is not the same job as clipping a static one.
 *
 * Two differences, both load-bearing:
 *
 * 1. The cut is evaluated in BIND-POSE space. Skinned positions live in the space
 *    `bindMatrix * position`, and that is where an authored height like "the neck is at y = 1.55"
 *    means anything; the mesh's own world matrix is irrelevant because AttachedBindMode cancels it
 *    (see the header). So `bindMatrix` transforms positions FOR THE TEST ONLY - the output keeps
 *    source-space positions and drops straight back into the same SkinnedMesh with the same bind
 *    matrix. On base_male and base_female that matrix is the identity (measured: both body nodes
 *    carry an identity world matrix), so there the test height is the authored height.
 * 2. skinIndex and skinWeight are filtered alongside position/normal/uv/tangent/colour, and
 *    skinIndex keeps its integer array type. A skinned geometry that loses either attribute stops
 *    deforming and renders in bind pose - which is the bug this whole file exists to fix.
 *
 * Output is INDEXED and vertex-compacted, unlike the static path. A head cap keeps 2866 of
 * base_male's 12566 triangles; non-indexing that would turn 1568 shared vertices into 8598, and
 * skinned geometry carries five attributes per vertex, so the difference is not academic.
 */
export function clipSkinnedGeometry(
  geometry: THREE.BufferGeometry,
  cut: number,
  side: ClipSide,
  bindMatrix?: THREE.Matrix4,
): SkinnedClipResult {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) return { kind: "empty" };

  const index = geometry.getIndex();
  const triangles = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  if (triangles === 0) return { kind: "empty" };

  const point = new THREE.Vector3();
  const heightOf = (vertex: number): number => {
    point.fromBufferAttribute(position, vertex);
    if (bindMatrix) point.applyMatrix4(bindMatrix);
    return point.y;
  };

  const kept: Array<[number, number, number]> = [];
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const a = index ? index.getX(triangle * 3) : triangle * 3;
    const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    const centroid = (heightOf(a) + heightOf(b) + heightOf(c)) / 3;
    if (side === "below" ? centroid <= cut : centroid >= cut) kept.push([a, b, c]);
  }

  if (kept.length === 0) return { kind: "empty" };
  if (kept.length === triangles) return { kind: "unchanged" };

  // Compact: only the vertices the surviving triangles actually reference.
  const remap = new Map<number, number>();
  const order: number[] = [];
  const indices: number[] = [];
  for (const corners of kept) {
    for (const corner of corners) {
      let mapped = remap.get(corner);
      if (mapped === undefined) {
        mapped = order.length;
        remap.set(corner, mapped);
        order.push(corner);
      }
      indices.push(mapped);
    }
  }

  const out = new THREE.BufferGeometry();
  for (const name of SKINNED_ATTRIBUTES) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    out.setAttribute(name, selectVertices(attribute, order));
  }
  out.setIndex(
    order.length > 65535
      ? new THREE.Uint32BufferAttribute(indices, 1)
      : new THREE.Uint16BufferAttribute(indices, 1),
  );
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return { kind: "clipped", geometry: out, keptTriangles: kept.length, totalTriangles: triangles };
}

/**
 * Copies the listed vertices out of an attribute, preserving its array type.
 *
 * skinIndex must stay integral: `WebGLRenderer` uploads it as-is and the shader indexes the bone
 * texture with it. Every humanoid GLB in this pack ships it as Uint8 (measured after load - 65
 * joints fit in a byte), so widening it to Float32 would quadruple that buffer for nothing.
 *
 * A NORMALIZED attribute is the exception, and getting it wrong is why every clipped or merged NPC
 * rendered as a pure black silhouette (measured in runs/corealm/screenshots/w1-highcairn.png,
 * 5 of 6 characters black). `getComponent` DENORMALISES: it returns the 0..1 float, not the stored
 * byte. Writing that into a Uint8Array allocated from the source truncates every component to 0,
 * and re-flagging the result `normalized` then reads those zeros back as 0.0. Every humanoid GLB
 * here ships COLOR_0 as UBYTE normalized, so the vertex colour multiplied the albedo by zero.
 * Float32 with `normalized: false` stores exactly what `getComponent` returned.
 */
function selectVertices(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  order: readonly number[],
): THREE.BufferAttribute {
  const size = attribute.itemSize;
  const dequantise = attribute.normalized;
  const values = dequantise
    ? new Float32Array(order.length * size)
    : allocateLike(attribute.array, order.length * size);
  let write = 0;
  for (const vertex of order) {
    for (let component = 0; component < size; component += 1) {
      values[write] = attribute.getComponent(vertex, component);
      write += 1;
    }
  }
  return new THREE.BufferAttribute(values, size, dequantise ? false : attribute.normalized);
}

type NumericArray =
  | Int8Array | Uint8Array | Uint8ClampedArray
  | Int16Array | Uint16Array
  | Int32Array | Uint32Array
  | Float32Array | Float64Array;

function allocateLike(source: ArrayLike<number>, length: number): NumericArray {
  if (source instanceof Int8Array) return new Int8Array(length);
  if (source instanceof Uint8ClampedArray) return new Uint8ClampedArray(length);
  if (source instanceof Uint8Array) return new Uint8Array(length);
  if (source instanceof Int16Array) return new Int16Array(length);
  if (source instanceof Uint16Array) return new Uint16Array(length);
  if (source instanceof Int32Array) return new Int32Array(length);
  if (source instanceof Uint32Array) return new Uint32Array(length);
  if (source instanceof Float64Array) return new Float64Array(length);
  return new Float32Array(length);
}

// ------------------------------------------------------------ head cap

/**
 * Bind-space Y at which a base body is cut down to a head cap, per body asset.
 *
 * Measured here, not inherited: for each body I counted the vertices and triangle centroids kept at
 * a range of heights and read off the maximum |x| of the surviving set, because the failure mode is
 * the T-posed shoulders sneaking into the cap.
 *
 *   base_male   (mesh Sphere.005_Retopology.004, 7147 verts, y -0.0095..1.8101, 12566 tris)
 *     1.50 -> 1763 verts, maxAbsX 0.532  (both shoulders; unusable)
 *     1.52 -> 1693 verts, maxAbsX 0.271  (shoulder tips still caught)
 *     1.55 -> 1541 verts, maxAbsX 0.105  (clean neck ring; 2866 triangles)
 *   base_female (mesh Superhero_Female, 7244 verts, y -0.0084..1.7666, 12812 tris)
 *     1.45 -> 1888 verts, maxAbsX 0.502  (shoulders)
 *     1.48 -> 1703 verts, maxAbsX 0.089  (already clean)
 *     1.50 -> 1628 verts, maxAbsX 0.089  (3026 triangles)
 *
 * The seams are covered by the clothes: Male_Peasant_Body tops out at y 1.5587, so 8.7 mm of collar
 * sits over a 1.55 cut, and Female_Peasant_Body tops out at 1.5184 for 18.4 mm over a 1.50 cut.
 * Male_Ranger_Body reaches 1.5997 and its hood spans 1.5253-1.8650.
 *
 * These reproduce the rig diagnosis to within a couple of millimetres - it reported neck rings of
 * 0.123 male and 0.068 female where I measure 0.105 and 0.089 - and the cut heights it recommends,
 * 1.55 and 1.50, are confirmed unchanged.
 */
export const HEAD_CAP_HEIGHTS: Readonly<Record<string, number>> = {
  base_male: 1.55,
  base_female: 1.5,
};

/** The head-cap plane for a body asset, or null when that body has no measured cut. */
export function headCapHeightFor(bodyAssetId: string): number | null {
  return HEAD_CAP_HEIGHTS[bodyAssetId] ?? null;
}

export interface HeadCapResult {
  /** Mesh names whose geometry was replaced by a clipped copy. */
  clipped: string[];
  /** Mesh names removed entirely because nothing survived the cut. */
  removed: string[];
  /** Mesh names left untouched because they already sat above the cut (Eyes, Eyebrows, hair). */
  kept: string[];
  /** Geometries this call allocated. The caller owns them and must dispose them. */
  geometries: THREE.BufferGeometry[];
  trianglesBefore: number;
  trianglesAfter: number;
}

/**
 * Cuts a cloned base body down to a head cap, in place.
 *
 * The reason to do this at all: outfit parts are authored to REPLACE the body below the neck, not
 * to cover it. Measured cross-sections in bind space - thigh band y[0.55,0.90], base_male maxAbsX
 * 0.1952 against outfit_male_peasant_legs 0.1898, so the trousers sit 5.4 mm INSIDE the bare leg;
 * foot band y[0,0.20], 0.1865 against a 0.1590 boot, 27.5 mm. Layering clothes over an intact body
 * therefore leaks bare skin through them, which is the bare leg overlapping the boot in
 * runs/corealm/screenshots/RIG-town-player.png. Cutting the body to a head cap and layering that
 * onto the FULL outfit is the fix.
 *
 * Measured by running this on the real GLBs: base_male's SuperHero_Male mesh goes 12566 -> 2866
 * triangles (7147 -> 1568 verts) at a 1.55 cut, base_female's Superhero_Female 12812 -> 3026 at
 * 1.50, and in both cases Eyebrows and Eyes come through untouched, so the face survives the cut.
 * Nothing is removed outright on either body.
 *
 * Mutates `body`, which must be a clone you own.
 */
export function applyHeadCap(body: THREE.Object3D, cut: number): HeadCapResult {
  const result: HeadCapResult = {
    clipped: [], removed: [], kept: [], geometries: [], trianglesBefore: 0, trianglesAfter: 0,
  };
  for (const mesh of collectSkinnedMeshes(body)) {
    const before = triangleCount(mesh.geometry);
    result.trianglesBefore += before;
    const clip = clipSkinnedGeometry(mesh.geometry, cut, "above", mesh.bindMatrix);
    if (clip.kind === "unchanged") {
      result.kept.push(mesh.name);
      result.trianglesAfter += before;
      continue;
    }
    if (clip.kind === "empty") {
      result.removed.push(mesh.name);
      mesh.removeFromParent();
      continue;
    }
    // The source geometry belongs to the shared loaded asset: replace the reference, never dispose.
    mesh.geometry = clip.geometry;
    result.geometries.push(clip.geometry);
    result.clipped.push(mesh.name);
    result.trianglesAfter += clip.keptTriangles;
  }
  return result;
}

// --------------------------------------------------------------- merge

export interface MergeOptions {
  /** Default: material UUID. See `mergeSkinnedMeshes` for why that is the conservative choice. */
  materialKey?: (material: THREE.Material) => string;
  /** Groups smaller than this are left as they are. Default 2. */
  minGroup?: number;
}

export interface MergeResult {
  /** The character's meshes after merging: survivors plus the new merged meshes. */
  meshes: THREE.SkinnedMesh[];
  /** Geometries this call allocated. The caller owns them and must dispose them. */
  geometries: THREE.BufferGeometry[];
  drawCallsBefore: number;
  drawCallsAfter: number;
}

/**
 * Merges same-material skinned meshes that share a skeleton into one geometry each.
 *
 * Worth doing: `estimatedDrawCalls` measures 678 against a stated 400 budget, and the fix for the
 * headless NPCs adds meshes rather than removing them. outfit_male_peasant.glb is five primitives -
 * Male_Peasant_Arms x2, Body, Feet, Legs - of which Body, Feet, Legs and one Arms primitive all use
 * MI_Peasant while the other Arms primitive uses MI_Regular_Male.
 *
 * Measured on the real GLBs through `assembleDressedCharacter`: base_male + outfit_male_peasant is
 * 8 meshes / 27212 triangles unmerged; with the head cap and hair_short and this merge it is 6
 * meshes / 18813 triangles, and the outfit's own share of that goes from 5 draws to 2. base_female
 * + outfit_female_peasant lands at 5 meshes / 18842 triangles, with the outfit going 4 draws to 2
 * (see the attribute condition below for why 2 and not 1).
 *
 * Three conditions, all of which must hold or the pair is left alone:
 *   - the identical `THREE.Skeleton` OBJECT, so skinIndex values already index the same bone array
 *     and no remap is needed. `RebindOptions.skeletonCache` is what makes that true across parts
 *     from one source file; without it, every mesh gets its own Skeleton and nothing merges.
 *   - the identical material (see `materialKey`).
 *   - identical attribute names and item sizes. This one bites: Female_Peasant_Arms and
 *     Female_Peasant_Legs ship without COLOR_0 while Female_Peasant_Body and _Feet ship with it, so
 *     the female peasant merges 4 meshes into 2 rather than 1. Padding the missing attribute would
 *     silently change how a vertex-colour material shades.
 *
 * `materialKey` defaults to material UUID, which does NOT merge across separately loaded GLBs: two
 * loads of MI_Peasant are two Material instances holding two Texture instances. A caller that
 * dedupes materials upstream (render/materials.ts) can pass its own key and get that merge too.
 *
 * Each merged mesh is added to the parent of the first mesh in its group and the originals are
 * removed from the graph. Source geometries are NOT disposed - they are shared with the loaded
 * asset. Multi-material meshes are passed through untouched: merging one needs geometry-group
 * bookkeeping this does not do, and getting that wrong draws the wrong material on the wrong
 * triangles.
 */
export function mergeSkinnedMeshes(
  meshes: readonly THREE.SkinnedMesh[],
  options: MergeOptions = {},
): MergeResult {
  const key = options.materialKey ?? ((material: THREE.Material) => material.uuid);
  const minGroup = options.minGroup ?? 2;

  const groups = new Map<string, THREE.SkinnedMesh[]>();
  const groupOrder: string[] = [];
  const skeletonIds = new Map<THREE.Skeleton, number>();
  const passthrough: THREE.SkinnedMesh[] = [];

  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) {
      passthrough.push(mesh);
      continue;
    }
    let skeletonId = skeletonIds.get(mesh.skeleton);
    if (skeletonId === undefined) {
      skeletonId = skeletonIds.size;
      skeletonIds.set(mesh.skeleton, skeletonId);
    }
    const signature = `${skeletonId}|${key(mesh.material)}|${attributeSignature(mesh.geometry)}`;
    const bucket = groups.get(signature);
    if (bucket) {
      bucket.push(mesh);
    } else {
      groups.set(signature, [mesh]);
      groupOrder.push(signature);
    }
  }

  const out: THREE.SkinnedMesh[] = [...passthrough];
  const geometries: THREE.BufferGeometry[] = [];
  let before = passthrough.length;

  for (const signature of groupOrder) {
    const bucket = groups.get(signature) ?? [];
    before += bucket.length;
    const first = bucket[0];
    if (!first) continue;
    if (bucket.length < minGroup) {
      out.push(first);
      continue;
    }
    const merged = mergeGeometries(bucket.map((mesh) => mesh.geometry));
    if (!merged) {
      out.push(...bucket);
      continue;
    }
    const material = first.material;
    if (Array.isArray(material)) {
      out.push(...bucket);
      continue;
    }
    const parent = first.parent;
    const mesh = new THREE.SkinnedMesh(merged, material);
    mesh.name = `merged-${first.name}`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.frustumCulled = first.frustumCulled;
    mesh.bindMode = THREE.AttachedBindMode;
    mesh.bind(first.skeleton, first.bindMatrix);
    for (const source of bucket) source.removeFromParent();
    if (parent) parent.add(mesh);
    geometries.push(merged);
    out.push(mesh);
  }

  return { meshes: out, geometries, drawCallsBefore: before, drawCallsAfter: out.length };
}

function attributeSignature(geometry: THREE.BufferGeometry): string {
  return Object.keys(geometry.attributes)
    .sort()
    .map((name) => `${name}:${geometry.attributes[name]?.itemSize ?? 0}`)
    .join(",");
}

/**
 * Concatenates geometries already proved compatible by `attributeSignature`.
 *
 * Deliberately not `BufferGeometryUtils.mergeGeometries`: that one drops geometry groups, console-
 * warns on any mismatch, and normalises attribute types. Doing it here keeps skinIndex integral and
 * keeps the whole merge contract - which pairs may merge, and what the result is bound to - inside
 * one file.
 */
function mergeGeometries(sources: readonly THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const first = sources[0];
  if (!first) return null;
  const names = Object.keys(first.attributes);
  if (names.length === 0) return null;

  let vertices = 0;
  let indices = 0;
  for (const geometry of sources) {
    const position = geometry.getAttribute("position");
    if (!position) return null;
    vertices += position.count;
    const index = geometry.getIndex();
    indices += index ? index.count : position.count;
  }

  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const template = first.getAttribute(name);
    if (!template) return null;
    const size = template.itemSize;
    // Same dequantisation rule as `selectVertices`, and for the same measured reason: a normalized
    // UBYTE COLOR_0 copied through `getComponent` into a Uint8Array truncates to all zeros, which
    // is what painted every merged NPC black.
    const dequantise = template.normalized;
    const values = dequantise
      ? new Float32Array(vertices * size)
      : allocateLike(template.array, vertices * size);
    let write = 0;
    for (const geometry of sources) {
      const attribute = geometry.getAttribute(name);
      if (!attribute) return null;
      for (let vertex = 0; vertex < attribute.count; vertex += 1) {
        for (let component = 0; component < size; component += 1) {
          values[write] = attribute.getComponent(vertex, component);
          write += 1;
        }
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(values, size, dequantise ? false : template.normalized));
  }

  const indexValues = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let write = 0;
  let offset = 0;
  for (const geometry of sources) {
    const position = geometry.getAttribute("position");
    if (!position) return null;
    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 1) {
        indexValues[write] = index.getX(i) + offset;
        write += 1;
      }
    } else {
      for (let i = 0; i < position.count; i += 1) {
        indexValues[write] = i + offset;
        write += 1;
      }
    }
    offset += position.count;
  }
  out.setIndex(new THREE.BufferAttribute(indexValues, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// ----------------------------------------------------------- assembly

/** One layered piece: an asset id plus the ORIGINAL loaded scene graph for it. */
export interface CharacterPartSource {
  assetId: string;
  /**
   * The original loaded graph, NOT a clone. This module clones it with `SkeletonUtils.clone`, the
   * only clone that gives the part its own bones to hand over; `Object3D.clone` shares the source
   * skeleton by reference, which would make every character built from one asset animate in
   * lockstep with the source.
   */
  source: THREE.Object3D;
}

export interface DressedCharacterSpec {
  bodyAssetId: string;
  /** The original loaded graph for the body. Cloned here. */
  body: THREE.Object3D;
  parts?: readonly CharacterPartSource[];
  /**
   * Cut the body to a head cap before layering. Pass a number to override the measured plane, or
   * `true` to use `HEAD_CAP_HEIGHTS[bodyAssetId]` (and do nothing if that body has no measured
   * cut). Default false, which reproduces today's naked-body-under-clothes build.
   */
  headCap?: boolean | number;
  /** Default true. */
  castShadow?: boolean;
  /** Default true. Set false to keep every part as its own draw. */
  merge?: boolean;
  mergeOptions?: MergeOptions;
  /** Default "fallback". */
  onMissingBone?: MissingBonePolicy;
  name?: string;
}

export interface DressedCharacter {
  /** Add this to the scene. */
  group: THREE.Group;
  /**
   * The node an `AnimationMixer` must be constructed on.
   *
   * It is the cloned BODY graph, because that is what owns the surviving Armature and therefore the
   * bones every clip's tracks address by name. Every part's meshes now point at those same bones,
   * so one mixer drives the whole character - which is the entire point of this module.
   */
  animationRoot: THREE.Object3D;
  /** The host skeleton, taken from the body's first SkinnedMesh. */
  skeleton: THREE.Skeleton;
  bones: Map<string, THREE.Bone>;
  /** Every renderable SkinnedMesh on the character after clipping and merging. */
  meshes: THREE.SkinnedMesh[];
  /** A character with no multi-material meshes draws exactly `meshes.length` times. */
  drawCalls: number;
  /** Per-part rebind outcome, keyed by asset id. Check `.rejected` and `.missing`. */
  rebinds: Map<string, RebindResult>;
  headCap: HeadCapResult | null;
  merged: MergeResult | null;
  /** Frees the geometries this assembly allocated and detaches the group. Nothing else owns them. */
  dispose(): void;
}

/**
 * Builds a dressed character: clone the body, optionally cut it to a head cap, rebind every part
 * onto the body's bones, merge what can be merged, hand back one group and one skeleton.
 *
 * Synchronous and asset-registry-free on purpose, so it is unit-testable under node and usable from
 * `entityViews`, which already caches original graphs. `loadDressedCharacter` is the async wrapper
 * for callers holding an `AssetRegistry`.
 *
 * Throws when the body has no SkinnedMesh. That is a caller bug, not a cosmetic degradation, and
 * silently returning a bone-less group would reproduce exactly the frozen-in-bind-pose failure this
 * module exists to remove.
 */
export function assembleDressedCharacter(spec: DressedCharacterSpec): DressedCharacter {
  const group = new THREE.Group();
  group.name = spec.name ?? `dressed-${spec.bodyAssetId}`;

  const body = cloneSkinned(spec.body);
  body.name = "body";
  group.add(body);

  const bodyMeshes = collectSkinnedMeshes(body);
  const first = bodyMeshes[0];
  if (!first) throw new Error(`Body asset has no SkinnedMesh: ${spec.bodyAssetId}`);

  const castShadow = spec.castShadow !== false;
  for (const mesh of bodyMeshes) {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = castShadow;
  }

  const cut = spec.headCap === true
    ? headCapHeightFor(spec.bodyAssetId)
    : typeof spec.headCap === "number" ? spec.headCap : null;
  const headCap = cut === null ? null : applyHeadCap(body, cut);

  const bones = collectBones(body);
  const skeletonCache = createSkeletonCache();
  // Run the body's OWN meshes through the same cache, so a part authored on the same rig as the
  // body - base_female and every female outfit part are both rig eea9805d - ends up on the same
  // Skeleton OBJECT and can therefore merge WITH the body rather than only with its siblings.
  // For the body this is a no-op rebind: the host bones are its own and boneInverses is unchanged.
  for (const mesh of bodyMeshes) {
    mesh.bind(skeletonCache.resolve(mesh.skeleton, bones, new Set<string>()), mesh.bindMatrix);
    mesh.bindMode = THREE.AttachedBindMode;
  }

  const target = first.parent ?? body;
  const rebinds = new Map<string, RebindResult>();
  for (const part of spec.parts ?? []) {
    const clone = cloneSkinned(part.source);
    rebinds.set(part.assetId, rebindSkinnedPart(clone, bones, target, {
      onMissingBone: spec.onMissingBone ?? "fallback",
      castShadow,
      receiveShadow: castShadow,
      skeletonCache,
    }));
  }

  let meshes = collectSkinnedMeshes(group);
  let merged: MergeResult | null = null;
  if (spec.merge !== false && meshes.length > 1) {
    merged = mergeSkinnedMeshes(meshes, spec.mergeOptions);
    meshes = merged.meshes;
  }

  const owned: THREE.BufferGeometry[] = [
    ...(headCap?.geometries ?? []),
    ...(merged?.geometries ?? []),
  ];

  return {
    group,
    animationRoot: body,
    skeleton: first.skeleton,
    bones,
    meshes,
    drawCalls: meshes.reduce(
      (sum, mesh) => sum + (Array.isArray(mesh.material) ? Math.max(1, mesh.geometry.groups.length) : 1),
      0,
    ),
    rebinds,
    headCap,
    merged,
    dispose() {
      for (const geometry of owned) geometry.dispose();
      owned.length = 0;
      group.removeFromParent();
      group.clear();
    },
  };
}

/** The slice of `AssetRegistry` this module needs, so a test can hand in a stub. */
export interface SkinningAssetSource {
  load(id: string): Promise<THREE.Group>;
}

export interface LoadDressedCharacterOptions extends Omit<DressedCharacterSpec, "body" | "parts"> {
  /** Asset ids layered onto the body, in draw order. Ids that fail to load are skipped. */
  partAssetIds?: readonly string[];
}

/**
 * `assembleDressedCharacter` with the asset loads done for you.
 *
 * `AssetRegistry.load` returns the ORIGINAL loaded graph - assets.ts:128-131 caches and returns it,
 * it does not clone - which is exactly what the assembler needs.
 *
 * A part that fails to load is skipped and recorded as a rejected rebind rather than failing the
 * whole character: a character in the wrong trousers is worth having, a character that failed to
 * build is not. The body is not optional; if it fails, this rejects.
 */
export async function loadDressedCharacter(
  assets: SkinningAssetSource,
  options: LoadDressedCharacterOptions,
): Promise<DressedCharacter> {
  const body = await assets.load(options.bodyAssetId);
  const parts: CharacterPartSource[] = [];
  const failed: string[] = [];
  for (const assetId of options.partAssetIds ?? []) {
    try {
      parts.push({ assetId, source: await assets.load(assetId) });
    } catch {
      failed.push(assetId);
    }
  }
  const character = assembleDressedCharacter({ ...options, body, parts });
  for (const assetId of failed) {
    character.rebinds.set(assetId, { bound: 0, missing: [], meshes: [], rejected: true, discardedBones: 0 });
  }
  return character;
}

// ------------------------------------------------ deterministic choices

/**
 * Hair assets by rig group, as measured from each GLB's inverseBindMatrices hash.
 *
 * hair_short / hair_buzzed / hair_beard are rig 3c715354 (the male-outfit rig); hair_long /
 * hair_buns are rig eea9805d (base_female's own rig). Either list rebinds onto either body - the
 * meshes skin almost entirely to `Head`, and both male rigs place Head at y 1.600 - but keeping the
 * split means a female character gets female hair. hair_beard is not in either list because it is a
 * second layer rather than an alternative; add it alongside a hair pick, not instead of one.
 */
export const MALE_HAIR_ASSETS: readonly string[] = ["hair_short", "hair_buzzed"] as const;
export const FEMALE_HAIR_ASSETS: readonly string[] = ["hair_long", "hair_buns"] as const;

/**
 * Picks a hair asset deterministically from an id.
 *
 * Pure function of `id`: no bare `Math.random()` anywhere in this file, because the harness calls
 * `__gameDebug.reset({seed})` and diffs state, and one unseeded call makes screenshots and tests
 * flap. Same id in, same hair out, across reloads and across processes.
 */
export function hairAssetFor(id: string, sex: "male" | "female"): string {
  const options = sex === "female" ? FEMALE_HAIR_ASSETS : MALE_HAIR_ASSETS;
  const picked = options[new Rng(hashString(`hair:${sex}:${id}`)).int(0, options.length - 1)];
  return picked ?? "hair_short";
}

/** FNV-1a, matching the private one in entityViews.ts so both files seed the same way. */
function hashString(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------- misc

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  const position = geometry.getAttribute("position");
  return position ? Math.floor(position.count / 3) : 0;
}

/**
 * Drops a discarded subtree.
 *
 * Geometries and materials are NOT disposed by default: everything this module clones shares
 * geometry and material with the loaded asset by reference (`SkeletonUtils.clone` reuses both), so
 * disposing them here would tear the asset out from under every other character using it.
 */
export function disposeGraph(
  root: THREE.Object3D,
  options: { geometries?: boolean; materials?: boolean } = {},
): void {
  if (options.geometries || options.materials) {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (options.geometries) mesh.geometry.dispose();
      if (options.materials) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          material.dispose();
        }
      }
    });
  }
  root.removeFromParent();
  root.clear();
}

// ---------------------------------------------------------------- mirroring

/**
 * The other side's bone name, or null for a bone that sits on the centre line.
 *
 * The 65-joint rig this project shares suffixes every paired joint `_l` or `_r` (hand_l, upperarm_r,
 * index_01_r, ball_leaf_r) and leaves the spine unsuffixed (root, pelvis, spine_01..03, neck_01,
 * Head). Nothing else in the set uses those endings, so the swap is a suffix test.
 */
export function mirroredBoneName(name: string): string | null {
  if (name.endsWith("_l")) return `${name.slice(0, -2)}_r`;
  if (name.endsWith("_r")) return `${name.slice(0, -2)}_l`;
  return null;
}

/**
 * A left-right mirrored copy of an animation clip.
 *
 * WHY THIS EXISTS. The free tier of the Universal Animation Library ships exactly one casting
 * animation, `Spell_Simple_Shoot`, and measured by forward kinematics it raises the LEFT hand (peak
 * 0.086 m below the head) while the right stays down at 0.594 m below. Staves are main-hand items
 * and belong in the right hand, so played as authored the caster raises an empty hand and the staff
 * hangs at their side. There is no right-handed variant to switch to — the pack's remaining
 * animations are the paid Pro tier — so the clip is mirrored instead.
 *
 * THE MATHS, because "mirror it" hides two easy mistakes. Reflection through the YZ plane is the
 * matrix `M = diag(-1, 1, 1)`. A bone's local rotation `R` becomes `M R M`, which for a rotation of
 * angle t about axis n is a rotation of -t about `M n` — so in quaternion terms `(x, y, z, w)`
 * becomes `(x, -y, -z, w)`. Checked against all three axes: a rotation about X is unchanged (the
 * axis is perpendicular to the mirror, and negating both the axis and the angle cancels), about Y
 * and about Z it reverses. Positions mirror the other way round: `(x, y, z)` becomes `(-x, y, z)`.
 * Getting these two rules the same way round is the classic error and produces a character that
 * turns itself inside out.
 *
 * THE ASSUMPTION, stated because it is not free: this is only correct if the skeleton's bind pose is
 * itself symmetric about x. It is here — `runs/corealm/stack-findings.md` measured the four humanoid
 * rigs as carrying the same 65 joints in the same order, and `tests/skinning.test.ts` asserts the
 * mirror reproduces the original's reach on the opposite side. A rig with an asymmetric bind pose
 * would need retargeting, not reflection.
 */
export function mirrorAnimationClip(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  for (const track of clip.tracks) {
    const split = track.name.lastIndexOf(".");
    if (split < 0) { tracks.push(track.clone()); continue; }
    const bone = track.name.slice(0, split);
    const property = track.name.slice(split + 1);
    const target = `${mirroredBoneName(bone) ?? bone}.${property}`;
    const values = Float32Array.from(track.values);

    if (property === "quaternion") {
      for (let i = 0; i < values.length; i += 4) {
        values[i + 1] = -values[i + 1]!;
        values[i + 2] = -values[i + 2]!;
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(target, Array.from(track.times), Array.from(values)));
      continue;
    }
    if (property === "position") {
      for (let i = 0; i < values.length; i += 3) values[i] = -values[i]!;
      tracks.push(new THREE.VectorKeyframeTrack(target, Array.from(track.times), Array.from(values)));
      continue;
    }
    // Scale and anything else is mirror-invariant on this rig; retarget it and leave the data alone.
    tracks.push(new THREE.VectorKeyframeTrack(target, Array.from(track.times), Array.from(values)));
  }

  return new THREE.AnimationClip(name, clip.duration, tracks, clip.blendMode);
}
