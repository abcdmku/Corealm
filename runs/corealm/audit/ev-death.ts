/** Where each enemy pack's Death clip leaves the body, per clip phase (worker key: ev). */
import fs from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
loader.register(() => ({ name: "ev_stub", loadTexture: () => Promise.resolve(new THREE.Texture()) }));

for (const id of ["enemy_crab", "enemy_blob", "enemy_skull", "enemy_bee"]) {
  const bytes = await fs.readFile(`game/public/assets/models/character/${id}.glb`);
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "",
  );
  const death = gltf.animations.find((clip) => /^death/i.test(clip.name));
  const idle = gltf.animations.find((clip) => /^idle|^flying/i.test(clip.name));
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const report = (clip: THREE.AnimationClip | undefined, label: string): void => {
    if (!clip) return;
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    const rows: string[] = [];
    for (const phase of [0, 0.25, 0.5, 0.75, 0.9, 0.98, 1]) {
      mixer.setTime(clip.duration * phase);
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      rows.push(`${phase}:${box.min.y.toFixed(3)}`);
    }
    console.log(`${id} ${label}=${clip.name} minY by phase ${rows.join(" ")}`);
  };
  report(idle, "idle");
  report(death, "death");
}
