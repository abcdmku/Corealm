import { createDetailAtlas, createWaterNormalMap, createContactDecalTexture, DETAIL_VALUE_OFFSET } from "../../../game/src/render/proceduralTextures.js";

let t = performance.now();
const atlas = createDetailAtlas();
console.log("detail atlas ms", (performance.now() - t).toFixed(1), "size", atlas.image.width);
t = performance.now();
createWaterNormalMap("fine");
createWaterNormalMap("coarse");
console.log("water normals ms", (performance.now() - t).toFixed(1));
t = performance.now();
createContactDecalTexture();
console.log("contact decal ms", (performance.now() - t).toFixed(1));

const data = atlas.image.data as Uint8Array;
const n = data.length / 4;
for (let c = 0; c < 4; c += 1) {
  let min = 255, max = 0, sum = 0;
  for (let i = 0; i < n; i += 1) {
    const v = data[i * 4 + c]!;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const dec = (b: number) => (b / 255 + DETAIL_VALUE_OFFSET).toFixed(3);
  console.log("channel", "RGBA"[c], "min", dec(min), "max", dec(max), "mean", dec(sum / n));
}
// Seam check: column 0 vs column size-1 should be continuous (periodic noise).
const size = atlas.image.width;
let seam = 0;
for (let y = 0; y < size; y += 1) {
  for (let c = 0; c < 4; c += 1) {
    seam = Math.max(seam, Math.abs(data[(y * size + 0) * 4 + c]! - data[(y * size + size - 1) * 4 + c]!));
  }
}
let seamRow = 0;
for (let x = 0; x < size; x += 1) {
  for (let c = 0; c < 4; c += 1) {
    seamRow = Math.max(seamRow, Math.abs(data[(0 * size + x) * 4 + c]! - data[((size - 1) * size + x) * 4 + c]!));
  }
}
console.log("max wrap step across the tile edge (bytes) x:", seam, "y:", seamRow);
