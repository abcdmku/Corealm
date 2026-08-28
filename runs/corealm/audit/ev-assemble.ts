/**
 * Offline measurement of the dressed-character assembly (worker key: ev).
 *
 * Loads the real GLBs through three's GLTFLoader under node (geometry and skins parse fine without
 * a DOM; textures are the only part that needs one, and this only counts meshes and triangles), then
 * runs `assembleDressedCharacter` at a few settings and prints the mesh / draw-call / triangle
 * counts. This is where the "5 draws to 2" claim in the rig diagnosis gets checked against the files.
 */
import fs from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  assembleDressedCharacter,
  hairAssetFor,
} from "../../../game/src/render/skinning.js";

const ROOT = "game/public/assets/models";
const DIRS = ["character", "outfit", "weapon", "prop"];

const loader = new GLTFLoader();
// Textures are the only part of a GLB that needs a DOM. Nothing measured here depends on them, and
// stubbing keeps material IDENTITY per load, which is what the merge groups by.
loader.register(() => ({
  name: "ev_stub_textures",
  loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const cache = new Map<string, THREE.Group>();

async function load(id: string): Promise<THREE.Group> {
  const hit = cache.get(id);
  if (hit) return hit;
  for (const dir of DIRS) {
    const file = `${ROOT}/${dir}/${id}.glb`;
    try {
      const bytes = await fs.readFile(file);
      const gltf = await loader.parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        "",
      );
      cache.set(id, gltf.scene);
      return gltf.scene;
    } catch (cause) {
      if ((cause as { code?: string }).code !== "ENOENT") throw cause;
    }
  }
  throw new Error(`not found: ${id}`);
}

function triangles(meshes: readonly THREE.SkinnedMesh[]): number {
  let total = 0;
  for (const mesh of meshes) {
    const index = mesh.geometry.getIndex();
    total += index
      ? Math.floor(index.count / 3)
      : Math.floor((mesh.geometry.getAttribute("position")?.count ?? 0) / 3);
  }
  return total;
}

function materialKey(material: THREE.Material): string {
  const standard = material as THREE.MeshStandardMaterial;
  const map = standard.map;
  return [material.name, material.type, map ? map.name : "-", standard.color?.getHexString() ?? "-"].join("|");
}

async function report(body: string, parts: string[], headCap: boolean, merge: boolean): Promise<void> {
  const spec = {
    bodyAssetId: body,
    body: await load(body),
    parts: await Promise.all(parts.map(async (assetId) => ({ assetId, source: await load(assetId) }))),
    headCap,
    merge,
    mergeOptions: { materialKey },
  };
  const character = assembleDressedCharacter(spec);
  console.log(
    `${body} + [${parts.join(", ")}] headCap=${headCap} merge=${merge}` +
    ` -> meshes ${character.meshes.length} draws ${character.drawCalls}` +
    ` tris ${triangles(character.meshes)}` +
    (character.merged ? ` (merge ${character.merged.drawCallsBefore}->${character.merged.drawCallsAfter})` : "") +
    (character.headCap ? ` cap ${character.headCap.trianglesBefore}->${character.headCap.trianglesAfter}` : ""),
  );
  for (const [assetId, rebind] of character.rebinds) {
    if (rebind.rejected || rebind.missing.length > 0) {
      console.log(`   ! ${assetId}: rejected=${rebind.rejected} missing=${rebind.missing.join(",")}`);
    }
  }
  character.dispose();
}

async function main(): Promise<void> {
  const sets: Array<[string, string[]]> = [
    ["base_male", ["outfit_male_peasant"]],
    ["base_male", ["outfit_male_ranger"]],
    ["base_female", ["outfit_female_peasant"]],
    ["base_female", ["outfit_female_ranger"]],
    ["base_male", ["outfit_male_peasant_chest", "outfit_male_peasant_legs", "outfit_male_peasant_boots"]],
  ];
  for (const [body, parts] of sets) {
    const sex = body === "base_female" ? "female" : "male";
    const hair = hairAssetFor("npc_warden_ilse", sex);
    await report(body, parts, false, false);
    await report(body, parts, true, false);
    await report(body, [...parts, hair], true, true);
  }
  // What the game draws today: the clothes-only GLB used as a whole body.
  for (const outfit of ["outfit_male_peasant", "outfit_male_ranger", "outfit_female_peasant", "outfit_female_ranger"]) {
    const source = await load(outfit);
    let meshes = 0;
    let prims = 0;
    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes += 1;
      prims += Array.isArray(mesh.material) ? mesh.material.length : 1;
    });
    console.log(`TODAY ${outfit} as a body -> meshes ${meshes} draws ${prims}`);
  }
}

await main();

// Hooded outfits skip hair: the hood mesh spans y 1.5253-1.8650 and hair would poke through it.
for (const [body, outfit] of [["base_male", "outfit_male_ranger"], ["base_female", "outfit_female_ranger"]] as const) {
  const character = assembleDressedCharacter({
    bodyAssetId: body,
    body: await load(body),
    parts: [{ assetId: outfit, source: await load(outfit) }],
    headCap: true,
    merge: true,
  });
  console.log(
    `NOHAIR ${body} + ${outfit} -> meshes ${character.meshes.length}` +
    ` tris ${triangles(character.meshes)} names ${character.meshes.map((m) => m.name).join(",")}`,
  );
  character.dispose();
}

// The exact part lists world/regionBuilder.ts:53-55 now authors.
const PEASANT = ["chest", "legs", "boots", "gloves"];
const RANGER = ["chest", "legs", "boots", "gloves", "hood", "pauldron"];
for (const [body, sex, kind, slots] of [
  ["base_male", "male", "peasant", PEASANT],
  ["base_male", "male", "ranger", RANGER],
  ["base_female", "female", "peasant", PEASANT],
  ["base_female", "female", "ranger", RANGER],
] as const) {
  const parts = slots.map((slot) => `outfit_${sex}_${kind}_${slot}`);
  const hooded = kind === "ranger";
  const withHair = hooded ? parts : [...parts, hairAssetFor("npc_x", sex)];
  await report(body, withHair, true, true);
}
