/** Prints the material, texture and vertex attributes of one built animal GLB. */
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { writeFile } from "node:fs/promises";

const file = process.argv[2] ?? "game/public/assets/models/animal/animal_cattle.glb";
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(file);
const root = doc.getRoot();

console.log(file);
for (const material of root.listMaterials()) {
  const texture = material.getBaseColorTexture();
  console.log(`material ${material.getName()}`);
  console.log(`  baseColorFactor ${JSON.stringify(material.getBaseColorFactor())}`);
  console.log(`  metallic ${material.getMetallicFactor()}  roughness ${material.getRoughnessFactor()}`);
  console.log(`  emissive ${JSON.stringify(material.getEmissiveFactor())}  alphaMode ${material.getAlphaMode()}`);
  console.log(`  baseColorTexture ${texture ? `${texture.getMimeType()} ${texture.getImage()?.byteLength} bytes` : "NONE"}`);
  if (texture && process.argv.includes("--dump")) {
    const image = texture.getImage();
    if (image) {
      const out = `${file.replace(/[\\/]/g, "_")}.basecolor.${texture.getMimeType() === "image/png" ? "png" : "jpg"}`;
      await writeFile(out, image);
      console.log(`  wrote ${out}`);
    }
  }
}
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    console.log(`mesh ${mesh.getName()}  attrs [${prim.listSemantics().join(", ")}]`);
    const normal = prim.getAttribute("NORMAL");
    if (normal) {
      const array = normal.getArray()!;
      let zero = 0;
      for (let i = 0; i < array.length; i += 3) {
        if (array[i] === 0 && array[i + 1] === 0 && array[i + 2] === 0) zero += 1;
      }
      console.log(`  NORMAL ${normal.getCount()} verts, ${zero} zero-length, first ${Array.from(array.slice(0, 6)).map((v) => Number(v).toFixed(3)).join(", ")}`);
    } else {
      console.log("  NORMAL MISSING");
    }
    const colour = prim.getAttribute("COLOR_0");
    console.log(colour ? `  COLOR_0 present: ${Array.from(colour.getArray()!.slice(0, 8)).join(", ")}` : "  COLOR_0 absent");
  }
}
console.log(`animations: ${root.listAnimations().map((a) => a.getName()).join(", ")}`);
