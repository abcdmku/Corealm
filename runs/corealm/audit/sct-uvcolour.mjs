/**
 * Mean albedo each nature asset ACTUALLY samples, by reading its UVs against its own texture atlas.
 *
 * A whole-texture mean is useless here: the shared `Leaves` atlas holds greens, a blue leaf, orange
 * leaves and a PURPLE clover side by side, so two assets on the same material can be opposite
 * colours. This is what identified plant_broad_small/large as purple clover.
 */
import fs from 'node:fs';
import sharp from 'sharp';

const manifest = JSON.parse(fs.readFileSync('game/public/assets/manifest.json', 'utf8'));
const assets = manifest.assets ?? manifest;

const COMPONENT = { 5126: [4, (b, o) => b.readFloatLE(o)], 5123: [2, (b, o) => b.readUInt16LE(o) / 65535], 5121: [1, (b, o) => b.readUInt8(o) / 255] };

function readAccessor(b, j, binStart, index) {
  const acc = j.accessors[index];
  const view = j.bufferViews[acc.bufferView];
  const [size, read] = COMPONENT[acc.componentType];
  const base = binStart + (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride || size * 2;
  const out = new Float32Array(acc.count * 2);
  for (let i = 0; i < acc.count; i += 1) {
    out[i * 2] = read(b, base + i * stride);
    out[i * 2 + 1] = read(b, base + i * stride + size);
  }
  return out;
}

for (const entry of assets) {
  if (entry.category !== 'nature' && entry.category !== 'rock') continue;
  const b = fs.readFileSync('game/public/assets/' + entry.file);
  const l = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + l).toString('utf8'));
  const binStart = 20 + l + 8;
  const images = [];
  for (const img of j.images ?? []) {
    const bv = j.bufferViews[img.bufferView];
    const png = b.slice(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + bv.byteLength);
    images.push(await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }
  const parts = [];
  for (const mesh of j.meshes ?? []) {
    for (const prim of mesh.primitives) {
      if (prim.attributes.TEXCOORD_0 == null) continue;
      const mat = j.materials[prim.material];
      const texIndex = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
      if (texIndex == null) continue;
      const image = images[j.textures[texIndex].source];
      if (!image) continue;
      const uv = readAccessor(b, j, binStart, prim.attributes.TEXCOORD_0);
      const { data, info } = image;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let i = 0; i < uv.length; i += 2) {
        const u = uv[i], v = uv[i + 1];
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
        const x = Math.min(info.width - 1, Math.max(0, Math.round(((u % 1) + 1) % 1 * info.width)));
        const y = Math.min(info.height - 1, Math.max(0, Math.round((1 - (((v % 1) + 1) % 1)) * info.height)));
        const k = (y * info.width + x) * 4;
        if (data[k + 3] < 128) continue;
        r += data[k]; g += data[k + 1]; bl += data[k + 2]; n += 1;
      }
      if (n > 0) parts.push(`${mat.name}=rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(bl / n)})`);
    }
  }
  console.log(entry.id.padEnd(22), parts.join('  '));
}
