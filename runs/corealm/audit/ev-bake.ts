/**
 * Offline check of the instanced bake path (worker key: ev).
 *
 * Reproduces what `entityViews.bakedParts` does — assemble a dressed character, pose it at a clip
 * phase, CPU-skin every SkinnedMesh into static geometry — and prints the resulting world-space
 * bounding box, so "does the baked instanced NPC have a head" is a number rather than an opinion.
 */
import fs from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assembleDressedCharacter, hairAssetFor } from "../../../game/src/render/skinning.js";

const ROOT = "game/public/assets/models";
const DIRS = ["character", "outfit", "animation"];

const loader = new GLTFLoader();
loader.register(() => ({ name: "ev_stub", loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const cache = new Map<string, { scene: THREE.Group; clips: THREE.AnimationClip[] }>();

async function load(id: string): Promise<{ scene: THREE.Group; clips: THREE.AnimationClip[] }> {
  const hit = cache.get(id);
  if (hit) return hit;
  for (const dir of DIRS) {
    try {
      const bytes = await fs.readFile(`${ROOT}/${dir}/${id}.glb`);
      const gltf = await loader.parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "",
      );
      const entry = { scene: gltf.scene, clips: gltf.animations };
      cache.set(id, entry);
      return entry;
    } catch (cause) {
      if ((cause as { code?: string }).code !== "ENOENT") throw cause;
    }
  }
  throw new Error(`not found: ${id}`);
}

/** Byte-for-byte the algorithm in entityViews.freezeSkin. */
function freezeSkin(mesh: THREE.SkinnedMesh): THREE.BufferGeometry | null {
  const source = mesh.geometry;
  const position = source.getAttribute("position");
  if (!position || !source.getAttribute("skinIndex") || !source.getAttribute("skinWeight")) return null;
  const baked = source.clone();
  const output = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    mesh.applyBoneTransform(index, vertex);
    output.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  baked.setAttribute("position", output);
  baked.deleteAttribute("skinIndex");
  baked.deleteAttribute("skinWeight");
  baked.computeVertexNormals();
  baked.computeBoundingBox();
  return baked;
}

async function bake(body: string, outfitParts: string[], clipName: string, phase: number): Promise<void> {
  const bodyAsset = await load(body);
  const parts = await Promise.all(outfitParts.map(async (assetId) => ({
    assetId, source: (await load(assetId)).scene,
  })));
  const character = assembleDressedCharacter({
    bodyAssetId: body, body: bodyAsset.scene, parts, headCap: true, merge: true,
  });

  const library = await load("animation_library_1");
  const clip = library.clips.find((candidate) => candidate.name === clipName)
    ?? (await load("animation_library_2")).clips.find((candidate) => candidate.name === clipName);
  if (clip) {
    const mixer = new THREE.AnimationMixer(character.animationRoot);
    mixer.clipAction(clip).play();
    mixer.setTime(clip.duration * phase);
  }
  character.group.updateMatrixWorld(true);

  const box = new THREE.Box3();
  let baked = 0;
  let nan = 0;
  for (const mesh of character.meshes) {
    const frozen = freezeSkin(mesh);
    if (!frozen) continue;
    baked += 1;
    const bounds = frozen.boundingBox;
    if (!bounds) continue;
    if (!Number.isFinite(bounds.min.y) || !Number.isFinite(bounds.max.y)) nan += 1;
    box.union(bounds.clone().applyMatrix4(mesh.bindMatrix));
  }
  console.log(
    `${body} + [${outfitParts.join(",")}] clip=${clip ? clip.name : "NONE"}@${phase}` +
    ` baked ${baked}/${character.meshes.length} nan ${nan}` +
    ` box y ${box.min.y.toFixed(3)}..${box.max.y.toFixed(3)}` +
    ` x ${box.min.x.toFixed(3)}..${box.max.x.toFixed(3)}`,
  );
  character.dispose();
}

const sets: Array<[string, string[]]> = [
  ["base_male", ["outfit_male_peasant", hairAssetFor("npc_smith_dorn", "male")]],
  ["base_male", ["outfit_male_ranger"]],
  ["base_female", ["outfit_female_peasant", hairAssetFor("npc_warden_ilse", "female")]],
  ["base_female", ["outfit_female_ranger"]],
];
for (const [body, parts] of sets) {
  await bake(body, parts, "Idle_Loop", 0.35);
  await bake(body, parts, "Walk_Loop", 0.28);
  await bake(body, parts, "Death01", 0.98);
}
