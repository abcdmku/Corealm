import fs from 'node:fs';
import sharp from 'sharp';
const b = fs.readFileSync('game/public/assets/models/nature/plant_broad_large.glb');
const l = b.readUInt32LE(12);
const j = JSON.parse(b.slice(20, 20 + l).toString('utf8'));
const binStart = 20 + l + 8;
const bv = j.bufferViews[j.images[0].bufferView];
const png = b.slice(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + bv.byteLength);
await sharp(png).flatten({ background: '#ff00ff' }).resize(512, 512).png().toFile('runs/corealm/screenshots/sct-leaves-atlas.png');
// Which texels does the mesh actually sample? Read the UVs.
const acc = j.accessors[j.meshes[0].primitives[0].attributes.TEXCOORD_0];
const view = j.bufferViews[acc.bufferView];
const off = binStart + (view.byteOffset || 0) + (acc.byteOffset || 0);
const uv = new Float32Array(acc.count * 2);
for (let i = 0; i < acc.count * 2; i += 1) uv[i] = b.readFloatLE(off + i * 4);
let minU = 1, maxU = 0, minV = 1, maxV = 0;
for (let i = 0; i < acc.count; i += 1) {
  minU = Math.min(minU, uv[i * 2]); maxU = Math.max(maxU, uv[i * 2]);
  minV = Math.min(minV, uv[i * 2 + 1]); maxV = Math.max(maxV, uv[i * 2 + 1]);
}
console.log('uv range u', minU.toFixed(3), maxU.toFixed(3), 'v', minV.toFixed(3), maxV.toFixed(3));
const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const px = (u, v) => {
  const x = Math.min(info.width - 1, Math.max(0, Math.round(u * info.width)));
  const y = Math.min(info.height - 1, Math.max(0, Math.round((1 - v) * info.height)));
  const k = (y * info.width + x) * 4;
  return [data[k], data[k + 1], data[k + 2], data[k + 3]];
};
let r = 0, g = 0, bl = 0, n = 0;
for (let i = 0; i < acc.count; i += 1) {
  const c = px(uv[i * 2], uv[i * 2 + 1]);
  if (c[3] < 128) continue;
  r += c[0]; g += c[1]; bl += c[2]; n += 1;
}
console.log('mean colour AT THE MESH UVs', (r / n).toFixed(0), (g / n).toFixed(0), (bl / n).toFixed(0), 'samples', n);
