// For one GLB: dumps its base-colour texture stats and the mean texel the mesh's UVs actually land
// on, per primitive. A stylized kit atlas is mostly empty, so "the texture is bright" and "the mesh
// samples a bright part of it" are different questions.
import fs from 'node:fs';
import sharp from 'sharp';
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  console.log('==', f.split(/[\/]/).pop());
  const imgCache = new Map();
  const loadImage = async (ti) => {
    const tex = json.textures[ti];
    const src = json.images[tex.source];
    if (imgCache.has(tex.source)) return imgCache.get(tex.source);
    const bv = json.bufferViews[src.bufferView];
    const off = binStart + (bv.byteOffset ?? 0);
    const data = buf.subarray(off, off + bv.byteLength);
    const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rec = { raw, info };
    imgCache.set(tex.source, rec);
    return rec;
  };
  const readAcc = (ai) => {
    const acc = json.accessors[ai];
    const bv = json.bufferViews[acc.bufferView];
    const base = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = bv.byteStride ?? 8;
    const out = [];
    for (let i = 0; i < acc.count; i++) {
      const p = base + i * stride;
      out.push([buf.readFloatLE(p), buf.readFloatLE(p + 4)]);
    }
    return out;
  };
  for (const mesh of json.meshes ?? []) for (const prim of mesh.primitives ?? []) {
    const mat = json.materials[prim.material];
    const bct = mat?.pbrMetallicRoughness?.baseColorTexture;
    const name = mat?.name ?? '(none)';
    if (!bct) { console.log('  ', name, 'no baseColorTexture'); continue; }
    const { raw, info } = await loadImage(bct.index);
    const uvs = readAcc(prim.attributes.TEXCOORD_0);
    let s = [0, 0, 0], n = 0, mn = 255, mx = 0;
    const samples = [];
    for (let i = 0; i < uvs.length; i += Math.max(1, Math.floor(uvs.length / 400))) {
      const [u, v] = uvs[i];
      const x = Math.min(info.width - 1, Math.max(0, Math.round(u * info.width)));
      const y = Math.min(info.height - 1, Math.max(0, Math.round(v * info.height)));
      const p = (y * info.width + x) * info.channels;
      const px = [raw[p], raw[p + 1], raw[p + 2]];
      s[0] += px[0]; s[1] += px[1]; s[2] += px[2]; n++;
      const l = (px[0] + px[1] + px[2]) / 3;
      if (l < mn) mn = l; if (l > mx) mx = l;
      if (samples.length < 6) samples.push(px.join('/'));
    }
    // Whole-image mean, which is what the top mip level is.
    let t = [0, 0, 0], tn = 0;
    for (let p = 0; p < raw.length; p += info.channels) { t[0] += raw[p]; t[1] += raw[p + 1]; t[2] += raw[p + 2]; tn++; }
    console.log('  ', name, `${info.width}x${info.height}`,
      'uv-sampled mean', s.map(v => Math.round(v / n)).join(','),
      `lum ${mn.toFixed(0)}..${mx.toFixed(0)}`,
      '| whole-image mean (= top mip)', t.map(v => Math.round(v / tn)).join(','),
      '| samples', samples.join(' '));
  }
}
