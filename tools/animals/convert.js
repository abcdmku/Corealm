/**
 * FBX -> GLB conversion, run inside headless Chromium by tools/build-animals.ts.
 *
 * Lives in the browser because three's FBXLoader and GLTFExporter both need DOM APIs Node has no
 * answer for: the loader resolves textures through TextureLoader, and the exporter encodes images
 * through a canvas. Playwright is already a dependency for playtests, so this costs nothing new.
 *
 * Three facts about this source pack drive the whole file, all measured with `probeFbx`:
 *  - The models are authored in CENTIMETRES. A deer measures 187 units tall, so everything is
 *    scaled by 0.01 into the metres-Y-up convention the rest of game/public/assets already uses.
 *  - Every animation ships as its own FBX whose single clip is always called "Take 001". The clip
 *    name has to come from the filename or all six clips on a rig collide.
 *  - Rig and animation files share exact bone names (`Deer_MAINSHJnt`, ...), so clips retarget by
 *    name with no bone remapping. The animation files carry FEWER bones than the rig, which is
 *    fine: a track set that addresses a subset of the skeleton still fits it.
 */
import * as THREE from "three";
import { FBXLoader } from "/node_modules/three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "/node_modules/three/examples/jsm/exporters/GLTFExporter.js";

const fbxLoader = new FBXLoader();
const texLoader = new THREE.TextureLoader();
const textureCache = new Map();

/** Source units are centimetres; game/public/assets is metres. */
const CM_TO_M = 0.01;

/**
 * Frame rate the pack was authored at, needed to turn Unity's frame ranges into seconds.
 *
 * Confirmed rather than assumed: the frog take runs 0..627 frames and FBXLoader reports it as
 * 20.90 s, and 627 / 20.90 = 30.0.
 */
const SOURCE_FPS = 30;

function boxOf(object) {
  const box = new THREE.Box3();
  object.updateWorldMatrix(true, true);
  object.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    if (!node.geometry) return;
    node.geometry.computeBoundingBox();
    box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
  });
  return box;
}

function trackTargets(clip) {
  const names = new Set();
  for (const track of clip.tracks) names.add(track.name.split(".")[0]);
  return [...names];
}

/** Clips that play on LoopRepeat, and therefore have to join back to their own first frame. */
const LOOPING_CLIPS = new Set(["Idle", "Walk"]);

/** Angle between two quaternions, in degrees, sign-insensitive. */
function quatAngle(v, i, j) {
  const dot = Math.abs(v[i] * v[j] + v[i + 1] * v[j + 1] + v[i + 2] * v[j + 2] + v[i + 3] * v[j + 3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/**
 * Makes a looping clip end on the pose it starts on, so the repeat is invisible.
 *
 * A cycle authored in Unity closes because the artist made the last frame return to the first. The
 * ranges we cut with do not always preserve that: an `_exp` take packs several motions end to end
 * and its recorded walk range stops at the last DISTINCT frame, not at the repeat of the first. The
 * mixer then plays the closing pose and jumps straight to the opening one in a single display
 * frame. Measured on the shipped rigs: the deer walk crosses 5 degrees in that one frame against a
 * 1 degree per frame cycle, and the frog 12 against 2. That reads as the legs snapping mid-stride,
 * once per cycle, which is exactly the report.
 *
 * The repair is to append the FIRST keyframe of every track back onto the end. The wrap then joins
 * a pose to itself and is exact by construction, and the seam becomes ordinary interpolated motion
 * instead of a teleport.
 *
 * How much time that seam gets is measured, not guessed. The gap is divided by the clip's own
 * median per-frame motion to say how many frames' worth of movement it represents, and it is given
 * that many frames to cross so the limb keeps the speed it had. Capped at four frames because
 * beyond that the clip was never a cycle and stretching the seam only hides it, and skipped
 * entirely under 1.5 frames, where the cycle already closes to within its own frame rate.
 *
 * Returns whether it changed anything, so the build log can say which clips needed it.
 */
function closeLoop(clip, fps) {
  // Two readings of the same seam, because either one alone misses cases.
  //
  // `seamFrames` is the gap in units of the clip's own frame rate, which is what decides how much
  // time the repair gets. It can only be taken from a track that actually moves; a bone drifting a
  // fraction of a degree per frame has no frame rate to divide by and would report a ratio in the
  // hundreds from rounding noise alone.
  //
  // `maxGap` is the raw angle, and it is the one that catches the deer. Its seam sits on a slow
  // bone whose per-frame motion is under that noise floor, so the ratio test skipped it - but
  // `resample` later thins exactly those near-constant tracks, the surviving frames get further
  // apart, and the 5 degree gap is left standing in the shipped file. Measured on the ratio alone
  // the deer walk reads 1.32 frames and looks fine; measured in the GLB it pops at 6x a frame.
  let seamFrames = 0;
  let maxGap = 0;
  for (const track of clip.tracks) {
    if (track.getValueSize() !== 4 || !/\.quaternion$/.test(track.name)) continue;
    const values = track.values;
    const count = Math.floor(values.length / 4);
    if (count < 3) continue;
    const gap = quatAngle(values, 0, (count - 1) * 4);
    if (gap < 0.05) continue;
    maxGap = Math.max(maxGap, gap);
    const steps = [];
    for (let i = 1; i < count; i += 1) steps.push(quatAngle(values, (i - 1) * 4, i * 4));
    steps.sort((a, b) => a - b);
    const median = steps[Math.floor(steps.length / 2)];
    if (median <= 0.5) continue;
    seamFrames = Math.max(seamFrames, gap / median);
  }

  // Two degrees is below what reads as a pop on any of these rigs and above the float noise a
  // closed cycle carries: the clips the pack really does close measure 0.0.
  if (seamFrames <= 1.5 && maxGap <= 2) return seamFrames;

  const frames = Math.min(4, Math.max(1, Math.round(seamFrames)));
  const end = clip.duration + frames / fps;
  for (const track of clip.tracks) {
    const size = track.getValueSize();
    if (track.times.length < 2) continue;
    const times = new Float32Array(track.times.length + 1);
    times.set(track.times);
    times[track.times.length] = end;
    const values = new Float32Array(track.values.length + size);
    values.set(track.values);
    for (let c = 0; c < size; c += 1) values[track.values.length + c] = track.values[c];
    track.times = times;
    track.values = values;
  }
  clip.resetDuration();
  return Math.max(seamFrames, 1);
}

/**
 * Builds a real attack for an animal the pack never animated one for.
 *
 * Ten of these rigs ship no attack clip. Substituting the nearest authored motion was the first
 * attempt and it was simply wrong: a deer and a chicken "attacked" by lowering their heads and
 * feeding at the ground, and the frog attacked by hopping a metre and a half away. None of those
 * are an animal striking at something in front of it.
 *
 * So the strike is authored here instead. The body keeps a short slice of its own idle, so the
 * stance and any breathing motion stay the animal's own, and the ROOT bone drives a lunge: forward
 * along +Z, nose pitching down into the blow, then back. That reads as a peck, a butt, a bite or a
 * claw rush depending on whose body is on top of it, which is exactly the range needed.
 *
 * +Z is forward for the whole pack, measured rather than assumed: the chicken, deer and rabbit put
 * their neck and jaw bones at positive Z, and the frog's baked hop travels +134.7 on Z.
 *
 * `reach` is a fraction of the animal's own body length, so one number suits a 0.25 m crab and a
 * 1.7 m stag. It is DELIBERATELY small - around a tenth of the body - because the simulation is
 * already closing the distance. A strike is the weight shifting onto the front foot, not the
 * animal covering ground; anything larger reads as a pounce and fights the movement system.
 */
function synthesiseAttack(rootBone, idleClip, sizeZ, options) {
  const reach = sizeZ * (options.reach ?? 0.25);
  const dip = THREE.MathUtils.degToRad(options.dip ?? 14);
  const seconds = (options.ms ?? 560) / 1000;
  // strike lands at 30% of the clip, recovery fills the rest
  const strike = seconds * 0.3;
  const hold = seconds * 0.42;

  // Body: whichever clip was handed in, cut to the attack's length so nothing is frozen or
  // bind-posed. Bones with no track in the played clip fall back to bind pose, which snaps the
  // whole body. For an animal with no attack that source is its idle; for one whose authored attack
  // is real but too small to read - the coyote bites with its jaw and never moves its body - it is
  // that attack, and the lunge is layered on top of the animator's work rather than replacing it.
  const base = THREE.AnimationUtils.subclip(
    idleClip, "Attack", 0, Math.max(2, Math.round(seconds * SOURCE_FPS)), SOURCE_FPS,
  );
  const tracks = base.tracks.filter((track) => track.name.split(".")[0] !== rootBone.name);

  const times = [0, strike, hold, seconds];
  const drive = [0, 1, 0.85, 0];

  // The chain from the root toward the head: at each step take the child that sits furthest
  // forward. That traces spine to neck to skull and ignores legs, which is the difference between
  // an animal throwing its head at you and a rigid body tipping over.
  const chain = [];
  let node = rootBone;
  while (node) {
    chain.push(node);
    let next = null;
    let furthest = -Infinity;
    for (const child of node.children) {
      if (!child.isBone) continue;
      const z = child.getWorldPosition(new THREE.Vector3()).z;
      if (z > furthest) { furthest = z; next = child; }
    }
    if (!next || furthest <= node.getWorldPosition(new THREE.Vector3()).z) break;
    node = next;
  }

  // Graded down the chain so the body arcs instead of rotating as one piece. The root barely
  // turns and carries the travel; the head does most of the angle and arrives last.
  for (let i = 0; i < chain.length; i += 1) {
    const bone = chain[i];
    // Weighted toward the far end of the chain. The root contributes almost nothing to the angle
    // and carries the travel instead; the head does the strike. An even share across the chain is
    // what made this read as the whole animal tipping over.
    const t = chain.length === 1 ? 1 : i / (chain.length - 1);
    const share = 0.08 + 0.92 * t * t;
    const restQuat = bone.quaternion.clone();
    const quats = [];
    for (const amount of drive) {
      const pitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), dip * share * amount,
      );
      const q = restQuat.clone().multiply(pitch);
      quats.push(q.x, q.y, q.z, q.w);
    }
    const existing = tracks.findIndex((t) => t.name === `${bone.name}.quaternion`);
    const track = new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, quats);
    if (existing >= 0) tracks.splice(existing, 1, track);
    else tracks.push(track);
  }

  const rest = rootBone.position;
  const positions = [];
  for (const amount of drive) {
    positions.push(rest.x, rest.y, rest.z + reach * amount);
  }
  const posIndex = tracks.findIndex((t) => t.name === `${rootBone.name}.position`);
  const posTrack = new THREE.VectorKeyframeTrack(`${rootBone.name}.position`, times, positions);
  if (posIndex >= 0) tracks.splice(posIndex, 1, posTrack);
  else tracks.push(posTrack);

  return new THREE.AnimationClip("Attack", seconds, tracks);
}

async function loadTexture(url) {
  let cached = textureCache.get(url);
  if (!cached) {
    cached = texLoader.loadAsync(url).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      return texture;
    });
    textureCache.set(url, cached);
  }
  return cached;
}

window.probeFbx = async (url) => {
  const group = await fbxLoader.loadAsync(url);
  const box = boxOf(group);
  const size = box.getSize(new THREE.Vector3());
  const meshes = [];
  let boneCount = 0;
  group.traverse((node) => {
    if (node.isBone) boneCount += 1;
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    meshes.push({
      name: node.name,
      skinned: Boolean(node.isSkinnedMesh),
      verts: node.geometry.attributes.position.count,
      materials: materials.filter(Boolean).map((m) => m.name || "(unnamed)"),
    });
  });
  return {
    sizeCm: [size.x, size.y, size.z],
    sizeM: [size.x * CM_TO_M, size.y * CM_TO_M, size.z * CM_TO_M],
    minM: [box.min.x * CM_TO_M, box.min.y * CM_TO_M, box.min.z * CM_TO_M],
    meshes,
    boneCount,
    animations: group.animations.map((clip) => ({
      name: clip.name, duration: clip.duration, tracks: clip.tracks.length,
      targetCount: trackTargets(clip).length,
    })),
  };
};

/**
 * Build one animal GLB.
 *
 * spec: {
 *   rig: url, texture: url, textureOverrides?: { [meshNameSubstring]: url },
 *   emissive?: url, emissiveIntensity?: number,   // bosses only; animals ship base colour alone
 *   clips: [{ url, name }],
 *   dropRigClips?: boolean   // the rig's own stub "Take 001" is 0.03 s of nothing
 * }
 */
window.convertAnimal = async (spec) => {
  const root = await fbxLoader.loadAsync(spec.rig);

  // The pack's own materials point at .tga files that were never shipped beside the FBX and would
  // 404 anyway. Replace them outright with one lit material per mesh: base colour, plus an emissive
  // map where the source has one. No normal or ORM maps, like the rest of the asset library.
  const baseTexture = await loadTexture(spec.texture);
  const overrides = new Map();
  for (const [match, url] of Object.entries(spec.textureOverrides ?? {})) {
    overrides.set(match, await loadTexture(url));
  }
  // Optional, and no animal uses it. The elemental bosses do: their glow is authored as an emissive
  // map of seams and plates, and without it a boss is the same flat-lit hide as a goat.
  const emissiveTexture = spec.emissive ? await loadTexture(spec.emissive) : null;

  const meshNames = [];
  root.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    meshNames.push(node.name);
    let texture = baseTexture;
    for (const [match, override] of overrides) {
      if (node.name.toLowerCase().includes(match.toLowerCase())) texture = override;
    }
    const material = new THREE.MeshStandardMaterial({
      map: texture, roughness: 0.86, metalness: 0,
      ...(emissiveTexture
        ? {
            emissiveMap: emissiveTexture,
            // White, so the map's own colour is what shows. Tinting here instead would multiply
            // twice: the maps are already recoloured per element when they are staged.
            emissive: new THREE.Color(0xffffff),
            emissiveIntensity: spec.emissiveIntensity ?? 1,
          }
        : {}),
      // Several of these textures carry a real alpha channel for fins, fur cards and wing
      // membranes. Alpha test rather than blend: sorted transparency on an instanced crowd of
      // animals is not worth the cost, and these masks are hard-edged anyway.
      alphaTest: spec.alphaTest ?? 0,
      side: spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    material.name = `${spec.id}_mat`;
    if (Array.isArray(node.material)) node.material = node.material.map(() => material);
    else node.material = material;
    node.frustumCulled = false;
  });

  // The hierarchy root of the skeleton: the one bone whose parent is not itself a bone. Everything
  // that needs "the bone that carries the whole animal" resolves through this rather than a name.
  const allBones = [];
  root.traverse((node) => { if (node.isBone) allBones.push(node); });
  const rootBone = allBones.find((bone) => !bone.parent?.isBone) ?? allBones[0] ?? null;
  const rootBoneName = rootBone ? rootBone.name : null;

  // Nodes whose transform can actually reach a vertex: the bones every skin binds to, plus the
  // mesh nodes themselves, which some rigs animate directly instead of their skeleton.
  const deformingNodes = new Set();
  root.traverse((node) => {
    if (node.isSkinnedMesh) {
      deformingNodes.add(node.name);
      for (const bone of node.skeleton?.bones ?? []) deformingNodes.add(bone.name);
    } else if (node.isMesh) {
      deformingNodes.add(node.name);
    }
  });

  const clips = [];
  const clipReport = [];
  // Every NAMED node, not just bones. The fish rigs animate their mesh node directly rather than
  // only their skeleton, so a bones-only set reports a perfectly good clip as broken.
  const rigNodes = new Set();
  root.traverse((node) => { if (node.name) rigNodes.add(node.name); });

  for (const entry of spec.clips) {
    const source = await fbxLoader.loadAsync(entry.url);
    let clip = source.animations[0];
    if (!clip) { clipReport.push({ name: entry.name, ok: false, reason: "no clip in file" }); continue; }

    // Cut the clip down to the frame range Unity recorded for it.
    //
    // Half the pack's animation files are not single clips. The `_exp` rigs each ship one long take
    // covering every motion, and the motions are sub-ranges of it, so taking `animations[0]` whole
    // gave the frog, hog, rat and crab four IDENTICAL clips - the same 20.9 s take for idle, walk,
    // attack and death, which is why they never appeared to change animation. The ranges come from
    // the `.meta` sidecars via `stage-clip-ranges.py`; `entry.frames` may narrow them further,
    // which is how a 230-frame feeding cycle becomes a peck. See catalog.mjs.
    const frames = entry.frames;
    if (frames) {
      const [first, last] = frames;
      // Unity's frame numbers are 1-BASED for the single-motion files, and the file holds exactly
      // one cycle. `Ibex_Run` is 14 keys, frames 0 to 13, and frame 13 returns to frame 0's pose -
      // a closed loop - while Unity records the range as 1..14. Subclipping to 1..13 therefore
      // dropped frame 0 and every repeat jumped from the closing pose back to frame 1 instead,
      // measured at 51 degrees against a 7 degree frame. That is the jittery walk.
      //
      // So a range that spans the whole take is left alone: the take already IS the clip. Only the
      // `_exp` rigs, which pack many motions into one long take, get cut, and their ranges are
      // genuine 0-based offsets into it.
      const totalFrames = Math.round(clip.duration * SOURCE_FPS);
      const wholeTake = first <= 1 && last >= totalFrames;
      if (!wholeTake && last > first) {
        // Searching a window around the recorded end for a better cycle match was tried and
        // removed: judged on the single widest-travel track it picks frames that match there and
        // nowhere else, which left the hog wrapping 55 degrees where it had been clean.
        clip = THREE.AnimationUtils.subclip(clip, entry.name, first, last, SOURCE_FPS);
      }
    }
    clip.name = entry.name;
    // Prove the clip addresses this rig before it ships. A silently non-fitting clip is the exact
    // failure that makes an enemy stand in bind pose through a whole fight.
    const targets = trackTargets(clip);
    const missing = targets.filter((t) => !rigNodes.has(t));
    // Root motion is baked into the clips. The game drives position from the sim, so a clip that
    // also translates the root fights it and the animal skates.
    //
    // Matched by BONE IDENTITY, not by name. This was a `MAINSHJnt|ROOTSHJnt|_root|Hips` regex,
    // which covers the named rigs and misses every `_exp` one, whose root is called `Bone001` or
    // `Bone002`. The frog's hop carries 134.7 units of root travel - 1.35 m - and none of it was
    // being stripped, so the frog physically leapt across the ground on every step and every swing.
    if (spec.stripRootMotion !== false && rootBoneName) {
      clip.tracks = clip.tracks.filter((track) => !/\.position$/.test(track.name)
        || track.name.split(".")[0] !== rootBoneName);
    }
    // Drop channels that cannot move a single vertex.
    //
    // These rigs ship IK helper objects - `IK_Chain007` and friends - which are neither skin joints
    // nor meshes. Their tracks are the LARGEST in several clips (the frog's carries 138 units of
    // hop) and they deform nothing, so they are pure weight in the buffer and pure work for the
    // mixer. They also make any "is this clip translating the animal" check meaningless until they
    // are gone, which is how a stripped frog still measured as leaping 1.38 m.
    if (deformingNodes.size > 0) {
      clip.tracks = clip.tracks.filter((track) => deformingNodes.has(track.name.split(".")[0]));
    }

    // Last, so it closes the clip that actually ships: after the range cut, after the root-motion
    // strip and after the IK channels are dropped.
    const seam = LOOPING_CLIPS.has(entry.name) ? closeLoop(clip, SOURCE_FPS) : 0;
    const sealed = seam >= 1;

    clips.push(clip);
    clipReport.push({
      name: entry.name, ok: missing.length === 0, duration: clip.duration, sealed, seam,
      tracks: clip.tracks.length, missing: missing.slice(0, 4), targetCount: targets.length,
    });
  }

  // Replace the substitute attack with an authored lunge, where the pack gave us nothing to use.
  if (spec.synthAttack && rootBone) {
    const baseName = spec.synthAttack.base === "Attack" ? "Attack" : "Idle";
    const idle = clips.find((clip) => clip.name === baseName);
    if (idle) {
      const measured = boxOf(root).getSize(new THREE.Vector3());
      const attack = synthesiseAttack(rootBone, idle, measured.z, spec.synthAttack);
      const existing = clips.findIndex((clip) => clip.name === "Attack");
      if (existing >= 0) clips.splice(existing, 1, attack);
      else clips.push(attack);
      const report = clipReport.find((row) => row.name === "Attack");
      if (report) { report.synthesised = true; report.duration = attack.duration; }
    }
  }

  // Centimetres -> metres.
  //
  // Deliberately a node scale rather than a bake. Baking it into the geometry and the skeleton was
  // tried and reverted: these rigs park their own scales in different places (the bear's mesh node
  // carries 72.242, the deer's carries 1), so one uniform factor applied to vertices, bone
  // translations and inverse binds is right for some rigs and wrong for others - measured, it left
  // frogs at 3.24 m and bears at 0.20 m. three's skinning shader applies the node's world matrix
  // after the skin, so this is correct for every rig, and the consumer that ignored it
  // (`render/entityViews.ts` pose bake) was fixed instead.
  root.scale.setScalar(CM_TO_M * (spec.extraScale ?? 1));
  root.updateMatrixWorld(true);

  // What ground speed the walk cycle looks like it is travelling at, so the runtime can play it at
  // the rate that keeps the feet planted. Measured from the feet because these cycles are authored
  // in place: every rig but the frog has zero root travel, so the stride is not in the root track.
  let impliedWalkMps = 0;
  const walkClip = clips.find((clip) => clip.name === "Walk");
  if (walkClip && walkClip.duration > 0) {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(walkClip).play();
    // FEET ONLY. The widest-swinging bone in a gallop is not always a foot: a stag's antler tip and
    // a coyote's tail sweep further than either hind leg, and taking those as the stride overstates
    // it and asks for too slow a playback rate. Restricting to bones that sit in the bottom quarter
    // of the animal in its rest pose keeps ankles and hooves and drops everything carried high.
    const bones = [];
    root.traverse((node) => { if (node.isBone) bones.push(node); });
    root.updateMatrixWorld(true);
    const restY = new Map();
    let lowest = Infinity;
    let highest = -Infinity;
    for (const bone of bones) {
      const y = bone.getWorldPosition(new THREE.Vector3()).y;
      restY.set(bone.name, y);
      lowest = Math.min(lowest, y);
      highest = Math.max(highest, y);
    }
    const footCeiling = lowest + (highest - lowest) * 0.25;
    const feet = bones.filter((bone) => restY.get(bone.name) <= footCeiling);
    const sampled = feet.length > 0 ? feet : bones;

    const lo = new Map();
    const hi = new Map();
    const SAMPLES = 24;
    for (let i = 0; i < SAMPLES; i += 1) {
      mixer.setTime((walkClip.duration * i) / SAMPLES);
      root.updateMatrixWorld(true);
      for (const bone of sampled) {
        const z = bone.getWorldPosition(new THREE.Vector3()).z;
        lo.set(bone.name, Math.min(lo.get(bone.name) ?? z, z));
        hi.set(bone.name, Math.max(hi.get(bone.name) ?? z, z));
      }
    }
    let stride = 0;
    for (const [bone, low] of lo) stride = Math.max(stride, hi.get(bone) - low);
    // Bone world positions here are ALREADY metres: this runs after the root has been scaled, so
    // applying CM_TO_M again would divide the answer by a hundred.
    impliedWalkMps = stride / walkClip.duration;
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
  }

  const box = boxOf(root);
  const size = box.getSize(new THREE.Vector3());

  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true, animations: clips, embedImages: true, onlyVisible: false },
    );
  });

  const bytes = new Uint8Array(glb);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return {
    base64: btoa(binary),
    bytes: bytes.length,
    size: [size.x, size.y, size.z],
    base: [box.min.x, box.min.y, box.min.z],
    meshNames,
    clips: clipReport,
    impliedWalkMps,
  };
};

/**
 * Measures the ground speed a locomotion clip actually implies, in metres per second.
 *
 * These cycles are authored IN PLACE - measured, every rig but the frog has zero root travel - so
 * the stride is not in the root track and has to be read off the feet. Sampling the skeleton
 * through the clip and taking the largest horizontal range of any bone finds whichever foot swings
 * furthest, and that peak-to-peak distance IS the stride: one full forward-and-back per cycle.
 *
 * `stride / duration` is then the speed the animation looks like it is travelling at. Divided into
 * the speed the simulation actually moves the enemy, it gives the playback rate that puts the feet
 * back on the ground.
 */
window.probeStride = async (rigUrl, clipUrl, frames, name) => {
  const rig = await fbxLoader.loadAsync(rigUrl);
  const source = await fbxLoader.loadAsync(clipUrl);
  let clip = source.animations[0];
  if (frames && frames[1] > frames[0]) {
    const total = Math.round(clip.duration * SOURCE_FPS);
    if (!(frames[0] <= 1 && frames[1] >= total)) {
      clip = THREE.AnimationUtils.subclip(clip, name || "probe", frames[0], frames[1], SOURCE_FPS);
    }
  }
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(clip).play();

  const bones = [];
  rig.traverse((node) => { if (node.isBone) bones.push(node); });
  const min = new Map();
  const max = new Map();
  const SAMPLES = 24;
  for (let i = 0; i < SAMPLES; i += 1) {
    mixer.setTime((clip.duration * i) / SAMPLES);
    rig.updateMatrixWorld(true);
    for (const bone of bones) {
      const p = bone.getWorldPosition(new THREE.Vector3());
      const lo = min.get(bone.name);
      const hi = max.get(bone.name);
      min.set(bone.name, lo === undefined ? p.z : Math.min(lo, p.z));
      max.set(bone.name, hi === undefined ? p.z : Math.max(hi, p.z));
    }
  }
  let stride = 0;
  let strideBone = "";
  for (const [bone, lo] of min) {
    const range = max.get(bone) - lo;
    if (range > stride) { stride = range; strideBone = bone; }
  }
  // Source units are centimetres.
  const strideM = stride * CM_TO_M;
  return {
    bone: strideBone,
    strideM,
    duration: clip.duration,
    impliedMps: clip.duration > 0 ? strideM / clip.duration : 0,
  };
};
